from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
REFRESH_SECONDS = 300
STALE_SECONDS = REFRESH_SECONDS * 3


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def timestamp(value):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except ValueError:
            pass
    return None


def finite(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def default_tasks():
    # Watch rules belong to the user, never to the distributed source tree.
    return []


def validate_task(value):
    result = dict(value)
    for key in ('name', 'project', 'entry'):
        if not isinstance(result.get(key), str) or not result[key].strip():
            raise ValueError(f'请填写 {key}')
        result[key] = result[key].strip()
    if not Path(result['project']).is_absolute():
        raise ValueError('项目位置必须是绝对路径')
    if result.get('adapter') not in ('grok', 'tieba', 'json', 'process', 'msqa', 'kokusho', 'ssrn', 'cnki'):
        raise ValueError('未知的进度来源')
    if result.get('match_kind') not in ('script', 'module'):
        raise ValueError('请选择脚本或模块识别方式')
    if result['match_kind'] == 'module':
        if not re.fullmatch(r'[A-Za-z_][\w.]*(?<!\.)', result['entry']):
            raise ValueError('模块名格式不正确')
    elif not Path(result['entry']).is_absolute():
        result['entry'] = str(Path(result['project']) / result['entry'])
    for key in ('snapshot', 'logs', 'python'):
        result[key] = str(result.get(key, '')).strip()
        if result[key] and not Path(result[key]).is_absolute():
            raise ValueError(f'{key} 必须使用绝对路径')
    if result['adapter'] in ('json', 'tieba', 'msqa', 'kokusho', 'cnki') and not result['snapshot']:
        raise ValueError('请指定进度文件或分片目录')
    commands = result.get('subcommands', [])
    if not isinstance(commands, list) or any(not isinstance(s, str) or not re.fullmatch(r'[\w-]+', s) for s in commands):
        raise ValueError('子命令请用英文逗号分隔，只包含字母、数字、下划线或连字符')
    result['interval'] = REFRESH_SECONDS
    if result['adapter'] == 'ssrn':
        port = result.get('helper_port', 18765)
        if not isinstance(port, int) or isinstance(port, bool) or not 1024 <= port <= 65535:
            raise ValueError('本地助手端口必须在 1024～65535 之间')
        result['helper_port'] = port
    result['description'] = str(result.get('description', ''))[:200]
    return result


def redact(text):
    text = re.sub(r'''(?i)((?:authorization|cookie|token|api[_-]?key|password|secret)["']?\s*[=:]\s*["']?)([^\s,;"']+)''', r'\1[已隐藏]', str(text))
    text = re.sub(r'(?i)Bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [已隐藏]', text)
    return text
