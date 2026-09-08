@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Yeori Studio - Generation Tools
cd /d "%~dp0"

echo ============================================================
echo   Yeori Studio -- Generation Tools (Flow / ElevenLabs / CapCut)
echo ============================================================
echo.

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\yeori-studio\downloads\flow\chrome-profile-main"
set "DEBUGPORT=9222"

if not exist "%CHROME%" goto :no_chrome
if not exist "%PROFILE%" mkdir "%PROFILE%"

echo [0] Checking production core (proxy :3001)
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul 2>&1 && (echo     proxy :3001 OK) || (echo     [!] proxy :3001 not up -- run start_yeori.bat first)
echo.

echo [1] Chrome debug session on port %DEBUGPORT%  (profile: chrome-profile-main)
netstat -ano | findstr /r /c:":%DEBUGPORT% .*LISTENING" >nul 2>&1
if %errorlevel%==0 goto :chrome_running

start "" "%CHROME%" --remote-debugging-port=%DEBUGPORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --start-maximized "https://labs.google/fx/ko/tools/flow"
echo     launching Chrome (new debug session)...
ping -n 5 127.0.0.1 >nul
start "" "%CHROME%" --user-data-dir="%PROFILE%" "https://elevenlabs.io/app/speech-synthesis/text-to-speech"
ping -n 2 127.0.0.1 >nul
start "" "%CHROME%" --user-data-dir="%PROFILE%" "http://localhost:5173"
goto :chrome_done

:chrome_running
echo     Chrome already on %DEBUGPORT% -- opening tool tabs in same profile
start "" "%CHROME%" --user-data-dir="%PROFILE%" "https://labs.google/fx/ko/tools/flow"
start "" "%CHROME%" --user-data-dir="%PROFILE%" "https://elevenlabs.io/app/speech-synthesis/text-to-speech"

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
echo   READY
echo     Flow       : https://labs.google/fx/ko/tools/flow
echo     ElevenLabs : https://elevenlabs.io/app/speech-synthesis/text-to-speech
echo     Studio     : http://localhost:5173
echo     debug port : %DEBUGPORT%  (screen-scenario / CLIP auto-record uses this)
echo     pipeline   : "Yeori Pipeline Leader" window (auto making -^> G4 gate -^> G5)
echo ============================================================
echo.
echo   Log in to Flow and ElevenLabs once in this Chrome; the session persists.
echo   Your only manual step for the making line: review + G4 approve in the Studio.
echo.
goto :end

:no_chrome
echo [X] Chrome not found at "%CHROME%"
echo     Install Chrome or edit CHROME= path in this file.
echo.

:end
pause
endlocal
