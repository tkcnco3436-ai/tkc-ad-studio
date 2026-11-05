// 팟캐스트 릴스 (전자책 낭독형) — 흰 종이에 글이 놓이고 읽는 대로 아래로 흘러가며 단어가 짙어진다 (매직 텍스트)
// 주제 → Claude 가 낭독 대본(JSON, 내레이터 1명 또는 2명 대화) → 음성(macOS say 로 진행자마다 다른 목소리, 또는 파일 올리기) → 브라우저 캔버스로 그림
// → 프레임을 한 장씩 받아 ffmpeg 로 mp4 (탭이 뒤에 있어도 된다)
// 저장: <DATA_DIR>/_podcasts/pc_…/ (project.json · audio.m4a · out.mp4)
import fs from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { DATA_DIR } from "./store.js";
import { askClaude, extractJson } from "./claude.js";
import { run, wordTimes } from "./explainer.js";
import { makeLibrary, makeThumb, mediaInfo } from "./library.js";
import { isQwenVoice, synthTo } from "./voice.js";
import { resourceImage } from "./resources.js";

const ROOT = path.join(DATA_DIR, "_podcasts");
const dirOf = (id) => path.join(ROOT, id);
const fileOf = (id) => path.join(dirOf(id), "project.json");
const GAP = 0.32; // 줄 사이 숨 고르기 (초)

export const SAY_VOICES = ["Yuna", "Eddy", "Reed", "Flo", "Sandy", "Shelley", "Rocko", "Grandma", "Grandpa"];
const DEFAULT_HOSTS = [
  { name: "유나", voice: "Yuna", color: "#ff7a59" },
  { name: "에디", voice: "Eddy", color: "#4fa3ff" },
];

// 템플릿 이름 — 그림은 public/podcast.js 의 TEMPLATES 가 그린다
export const TEMPLATES = { ebook: "전자책", radio: "라디오 스튜디오" };
// 예전 프로젝트(theme 만 있던 때)는 전자책 + 종이색으로 옮긴다
const OLD_THEMES = { paper: {}, cream: { paper: "#f7f1e5", ink: "#261e16" }, dark: { paper: "#111214", ink: "#f5f5f0" } };
const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
function normalize(p) {
  if (!TEMPLATES[p.template]) { p.template = "ebook"; p.style = { ...(OLD_THEMES[p.theme] || {}), ...obj(p.style) }; }
  p.style = obj(p.style); delete p.theme;
  return p;
}
export const podcastLib = makeLibrary(ROOT, ["styles"]);

const save = async (p) => { p.updatedAt = new Date().toISOString(); await fs.writeFile(fileOf(p.id), JSON.stringify(p, null, 2)); return p; };
const str = (x, d = "") => String(x ?? d).trim();

