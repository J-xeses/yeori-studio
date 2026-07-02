@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "ROOT=%~dp0"

set "NPM_OK=0"
set "FFMPEG_OK=0"
set "PYTHON_OK=0"
set "DEMUCS_OK=0"
set "DIRS_OK=0"
set "ENV_OK=0"
set "CHROME_OK=0"

echo.
echo ====================================================
echo   여리 스튜디오 환경 세팅
echo ====================================================
echo.

:: ── 1. npm install ────────────────────────────────────
echo [1/7] npm 패키지 설치...
pushd "%ROOT%"
call npm install
if %errorlevel% equ 0 (
    set "NPM_OK=1"
    echo [OK] npm install 완료
) else (
    echo [FAIL] npm install 실패 — Node.js 설치 여부 확인
)
popd
echo.

:: ── 2. FFmpeg 확인 ────────────────────────────────────
echo [2/7] FFmpeg 확인...
if exist "C:\ffmpeg\bin\ffmpeg.exe" (
    set "FFMPEG_OK=1"
    echo [OK] FFmpeg 확인됨: C:\ffmpeg\bin\ffmpeg.exe
) else (
    echo [WARN] FFmpeg 미설치
    echo        https://ffmpeg.org/download.html 에서 설치 후 C:\ffmpeg\ 에 압축 해제하세요
)
echo.

:: ── 3. Python 확인 ────────────────────────────────────
echo [3/7] Python 확인...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_OK=1"
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v
) else (
    echo [WARN] Python 미설치 — https://python.org 에서 설치하세요
)
echo.

:: ── 4. Demucs 설치 ────────────────────────────────────
echo [4/7] Demucs 설치 확인...
if "!PYTHON_OK!"=="0" (
    echo [SKIP] Python 없음 — Demucs 설치 건너뜀
    goto DEMUCS_DONE
)
python -c "import demucs" >nul 2>&1
if %errorlevel% equ 0 (
    set "DEMUCS_OK=1"
    echo [OK] Demucs 이미 설치됨 — 스킵
) else (
    echo       pip install demucs 실행 중...
    pip install demucs --break-system-packages
    python -c "import demucs" >nul 2>&1
    if %errorlevel% equ 0 (
        set "DEMUCS_OK=1"
        echo [OK] Demucs 설치 완료
    ) else (
        echo [FAIL] Demucs 설치 실패 — pip install demucs 직접 실행 후 재시도
    )
)
:DEMUCS_DONE
echo.

:: ── 5. 폴더 구조 생성 ─────────────────────────────────
echo [5/7] C:\yeori-studio\ 폴더 구조 생성...
mkdir "C:\yeori-studio\downloads\flow\character" 2>nul
mkdir "C:\yeori-studio\downloads\flow\ep1"       2>nul
mkdir "C:\yeori-studio\downloads\video\ep1"      2>nul
mkdir "C:\yeori-studio\downloads\audio\ep1"      2>nul
mkdir "C:\yeori-studio\downloads\output\ep1"     2>nul
set "DIRS_OK=1"
echo [OK] 폴더 구조 생성 완료
echo        downloads\flow\character
echo        downloads\flow\ep1
echo        downloads\video\ep1
echo        downloads\audio\ep1
echo        downloads\output\ep1
echo.

:: ── 6. .env.local 템플릿 생성 ─────────────────────────
echo [6/7] .env.local 템플릿 생성...
if not exist "%ROOT%.env.local" (
    (
        echo GEMINI_API_KEY=여기에_입력
        echo ELEVENLABS_API_KEY=여기에_입력
        echo ELEVENLABS_VOICE_ID=RmYuvmCbqOMBJxDLW4k8
    ) > "%ROOT%.env.local"
    set "ENV_OK=1"
    echo [OK] .env.local 생성됨: %ROOT%.env.local
    echo        ^^ API 키를 직접 입력해주세요
) else (
    set "ENV_OK=1"
    echo [OK] .env.local 이미 존재 — 스킵
)
echo.

:: ── 7. Chrome 프로필 폴더 생성 ────────────────────────
echo [7/7] Chrome 프로필 폴더 생성...
if not exist "%ROOT%.chrome-profile-flow\" (
    mkdir "%ROOT%.chrome-profile-flow"
    echo [OK] .chrome-profile-flow 생성됨
) else (
    echo [OK] .chrome-profile-flow 이미 존재 — 스킵
)
set "CHROME_OK=1"
echo.

:: ── 완료 체크리스트 ────────────────────────────────────
echo ====================================================
echo   완료 체크리스트
echo ====================================================
if "!NPM_OK!"=="1"    (echo   [v] npm 패키지 설치)        else (echo   [ ] npm 패키지 설치    -- 실패)
if "!FFMPEG_OK!"=="1" (echo   [v] FFmpeg)                else (echo   [ ] FFmpeg             -- C:\ffmpeg\bin\ffmpeg.exe 없음)
if "!PYTHON_OK!"=="1" (echo   [v] Python)                else (echo   [ ] Python             -- 미설치)
if "!DEMUCS_OK!"=="1" (echo   [v] Demucs)                else (echo   [ ] Demucs             -- 설치 실패 또는 Python 없음)
if "!DIRS_OK!"=="1"   (echo   [v] downloads 폴더 구조)    else (echo   [ ] downloads 폴더 구조 -- 실패)
if "!ENV_OK!"=="1"    (echo   [v] .env.local)             else (echo   [ ] .env.local         -- 실패)
if "!CHROME_OK!"=="1" (echo   [v] Chrome 프로필 폴더)     else (echo   [ ] Chrome 프로필 폴더  -- 실패)
echo ====================================================
echo.
echo   다음 단계:
echo   1. .env.local 에 API 키 입력 (Gemini, ElevenLabs)
if "!FFMPEG_OK!"=="0" (
echo   2. FFmpeg 설치 -- https://ffmpeg.org/download.html
echo      설치 후 C:\ffmpeg\ 에 압축 해제
)
echo   3. npm run dev  ^(개발 서버 실행^)
echo   4. npm run video -- --ep=1  ^(영상 자동화^)
echo.

endlocal
pause
