@echo off
title Yeori Studio
cd /d "%~dp0"

set ACC_HTML=%~dp0a_creative_cutter.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

echo.
echo ============================================================
echo   Yeori Studio -- Full System Start
echo ============================================================
echo.

:: [1/4] Chrome remote debugging (port 9222)
echo [1/4] Checking Chrome remote debugging port 9222...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 (
    echo        Already running -- skip
    set CHROME_STATUS=Already running (skipped)
) else (
    echo        Starting Chrome...
    start "" %CHROME% ^
        --remote-debugging-port=9222 ^
        --user-data-dir=C:\yeori-studio\.chrome-profile-flow ^
        "https://labs.google/fx/ko/tools/flow"
    timeout /t 3 /nobreak >nul
    set CHROME_STATUS=Started
)

:: [2/4] A Creative Cutter HTML
echo [2/4] Opening A Creative Cutter...
if exist "%ACC_HTML%" (
    start "" %CHROME% ^
        --remote-debugging-port=9222 ^
        --user-data-dir=C:\yeori-studio\.chrome-profile-flow ^
        "%ACC_HTML%"
    set ACC_STATUS=Ready
) else (
    echo        a_creative_cutter.html not found -- skip
    set ACC_STATUS=File not found (skipped)
)

:: [3/4] Proxy server + Vite dev server
echo [3/4] Starting proxy server + Vite...
start "Yeori-Studio-Server" cmd /k "npm run studio"

echo        Waiting 5 seconds for server init...
timeout /t 5 /nobreak >nul

:: [4/4] Open studio web app in Edge
echo [4/4] Opening studio web app in Edge...
start "" %EDGE% "http://localhost:5173"

:: Done
echo.
echo ============================================================
echo   READY
echo ============================================================
echo   [v] Chrome (Flow)          -- %CHROME_STATUS%
echo   [v] A Creative Cutter     -- %ACC_STATUS%
echo   [v] Proxy server  (3001)  -- Ready
echo   [v] Studio web app (5173) -- Ready
echo ============================================================
echo.
echo   Web app : http://localhost:5173
echo   Proxy   : http://localhost:3001/api/health
echo.
pause