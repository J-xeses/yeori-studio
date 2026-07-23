@echo off
title Yeori Studio
cd /d "%~dp0"

set ACC_HTML=%~dp0a_creative_cutter.html
set MATRIX_HTML=%~dp0content_matrix_v3.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE=C:\yeori-studio\app\.chrome-profile-flow

:: TREND_RADAR_DIR 탐색 (PC마다 위치가 달라서 우선순위대로 확인)
set TREND_RADAR_DIR=
if exist "C:\yeori-studio\app\trend-radar\package.json" set TREND_RADAR_DIR=C:\yeori-studio\app\trend-radar
if not defined TREND_RADAR_DIR if exist "C:\trend-radar\package.json" set TREND_RADAR_DIR=C:\trend-radar
if not defined TREND_RADAR_DIR if exist "%USERPROFILE%\Documents\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%USERPROFILE%\Documents\GitHub\trend-radar
if not defined TREND_RADAR_DIR if exist "%USERPROFILE%\OneDrive - CTEC\문서\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%USERPROFILE%\OneDrive - CTEC\문서\GitHub\trend-radar
if not defined TREND_RADAR_DIR if exist "%USERPROFILE%\OneDrive\문서\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%USERPROFILE%\OneDrive\문서\GitHub\trend-radar

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

:: [0] Kill existing proxy on port 3001 + existing Cloudflare Tunnel
echo [0] Killing existing proxy on port 3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /IM cloudflared.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: [1] Start TREND RADAR production server (needs a real server -- /api/youtube, /api/analyze
::     routes can't work from a static html file)
echo [1] Starting TREND RADAR production server...
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo        TREND RADAR server already running on port 3000 -- skip
) else (
    if defined TREND_RADAR_DIR (
        echo        Found trend-radar at %TREND_RADAR_DIR%
        if exist "%TREND_RADAR_DIR%\.next" (
            start "TREND RADAR Server" cmd /k "cd /d "%TREND_RADAR_DIR%" && npm run start"
        ) else (
            echo        No .next build found -- building first...
            start "TREND RADAR Server" cmd /k "cd /d "%TREND_RADAR_DIR%" && npm run build && npm run start"
        )
        timeout /t 5 /nobreak >nul
    ) else (
        echo        trend-radar project not found in any known location -- skip
    )
)
echo.

:: [2] Open Chrome tabs
echo [2] Opening Chrome tabs...
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
if exist "%MATRIX_HTML%" (
    start "" %CHROME% --user-data-dir=%PROFILE% "%MATRIX_HTML%"
    timeout /t 1 /nobreak >nul
) else (
    echo        content_matrix_v3.html not found -- skip
)
start "" %CHROME% --user-data-dir=%PROFILE% "http://localhost:3000"
timeout /t 1 /nobreak >nul

:: [2.5] Start Cloudflare Tunnel (yeori-studio MCP 원격 연결용, localhost:3001 -> HTTPS)
::       scripts/sync-tunnel.js가 cloudflared를 띄우고, URL이 바뀌면
::       Vercel MCP_BRIDGE_URL을 자동으로 갱신 + redeploy까지 수행한다.
echo [2.5] Starting Cloudflare Tunnel (auto Vercel sync)...
set CLOUDFLARED=%LOCALAPPDATA%\cloudflared\cloudflared.exe
if exist "%CLOUDFLARED%" (
    start "Yeori Cloudflare Tunnel" cmd /k "timeout /t 6 /nobreak >nul && node "%~dp0scripts\sync-tunnel.js""
    echo        Tunnel window opened -- URL change is detected and synced to Vercel automatically.
) else (
    echo        cloudflared.exe not found at %CLOUDFLARED% -- skip tunnel
)
echo.

:: [3] Start server in foreground (blocks here until Ctrl+C)
echo.
echo ============================================================
echo   READY
echo ============================================================
echo   Tab 1  Flow        : https://labs.google/fx/ko/tools/flow
echo   Tab 2  Cutter      : %ACC_HTML%
echo   Tab 3  Studio      : http://localhost:5173
echo   Tab 5  Trend Radar : http://localhost:3000
echo   Health             : http://localhost:3001/api/health
echo   MCP Tunnel         : see "Yeori Cloudflare Tunnel" window for the current URL
echo.
echo   ** Stop: Ctrl+C then N (runs shutdown sync automatically)
echo ============================================================
echo.
npm run studio

:: [4] Auto-sync on shutdown
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