export async function listPodcasts() {
  if (!existsSync(ROOT)) return [];
  const out = [];
  for (const id of await fs.readdir(ROOT)) {
    if (!id.startsWith("pc_")) continue;
    try {
      const p = normalize(JSON.parse(await fs.readFile(fileOf(id), "utf8")));
      out.push({ id, topic: p.topic, title: p.title, template: p.template, templateName: TEMPLATES[p.template], count: p.lines.length, hasAudio: !!p.audio, ...(await mediaInfo(dirOf(id), p)), updatedAt: p.updatedAt });
    } catch {}
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getPodcast(id) {
  try { return normalize(JSON.parse(await fs.readFile(fileOf(id), "utf8"))); } catch { return null; }
}

export async function createPodcast({ topic = "", seconds = 60, show = "궁금증 라디오", episode = "EP.01", cast = 1, template = "ebook", style = {} } = {}) {
  const id = `pc_${Date.now()}`;
  await fs.mkdir(dirOf(id), { recursive: true });
  return save({
    id, topic: str(topic), seconds: Number(seconds) || 60, title: "", show: str(show, "궁금증 라디오"), episode: str(episode), template: TEMPLATES[template] ? template : "ebook", style: obj(style), cast: Number(cast) === 2 ? 2 : 1,
    hosts: DEFAULT_HOSTS.map((h) => ({ ...h })), lines: [], audio: null, timing: null, words: null, levels: null, video: null, createdAt: new Date().toISOString(),
  });
}

const cleanHost = (h, i) => ({ name: str(h?.name, DEFAULT_HOSTS[i].name), voice: SAY_VOICES.includes(h?.voice) || isQwenVoice(h?.voice) ? h.voice : DEFAULT_HOSTS[i].voice, color: /^#[0-9a-f]{6}$/i.test(h?.color) ? h.color : DEFAULT_HOSTS[i].color,
  photo: /^host[01]_\d+\.(jpe?g|png|webp)$/.test(h?.photo || "") ? h.photo : "" }); // 인물 라디오·라디오 동그라미에 쓰는 진행자 사진
const cleanLine = (l) => ({ speaker: Number(l?.speaker) === 1 ? 1 : 0, text: str(l?.text) });

/** 대본·설정을 고친다. 대본 글이 바뀌면 줄 시각이 어긋나므로 지운다 (음성을 다시 만들어야 맞는다) */
export async function updatePodcast(id, patch) {
  const p = await getPodcast(id);
  if (!p) throw Object.assign(new Error("없음"), { status: 404 });
  for (const k of ["title", "topic", "show", "episode"]) if (patch[k] !== undefined) p[k] = str(patch[k]);
  if (TEMPLATES[patch.template]) p.template = patch.template;
  if (patch.style !== undefined) p.style = obj(patch.style);
  if ([1, 2].includes(Number(patch.cast))) p.cast = Number(patch.cast);
  if (Array.isArray(patch.hosts) && patch.hosts.length === 2) p.hosts = patch.hosts.map(cleanHost);
  if (Array.isArray(patch.lines)) {
    const key = (ls) => ls.map((l) => `${l.speaker}:${l.text}`).join("\n");
    const lines = patch.lines.map(cleanLine);
    if (key(lines) !== key(p.lines)) p.timing = null;
    p.lines = lines;
  }
  return save(p);
}

export async function deletePodcast(id) {
  if (!/^pc_\d+$/.test(id)) return;
  await fs.rm(dirOf(id), { recursive: true, force: true });
}

export async function writeScript(id, emit = () => {}) {
  const p = await getPodcast(id);
  if (!p) throw new Error("없음");
  const [a, b] = p.hosts, duo = p.cast === 2;
  const who = duo
    ? `두 진행자가 주고받는 대화다. 진행자: 0 = ${a.name} (질문하고 정리하는 쪽), 1 = ${b.name} (설명하는 쪽). 번갈아 말하되 같은 사람이 두 번 이어도 된다.`
    : `${a.name} 한 사람이 차분히 읽어 주는 오디오 에세이(전자책 낭독)다. 모든 줄의 speaker 는 0.`;
  const prompt = `세로 쇼츠(9:16) "팟캐스트 릴스" 대본을 쓴다. 화면은 흰 종이에 글이 놓이고, 읽는 대로 아래로 흘러가며 읽은 단어가 짙어진다.
주제: "${p.topic}"
프로그램: ${p.show}
${who}
길이: 약 ${p.seconds}초 (한국어 1초에 약 6~7글자, 줄 사이 쉼 포함).

규칙:
- 한 줄 = 화면의 한 문단. 한두 문장, 25~70자. 읽기 좋은 글이면서 소리 내어 읽어도 자연스럽게.
- 첫 줄은 붙잡는 질문이나 의외의 사실 한 문장.
- 줄 수 ${Math.max(5, Math.round(p.seconds / 6))}개 안팎.
- 확인된 사실만 숫자·연도로 쓴다. 불확실하면 숫자를 빼고 말한다. 주제의 전제가 사실과 다르면 앞쪽에서 바로잡는다.
- 숫자·영어는 소리 내어 읽는 한글로 쓴다 (예: "천구백사십육 년", "에이아이").
- 마지막 줄은 여운 있게 한 문장으로 맺는다 (구독·좋아요 부탁은 쓰지 않는다).

JSON 하나만 답한다:
{"title":"제목","lines":[{"speaker":0,"text":"…"}]}`;
  emit({ message: "Claude 가 대본을 쓰는 중 (1~2분)" });
  const { text } = await askClaude(prompt, { cwd: dirOf(id), allowedTools: [] });
  const j = extractJson(text);
  if (!Array.isArray(j.lines) || !j.lines.length) throw new Error("대본이 비어 있습니다");
  p.title = str(j.title, p.topic);
  p.lines = j.lines.map(cleanLine).filter((l) => l.text).map((l) => (duo ? l : { ...l, speaker: 0 }));
  p.timing = null;
  emit({ message: `대사 ${p.lines.length}줄` });
  return save(p);
}

function probe(file) {
  return new Promise((ok, fail) => {
    const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", fail);
    c.on("close", (code) => (code === 0 ? ok(parseFloat(o)) : fail(new Error("ffprobe 실패"))));
  });
}

/** 소리 크기 곡선 — 1/30초마다 RMS (0~1). 파형·말하는 사람 테두리에 쓴다 */
function levels(file) {
  return new Promise((ok, fail) => {
    const c = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
    const bufs = []; c.stdout.on("data", (d) => bufs.push(d)); c.on("error", fail);
    c.on("close", (code) => {
      if (code !== 0) return fail(new Error("소리 크기 계산 실패"));
      const pcm = Buffer.concat(bufs), n = Math.floor(pcm.length / 2), step = Math.round(8000 / 30), out = [];
      for (let i = 0; i < n; i += step) {
        let s = 0; const e = Math.min(n, i + step);
        for (let k = i; k < e; k++) { const v = pcm.readInt16LE(k * 2) / 32768; s += v * v; }
        out.push(Math.sqrt(s / Math.max(1, e - i)));
      }
      const max = Math.max(0.0001, ...out.slice().sort((x, y) => x - y).slice(Math.floor(out.length * 0.98)));
      ok(out.map((v) => Math.round(Math.min(1, v / max) * 100) / 100));
    });
  });
}

/** 줄마다 진행자 목소리(목소리 설정의 목소리 또는 macOS say)를 입혀 이어 붙인다. 줄 경계 시각이 정확히 남는다 */
export async function voiceLines(id, emit = () => {}) {
  const p = await getPodcast(id);
  if (!p?.lines.length) throw new Error("대본이 없습니다");
  if (process.platform !== "darwin" && p.lines.some((l) => !isQwenVoice(p.hosts[l.speaker].voice))) throw new Error("임시 음성(say)은 맥에서만 됩니다. 목소리 설정의 목소리를 고르거나 음성 파일을 올리세요");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pc-say-"));
  try {
    const parts = [], timing = [];
    const sil = path.join(tmp, "gap.wav");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(GAP), sil]);
    let t = 0.2; parts.push(path.join(tmp, "lead.wav"));
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.2", parts[0]]);
    for (const [i, l] of p.lines.entries()) {
      const h = p.hosts[l.speaker], aiff = path.join(tmp, `${i}.aiff`), wav = path.join(tmp, `${i}.wav`);
      emit({ message: `${i + 1}/${p.lines.length} ${h.name} 읽는 중` });
      if (isQwenVoice(h.voice)) {
        const raw = path.join(tmp, `${i}_q.wav`);
        await synthTo(h.voice, l.text, raw);
        await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-ar", "44100", "-ac", "1", wav]);
      } else {
        await fs.writeFile(path.join(tmp, `${i}.txt`), l.text);
        await run("say", ["-v", h.voice, "-r", "185", "-f", path.join(tmp, `${i}.txt`), "-o", aiff]);
        await run("ffmpeg", ["-v", "error", "-y", "-i", aiff, "-ar", "44100", "-ac", "1", wav]);
      }
      const d = await probe(wav);
      timing.push({ t0: t, t1: t + d }); t += d + GAP;
      parts.push(wav, sil);
    }
    const list = path.join(tmp, "list.txt");
    await fs.writeFile(list, parts.map((f) => `file '${f}'`).join("\n"));
    const out = path.join(dirOf(id), "audio.m4a");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "aac", "-b:a", "160k", out]);
    p.audio = "audio.m4a"; p.timing = timing; p.words = null; p.voiced = p.hosts.map((h) => h.voice);
    emit({ message: "소리 크기 계산 중" });
    p.levels = await levels(out);
    return save(p);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** 녹음한 파일을 올리면 whisper 단어 시각으로 줄 경계를 맞춘다 */
