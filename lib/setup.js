// 처음 설정 — 필요한 프로그램 · Claude 구독 로그인 · 힉스필드 연결 · 저장 폴더를 한 화면에서 점검하고 고친다.
// 화면: public/setup.js (#setup). 저장 폴더를 바꾸면 서버를 다시 켜야 해서 server.js 가 종료 코드 75 로 끝내고 start.js 가 다시 띄운다.
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { toolStatus } from "./analyze.js";
import { askClaude } from "./claude.js";
import { DATA_DIR, DATA_DIR_SET } from "./store.js";
import { SUBFOLDERS, readConfig, writeConfig } from "./config.js";
import { getHfSettings } from "./higgsfield.js";

const run = promisify(execFile);
const WIN = process.platform === "win32";

// 없을 때 보여 줄 설치 방법 (install-mac.sh · install-windows.bat 가 한 번에 깐다)
const HINTS = WIN
  ? { ffmpeg: "winget install -e --id Gyan.FFmpeg", ytdlp: "winget install -e --id yt-dlp.yt-dlp", whisper: "install-windows.bat 을 다시 실행 (whisper-cli · 모델을 받습니다)", ego: "ego-browser 설치 — 설치안내.md 참고", claude: "powershell 에서: irm https://claude.ai/install.ps1 | iex" }
  : { ffmpeg: "brew install ffmpeg", ytdlp: "brew install yt-dlp", whisper: "brew install whisper-cpp 후 ./install-mac.sh 다시 실행 (모델을 받습니다)", ego: "ego-browser 설치 — 설치안내.md 참고", claude: "curl -fsSL https://claude.ai/install.sh | bash" };

async function claudeVersion() {
  try {
    const { stdout } = await run("claude", ["--version"], { shell: WIN, timeout: 20_000 });
    return stdout.trim();
  } catch { return ""; }
}

async function folderState(dir) {
  const exists = await fs.stat(dir).then((s) => s.isDirectory(), () => false);
  const subs = await Promise.all(SUBFOLDERS.map(async (s) => ({ ...s, ok: await fs.stat(path.join(dir, s.dir)).then(() => true, () => false) })));
  return { path: dir, set: DATA_DIR_SET, exists, subs };
}

/** 점검 결과 한 번에 — 오래 걸리는 Claude·힉스필드 실제 호출은 따로 (checkClaude · checkHiggsfield) */
export async function setupStatus() {
  const t = await toolStatus();
  const tools = [
    { id: "ffmpeg", label: "ffmpeg", need: "영상 분석·자르기", ok: t.ffmpeg && t.ffprobe, hint: HINTS.ffmpeg, required: true },
    { id: "ytdlp", label: "yt-dlp", need: "유튜브·인스타 링크 받기", ok: t.ytdlp, hint: HINTS.ytdlp, required: true },
    { id: "ego", label: "ego-browser", need: "메타·유튜브 광고 라이브러리 수집", ok: t.ego, hint: HINTS.ego, required: true },
    { id: "whisper", label: "음성 인식 (whisper)", need: "영상 속 말 받아쓰기", ok: t.whisper, hint: HINTS.whisper, required: false },
    { id: "ocr", label: "글자 인식", need: "이미지 속 글자 읽기 (앱에 들어 있음)", ok: t.ocr, hint: "npm ci 를 다시 실행", required: false },
  ];
  for (const x of tools) x.installable = INSTALLABLE.includes(x.id);
  const version = await claudeVersion();
  const c = readConfig();
  return {
    checks: { claude: c.claude_check || null, hf: c.hf_check || null }, // 마지막 [연결 확인] 결과 — 처음 화면 알림 띠가 쓴다
    platform: WIN ? "windows" : process.platform === "darwin" ? "mac" : process.platform,
    node: process.version,
    tools,
    claude: { installed: !!version, version, hint: HINTS.claude },
    hf: await getHfSettings(),
    data: await folderState(DATA_DIR),
    subfolders: SUBFOLDERS,
  };
}

