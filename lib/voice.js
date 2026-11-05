// 목소리 만들기 — 이 PC 에서 도는 Qwen3-TTS (Apache-2.0, mlx-audio) 로컬 서버(tts/server.py)를 부른다.
//   기본 목소리: CustomVoice 모델의 목소리 9개 + 말투 지시(instruct)
//   복제: 녹음 파일(3~15초)과 그 녹음에서 한 말로 Base 모델이 따라 말한다 — 본인 또는 허락받은 목소리만
// 복제한 목소리는 DATA_DIR/_voices/profiles/<id>/ 에 두고, 만든 소리는 리소스(목소리)로 저장해 다른 메뉴에서 쓴다.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DATA_DIR, readJson, writeJson } from "./store.js";
import { createResource, listResources, getResource } from "./resources.js";
import { WHISPER_MODEL } from "./analyze.js";

const run = promisify(execFile);
const QT = `http://127.0.0.1:${process.env.QWEN_TTS_PORT || 3910}`;
const TTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tts");
const PY = path.join(TTS_DIR, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export const VOICES_DIR = path.join(DATA_DIR, "_voices");
const PROFILES_DIR = path.join(VOICES_DIR, "profiles");

// 모델 카드의 목소리 설명 (모국어로 말할 때 가장 좋다)
export const SPEAKERS = [
  { id: "Sohee", name: "소희", desc: "따뜻하고 감정이 풍부한 여성", native: "한국어", gender: "여성" },
  { id: "Serena", name: "세레나", desc: "따뜻하고 부드러운 젊은 여성", native: "중국어", gender: "여성" },
  { id: "Vivian", name: "비비안", desc: "밝고 살짝 날카로운 젊은 여성", native: "중국어", gender: "여성" },
  { id: "Ono_Anna", name: "오노 안나", desc: "장난스럽고 가벼운 여성", native: "일본어", gender: "여성" },
  { id: "Uncle_Fu", name: "푸 아저씨", desc: "낮고 부드러운 중년 남성", native: "중국어", gender: "남성" },
  { id: "Ryan", name: "라이언", desc: "리듬감 있는 역동적인 남성", native: "영어", gender: "남성" },
  { id: "Aiden", name: "에이든", desc: "밝은 미국 남성, 또렷한 중음", native: "영어", gender: "남성" },
  { id: "Dylan", name: "딜런", desc: "맑고 자연스러운 젊은 남성 (베이징)", native: "중국어", gender: "남성" },
  { id: "Eric", name: "에릭", desc: "활기차고 살짝 허스키한 남성 (청두)", native: "중국어", gender: "남성" },
];
// 말투 지시 예시 (instruct 는 자유 문장)
export const STYLES = ["밝고 신나게", "차분하고 신뢰감 있게", "속삭이듯 부드럽게", "빠르고 힘있게 광고하듯", "슬프고 낮게", "화난 목소리로"];

async function qt(p, body, timeoutMs = 10_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${QT}${p}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`목소리 엔진: ${data.error || res.status}`);
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("목소리 엔진 응답이 너무 늦습니다");
    if (e.cause?.code === "ECONNREFUSED") throw Object.assign(new Error("목소리 엔진이 꺼져 있습니다"), { down: true });
    throw e;
  } finally { clearTimeout(t); }
}

/** 엔진 서버가 꺼져 있으면 켠다 (tts/.venv 의 파이썬으로 tts/server.py) */
async function ensureServer() {
  try { return await qt("/health", null, 3000); } catch (e) { if (!e.down) throw e; }
  await fs.access(PY).catch(() => { throw new Error("목소리 엔진이 설치되지 않았습니다 (tts/.venv 없음)"); });
  const log = await fs.open(path.join(TTS_DIR, "server.log"), "a");
  spawn(PY, [path.join(TTS_DIR, "server.py")], { cwd: TTS_DIR, detached: true, stdio: ["ignore", log.fd, log.fd], windowsHide: true }).unref();
  await log.close();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { return await qt("/health", null, 2000); } catch {}
  }
  throw new Error("목소리 엔진을 켜지 못했습니다 — tts/server.log 를 확인하세요");
}

