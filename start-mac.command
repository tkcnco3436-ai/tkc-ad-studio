#!/bin/bash
# 광고소재 스튜디오 켜기 (맥) — 더블클릭. 이 창을 닫으면 앱도 꺼집니다.
cd "$(dirname "$0")"
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
export PATH="$HOME/.local/bin:$PATH"
# 사내 저장소에서 받은 경우 새 버전을 받는다 (실패해도 그냥 켠다)
if [ -d .git ]; then git pull --ff-only --quiet || echo "업데이트를 받지 못했습니다 — 지금 버전으로 켭니다"; fi
# 패키지가 바뀌었으면 다시 깐다
if [ ! -f node_modules/.lock-hash ] || [ "$(shasum package-lock.json | cut -d' ' -f1)" != "$(cat node_modules/.lock-hash)" ]; then
  npm ci --no-audit --no-fund && shasum package-lock.json | cut -d' ' -f1 > node_modules/.lock-hash
fi
node start.js --open
