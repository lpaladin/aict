param([string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runDir = Join-Path $projectRoot 'server\run'
New-Item -ItemType Directory -Force $runDir | Out-Null
$pidPath = Join-Path $runDir 'server.pid'
if (Test-Path $pidPath) {
    $serverPid = [int](Get-Content -LiteralPath $pidPath)
    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
        Write-Output "AICT server already running: PID $serverPid"
        exit 0
    }
}
$serverPath = Join-Path $projectRoot 'server\main.py'
$process = Start-Process -FilePath $Python -ArgumentList @('-u', ('"' + $serverPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDir 'stdout.log') -RedirectStandardError (Join-Path $runDir 'stderr.log')
$process.Id | Set-Content -LiteralPath $pidPath
Write-Output "AICT server started: PID $($process.Id). SSH port 19198."
