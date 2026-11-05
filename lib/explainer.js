// 3D 설명 영상 — 힉스필드 없이 코드(Three.js)로 그리는 쇼츠. 화풍은 늘 복셀(3D 픽셀) 세상 + 빨간 모자 주인공.
// 주제 → Claude 가 장면 대본(JSON) → 음성(올리기 또는 macOS say 임시 음성) → whisper 단어 시각 → 브라우저에서 장면·자막 재생·녹화 → ffmpeg mp4
// 저장: <DATA_DIR>/_explainers/ex_…/ (project.json · audio.m4a · out.mp4)
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { DATA_DIR } from "./store.js";
import { askClaude, extractJson } from "./claude.js";
import { WHISPER_MODEL } from "./analyze.js";
import { makeLibrary, makeThumb, mediaInfo } from "./library.js";
import { isQwenVoice, synthTo } from "./voice.js";

const ROOT = path.join(DATA_DIR, "_explainers");
const dirOf = (id) => path.join(ROOT, id);
const fileOf = (id) => path.join(dirOf(id), "project.json");

// 템플릿별 장면 종류 — public/explainer-<템플릿>.js 의 SCENES·TYPES 와 이름이 같아야 한다. 설명은 대본 프롬프트에 그대로 들어간다
export const TEMPLATES = {
  voxel: {
    name: "복셀 세상",
    look: "화면은 늘 복셀(정육면체 블록) 미니어처 세상이고 주인공 캐릭터가 나온다. 실제 사진·지도가 필요한 장면은 없으니 장면 종류로 비유한다.",
    scenes: {
  title: "떠 있는 잔디 섬 위에 빨간 모자 아이(주인공)가 서 있고 위에 큰 제목. 첫 장면·질문 던지기 (chip 이 큰 제목)",
  globe: "블록으로 지은 지구본이 돌다가 핀 꽂힌 나라로 돈다. 세계·나라 비교 (value: 위도,경도[,orange] 를 | 로 이음. 예 37.5,127|35.7,139.7,orange)",
  road: "도로를 자동차들이 달리고 차로에 방향 화살표. 운전·교통 (value: left 또는 right — 차가 다니는 쪽)",
  walk: "넓은 보도를 사람들이 양쪽으로 걷고 바닥에 파란 화살표. 걷기·보행·사람들 (value: left 또는 right — 사람이 걷는 쪽)",
  rail: "역 승강장에 노란 전차가 서 있다 출발한다. 기차·지하철·역 (value: left 또는 right — 전차가 서는 선로)",
  town: "블록 마을 전경을 위에서 돈다. 나라·사회·역사·생활 (value: old 면 빛바랜 옛날 마을, 차 없음)",
  compare: "두 작은 섬을 나란히 놓고 위에 라벨 두 개. 둘 비교 (value: 왼쪽 라벨|오른쪽 라벨. 라벨에 '차'가 들어가면 그 섬엔 자동차)",
  stat: "금색 블록 숫자가 하늘에서 떨어져 쌓인다. 수치·연도 강조 (value 필수: 숫자만, 단위는 chip)",
  ending: "주인공이 손을 흔들고 머리 위에 금색 블록 별이 돈다. 마지막 장면·마무리",
},
  },
  classic: {
    name: "클래식",
    look: "어두운 바탕 위 매끈한 3D. 인터넷·기술 주제에 맞춘 장면들이다.",
    scenes: {
      title: "검은 바탕에 큰 제목 한 줄과 떠다니는 빛 입자. 첫 장면·질문 던지기",
      globe: "도는 지구본 위로 도시들을 잇는 선이 그려진다. 세계·네트워크·연결·규모",
      fiber: "투명한 관 속을 빛 펄스가 지나간다. 광섬유·데이터 전송·속도",
      wifi: "책상 위 공유기에서 파란 전파 고리가 퍼진다. 무선·집·일상 기기",
      datacenter: "서버 랙이 줄지은 흰 복도를 카메라가 앞으로 지나간다. 서버·클라우드·회사",
      ocean: "푸른 바닷속 모래 바닥에 굵은 관이 누워 있고 거품이 오른다. 바다·해저·자연",
      stat: "어두운 바탕에 큰 숫자가 0에서 올라간다. 수치·통계 강조 (value 필수: 숫자만, 단위는 chip)",
      ending: "형광 네 꼭짓점 별이 반짝인다. 마지막 장면·마무리",
    },
  },
};
const ALL_TYPES = new Set(Object.values(TEMPLATES).flatMap((t) => Object.keys(t.scenes)));
// template 이 없는 예전 프로젝트: 클래식 전용 장면을 쓰면 클래식, 아니면 복셀
const CLASSIC_ONLY = ["fiber", "wifi", "datacenter", "ocean"];
const templateOf = (p) => (TEMPLATES[p.template] ? p.template : p.scenes?.some((s) => CLASSIC_ONLY.includes(s.type)) ? "classic" : "voxel");
const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