/** Claude 구독 로그인 확인 — 짧은 질문 하나를 보내 본다 */
export async function checkClaude() {
  const r = await askClaude("연결 확인입니다. OK 라고만 답하세요.", { timeoutMs: 120_000 }).catch((e) => ({ text: "", err: e.message }));
  return remember("claude", { ok: /ok/i.test(r.text), text: r.err || r.text.slice(0, 80) });
}

/** 힉스필드 MCP 확인 — Claude 계정에 연결된 힉스필드의 잔여 크레딧 조회(크레딧이 들지 않음)를 불러 본다 */
export async function checkHiggsfield() {
  const tool = "mcp__claude_ai_Higgsfield__balance";
  const r = await askClaude(
    `${tool} 도구를 한 번 불러 결과를 확인하세요. 도구를 부를 수 있었으면 첫 줄에 HF_OK, 도구가 없거나 로그인이 필요하다는 오류면 첫 줄에 HF_NO 를 쓰고, 둘째 줄에 크레딧이나 오류를 한 줄로 적으세요.`,
    { timeoutMs: 180_000, allowedTools: [tool] },
  );
  const [first, ...rest] = r.text.trim().split("\n");
  return remember("hf", { ok: first.includes("HF_OK"), text: rest.join(" ").trim().slice(0, 160) || first.slice(0, 160) });
}

function remember(k, r) { writeConfig({ [`${k}_check`]: { ...r, at: new Date().toISOString() } }); return r; }

// ── 설치 버튼 — 미리 정해 둔 명령만 돌린다 (화면에서 고른 id 로만 고르고, 사용자 입력은 명령에 넣지 않는다) ──
const BREW = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const MODEL = path.join(os.homedir(), ".cache", "whisper-cpp", "ggml-small.bin");
const WINGET = (id) => ["winget", ["install", "-e", "--id", id, "--accept-source-agreements", "--accept-package-agreements", "--silent"]];
async function brew() { for (const b of BREW) if (await fs.stat(b).then(() => true, () => false)) return b; return ""; }

