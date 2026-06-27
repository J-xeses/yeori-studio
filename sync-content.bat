@echo off
setlocal EnableDelayedExpansion

set SRC=C:\yeori-studio\
set DST=C:\Users\user\Desktop\yeori-studio\yeori-studio\

echo.
echo [sync-content] =============================================
echo [sync-content]  SRC : %SRC%
echo [sync-content]  DST : %DST%
echo [sync-content] =============================================
echo.

robocopy "%SRC%" "%DST%" /MIR ^
  /XD .git node_modules dist .cache __pycache__ .vite ^
  /XF *.log *.tmp *.pyc ^
  /R:3 /W:1 /TEE /LOG:"%DST%sync-content.log"

set RC=%ERRORLEVEL%

echo.
if %RC% LEQ 1 (
  echo [sync-content] 완료 ^(robocopy exit: %RC%^)
) else (
  echo [sync-content] 오류 발생 ^(exit: %RC%^)
  exit /b %RC%
)

endlocal
