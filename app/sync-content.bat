@echo off
chcp 65001 >nul
title Yeori Studio Sync
set LOCAL=C:\yeori-studio\downloads
set CLOUD=%USERPROFILE%\OneDrive\yeori-studio-sync

if "%USERNAME%"=="won56" (
    if not exist "%CLOUD%\" mkdir "%CLOUD%"
    robocopy "%LOCAL%" "%CLOUD%" /E /XO /XD ".git" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
    echo Upload Complete!
) else if "%USERNAME%"=="user" (
    if not exist "%LOCAL%\" mkdir "%LOCAL%"
    if exist "%CLOUD%\" (
        robocopy "%CLOUD%" "%LOCAL%" /E /XO /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
        echo Download Complete!
    ) else (
        echo OneDrive sync folder not found -- skipping download: %CLOUD%
    )
)
