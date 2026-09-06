@echo off
title Yeori Studio - 작업 시작
cd /d "%~dp0"

:: ═══════════════════════════════════════════════════════════════
::  이 배치는 더 이상 "서버를 붙잡고 있는" 창이 아니다.
::  proxy(:3001)+vite(:5173) 와 Cloudflare 터널은 Windows 작업 스케줄러가
::  로그온 시 자동 시작 + 죽으면 자동 재시작한다 (ensure-yeori-tasks.ps1).
::  → PC 켜고 로그인만 하면 MCP 커넥터와 워커는 이미 떠 있다. 신경 쓸 것 없음.
::
::  이 배치는 그 위에 "작업 환경"만 얹는다: git pull, 트렌드 레이더, 브라우저 탭.
::  아무 때나 다시 실행해도 안전(이미 떠 있으면 건너뜀). 실행 안 해도 MCP는 동작.
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
echo   Yeori Studio -- 작업 시작
echo ============================================================
echo.

:: [1] 백그라운드 서비스 스케줄 자가치유 + 없으면 지금 시작
::     (YeoriStudio=proxy+vite, YeoriMcpTunnel, YeoriTaskQueueWorker, YeoriStudio_AutoSync)
echo [1] Ensuring background services (scheduled tasks)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-yeori-tasks.ps1"
echo.

:: [2] Git pull + 클라우드 콘텐츠 동기화
echo [2] Git pull + content sync...
cd /d C:\yeori-studio
git pull origin master
cd /d "%~dp0"
call "%~dp0sync-content.bat"
echo.

:: [3] proxy(:3001) 가 뜰 때까지 대기 (YeoriStudio 작업이 기동 중)
echo [3] Waiting for studio proxy on :3001...
set /a _tries=0
:waitproxy
netstat -ano | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 goto proxyup
set /a _tries+=1
if %_tries% geq 30 (
    echo        WARN: :3001 아직 안 뜸 -- 작업 스케줄러에서 YeoriStudio 상태 확인 필요
    goto trend
)
timeout /t 2 /nobreak >nul
goto waitproxy
:proxyup
echo        proxy up.
:trend
echo.

:: [4] TREND RADAR (:3000) — 스케줄에 없는 별도 UI, 여기서만 띄움
echo [4] TREND RADAR (:3000)...
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

:: [5] 브라우저 탭
echo [5] Opening tabs...
start "" "http://localhost:5173"
if exist "%ACC_HTML%" start "" "%ACC_HTML%"
if exist "%MATRIX_HTML%" start "" "%MATRIX_HTML%"
start "" "http://localhost:3000"
echo.

echo ============================================================
echo   READY
echo ============================================================
echo   Studio      : http://localhost:5173
echo   Cutter      : %ACC_HTML%
echo   Trend Radar : http://localhost:3000
echo   Health      : http://localhost:3001/api/health
echo.
echo   proxy/vite/터널은 작업 스케줄러가 계속 살려둔다 -- 이 창은 닫아도 됨.
echo   생성/편집(Flow/CapCut/ElevenLabs) 은  start_gen.bat
echo   서비스 완전 정지: schtasks /end /tn YeoriStudio  (그리고 YeoriMcpTunnel)
echo ============================================================
echo.
timeout /t 15
