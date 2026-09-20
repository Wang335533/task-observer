"""Create a source-only archive without machine data, credentials or dependencies."""
from pathlib import Path
import json
import subprocess
import zipfile

project = Path(__file__).resolve().parents[1]
version = json.loads((project / 'package.json').read_text(encoding='utf-8'))['version']
output = project.parent / 'outputs' / f'任务观测台-{version}-源码.zip'
output.parent.mkdir(parents=True, exist_ok=True)
# Use only reviewed, tracked files. An exclusion list alone can leak new local data.
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=project).decode('utf-8').split('\0')
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in tracked:
        if not name:
            continue
        relative = Path(name)
        path = project / relative
        archive.write(path, Path('task-observer') / relative)
print(f'{output} ({output.stat().st_size:,} bytes)')
