@echo off
chcp 65001 >nul
cd /d C:\yeori-studio\app
node scripts\account-preview.mjs
start "" "C:\yeori-studio\downloads\seoyeori\IG\_account\preview.html"
