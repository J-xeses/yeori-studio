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

:: [1/3] Proxy server + Vite dev server
echo [1/3] Starting proxy + Vite dev server...
start "Yeori-Studio-Server" cmd /k "npm run studio"
echo        Waiting 5 seconds for server init...
timeout /t 5 /nobreak >nul

:: [2/3] Chrome -- single window, all tabs
echo [2/3] Opening Chrome tabs...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 (
    echo        Chrome already running -- adding tabs to existing window
    start "" %CHROME% --user-data-dir=%PROFILE% "https://labs.google/fx/ko/tools/flow"
    timeout /t 1 /nobreak >nul
    if exist "%ACC_HTML%" (
        start "" %CHROME% --user-data-dir=%PROFILE% "%ACC_HTML%"
        timeout /t 1 /nobreak >nul
    ) else (
        echo        a_creative_cutter.html not found -- skip
    )
    start "" %CHROME% --user-data-dir=%PROFILE% "http://localhost:5173"
    set CHROME_STATUS=New tabs added to existing window
) else (
    echo        Launching Chrome with 3 tabs (maximized)...
    if exist "%ACC_HTML%" (
        start "" %CHROME% --remote-debugging-port=9222 --user-data-dir=%PROFILE% --start-maximized "https://labs.google/fx/ko/tools/flow" "%ACC_HTML%" "http://localhost:5173"
    ) else (
        start "" %CHROME% --remote-debugging-port=9222 --user-data-dir=%PROFILE% --start-maximized "https://labs.google/fx/ko/tools/flow" "http://localhost:5173"
    )
    set CHROME_STATUS=Started with 3 tabs (maximized)
)

:: [3/3] Done
echo.
echo ============================================================
echo   READY
echo ============================================================
echo   [v] Proxy server  (3001)  -- Started
echo   [v] Studio app    (5173)  -- Started
echo   [v] Chrome        (9222)  -- %CHROME_STATUS%
echo ============================================================
echo.
echo   Tab 1  Flow    : https://labs.google/fx/ko/tools/flow
echo   Tab 2  Cutter  : %ACC_HTML%
echo   Tab 3  Studio  : http://localhost:5173
echo   Health         : http://localhost:3001/api/health
echo.
pause
