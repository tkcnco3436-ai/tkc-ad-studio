@echo off
chcp 65001 >nul
rem 광고소재 스튜디오 켜기 (윈도우) - 더블클릭. 이 창을 닫으면 앱도 꺼집니다.
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
if exist .git (git pull --ff-only --quiet || echo 업데이트를 받지 못했습니다 - 지금 버전으로 켭니다)
if not exist node_modules\.lock-hash goto install
for /f %%h in ('certutil -hashfile package-lock.json SHA1 ^| findstr /v ":"') do set "NEWHASH=%%h"
set /p OLDHASH=<node_modules\.lock-hash
if "%NEWHASH%"=="%OLDHASH%" goto run
:install
call npm ci --no-audit --no-fund
for /f %%h in ('certutil -hashfile package-lock.json SHA1 ^| findstr /v ":"') do echo %%h> node_modules\.lock-hash
:run
node start.js --open
pause
