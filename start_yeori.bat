@echo off
chcp 65001 >nul
title Yeori Studio
cd /d "%~dp0"

set ACC_HTML=%~dp0a-creative-cutter.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

echo.
echo ============================================================
echo   Yeori Studio -- 전체 시스템 시작
echo ============================================================
echo.

:: [1/4] Chrome 원격 디버깅 (port 9222)
echo [1/4] Chrome 원격 디버깅 (port 9222) 확인 중...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 (
    echo        이미 실행 중 -- 스킵
    set CHROME_STATUS=이미 실행 중 (스킵)
) else (
    echo        Chrome 실행 중...
    start "" %CHROME% ^
        --remote-debugging-port=9222 ^
        --user-data-dir=C:\yeori-studio\.chrome-profile-flow ^
        "https://labs.google/fx/ko/tools/flow"
    timeout /t 3 /nobreak >nul
    set CHROME_STATUS=새로 시작됨
)

:: [2/4] A Creative Cutter HTML 열기
echo [2/4] A Creative Cutter 열기...
if exist "%ACC_HTML%" (
    start "" %CHROME% ^
        --remote-debugging-port=9222 ^
        --user-data-dir=C:\yeori-studio\.chrome-profile-flow ^
        "%ACC_HTML%"
    set ACC_STATUS=준비완료
) else (
    echo        a-creative-cutter.html 없음 -- 스킵
    set ACC_STATUS=파일 없음 (스킵)
)

:: [3/4] 프록시 서버 + Vite 시작
echo [3/4] 프록시 서버 + Vite 시작 중...
start "Yeori-Studio-Server" cmd /k "npm run studio"

echo        서버 초기화 대기 (5초)...
timeout /t 5 /nobreak >nul

:: [4/4] Edge로 웹앱 열기
echo [4/4] Edge로 스튜디오 웹앱 열기...
start "" %EDGE% "http://localhost:5173"

:: 준비 완료
echo.
echo ============================================================
echo   준비 완료
echo ============================================================
echo   [v] Chrome (Flow)         -- %CHROME_STATUS%
echo   [v] A Creative Cutter    -- %ACC_STATUS%
echo   [v] 프록시 서버 (3001)    -- 준비완료
echo   [v] 스튜디오 웹앱 (5173)  -- 준비완료
echo ============================================================
echo.
echo   웹앱:   http://localhost:5173
echo   프록시: http://localhost:3001/api/health
echo.
pause