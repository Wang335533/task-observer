"""Read-only integrations. Project paths live in the user's watch configuration."""
from __future__ import annotations

import json
import re
import sqlite3
import time
import urllib.request
from pathlib import Path

from .adapters import base_snapshot, metric, read_json
from .model import finite, timestamp


def normalize_msqa(raw):
    counts = raw.get('counts') or {}
    jobs, profiles = counts.get('jobs') or {}, counts.get('profiles') or {}
    phase = raw.get('phase', '')
    result = base_snapshot() | dict(
        metrics=[metric(key, label, counts.get(key)) for key, label in [
            ('posts_complete', '完整问题'), ('answers', '回答'), ('comments', '评论'),
            ('users', '用户'), ('profiles_complete', '完整用户资料'), ('questions_discovered', '已发现问题')]],
        queues=[metric('questions_failed', '问题待检查', jobs.get('failed', 0)),
                metric('profiles_pending', '待处理用户', profiles.get('pending', 0))],
        stage={'profiles': '补充用户资料', 'questions': '抓取问题与回答', 'inventory': '发现问题索引',
               'exporting': '导出数据', 'finished': '本轮处理结束'}.get(phase, phase or '等待阶段信息'),
        status={'complete': 'completed'}.get(raw.get('status'), raw.get('status', 'unknown')),
        run_id=raw.get('started_at'), started_at=timestamp(raw.get('started_at')),
        finished_at=timestamp(raw.get('finished_at')), writer_pid=raw.get('pid'),
        updated_at=timestamp(raw.get('heartbeat_at')), statistics_at=timestamp(raw.get('heartbeat_at')),
        heartbeat_at=timestamp(raw.get('heartbeat_at')),
        note='读取抓取程序约每 60 秒发布的进度快照；问题、回答和评论分别计数，不扫描业务数据库。')
    if (finite(jobs.get('failed')) or 0) > 0:
        result['issues'].append(dict(code='questions_review', level='attention', message=f"{jobs['failed']} 个问题需要检查"))
    if result['status'] == 'failed':
        result['issues'].append(dict(code='failed', level='error', message='任务快照记录运行失败'))
    elif result['status'] == 'needs_attention':
        result['issues'].append(dict(code='attention', level='attention', message='抓取程序报告需要关注'))
    return result


def _part_records(path, deadline):
    # Read complete JSONL records only; no decompression or full-data scan.
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError('当前分片超过 32 MB；保留旧统计，避免扫描大文件')
    records = 0
    with path.open('rb') as stream:
        for line in stream:
            if time.monotonic() > deadline:
                raise TimeoutError('当前分片读取超时')
            if not line.endswith(b'\n'):
                break
            if line.strip():
                records += 1
    return records


def collect_kokusho(task):
    root = Path(task['snapshot'])
    deadline = time.monotonic() + 5
    counts, totals, observed = {}, {}, []
    for label in ('书目', '著作', '作者'):
        directory = root / f'{label}详情分片'
        manifest = read_json(directory / '抓取清单.json')
        total = finite(manifest.get('索引ID数'))
        if total is None or total < 0:
            raise ValueError('国书抓取清单缺少有效索引数量')
        ranges = []
        for path in directory.iterdir():
            if time.monotonic() > deadline:
                raise TimeoutError('国书分片目录读取超时')
            match = re.fullmatch(re.escape(label) + r'详情_(\d+)-(\d+)\.jsonl\.(gz|part)', path.name)
            if not match:
                continue
            first, last = int(match[1]), int(match[2])
            if not 1 <= first <= last <= total:
                continue
            # The crawler atomically finalizes gz files only after validating IDs.
            if match[3] == 'part':
                if path.with_suffix('.gz').exists():
                    continue
                try:
                    last = min(last, first + _part_records(path, deadline) - 1)
                except FileNotFoundError:
                    raise ValueError('分片正在归档，下次检查自动重试') from None
            if last >= first:
                ranges.append((first, last))
                observed.append(path.stat().st_mtime)
        count, end = 0, 0
        for first, last in sorted(ranges):
            count += max(0, last - max(end, first - 1))
            end = max(end, last)
        counts[label], totals[label] = count, total
    incomplete = [key for key in counts if counts[key] < totals[key]]
    return base_snapshot() | dict(
        metrics=[metric(key, key + '详情', counts[key]) for key in counts],
        queues=[metric(key, key + '索引总量', totals[key]) for key in totals],
        stage=f'{incomplete[0]}详情抓取' if incomplete else '详情分片已覆盖全部索引',
        run_id='cumulative-kokusho', updated_at=time.time(), statistics_at=time.time(),
        note='累计详情记录：完整分片按已归档区间计数，当前分片只数完整 JSONL 行；可能包含源站返回的不存在记录。未扫描压缩正文，不以数量推断运行成功。')


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('SSRN 本地接口不允许重定向')


