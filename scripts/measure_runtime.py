"""Measure only the installed observer and its descendants; read-only."""
import json
import time
from pathlib import Path

import psutil

expected = str(Path(__file__).resolve().parents[2] / 'desktop' / 'task-observer.exe').casefold()
root = next(p for p in psutil.process_iter(['exe']) if (p.info['exe'] or '').casefold() == expected)
handles = {p.pid: p for p in [root, *root.children(recursive=True)]}
for p in handles.values():
    try: p.cpu_percent()
    except psutil.Error: pass
samples = []
for _ in range(5):
    time.sleep(3)
    values = []
    for p in [root, *root.children(recursive=True)]:
        try:
            old = handles.get(p.pid)
            if old is None or abs(old.create_time() - p.create_time()) > .01:
                handles[p.pid] = p
                p.cpu_percent()
                old = p
            values.append({'name': old.name(), 'pid': old.pid, 'cpu_percent': old.cpu_percent() / (psutil.cpu_count() or 1), 'rss_mb': old.memory_info().rss / 1048576})
        except psutil.Error:
            pass
    samples.append({'at': time.time(), 'cpu_percent': round(sum(v['cpu_percent'] for v in values), 3),
                    'rss_mb': round(sum(v['rss_mb'] for v in values), 1), 'processes': values})
report = {'duration_seconds': 15, 'scope': 'installed desktop app and descendants including WebView2; summed RSS may double-count shared pages',
          'cpu_mean_percent': round(sum(s['cpu_percent'] for s in samples) / len(samples), 3),
          'rss_max_mb': max(s['rss_mb'] for s in samples), 'samples': samples}
destination = Path(__file__).resolve().parents[2] / 'outputs' / '运行资源采样.json'
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'samples'}, ensure_ascii=False))
