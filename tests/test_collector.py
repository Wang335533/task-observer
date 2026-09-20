import json
import subprocess
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from collector import adapters
from collector.model import default_tasks, redact, validate_task
from collector.processes import ProcessSampler, matches
from collector.service import Service, view_state
from collector.store import Store


def module_task():
    return dict(id='grok', name='Grok', project='E:/research/grok', match_kind='module', entry='grokspider', subcommands=['catchup'], adapter='grok')


def proc(args, cwd='E:/research/grok', pid=10, parent=1, created=100):
    return dict(pid=pid, ppid=parent, create_time=created, name='python.exe', cmdline=['python.exe', *args], cwd=cwd)


@pytest.mark.parametrize('args,cwd,expected', [
    (['-m', 'grokspider', 'catchup'], 'E:/research/grok', True),
    (['-B', '-m', 'grokspider', 'catchup'], 'E:/research/grok', True),
    (['-m', 'grokspider', 'status'], 'E:/research/grok', False),
    (['-m', 'grokspider.progress'], 'E:/research/grok', False),
    (['-m', 'grokspider', 'catchup'], 'E:/different/project', False),
    (['-c', "print('grokspider catchup')"], 'E:/research/grok', False),
    (['-m', 'other', 'catchup'], 'E:/research/grok', False),
    (['-m', 'grokspider', 'catchup'], None, False),
])
def test_module_whitelist(args, cwd, expected):
    assert matches(module_task(), proc(args, cwd)) is expected


def test_script_match_does_not_match_later_argument():
    task = dict(module_task(), match_kind='script', entry='E:/research/grok/train.py')
    assert matches(task, proc(['train.py']))
    assert not matches(task, proc(['other.py', '--input', 'train.py']))
    assert not matches(task, proc(['train.py'], cwd='E:/other'))
    assert not matches(task, proc(['-c', 'open("train.py").read()']))


def test_process_tree_and_pid_reuse():
    class Handle:
        def __init__(self, pid): self.pid = pid
        def create_time(self): return {10: 100, 11: 101, 12: 99}[self.pid]
        def cpu_percent(self): return 4
        def memory_info(self): return type('Mem', (), {'rss': 1024})()
    sampler = ProcessSampler()
    items = [proc(['-m', 'grokspider', 'catchup']), proc([], pid=11, parent=10, created=101),
             proc([], pid=12, parent=10, created=99), proc(['-c', 'print(1)'], pid=13)]
    with patch('collector.processes.psutil.Process', Handle), patch('collector.processes.psutil.cpu_count', return_value=4):
        result = sampler.collect(module_task(), items)
        assert result['process_count'] == 2
        assert result['memory_bytes'] == 2048
        assert len(result['roots']) == 1
        assert {p['pid'] for p in result['members']} == {10, 11}
        # Same PID with a new creation time never reuses a stale handle.
        newer = [proc(['-m', 'grokspider', 'catchup'], created=200)]
        result = sampler.collect(module_task(), newer)
        assert result['memory_bytes'] is None
        assert result['members'] == []
        assert (10, 100) not in sampler.handles


def test_tieba_research_counts_not_internal_entities():
    raw = {'research_files': [{'kind': 'post', 'row_count': 12}, {'kind': 'comment', 'row_count': 40}],
           'entities': [{'kind': 'post', 'n': 999}], '_monitor': {'captured_at': time.time()}, 'needs_review': 2}
    snapshot = adapters.normalize_tieba(raw)
    assert snapshot['metrics'][0]['value'] == 12
    assert snapshot['metrics'][2]['value'] is None
    assert snapshot['total'] is None
    assert snapshot['issues'][0]['code'] == 'review'


def test_grok_cache_and_source_time():
    snapshot = adapters.normalize_grok({'datasets': {'posts': {'actual': 12}}, 'inspection': {'cached_fields': ['datasets'], 'statistics_at': '2026-09-20T00:00:00+00:00'}})
    assert snapshot['cached']
    assert snapshot['metrics'][1]['value'] is None
    assert snapshot['statistics_at'] is not None
    assert snapshot['issues'][0]['level'] == 'collector'


def test_generic_unknown_total_and_identity():
    raw = dict(schema_version=1, task_id='train', run_id='run-1', updated_at=time.time(), completed=12, metrics=[])
    snapshot = adapters.normalize_generic(raw, {'id': 'train'})
    assert snapshot['completed'] is None and snapshot['total'] is None
    raw['total'] = 40
    assert adapters.normalize_generic(raw, {'id': 'train'})['total'] == 40
    with pytest.raises(ValueError): adapters.normalize_generic(raw, {'id': 'other'})
    raw['total'] = 2
    assert adapters.normalize_generic(raw, {'id': 'train'})['total'] is None


def test_missing_corrupt_snapshot_and_log_rotation(tmp_path):
    target = tmp_path / 'status.json'
    with pytest.raises(FileNotFoundError): adapters.read_json(target)
    target.write_text('broken', encoding='utf-8')
    with pytest.raises(json.JSONDecodeError): adapters.read_json(target)
    log = tmp_path / 'a.log'
    log.write_text('\n'.join(f'line {n}' for n in range(300)), encoding='utf-8')
    result = adapters.read_log({'logs': str(log)})
    assert len(result['lines']) == 200 and result['lines'][0] == 'line 100'
    log.rename(tmp_path / 'a.old')
    log.write_text('new\napi_key=demo_secret\n', encoding='utf-8')
    result = adapters.read_log({'logs': str(tmp_path)})
    assert result['lines'][0] == 'new' and 'demo_secret' not in '\n'.join(result['lines'])
    assert 'demo_secret' not in redact('{"api_key":"demo_secret"}')


