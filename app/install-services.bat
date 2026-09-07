@echo off
REM yeori-studio background services installer (run once per PC).
REM This PC requires admin to register tasks in the root folder, so UAC will prompt.
REM The registered tasks themselves run as RunLevel=Limited (normal privileges).

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting admin... click YES on the UAC dialog.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo ============================================================
echo   yeori-studio services install (admin)
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-yeori-tasks.ps1"
echo.
echo ------------------------------------------------------------
schtasks /query /tn "YeoriStudio" /fo list 2>nul | findstr /i "TaskName Status"
schtasks /query /tn "YeoriMcpTunnel" /fo list 2>nul | findstr /i "TaskName Status"
schtasks /query /tn "YeoriTaskQueueWorker" /fo list 2>nul | findstr /i "TaskName Status"
schtasks /query /tn "YeoriStudio_AutoSync" /fo list 2>nul | findstr /i "TaskName Status"
echo ------------------------------------------------------------
echo.
echo   Done. Log off then log on so everything runs under the scheduler.
echo   (Services that were not up have already been started by the script.)
echo.
pause
