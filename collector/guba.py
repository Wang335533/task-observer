"""Read the existing Guba progress snapshot; never open its database or proxy API."""
from __future__ import annotations

from .adapters import base_snapshot, metric
from .model import finite, timestamp


def normalize_guba(raw):
    at = timestamp(raw.get('at'))
    if not isinstance(raw.get('run_id'), str) or not raw['run_id'] or at is None:
        raise ValueError('股吧快照缺少 run_id 或有效的 at')
    jobs = raw.get('jobs')
    if not isinstance(jobs, dict):
        raise ValueError('股吧快照缺少任务队列汇总')
    sessions = raw.get('sessions') or {}
    proxy, verification = raw.get('proxy') or {}, raw.get('verification') or {}
    result = base_snapshot()
    state = raw.get('state', 'unknown')
    stages = {
        'running': '采集正文及对应评论', 'complete': '全部采集完成',
        'partial': '本轮结束，未完成项已保留', 'sample_limit': '达到样本上限，断点已保留',
        'interrupted': '已中断，断点已保留', 'ip_guard': '连续失败，IP 保护已暂停',
        'paused_by_monitor': '监控已暂停，断点已保留',
        'auth_required': '登录态需要更新，断点已保留',
        'proxy_unreachable': '代理出口不通，已停止提取',
        'proxy_error': '代理配置或认证错误，已停止', 'storage_error': '存储异常，已停止',
    }
    status = 'running' if state == 'running' else 'unknown'
    if state in ('proxy_error', 'storage_error', 'proxy_unreachable'):
        status = 'failed'
    elif state in ('partial', 'sample_limit', 'interrupted', 'ip_guard', 'paused_by_monitor', 'auth_required'):
        status = 'needs_attention'
    elif state == 'complete':
        # A drained page or sample is not the completion of all stocks.
        status = 'completed' if raw.get('complete') is True else 'needs_attention'
    stage = stages.get(state, '等待可识别的抓取状态')
    if state == 'complete' and status != 'completed':
        stage = '结束状态与全量完成标记不一致，需核对'
    result.update(status=status, stage=stage, run_id=raw['run_id'],
                  updated_at=at, statistics_at=at, heartbeat_at=at,
                  statistics_kind='抓取快照',
                  note='已处理帖包含评论数量差异项，差异单独保留。发现帖子数仍会增加，不作为全市场完成比例。'
                       'IP 预留是本输出目录的当日记账，含未确认提取；余额为最近查询值。')
    if status in ('failed', 'needs_attention'):
        result['issues'].append(dict(code=f'guba_{state}', level='error' if status == 'failed' else 'attention', message=stage))
    if state in stages and state != 'running':
        result['finished_at'] = at
    result['metrics'] = [metric(key, label, raw.get(key), unit) for key, label, unit in (
        ('posts_processed', '已处理帖', '篇'), ('comments', '评论', '条'),
        ('posts', '已发现帖', '篇'), ('posts_incomplete', '待补帖子', '篇'),
        ('posts_complete', '正文评论完整', '篇'), ('posts_count_mismatch', '评论数量差异', '篇'),
        ('stocks_list_complete', '列表全部扫完', '只'), ('stocks', '目标股票', '只'),
        ('tasks_this_run', '本轮已处理任务', '项'),
    )]
    result['metrics'] += [metric(key, label, proxy.get(key), '个') for key, label in (
        ('reserved_today', '今日 IP 预留',), ('daily_budget', '每日 IP 预算'),
        ('provider_balance', '代理余额（最近查询）'),
    )]
    result['metrics'] += [metric('verification_active', '验证中', verification.get('active'), '路'),
                          metric('verification_waiting', '等待验证', verification.get('waiting'), '路')]
    result['queues'] = [metric(key, label, jobs.get(key, 0), '项') for key, label in (
        ('done', '已处理任务'), ('pending', '待处理任务'), ('running', '在途任务'),
        ('failed', '失败待补'), ('unsupported', '待适配内容'),
    )]
    if (finite(jobs.get('failed')) or 0) > 0:
        result['issues'].append(dict(code='guba_failed_jobs', level='attention', message=f"{jobs['failed']} 项失败任务保留待补"))
    roles = [('list', '列表'), ('content', '正文评论')]
    result['current'] = ' · '.join(f'{label} {sum(s.get("role") == role for s in sessions.values())} 路'
                                    for role, label in roles) if sessions else ''
    # Whitelist fields: no cookies, proxy IPs, credentials or page text enter the observer.
    return result
