from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from pathlib import Path

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collector.service import Service
from collector.model import redact


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default=os.environ.get('TASK_OBSERVER_DATA_DIR', str(Path(os.environ.get('LOCALAPPDATA', '.')) / 'TaskObserver')))
    parser.add_argument('--no-seed', action='store_true')
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
        sys.stdin.reconfigure(encoding='utf-8')
    if args.probe:
        from collector.readers import probe_main
        probe_main()
        return
    output_lock = threading.Lock()

    def emit(value):
        with output_lock:
            print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)

    service = Service(args.data_dir, emit, seed=not args.no_seed)
    service.start()
    emit({'type': 'ready', 'schema_version': 1})
    try:
        for line in sys.stdin:
            request = {}
            try:
                if len(line) > 128 * 1024:
                    raise ValueError('请求过大')
                request = json.loads(line)
                value = service.request(request['method'], request.get('params') or {})
                emit({'id': request.get('id'), 'result': value})
            except Exception as exc:
                emit({'id': request.get('id'), 'error': redact(str(exc))})
    finally:
        service.close()


if __name__ == '__main__':
    main()
