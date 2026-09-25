@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Yeori Studio - Pipeline Self Test
cd /d "%~dp0"
:: ASCII ONLY (see docs\start_yeori-notes.md).
:: Re-checks every automation fix with evidence (0 credits). Report: downloads\state\selftest\latest.md
:: Needs proxy :3001 (start_yeori.bat). Flow dry-run step needs start_gen.bat (Chrome 9222), else it is skipped.

echo ============================================================
echo   Pipeline Self Test (IG_R05 fixture, 0 credits, about 2 min)
echo ============================================================
echo.
node scripts\pipeline-selftest.js %*
echo.
if errorlevel 1 (echo   RESULT: FAIL - see report) else (echo   RESULT: ALL PASS)
start "" "%~dp0..\downloads\state\selftest\latest.md"
echo.
pause
