# 광고소재 스튜디오 — 윈도우 설치 (처음 한 번). install-windows.bat 을 더블클릭하면 이 파일이 돕니다.
# 깔리는 것: Node.js · ffmpeg · yt-dlp · Git (winget) · whisper-cli(+모델) · Claude Code · 앱 패키지
# ego-browser 는 따로 설치합니다 (설치안내.md).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
function Say($m) { Write-Host "`n▶ $m" -ForegroundColor Cyan }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.local\bin" }

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget 이 없습니다. Microsoft Store 에서 '앱 설치 관리자(App Installer)'를 설치한 뒤 다시 실행하세요." }

Say "Node.js · ffmpeg · yt-dlp · Git"
foreach ($id in "OpenJS.NodeJS.LTS", "Gyan.FFmpeg", "yt-dlp.yt-dlp", "Git.Git") {
  winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Write-Host "  $id 설치 결과 코드 $LASTEXITCODE (이미 깔려 있으면 무시)" }
}
Refresh-Path

# whisper-cli: whisper.cpp 공식 릴리스의 윈도우 빌드(whisper-bin-x64.zip)를 사용자 폴더에 풀고 PATH 에 넣는다
$wdir = "$env:LOCALAPPDATA\whisper-cpp"
if (-not (Get-ChildItem $wdir -Recurse -Filter whisper-cli.exe -ErrorAction SilentlyContinue)) {
  Say "음성 인식 프로그램 (whisper-cli)"
  $rel = (Invoke-RestMethod "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10") | Where-Object { $_.assets.name -contains "whisper-bin-x64.zip" } | Select-Object -First 1
  $url = ($rel.assets | Where-Object name -eq "whisper-bin-x64.zip").browser_download_url
  $zip = "$env:TEMP\whisper-bin-x64.zip"
  Invoke-WebRequest $url -OutFile $zip
  Expand-Archive $zip -DestinationPath $wdir -Force
}
$wbin = (Get-ChildItem $wdir -Recurse -Filter whisper-cli.exe | Select-Object -First 1).DirectoryName
$up = [Environment]::GetEnvironmentVariable("Path", "User")
if ($up -notlike "*$wbin*") { [Environment]::SetEnvironmentVariable("Path", "$up;$wbin", "User") }
Refresh-Path

$model = "$env:USERPROFILE\.cache\whisper-cpp\ggml-small.bin"
if (-not (Test-Path $model)) {
  Say "음성 인식 모델 받기 (약 470MB)"
  New-Item -ItemType Directory -Force (Split-Path $model) | Out-Null
  Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -OutFile "$model.part"
  Move-Item "$model.part" $model -Force
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Say "Claude Code 설치"
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  Refresh-Path
}

Say "앱 패키지"
npm ci --no-audit --no-fund

Write-Host @"

설치 끝. 다음 순서:
  1) 새 PowerShell 창에서  claude  를 실행해 내 Claude 구독 계정으로 로그인 (끝나면 /exit)
  2) ego-browser 설치 (설치안내.md)
  3) start-windows.bat 더블클릭 -> 브라우저의 [처음 설정] 화면에서 나머지를 확인
"@ -ForegroundColor Green
