import pytest

from collector.store import Store
from collector.service import Service


def test_cycle_commits_once_and_rolls_back_on_error(tmp_path):
    store = Store(tmp_path, seed=False)
    statements = []
    store.db.set_trace_callback(statements.append)
    with store.batch():
        store.event('task', 'one')
        store.sample('task', {}, [])
        store.sync_alerts('task', [])
    assert statements.count('COMMIT') == 1
    with pytest.raises(RuntimeError), store.batch():
        store.event('task', 'rolled back')
        raise RuntimeError('disk error simulation')
    assert len(store.query('SELECT * FROM events')) == 1
    store.event('task', 'after rollback')
    assert len(store.query('SELECT * FROM events')) == 2


def test_detail_reads_only_selected_data_and_keeps_metrics_on_disk(tmp_path):
    service = Service(tmp_path, seed=False)
    service.store.save_task({'id': 'task'})
    service.store.sample('task', {'cpu_percent': 1, 'memory_bytes': 2048}, [{'key': 'posts', 'value': 7}])
    service.store.record_run('task', '1:2', 2, 'running')
    statements = []
    service.store.db.set_trace_callback(statements.append)
    resource = service.request('detail', {'task_id': 'task', 'section': 'resources'})
    assert len(resource['samples']) == 1 and resource['history'] == []
    assert 'metrics' not in resource['samples'][0]
    assert not any('FROM runs' in sql for sql in statements)
    statements.clear()
    history = service.request('detail', {'task_id': 'task', 'section': 'history'})
    assert len(history['history']) == 1 and history['samples'] == []
    assert not any('FROM samples' in sql for sql in statements)
    assert 'posts' in service.store.query('SELECT metrics FROM samples')[0]['metrics']
    service.close()


def test_recovered_process_is_not_reported_as_new_start(tmp_path):
    store = Store(tmp_path, seed=False)
    store.record_run('task', '1:2', 2, 'running')
    store.close_interrupted_observations()
    store.record_run('task', '1:2', 2, 'running')
    events = store.query('SELECT message FROM events ORDER BY id')
    assert events[-1]['message'] == '恢复观察，任务仍在运行'
    assert len(store.query('SELECT * FROM runs')) == 1
