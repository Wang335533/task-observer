$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$observerRoot = Split-Path $projectRoot -Parent
$localCargo = Join-Path $observerRoot 'toolchains\cargo'
if (Test-Path -LiteralPath (Join-Path $localCargo 'bin\cargo.exe')) {
    $env:RUSTUP_HOME = Join-Path $observerRoot 'toolchains\rustup'
    $env:CARGO_HOME = $localCargo
    $env:Path = "$env:CARGO_HOME\bin;$env:Path"
}
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONDONTWRITEBYTECODE = '1'
# Bounded parallelism keeps compilation from monopolizing the machine.
$env:CARGO_BUILD_JOBS = '3'
