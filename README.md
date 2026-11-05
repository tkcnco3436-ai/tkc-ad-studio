# 광고소재 스튜디오 (tkc-ad-studio)

경쟁사 광고 수집 · 이미지 변형 · 광고 자동화 · 영상 복제 · 릴스 제작을 **내 PC 에서** 돌리는 도구입니다.
각자 자기 PC 에 설치하고, 자기 Claude 구독 계정과 자기 힉스필드 계정으로 씁니다.

## Claude Code 로 설치하기 (추천)

빈 폴더에서 Claude Code 에게:

```
https://github.com/tkcnco3436-ai/tkc-ad-studio 받아서 CLAUDE.md 대로 설치해줘
```

직접 해야 하는 단계(비밀번호 · ego lite 설치 · 힉스필드 연결 · 저장 폴더)는 Claude 가 멈추고 안내합니다.

## 빠른 시작 (손으로)

```bash
git clone https://github.com/tkcnco3436-ai/tkc-ad-studio.git
cd tkc-ad-studio
```

| | 맥 | 윈도우 |
|---|---|---|
| 1. 설치 (처음 한 번) | `./install-mac.sh` | `install-windows.bat` 더블클릭 |
| 2. Claude 로그인 | 새 터미널에서 `claude` → 내 구독 계정으로 로그인 → `/exit` | PowerShell 에서 같게 |
| 3. 켜기 | `start-mac.command` 더블클릭 | `start-windows.bat` 더블클릭 |

브라우저에 http://localhost:5179 가 열리고 **처음 설정** 화면에서 나머지(힉스필드 연결 · 저장 폴더)를 안내합니다.
켤 때마다 이 저장소의 새 버전을 자동으로 받습니다.

자세한 순서와 문제 해결은 [설치안내.md](설치안내.md) 를 보세요.