/** 엔진 상태 (화면 상단) */
export async function voiceStatus() {
  try {
    const h = await ensureServer();
    return { up: true, engine: "Qwen3-TTS 0.6B (mlx)", models: h.models, loaded: h.loaded, ready: !!(h.models?.custom?.downloaded && h.models?.base?.downloaded) };
  } catch (e) { return { up: false, error: e.message }; }
}

/** 받지 않은 모델 받기 (약 2GB 씩) — 화면에서 확인을 받은 뒤에만 */
export async function downloadModels(emit = () => {}) {
  const h = await ensureServer();
  const hf = path.join(path.dirname(PY), process.platform === "win32" ? "hf.exe" : "hf");
  for (const k of ["custom", "base"]) {
    if (h.models[k].downloaded) continue;
    emit({ message: `목소리 모델 받는 중: ${h.models[k].repo} (약 2GB)` });
    await run(hf, ["download", h.models[k].repo, "--quiet"], { maxBuffer: 1 << 24, timeout: 60 * 60_000 });
  }
  return { ok: true };
}

// ── 복제 프로필 ──
export async function listProfiles() {
  const ids = await fs.readdir(PROFILES_DIR).catch(() => []);
  const out = [];
  for (const id of ids) { const p = await readJson(path.join(PROFILES_DIR, id, "profile.json"), null); if (p) out.push(p); }
  return out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
const MAX_REF = 15;
const probeDur = async (f) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout) || 0;

/** 15초 안쪽에서 마지막 쉼(문장 사이) 가운데 시각 — 없으면 15초 */
async function cutPoint(wav) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"], { maxBuffer: 1 << 24 });
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const mids = starts.map((s, i) => (ends[i] != null ? (s + ends[i]) / 2 : null)).filter((t) => t != null && t >= 3 && t <= MAX_REF);
  return mids.length ? Math.round(mids.at(-1) * 100) / 100 : MAX_REF;
}

/** 녹음을 whisper 로 받아 적기 (못 하면 "") */
async function transcribe(wav) {
  if (!existsSync(WHISPER_MODEL)) return "";
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vc-asr-"));
  try {
    const w16 = path.join(tmp, "a.wav");
    await run("ffmpeg", ["-v", "error", "-y", "-i", wav, "-ar", "16000", "-ac", "1", w16]);
    const { stdout } = await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "ko", "-nt", "-np", "-f", w16]);
    return stdout.replace(/\s+/g, " ").trim();
  } catch { return ""; } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}
const chars = (t) => String(t || "").replace(/\s/g, "").length;

/** 잘린 녹음을 whisper 로 받아 적어, 받아 적은 말에서 잘린 뒤에 한 문장을 덜어낸다 (남으면 그 말이 결과 앞에 붙는다) */
async function fitRefText(wav, refText) {
  if (!refText || !existsSync(WHISPER_MODEL)) return null;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vc-asr-"));
  try {
    const w16 = path.join(tmp, "a.wav");
    await run("ffmpeg", ["-v", "error", "-y", "-i", wav, "-ar", "16000", "-ac", "1", w16]);
    const { stdout } = await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "ko", "-nt", "-np", "-f", w16]);
    const heard = stdout.replace(/\s/g, "").length;
    const sents = refText.match(/[^.!?。？！]+[.!?。？！]*\s*/g) || [refText];
    let keep = "", n = 0;
    for (const s of sents) {
      const len = s.replace(/\s/g, "").length;
      if (keep && n + len > heard * 1.1 + 3) break;
      keep += s; n += len;
    }
    keep = keep.trim();
    return keep && keep !== refText ? { keep, dropped: refText.slice(keep.length).trim() } : null;
  } catch { return null; } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

/** 녹음 파일 → 24kHz 모노 wav(앞뒤 무음 정리, 최대 15초) 로 프로필 저장.
 *  15초가 넘으면 15초 안쪽 마지막 쉼에서 자르고, 받아 적은 말도 잘린 데까지만 남긴다 */
