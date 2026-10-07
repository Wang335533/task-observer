#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/tools/node-current/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
export CARGO_BUILD_JOBS=3
test "$(uname -s)" = Darwin
test "$(uname -m)" = arm64
python3 -m venv .venv
.venv/bin/python3 -m pip install -r collector/requirements-build.txt --disable-pip-version-check
.venv/bin/python3 -m PyInstaller --noconfirm --onefile --console --name task-observer-collector --paths . --distpath src-tauri/binaries --workpath build/collector --specpath build collector/main.py
cp src-tauri/binaries/task-observer-collector src-tauri/binaries/task-observer-collector-aarch64-apple-darwin
npm ci --no-audit --no-fund
npm run package -- --ci --target aarch64-apple-darwin
.venv/bin/python3 scripts/package_macos.py
TASK_OBSERVER_COLLECTOR_BINARY="$PWD/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/任务观测台.app/Contents/MacOS/task-observer-collector" .venv/bin/python3 scripts/smoke_collector.py