export async function setAudio(id, tmpFile, emit = () => {}) {
  const p = await getPodcast(id);
  if (!p) throw new Error("없음");
  const out = path.join(dirOf(id), "audio.m4a");
  emit({ message: "음성 변환 중" });
  await run("ffmpeg", ["-v", "error", "-y", "-i", tmpFile, "-vn", "-c:a", "aac", "-b:a", "160k", out]);
  p.audio = "audio.m4a"; p.timing = null; p.voiced = null;
  p.words = await wordTimes(out, emit);
  p.levels = await levels(out);
  return save(p);
}

// ── 굽기: 브라우저가 프레임을 한 장씩 보내면 모아서 mp4 ──
const framesDir = (id) => path.join(dirOf(id), "_frames");
export async function renderStart(id) {
  if (!(await getPodcast(id))) throw new Error("없음");
  await fs.rm(framesDir(id), { recursive: true, force: true });
  await fs.mkdir(framesDir(id), { recursive: true });
  return { ok: true };
}
export function renderFrame(id, i, req) {
  const f = path.join(framesDir(id), `${String(Number(i) || 0).padStart(5, "0")}.jpg`);
  return new Promise((ok, fail) => { const w = createWriteStream(f); req.pipe(w); w.on("finish", ok); w.on("error", fail); req.on("error", fail); });
}
// mp4 화질 — high 는 브라우저가 1080×1920 으로 그려 보낸다 (늘린 게 아니라 진짜 1080)
const QUALITY = { small: { crf: 26, audio: "128k" }, std: { crf: 19, audio: "160k" }, high: { crf: 17, audio: "192k" } };
export async function renderFinish(id, emit = () => {}, quality = "std") {
  const q = QUALITY[quality] || QUALITY.std;
  const p = await getPodcast(id);
  if (!p) throw new Error("없음");
  const out = path.join(dirOf(id), "out.mp4"), args = ["-v", "error", "-y", "-framerate", "30", "-i", path.join(framesDir(id), "%05d.jpg")];
  if (p.audio) args.push("-i", path.join(dirOf(id), p.audio), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", q.audio);
  emit({ message: "mp4 로 묶는 중" });
  await run("ffmpeg", [...args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", String(q.crf), "-movflags", "+faststart", out]);
  await fs.rm(framesDir(id), { recursive: true, force: true });
  p.video = "out.mp4"; p.quality = QUALITY[quality] ? quality : "std";
  p.duration = await makeThumb(dirOf(id)).catch(() => 0);
  return save(p);
}

/** 진행자 사진 — 올린 파일(src) 또는 리소스 인물({ kind, id })의 첫 사진 */
export async function setHostPhoto(id, i, { src, name, resource } = {}) {
  const p = await getPodcast(id);
  if (!p) throw new Error("없음");
  const k = Number(i) === 1 ? 1 : 0;
  if (resource) { const r = await resourceImage(resource.kind || "person", resource.id); if (!r) throw new Error("그 리소스에 사진이 없습니다"); src = r.file; name = r.file; }
  const ext = path.extname(name || src || "").toLowerCase();
  if (!/^\.(jpe?g|png|webp)$/.test(ext)) throw new Error("사진(jpg·png·webp)만 넣을 수 있습니다");
  const file = `host${k}_${Date.now()}${ext === ".jpeg" ? ".jpg" : ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  if (p.hosts[k].photo) await fs.rm(path.join(dirOf(id), p.hosts[k].photo), { force: true });
  p.hosts[k].photo = file;
  return save(p);
}
