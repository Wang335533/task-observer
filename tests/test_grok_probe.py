import json
import sqlite3
import time
import sys
from unittest.mock import patch

import pytest

from collector import adapters
from collector.grok_probe import BudgetReader
from collector.store import Store


def test_lightweight_reader_reads_summary_and_never_writes(tmp_path):
    path = tmp_path / 'grok.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT)')
        db.execute('INSERT INTO metadata VALUES(?,?)', ('dataset_summary_v1', json.dumps({'posts': {'actual': 42}})))
    before = path.read_bytes()
    reader = BudgetReader(path)
    rows = reader.query('metadata', 'SELECT value FROM metadata WHERE key=?', ('dataset_summary_v1',))
    assert json.loads(rows[0][0])['posts']['actual'] == 42
    with pytest.raises(sqlite3.OperationalError):
        reader.query('write_attempt', "UPDATE metadata SET value='changed'")
    assert path.read_bytes() == before


def test_expensive_query_keeps_fast_metrics_and_enforces_whole_budget(tmp_path):
    path = tmp_path / 'grok.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE tiny(value INTEGER)')
        db.execute('INSERT INTO tiny VALUES(42)')
    reader = BudgetReader(path, seconds=.01)
    assert reader.query('metadata', 'SELECT * FROM tiny') == [(42,)]
    started = time.monotonic()
    assert reader.query('queue', 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n') is None
    assert time.monotonic() - started < 1
    assert reader.errors[0]['field'] == 'queue'
    with patch('collector.grok_probe.time.monotonic', return_value=reader.deadline + 1):
        assert reader.query('later', 'SELECT * FROM tiny') is None
    assert reader.errors[-1]['error'] == 'MONITOR_BUDGET_EXHAUSTED'


def test_snapshot_survives_restart_with_original_time_and_rule_isolation(tmp_path):
    store = Store(tmp_path, seed=False)
    task = dict(id='t', project=str(tmp_path), interval=300)
    snapshot = adapters.base_snapshot() | {'statistics_at': 123, 'updated_at': 130,
        'metrics': [{'key': 'posts', 'label': '帖子', 'value': 42, 'unit': ''}]}
    store.save_snapshot(task, snapshot)
    store.db.close()
    second = Store(tmp_path, seed=False)
    restored = second.load_snapshot(task)
    assert restored['statistics_at'] == 123 and restored['updated_at'] == 130
    assert restored['cached'] and restored['metrics'][0]['value'] == 42
    assert second.load_snapshot(task | {'project': str(tmp_path / 'other')}) is None


def test_unchanged_running_state_does_not_write(tmp_path):
    store = Store(tmp_path, seed=False)
    store.record_run('t', '10:100', 100, 'running')
    changes = store.db.total_changes
    store.record_run('t', '10:100', 100, 'running')
    assert store.db.total_changes == changes
    store.record_run('t', '10:100', 100, 'unknown_end', 200)
    assert store.query('SELECT status,ended FROM runs') == [{'status': 'unknown_end', 'ended': 200}]


def test_projects_are_isolated_and_no_interpreter_or_bytecode_is_created(tmp_path):
    original_path = list(sys.path)
    for count in (42, 84):
        root = tmp_path / str(count)
        package = root / 'grokspider'
        package.mkdir(parents=True)
        (package / '__init__.py').write_text("raise AssertionError('Do not execute package startup')", encoding='utf-8')
        (package / 'config.py').write_text('from pathlib import Path\nfrom types import SimpleNamespace\ndef load_config():\n    root=Path(__file__).parent.parent\n    return SimpleNamespace(root_dir=root,state_db=root/"state.db")\n', encoding='utf-8')
        (package / 'progress.py').write_text('def collect(settings, previous, *, processes, reader):\n    assert processes is None\n    assert reader.seconds == .35\n    return {"datasets":{"posts":{"actual":' + str(count) + '}},"inspection":{"statistics_at":123},"checked_at":130}\n', encoding='utf-8')
        with patch('subprocess.Popen', side_effect=AssertionError('No external process')):
            result = adapters.collect({'adapter': 'grok', 'project': str(root)})
        assert result['metrics'][0]['value'] == count
        assert result['statistics_at'] == 123
        assert not list(root.rglob('*.pyc'))
        assert sys.path == original_path
