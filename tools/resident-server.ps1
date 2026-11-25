param(
    [string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
    [int]$PollSeconds = 10
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runDir = Join-Path $projectRoot 'server\run'
New-Item -ItemType Directory -Force $runDir | Out-Null
$lock = $null
try {
    # File handle prevents duplicate supervisors, including manual invocations.
    $lock = [IO.File]::Open((Join-Path $runDir 'resident.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch { exit 0 }
try {
    while ($true) {
        try {
            & (Join-Path $PSScriptRoot 'start-server.ps1') -Python $Python | Out-Null
        } catch {
            Add-Content -LiteralPath (Join-Path $runDir 'resident.log') -Value ("{0:o} {1}" -f [DateTimeOffset]::Now, $_.Exception.Message)
        }
        Start-Sleep -Seconds $PollSeconds
    }
} finally { $lock.Dispose() }
