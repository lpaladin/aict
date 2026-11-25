param(
    [Parameter(Mandatory=$true)][int]$ExpectedPid,
    [Parameter(Mandatory=$true)][string]$OperationId,
    [int]$DelaySeconds = 4,
    [string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if ($OperationId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid operation ID' }
$statePath = Join-Path $projectRoot "server\run\restart-$OperationId.json"
function Write-State([string]$State, [string]$Message) {
    @{operationId=$OperationId;state=$State;message=$Message;expectedPid=$ExpectedPid;updatedAt=[DateTimeOffset]::UtcNow.ToString('o')} |
        ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
try {
    Write-State 'scheduled' 'Independent restart worker started'
    Start-Sleep -Seconds $DelaySeconds
    $service = Get-CimInstance Win32_Process -Filter "ProcessId=$ExpectedPid"
    $expectedScript = Join-Path $projectRoot 'server\main.py'
    if (-not $service -or $service.Name -ne 'python.exe' -or $service.CommandLine -notlike "*$expectedScript*") {
        throw 'Recorded PID is no longer the expected AICT service; refusing to stop it'
    }
    Write-State 'restarting' 'Verified AICT process; stopping service'
    # This worker is launched by the gateway, outside Codex shell execution jobs.
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ExpectedPid")
    foreach ($child in $children) {
        if ($child.Name -eq 'codex.exe' -and $child.CommandLine -like '*app-server*stdio*') {
            Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Id $ExpectedPid -ErrorAction Stop
    Wait-Process -Id $ExpectedPid -Timeout 10 -ErrorAction SilentlyContinue
    & (Join-Path $PSScriptRoot 'start-server.ps1') -Python $Python
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:18765/health' -TimeoutSec 2
            if ($health.ok) { $ready = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Replacement service did not become healthy; inspect server/run/stderr.log' }
    $newPid = [int](Get-Content -LiteralPath (Join-Path $projectRoot 'server\run\server.pid'))
    if ($newPid -eq $ExpectedPid) { throw 'Service PID did not change' }
    Write-State 'completed' "AICT is healthy; new PID $newPid"
} catch {
    Write-State 'failed' $_.Exception.Message
    throw
}
