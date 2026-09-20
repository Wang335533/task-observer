"""Exercise the packaged stdio protocol with isolated, controlled fixtures."""
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

root = Path(__file__).resolve().parents[1]
folder = root.parent / 'work' / ('packaged-smoke-' + str(int(time.time())))
folder.mkdir(parents=True)
snapshot = folder / 'progress.json'
process = subprocess.Popen([str(root / 'src-tauri/binaries/task-observer-collector.exe'), '--data-dir', str(folder / 'data'), '--no-seed'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
responses = queue.Queue()
threading.Thread(target=lambda: [responses.put(json.loads(line)) for line in process.stdout], daemon=True).start()
sequence = 0
events = []

def request(method, params=None):
    global sequence
    sequence += 1
    process.stdin.write(json.dumps(dict(id=sequence, method=method, params=params or {})) + '\n')
    process.stdin.flush()
    deadline = time.time() + 15
    while time.time() < deadline:
        message = responses.get(timeout=max(.1, deadline - time.time()))
        if message.get('id') == sequence:
            assert 'error' not in message, message
            return message['result']
        events.append(message)
    raise TimeoutError(method)

try:
    assert request('snapshot')['tasks'] == []
    task = request('save_task', {'task': dict(name='隔离协议测试', adapter='json', project=str(folder), match_kind='script',
        entry=str(folder / 'not-running.py'), snapshot=str(snapshot), logs='', python='', subcommands=[])})
    snapshot.write_text(json.dumps(dict(schema_version=1, task_id=task['id'], run_id='test-1', status='needs_attention', stage='测试阶段',
        updated_at=time.time(), metrics=[dict(key='items', label='数量', value=42)], message='隔离测试提醒')), encoding='utf-8')
    request('save_task', {'task': task})
    deadline = time.time() + 20
    while time.time() < deadline:
        state = request('snapshot')
        if state['tasks'][0]['snapshot']['metrics']:
            break
        time.sleep(.5)
    assert state['tasks'][0]['snapshot']['metrics'][0]['value'] == 42
    assert state['tasks'][0]['resource']['roots'] == []
    assert len(state['alerts']) == 1
    assert any(e.get('type') == 'notification' for e in events)
    request('acknowledge', {'id': state['alerts'][0]['id']})
    assert request('snapshot')['alerts'][0]['acknowledged'] == 1
    result = dict(ok=True, task_count=1, metrics=42, notification_event=True, exit='graceful', fixture_directory=str(folder))
finally:
    process.stdin.close()
    process.wait(timeout=50)
    assert process.returncode == 0, process.stderr.read()
print(json.dumps(result, ensure_ascii=False))
