"""One bounded, owned process per active read; never launch a business interpreter."""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import Future
from pathlib import Path

READ_TIMEOUT = 30


def probe_main():
    from . import adapters
    from .model import redact
    task = json.loads(sys.stdin.readline())

    def parent_watch():
        # Raw descriptor avoids a daemon holding a buffered stdin lock at shutdown.
        try:
            while os.read(sys.stdin.fileno(), 1):
                pass
        finally:
            os._exit(0)

    threading.Thread(target=parent_watch, daemon=True).start()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            value = adapters.collect(task)
        result = {'result': value}
    except Exception as exc:
        result = {'error': redact(str(exc))[:800], 'kind': type(exc).__name__}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)


class ReadJob(Future):
    def __init__(self, task, timeout=READ_TIMEOUT, command=None):
        super().__init__()
        self.guard = threading.Lock()
        self.process = None
        self.aborted = False
        self.timed_out = False
        self.task, self.timeout = task, timeout
        self.command = command or ([sys.executable, '--probe'] if getattr(sys, 'frozen', False)
                                   else [sys.executable, '-B', '-m', 'collector.main', '--probe'])
        self.thread = threading.Thread(target=self.run, name='bounded-progress', daemon=True)

    def abort(self):
        with self.guard:
            self.aborted = True
            if self.process is not None and self.process.poll() is None:
                self.process.kill()

    def run(self):
        started = time.monotonic()
        pipe = None
        error = None
        value = None
        def expire():
            self.timed_out = True
            self.abort()
        timer = threading.Timer(self.timeout, expire)
        timer.daemon = True
        timer.start()
        try:
            env = os.environ.copy()
            env['PYTHONIOENCODING'] = 'utf-8'
            env['PYTHONDONTWRITEBYTECODE'] = '1'
            process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, encoding='utf-8', env=env,
                cwd=str(Path(__file__).resolve().parents[1]),
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            with self.guard:
                self.process = process
                if self.aborted:
                    process.kill()
            pipe = process.stdin
            pipe.write(json.dumps(self.task, ensure_ascii=False) + '\n')
            pipe.flush()
            # Keep the pipe open: EOF tells the worker that its owner has exited.
            process.stdin = None
            try:
                output, _ = process.communicate(timeout=max(.001, self.timeout - (time.monotonic() - started)))
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise TimeoutError('本次进度读取超过 30 秒，保留上次统计') from None
            if self.aborted:
                raise TimeoutError('读取已取消')
            if process.returncode:
                raise RuntimeError('进度读取组件异常退出')
            result = json.loads(output)
            if 'error' in result:
                error = {'TimeoutError': TimeoutError, 'FileNotFoundError': FileNotFoundError}.get(result.get('kind'), ValueError)
                raise error(result['error'])
            value = result['result']
        except Exception as exc:
            error = TimeoutError('本次进度读取超时，保留上次统计') if self.timed_out else exc
        finally:
            timer.cancel()
            if pipe is not None:
                try:
                    pipe.close()
                except OSError:
                    pass
            with self.guard:
                process = self.process
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
        # Publish only after the owned process is gone: replacement never overlaps.
        if error is not None:
            self.set_exception(error)
        else:
            self.set_result(value)


class ReadPool:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs = set()
        self.closed = False

    def submit(self, function, task):
        with self.lock:
            if self.closed:
                raise RuntimeError('采集器正在退出')
            job = ReadJob(task)
            self.jobs.add(job)
            job.add_done_callback(self.finished)
            job.thread.start()
            return job

    def finished(self, job):
        with self.lock:
            self.jobs.discard(job)

    def shutdown(self, wait=False, cancel_futures=True):
        with self.lock:
            self.closed = True
            jobs = list(self.jobs)
        for job in jobs:
            job.abort()
        if wait:
            for job in jobs:
                job.thread.join()
