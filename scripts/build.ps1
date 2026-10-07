param([switch]$SkipCollector)
. "$PSScriptRoot\environment.ps1"
Set-Location -LiteralPath $projectRoot
$portableTools = Join-Path $observerRoot 'toolchains\BuildTools\Common7\Tools\VsDevCmd.bat'
if (Test-Path -LiteralPath $portableTools) {
    [void][IO.Directory]::CreateDirectory((Join-Path $projectRoot 'build'))
    $bootstrap = Join-Path $projectRoot 'build\windows-env.cmd'
    @('@echo off', '@chcp 65001 >nul', "call `"$portableTools`" -arch=x64 -host_arch=x64", 'if errorlevel 1 exit /b 1', 'set') | Set-Content -LiteralPath $bootstrap -Encoding utf8NoBOM
    $environment = & cmd.exe /d /c $bootstrap
    if ($LASTEXITCODE -ne 0) { throw 'C++ 编译环境初始化失败' }
    foreach ($line in $environment) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
    }
} else {
    $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw '请安装 Microsoft C++ Build Tools。' }
    $found = & $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $found) { throw '未找到 C++ 编译工具；请先完成说明中的 Build Tools 安装。' }
}
if (-not (Test-Path '.venv\Scripts\python.exe')) { python -m venv .venv }
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Python 环境创建失败' }
if (-not $SkipCollector) {
    & '.\.venv\Scripts\python.exe' -m pip install -r collector/requirements-build.txt --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) { throw 'Python 依赖安装失败' }
    & '.\.venv\Scripts\python.exe' -m PyInstaller --noconfirm --onefile --console --name task-observer-collector --paths . --distpath src-tauri/binaries --workpath build/collector --specpath build collector/main.py
    if ($LASTEXITCODE -ne 0) { throw '采集器打包失败' }
    Copy-Item -LiteralPath 'src-tauri\binaries\task-observer-collector.exe' -Destination 'src-tauri\binaries\task-observer-collector-x86_64-pc-windows-msvc.exe' -Force
}
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败' }
npm run package -- --ci
if ($LASTEXITCODE -ne 0) { throw '桌面安装包构建失败' }
$releaseRoot = if ((Split-Path $observerRoot -Leaf) -eq 'windows version') { Join-Path (Split-Path $observerRoot -Parent) 'releases' } else { Join-Path $projectRoot 'build\artifacts' }
New-Item -ItemType Directory -Force $releaseRoot | Out-Null
Get-ChildItem 'src-tauri\target\release\bundle\nsis\*.exe' | Copy-Item -Destination $releaseRoot -Force
