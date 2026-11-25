param([string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runDir = Join-Path $projectRoot 'server\run'
New-Item -ItemType Directory -Force $runDir | Out-Null
$startLock = $null
for ($lockAttempt = 0; $lockAttempt -lt 60; $lockAttempt++) {
    try {
        $startLock = [IO.File]::Open((Join-Path $runDir 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        break
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $startLock) { throw 'Another AIct start operation is still running' }
try {
$pidPath = Join-Path $runDir 'server.pid'
$serverPath = Join-Path $projectRoot 'server\main.py'
if (Test-Path $pidPath) {
    $serverPid = [int](Get-Content -LiteralPath $pidPath)
    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
        $running = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"
        if (-not $running -or $running.Name -ne 'python.exe' -or $running.CommandLine -notlike "*$serverPath*") {
            throw "PID file points at another process ($serverPid); refusing to treat it as AICT."
        }
        Write-Output "AICT server already running: PID $serverPid"
        exit 0
    }
}
$process = Start-Process -FilePath $Python -ArgumentList @('-u', ('"' + $serverPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDir 'stdout.log') -RedirectStandardError (Join-Path $runDir 'stderr.log')
$process.Id | Set-Content -LiteralPath $pidPath
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw "AICT exited with code $($process.ExitCode); inspect server/run/stderr.log" }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:18765/health' -TimeoutSec 2
        if ($health.ok) { Write-Output "AICT server ready: PID $($process.Id). SSH port 19198."; return }
    } catch {}
    Start-Sleep -Milliseconds 500
    $process.Refresh()
}
throw 'AICT did not become healthy; inspect server/run/stderr.log'

} finally { $startLock.Dispose() }