export const run = (cmd, args) => new Promise((ok, fail) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  child.on("error", (e) => fail(new Error(`${cmd} 실행 실패: ${e.message}`)));
  child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} 종료 코드 ${code}: ${err.slice(-300)}`))));
});

const save = async (p) => { await fs.writeFile(fileOf(p.id), JSON.stringify(p, null, 2)); return p; };

export async function listExplainers() {
  if (!existsSync(ROOT)) return [];
  const out = [];
  for (const id of await fs.readdir(ROOT)) {
    if (!id.startsWith("ex_")) continue;
    try {
      const p = JSON.parse(await fs.readFile(fileOf(id), "utf8")), template = templateOf(p);
      out.push({ id, topic: p.topic, title: p.title, template, templateName: TEMPLATES[template].name, count: p.scenes.length, hasAudio: !!p.audio, ...(await mediaInfo(dirOf(id), p)), updatedAt: p.updatedAt });
    } catch {}
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getExplainer(id) {
  try { const p = JSON.parse(await fs.readFile(fileOf(id), "utf8")); p.template = templateOf(p); p.style = obj(p.style); p.character = obj(p.character); return p; } catch { return null; }
}

export async function createExplainer({ topic = "", seconds = 60, template = "voxel", style = {}, character = {} } = {}) {
  const id = `ex_${Date.now()}`;
  await fs.mkdir(dirOf(id), { recursive: true });
  return save({ id, topic: String(topic).trim(), seconds: Number(seconds) || 60, template: TEMPLATES[template] ? template : "voxel", style: obj(style), character: obj(character), title: "", scenes: [], audio: null, words: null, video: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

/** 장면을 고쳐 쓴다. 대본이 바뀌면 단어 시각은 다시 맞춰야 하므로 지운다 */
export async function updateExplainer(id, patch) {
  const p = await getExplainer(id);
  if (!p) throw Object.assign(new Error("없음"), { status: 404 });
  if (patch.title !== undefined) p.title = String(patch.title);
  if (patch.topic !== undefined) p.topic = String(patch.topic);
  if (TEMPLATES[patch.template]) p.template = patch.template;
  if (patch.style !== undefined) p.style = obj(patch.style);
  if (patch.character !== undefined) p.character = obj(patch.character);
  if (Array.isArray(patch.scenes)) {
    const before = p.scenes.map((s) => s.narration).join("\n");
    p.scenes = patch.scenes.map(cleanScene);
    if (p.scenes.map((s) => s.narration).join("\n") !== before && !p.audio) p.words = null;
  }
  p.updatedAt = new Date().toISOString();
  return save(p);
}

export async function deleteExplainer(id) {
  if (!/^ex_\d+$/.test(id)) return;
  await fs.rm(dirOf(id), { recursive: true, force: true });
}

const cleanScene = (s) => ({
  type: ALL_TYPES.has(s.type) ? s.type : "title", // 다른 템플릿 장면 이름도 지우지 않는다 (템플릿을 바꿔 오갈 때)
  narration: String(s.narration || "").trim(),
  chip: String(s.chip || "").trim(),
  chipColor: s.chipColor === "orange" ? "orange" : "blue",
  tag: String(s.tag || "").trim(),
  value: String(s.value || "").trim(),
});

export async function writeScript(id, emit = () => {}) {
  const p = await getExplainer(id);
  if (!p) throw new Error("없음");
  const T = TEMPLATES[p.template];
  const types = Object.entries(T.scenes).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const prompt = `세로 쇼츠(9:16) 3D 설명 영상의 대본을 쓴다. 주제: "${p.topic}"