export async function cloneVoice({ name, tmp, refText = "", language = "auto" }) {
  if (!String(name || "").trim()) throw new Error("목소리 이름을 적으세요");
  const id = `vp_${Date.now()}`, dir = path.join(PROFILES_DIR, id), full = path.join(dir, "full.wav"), ref = path.join(dir, "ref.wav");
  await fs.mkdir(dir, { recursive: true });
  let src = 0, cut = 0;
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", tmp, "-ac", "1", "-ar", "24000",
      "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", full]);
    src = await probeDur(full);
    if (src > MAX_REF) cut = await cutPoint(full);
    await run("ffmpeg", ["-y", "-v", "error", "-i", full, ...(cut ? ["-t", String(cut)] : []), ref]);
    await fs.rm(full, { force: true });
  } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw new Error(`녹음 파일을 읽지 못했습니다: ${String(e.stderr || e.message).slice(0, 200)}`); }
  const dur = Math.round((await probeDur(ref)) * 10) / 10;
  if (!(dur >= 2)) { await fs.rm(dir, { recursive: true, force: true }); throw new Error(`녹음이 너무 짧습니다 (${dur || 0}초) — 3초 이상 필요합니다`); }
  const p = { id, name: name.trim(), ref_text: refText.trim(), language, duration: dur, created_at: new Date().toISOString() };
  if (cut) {
    p.cut = { from: Math.round(src * 10) / 10, to: dur };
    const fit = await fitRefText(ref, p.ref_text);
    if (fit) { p.ref_text = fit.keep; p.cut.dropped = fit.dropped; }
  }
  // 적은 말이 녹음보다 훨씬 짧거나 비었으면 엔진이 녹음의 나머지를 "아직 할 말"로 여겨 빈 소리를 낸다 → 받아 적은 말로 바꾼다
  const heard = await transcribe(ref);
  if (heard && chars(p.ref_text) < chars(heard) * 0.6) { p.ref_text_typed = p.ref_text; p.ref_text = heard; p.ref_text_auto = true; }
  await writeJson(path.join(dir, "profile.json"), p);
  return p;
}
export async function deleteProfile(id) {
  if (!/^vp_\d+$/.test(id)) throw new Error("잘못된 ID");
  await fs.rm(path.join(PROFILES_DIR, id), { recursive: true, force: true });
}

/** 문장 하나 만들기 — speaker(기본 목소리) 또는 profileId(복제) */
export async function speak({ text, speaker = "", instruct = "", profileId = "", language = "auto" }, emit = () => {}) {
  if (!String(text || "").trim()) throw new Error("읽을 문장을 적으세요");
  await ensureServer();
  const file = `v_${Date.now()}.wav`;
  const req = { text: String(text).trim(), language: language || "auto", out: path.join(VOICES_DIR, file) };
  if (profileId) {
    if (!/^vp_\d+$/.test(profileId)) throw new Error("잘못된 목소리");
    const p = await readJson(path.join(PROFILES_DIR, profileId, "profile.json"), null);
    if (!p) throw new Error("복제 목소리를 찾지 못했습니다");
    Object.assign(req, { ref_audio: path.join(PROFILES_DIR, profileId, "ref.wav"), ref_text: p.ref_text || "" });
  } else Object.assign(req, { speaker: speaker || "Sohee", instruct });
  emit({ message: "목소리 만드는 중 (처음 한 번은 모델을 올리느라 오래 걸립니다)" });
  const r = await qt("/speak", req, 10 * 60_000);
  // 앞뒤 무음(보통 1초 남짓)을 0.1초만 남기고 자른다 — 편집 프로그램에 바로 얹기 좋게
  const tmp = req.out.replace(/\.wav$/, "_t.wav");
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", req.out, "-af",
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse", tmp]);
    await fs.rename(tmp, req.out);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", req.out]);
    r.duration = Math.round(Number(stdout) * 100) / 100 || r.duration;
  } catch { await fs.rm(tmp, { force: true }); } // 못 자르면 원본 그대로
  if (!(r.duration > 0.3)) {
    await fs.rm(req.out, { force: true });
    throw new Error(profileId ? "소리가 거의 나오지 않았습니다 — 복제 녹음과 '녹음에서 한 말'이 맞지 않을 때 생깁니다. 받아 적은 말을 확인하세요" : "소리가 거의 나오지 않았습니다 — 문장을 바꿔 다시 해 보세요");
  }
  return { file, duration: r.duration, seconds: r.seconds };
}

