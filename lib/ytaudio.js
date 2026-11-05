// 유튜브에서 목소리 가져오기 — 링크 + 구간(시작·끝) → yt-dlp 로 소리만 받기 → ffmpeg 로 잘라 mp3 → (60초 이하면) whisper 로 받아 적기
// 결과는 <DATA_DIR>/_voices/yt_<시각>.mp3 — 목소리 복제(녹음으로 복제)에 넣거나 리소스(목소리)로 저장한다.
// 본인 영상이거나 허락받은 목소리만 쓴다 (화면에서 확인을 받는다).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { VOICES_DIR } from "./voice.js";
import { WHISPER_MODEL } from "./analyze.js";
import { createResource } from "./resources.js";

const YT = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
const MAX_LEN = 600; // 한 번에 자를 수 있는 길이 (초)

function run(cmd, args, { capture = false } = {}) {
  return new Promise((ok, fail) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("error", (e) => fail(new Error(`${cmd} 실행 실패: ${e.message}`)));
    c.on("close", (code) => (code === 0 ? ok(capture ? out : "") : fail(new Error(`${cmd} 종료 코드 ${code}: ${err.slice(-300)}`))));
  });
}
/** "1:23" · "01:02:03" · "83" · "83.5" → 초 */
export function toSec(v) {
  const s = String(v ?? "").trim(); if (!s) return null;
  if (!/^[\d:.]+$/.test(s)) throw new Error(`시간 형식이 이상합니다: ${s} (예: 1:23 또는 83)`);
  return s.split(":").reduce((a, x) => a * 60 + Number(x), 0);
}
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

export async function extractYoutubeAudio({ url, start = "", end = "", denoise = true } = {}, emit = () => {}) {
  url = String(url || "").trim();
  if (!YT.test(url)) throw new Error("유튜브 링크를 넣으세요 (youtube.com · youtu.be)");
  const t0 = toSec(start) ?? 0, t1 = toSec(end);
  if (t1 != null && t1 <= t0) throw new Error("끝 시간이 시작보다 뒤여야 합니다");
  if (t1 != null && t1 - t0 > MAX_LEN) throw new Error(`한 번에 ${MAX_LEN / 60}분까지만 자를 수 있습니다`);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ytvoice-"));
  try {
    emit({ message: "유튜브 영상 정보 확인 중" });
    const title = (await run("yt-dlp", ["--no-playlist", "--print", "%(title)s", "--skip-download", url], { capture: true }).catch(() => "")).trim().split("\n")[0] || "유튜브";
    emit({ message: `"${title.slice(0, 40)}" 소리만 받는 중` });
    // 구간만 받으면 빠르다 (yt-dlp --download-sections). 끝이 없으면 시작부터 MAX_LEN 까지
    const sec = `*${t0}-${t1 ?? t0 + MAX_LEN}`;
    await run("yt-dlp", ["--no-playlist", "-f", "bestaudio/best", "--download-sections", sec, "--force-keyframes-at-cuts", "-o", path.join(tmp, "src.%(ext)s"), url]);
    const src = (await fs.readdir(tmp)).find((f) => f.startsWith("src."));
    if (!src) throw new Error("소리를 받지 못했습니다");
    await fs.mkdir(VOICES_DIR, { recursive: true });
    const file = `yt_${Date.now()}.mp3`, out = path.join(VOICES_DIR, file);
    // 잡음 줄이기: 저역 웅웅·고역 쉿 소리를 깎고(대역) FFT 잡음 제거, 크기를 맞춘다 — 배경음악은 다 지우지 못한다
    const af = denoise ? ["-af", "highpass=f=80,lowpass=f=9000,afftdn=nf=-25,loudnorm=I=-18:TP=-2"] : ["-af", "loudnorm=I=-18:TP=-2"];
    emit({ message: "mp3 로 자르는 중" });
    await run("ffmpeg", ["-v", "error", "-y", "-i", path.join(tmp, src), ...(t1 != null ? ["-t", String(t1 - t0)] : ["-t", String(MAX_LEN)]), ...af, "-ac", "1", "-ar", "44100", "-b:a", "192k", out]);
    const duration = parseFloat(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { capture: true })) || 0;
    // 받아 적기 — 복제할 때 "녹음에서 한 말" 로 쓰면 더 닮는다 (60초 이하만)
    let text = "";
    if (duration <= 60 && existsSync(WHISPER_MODEL)) {
      emit({ message: "whisper 로 받아 적는 중" });
      const wav = path.join(tmp, "a.wav"), base = path.join(tmp, "a");
      await run("ffmpeg", ["-v", "error", "-y", "-i", out, "-ar", "16000", "-ac", "1", wav]);
      await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "auto", "-f", wav, "-otxt", "-of", base, "-np"]).catch(() => {});
      text = (await fs.readFile(`${base}.txt`, "utf8").catch(() => "")).replace(/\s+/g, " ").trim();
    }
    return { file, url: `/data/_voices/${file}`, title, duration: Math.round(duration * 10) / 10, range: `${fmt(t0)}–${fmt(t0 + duration)}`, source: url, text };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** 자른 mp3 를 리소스(목소리)로 저장 — 출처 링크·구간을 같이 남긴다 */
export async function saveYoutubeVoice({ file, name, source = "", range = "", text = "" } = {}) {
  if (!/^yt_\d+\.mp3$/.test(String(file))) throw new Error("잘못된 파일");
  const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ytsave-")), file);
  await fs.copyFile(path.join(VOICES_DIR, file), tmp);
  return createResource({
    kind: "voice", name: String(name || "유튜브 목소리").trim(), tags: ["유튜브"],
    description: `유튜브에서 자른 목소리${range ? ` (${range})` : ""}${source ? ` — ${source}` : ""}${text ? `\n받아 적은 말: ${text}` : ""}`,
    attrs: { provider_voice_id: source ? `youtube:${source}#${range}` : "" },
  }, [{ tmp, name: file }]);
}
