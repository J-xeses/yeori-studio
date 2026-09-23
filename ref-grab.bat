@echo off
chcp 65001 >nul
title 레퍼런스 자동 정리 (ref-grab)
cd /d C:\yeori-studio\app
echo ================================================
echo  레퍼런스 자동 정리 - 핀터레스트 핀 링크 / mp4 링크
echo  여러 개는 띄어쓰기로 구분해서 한 번에 붙여넣기 가능
echo  빈 줄에서 Enter = 끝내고 갤러리 열기
echo ================================================
:loop
echo.
set "LINKS="
set /p "LINKS=링크: "
if "%LINKS%"=="" goto done
set "NOTE="
set /p "NOTE=메모(없으면 Enter): "
if "%NOTE%"=="" (
  node scripts\ref-grab.mjs %LINKS%
) else (
  node scripts\ref-grab.mjs %LINKS% "--note=%NOTE%"
)
goto loop
:done
start "" "C:\yeori-studio\downloads\_shared\references\teaser\index.html"
