import json
import sys
import time
from concurrent.futures import Future
from unittest.mock import Mock, patch

import pytest

from collector import adapters
from collector.readers import ReadJob, ReadPool
from collector.service import Service, view_state, run_result
from collector.sources import normalize_msqa, collect_ssrn


def test_owned_reader_protocol_and_hard_timeout_do_not_block_other_tasks():
    slow = ReadJob({}, timeout=.5, command=[sys.executable, '-c', 'import time;time.sleep(30)'])
    slow.thread.start()
    pool = ReadPool()
    try:
        fast = pool.submit(adapters.collect, {'adapter': 'process'})
        assert fast.result(timeout=5)['stage'] == '进程监控'
        with pytest.raises(TimeoutError):
            slow.result(timeout=5)
        assert slow.process.poll() is not None
        assert fast.process.poll() == 0
    finally:
        slow.abort()
        slow.thread.join(5)
        pool.shutdown(wait=True)


def test_input_write_is_also_inside_deadline():
    job = ReadJob({'data': 'x' * 200_000}, timeout=.2,
                  command=[sys.executable, '-c', 'import time;time.sleep(30)'])
    job.thread.start()
    with pytest.raises(TimeoutError):
        job.result(timeout=5)
    assert job.process.poll() is not None


def test_abort_reaps_owned_worker_before_future_finishes():
    job = ReadJob({}, command=[sys.executable, '-c', 'import time;time.sleep(30)'])
    job.thread.start()
    job.abort()
    with pytest.raises(Exception):
        job.result(timeout=5)
    assert job.process.poll() is not None


