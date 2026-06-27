@echo off
chcp 65001 >nul
title 여리 스튜디오 콘텐츠 동기화
set LOCAL=C:\yeori-studio\downloads
set CLOUD=%USERPROFILE%\OneDrive\yeori-studio-sync

if "%USERNAME%"=="won56" (
    if not exist "%CLOUD%\" mkdir "%CLOUD%"
    robocopy "%LOCAL%" "%CLOUD%" /E /XO /XD ".git" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
    echo 업로드 완료!
) else if "%USERNAME%"=="user" (
    if not exist "%LOCAL%\" mkdir "%LOCAL%"
    robocopy "%CLOUD%" "%LOCAL%" /E /XO /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
    echo 다운로드 완료!
)
pause
