from __future__ import annotations

import json
import time
from pathlib import Path

from .model import finite, redact, timestamp


def metric(key, label, value, unit=''):
    return dict(key=key, label=label, value=finite(value), unit=unit)


def base_snapshot():
    return dict(metrics=[], queues=[], stage='等待进度信息', status='unknown',
                run_id=None, updated_at=None, statistics_at=None, issues=[],
                completed=None, total=None, current='', cached=False)


def normalize_tieba(raw):
    result = base_snapshot()
    monitor, run = raw.get('_monitor', {}), raw.get('latest_run') or {}
    exported = {row['kind']: row.get('row_count') for row in raw.get('research_files', [])}
    result.update(
        metrics=[metric('posts', '帖子', exported.get('post')), metric('comments', '评论', exported.get('comment')),
                 metric('users', '用户', exported.get('user')), metric('pages', '已提交页面', raw.get('committed_pages'))],
        stage={'catchup': '历史内容抓取', 'daily': '增量抓取', 'run': '持续采集'}.get(monitor.get('mode'), monitor.get('mode') or '采集进度'),
        status=run.get('status', 'unknown'), run_id=run.get('id'),
        updated_at=timestamp(monitor.get('captured_at')), statistics_at=timestamp(monitor.get('captured_at')),
        started_at=timestamp(run.get('started')), finished_at=timestamp(run.get('finished')),
        writer_pid=monitor.get('writer_pid'), current=raw.get('current_thread') or '',
        note='帖子、评论、用户为已导出研究文件行数；快照更新不代表每个文件都刚刚导出。',
    )
    queue = {}
    for row in raw.get('jobs', []):
        key = row.get('status', 'unknown')
        queue[key] = queue.get(key, 0) + (finite(row.get('n')) or 0)
    labels = {'done': '已处理', 'pending': '待处理', 'review': '待核查', 'retry_wait': '等待重试', 'unavailable': '内容不可用', 'split': '已拆分'}
    result['queues'] = [metric(k, labels.get(k, k), v) for k, v in queue.items()]
    if (finite(raw.get('needs_review')) or 0) > 0:
        result['issues'].append(dict(code='review', level='attention', message=f"{raw['needs_review']} 个页面需要核查"))
    if run.get('status') in ('failed', 'error'):
        result['issues'].append(dict(code='failed', level='error', message='采集器记录本次运行失败'))
    result['cooldown_until'] = timestamp((raw.get('http') or {}).get('cooldown_until'))
    return result


def normalize_grok(raw):
    result = base_snapshot()
    datasets, run, inspection = raw.get('datasets') or {}, raw.get('run') or {}, raw.get('inspection') or {}
    result.update(
        metrics=[metric(key, label, (datasets.get(key) or {}).get('actual')) for key, label in
                 [('posts', '帖子'), ('comments', '评论'), ('users', '用户')]],
        stage={'draining_existing': '处理现有会话队列', 'history': '历史窗口抓取', 'daily': '增量抓取'}.get(
            (raw.get('scope') or {}).get('phase'), '历史窗口与会话抓取'),
        status=run.get('status', 'unknown'), run_id=run.get('run_id'),
        updated_at=timestamp(raw.get('checked_at')), statistics_at=timestamp(inspection.get('statistics_at')),
        started_at=timestamp(run.get('started_at')), finished_at=timestamp(run.get('finished_at')),
        heartbeat_at=timestamp(run.get('heartbeat_at')), writer_pid=(raw.get('lock_owner') or {}).get('pid'),
        current=(raw.get('recent_window') or {}).get('time_segment') or '',
        cached=bool(inspection.get('cached_fields') or inspection.get('query_errors')),
        note='业务数量来自最近一次完整导出的汇总，保留原统计时间；队列读取使用独立短时限，超时项沿用旧值或保持未知。',
    )
    for name, prefix in [('thread_queue', '会话'), ('user_queue', '用户')]:
        for key, label in [('done', '已完成'), ('pending', '待处理'), ('retry_wait', '等待重试'), ('dead_letter', '待核查')]:
            result['queues'].append(metric(f'{name}_{key}', f'{prefix} · {label}', (raw.get(name) or {}).get(key)))
        dead = finite((raw.get(name) or {}).get('dead_letter'))
        if dead and dead > 0:
            result['issues'].append(dict(code=f'{name}_review', level='attention', message=f'{prefix}有 {dead:,} 项待核查'))
    if run.get('status') in ('failed', 'error', 'crashed'):
        result['issues'].append(dict(code='failed', level='error', message=redact(run.get('last_error') or '采集器记录运行失败')))
    elif run.get('last_error'):
        result['last_error'] = redact(run['last_error'])
    if result['cached']:
        result['issues'].append(dict(code='cached', level='collector', message='部分统计沿用旧值，请查看更新时间'))
    return result


