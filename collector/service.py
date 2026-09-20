from __future__ import annotations

import copy
import json
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psutil

from . import adapters
from .model import REFRESH_SECONDS, STALE_SECONDS, redact, validate_task
from .processes import ProcessSampler
from .store import Store


def view_state(snapshot, resource, adapter_error, now, adapter):
    running = bool(resource.get('roots'))
    issues = copy.deepcopy(snapshot.get('issues', []))
    updated = snapshot.get('updated_at')
    roots = resource.get('roots', [])
    members = resource.get('members', roots)
    writer = snapshot.get('writer_pid')
    writer_current = not writer or any(
        p['pid'] == writer and (updated is None or updated >= p['created_at'] - 1)
        for p in members)
    source_current = not running or not (
        not writer_current
        or (updated and updated < min(r['created_at'] for r in roots) - 1))
    if not source_current:
        issues = []
    stale = updated is None or now - updated > STALE_SECONDS
    if adapter_error:
        issues.append(dict(code='collector_error', level='collector', message=adapter_error))
    elif running and stale and updated is not None and adapter != 'process':
        issues.append(dict(code='stale', level='collector', message='进度快照超过 15 分钟未更新'))
    if running and source_current and snapshot.get('heartbeat_at') and now - snapshot['heartbeat_at'] > STALE_SECONDS:
        issues.append(dict(code='heartbeat', level='attention', message='进程仍在运行，但任务心跳已超过 15 分钟未更新'))
    status = snapshot.get('status', 'unknown')
    if running:
        run_state = 'service_online' if adapter == 'ssrn' else 'running'
    elif status in ('completed', 'success', 'succeeded'):
        run_state = 'completed'
    elif status in ('failed', 'error', 'crashed'):
        run_state = 'failed'
    elif status in ('incomplete', 'completed_with_gaps', 'needs_attention'):
        run_state = 'incomplete'
    elif status in ('running', 'started'):
        run_state = 'unknown_end'
    else:
        run_state = 'idle'
    health = 'error' if any(i['level'] == 'error' for i in issues) else ('attention' if issues else 'ok')
    return dict(run_state=run_state, health=health, issues=issues, stale=stale, source_current=source_current,
                cooldown=bool(snapshot.get('cooldown_until') and snapshot['cooldown_until'] > now))


