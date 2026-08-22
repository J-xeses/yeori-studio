# Idempotent check: register the hourly git-auto-sync Task Scheduler job on
# THIS machine if it doesn't already exist. Called every time start_yeori.bat
# runs, so a fresh machine (or a task the user deleted) self-heals with zero
# manual setup -- no "remember to run this once on the new PC" step needed.
# ASCII-only for the same Windows PowerShell 5.1 encoding reason as
# git-auto-sync.ps1.

$TaskName = "YeoriStudio_AutoSync"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($existing) {
    Write-Output "        [ensure-auto-sync-task] Already registered on this PC -- skip."
} else {
    $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\yeori-studio\app\git-auto-sync.ps1"'
    $trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Auto git commit+pull+push for yeori-studio (hourly)" -Force | Out-Null
    Write-Output "        [ensure-auto-sync-task] Registered on this PC for the first time (runs hourly from now on)."
}
