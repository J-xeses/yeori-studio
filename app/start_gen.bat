@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Yeori Studio - Generation Tools
cd /d "%~dp0"
:: ASCII ONLY (see docs\start_yeori-notes.md). Browser tabs are listed in gen-tabs.txt.

echo ============================================================
echo   Yeori Studio -- Generation Tools (tabs from gen-tabs.txt + CapCut)
echo ============================================================
echo.

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\yeori-studio\downloads\flow\chrome-profile-main"
set "DEBUGPORT=9222"
set "TABLIST=%~dp0gen-tabs.txt"

if not exist "%CHROME%" goto :no_chrome
if not exist "%PROFILE%" mkdir "%PROFILE%"

echo [0] Checking production core (proxy :3001)
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul 2>&1 && (echo     proxy :3001 OK) || (echo     [!] proxy :3001 not up -- run start_yeori.bat first)
echo.

echo [1] Chrome debug session on port %DEBUGPORT%  (profile: chrome-profile-main)
:: Tabs come from gen-tabs.txt (name^|url per line) - add services there, not here.
:: All tabs open in ONE window: fresh launch = the debug window, already running = one new window.
set "TABS="
if not exist "%TABLIST%" (
  echo     [!] gen-tabs.txt missing -- opening Flow only
  set "TABS="https://labs.google/fx/ko/tools/flow""
)
if exist "%TABLIST%" for /f "usebackq eol=# tokens=1,* delims=|" %%A in ("%TABLIST%") do call :addtab "%%A" "%%B"
netstat -ano | findstr /r /c:":%DEBUGPORT% .*LISTENING" >nul 2>&1
if %errorlevel%==0 goto :chrome_running

start "" "%CHROME%" --remote-debugging-port=%DEBUGPORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --start-maximized %TABS%
echo     launched Chrome (new debug session) with the tool tabs
goto :chrome_done

:chrome_running
echo     Chrome already on %DEBUGPORT% -- opening the tool tabs in one new window (same profile)
start "" "%CHROME%" --user-data-dir="%PROFILE%" --new-window %TABS%

:chrome_done
echo.

echo [2] CapCut desktop
set "CAPCUT="
if exist "%LOCALAPPDATA%\CapCut\Apps" for /f "delims=" %%D in ('dir /b /ad /o-n "%LOCALAPPDATA%\CapCut\Apps" 2^>nul') do if not defined CAPCUT if exist "%LOCALAPPDATA%\CapCut\Apps\%%D\CapCut.exe" set "CAPCUT=%LOCALAPPDATA%\CapCut\Apps\%%D\CapCut.exe"
if not defined CAPCUT if exist "%PROGRAMFILES%\CapCut\CapCut.exe" set "CAPCUT=%PROGRAMFILES%\CapCut\CapCut.exe"
if defined CAPCUT (start "" "%CAPCUT%" & echo     %CAPCUT%) else (echo     CapCut.exe not found -- launch manually)
echo.

echo [3] Making pipeline (auto-produce GRAPHIC/BROLL/CAPCUT, then wait at G4 gate)
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo     [!] proxy :3001 down -- skipped. Run start_yeori.bat first, then re-run this.
  goto :pipe_done
)
echo     waiting for Chrome debug port %DEBUGPORT% (CLIP cuts need it) ...
set /a _tries=0
:wait_dbg
netstat -ano | findstr /r /c:":%DEBUGPORT% .*LISTENING" >nul 2>&1 && goto :dbg_ok
set /a _tries+=1
if %_tries% geq 12 (echo     [!] Chrome %DEBUGPORT% not up yet -- starting anyway ^(CLIP cuts retry next cycle^) & goto :dbg_ok)
ping -n 3 127.0.0.1 >nul
goto :wait_dbg
:dbg_ok
start "Yeori Pipeline Leader" /d "%~dp0" cmd /k node scripts\pipeline-leader.js
echo     pipeline leader started in a separate window (active episode).
echo       - auto-produces the making cuts, G3 TTS, then G5 once every cut's G4 is approved
echo       - it does NOT auto-approve: review verify thumbnails and press "G4 approve" in the Studio
echo       - close that window to stop the pipeline
:pipe_done
echo.

echo ============================================================
echo   READY - tabs:
if exist "%TABLIST%" for /f "usebackq eol=# tokens=1,* delims=|" %%A in ("%TABLIST%") do echo     %%A : %%B
echo     debug port : %DEBUGPORT%  (screen-scenario / CLIP auto-record uses this)
echo     pipeline   : "Yeori Pipeline Leader" window (auto making -^> G4 gate -^> G5)
echo ============================================================
echo.
echo   Log in to each service once in this Chrome profile; the sessions persist.
echo   Your only manual step for the making line: review + G4 approve in the Studio.
echo.
goto :end

:: ---- add one tab: web urls always, local files only if they exist ----
:addtab
set "_U=%~2"
if "%_U%"=="" goto :eof
if /i "%_U:~0,4%"=="http" (
  set "TABS=%TABS% "%_U%""
  echo     + %~1
) else if exist "%_U%" (
  set "TABS=%TABS% "%_U%""
  echo     + %~1
) else (
  echo     - %~1 skipped, not found: %_U%
)
goto :eof

:no_chrome
echo [X] Chrome not found at "%CHROME%"
echo     Install Chrome or edit CHROME= path in this file.
echo.

:end
pause
endlocal
