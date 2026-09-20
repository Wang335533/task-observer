import json
import sqlite3
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from collector.model import validate_task
from collector.service import view_state
from collector.sources import collect_cnki, collect_kokusho, collect_ssrn, normalize_msqa, normalize_ssrn


def test_msqa_snapshot_metrics_identity_and_unknowns():
    raw = {'status': 'running', 'phase': 'profiles', 'pid': 42, 'started_at': 100,
           'heartbeat_at': 200, 'counts': {'posts_complete': 12, 'answers': 30, 'jobs': {'failed': 2}}}
    result = normalize_msqa(raw)
    assert [m['value'] for m in result['metrics'][:3]] == [12, 30, None]
    assert result['writer_pid'] == 42 and result['run_id'] == 100
    assert result['stage'] == '补充用户资料' and result['statistics_at'] == 200
    assert result['issues'][0]['level'] == 'attention'
    assert result['total'] is None


def make_shards(root):
    for name in ('书目', '著作', '作者'):
        folder = root / (name + '详情分片')
        folder.mkdir()
        (folder / '抓取清单.json').write_text(json.dumps({'索引ID数': 10}), encoding='utf-8')
        (folder / f'{name}详情_0000001-0000005.jsonl.gz').write_bytes(b'producer-finalized-fixture')
    return root / '书目详情分片'


def test_kokusho_counts_complete_records_and_deduplicates_ranges(tmp_path):
    folder = make_shards(tmp_path)
    (folder / '书目详情_0000001-0000005.jsonl.part').write_bytes(b'{}\n' * 5)
    (folder / '书目详情_0000006-0000010.jsonl.part').write_bytes(b'{}\n{}\n{"unfinished":')
    (folder / '书目详情_0000003-0000004.jsonl.gz').write_bytes(b'overlap')
    result = collect_kokusho({'snapshot': str(tmp_path)})
    assert [m['value'] for m in result['metrics']] == [7, 5, 5]
    assert result['status'] == 'unknown'  # Artifact counts do not imply success.
    assert result['total'] is None


def test_kokusho_missing_or_corrupt_manifest_is_not_zero(tmp_path):
    folder = make_shards(tmp_path)
    (folder / '抓取清单.json').write_text('broken', encoding='utf-8')
    with pytest.raises(json.JSONDecodeError): collect_kokusho({'snapshot': str(tmp_path)})


def test_ssrn_helper_is_not_a_running_download_and_uses_only_get_sources():
    raw = {'ok': True, 'downloadStatuses': [dict(status='downloaded', count=12),
           dict(status='pending', count=5), dict(status='resolving', count=1), dict(status='failed', count=2)]}
    with patch('collector.sources._helper_json', side_effect=[raw, {'queue': [{'updatedAt': 100}]}]) as read:
        result = collect_ssrn({'helper_port': 18765})
    assert read.call_args_list[0].args == (18765, '/pdf/summary')
    assert read.call_args_list[1].args[1] == '/pdf/queue?status=resolving&limit=1'
    assert result['metrics'][0]['value'] == 12
    state = view_state(result, {'roots': [{'pid': 10, 'created_at': 50}]}, None, time.time(), 'ssrn')
    assert state['run_state'] == 'service_online' and state['health'] == 'attention'
    assert result['status'] == 'unknown'
    assert '未确认' in result['stage']
    assert '近期有活动' in normalize_ssrn(raw, [{'updatedAt': 990}], 1000)['stage']


def test_cnki_only_reads_scope_and_current_journal_issues(tmp_path):
    path = tmp_path / 'state.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript('''
            CREATE TABLE journals(id INTEGER, title TEXT, status TEXT, in_scope INTEGER, updated_at TEXT);
            CREATE TABLE issues(journal_id INTEGER, status TEXT, fetched_count INTEGER);
            INSERT INTO journals VALUES(1,'Finished','complete',1,'2026-01-01'),(2,'Current','processing',1,'2026-01-01'),(3,'Excluded','complete',0,'2026-01-01');
            INSERT INTO issues VALUES(2,'complete',12),(2,'processing',2),(1,'complete',999);
        ''')
    before = path.read_bytes()
    result = collect_cnki({'snapshot': str(path)})
    assert [m['value'] for m in result['metrics']] == [1, 14, 1, 2]
    assert result['current'] == 'Current'
    assert path.read_bytes() == before
    # There is no articles table: accidentally scanning it would fail this test.
    assert result['run_id'] == 'cnki-journal-2'


def test_new_adapter_config_paths_and_loopback_port(tmp_path):
    task = dict(name='PDF', project=str(tmp_path), entry='helper.js', match_kind='script', adapter='ssrn')
    assert validate_task(task)['helper_port'] == 18765
    with pytest.raises(ValueError): validate_task(task | {'helper_port': 'https://example.com'})
    with pytest.raises(ValueError): validate_task(task | {'helper_port': 80})
    with pytest.raises(ValueError): validate_task(task | {'adapter': 'cnki'})
    assert validate_task(task | {'adapter': 'cnki', 'snapshot': str(tmp_path / 'state.sqlite')})['interval'] == 60
