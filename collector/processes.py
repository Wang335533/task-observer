from __future__ import annotations

import os
from pathlib import Path
import psutil


def normalized(path):
    return os.path.normcase(os.path.abspath(path)).casefold()


def matches(task, proc):
    """Match interpreter entry points, never arbitrary command substrings."""
    args = proc.get('cmdline') or []
    cwd = proc.get('cwd')
    if len(args) < 2:
        return False
    executable = Path(args[0]).name.lower()
    allowed = ('python', 'pypy', 'node', 'rscript', 'stata')
    if not executable.startswith(allowed):
        return False
    if task['match_kind'] == 'module':
        if '-m' not in args or '-c' in args:
            return False
        pos = args.index('-m')
        if pos + 1 >= len(args) or args[pos + 1] != task['entry']:
            return False
        if not cwd or normalized(cwd) != normalized(task['project']):
            return False
        commands = task.get('subcommands') or []
        return not commands or (pos + 2 < len(args) and args[pos + 2] in commands)
    # Interpreter flags can have arguments; only accept a real existing script token,
    # and never classify -c / -m / -e evaluation sessions as script launches.
    if any(flag in args[1:] for flag in ('-c', '-m', '-e', '--eval')):
        return False
    target = normalized(task['entry'])
    for token in args[1:]:
        if token.startswith('-'):
            continue
        if Path(token).suffix.lower() not in ('.py', '.pyw', '.js', '.mjs', '.cjs', '.r', '.do'):
            continue
        if not Path(token).is_absolute() and not cwd:
            return False
        candidate = token if Path(token).is_absolute() else str(Path(cwd) / token)
        return normalized(candidate) == target
    return False


class ProcessSampler:
    def __init__(self):
        self.handles = {}
        self.status = {'denied': 0, 'available': True}

    def inventory(self, tasks=None):
        items = []
        denied = 0
        prefixes = set()
        for task in tasks or []:
            suffix = Path(task['entry']).suffix.lower()
            if task['match_kind'] == 'module' or suffix in ('.py', '.pyw'):
                prefixes.update(('python', 'pypy'))
            elif suffix in ('.js', '.mjs', '.cjs'):
                prefixes.add('node')
            elif suffix == '.r':
                prefixes.add('rscript')
            elif suffix == '.do':
                prefixes.add('stata')
        candidates = tuple(prefixes) if tasks is not None else ('python', 'pypy', 'node', 'rscript', 'stata')
        for process in psutil.process_iter(['pid', 'ppid', 'name', 'create_time']):
            try:
                info = dict(process.info)
                # Only inspect command lines of candidate interpreters.
                if info['name'].lower().startswith(candidates):
                    try:
                        info['cmdline'] = process.cmdline()
                        info['cwd'] = process.cwd()
                    except psutil.AccessDenied:
                        denied += 1
                items.append(info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        self.status = {'denied': denied, 'available': True}
        return items

    def collect(self, task, items):
        roots = [p for p in items if matches(task, p)]
        ids = {p['pid'] for p in roots}
        root_by_pid = {p['pid']: p for p in roots}
        selected = {p['pid']: p for p in roots}
        changed = True
        while changed:
            changed = False
            for p in items:
                parent = selected.get(p.get('ppid'))
                if p['pid'] not in ids and parent and p['create_time'] >= parent['create_time']:
                    ids.add(p['pid'])
                    selected[p['pid']] = p
                    changed = True
        cpu = memory = 0
        readable = 0
        for p in selected.values():
            key = (p['pid'], p['create_time'])
            try:
                handle = self.handles.get(key)
                if handle is None:
                    handle = psutil.Process(p['pid'])
                    if abs(handle.create_time() - p['create_time']) > .01:
                        continue
                    handle.cpu_percent()
                    self.handles[key] = handle
                cpu += handle.cpu_percent() / (psutil.cpu_count() or 1)
                memory += handle.memory_info().rss
                readable += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        alive = {(p['pid'], p['create_time']) for p in items}
        self.handles = {key: handle for key, handle in self.handles.items() if key in alive}
        # Parent and child invoking same entry are one process tree, not two runs.
        roots = [p for p in roots if p.get('ppid') not in root_by_pid]
        return {'roots': [{'pid': p['pid'], 'created_at': p['create_time'],
                           'identity': f"{p['pid']}:{p['create_time']:.4f}"} for p in roots],
                'process_count': len(selected), 'cpu_percent': round(cpu, 2) if readable else None,
                'memory_bytes': memory if readable else None}
