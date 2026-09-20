from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

from .model import default_tasks, redact


class Store:
    def __init__(self, directory, seed=True):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
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
            ''')
            initialized = self.db.execute("SELECT value FROM settings WHERE key='initialized'").fetchone()
            if not initialized:
                if seed:
                    for task in default_tasks():
                        self.db.execute('INSERT OR IGNORE INTO tasks VALUES(?,?)', (task['id'], json.dumps(task, ensure_ascii=False)))
                self.db.execute("INSERT INTO settings VALUES('initialized','true')")
                self.db.execute("INSERT INTO settings VALUES('notifications','true')")
            self.db.commit()

    def tasks(self):
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute('SELECT config FROM tasks ORDER BY rowid')]

    def save_task(self, task):
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO tasks VALUES(?,?)', (task['id'], json.dumps(task, ensure_ascii=False)))
            self.db.commit()

    def setting(self, key, value=None):
        with self.lock:
            if value is not None:
                self.db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, json.dumps(value)))
                self.db.commit()
            row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def event(self, task_id, message):
        with self.lock:
            self.db.execute('INSERT INTO events(task_id,at,message) VALUES(?,?,?)', (task_id, time.time(), redact(message)))
            self.db.commit()

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
            self.db.commit()
        return created

    def record_run(self, task_id, identity, started, status, ended=None):
        key = f'{task_id}:{identity}'
        with self.lock:
            old = self.db.execute('SELECT status FROM runs WHERE id=?', (key,)).fetchone()
            self.db.execute('''INSERT INTO runs VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                ended=excluded.ended,status=excluded.status''', (key, task_id, started, ended, status, time.time()))
            self.db.commit()
        if not old or old['status'] != status:
            labels = {'running': '开始运行', 'completed': '运行完成', 'failed': '运行失败',
                      'unknown_end': '已结束，结果未确认', 'incomplete': '运行结束，有待处理事项',
                      'observation_gap': '监控已恢复，先前运行结果未知'}
            self.event(task_id, labels.get(status, status))

    def close_interrupted_observations(self):
        with self.lock:
            self.db.execute("UPDATE runs SET status='observation_gap' WHERE status='running'")
            self.db.commit()

    def sample(self, task_id, resource, metrics):
        with self.lock:
            self.db.execute('INSERT INTO samples(task_id,at,cpu,memory,metrics) VALUES(?,?,?,?,?)',
                            (task_id, time.time(), resource.get('cpu_percent'), resource.get('memory_bytes'), json.dumps(metrics)))
            self.db.commit()

    def query(self, sql, args=()):
        with self.lock:
            return [dict(row) for row in self.db.execute(sql, args)]

    def acknowledge(self, alert_id):
        with self.lock:
            self.db.execute('UPDATE alerts SET acknowledged=1 WHERE id=?', (alert_id,))
            self.db.commit()
