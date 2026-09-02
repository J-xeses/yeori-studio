@echo off
title Yeori Studio - 제작 코어
cd /d "%~dp0"

:: ═══════════════════════════════════════════════════════════════
::  제작 코어 (production) — 트렌드 레이더 · 스튜디오 · 커터 · 에이전트
::  생성/편집 도구(Flow · CapCut · ElevenLabs)는 start_gen.bat 로 분리.
::  이미지·영상은 수동 제작 → 스튜디오 업로드 (2026-09-02 전환).
:: ═══════════════════════════════════════════════════════════════

set ACC_HTML=%~dp0a_creative_cutter.html
set MATRIX_HTML=%~dp0content_matrix_v3.html

:: TREND_RADAR_DIR 탐색 (PC마다 위치가 달라서 우선순위대로 확인)
set TREND_RADAR_DIR=
if exist "C:\yeori-studio\app\trend-radar\package.json" set TREND_RADAR_DIR=C:\yeori-studio\app\trend-radar
if not defined TREND_RADAR_DIR if exist "C:\trend-radar\package.json" set TREND_RADAR_DIR=C:\trend-radar
if not defined TREND_RADAR_DIR if exist "%USERPROFILE%\Documents\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%USERPROFILE%\Documents\GitHub\trend-radar
if not defined TREND_RADAR_DIR for /d %%D in ("%USERPROFILE%\OneDrive - CTEC\*") do if not defined TREND_RADAR_DIR if exist "%%D\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%%D\GitHub\trend-radar
if not defined TREND_RADAR_DIR for /d %%D in ("%USERPROFILE%\OneDrive\*") do if not defined TREND_RADAR_DIR if exist "%%D\GitHub\trend-radar\package.json" set TREND_RADAR_DIR=%%D\GitHub\trend-radar

echo.
echo ============================================================
echo   Yeori Studio -- 제작 코어 (production)
echo ============================================================
echo.

:: [pre-1] Git pull
echo [pre-1] Git pull...
cd /d C:\yeori-studio
git pull origin master
cd /d "%~dp0"
echo.

:: [pre-1.5] 시간별 자동 커밋/동기 스케줄 작업 자가 치유
echo [pre-1.5] Checking hourly auto-sync task...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-auto-sync-task.ps1"
echo.

:: [pre-2] Sync on start (download latest from cloud)
echo [pre-2] Sync on start...
call "%~dp0sync-content.bat"
echo.

:: [0] 기존 프록시(:3001) + Cloudflare Tunnel 종료
echo [0] Killing existing proxy on port 3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /IM cloudflared.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: [1] TREND RADAR 프로덕션 서버 (:3000)
echo [1] Starting TREND RADAR production server...
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo        TREND RADAR server already running on port 3000 -- skip
) else (
    if defined TREND_RADAR_DIR (
        echo        Found trend-radar at %TREND_RADAR_DIR%
        if exist "%TREND_RADAR_DIR%\.next\BUILD_ID" (
            start "TREND RADAR Server" /D "%TREND_RADAR_DIR%" cmd /k "npm run start"
        ) else (
            echo        No valid production build ^(.next\BUILD_ID missing^) -- building first...
            start "TREND RADAR Server" /D "%TREND_RADAR_DIR%" cmd /k "npm run build && npm run start"
        )
        timeout /t 5 /nobreak >nul
    ) else (
        echo        trend-radar project not found in any known location -- skip
    )
)
echo.

:: [2] Cloudflare Tunnel (yeori-studio MCP 원격 연결용, :3001 -> HTTPS)
echo [2] Starting Cloudflare Tunnel (auto Vercel sync)...
set CLOUDFLARED=
if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe
if not defined CLOUDFLARED if exist "%LOCALAPPDATA%\cloudflared\cloudflared.exe" set CLOUDFLARED=%LOCALAPPDATA%\cloudflared\cloudflared.exe
if not defined CLOUDFLARED if exist "C:\Program Files\cloudflared\cloudflared.exe" set CLOUDFLARED=C:\Program Files\cloudflared\cloudflared.exe
if defined CLOUDFLARED (
    start "Yeori Cloudflare Tunnel" /D "%~dp0" cmd /k "timeout /t 6 /nobreak >nul && node scripts\sync-tunnel.js"
    echo        Tunnel window opened -- URL change is synced to Vercel automatically.
) else (
    echo        cloudflared.exe not found -- skip tunnel
)
echo.

:: [3] 무인 코드작업 워커 (에이전트) — code-task-queue.json 폴링 -> 헤드리스 claude
echo [3] Starting task-queue worker...
tasklist /FI "WINDOWTITLE eq Yeori Task Worker*" 2>nul | find /I "cmd.exe" >nul
if %errorlevel% == 0 (
    echo        Task worker already running -- skip
) else (
    start "Yeori Task Worker" /D "%~dp0" cmd /k "node scripts\task-queue-worker.js"
)
echo.

:: [4] 제작 도구 UI 탭 (기본 브라우저) — 스튜디오 / 커터 / 매트릭스 / 트렌드
::     Flow 는 여기서 안 엶 (start_gen.bat 담당)
echo [4] Opening production tabs in default browser...
start "" "http://localhost:5173"
if exist "%ACC_HTML%" start "" "%ACC_HTML%"
if exist "%MATRIX_HTML%" start "" "%MATRIX_HTML%"
start "" "http://localhost:3000"
echo.

:: [5] 스튜디오 서버 (프록시 :3001 + Vite :5173) — 포그라운드, Ctrl+C 까지 블록
echo.
echo ============================================================
echo   READY -- 제작 코어
echo ============================================================
echo   Studio      : http://localhost:5173
echo   Cutter      : %ACC_HTML%
echo   Trend Radar : http://localhost:3000
echo   Health      : http://localhost:3001/api/health
echo   MCP Tunnel  : "Yeori Cloudflare Tunnel" 창 참고
echo.
echo   생성/편집(Flow/CapCut/ElevenLabs) 은  start_gen.bat  실행
echo   ** Stop: Ctrl+C then N (종료 시 동기화 자동 실행)
echo ============================================================
echo.
npm run studio

:: [6] 종료 시 동기화
echo.
echo ============================================================
echo   Server stopped -- running shutdown sync...
echo ============================================================
echo.
call "%~dp0sync-content.bat"
echo.
echo [7] Git auto-sync (commit + pull + push)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-auto-sync.ps1"
echo.
echo   Goodbye!
echo ============================================================
pause