def test_health_separate_from_process_and_no_cpu_guess():
    roots = {'roots': [{'pid': 1, 'created_at': 1}], 'cpu_percent': 0}
    snapshot = adapters.base_snapshot() | {'updated_at': 1000, 'issues': [{'code': 'review', 'level': 'attention', 'message': 'review'}]}
    state = view_state(snapshot, roots, None, 1005, 'tieba')
    assert state['run_state'] == 'running' and state['health'] == 'attention'
    snapshot['issues'] = []
    assert view_state(snapshot, roots, None, 1005, 'tieba')['health'] == 'ok'
    snapshot['cooldown_until'] = 2000
    assert view_state(snapshot, roots, None, 1005, 'tieba')['cooldown']


def test_stale_and_collector_errors_are_not_task_failures():
    snapshot = adapters.base_snapshot() | {'updated_at': 1000, 'status': 'running'}
    state = view_state(snapshot, {'roots': [{'pid': 1, 'created_at': 1}]}, None, 2000, 'tieba')
    assert state['issues'][0]['level'] == 'collector' and state['run_state'] == 'running'
    state = view_state(snapshot, {'roots': []}, 'read failed', 1400, 'tieba')
    assert state['run_state'] == 'unknown_end'


def test_old_failed_snapshot_not_assigned_to_new_run():
    snapshot = adapters.base_snapshot() | {'updated_at': 100, 'writer_pid': 5, 'status': 'failed', 'issues': [{'code': 'failed', 'level': 'error', 'message': 'old'}]}
    state = view_state(snapshot, {'roots': [{'pid': 6, 'created_at': 120}]}, None, 125, 'tieba')
    assert state['source_current'] is False
    assert state['run_state'] == 'running' and state['health'] == 'ok'


def test_snapshot_written_by_virtualenv_child_is_current():
    resource = {'roots': [{'pid': 10, 'created_at': 100}],
                'members': [{'pid': 10, 'created_at': 100}, {'pid': 11, 'created_at': 101}]}
    snapshot = adapters.base_snapshot() | {'updated_at': 120, 'writer_pid': 11,
        'issues': [{'code': 'review', 'level': 'attention', 'message': 'review'}]}
    state = view_state(snapshot, resource, None, 125, 'tieba')
    assert state['source_current'] and state['health'] == 'attention'
    # An unrelated writer and a reused child PID are not accepted.
    assert not view_state(snapshot | {'writer_pid': 99}, resource, None, 125, 'tieba')['source_current']
    newer = dict(resource, members=[{'pid': 10, 'created_at': 100}, {'pid': 11, 'created_at': 130}])
    assert not view_state(snapshot, newer, None, 135, 'tieba')['source_current']


def test_child_writer_metrics_remain_visible_in_task_view(tmp_path):
    service = Service(tmp_path, seed=False)
    service.store.save_task({'id': 'tieba', 'name': 'Test'})
    snapshot = adapters.base_snapshot() | {'updated_at': 120, 'writer_pid': 11,
        'metrics': [{'key': 'posts', 'label': '帖子', 'value': 42, 'unit': ''}]}
    resource = {'roots': [{'pid': 10, 'created_at': 100}], 'members': [{'pid': 11, 'created_at': 101}]}
    service.runtime['tieba'] = {'snapshot': snapshot, 'resource': resource,
        'view': view_state(snapshot, resource, None, 125, 'tieba')}
    assert service.task_views()[0]['snapshot']['metrics'][0]['value'] == 42
    service.close()


def test_alert_dedup_recovery_and_acknowledge(tmp_path):
    store = Store(tmp_path, seed=False)
    issue = [dict(code='read', level='collector', message='missing')]
    first = store.sync_alerts('task', issue)
    assert len(first) == 1
    store.acknowledge(first[0]['id'])
    assert store.sync_alerts('task', issue) == []
    store.sync_alerts('task', [])
    assert len(store.sync_alerts('task', issue)) == 1


def test_restart_does_not_claim_success(tmp_path):
    store = Store(tmp_path, seed=False)
    store.record_run('t', '10:100', 100, 'running')
    store.close_interrupted_observations()
    assert store.query('select status from runs')[0]['status'] == 'observation_gap'
    store.record_run('t', '10:100', 100, 'running')
    assert len(store.query('select * from runs')) == 1


def test_user_config_validation_and_no_arbitrary_command(tmp_path):
    task = dict(id='test', name='Test', adapter='json', match_kind='script', entry='train.py', project=str(tmp_path), snapshot=str(tmp_path / 's.json'), subcommands=[])
    assert Path(validate_task(task)['entry']).is_absolute()
    with pytest.raises(ValueError): validate_task(dict(task, project='relative'))
    with pytest.raises(ValueError): validate_task(dict(task, subcommands=['run;delete']))
    service = Service(tmp_path / 'store', seed=False)
    with pytest.raises(ValueError): service.request('start_task', {'command': 'x'})
    service.close()


def test_public_install_starts_empty_and_preserves_registered_tasks(tmp_path):
    assert default_tasks() == []
    first = Store(tmp_path)
    assert first.tasks() == []
    first.save_task(dict(id='registered', name='Existing task'))
    second = Store(tmp_path)
    assert second.tasks() == [dict(id='registered', name='Existing task')]
