@echo off
title Yeori Studio - 생성/편집 도구
cd /d "%~dp0"

:: ═══════════════════════════════════════════════════════════════
::  생성/편집 도구 (generation) — Flow · CapCut · ElevenLabs
::  제작 코어(스튜디오 서버 등)는 start_yeori.bat 로 먼저 띄워둘 것.
::  이미지·영상은 수동 제작 -> 스튜디오 "영상 만들기" 탭 등에 업로드.
:: ═══════════════════════════════════════════════════════════════

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE=C:\yeori-studio\app\.chrome-profile-flow
set ACC_HTML=%~dp0a_creative_cutter.html

echo.
echo ============================================================
echo   Yeori Studio -- 생성/편집 도구 (generation)
echo ============================================================
echo.

:: [0] 제작 코어(:3001)가 떠 있는지 확인
echo [0] Checking production core (proxy :3001)...
netstat -ano | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo        proxy(:3001) LISTENING -- OK
) else (
    echo        [!] proxy(:3001) 안 떠 있음 -- 먼저 start_yeori.bat 를 실행하세요.
    echo            (스튜디오 업로드/체크리스트 기능이 안 됩니다)
)
echo.

:: [1] Chrome (Flow 세션) — remote-debugging-port 는 예전 puppeteer 잔재지만
::     프로필 고정을 위해 유지. Flow + 스튜디오 + ElevenLabs 탭.
echo [1] Opening Flow session in Chrome...
netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel% == 0 (
    echo        Chrome(9222) already running -- adding tabs...
    start "" %CHROME% --user-data-dir=%PROFILE% "https://labs.google/fx/ko/tools/flow"
) else (
    start "" %CHROME% --remote-debugging-port=9222 --user-data-dir=%PROFILE% --start-maximized "https://labs.google/fx/ko/tools/flow"
    timeout /t 3 /nobreak >nul
)
start "" %CHROME% --user-data-dir=%PROFILE% "http://localhost:5173"
start "" %CHROME% --user-data-dir=%PROFILE% "https://elevenlabs.io/app/speech-synthesis"
if exist "%ACC_HTML%" start "" %CHROME% --user-data-dir=%PROFILE% "%ACC_HTML%"
echo.

:: [2] CapCut (데스크톱) — 설치 경로가 PC마다 달라서 후보를 순서대로 확인
echo [2] Launching CapCut...
set CAPCUT=
if exist "%LOCALAPPDATA%\CapCut\Apps" (
    for /f "delims=" %%D in ('dir /b /ad /o-n "%LOCALAPPDATA%\CapCut\Apps" 2^>nul') do if not defined CAPCUT if exist "%LOCALAPPDATA%\CapCut\Apps\%%D\CapCut.exe" set CAPCUT=%LOCALAPPDATA%\CapCut\Apps\%%D\CapCut.exe
)
if not defined CAPCUT if exist "%PROGRAMFILES%\CapCut\CapCut.exe" set CAPCUT=%PROGRAMFILES%\CapCut\CapCut.exe
if defined CAPCUT (
    start "" "%CAPCUT%"
    echo        %CAPCUT%
) else (
    echo        CapCut.exe 를 못 찾음 -- 수동 실행하세요.
)
echo.

echo ============================================================
echo   READY -- 생성/편집
echo ============================================================
echo   Flow        : https://labs.google/fx/ko/tools/flow
echo   Studio 탭   : http://localhost:5173  (제작 코어에서 서빙)
echo   ElevenLabs  : https://elevenlabs.io/app/speech-synthesis
echo   CapCut      : 데스크톱 앱
echo.
echo   워크플로: 스튜디오에서 VP 프롬프트/시작프레임 -> Flow/Veo 제작
echo             -> 스튜디오 탭에 업로드
echo ============================================================
echo.
pause
