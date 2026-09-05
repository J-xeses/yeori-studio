@echo off
chcp 65001 >nul
title Yeori Studio Sync
set LOCAL=C:\yeori-studio\downloads
set LOCAL_DATA=C:\yeori-studio\app\data
set CLOUD=%USERPROFILE%\OneDrive\yeori-studio-sync
set CLOUD_DATA=%CLOUD%\_app-data

if not exist "%LOCAL%\"      mkdir "%LOCAL%"
if not exist "%LOCAL_DATA%\" mkdir "%LOCAL_DATA%"
if not exist "%CLOUD%\" (
    echo OneDrive sync folder not found -- creating: %CLOUD%
    mkdir "%CLOUD%"
)
if not exist "%CLOUD_DATA%\" mkdir "%CLOUD_DATA%"

:: [1/3] studio-data.json / studio-secrets.json smart sync
echo.
echo [1/3] studio-data.json / studio-secrets.json smart sync...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0smart-sync-state.ps1"

:: [2/3] downloads/ media sync
:: chrome-profile-* 는 살아있는 브라우저 런타임 프로필(잠금 파일 포함)이라 동기화 대상에서 제외.
:: 켜진 채로 robocopy가 CrashpadMetrics.pma 등을 잡으려다 Access denied 무한 재시도에 빠지는 문제 있었음(2026-09-05).
echo [2/3] downloads/ media sync...
robocopy "%CLOUD%" "%LOCAL%" /E /XO /XD ".git" "chrome-profile-main" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
robocopy "%LOCAL%" "%CLOUD%" /E /XO /XD ".git" "chrome-profile-main" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"

:: [3/3] app/data/ sync (excluding studio-data.json handled above)
echo [3/3] app/data/ sync...
robocopy "%CLOUD_DATA%" "%LOCAL_DATA%" /E /XO /XD ".git" /XF "studio-data.json" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
robocopy "%LOCAL_DATA%" "%CLOUD_DATA%" /E /XO /XD ".git" /XF "studio-data.json" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"

echo.
echo ============================================================
echo   Sync complete!
echo ============================================================