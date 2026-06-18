@echo off
title Yeori Studio Start
cd /d "%~dp0"

echo [1/4] Checking Chrome remote debugging (port 9222)...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 (
    echo        Chrome port 9222 already active, skipping...
) else (
    echo        Starting Chrome with remote debugging...
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
        --remote-debugging-port=9222 ^
        --user-data-dir=C:\yeori-studio\.chrome-profile-flow ^
        "https://labs.google/fx/ko/tools/flow"
    echo        Waiting 3 seconds for Chrome...
    timeout /t 3 /nobreak >nul
)

echo [2/4] Starting proxy server...
start "Yeori-Proxy-Server" cmd /k "npm run studio"

echo [3/4] Waiting 5 seconds...
timeout /t 5 /nobreak >nul

echo [4/4] Opening web app in Edge...
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" "https://yeori-studio.vercel.app"

echo.
pause
