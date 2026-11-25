param(
    [string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$taskName = 'AIct Resident Server'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not (Test-Path -LiteralPath $Python)) { throw "Python missing: $Python" }
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'resident-server.ps1') + '" -Python "' + $Python + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'AIct current-user background gateway; checks process every 10 seconds and recovers after exit. Starts at user logon.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
