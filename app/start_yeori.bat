@echo off
title Yeori Studio - start
cd /d "%~dp0"

:: ===============================================================
::  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file:
::  cmd.exe loses its read position on UTF-8 multibyte lines and runs
::  the following commands truncated (git pull was silently broken).
::  History / reasons for each step: app\docs\start_yeori-notes.md
::
::  Background services (proxy :3001 + vite :5173, tunnel, worker,
::  auto-sync) are kept alive by Task Scheduler (ensure-yeori-tasks.ps1).
::  This script only adds the work environment on top: trend radar,
::  browser tabs, git pull. Safe to re-run any time.
:: ===============================================================

set ACC_HTML=%~dp0a_creative_cutter.html
set MATRIX_HTML=%~dp0content_matrix_v3.html

:: TREND_RADAR_DIR - location differs per PC, check candidates in order
set TREND_RADAR_DIR=
if exist "C:\yeori-studio\app\trend-radar\package.json" set TREND_RADAR_DIR=C:\yeori-studio\app\trend-radar
if not defined TREND_RADAR_DIR if exist "C:\trend-radar\package.json" set TREND_RADAR_DIR=C:\trend-radar
if not defined TREND_RADAR_DIR if exist "%USERPROFILE%\Documents\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%USERPROFILE%\Documents\GitHub\trend-radar
if not defined TREND_RADAR_DIR for /d %%D in ("%USERPROFILE%\OneDrive - CTEC\*") do if not defined TREND_RADAR_DIR if exist "%%D\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%%D\GitHub\trend-radar
if not defined TREND_RADAR_DIR for /d %%D in ("%USERPROFILE%\OneDrive\*") do if not defined TREND_RADAR_DIR if exist "%%D\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%%D\GitHub\trend-radar

echo.
echo ============================================================
echo   Yeori Studio -- start
echo ============================================================
echo.

:: [1] Self-heal scheduled services and start them if not running
::     (first-time registration: install-services.bat as admin)
echo [1] Ensuring background services (scheduled tasks)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-yeori-tasks.ps1"
echo.

:: [2] Wait for proxy :3001 (before git pull - a stuck pull must never block the tabs)
echo [2] Waiting for studio proxy on :3001...
set /a _tries=0
:waitproxy
netstat -ano | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 goto proxyup
set /a _tries+=1
if %_tries% geq 30 (
    echo        WARN: :3001 not up yet -- check the YeoriStudio scheduled task
    goto trend
)
timeout /t 2 /nobreak >nul
goto waitproxy
:proxyup
echo        proxy up.
:trend
echo.

:: [3] TREND RADAR (:3000) - separate UI, not a scheduled task
echo [3] TREND RADAR (:3000)...
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo        already running -- skip
) else (
    if defined TREND_RADAR_DIR (
        if exist "%TREND_RADAR_DIR%\.next\BUILD_ID" (
            start "TREND RADAR Server" /D "%TREND_RADAR_DIR%" cmd /k "npm run start"
        ) else (
            start "TREND RADAR Server" /D "%TREND_RADAR_DIR%" cmd /k "npm run build && npm run start"
        )
    ) else (
        echo        trend-radar not found -- skip
    )
)
echo.

:: [4] Browser tabs - all tools as tabs in ONE new Chrome window.
::     Reference board is opened via the proxy (/downloads) instead of file://.
::     Without Chrome: fall back to the default browser, one by one.
echo [4] Opening tabs...
set "REF_BOARD=http://localhost:3001/downloads/_shared/references/teaser/index.html"
set "TABS="http://localhost:5173" "http://localhost:3001/insta-ops" "%REF_BOARD%""
if exist "%ACC_HTML%" set "TABS=%TABS% "%ACC_HTML%""
if exist "%MATRIX_HTML%" set "TABS=%TABS% "%MATRIX_HTML%""
set "TABS=%TABS% "http://localhost:3000""
set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if defined CHROME (
    start "" "%CHROME%" --new-window %TABS%
) else (
    start "" "http://localhost:5173"
    start "" "http://localhost:3001/insta-ops"
    start "" "%REF_BOARD%"
    if exist "%ACC_HTML%" start "" "%ACC_HTML%"
    if exist "%MATRIX_HTML%" start "" "%MATRIX_HTML%"
    start "" "http://localhost:3000"
)
echo.

:: [5] Git pull - last; gives up if under 1KB/s for 15s.
::     (OneDrive content sync was stopped 2026-09-17 - see notes; sync-content.bat kept)
echo [5] Git pull...
cd /d C:\yeori-studio
git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 pull origin master
if errorlevel 1 echo        WARN: git pull failed/timed out -- run git pull manually later.
cd /d "%~dp0"
echo.

echo ============================================================
echo   READY
echo ============================================================
echo   Studio      : http://localhost:5173
echo   Insta Ops   : http://localhost:3001/insta-ops
echo   Ref Board   : %REF_BOARD%
echo   Cutter      : %ACC_HTML%
echo   Trend Radar : http://localhost:3000
echo   Health      : http://localhost:3001/api/health
echo.
echo   proxy/vite/tunnel are kept alive by Task Scheduler -- this window can be closed.
echo   Generation/editing (Flow/CapCut/ElevenLabs): start_gen.bat
echo   Stop services: schtasks /end /tn YeoriStudio  (and YeoriMcpTunnel)
echo ============================================================
echo.
timeout /t 15
