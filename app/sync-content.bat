@echo off
chcp 65001 >nul
title Yeori Studio Sync
set LOCAL=C:\yeori-studio\downloads
set CLOUD=%USERPROFILE%\OneDrive\yeori-studio-sync

if not exist "%LOCAL%\" mkdir "%LOCAL%"
if not exist "%CLOUD%\" (
    echo OneDrive sync folder not found -- creating: %CLOUD%
    mkdir "%CLOUD%"
)

echo Downloading (CLOUD to LOCAL)...
robocopy "%CLOUD%" "%LOCAL%" /E /XO /XD ".git" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
echo Download Complete!

echo Uploading (LOCAL to CLOUD)...
robocopy "%LOCAL%" "%CLOUD%" /E /XO /XD ".git" /NP /TEE /LOG+:"%LOCAL%\..\sync-log.txt"
echo Upload Complete!
