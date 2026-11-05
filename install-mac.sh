#!/bin/bash
# 광고소재 스튜디오 — 맥 설치 (처음 한 번). 터미널에서: ./install-mac.sh
# 깔리는 것: Homebrew · Node.js · ffmpeg · yt-dlp · whisper-cpp(+모델) · Claude Code · 앱 패키지
# ego-browser 는 따로 설치합니다 (설치안내.md).
set -e
cd "$(dirname "$0")"
say() { printf "\n\033[1;34m▶ %s\033[0m\n" "$1"; }

if ! command -v brew >/dev/null 2>&1; then
  say "Homebrew 설치 (맥 비밀번호를 물어볼 수 있습니다)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"

say "Node.js · ffmpeg · yt-dlp · whisper-cpp · git"
brew install node ffmpeg yt-dlp whisper-cpp git

MODEL="$HOME/.cache/whisper-cpp/ggml-small.bin"
if [ ! -f "$MODEL" ]; then
  say "음성 인식 모델 받기 (약 470MB)"
  mkdir -p "$(dirname "$MODEL")"
  curl -fL -o "$MODEL.part" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin && mv "$MODEL.part" "$MODEL"
fi

if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
  say "Claude Code 설치"
  curl -fsSL https://claude.ai/install.sh | bash
fi

say "앱 패키지"
npm ci --no-audit --no-fund
chmod +x start-mac.command

cat <<'MSG'

✅ 설치 끝. 다음 순서:
  1) 새 터미널 창에서  claude  를 실행해 내 Claude 구독 계정으로 로그인 (끝나면 /exit)
  2) ego-browser 설치 (설치안내.md)
  3) start-mac.command 를 더블클릭 → 브라우저의 [처음 설정] 화면에서 나머지를 확인
MSG
