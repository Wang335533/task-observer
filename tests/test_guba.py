import json
from unittest.mock import patch

import pytest

from collector.adapters import collect
from collector.guba import normalize_guba
from collector.model import validate_task
from collector.processes import matches
from collector.service import view_state


def snapshot(**changes):
    return dict(run_id='example-run', state='running', at='2026-09-29T10:00:00+00:00',
                posts=100, posts_complete=60, posts_count_mismatch=4, posts_processed=64,
                posts_incomplete=36, comments=230, stocks=5577, stocks_list_complete=0,
                tasks_this_run=18, jobs={'done': 80, 'pending': 70, 'running': 2, 'unsupported': 1},
                complete=False, sessions={'s01': {'role': 'list', 'proxy_ip': 'private-ip'},
                                          's02': {'role': 'content', 'cookies': 'private-cookie'}},
                proxy={'reserved_today': 12, 'daily_budget': 400, 'provider_balance': 388,
                       'password': 'private-password'}, verification={'active': 1, 'waiting': 0}) | changes


def test_metrics_keep_mismatch_and_unknown_total_without_sensitive_fields():
    result = normalize_guba(snapshot())
    metrics = {m['key']: m['value'] for m in result['metrics']}
    assert metrics['posts_processed'] == 64 and metrics['posts_complete'] == 60
    assert metrics['posts_count_mismatch'] == 4 and metrics['comments'] == 230
    assert metrics['provider_balance'] == 388
    assert result['completed'] is None and result['total'] is None
    assert result['heartbeat_at'] == result['statistics_at'] == result['updated_at']
    assert result['status'] == 'running' and result['issues'] == []
    assert 'private-' not in json.dumps(result)
    assert '正文评论 1 路' in result['current']


@pytest.mark.parametrize('state,status', [
    ('ip_guard', 'needs_attention'), ('paused_by_monitor', 'needs_attention'),
    ('auth_required', 'needs_attention'), ('interrupted', 'needs_attention'),
    ('sample_limit', 'needs_attention'), ('partial', 'needs_attention'),
    ('proxy_unreachable', 'failed'), ('proxy_error', 'failed'), ('storage_error', 'failed'),
])
def test_terminal_reasons_do_not_look_like_success(state, status):
    result = normalize_guba(snapshot(state=state))
    assert result['status'] == status
    assert result['issues'][0]['code'] == f'guba_{state}'
    view = view_state(result, {'roots': []}, None, result['updated_at'], 'guba')
    assert view['run_state'] == ('failed' if status == 'failed' else 'incomplete')


def test_completion_requires_the_producer_full_scope_flag():
    assert normalize_guba(snapshot(state='complete'))['status'] == 'needs_attention'
    assert normalize_guba(snapshot(state='complete', complete=True))['status'] == 'completed'
    assert normalize_guba(snapshot(state='running', complete=True))['status'] == 'running'


def test_unknown_counts_and_stale_heartbeat_are_not_filled_with_zero():
    raw = {'run_id': 'r', 'state': 'running', 'at': 100, 'jobs': {}}
    result = normalize_guba(raw)
    assert result['metrics'][0]['value'] is None
    assert result['metrics'][9]['value'] is None
    view = view_state(result, {'roots': [{'pid': 1, 'created_at': 50}]}, None, 1100, 'guba')
    assert 'heartbeat' in [i['code'] for i in view['issues']]


@pytest.mark.parametrize('change', [{'run_id': None}, {'at': 'invalid'}, {'jobs': None}])
def test_invalid_snapshots_raise_collection_error(change):
    with pytest.raises(ValueError):
        normalize_guba(snapshot(**change))


def test_collect_reads_only_the_selected_progress_file(tmp_path):
    path = tmp_path / 'progress.json'
    path.write_text(json.dumps(snapshot()), encoding='utf-8')
    original = path.read_bytes()
    with patch('sqlite3.connect', side_effect=AssertionError('no business database')), \
         patch('socket.create_connection', side_effect=AssertionError('no proxy API')):
        assert collect({'adapter': 'guba', 'snapshot': str(path)})['run_id'] == 'example-run'
    assert path.read_bytes() == original
    task = dict(name='股吧', adapter='guba', project=str(tmp_path), match_kind='module',
                entry='guba', subcommands=['crawl'], snapshot=str(path))
    assert validate_task(task)['interval'] == 300
    with pytest.raises(ValueError):
        validate_task(task | {'snapshot': ''})


@pytest.mark.parametrize('extra,expected', [
    (['--output', 'data/production'], True), (['--output=data/production'], True),
    (['--output', 'work/sample'], False), ([], False),
])
def test_process_match_excludes_independent_samples(tmp_path, extra, expected):
    task = dict(adapter='guba', match_kind='module', entry='guba', project=str(tmp_path),
                subcommands=['crawl'], snapshot=str(tmp_path / 'data/production/progress.json'))
    proc = dict(cmdline=['python.exe', '-m', 'guba', 'crawl', *extra], cwd=str(tmp_path))
    assert matches(task, proc) is expected
    assert not matches(task, proc | {'cmdline': ['python.exe', '-m', 'guba', 'doctor', *extra]})