길이: 약 ${p.seconds}초 (한국어 나레이션 1초에 약 6~7글자).

장면은 아래 종류 중에서만 고른다. 각 장면은 화면 하나이고 나레이션 1~3문장을 읽는 동안 보인다.
${types}

규칙:
- 첫 장면은 호기심을 거는 한 문장 (title 또는 주제에 맞는 장면). 마지막은 ending.
- 장면 수 ${Math.max(5, Math.round(p.seconds / 7))}개 안팎. 같은 종류를 연달아 쓰지 않는다.
- chip: 화면 위쪽 짧은 강조 라벨 (예: "≈ 200 BREAKS / YEAR", "500+ 케이블"). 없으면 빈 문자열. 확인된 사실만 숫자로 쓴다. 불확실하면 숫자를 빼고 쓴다.
- chipColor: 위험·문제는 "orange", 그 외 "blue".
- tag: 화면 왼쪽 위 작은 영어 대문자 설명 (예: "DATA CENTER", "PROTECTIVE PIPE · NEAR THE BEACH").
- value 는 장면 종류 설명에 적힌 형식대로만 쓴다. 해당 없으면 빈 문자열. stat 은 숫자만 (예: "99", "1.4"), 단위는 chip 에.
- ${T.look}
- 주제의 전제가 사실과 다르면 (예: "왜 ○○만 그런가" 인데 실제로는 흔한 경우) 첫 두 장면 안에서 바로잡고 진짜 질문으로 넘어간다.
- 나레이션은 말하듯 짧게. 영어 단어는 한글로 읽을 수 있게 쓴다.

