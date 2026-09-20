from __future__ import annotations

from contextlib import contextmanager

import json
import hashlib
import sqlite3
import threading
import time
from pathlib import Path

from .model import REFRESH_SECONDS, default_tasks, redact


class Store:
    def __init__(self, directory, seed=True):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.batch_depth = 0
        self.db = sqlite3.connect(self.directory / 'observer.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.lock:
            self.db.executescript('''
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, config TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, started REAL,
                ended REAL, status TEXT NOT NULL, observed_at REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY, task_id TEXT, at REAL,
                cpu REAL, memory REAL, metrics TEXT);
              CREATE INDEX IF NOT EXISTS samples_task_time ON samples(task_id,at);
              CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY, task_id TEXT, code TEXT,
                level TEXT, message TEXT, created REAL, resolved REAL, acknowledged INTEGER DEFAULT 0);
              CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, task_id TEXT, at REAL, message TEXT);
              CREATE INDEX IF NOT EXISTS runs_task_started ON runs(task_id,started);
              CREATE INDEX IF NOT EXISTS runs_started ON runs(started);
              CREATE INDEX IF NOT EXISTS alerts_active ON alerts(task_id,code) WHERE resolved IS NULL;
              CREATE INDEX IF NOT EXISTS alerts_created ON alerts(created);
              CREATE INDEX IF NOT EXISTS events_at ON events(at);
              CREATE TABLE IF NOT EXISTS latest_snapshots(task_id TEXT PRIMARY KEY, rule_key TEXT NOT NULL, snapshot TEXT NOT NULL);
            ''')
            initialized = self.db.execute("SELECT value FROM settings WHERE key='initialized'").fetchone()
            if not initialized:
                if seed:
                    for task in default_tasks():
                        self.db.execute('INSERT OR IGNORE INTO tasks VALUES(?,?)', (task['id'], json.dumps(task, ensure_ascii=False)))
                self.db.execute("INSERT INTO settings VALUES('initialized','true')")
                self.db.execute("INSERT INTO settings VALUES('notifications','true')")
            # Migrate only our configuration; no business files are changed.
            for row in self.db.execute('SELECT id,config FROM tasks').fetchall():
                config = json.loads(row['config'])
                if 'interval' in config and config['interval'] != REFRESH_SECONDS:
                    config['interval'] = REFRESH_SECONDS
                    self.db.execute('UPDATE tasks SET config=? WHERE id=?',
                                    (json.dumps(config, ensure_ascii=False), row['id']))
            self.commit()

    def commit(self):
        if not self.batch_depth:
            self.db.commit()

    @contextmanager
    def batch(self):
        # Readers cannot observe a partially committed collection cycle.
        with self.lock:
            self.batch_depth += 1
            try:
                yield
            except BaseException:
                if self.batch_depth == 1:
                    self.db.rollback()
                raise
            else:
                if self.batch_depth == 1:
                    self.db.commit()
            finally:
                self.batch_depth -= 1

    def tasks(self):
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute('SELECT config FROM tasks ORDER BY rowid')]

    def save_task(self, task):
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO tasks VALUES(?,?)', (task['id'], json.dumps(task, ensure_ascii=False)))
            self.commit()

    def setting(self, key, value=None):
        with self.lock:
            if value is not None:
                self.db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, json.dumps(value)))
                self.commit()
            row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def event(self, task_id, message):
        with self.lock:
            self.db.execute('INSERT INTO events(task_id,at,message) VALUES(?,?,?)', (task_id, time.time(), redact(message)))
            self.commit()

    def sync_alerts(self, task_id, issues):
        created = []
        with self.lock:
            active = {row['code']: row for row in self.db.execute('SELECT * FROM alerts WHERE task_id=? AND resolved IS NULL', (task_id,))}
            codes = {issue['code'] for issue in issues}
            for code, row in active.items():
                if code not in codes:
                    self.db.execute('UPDATE alerts SET resolved=? WHERE id=?', (time.time(), row['id']))
            for issue in issues:
                if issue['code'] not in active:
                    at = time.time()
                    message = redact(issue['message'])
                    cursor = self.db.execute('INSERT INTO alerts(task_id,code,level,message,created) VALUES(?,?,?,?,?)',
                                            (task_id, issue['code'], issue['level'], message, at))
                    created.append(dict(id=cursor.lastrowid, task_id=task_id, created=at, **issue))
            self.commit()
        return created

    def record_run(self, task_id, identity, started, status, ended=None):
        key = f'{task_id}:{identity}'
        with self.lock:
            old = self.db.execute('SELECT status,ended FROM runs WHERE id=?', (key,)).fetchone()
            if old and old['status'] == status and old['ended'] == ended:
                return
            self.db.execute('''INSERT INTO runs VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                ended=excluded.ended,status=excluded.status''', (key, task_id, started, ended, status, time.time()))
            self.commit()
        if not old or old['status'] != status:
            labels = {'running': '开始运行', 'completed': '运行完成', 'failed': '运行失败',
                      'unknown_end': '已结束，结果未确认', 'incomplete': '运行结束，有待处理事项',
                      'observation_gap': '监控已恢复，先前运行结果未知'}
            self.event(task_id, '恢复观察，任务仍在运行' if old and old['status'] == 'observation_gap' and status == 'running' else labels.get(status, status))

    def close_interrupted_observations(self):
        with self.lock:
            self.db.execute("UPDATE runs SET status='observation_gap' WHERE status='running'")
            self.commit()

    def sample(self, task_id, resource, metrics):
        with self.lock:
            self.db.execute('INSERT INTO samples(task_id,at,cpu,memory,metrics) VALUES(?,?,?,?,?)',
                            (task_id, time.time(), resource.get('cpu_percent'), resource.get('memory_bytes'), json.dumps(metrics)))
            self.commit()

    @staticmethod
    def rule_key(task):
        return hashlib.sha256(json.dumps(task, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()

    def save_snapshot(self, task, snapshot):
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO latest_snapshots VALUES(?,?,?)',
                            (task['id'], self.rule_key(task), json.dumps(snapshot, ensure_ascii=False, allow_nan=False)))
            self.commit()

    def load_snapshot(self, task):
        with self.lock:
            row = self.db.execute('SELECT snapshot FROM latest_snapshots WHERE task_id=? AND rule_key=?',
                                  (task['id'], self.rule_key(task))).fetchone()
        if not row:
            return None
        try:
            snapshot = json.loads(row[0])
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get('metrics'), list):
                return None
            snapshot['cached'] = True
            snapshot['note'] = (snapshot.get('note') or '') + ' 当前为恢复的本机缓存，保留原统计时间，等待本轮检查。'
            return snapshot
        except (ValueError, TypeError):
            return None

    def query(self, sql, args=()):
        with self.lock:
            return [dict(row) for row in self.db.execute(sql, args)]

    def acknowledge(self, alert_id):
        with self.lock:
            self.db.execute('UPDATE alerts SET acknowledged=1 WHERE id=?', (alert_id,))
            self.commit()
