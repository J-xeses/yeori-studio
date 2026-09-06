# Idempotent check: register the "run the code-task queue worker every 25 min"
# Task Scheduler job on THIS machine if it's missing or disabled. Called every
# time start_yeori.bat runs, so a fresh machine (or a task the user deleted /
# that got disabled) self-heals with zero manual setup -- same pattern as
# ensure-auto-sync-task.ps1.
#
# The worker itself (scripts/task-queue-worker.js) is run-once: it processes any
# status:"approved" tasks in downloads/state/code-task-queue.json then exits.
# The 25-min scheduled trigger is what makes it recurring. start_yeori.bat also
# fires it once at startup.
#
# ASCII-only content on purpose -- Windows PowerShell 5.1 encoding safety.

$TaskName = "YeoriTaskQueueWorker"
$NodeArg  = "C:\yeori-studio\app\scripts\task-queue-worker.js"
$WorkDir  = "C:\yeori-studio\app"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

$needsRegister = $false
if (-not $existing) {
    $needsRegister = $true
    $why = "missing"
} elseif ($existing.State -eq 'Disabled') {
    $needsRegister = $true
    $why = "disabled"
} else {
    # verify the action still points at the current worker path (survives the
    # 2026-09-02 downloads reorg etc.)
    $act = $existing.Actions | Select-Object -First 1
    if ($act.Arguments -notlike "*task-queue-worker.js*" -or $act.Execute -notlike "*node*") {
        $needsRegister = $true
        $why = "stale action ($($act.Execute) $($act.Arguments))"
    }
}

if (-not $needsRegister) {
    $info = $existing | Get-ScheduledTaskInfo
    Write-Output "        [ensure-worker-task] OK -- last run $($info.LastRunTime) result 0x$('{0:X}' -f $info.LastTaskResult), next $($info.NextRunTime)."
    return
}

$action = New-ScheduledTaskAction -Execute 'node' -Argument $NodeArg -WorkingDirectory $WorkDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 25) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Run yeori-studio code-task queue worker (approved tasks) every 25 min" -Force | Out-Null

Write-Output "        [ensure-worker-task] (Re)registered on this PC -- reason: $why. Runs every 25 min from now."