JSON 하나만 답한다:
{"title":"영상 제목","scenes":[{"type":"${Object.keys(T.scenes)[1]}","narration":"…","chip":"…","chipColor":"blue","tag":"…","value":""}]}`;
  emit({ message: "Claude 가 장면 대본을 쓰는 중 (1~2분)" });
  const { text } = await askClaude(prompt, { cwd: dirOf(id), allowedTools: [] });
  const j = extractJson(text);
  if (!Array.isArray(j.scenes) || !j.scenes.length) throw new Error("장면이 비어 있습니다");
  p.title = String(j.title || p.topic);
  p.scenes = j.scenes.map(cleanScene);
  p.words = null;
  p.updatedAt = new Date().toISOString();
  emit({ message: `장면 ${p.scenes.length}개` });
  return save(p);
}

/** 올린 음성 파일을 audio.m4a 로 바꾸고 단어 시각을 뽑는다 */
export async function setAudio(id, tmpFile, emit = () => {}) {
  const p = await getExplainer(id);
  if (!p) throw new Error("없음");
  const out = path.join(dirOf(id), "audio.m4a");
  emit({ message: "음성 변환 중" });
  await run("ffmpeg", ["-v", "error", "-y", "-i", tmpFile, "-vn", "-c:a", "aac", "-b:a", "160k", out]);
  p.audio = "audio.m4a";
  p.words = await wordTimes(out, emit);
  p.updatedAt = new Date().toISOString();
  return save(p);
}

/** 나레이션을 만든다 — 목소리 설정의 목소리(Qwen3-TTS, 장면마다 읽어 이어 붙임) 또는 macOS say 임시 음성 */
export async function draftVoice(id, voice = "Yuna", emit = () => {}) {
  const p = await getExplainer(id);
  if (!p?.scenes.length) throw new Error("대본이 없습니다");
  if (isQwenVoice(voice)) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ex-tts-"));
    try {
      const parts = [], gap = path.join(tmp, "gap.wav");
      await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.3", gap]);
      for (const [i, s] of p.scenes.entries()) {
        if (!s.narration) continue;
        emit({ message: `${i + 1}/${p.scenes.length} 장면 읽는 중` });
        const wav = path.join(tmp, `${i}.wav`), w24 = path.join(tmp, `${i}_24.wav`);
        await synthTo(voice, s.narration, wav);
        await run("ffmpeg", ["-v", "error", "-y", "-i", wav, "-ar", "24000", "-ac", "1", w24]);
        parts.push(w24, gap);
      }
      const list = path.join(tmp, "list.txt"), all = path.join(tmp, "all.wav");
      await fs.writeFile(list, parts.map((f) => `file '${f}'`).join("\n"));
      await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, all]);
      return await setAudio(id, all, emit);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
  if (process.platform !== "darwin") throw new Error("임시 음성은 맥(say)에서만 됩니다. 음성 파일을 올리세요");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ex-say-"));
  try {
    const txt = path.join(tmp, "n.txt"), aiff = path.join(tmp, "n.aiff");
    await fs.writeFile(txt, p.scenes.map((s) => s.narration).join("\n"));
    emit({ message: `${voice} 목소리로 읽는 중` });
    await run("say", ["-v", voice, "-r", "190", "-f", txt, "-o", aiff]);
    return await setAudio(id, aiff, emit);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function wordTimes(file, emit) {
  if (!existsSync(WHISPER_MODEL)) { emit({ message: "whisper 모델이 없어 글자 수로 시각을 나눕니다" }); return null; }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ex-asr-"));
  try {
    const wav = path.join(tmp, "a.wav"), base = path.join(tmp, "a");
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-ar", "16000", "-ac", "1", wav]);
    emit({ message: "whisper 로 단어 시각을 뽑는 중" });
    // -ml 1 -sow: 단어 하나씩 끊어 시각을 받는다
    await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "ko", "-f", wav, "-oj", "-ml", "1", "-sow", "-of", base, "-np"]);
    const j = JSON.parse(await fs.readFile(`${base}.json`, "utf8"));
    const words = (j.transcription || []).map((s) => ({ t0: s.offsets.from / 1000, t1: s.offsets.to / 1000, w: s.text.trim() })).filter((x) => x.w);
    emit({ message: `단어 ${words.length}개` });
    return words;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// mp4 화질 — 화면은 720×1280 으로 그리므로 1080 은 늘려서 굽는다 (글자·선이 매끈해지고 용량이 커진다)
const QUALITY = {
  small: { crf: 26, audio: "128k" },
  std: { crf: 20, audio: "160k" },
  high: { crf: 17, audio: "192k", scale: "1080:1920" },
};
/** 브라우저가 녹화한 webm 을 mp4(H.264·AAC)로 */
export async function saveRender(id, tmpFile, quality = "std") {
  const q = QUALITY[quality] || QUALITY.std;
  const p = await getExplainer(id);
  if (!p) throw new Error("없음");
  const out = path.join(dirOf(id), "out.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-i", tmpFile, ...(q.scale ? ["-vf", `scale=${q.scale}:flags=lanczos`] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", String(q.crf), "-r", "30", "-c:a", "aac", "-b:a", q.audio, "-movflags", "+faststart", out]);
  p.video = "out.mp4"; p.quality = QUALITY[quality] ? quality : "std";
  p.duration = await makeThumb(dirOf(id)).catch(() => 0);
  p.updatedAt = new Date().toISOString();
  return save(p);
}

// ── 라이브러리: 저장한 캐릭터·내 템플릿 (_explainers/_lib_<종류>.json) ──
// characters: { id, name, base, spec } · styles: { id, name, base, style, character }
const lib = makeLibrary(ROOT, ["characters", "styles"]);
export const listLib = lib.list, saveLib = lib.save, deleteLib = lib.del;
