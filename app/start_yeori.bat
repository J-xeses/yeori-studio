@echo off
title Yeori Studio
cd /d "%~dp0"

set ACC_HTML=%~dp0a_creative_cutter.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE=C:\yeori-studio\app\.chrome-profile-flow

echo.
echo ============================================================
echo   Yeori Studio -- Full System Start
echo ============================================================
echo.

:: [pre-1] Git pull
echo [pre-1] Git pull...
cd /d C:\yeori-studio
git pull origin master
cd /d "%~dp0"
echo.

:: [pre-2] Sync on start (download latest from cloud)
echo [pre-2] Sync on start...
call "%~dp0sync-content.bat"
echo.

:: [0] Kill existing proxy on port 3001
echo [0] Killing existing proxy on port 3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: [1] Open Chrome tabs
echo [1] Opening Chrome tabs...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 goto :chrome_exists

echo        Chrome not running -- launching new window...
start "" %CHROME% --remote-debugging-port=9222 --user-data-dir=%PROFILE% --start-maximized "https://labs.google/fx/ko/tools/flow"
timeout /t 3 /nobreak >nul
goto :open_remaining_tabs

:chrome_exists
echo        Chrome already running -- adding tabs...
start "" %CHROME% --user-data-dir=%PROFILE% "https://labs.google/fx/ko/tools/flow"
timeout /t 1 /nobreak >nul

:open_remaining_tabs
if exist "%ACC_HTML%" (
    start "" %CHROME% --user-data-dir=%PROFILE% "%ACC_HTML%"
    timeout /t 1 /nobreak >nul
) else (
    echo        a_creative_cutter.html not found -- skip
)
start "" %CHROME% --user-data-dir=%PROFILE% "http://localhost:5173"

:: [2] Start server in foreground (blocks here until Ctrl+C)
echo.
echo ============================================================
echo   READY
echo ============================================================
echo   Tab 1  Flow   : https://labs.google/fx/ko/tools/flow
echo   Tab 2  Cutter : %ACC_HTML%
echo   Tab 3  Studio : http://localhost:5173
echo   Health        : http://localhost:3001/api/health
echo.
echo   ** Stop: Ctrl+C then N (runs shutdown sync automatically)
echo ============================================================
echo.
npm run studio

:: [3] Auto-sync on shutdown
echo.
echo ============================================================
echo   Server stopped -- running shutdown sync...
echo ============================================================
echo.
call "%~dp0sync-content.bat"
echo.
echo   Goodbye!
echo ============================================================
pause