"""Reuse the registered project's read-only progress module in an isolated package.

No external interpreter or PowerShell inventory; the entire query budget is bounded.
"""
from __future__ import annotations

import json
import dataclasses  # Collected for the project's audited config/storage modules.
import hashlib
import importlib
import importlib.machinery
import sqlite3
import sys
import threading
import time
import tomllib  # Collected even in the frozen sidecar.
import types
from pathlib import Path


class BudgetReader:
    def __init__(self, path, *, seconds=.35, total_seconds=3.0):
        self.path = Path(path)
        self.seconds = seconds
        self.deadline = time.monotonic() + total_seconds
        self.errors, self.timings = [], {}

    def query(self, label, sql, parameters=()):
        started = time.monotonic()
        remaining = self.deadline - started
        if remaining <= 0:
            self.errors.append({'field': label, 'error': 'MONITOR_BUDGET_EXHAUSTED'})
            self.timings[label] = 0
            return None
        conn = None
        try:
            conn = sqlite3.connect(self.path.resolve().as_uri() + '?mode=ro',
                                   uri=True, timeout=min(.05, remaining), isolation_level=None)
            conn.execute('PRAGMA query_only=ON')
            deadline = min(self.deadline, started + self.seconds)
            conn.set_progress_handler(lambda: int(time.monotonic() >= deadline), 250)
            return conn.execute(sql, parameters).fetchall()
        except sqlite3.OperationalError as exc:
            code = getattr(exc, 'sqlite_errorcode', 0) & 255
            if code not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED, sqlite3.SQLITE_INTERRUPT):
                raise
            self.errors.append({'field': label, 'error': getattr(exc, 'sqlite_errorname', type(exc).__name__)})
            return None
        finally:
            if conn is not None:
                conn.close()
            self.timings[label] = round(time.monotonic() - started, 4)


_import_lock = threading.Lock()


def collect_grok(task):
    source = Path(task['project']).resolve() / 'grokspider'
    if not (source / 'progress.py').is_file() or not (source / 'config.py').is_file():
        raise ValueError('未找到 Grok 项目的只读进度模块，请检查项目位置')
    package = '_observer_grok_' + hashlib.sha256(str(source).casefold().encode()).hexdigest()[:16]
    with _import_lock:
        sys.dont_write_bytecode = True
        if package not in sys.modules:
            namespace = types.ModuleType(package)
            namespace.__path__ = [str(source)]
            namespace.__package__ = package
            namespace.__spec__ = importlib.machinery.ModuleSpec(package, loader=None, is_package=True)
            sys.modules[package] = namespace
        config = importlib.import_module(package + '.config')
        progress = importlib.import_module(package + '.progress')
    settings = config.load_config()
    baseline = settings.root_dir / 'work/grok-progress-monitor/latest.json'
    previous = {}
    try:
        if baseline.stat().st_size <= 4 * 1024 * 1024:
            with baseline.open(encoding='utf-8-sig') as handle:
                value = json.load(handle)
                if isinstance(value, dict):
                    previous = value
    except (OSError, ValueError):
        pass  # A missing/corrupt old cache must not prevent fresh metadata reads.
    # None means unknown; the observer separately checks real PID identities.
    result = progress.collect(settings, previous, processes=None, reader=BudgetReader(settings.state_db))
    result['inspection']['monitor_query_budget_seconds'] = 3
    result['inspection']['process_inventory'] = 'handled by observer'
    return result
