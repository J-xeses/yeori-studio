# One idempotent installer/healer for every yeori-studio background service.
# Run it once by hand on a new PC; start_yeori.bat also runs it on every launch,
# so a deleted/disabled/stale task self-heals with zero manual steps.
#
#   YeoriStudio         - proxy.js(:3001) + vite(:5173). At logon, auto-restart.
#                         This is the MCP bridge origin -- must always be up.
#   YeoriMcpTunnel      - cloudflared + Edge Config sync. At logon, auto-restart.
#   YeoriTaskQueueWorker- code-task queue worker. Every 25 min.
#   YeoriStudio_AutoSync- git commit+pull+push. Hourly.
#
# After this runs, "PC is on and logged in" == "MCP connector + worker work".
# Nothing to remember, nothing to babysit. If the PC is fully powered off the
# connector is down -- that is inherent (the automation runs on this PC).
#
# ASCII-only content -- Windows PowerShell 5.1 encoding safety.

$ErrorActionPreference = 'Continue'
$APP  = 'C:\yeori-studio\app'
$NODE = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $NODE)) { $NODE = (Get-Command node -ErrorAction SilentlyContinue).Source }
$NPM  = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path $NPM))  { $NPM  = (Get-Command npm -ErrorAction SilentlyContinue).Source }

function New-SvcSettings {
    # long-running service: auto-restart forever on crash, no execution time limit
    $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew
    $s.ExecutionTimeLimit = 'PT0S'
    $s.RestartCount = 999
    $s.RestartInterval = 'PT1M'
    return $s
}
function New-JobSettings {
    New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew
}

function Get-RegisterReason($name, $wantExecute, $wantArgMatch) {
    $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $t) { return 'missing' }
    if ($t.State -eq 'Disabled') { return 'disabled' }
    $a = $t.Actions | Select-Object -First 1
    if ($wantExecute -and ($a.Execute -notlike "*$wantExecute*")) { return "stale exec ($($a.Execute))" }
    if ($wantArgMatch -and ($a.Arguments -notlike "*$wantArgMatch*")) { return "stale args ($($a.Arguments))" }
    return $null
}

# 이 PC 는 루트 폴더에 새 작업 등록 시 관리자 권한을 요구한다(표준 사용자 Access denied).
# → install-services.bat 이 UAC 승격 후 이 스크립트를 부른다. 승격 없이 실행하면
#   신규 등록만 실패하고, 이미 있는 작업 확인/시작은 그대로 동작한다.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

function Ensure-Task($name, $action, $trigger, $settings, $desc, $wantExecute, $wantArgMatch) {
    $why = Get-RegisterReason $name $wantExecute $wantArgMatch
    if (-not $why) {
        Write-Output "        [ensure-yeori-tasks] $name OK."
        return
    }
    if (-not $isAdmin) {
        Write-Output "        [ensure-yeori-tasks] $name 등록 필요($why) -- 관리자 권한 없음. install-services.bat 를 실행하세요."
        return
    }
    try {
        Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
            -Principal $principal -Description $desc -Force -ErrorAction Stop | Out-Null
        Write-Output "        [ensure-yeori-tasks] $name (re)registered -- $why"
    } catch {
        Write-Output "        [ensure-yeori-tasks] $name register FAILED: $($_.Exception.Message)"
    }
}

$atLogon = New-ScheduledTaskTrigger -AtLogOn
$every25 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 25) -RepetitionDuration (New-TimeSpan -Days 3650)
$hourly  = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)   -RepetitionDuration (New-TimeSpan -Days 3650)

Ensure-Task 'YeoriStudio' `
    (New-ScheduledTaskAction -Execute $NPM -Argument 'run studio' -WorkingDirectory $APP) `
    $atLogon (New-SvcSettings) `
    'yeori-studio proxy(:3001)+vite(:5173). MCP bridge origin. Auto-start on logon, auto-restart.' `
    'npm' 'run studio'

Ensure-Task 'YeoriMcpTunnel' `
    (New-ScheduledTaskAction -Execute $NODE -Argument 'scripts\sync-tunnel.js' -WorkingDirectory $APP) `
    $atLogon (New-SvcSettings) `
    'yeori-studio Cloudflare tunnel + Edge Config sync. Auto-start on logon, auto-restart.' `
    'node' 'sync-tunnel.js'

Ensure-Task 'YeoriTaskQueueWorker' `
    (New-ScheduledTaskAction -Execute $NODE -Argument 'scripts\task-queue-worker.js' -WorkingDirectory $APP) `
    $every25 (New-JobSettings) `
    'Run yeori-studio code-task queue worker (approved tasks) every 25 min' `
    'node' 'task-queue-worker.js'

Ensure-Task 'YeoriStudio_AutoSync' `
    (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\yeori-studio\app\git-auto-sync.ps1"') `
    $hourly (New-JobSettings) `
    'Auto git commit+pull+push for yeori-studio (hourly)' `
    'powershell' 'git-auto-sync.ps1'

# ---- start the always-on services now if nothing is serving them ------
$port3001 = @(Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue).Count -gt 0
if ($port3001) {
    Write-Output "        [ensure-yeori-tasks] :3001 already served -- YeoriStudio start skipped."
} else {
    try { Start-ScheduledTask -TaskName 'YeoriStudio' -ErrorAction Stop; Write-Output "        [ensure-yeori-tasks] YeoriStudio started." }
    catch { Write-Output "        [ensure-yeori-tasks] YeoriStudio start failed: $($_.Exception.Message)" }
}

$tunnelUp = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*sync-tunnel.js*' }).Count -gt 0
if ($tunnelUp) {
    Write-Output "        [ensure-yeori-tasks] tunnel already running -- YeoriMcpTunnel start skipped."
} else {
    try { Start-ScheduledTask -TaskName 'YeoriMcpTunnel' -ErrorAction Stop; Write-Output "        [ensure-yeori-tasks] YeoriMcpTunnel started." }
    catch { Write-Output "        [ensure-yeori-tasks] YeoriMcpTunnel start failed: $($_.Exception.Message)" }
}