class Service:
    def __init__(self, directory, emit=lambda value: None, seed=True):
        self.store = Store(directory, seed=seed)
        self.store.close_interrupted_observations()
        self.emit = emit
        self.sampler = ProcessSampler()
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.rescan = threading.Event()
        self.pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='progress')
        self.runtime = {}
        self.pending = {}
        self.last_scan = None
        self.last_scan_monotonic = None
        self.scan_error = None
        self.self_process = psutil.Process()
        self.self_process.cpu_percent()
        self.own_usage = {}

    def start(self):
        self.thread = threading.Thread(target=self.loop, name='sampling', daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        self.wake.set()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def loop(self):
        next_scan = 0
        while not self.stop.is_set():
            self.wake.clear()
            now = time.monotonic()
            sample_resources = now >= next_scan or self.rescan.is_set()
            if sample_resources:
                self.rescan.clear()
                # Start-to-start cadence. Skip missed cycles after sleep; never replay a burst.
                next_scan = now + REFRESH_SECONDS
            try:
                changed = self.tick(sample_resources=sample_resources)
                self.scan_error = None
            except Exception as exc:
                self.scan_error = redact(str(exc))
                changed = True
            if changed and not self.stop.is_set():
                self.emit(dict(type='snapshot_updated', snapshot=self.request('snapshot', {})))
            self.wake.wait(max(.01, next_scan - time.monotonic()))

    def tick(self, sample_resources=True):
        inventory = self.sampler.inventory(self.store.tasks()) if sample_resources else None
        now = time.time()
        changed = sample_resources
        with self.lock, self.store.batch():
            for task in self.store.tasks():
                task_id = task['id']
                if task_id not in self.runtime:
                    self.runtime[task_id] = dict(snapshot=self.store.load_snapshot(task) or adapters.base_snapshot(), resource={'roots': []},
                        error=None, next_check=0, last_sample=0, seen_roots={}, generation=0)
                state = self.runtime[task_id]
                pending = self.pending.get(task_id)
                completed = False
                if pending and pending[0].done():
                    future, generation = self.pending.pop(task_id)
                    if generation != state['generation']:
                        # An edit during an in-flight read must get its first result promptly.
                        self.rescan.set()
                        self.wake.set()
                    if generation == state['generation']:
                        changed = completed = True
                        try:
                            snapshot = future.result()
                            old = state['snapshot']
                            if old.get('run_id') and old.get('run_id') == snapshot.get('run_id'):
                                previous = {m['key']: m['value'] for m in old.get('metrics', [])}
                                changes = []
                                for metric in snapshot['metrics'][:2]:
                                    before, after = previous.get(metric['key']), metric['value']
                                    if before is not None and after is not None and after > before:
                                        changes.append(f"{metric['label']} +{after - before:,}")
                                if changes:
                                    self.store.event(task_id, ' · '.join(changes))
                            state.update(snapshot=snapshot, error=None)
                            self.store.save_snapshot(task, snapshot)
                        except Exception as exc:
                            if isinstance(exc, subprocess.TimeoutExpired):
                                message = '本次进度读取超时，暂时保留上次统计'
                            elif isinstance(exc, FileNotFoundError):
                                message = '未找到进度文件或解释器，请检查任务接入设置'
                            elif isinstance(exc, json.JSONDecodeError):
                                message = '进度文件暂时无法解析，下次检查将自动重试'
                            elif isinstance(exc, TimeoutError):
                                message = '进度读取超过时限，暂时保留上次统计'
                            else:
                                message = redact(str(exc))
                            state['error'] = message[:800]
                        state['last_checked_at'] = now
                if sample_resources and task_id not in self.pending:
                    future = self.pool.submit(adapters.collect, copy.deepcopy(task))
                    self.pending[task_id] = (future, state['generation'])
                    future.add_done_callback(lambda _: self.wake.set())
                if not sample_resources and not completed:
                    continue
                resource = self.sampler.collect(task, inventory) if sample_resources else state['resource']
                state['resource'] = resource
                snapshot = state['snapshot']
                current_roots = {root['identity']: root for root in resource['roots']}
                for identity, root in current_roots.items():
                    self.store.record_run(task_id, identity, root['created_at'], 'running')
                for identity, root in state['seen_roots'].items():
                    if identity not in current_roots:
                        final = 'unknown_end'
                        finished = snapshot.get('finished_at')
                        if snapshot.get('writer_pid') == root['pid'] and finished and finished >= root['created_at']:
                            value = snapshot.get('status')
                            final = 'completed' if value in ('completed', 'success', 'succeeded') else ('failed' if value in ('failed', 'error', 'crashed') else 'incomplete')
                        self.store.record_run(task_id, identity, root['created_at'], final, now)
                state['seen_roots'] = current_roots
                # A terminal snapshot can arrive after the process-disappearance scan.
                if snapshot.get('finished_at') and snapshot.get('started_at'):
                    for row in self.store.query("SELECT * FROM runs WHERE task_id=? AND status='unknown_end' ORDER BY started DESC LIMIT 5", (task_id,)):
                        _, pid, created = row['id'].rsplit(':', 2)
                        if snapshot.get('writer_pid') == int(pid) and abs(snapshot['started_at'] - float(created)) < 30 and snapshot['finished_at'] >= row['started']:
                            value = snapshot.get('status')
                            final = 'completed' if value in ('completed', 'success', 'succeeded') else 'failed' if value in ('failed', 'error', 'crashed') else 'incomplete'
                            self.store.record_run(task_id, f'{pid}:{created}', row['started'], final, snapshot['finished_at'])
                health = view_state(snapshot, resource, state['error'], now, task['adapter'])
                if health['run_state'] == 'idle' and self.store.query('SELECT id FROM runs WHERE task_id=? LIMIT 1', (task_id,)):
                    health['run_state'] = 'unknown_end'
                state['view'] = health
                for alert in self.store.sync_alerts(task_id, health['issues']):
                    if self.store.setting('notifications'):
                        self.emit(dict(type='notification', title=task['name'], body=alert['message'], alert_id=alert['id']))
                if sample_resources:
                    self.store.sample(task_id, resource, snapshot['metrics'])
                    state['last_sample'] = now
            if sample_resources:
                self.last_scan = now
                self.last_scan_monotonic = time.monotonic()
                self.own_usage = dict(cpu_percent=round(self.self_process.cpu_percent() / (psutil.cpu_count() or 1), 2),
                                      memory_bytes=self.self_process.memory_info().rss)
        return changed

    def task_views(self):
        views = []
        with self.lock:
            for task in self.store.tasks():
                state = self.runtime.get(task['id'], {})
                snapshot = copy.deepcopy(state.get('snapshot', adapters.base_snapshot()))
                if state.get('view', {}).get('source_current') is False:
                    snapshot = adapters.base_snapshot() | {'stage': '新一轮运行，等待进度', 'note': '旧快照属于先前的运行，暂不作为当前进度展示。'}
                views.append(dict(config=task, snapshot=snapshot,
                                  resource=copy.deepcopy(state.get('resource', {'roots': []})),
                                  view=copy.deepcopy(state.get('view', dict(run_state='idle', health='ok', issues=[], stale=True))),
                                  checking=task['id'] in self.pending, last_checked_at=state.get('last_checked_at')))
        return views

    def request(self, method, params):
        if method == 'ping':
            return dict(sample_age=None if self.last_scan_monotonic is None else time.monotonic() - self.last_scan_monotonic,
                        notifications=bool(self.store.setting('notifications')))
        if method == 'snapshot':
            return dict(tasks=self.task_views(), last_scan=self.last_scan, scan_error=self.scan_error,
                        observer=self.own_usage, data_dir=str(self.store.directory),
                        settings=dict(notifications=bool(self.store.setting('notifications'))),
                        alerts=self.store.query('SELECT * FROM alerts ORDER BY created DESC LIMIT 100'),
                        events=self.store.query('SELECT * FROM events ORDER BY at DESC LIMIT 100'))
        if method == 'save_task':
            incoming = params.get('task') or {}
            task = validate_task(incoming)
            with self.lock:
                exists = {t['id'] for t in self.store.tasks()}
                if not incoming.get('id'):
                    task['id'] = uuid.uuid4().hex[:12]
                elif incoming['id'] not in exists:
                    raise ValueError('未找到要编辑的任务')
                self.store.save_task(task)
                old = self.runtime.get(task['id'], {})
                self.runtime[task['id']] = dict(snapshot=adapters.base_snapshot(), resource={'roots': []}, error=None,
                    next_check=0, last_sample=0, seen_roots={}, generation=old.get('generation', 0) + 1)
                self.store.event(task['id'], '已更新关注任务' if task['id'] in exists else '已添加关注任务')
                self.rescan.set()
                self.wake.set()
            return task
        if method == 'set_notifications':
            return self.store.setting('notifications', bool(params.get('enabled')))
        if method == 'acknowledge':
            self.store.acknowledge(int(params['id']))
            return True
        if method == 'history':
            task_id = params.get('task_id')
            if task_id:
                return self.store.query('SELECT * FROM runs WHERE task_id=? ORDER BY started DESC LIMIT 200', (task_id,))
            return self.store.query('SELECT * FROM runs ORDER BY started DESC LIMIT 200')
        if method in ('detail', 'logs'):
            task_id = params.get('task_id')
            task = next((t for t in self.store.tasks() if t['id'] == task_id), None)
            if not task:
                raise ValueError('关注任务不存在')
            if method == 'logs':
                return adapters.read_log(task)
            section = params.get('section', 'all')
            if section not in ('all', 'overview', 'resources', 'history'):
                raise ValueError('不支持的详情页签')
            rows = []
            if section in ('all', 'resources'):
                rows = self.store.query('SELECT at,cpu,memory FROM samples WHERE task_id=? AND at>=? ORDER BY at',
                                        (task_id, time.time() - 24 * 3600))
            history = self.request('history', {'task_id': task_id}) if section in ('all', 'history') else []
            return dict(samples=rows, history=history)
        raise ValueError('不支持的操作')
