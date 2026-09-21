from concurrent.futures import Future
from unittest.mock import Mock, patch

from collector import adapters
from collector.model import REFRESH_SECONDS
from collector.service import Service, view_state
from collector.store import Store


def test_existing_intervals_migrate_without_losing_rules(tmp_path):
    store = Store(tmp_path, seed=False)
    task = dict(id='t', interval=30, name='Existing', entry='worker.py', adapter='json')
    store.save_task(task)
    store.db.close()
    migrated = Store(tmp_path, seed=False)
    assert migrated.tasks() == [task | {'interval': 300}]
    migrated.db.close()


def test_completion_does_not_rescan_resample_or_wait_for_next_cycle(tmp_path):
    service = Service(tmp_path, seed=False)
    service.pool.shutdown(wait=True)
    futures = []
    def submit(*args):
        future = Future()
        futures.append(future)
        return future
    service.pool = Mock(submit=Mock(side_effect=submit))
    service.store.save_task(dict(id='t', name='Task', adapter='json', interval=300))
    service.sampler = Mock(inventory=Mock(return_value=[]), collect=Mock(return_value={'roots': []}))
    try:
        with patch('collector.service.time.time', return_value=1000), patch('collector.service.time.monotonic', return_value=1000):
            service.tick()
        assert len(futures) == 1
        # A slow adapter cannot overlap, even if another regular cycle becomes due.
        with patch('collector.service.time.time', return_value=1300), patch('collector.service.time.monotonic', return_value=1300):
            service.tick()
        assert len(futures) == 1
        futures[0].set_result(adapters.base_snapshot() | {'stage': 'New result'})
        assert service.wake.is_set()
        with patch('collector.service.time.time', return_value=1301), patch('collector.service.time.monotonic', return_value=1301):
            assert service.tick(sample_resources=False)
        assert service.task_views()[0]['snapshot']['stage'] == 'New result'
        assert service.last_scan == 1300
        assert service.sampler.inventory.call_count == 2
        assert len(service.store.query('SELECT * FROM samples')) == 2
        with patch('collector.service.time.time', return_value=1600), patch('collector.service.time.monotonic', return_value=1600):
            service.tick()
        assert len(futures) == 2
    finally:
        service.close()


def test_monotonic_five_minute_cadence_and_no_catchup_burst(tmp_path):
    service = Service(tmp_path, seed=False)
    clock = [0]
    samples = []
    wakes = iter([1, 299, 300, 3600])  # completion wakeups, then machine sleep
    def wait(timeout):
        try:
            clock[0] = next(wakes)
        except StopIteration:
            service.stop.set()
    service.wake = Mock(wait=Mock(side_effect=wait))
    service.tick = lambda sample_resources: samples.append((clock[0], sample_resources)) or False
    try:
        with patch('collector.service.time.monotonic', side_effect=lambda: clock[0]):
            service.loop()
        assert [t for t, sampled in samples if sampled] == [0, REFRESH_SECONDS, 3600]
        assert [t for t, sampled in samples if not sampled] == [1, 299]
    finally:
        service.close()


def test_five_minute_snapshot_is_not_falsely_stale():
    snapshot = adapters.base_snapshot() | {'updated_at': 1000, 'heartbeat_at': 1000}
    roots = {'roots': [{'pid': 1, 'created_at': 1}]}
    assert view_state(snapshot, roots, None, 1301, 'json')['issues'] == []
    stale = view_state(snapshot, roots, None, 1901, 'json')
    assert {i['code'] for i in stale['issues']} == {'stale', 'heartbeat'}
    assert stale['run_state'] == 'running'


def test_edit_during_pending_read_schedules_fresh_read(tmp_path):
    service = Service(tmp_path, seed=False)
    task = dict(id='t', name='Task', adapter='process', match_kind='script',
                project=str(tmp_path), entry='worker.py', interval=300)
    service.store.save_task(task)
    old_read = Future()
    service.pending['t'] = (old_read, 0)
    service.request('save_task', {'task': task})
    service.rescan.clear()
    service.wake.clear()
    old_read.set_result(adapters.base_snapshot() | {'stage': 'Must not show'})
    try:
        service.tick(sample_resources=False)
        assert not service.rescan.is_set() and service.wake.is_set()
        assert 't' in service.pending  # Immediate replacement, no global recheck.
        assert service.task_views()[0]['snapshot']['stage'] != 'Must not show'
    finally:
        service.close()