def test_probe_exits_when_owner_pipe_closes(tmp_path):
    import subprocess
    package = tmp_path / 'grokspider'
    package.mkdir()
    (package / 'config.py').write_text('import time\ndef load_config():\n time.sleep(60)', encoding='utf-8')
    (package / 'progress.py').write_text('', encoding='utf-8')
    process = subprocess.Popen([sys.executable, '-B', '-m', 'collector.main', '--probe'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    try:
        process.stdin.write(json.dumps({'adapter': 'grok', 'project': str(tmp_path)}) + '\n')
        process.stdin.flush()
        time.sleep(.2)
        process.stdin.close()
        process.wait(timeout=5)
        assert process.returncode == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_child_terminal_evidence_and_unknown_status():
    root = {'pid': 10, 'created_at': 100}
    snapshot = adapters.base_snapshot() | dict(writer_pid=11, started_at=101, finished_at=200,
        status='completed', _observed_owner={'roots': ['10:100'], 'members': [root, {'pid': 11, 'created_at': 101}]})
    assert run_result(snapshot, '10:100', root) == 'completed'
    assert run_result(snapshot | {'status': 'unknown'}, '10:100', root) == 'unknown_end'
    assert run_result(snapshot, '10:300', {'pid': 10, 'created_at': 300}) == 'unknown_end'


def test_per_task_schedule_edit_isolation_and_immediate_delivery(tmp_path):
    service = Service(tmp_path, seed=False)
    service.pool.shutdown()
    calls = []
    def submit(_, task):
        future = Future()
        calls.append((task['id'], future))
        return future
    service.pool = Mock(submit=Mock(side_effect=submit))
    service.sampler = Mock(inventory=Mock(return_value=[]), collect=Mock(return_value={'roots': []}))
    for key in ('a', 'b'):
        service.store.save_task(dict(id=key, name=key, adapter='process', interval=300,
                                    match_kind='script', project=str(tmp_path), entry=key+'.py'))
    clock = [1000]
    try:
        with patch('collector.service.time.monotonic', side_effect=lambda: clock[0]), patch('collector.service.time.time', side_effect=lambda: clock[0]):
            service.tick()
            clock[0] = 1001
            calls[0][1].set_result(adapters.base_snapshot() | {'stage': 'A done'})
            service.tick(False)
            assert service.task_views()[0]['snapshot']['stage'] == 'A done'
            assert service.task_views()[1]['checking']
            # Edit only A; B's in-flight read and original deadline are unchanged.
            clock[0] = 1100
            service.request('save_task', {'task': service.store.tasks()[0]})
            service.tick()
            assert [key for key, _ in calls] == ['a', 'b', 'a']
            assert service.runtime['b']['next_check'] == 1300
            calls[1][1].set_exception(TimeoutError('slow'))
            calls[2][1].set_result(adapters.base_snapshot())
            service.tick(False)
            assert service.runtime['b']['check_status'] == 'timeout'
            clock[0] = 1300
            service.tick(False)
            assert [key for key, _ in calls] == ['a', 'b', 'a', 'b']
            # Wall clock jumps do not alter the monotonic deadline.
            with patch('collector.service.time.time', return_value=90000):
                service.tick(False)
            assert len(calls) == 4
            clock[0] = 1400
            service.tick(False)
            assert calls[-1][0] == 'a'
    finally:
        service.close()


def test_generation_persists_and_snapshot_revision_changes(tmp_path):
    first = Service(tmp_path, seed=False)
    initial = first.request('snapshot', {})
    first.request('set_notifications', {'enabled': False})
    updated = first.request('snapshot', {})
    assert updated['revision'] > initial['revision']
    first.close()
    first.store.db.close()
    second = Service(tmp_path, seed=False)
    try:
        assert second.request('snapshot', {})['collector_generation'] > updated['collector_generation']
    finally:
        second.close()


def test_previous_completion_stays_isolated_after_new_run_exits():
    old = adapters.base_snapshot() | dict(writer_pid=10, updated_at=100, status='completed', started_at=1, finished_at=100)
    resource = {'roots': [], 'last_roots': [{'pid': 20, 'created_at': 200}]}
    state = view_state(old, resource, None, 300, 'tieba')
    assert state['run_state'] == 'unknown_end' and not state['source_current']
    reused = {'roots': [], 'last_roots': [{'pid': 10, 'created_at': 200}]}
    assert not view_state(old, reused, None, 300, 'tieba')['source_current']


def test_grok_old_statistics_do_not_become_fresh_on_successful_check():
    result = adapters.base_snapshot() | dict(updated_at=2000, statistics_at=100)
    state = view_state(result, {'roots': [{'pid': 1, 'created_at': 1}]}, None, 2001, 'grok')
    assert 'statistics_stale' in {i['code'] for i in state['issues']}
    assert state['run_state'] == 'running'


def test_msqa_missing_queue_counts_remain_unknown():
    assert all(m['value'] is None for m in normalize_msqa({})['queues'])
    assert normalize_msqa({'counts': {'jobs': {'failed': 0}}})['queues'][0]['value'] == 0


def test_ssrn_summary_change_is_activity_even_when_oldest_queue_row_is_stale():
    raw = {'ok': True, 'downloadStatuses': [{'status': 'downloaded', 'count': 12}, {'status': 'resolving', 'count': 2}]}
    previous = adapters.base_snapshot() | {'run_id': 'cumulative-ssrn-pdf', 'metrics': [adapters.metric('downloaded', 'PDF', 10)]}
    with patch('collector.sources._helper_json', side_effect=[raw, {'queue': [{'updatedAt': 1}]}]):
        result = collect_ssrn({'_previous': previous})
    assert '有变化' in result['stage']
    assert result['status'] == 'unknown'


def test_grok_partial_read_retains_value_time_but_not_across_runs():
    previous = adapters.base_snapshot() | {'run_id': 'r1', 'statistics_at': 123,
                                           'metrics': [adapters.metric('posts', '帖子', 100)]}
    for run, expected in [('r1', 100), ('r2', None)]:
        with patch('collector.grok_probe.collect_grok', return_value={'run': {'run_id': run}, 'datasets': {}, 'checked_at': 1000}):
            result = adapters.collect({'adapter': 'grok', '_previous': previous})
        assert result['metrics'][0]['value'] == expected
        if expected:
            assert result['metrics'][0]['statistics_at'] == 123
            assert result['statistics_at'] == 123 and result['cached']


def test_grok_uses_observer_cache_and_ignores_external_old_baseline(tmp_path):
    package = tmp_path / 'grokspider'
    package.mkdir()
    (package / 'config.py').write_text('from pathlib import Path\nfrom types import SimpleNamespace\ndef load_config():\n r=Path(__file__).parent.parent\n return SimpleNamespace(root_dir=r,state_db=r/"state.db")', encoding='utf-8')
    (package / 'progress.py').write_text('def collect(settings, previous, **kwargs):\n return {"datasets": previous.get("datasets",{}), "run":{"run_id":"r1"},"checked_at":200,"inspection":{"cached_fields":["datasets"],"statistics_at":previous.get("datasets",{}).get("statistics_at")}}', encoding='utf-8')
    baseline = tmp_path / 'work/grok-progress-monitor'
    baseline.mkdir(parents=True)
    (baseline / 'latest.json').write_text(json.dumps({'datasets': {'posts': {'actual': 1}}}), encoding='utf-8')
    saved = {'source': str((tmp_path / 'state.db').resolve()).casefold(),
             'fields': {'run': {'run_id': 'r1'}, 'datasets': {'posts': {'actual': 100}, 'statistics_at': 123}}}
    result = adapters.collect({'adapter': 'grok', 'project': str(tmp_path), '_previous': {'_grok_cache': saved}})
    assert result['metrics'][0]['value'] == 100 and result['statistics_at'] == 123
    other = adapters.collect({'adapter': 'grok', 'project': str(tmp_path), '_previous': {'_grok_cache': saved | {'source': 'different'}}})
    assert other['metrics'][0]['value'] is None