def normalize_generic(raw, task):
    if raw.get('schema_version') != 1:
        raise ValueError('状态文件需要 schema_version: 1')
    if raw.get('task_id') != task['id']:
        raise ValueError('状态文件的 task_id 与关注任务不一致')
    if not raw.get('run_id') or timestamp(raw.get('updated_at')) is None:
        raise ValueError('状态文件缺少 run_id 或有效的 updated_at')
    if not isinstance(raw.get('metrics', []), list):
        raise ValueError('metrics 必须是数组')
    result = base_snapshot()
    for key in ('run_id', 'stage', 'status', 'current'):
        result[key] = str(raw.get(key) or '')[:300]
    for key in ('updated_at', 'statistics_at', 'started_at', 'finished_at', 'heartbeat_at'):
        result[key] = timestamp(raw.get(key))
    result['statistics_at'] = result['statistics_at'] or result['updated_at']
    result['metrics'] = [metric(str(m.get('key', ''))[:50], str(m.get('label', ''))[:50], m.get('value'), str(m.get('unit', ''))[:20]) for m in raw.get('metrics', [])[:20]]
    completed, total = finite(raw.get('completed')), finite(raw.get('total'))
    if completed is not None and total is not None and total > 0 and 0 <= completed <= total:
        result.update(completed=completed, total=total)
    if result['status'] in ('failed', 'error', 'crashed'):
        result['issues'].append(dict(code='failed', level='error', message=redact(raw.get('error') or '任务报告运行失败')))
    if result['status'] in ('needs_attention', 'completed_with_gaps'):
        result['issues'].append(dict(code='attention', level='attention', message=redact(raw.get('message') or '任务报告有待处理事项')))
    return result


def read_json(path):
    file = Path(path)
    if file.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('状态文件超过 4 MB，请提供汇总快照')
    # Open only briefly so atomic replacement by the writer remains possible.
    with file.open('r', encoding='utf-8-sig') as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError('状态文件必须是 JSON 对象')
    return value


def collect(task):
    if task['adapter'] in ('msqa', 'kokusho', 'ssrn', 'cnki'):
        from .sources import normalize_msqa, collect_kokusho, collect_ssrn, collect_cnki
        if task['adapter'] == 'msqa':
            return normalize_msqa(read_json(task['snapshot']))
        return {'kokusho': collect_kokusho, 'ssrn': collect_ssrn, 'cnki': collect_cnki}[task['adapter']](task)
    if task['adapter'] == 'process':
        result = base_snapshot()
        result.update(stage='进程监控', updated_at=time.time(), note='尚未接入业务进度；仅展示已识别进程的信息。')
        return result
    if task['adapter'] == 'tieba':
        return normalize_tieba(read_json(task['snapshot']))
    if task['adapter'] == 'json':
        return normalize_generic(read_json(task['snapshot']), task)
    from .grok_probe import collect_grok
    return normalize_grok(collect_grok(task))


def read_log(task, limit=200):
    if not task.get('logs'):
        return dict(lines=[], path='', message='此任务尚未指定日志位置')
    path = Path(task['logs'])
    if path.is_dir():
        files = list(path.glob('*.log'))
        if not files:
            return dict(lines=[], path=str(path), message='日志目录中暂无 .log 文件')
        path = max(files, key=lambda f: f.stat().st_mtime)
    with path.open('rb') as handle:
        handle.seek(0, 2)
        size = handle.tell()
        start = max(0, size - 128 * 1024)
        handle.seek(start)
        content = handle.read(128 * 1024)
    if start:
        content = content.partition(b'\n')[2]
    lines = content.decode('utf-8', errors='replace').splitlines()[-min(limit, 500):]
    return dict(lines=[redact(line) for line in lines], path=str(path), message='', bytes_read=len(content))
