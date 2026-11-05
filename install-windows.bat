@echo off
chcp 65001 >nul
rem 광고소재 스튜디오 - 윈도우 설치 (처음 한 번). 더블클릭하세요.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
pause