def _helper_json(port, endpoint):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    # No arbitrary hosts or commands; only an existing loopback helper is read.
    with opener.open(f'http://127.0.0.1:{port}{endpoint}', timeout=3) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('SSRN 汇总响应过大')
    value = json.loads(raw)
    if value.get('ok') is not True:
        raise ValueError('SSRN 本地助手尚未返回有效统计')
    return value


def normalize_ssrn(raw, active_rows, now):
    statuses = {row['status']: finite(row.get('count')) for row in raw.get('downloadStatuses', [])}
    downloaded = statuses.get('downloaded', 0)
    active = any(timestamp(row.get('updatedAt')) is not None and
                 now - timestamp(row['updatedAt']) <= 600 for row in active_rows)
    result = base_snapshot() | dict(
        metrics=[metric('downloaded', '已下载 PDF', downloaded), metric('pending', '待下载', statuses.get('pending', 0)),
                 metric('failed', '失败待重试', statuses.get('failed', 0)),
                 metric('skipped_no_pdf', '无 PDF 已跳过', statuses.get('skipped_no_pdf', 0)),
                 metric('skipped_unavailable', '不可获取已跳过', statuses.get('skipped_unavailable', 0))],
        queues=[metric(key, label, statuses.get(key, 0)) for key, label in
                [('resolving', '解析中'), ('resolved', '已解析'), ('downloading', '下载中')]],
        stage='PDF 队列近期有活动' if active else '助手在线，下载活动未确认',
        status='unknown', run_id='cumulative-ssrn-pdf', updated_at=now, statistics_at=now,
        note='仅读取现有助手的汇总；助手在线不代表浏览器正在下载。活动提示来自近 10 分钟的在途队列记录，不能区分等待、冷却与验证暂停。资源和运行历史仅对应助手，不归并共享 Chrome 进程。')
    if (statuses.get('failed') or 0) > 0:
        result['issues'].append(dict(code='pdf_review', level='attention', message=f"{statuses['failed']:,} 个 PDF 失败待重试（累计）"))
    return result


def collect_ssrn(task):
    port = int(task.get('helper_port', 18765))
    raw = _helper_json(port, '/pdf/summary')
    active = []
    statuses = {r['status']: r.get('count', 0) for r in raw.get('downloadStatuses', [])}
    for status in ('resolving', 'resolved', 'downloading'):
        if statuses.get(status):
            active.extend(_helper_json(port, f'/pdf/queue?status={status}&limit=1').get('queue', []))
    return normalize_ssrn(raw, active, time.time())


def collect_cnki(task):
    database = Path(task['snapshot'])
    db = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=.25)
    db.row_factory = sqlite3.Row
    start = time.monotonic()
    db.set_progress_handler(lambda: int(time.monotonic() - start > 2), 1000)
    try:
        db.execute('PRAGMA query_only=ON')
        journals = dict(db.execute('SELECT status,COUNT(*) FROM journals WHERE in_scope=1 GROUP BY status').fetchall())
        current = db.execute("SELECT id,title,updated_at FROM journals WHERE in_scope=1 AND status='processing' ORDER BY id LIMIT 1").fetchone()
        rows = db.execute('SELECT status,COUNT(*) AS n,SUM(fetched_count) AS fetched FROM issues WHERE journal_id=? GROUP BY status',
                          (current['id'],)).fetchall() if current else []
    except sqlite3.OperationalError as exc:
        if str(exc) in ('interrupted', 'database is locked'):
            raise TimeoutError('知网只读统计超过时限或数据库忙') from exc
        raise
    finally:
        db.close()
    counts = {row['status']: row['n'] for row in rows}
    fetched = sum(row['fetched'] or 0 for row in rows) if current else None
    result = base_snapshot() | dict(
        metrics=[metric('journals_complete', '已完成期刊', journals.get('complete', 0)),
                 metric('current_articles', '本刊论文（期次汇总）', fetched),
                 metric('current_issues', '本刊完成期次', counts.get('complete', 0) if current else None),
                 metric('journals_total', '范围内期刊', sum(journals.values()))],
        queues=[metric('journals_pending', '待处理期刊', journals.get('pending', 0)),
                metric('journals_error', '期刊错误记录', journals.get('error', 0)),
                metric('issues_pending', '本刊待处理期次', counts.get('pending', 0) if current else None)],
        run_id='cnki-journal-' + str(current['id']) if current else 'cnki-no-current-journal',
        updated_at=time.time(), statistics_at=time.time(), current=current['title'] if current else '',
        stage='期刊论文元数据抓取' if current else '等待当前期刊信息',
        note='只读查询期刊表和当前期刊的期次汇总，限时 2 秒；不扫描全库论文。本刊论文数由抓取程序按期次更新，不代表全库累计或跨期去重数；切换期刊后该数字会重置。')
    if journals.get('error', 0):
        result['issues'].append(dict(code='journals_review', level='attention', message=f"{journals['error']} 个期刊有错误记录（累计）"))
    return result