/** 만든 소리를 리소스(목소리)로 저장 — 다른 메뉴에서 "리소스에서 고르기"로 쓴다 */
export async function saveVoiceResource({ name, file, speaker = "", instruct = "", profileId = "", language = "" }) {
  if (!/^v_\d+\.wav$/.test(file)) throw new Error("잘못된 파일");
  const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "voice-")), file);
  await fs.copyFile(path.join(VOICES_DIR, file), tmp);
  const sp = SPEAKERS.find((s) => s.id === speaker);
  const prof = profileId ? (await listProfiles()).find((p) => p.id === profileId) : null;
  return createResource({
    kind: "voice", name, tags: ["Qwen3-TTS", prof ? "복제" : "기본 목소리"],
    description: prof ? `복제 목소리 (${prof.name})` : `Qwen3-TTS 기본 목소리 ${sp?.name || speaker}${instruct ? ` · ${instruct}` : ""}`,
    attrs: { gender: sp?.gender || "", tone: instruct || sp?.desc || "", language, provider_voice_id: prof ? `qwen3:profile:${prof.id}` : `qwen3:speaker:${speaker}` },
  }, [{ tmp, name: file }]);
}

// ── 영상 메뉴(설명 영상·팟캐스트)에서 쓰는 목소리 ──
// 목소리 값: 맥 say 이름("Yuna") · "res:<리소스 id>"(목소리 설정에서 저장한 목소리) · "qwen3:profile:<vp_…>"(복제) · "qwen3:speaker:<이름>"(기본)
export const isQwenVoice = (v) => /^(res:|qwen3:(profile|speaker):)/.test(String(v || ""));

/** 고를 수 있는 목소리 — 저장한 목소리 리소스 · 복제 목소리 · 기본 목소리 */
export async function voiceChoices() {
  const res = (await listResources("voice")).filter((r) => /^qwen3:/.test(r.attrs?.provider_voice_id || ""));
  return [
    ...res.map((r) => ({ id: `res:${r.id}`, name: r.name, group: "저장한 목소리" })),
    ...(await listProfiles()).map((p) => ({ id: `qwen3:profile:${p.id}`, name: p.name, group: "복제 목소리" })),
    ...SPEAKERS.map((s) => ({ id: `qwen3:speaker:${s.id}`, name: `${s.name} (${s.native})`, group: "기본 목소리" })),
  ];
}

/** 목소리 값 → 엔진 요청 조각 */
async function resolveVoice(v) {
  let id = String(v), instruct = "";
  if (id.startsWith("res:")) {
    const r = await getResource("voice", id.slice(4));
    if (!r) throw new Error("저장한 목소리를 찾지 못했습니다 — 리소스에서 지워졌나 확인하세요");
    id = r.attrs?.provider_voice_id || "";
    const sp = SPEAKERS.find((s) => `qwen3:speaker:${s.id}` === id);
    if (sp && r.attrs?.tone && r.attrs.tone !== sp.desc) instruct = r.attrs.tone;
  }
  let m = id.match(/^qwen3:profile:(vp_\d+)$/);
  if (m) {
    const p = await readJson(path.join(PROFILES_DIR, m[1], "profile.json"), null);
    if (!p) throw new Error("복제 목소리를 찾지 못했습니다");
    return { ref_audio: path.join(PROFILES_DIR, m[1], "ref.wav"), ref_text: p.ref_text || "", language: p.language || "auto" };
  }
  m = id.match(/^qwen3:speaker:(\w+)$/);
  if (m) return { speaker: m[1], instruct, language: "korean" };
  throw new Error(`알 수 없는 목소리: ${v}`);
}

/** 문장 하나를 그 목소리로 읽어 out(wav) 에 쓰고 길이를 돌려준다 (앞뒤 무음 정리) */
export async function synthTo(voice, text, out) {
  await ensureServer();
  const raw = out.replace(/\.wav$/, "_raw.wav");
  await qt("/speak", { text: String(text).trim(), out: raw, ...(await resolveVoice(voice)) }, 10 * 60_000);
  await run("ffmpeg", ["-y", "-v", "error", "-i", raw, "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse", out]);
  await fs.rm(raw, { force: true });
  return probeDur(out);
}
