"""Create a signed-App DMG without requiring Finder automation permissions."""
import json
import platform
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
assert platform.system() == 'Darwin' and platform.machine() == 'arm64'
version = json.loads((root / 'package.json').read_text())['version']
bundle = root / 'src-tauri/target/aarch64-apple-darwin/release/bundle'
app = bundle / 'macos/任务观测台.app'
stage = root / 'build/dmg-layout'
stage.mkdir(parents=True, exist_ok=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
subprocess.run(['ditto', str(app), str(stage / app.name)], check=True)
applications = stage / 'Applications'
if not applications.is_symlink():
    applications.symlink_to('/Applications', target_is_directory=True)
image = bundle / 'dmg' / f'任务观测台_{version}_aarch64.dmg'
image.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['hdiutil', 'create', '-volname', '任务观测台', '-srcfolder',
                str(stage), '-format', 'UDZO', str(image)], check=True)
subprocess.run(['hdiutil', 'verify', str(image)], check=True)
print(image)