/** id → 차례로 돌릴 명령들 [[cmd, args], …] */
async function installSteps(id) {
  if (WIN) {
    const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    return {
      ffmpeg: [WINGET("Gyan.FFmpeg")],
      ytdlp: [WINGET("yt-dlp.yt-dlp")],
      whisper: [["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(app, "install-windows.ps1")]]],
      claude: [["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]]],
    }[id];
  }
  const b = await brew();
  const need = (steps) => (b ? steps : null);
  return {
    ffmpeg: need([[b, ["install", "ffmpeg"]]]),
    ytdlp: need([[b, ["install", "yt-dlp"]]]),
    whisper: need([[b, ["install", "whisper-cpp"]], ["/bin/mkdir", ["-p", path.dirname(MODEL)]], ["/usr/bin/curl", ["-fL", "-o", MODEL, MODEL_URL]]]),
    claude: [["/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"]]],
  }[id] ?? null;
}
export const INSTALLABLE = ["ffmpeg", "ytdlp", "whisper", "claude"];

/** 설치 실행 — emit 으로 출력 줄을 흘린다 (server.js 의 startJob 이 부른다) */
export async function runInstall(id, emit = () => {}) {
  if (!INSTALLABLE.includes(id)) throw new Error("설치할 수 없는 항목입니다");
  const steps = await installSteps(id);
  if (!steps) throw new Error(WIN ? "이 항목은 install-windows.bat 으로 설치하세요" : "Homebrew 가 없습니다 — 터미널에서 ./install-mac.sh 를 먼저 실행하세요");
  let failed = null;
  for (const [cmd, args] of steps) {
    emit({ level: "info", message: `$ ${path.basename(cmd)} ${args.join(" ").slice(0, 120)}` });
    await new Promise((ok, fail) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", NONINTERACTIVE: "1" }, windowsHide: true });
      const line = (d) => String(d).split(/\r?\n/).filter((x) => x.trim()).slice(-3).forEach((x) => emit({ level: "info", message: x.slice(0, 200) }));
      child.stdout.on("data", line); child.stderr.on("data", line);
      child.on("error", (e) => fail(new Error(`${path.basename(cmd)} 실행 실패: ${e.message}`)));
      child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${path.basename(cmd)} 이(가) 코드 ${code} 로 끝났습니다`))));
    }).catch((e) => { failed = e; });
    if (failed) break;
  }
  // 새로 깐 프로그램이 이 서버에서 바로 보이게 경로를 더한다
  if (!WIN) for (const d of ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")]) if (!process.env.PATH.split(":").includes(d)) process.env.PATH = `${d}:${process.env.PATH}`;
  // brew 는 설치를 끝내고도 정리 단계 경고로 1 을 돌려줄 때가 있다 — 실제로 깔렸는지 다시 본다
  if (failed) {
    const now = id === "claude" ? !!(await claudeVersion()) : (await toolStatus())[id === "ffmpeg" ? "ffmpeg" : id];
    if (!now) throw failed;
    emit({ level: "warn", message: `${failed.message} — 그래도 설치는 확인됐습니다` });
  }
  return { id, installed: true, restartHint: WIN };
}

/** Claude 로그인 — 로그인은 브라우저 인증이라 앱이 대신 못 한다. 터미널을 열어 claude 를 실행해 준다 */
export async function openClaudeLogin() {
  if (process.platform === "darwin") {
    await run("osascript", ["-e", 'tell application "Terminal" to do script "claude"', "-e", 'tell application "Terminal" to activate']);
    return { opened: "Terminal" };
  }
  if (WIN) {
    spawn("cmd", ["/c", "start", "", "powershell", "-NoExit", "-Command", "claude"], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { opened: "PowerShell" };
  }
  throw new Error("이 운영체제에서는 터미널을 직접 열어 claude 를 실행하세요");
}

/** 이 PC 의 폴더 고르기 창을 띄운다 → 고른 절대 경로 (취소하면 "") */
export async function pickFolder() {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "광고소재 스튜디오 저장 폴더를 고르세요")'], { timeout: 10 * 60_000 });
      return stdout.trim().replace(/\/$/, "");
    } catch { return ""; }
  }
  if (WIN) {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = '광고소재 스튜디오 저장 폴더를 고르세요'",
      "$d.ShowNewFolderButton = $true",
      "if ($d.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }",
    ].join("; ");
    try {
      const { stdout } = await run("powershell", ["-NoProfile", "-STA", "-Command", ps], { timeout: 10 * 60_000 });
      return stdout.trim();
    } catch { return ""; }
  }
  return "";
}

/** 저장 폴더를 정하고 안에 하위 폴더를 만든다. 다음에 켤 때부터 이 폴더를 쓴다 */
export async function setDataDir(dir) {
  dir = String(dir || "").trim();
  if (!dir || !path.isAbsolute(dir)) throw Object.assign(new Error("폴더 전체 경로를 적어 주세요 (예: /Users/이름/Documents/광고소재 또는 D:\\광고소재)"), { status: 400 });
  dir = path.resolve(dir);
  await fs.mkdir(dir, { recursive: true });
  for (const s of SUBFOLDERS) await fs.mkdir(path.join(dir, s.dir), { recursive: true });
  const probe = path.join(dir, ".write-test");
  try { await fs.writeFile(probe, "ok"); await fs.unlink(probe); }
  catch { throw Object.assign(new Error("이 폴더에 쓸 수 없습니다 — 권한을 확인하거나 다른 폴더를 고르세요"), { status: 400 }); }
  writeConfig({ dataDir: dir });
  return { path: dir, restart: path.resolve(DATA_DIR) !== dir };
}
