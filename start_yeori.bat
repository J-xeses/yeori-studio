@echo off
title Yeori Studio
cd /d "%~dp0"

set ACC_HTML=%~dp0a_creative_cutter.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE=C:\yeori-studio\.chrome-profile-flow

echo.
echo ============================================================
echo   Yeori Studio -- Full System Start
echo ============================================================
echo.

set SRC=C:\yeori-studio
set DST=C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio

:: [pre] 콘텐츠 동기화 (집 PC: 다운로드 / 회사 PC: 업로드)
call "%~dp0sync-content.bat"

:: [0/3] Sync code files: C:\yeori-studio -> OneDrive 실행 경로
echo [0/3] Syncing code files to run directory...
robocopy "%SRC%\src"     "%DST%\src"     /E /XO /NFL /NDL /NJH /NJS >nul 2>&1
robocopy "%SRC%\scripts" "%DST%\scripts" /E /XO /NFL /NDL /NJH /NJS >nul 2>&1
copy /Y "%SRC%\server\proxy.js" "%DST%\server\proxy.js" >nul 2>&1
echo        Sync complete.

:: [0/3] Kill any leftover proxy process on port 3001
echo [0/3] Killing any existing proxy on port 3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: [1/3] Proxy + Vite dev server
echo [1/3] Starting proxy + Vite dev server...
start "Yeori-Studio-Server" cmd /k "npm run studio"
echo        Waiting 5 seconds for server init...
timeout /t 5 /nobreak >nul

:: [2/3] Chrome tabs
echo [2/3] Opening Chrome tabs...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 goto :chrome_exists

:: Chrome not running -- launch new maximized window with Flow tab first
echo        Chrome not running -- launching new window...
start "" %CHROME% --remote-debugging-port=9222 --user-data-dir=%PROFILE% --start-maximized "https://labs.google/fx/ko/tools/flow"
timeout /t 3 /nobreak >nul
goto :open_remaining_tabs

:chrome_exists
:: Chrome already running -- add Flow tab to existing window
echo        Chrome already running -- adding tabs...
start "" %CHROME% --user-data-dir=%PROFILE% "https://labs.google/fx/ko/tools/flow"
timeout /t 1 /nobreak >nul

:open_remaining_tabs
:: Tab 2: A Creative Cutter
if exist "%ACC_HTML%" (
    start "" %CHROME% --user-data-dir=%PROFILE% "%ACC_HTML%"
    timeout /t 1 /nobreak >nul
) else (
    echo        a_creative_cutter.html not found -- skip
)
:: Tab 3: Studio web app
start "" %CHROME% --user-data-dir=%PROFILE% "http://localhost:5173"

:: [3/3] Done
echo.
echo ============================================================
echo   READY
echo ============================================================
echo   Tab 1  Flow    : https://labs.google/fx/ko/tools/flow
echo   Tab 2  Cutter  : %ACC_HTML%
echo   Tab 3  Studio  : http://localhost:5173
echo   Health         : http://localhost:3001/api/health
echo.
pause
