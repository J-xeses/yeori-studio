@echo off
:: yeori-studio 백그라운드 서비스(작업 스케줄러) 설치 -- PC마다 1회만.
:: 이 PC는 루트 작업 폴더 등록에 관리자 권한이 필요해서 UAC 승격이 뜬다.
:: 등록되는 작업 자체는 RunLevel=Limited (일반 권한)로 돈다.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 관리자 권한 요청 중... UAC 창에서 [예] 를 눌러주세요.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo ============================================================
echo   yeori-studio 서비스 설치 (관리자)
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-yeori-tasks.ps1"
echo.
echo ------------------------------------------------------------
echo   등록된 작업:
schtasks /query /tn "YeoriStudio" /fo list 2>nul | findstr /i "TaskName Status"
schtasks /query /tn "YeoriMcpTunnel" /fo list 2>nul | findstr /i "TaskName Status"
schtasks /query /tn "YeoriTaskQueueWorker" /fo list 2>nul | findstr /i "TaskName Status"
schtasks /query /tn "YeoriStudio_AutoSync" /fo list 2>nul | findstr /i "TaskName Status"
echo ------------------------------------------------------------
echo.
echo   완료. 한 번 로그아웃 -^> 로그인 하면 전부 스케줄러 관리로 넘어갑니다.
echo   (지금 안 떠 있던 서비스는 위 스크립트가 이미 시작했습니다.)
echo.
pause
