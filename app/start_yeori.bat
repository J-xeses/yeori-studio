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

:: [pre-0] 이미 제작 코어가 떠 있으면(3001 LISTENING) -> 복구 모드
::   프록시/Vite/트렌드/워커는 그대로 두고, 끊긴 터널만 되살린 뒤 종료.
::   전체 재기동을 원하면 기존 "제작 코어" 창에서 Ctrl+C -> N 먼저.
set CORE_UP=
netstat -ano | findstr ":3001 " | findstr "LISTENING" >nul 2>&1 && set CORE_UP=1
if defined CORE_UP (
    echo [pre-0] 제작 코어가 이미 실행 중입니다 -- 복구 모드.
    echo.
    echo [pre-0] Ensuring Cloudflare Tunnel...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-tunnel.ps1"
    echo.
    echo [pre-0] Ensuring task-queue worker schedule + one run now...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-worker-task.ps1"
    start "Yeori Task Worker (once)" /D "%~dp0" cmd /c "node scripts\task-queue-worker.js & echo. & echo === worker finished === & timeout /t 5 >nul"
    echo.
    echo ============================================================
    echo   복구 완료 -- 기존 코어는 그대로 둡니다.
    echo   전체 재기동하려면 기존 "제작 코어" 창에서 Ctrl+C 후 다시 실행.
    echo ============================================================
    timeout /t 10
    exit /b 0
)

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
::   ensure-tunnel.ps1 이 상태 점검 후 필요할 때만 재기동 (재실행 안전).
echo [2] Ensuring Cloudflare Tunnel (auto Vercel sync)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-tunnel.ps1"
echo.

:: [3] 무인 코드작업 워커 (에이전트) — status:"approved" 작업을 헤드리스 claude 로 처리.
::   워커는 1회 실행형. 25분 간격 재실행은 Task Scheduler(YeoriTaskQueueWorker)가 담당하고
::   ensure-worker-task.ps1 이 그 스케줄을 자가치유. 여기서는 스케줄 확인 + 즉시 1회 실행만.
echo [3] Task-queue worker (schedule self-heal + one run now)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-worker-task.ps1"
start "Yeori Task Worker (once)" /D "%~dp0" cmd /c "node scripts\task-queue-worker.js & echo. & echo === worker finished === & timeout /t 5 >nul"
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
