// 인물 라디오 — AI 인물(1~2명)이 라디오 스튜디오에서 말하는 세로 쇼츠. 템플릿 없이 고정 "라디오 포맷" 하나로 만든다.
//   ① 기획(브랜드·타깃·길이·참고 자료·주제 — 포맷 구성에 맞춘 뼈대) → ② 대본 → ③ 출연·스튜디오(사진·목소리 고르기)
//   → ④ 목소리: 두 갈래 — "내 목소리"(이 PC 의 Qwen3-TTS 로 읽혀 음성 파일 → 영상에 립싱크)
//                       "영상 모델 목소리"(음성 파일 없이 영상 모델이 프롬프트의 대사를 직접 말한다) → ⑤ 장면: 화면(투샷·단독) 이미지 몇 장을 먼저 만들고, 영상(컷)마다 그 화면 + 음성으로 말하는 영상 → ⑤ 합치기(mp4 · SRT)
// 저장: <DATA_DIR>/_radios/ra_…/ (radio.json · cast*.jpg · prop_*.jpg · voice/line*.wav · clips/c*.wav · shot*_frame.* · scene*_video.* · track.wav · out.mp4)
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, readJson, writeJson, AD_DIR_RE, getBrand, brandDir } from "./store.js";
import { askClaude, extractJson } from "./claude.js";
import { getResource, resourcePath } from "./resources.js";
import { synthTo } from "./voice.js";
import { listKits, kitBrief } from "./cardnews.js";

const run = promisify(execFile);
export const RADIOS_DIR = path.join(DATA_DIR, "_radios");
const dirOf = (id) => { if (!/^ra_\d+$/.test(id)) throw new Error("잘못된 인물 라디오 ID"); return path.join(RADIOS_DIR, id); };
const fileOf = (id) => path.join(dirOf(id), "radio.json");
const IMG = /^\.(jpe?g|png|webp)$/;
const GAP = 0.25; // 줄 사이 쉼(초)
const COLORS = ["#ff7a59", "#4fa3ff"];
// 라디오 포맷 — 대본 구성(구간마다 무엇이 들어가야 하는지)과 화면. 화면은 진행자 수로 정해지고, 이미지는 화면마다 한 장씩 만들어 여러 영상이 같이 쓴다
export const FORMAT = [
  { section: "훅", needs: "첫 3초에 손을 멈추게 할 질문·반전·의외의 사실 한 줄" },
  { section: "공감", needs: "듣는 사람이 실제로 겪는 고민·상황 한 장면" },
  { section: "핵심", needs: "알려줄 것 2~3개 — 각각 이유나 방법 한 줄씩" },
  { section: "정리", needs: "한 문장 결론 (기억에 남게)" },
  { section: "질문", needs: "댓글을 부를 질문 또는 다음 행동 한 줄" },
];
const STUDIO = "a cozy small radio studio: warm practical lights, acoustic foam panels, an ON AIR sign glowing softly in the background, a wooden desk";
export function shotsFor(cast) {
  const [a, b] = cast;
  if (cast.length === 2) return [
    { shot: 1, name: "투샷", who: [0, 1], en: `wide two-shot: both hosts seated side by side at the radio desk, ${a.name} on the left and ${b.name} on the right, each in front of a broadcast microphone, eye level, both visible from the waist up` },
    { shot: 2, name: `${a.name} 단독`, who: [0], en: `medium close-up of ${a.name} alone at the desk microphone, chest up, facing the camera slightly off-center` },
    { shot: 3, name: `${b.name} 단독`, who: [1], en: `medium close-up of ${b.name} alone at the desk microphone, chest up, facing the camera slightly off-center` },
  ];
  return [
    { shot: 1, name: "정면", who: [0], en: `medium shot of ${a.name} seated at the radio desk behind a broadcast microphone, waist up, looking straight into the camera` },
    { shot: 2, name: "클로즈업", who: [0], en: `close-up of ${a.name} at the microphone, shoulders up, looking straight into the camera` },
  ];
}
// 화면 목록을 진행자에 맞추고(이름이 바뀌면 설명도), 만든 이미지·프롬프트는 같은 번호면 그대로 둔다 · 대사 줄의 화면 번호를 맞춘다
function norm(r) {
  if (!r) return r;
  const prev = Object.fromEntries((Array.isArray(r.shots) ? r.shots : []).map((s) => [s.shot, s]));
  r.shots = shotsFor(r.cast).map((s) => ({ ...(prev[s.shot] || {}), ...s }));
  r.props ||= []; r.scenes ||= {}; r.clips ||= []; r.seconds ||= 45; r.clip_max ||= 8;
  for (const x of [...(r.lines || []), ...r.clips]) x.shot = fixShot(r, x.speaker, x.shot); // 예전(템플릿 컷 번호) 작업도 지금 화면 번호로
  return r;
}
// 2명이면 단독 화면은 말하는 사람 것만 (A 줄에 B 단독 화면은 안 맞는다)
const fixShot = (r, speaker, shot) => {
  const n = Number(shot) || 1;
  if (r.cast.length === 2) return n === 1 ? 1 : speaker === 1 ? 3 : 2;
  return n === 2 ? 2 : 1;
};
// 컷(영상 하나) 구성: 같은 사람·같은 화면으로 이어지는 줄을 clip_max 초 안에서 한 영상으로 묶는다
// (립싱크 모델 한 번에 4~15초 — 짧은 줄마다 영상을 만들면 개수·크레딧이 늘어난다)
export const CLIP_MAX = [5, 8, 10, 15];
// 음성 전엔 글자 수로 어림 — Qwen3-TTS 실측 공백 뺀 1초에 약 5.4글자 (2026-10-28, 6줄 196자 → 36.1초)
const CPS = 5.3;
const estDur = (l) => l.dur || Math.max(1.2, Math.round((l.text.replace(/\s/g, "").length / CPS) * 10) / 10);
function planClips(r) {
  const max = r.clip_max || 8, clips = [];
  for (const l of r.lines) {
    const d = estDur(l), last = clips.at(-1);
    if (last && last.speaker === l.speaker && last.shot === l.shot && last.dur + GAP + d <= max) { last.lines.push(l.n); last.dur += GAP + d; }
    else clips.push({ id: `c${l.n}`, lines: [l.n], speaker: l.speaker, shot: l.shot, dur: d });
  }
  const prev = Object.fromEntries((r.clips || []).map((c) => [c.id, c]));
  r.clips = clips.map((c) => ({ ...c, dur: Math.round(c.dur * 10) / 10, // 같은 묶음이면 만들어 둔 음성을 그대로
    ...(prev[c.id] && prev[c.id].lines.join() === c.lines.join() && prev[c.id].audio && clipLines(r, c).every((l) => l.audio) ? { audio: prev[c.id].audio } : {}) }));
  r.estimated = r.lines.some((l) => !l.dur);
  return r.clips;
}
const clipLines = (r, c) => c.lines.map((n) => r.lines.find((l) => l.n === n)).filter(Boolean);

export async function listRadios() {
  const ids = (await fs.readdir(RADIOS_DIR).catch(() => [])).filter((x) => /^ra_\d+$/.test(x));
  const out = [];
  for (const id of ids) { const r = await readJson(fileOf(id), null); if (r) out.push(r); }
  return out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}
export const getRadio = async (id) => norm(await readJson(fileOf(id), null));
const save = async (r) => { r.updated_at = new Date().toISOString(); await writeJson(fileOf(r.id), r); return r; };

const DEFAULT_PROPS = () => [
  { id: "p1", kind: "배경", name: "라디오 스튜디오", desc: "따뜻한 조명의 작은 라디오 스튜디오 — 흡음재 벽, 뒤에 은은한 ON AIR 사인, 나무 책상", photo: "" },
  { id: "p2", kind: "소품", name: "방송용 마이크", desc: "책상 위 암 스탠드 마이크와 헤드폰", photo: "" },
];
const castOf = (n) => Array.from({ length: Number(n) === 2 ? 2 : 1 }, (_, i) => ({ name: i ? "진행자 B" : "진행자 A", desc: "", photo: "", voice: i ? "qwen3:speaker:Ryan" : "qwen3:speaker:Sohee", color: COLORS[i] }));
export async function createRadio({ cast = 1, set = "" } = {}) {
  const id = `ra_${Date.now()}`;
  await fs.mkdir(dirOf(id), { recursive: true });
  const r = { id, topic: "", title: "", cast: castOf(cast), props: DEFAULT_PROPS(), seconds: 30, clip_max: 8,
    lines: [], clips: [], scenes: {}, track: "", out: "", created_at: new Date().toISOString() };
  if (set) { // 저장한 출연 세트로 시작 — 진행자·목소리·스튜디오와 사진을 이 작업 폴더로 복사
    const x = await readJson(path.join(setDir(set), "set.json"), null);
    if (!x) throw new Error("그 출연 세트가 없습니다");
    const copy = async (f) => { if (!f) return ""; await fs.copyFile(path.join(setDir(set), f), path.join(dirOf(id), f)).catch(() => (f = "")); return f; };
    r.cast = await Promise.all(x.cast.map(async (c) => ({ ...c, photo: await copy(c.photo) })));
    r.props = await Promise.all((x.props || []).map(async (p) => ({ ...p, photo: await copy(p.photo) })));
    r.set = { id: set, name: x.name }; r.voice_mode = x.voice_mode || "tts";
  }
  return save(norm(r));
}

// 출연 세트 — 진행자(사진·이름·설명·목소리·색)와 스튜디오(배경·소품)를 이름 붙여 저장해 두고 새 작업을 그걸로 시작한다 (인물 라디오 전용)
//   저장: <DATA_DIR>/_radios/_sets/rs_…/ (set.json · 사진 사본 — 원래 작업을 지워도 남는다)
const SETS_DIR = path.join(RADIOS_DIR, "_sets");
const setDir = (sid) => { if (!/^rs_\d+$/.test(sid)) throw new Error("잘못된 출연 세트 ID"); return path.join(SETS_DIR, sid); };
export async function listRadioSets() {
  const ids = (await fs.readdir(SETS_DIR).catch(() => [])).filter((x) => /^rs_\d+$/.test(x));
  const out = [];
  for (const sid of ids) { const x = await readJson(path.join(setDir(sid), "set.json"), null); if (x) out.push(x); }
  return out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}
/** 지금 작업의 출연·스튜디오를 세트로 저장 — 같은 이름이 있으면 덮어쓴다 */
export async function saveRadioSet(id, { name = "" } = {}) {
  const r = await getRadio(id);
  if (!r) throw new Error("없음");
  name = String(name).trim().slice(0, 40);
  if (!name) throw new Error("세트 이름을 적으세요");
  const same = (await listRadioSets()).find((x) => x.name === name);
  const sid = same?.id || `rs_${Date.now()}`, dir = setDir(sid);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const copy = async (f) => { if (!f) return ""; await fs.copyFile(path.join(dirOf(id), f), path.join(dir, f)); return f; };
  const x = { id: sid, name, voice_mode: r.voice_mode || "tts", created_at: same?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
    cast: await Promise.all(r.cast.map(async (c) => ({ name: c.name, desc: c.desc || "", voice: c.voice, voice_desc: c.voice_desc || "", color: c.color, from: c.from || "", photo: await copy(c.photo) }))),
    props: await Promise.all((r.props || []).map(async (p) => ({ id: p.id, kind: p.kind, name: p.name, desc: p.desc || "", from: p.from || "", photo: await copy(p.photo) }))) };
  await writeJson(path.join(dir, "set.json"), x);
  r.set = { id: sid, name }; await save(r);
  return { set: x, overwritten: !!same };
}
/** 목소리 미리듣기 — 목소리마다 한 번 만들어 _radios/_preview 에 두고 다시 쓴다 */
export async function previewVoice(voice) {
  if (!/^[\w:.-]+$/.test(String(voice || ""))) throw new Error("잘못된 목소리");
  const dir = path.join(RADIOS_DIR, "_preview"), file = `${voice.replace(/[^\w-]/g, "_")}.wav`;
  await fs.mkdir(dir, { recursive: true });
  if (!(await fs.stat(path.join(dir, file)).catch(() => null))) await synthTo(voice, "안녕하세요, 오늘도 라디오에 오신 걸 환영합니다.", path.join(dir, file));
  return { url: `/data/_radios/_preview/${file}` };
}
export async function deleteRadioSet(sid) { await fs.rm(setDir(sid), { recursive: true, force: true }); }

/** 화면에서 고친 것 (주제·제목·진행자 이름·목소리·색·대사·컷) */
export async function updateRadio(id, patch = {}) {
  const r = await getRadio(id);
  if (!r) throw new Error("없음");
  for (const k of ["topic", "title"]) if (typeof patch[k] === "string") r[k] = patch[k].trim();
  if (["tts", "model"].includes(patch.voice_mode)) r.voice_mode = patch.voice_mode;
  if (patch.plan && typeof patch.plan === "object") r.plan = { target: String(patch.plan.target ?? r.plan?.target ?? ""), goal: GOALS[patch.plan.goal] ? patch.plan.goal : r.plan?.goal || "", product: String(patch.plan.product ?? r.plan?.product ?? ""),
    kitId: /^kit_\d+$/.test(patch.plan.kitId ?? r.plan?.kitId ?? "") ? (patch.plan.kitId ?? r.plan?.kitId) : "" };
  if (patch.sources && typeof patch.sources === "object") r.sources = { // 참고 자료: 링크(줄마다 하나) · 붙여 넣은 글
    links: (Array.isArray(patch.sources.links) ? patch.sources.links : String(patch.sources.links || "").split(/\s+/)).map((x) => String(x).trim()).filter((x) => /^https?:\/\/\S+$/.test(x)).slice(0, 10),
    text: String(patch.sources.text ?? "").slice(0, 20000) };
  if (patch.brief !== undefined) r.brief = patch.brief && Array.isArray(patch.brief.skeleton) ? { topic: String(patch.brief.topic || ""), angle: String(patch.brief.angle || ""), hook: String(patch.brief.hook || ""), skeleton: patch.brief.skeleton.map((x) => ({ section: String(x.section || ""), content: String(x.content || "") })) } : null;
  if (Number(patch.seconds) > 0) r.seconds = Math.max(5, Math.min(180, Math.round(Number(patch.seconds))));
  if (CLIP_MAX.includes(Number(patch.clip_max))) r.clip_max = Number(patch.clip_max);
  if ([1, 2].includes(Number(patch.castN)) && Number(patch.castN) !== r.cast.length) { // 진행자 수 바꾸기 — 있는 사람은 그대로, 대사는 남은 사람에게
    const n = Number(patch.castN), add = castOf(2)[1];
    if (n === 2) r.cast.push(add); else { const x = r.cast.pop(); if (x.photo) await fs.rm(path.join(dirOf(id), x.photo), { force: true }); }
    for (const l of r.lines) if (l.speaker > n - 1) { l.speaker = n - 1; l.audio = ""; l.dur = 0; } // 빠진 사람 대사는 다시 읽힌다
    r.shots = []; r.scenes = {}; norm(r); planClips(r);
  }
  if (Array.isArray(patch.cast)) r.cast = r.cast.map((c, i) => ({ ...c, ...(patch.cast[i] ? { name: String(patch.cast[i].name ?? c.name).trim() || c.name, desc: String(patch.cast[i].desc ?? c.desc ?? ""), voice: patch.cast[i].voice || c.voice, color: /^#[0-9a-f]{6}$/i.test(patch.cast[i].color || "") ? patch.cast[i].color : c.color,
    voice_desc: String(patch.cast[i].voice_desc ?? c.voice_desc ?? "").slice(0, 200) } : {}) }));
  if (Array.isArray(patch.props)) { // 배경·소품: 이름·설명·종류 고치기 · 추가 · 빼기 (사진은 올릴 때만)
    const prev = Object.fromEntries((r.props || []).map((x) => [x.id, x]));
    r.props = patch.props.map((x, i) => ({ id: prev[x.id] ? x.id : `p${Date.now()}${i}`, kind: x.kind === "배경" ? "배경" : "소품", name: String(x.name || "").trim().slice(0, 40) || "소품", desc: String(x.desc || ""), photo: prev[x.id]?.photo || "", from: prev[x.id]?.from || "", shots: prev[x.id]?.shots || [] }));
    for (const x of Object.values(prev)) if (x.photo && !r.props.some((y) => y.id === x.id)) await fs.rm(path.join(dirOf(id), x.photo), { force: true });
  }
  if (patch.scenes && typeof patch.scenes === "object") for (const [n, x] of Object.entries(patch.scenes)) { // 영상 프롬프트 직접 고치기
    const sc = r.scenes[n]; if (sc && typeof x.motion_en === "string") sc.motion_en = x.motion_en;
  }
  if (patch.shots && typeof patch.shots === "object") for (const [n, x] of Object.entries(patch.shots)) { // 화면 이미지 프롬프트 직접 고치기
    const sh = r.shots.find((s) => String(s.shot) === String(n)); if (sh && typeof x.frame_en === "string") sh.frame_en = x.frame_en;
  }
  if (Array.isArray(patch.lines)) {
    const prev = Object.fromEntries(r.lines.map((l) => [l.n, l]));
    r.lines = patch.lines.map((l, i) => {
      const p = prev[l.n] || {}, text = String(l.text || "").trim();
      const same = p.text === text && p.speaker === (Number(l.speaker) || 0);
      const speaker = Math.min(r.cast.length - 1, Number(l.speaker) || 0);
      return { n: l.n || Date.now() + i, speaker, text, shot: fixShot(r, speaker, l.shot || p.shot), gesture: String(l.gesture ?? p.gesture ?? ""),
        ...(same ? { audio: p.audio, dur: p.dur } : {}) }; // 글이나 말하는 사람이 바뀌면 음성을 다시 만들어야 한다
    }).filter((l) => l.text);
  }
  if (Array.isArray(patch.lines) || patch.clip_max !== undefined) planClips(r);
  return save(r);
}
export async function deleteRadio(id) { await fs.rm(dirOf(id), { recursive: true, force: true }); }

/** 진행자 사진: 올린 파일 · 리소스 인물 · 수집 이미지 */
export async function setCastPhoto(id, i, { src, name, resource, collected, pid } = {}) {
  const r = await getRadio(id);
  const c = pid ? r?.props?.find((x) => x.id === pid) : r?.cast?.[Number(i)];
  if (!c) throw new Error(pid ? "그 배경·소품이 없습니다" : "진행자가 없습니다");
  let from = "";
  if (resource) { // 결과 이미지 우선 (인물은 전신 시트 > 체형 > 얼굴), 없으면 참고 이미지
    const kind = resource.kind || "person", x = await getResource(kind, resource.id);
    const imgs = (x?.files || []).filter((f) => f.kind === "image"), rank = (f) => (f.role === "ref" ? 10 : 0) + ({ sheet: 0, body: 1, face: 2 }[f.part] ?? 3);
    const f = imgs.sort((a, b) => rank(a) - rank(b))[0];
    if (!f) throw new Error("그 리소스에 사진이 없습니다");
    src = resourcePath(kind, resource.id, f.file); name = f.file; from = x.name || "";
  }
  if (collected) {
    const b = await getBrand(collected.brandId);
    if (!b || !AD_DIR_RE.test(collected.dir) || !/^[\w.-]+$/.test(collected.file)) throw new Error("잘못된 이미지");
    src = path.join(brandDir(b), collected.dir, collected.file); name = collected.file;
  }
  const ext = path.extname(name || src || "").toLowerCase();
  if (!IMG.test(ext)) throw new Error("사진(jpg·png·webp)만 넣을 수 있습니다");
  const file = `${pid ? `prop_${pid}` : `cast${i}`}_${Date.now()}${ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  if (c.photo) await fs.rm(path.join(dirOf(id), c.photo), { force: true });
  c.photo = file; c.from = from; // 리소스에서 불러왔으면 그 이름 (화면에 "리소스: …")
  return save(r);
}

/** ② 주제 기획 — 라디오 포맷 구성(FORMAT) → 누구에게·무엇을 위해(기획 칸) → 각도가 다른 주제 5개,
 *  주제마다 포맷의 모든 구간을 실제 내용으로 채운 뼈대와 핏 점검. 고른 뼈대는 대본이 그대로 따른다 (저장하지 않는다) */
const GOALS = { views: "조회수 — 끝까지 보게", save: "저장·공유 — 두고 볼 정보", comment: "댓글 — 의견이 갈리게", lead: "문의·구매 — 행동하게" };
const srcBlock = (r) => {
  const s = r.sources || {}, links = s.links || [], text = String(s.text || "").trim();
  if (!links.length && !text) return "";
  return `[참고 자료 — 내용의 근거. 여기 없는 사실·수치는 지어내지 않는다]
${links.length ? `- 링크 (WebFetch 로 직접 읽는다. 못 읽은 링크는 건너뛴다): ${links.join(" ")}\n` : ""}${text ? `- 붙여 넣은 글:\n${text.slice(0, 8000)}\n` : ""}`;
};
const srcTools = (r) => (r.sources?.links?.length ? ["WebFetch"] : []);
export async function suggestRadioTopics(id, { note = "" } = {}) {
  const r = await getRadio(id);
  if (!r) throw new Error("없음");
  const pl = r.plan || {};
  const kit = pl.kitId ? (await listKits()).find((k) => k.id === pl.kitId) : null;
  const { text } = await askClaude(`너는 숏폼 콘텐츠 기획자다. "인물 라디오"(AI 인물${r.cast.length === 2 ? " 두 명이 대화하는" : "이 카메라 보고 말하는"} 세로 쇼츠) 한 편의 주제를 기획한다. 사람에게 묻지 말 것.
[라디오 포맷 — 이번 영상 ${r.seconds || 30}초] ${r.cast.length === 2 ? "두 진행자가 묻고 답하는 대화" : "진행자 혼자 카메라 보고 말하기"}. 구성: ${JSON.stringify(FORMAT)}
${kit ? `[브랜드 기본 정보 — 이 맥락에 맞춘다]\n${kitBrief(kit)}\n- 주제는 이 브랜드의 고객 고민·제품과 자연스럽게 이어져야 한다. 확인된 실적·수치 칸에 없는 수치는 쓰지 않는다. 금지어·주의를 지킨다. 말투·톤을 따른다.\n` : ""}[기획 정보] 누구에게: ${pl.target || "(미정)"} · 목적: ${GOALS[pl.goal] || "(미정)"} · 제품·브랜드: ${pl.product || "(없음)"} · 지금 생각한 주제: ${r.topic || "(없음)"}${note ? ` · 바라는 방향: ${note}` : ""}
[등장인물] ${r.cast.map((c) => `${c.name}${c.desc ? `(${c.desc})` : ""}`).join(", ")}
${srcBlock(r)}
[순서]
1. ideas 5개${r.sources?.links?.length || r.sources?.text?.trim() ? " (참고 자료에서 찾은 내용·사례·숫자를 재료로 쓴다)" : ""}: 서로 다른 각도(통념 반박 · 흔한 실수 · 비교 · 숫자 리스트 · 경험담/사례 · 비하인드 중에서)로, 타깃이 실제로 겪는 고민·궁금증에서 출발한다. 지금 생각한 주제가 있으면 그 범위 안에서 각도를 바꾼다.
   각 안마다 skeleton = 위 구성의 모든 구간(훅·공감·핵심·정리·질문)을 이 주제의 실제 내용으로 채운다 (빈칸·"~" 금지). 채울 수 없는 구간이 있으면 그 안은 버리고 다른 안을 낸다.
   fit: 라디오 포맷(말로만 전해도 이해되는지·${r.seconds || 30}초에 담기는지)과 타깃에 맞는 정도 1~5 와 이유 한 줄. 확인 안 된 수치·효능·최상급은 쓰지 않는다 (필요하면 "확인 필요"라고 적는다).
답은 JSON 하나만:
{ "ideas": [{ "topic": "주제 한 줄 (제목처럼)", "angle": "각도", "target_pain": "타깃이 겪는 고민 한 줄", "hook": "첫 줄 대사", "skeleton": [{ "section": "훅", "content": "이 주제로 채운 내용" }], "fit": 5, "why": "핏 이유 한 줄" }] }`, { cwd: dirOf(id), allowedTools: srcTools(r) });
  const out = extractJson(text);
  out.ideas = (out.ideas || []).sort((a, b) => (b.fit || 0) - (a.fit || 0));
  out.format = FORMAT;
  return out;
}

/** ④ 프롬프트 다듬기 — 자연어 요청으로 화면 이미지(frame_en, 화면 번호 n) 또는 영상(motion_en, 컷 n)을 하나 또는 전체 고쳐 쓴다 */
export async function refineRadioPrompt(id, { n = null, field = "frame_en", instruction = "" } = {}, emit = () => {}) {
  const r = await getRadio(id);
  if (!r) throw new Error("없음");
  if (!String(instruction).trim()) throw new Error("어떻게 고칠지 적으세요");
  if (!["frame_en", "motion_en"].includes(field)) throw new Error("잘못된 칸");
  const img = field === "frame_en", all = n == null || n === "";
  const cur = img
    ? r.shots.filter((s) => s.frame_en && (all || String(s.shot) === String(n))).map((s) => ({ n: String(s.shot), prompt: s.frame_en, screen: s.name }))
    : r.clips.filter((c) => r.scenes[c.id]?.motion_en && (all || c.id === String(n))).map((c) => ({ n: c.id, prompt: r.scenes[c.id].motion_en, line: clipLines(r, c).map((l) => l.text).join(" ") }));
  if (!cur.length) throw new Error("먼저 프롬프트를 쓰세요");
  emit({ message: `Claude 가 ${img ? "화면 이미지" : "영상"} 프롬프트 ${cur.length}개를 다듬는 중` });
  const { text } = await askClaude(`아래 ${img ? "화면 이미지" : "영상(말하는 영상)"} 프롬프트를 요청대로 고쳐 쓴다. 사람에게 묻지 말 것.
[요청] ${instruction}
[프롬프트] ${JSON.stringify(cur)}
규칙: 요청한 것만 바꾸고 나머지 문장·첨부 이미지 번호(image N)·끝맺음 문장은 그대로 둔다. 영어로 쓴다. 결과 그림만 보고 알 수 있는 절대 묘사로 쓴다. n 은 받은 값 그대로.
답은 JSON 하나만: { "scenes": [{ "n": "${cur[0].n}", "prompt": "" }], "changes": "무엇을 바꿨는지 한국어 한 줄" }`, { cwd: dirOf(id), allowedTools: [], timeoutMs: 4 * 60_000 });
  const out = extractJson(text);
  const q = await getRadio(id), note = `${img ? "이미지" : "영상"}: ${instruction}`;
  for (const x of out.scenes || []) {
    if (!x.prompt) continue;
    const t = img ? q.shots.find((s) => String(s.shot) === String(x.n)) : q.scenes[String(x.n)];
    if (t) { t[field] = x.prompt; t.refined = note; }
  }
  q.refine_note = out.changes || "";
  await save(q);
  emit({ message: "프롬프트를 다듬었습니다" });
  return { id, refined: true };
}

/** ③ 대본 — 라디오 포맷 구성과 고른 뼈대를 따라 진행자 대화를 쓴다 (줄마다 어느 화면에 얹을지 shot 도 정한다) */
export async function writeRadioScript(id, emit = () => {}) {
  const r = await getRadio(id);
  if (!r) throw new Error("없음");
  if (!r.topic) throw new Error("주제를 적으세요");
  const duo = r.cast.length === 2, [a, b] = r.cast;
  const kit = r.plan?.kitId ? (await listKits()).find((k) => k.id === r.plan.kitId) : null;
  const sec = r.seconds || 30, nLines = Math.max(3, Math.round(sec / 5));
  emit({ message: "Claude 가 라디오 포맷대로 대본을 쓰는 중 (1~2분)" });
  const { text } = await askClaude(`세로 쇼츠 "인물 라디오" 대본을 쓴다 — 라디오 스튜디오에서 AI 인물${duo ? " 두 명이 대화하는" : "이 카메라를 보고 말하는"} 토킹헤드 영상이다. 사람에게 묻지 말 것.
${kit ? `[브랜드 기본 정보]\n${kitBrief(kit)}\n- 말투·톤과 금지어를 지킨다. 실적·수치는 위에 적힌 것만.\n` : ""}[주제] ${r.topic}${r.plan?.target || r.plan?.goal || r.plan?.product ? `\n[기획] 누구에게: ${r.plan.target || "-"} · 목적: ${GOALS[r.plan.goal] || "-"} · 제품·브랜드: ${r.plan.product || "-"}` : ""}
[구성] ${r.brief?.skeleton?.length && r.brief.topic === r.topic ? `고른 기획 뼈대 — 각도 ${r.brief.angle} · 첫 줄 "${r.brief.hook}"\n${r.brief.skeleton.map((x) => `- ${x.section}: ${x.content}`).join("\n")}\n- 이 뼈대의 구간 순서와 내용을 그대로 대사로 풀어 쓴다.` : `라디오 포맷 ${FORMAT.map((x) => `${x.section}(${x.needs})`).join(" → ")}`}
[진행자] ${duo ? `0 = ${a.name}${a.desc ? `(${a.desc})` : ""} (질문·정리), 1 = ${b.name}${b.desc ? `(${b.desc})` : ""} (설명) — 라디오처럼 서로 이름을 부르며 주고받는다` : `0 = ${a.name}${a.desc ? `(${a.desc})` : ""} 혼자 말한다 — 모든 줄 speaker 0. 청취자에게 말 걸듯이`}
[배경·소품] ${(r.props || []).map((x) => `${x.kind} ${x.name}${x.desc ? `(${x.desc})` : ""}`).join(", ") || "-"} — 대사에서 자연스럽게 쓸 수 있으면 쓴다
${srcBlock(r)}[영상 길이] ${sec}초 — 읽는 속도가 공백 뺀 1초에 약 5글자다. 모든 대사의 공백 뺀 글자 수 합계를 약 ${Math.round((sec - 0.5 - 0.25 * nLines) * CPS)}자 (±10%) 로 맞춘다 (대사 ${nLines}줄 안팎). 넘치면 줄이고, 모자라면 늘린다.
[화면] ${JSON.stringify(r.shots.map((x) => ({ shot: x.shot, name: x.name })))}
- 줄마다 shot 을 정한다. ${duo ? "훅·마지막 줄처럼 둘이 함께 있는 그림이 좋은 줄은 1(투샷), 나머지는 말하는 사람 단독(진행자 0 = 2, 진행자 1 = 3)." : "보통 1(정면), 힘줘 말하는 줄은 2(클로즈업)."} 같은 화면이 너무 오래 이어지지 않게 섞는다.
[규칙]
- 한 줄 = 한 사람이 한 번에 하는 말, 한두 문장 (한 줄 공백 뺀 15~40자 — 3~8초).
- 확인된 사실만 숫자로 쓴다. 불확실하면 숫자를 빼고 말한다. 숫자·영어는 소리 내어 읽는 한글로 쓴다 (예: "삼십만 원").
- gesture: 그 줄에서 인물이 하는 짧은 몸짓·표정 (영어, 예: "leans in, raises eyebrows").
- title: 영상 제목 한 줄.
답은 JSON 하나만: { "title": "", "lines": [{ "speaker": 0, "text": "", "shot": 1, "gesture": "" }] }`, { cwd: dirOf(id), allowedTools: srcTools(r) });
  const j = extractJson(text);
  if (!Array.isArray(j.lines) || !j.lines.length) throw new Error("대본이 비어 있습니다");
  const q = await getRadio(id);
  q.title = String(j.title || q.topic).trim();
  q.lines = j.lines.map((l, i) => { const speaker = duo ? (Number(l.speaker) === 1 ? 1 : 0) : 0;
    return { n: i + 1, speaker, text: String(l.text || "").trim(), shot: fixShot(q, speaker, l.shot), gesture: String(l.gesture || "") }; }).filter((l) => l.text);
  q.scenes = {}; q.track = ""; q.out = ""; q.clips = []; // 화면 이미지(q.shots)는 대본과 상관없어 그대로 둔다
  planClips(q);
  emit({ message: `대사 ${q.lines.length}줄` });
  await save(q);
  return { id, script: true };
}

const probe = async (f) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout) || 0;

/** ④ 목소리 — 줄마다 그 진행자 목소리로 읽히고(무료·이 PC), 줄을 이어 한 줄 음성(track.wav)을 만든다 */
export async function voiceRadio(id, emit = () => {}) {
  const r = await getRadio(id);
  if (!r?.lines?.length) throw new Error("대본을 먼저 쓰세요");
  await fs.mkdir(path.join(dirOf(id), "voice"), { recursive: true });
  for (const [i, l] of r.lines.entries()) {
    if (l.audio && l.dur) continue; // 이미 만든 줄은 그대로
    emit({ message: `줄 ${i + 1}/${r.lines.length} 읽히는 중 (${r.cast[l.speaker].name})` });
    const file = `voice/line${l.n}_${Date.now()}.wav`;
    l.dur = Math.round((await synthTo(r.cast[l.speaker].voice, l.text, path.join(dirOf(id), file))) * 100) / 100;
    l.audio = file;
    await save(r);
  }
  await buildTrack(r);
  planClips(r);
  await buildClipAudio(r, emit);
  emit({ message: `음성 완성 — 총 ${Math.round((r.lines.at(-1).start + r.lines.at(-1).dur) * 10) / 10}초 · 영상 ${r.clips.length}개` });
  await save(r);
  return { id, voice: true };
}
/** 컷마다 그 컷 줄들의 음성을 쉼과 함께 이은 파일 (말하는 영상에 넣는 음성) */
async function buildClipAudio(r, emit = () => {}) {
  await fs.mkdir(path.join(dirOf(r.id), "clips"), { recursive: true });
  for (const c of r.clips) {
    const ls = clipLines(r, c);
    c.start = ls[0].start;
    c.dur = Math.round((ls.at(-1).start + ls.at(-1).dur - c.start) * 100) / 100;
    if (ls.length === 1) { c.audio = ls[0].audio; continue; }
    if (c.audio?.startsWith("clips/")) continue; // 이미 만든 묶음
    emit({ message: `컷 음성 잇는 중 (${c.id})` });
    const file = `clips/${c.id}_${Date.now()}.wav`, args = ["-y", "-v", "error"];
    ls.forEach((l) => args.push("-i", path.join(dirOf(r.id), l.audio)));
    const chains = ls.map((l, i) => `[${i}:a]aresample=24000,adelay=${Math.round((l.start - c.start) * 1000)}:all=1[a${i}]`);
    args.push("-filter_complex", `${chains.join(";")};${ls.map((_, i) => `[a${i}]`).join("")}amix=inputs=${ls.length}:normalize=0,atrim=0:${c.dur.toFixed(2)}[o]`, "-map", "[o]", "-ac", "1", path.join(dirOf(r.id), file));
    await run("ffmpeg", args, { maxBuffer: 1 << 24 });
    c.audio = file;
  }
}
async function buildTrack(r) {
  let t = 0.2;
  for (const l of r.lines) { l.start = Math.round(t * 100) / 100; t += (l.dur || 0) + GAP; }
  const args = ["-y", "-v", "error"];
  r.lines.forEach((l) => args.push("-i", path.join(dirOf(r.id), l.audio)));
  const chains = r.lines.map((l, i) => `[${i}:a]aresample=24000,adelay=${Math.round(l.start * 1000)}:all=1[a${i}]`);
  args.push("-filter_complex", `${chains.join(";")};${r.lines.map((_, i) => `[a${i}]`).join("")}amix=inputs=${r.lines.length}:normalize=0,apad,atrim=0:${(t + 0.3).toFixed(2)}[o]`, "-map", "[o]", "-ac", "1", path.join(dirOf(r.id), "track.wav"));
  await run("ffmpeg", args, { maxBuffer: 1 << 24 });
  r.track = "track.wav";
}
/** 한 줄 음성 다시 만들기 */
export async function revoiceLine(id, n, emit = () => {}) {
  const r = await getRadio(id);
  const l = r?.lines?.find((x) => x.n === Number(n));
  if (!l) throw new Error("그 줄이 없습니다");
  if (l.audio) await fs.rm(path.join(dirOf(id), l.audio), { force: true });
  l.audio = ""; l.dur = 0;
  for (const c of r.clips || []) if (c.lines.includes(l.n)) c.audio = ""; // 그 줄이 든 컷 음성도 다시 잇는다
  await save(r);
  return voiceRadio(id, emit);
}

/** ④ 장면 프롬프트 — 화면(쓰이는 것만)마다 이미지 프롬프트 한 개, 영상(컷)마다 말하는 영상 프롬프트 한 개.
 *  첫 화면(기준 화면)을 먼저 만들고, 나머지 화면은 그 결과를 마지막 첨부로 붙여 같은 스튜디오·조명·옷으로 맞춘다 */
export async function writeRadioPrompts(id, emit = () => {}) {
  const r = await getRadio(id);
  if (!r?.lines?.length) throw new Error("대본을 먼저 쓰세요");
  if (!r.clips?.length) planClips(r);
  const used = r.shots.filter((s) => r.clips.some((c) => c.shot === s.shot)), base = used[0]?.shot;
  const bg = (r.props || []).filter((x) => x.kind === "배경"), props = (r.props || []).filter((x) => x.kind !== "배경");
  // 화면마다 첨부 순서를 정해 둔다 (빈 사진은 건너뛰고 번호를 붙인다) — 프롬프트의 image N 과 실제 첨부가 어긋나지 않게
  const attachOf = (s) => {
    const a = [];
    for (const i of s.who) if (r.cast[i]?.photo) a.push({ file: r.cast[i].photo, what: `인물 ${r.cast[i].name}` });
    for (const x of [...bg, ...props]) if (x.photo) a.push({ file: x.photo, what: `${x.kind} ${x.name}` });
    if (s.shot !== base) a.push({ file: "", what: "기준 화면 (첫 화면 결과 — 만들 때 붙습니다)" });
    return a.map((x, k) => ({ ...x, n: k + 1 }));
  };
  const att = Object.fromEntries(used.map((s) => [s.shot, attachOf(s)]));
  const clipOf = (c) => { const ls = clipLines(r, c); return { n: c.id, speaker: c.speaker, shot: c.shot, text: ls.map((l) => l.text).join(" "), gesture: ls.map((l) => l.gesture).filter(Boolean).join("; "), dur: c.dur }; };
  const native = r.voice_mode === "model";
  emit({ message: `Claude 가 화면 ${used.length}장 · 영상 ${r.clips.length}개 프롬프트를 쓰는 중 (1~3분)` });
  const { text } = await askClaude(`AI 인물 "라디오" 토킹헤드 세로 영상(9:16)의 프롬프트를 쓴다. 사람에게 묻지 말 것. 사진 파일은 Read 로 직접 본다.
[진행자] ${r.cast.map((c, i) => `${i} = ${c.name}${c.desc ? `(${c.desc})` : ""}: ${c.photo ? `사진 ${c.photo}` : "사진 없음 — 설명대로 그린다"}${native ? ` · 목소리: ${c.voice_desc || "외모에 어울리는 자연스러운 한국어 목소리"}` : ""}`).join(" / ")}
[배경·소품] ${(r.props || []).map((x) => `${x.kind} "${x.name}"${x.desc ? `(${x.desc})` : ""}: ${x.photo ? `사진 ${x.photo}` : "사진 없음 — 설명대로"}`).join(" / ") || `없음 — ${STUDIO}`}
[화면] (답의 shot 은 아래 값 그대로) ${JSON.stringify(used.map((s) => ({ shot: s.shot, name: s.name, framing: s.en, attach: att[s.shot].map((x) => `image ${x.n} = ${x.what}${x.file ? ` (${x.file})` : ""}`) })))}
[영상] (답의 n 은 아래 "c…" 그대로) 영상 하나 = 한 사람이 그 화면에서 이어서 말하는 대사 묶음 ${JSON.stringify(r.clips.map(clipOf))}
[규칙]
1. shots[].frame_en (화면 이미지 — 첨부 이미지를 참고해 새로 그리는 이미지 모델): attach 번호를 그대로 쓴다. 사람은 그 사람 사진의 얼굴·머리·옷을 그대로 옮기고(사진이 없으면 설명대로), framing 의 구도로. 배경 사진이 있으면 그 공간, 없으면 배경 설명대로의 라디오 스튜디오. 소품은 알맞은 자리에. 입은 다문 자연스러운 표정, 사진처럼 사실적, 세로 9:16. ${base ? `기준 화면(shot ${base})이 아닌 화면은 "Match the room, lighting, colors and outfits of image N (the established shot)." 를 넣는다 (N = 그 화면 attach 의 기준 화면 번호).` : ""} 화면 글자·자막·로고는 넣지 않는다.
${native ? `2. scenes[].motion_en (말하는 영상 — 영상 모델이 대사를 직접 소리 낸다. 첨부: 그 화면 이미지(start image) + 말하는 사람 인물 시트(참고). 음성 파일 없음): 장면을 다시 묘사하지 않는다. 누가 말하는지 위치로 밝힌다(투샷이면 "The host on the left …", 다른 사람은 듣고 끄덕인다). 그 영상의 대사(text)를 한 글자도 바꾸지 말고 한국어 그대로 큰따옴표 안에 넣는다: 예) The host speaks in Korean, clearly and naturally, saying: "…". 그 사람 목소리 설명을 영어로 한 구절 덧붙인다(예: warm, calm female voice in her 30s). 입 모양이 말에 맞게, gesture·작은 카메라 움직임. "Audio: only this person's speech, clean studio sound, no background music, no other voices." 를 넣는다. 끝에` : `2. scenes[].motion_en (말하는 영상 — 첨부: 그 화면 이미지(start image) + 말하는 사람 인물 시트(참고) + 그 영상 음성(audio reference)): 장면을 다시 묘사하지 않는다. 누가 말하는지 위치로 밝힌다(투샷이면 "The host on the left …", 다른 사람은 듣고 끄덕인다). "lip movements precisely synced to the attached audio." 와 gesture·작은 카메라 움직임을 1~3문장. 끝에`} "Keep the person's identity consistent with the reference character sheet. Keep the face, outfit, lighting and colors of the start frame unchanged. No text on screen." 를 붙인다.
답은 JSON 하나만 (prompt_ko·notes 는 한국어): { "shots": [{ "shot": 1, "frame_en": "", "prompt_ko": "한국어 요약 한 줄" }], "scenes": [{ "n": "c1", "motion_en": "", "prompt_ko": "한국어 요약 한 줄" }], "notes": "만들 때 알아 둘 점 (한국어)" }`, { cwd: dirOf(id), timeoutMs: 6 * 60_000 });
  const out = extractJson(text);
  const q = await getRadio(id);
  q.clips = r.clips;
  const byShot = Object.fromEntries((out.shots || []).map((x) => [String(x.shot), x]));
  for (const s of q.shots) {
    const x = byShot[String(s.shot)]; if (!x || !att[s.shot]) continue;
    Object.assign(s, { frame_en: x.frame_en || "", prompt_ko: x.prompt_ko || "", refined: "", base: s.shot !== base ? base : 0,
      edit_files: att[s.shot].filter((a) => a.file).map((a) => a.file), attach: att[s.shot].map((a) => `${a.n}번 ${a.what}`) });
  }
  const byN = Object.fromEntries((out.scenes || []).map((x) => [String(x.n), x]));
  for (const [i, c] of q.clips.entries()) { // Claude 가 n 을 "c3" 대신 3 이나 순번으로 줄 때도 맞춘다
    const x = byN[c.id] || byN[c.id.slice(1)] || byN[String(i + 1)] || (out.scenes || [])[i] || {};
    q.scenes[c.id] = { ...(q.scenes[c.id] || {}), motion_en: x.motion_en || "", prompt_ko: x.prompt_ko || "", refined: "" };
  }
  q.prompt_notes = out.notes || ""; q.prompts_mode = native ? "model" : "tts"; // 목소리 방식을 바꾸면 영상 프롬프트를 다시 써야 한다
  await save(q);
  emit({ message: "장면 프롬프트 완성" });
  return { id, prompts: true };
}

/** 장면 결과 넣기 (힉스필드 결과 · 직접 올린 파일). n = "s<화면>"(field "frame", 화면 이미지) | 컷 "c…"(field "video") */
export async function setRadioScene(id, n, field, src, name) {
  if (!["frame", "video"].includes(field)) throw new Error("잘못된 칸");
  const r = await getRadio(id), key = String(n);
  const sh = /^s\d+$/.test(key) ? r?.shots?.find((s) => `s${s.shot}` === key) : null;
  if (!sh && !r?.clips?.some((c) => c.id === key)) throw new Error("그 화면·영상이 없습니다");
  if (sh && field !== "frame") throw new Error("화면에는 이미지만 넣습니다");
  const ext = (path.extname(name) || (field === "video" ? ".mp4" : ".png")).toLowerCase();
  if (field === "video" ? !/^\.(mp4|mov|webm|m4v)$/.test(ext) : !IMG.test(ext)) throw new Error(`이 칸에 넣을 수 없는 파일입니다: ${name}`);
  const file = `${sh ? `shot${sh.shot}` : `scene${key}`}_${field}_${Date.now()}${ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  const t = sh || r.scenes[key] || (r.scenes[key] = {});
  if (t[field]) await fs.rm(path.join(dirOf(id), t[field]), { force: true });
  t[field] = file;
  return save(r);
}

/** ⑤ 합치기 — 컷마다 영상(없으면 화면 이미지·진행자 사진 정지 화면)을 그 줄 길이에 맞추고 이어 붙인 뒤 내 음성(track.wav)을 얹는다 */
const hasAudio = async (f) => !!(await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", f])).stdout.trim();
/** 영상 모델 목소리로 만든 작업 합치기 — 영상마다 그 영상의 소리를 그대로 쓰고(영상이 없는 컷은 정지 화면 + 무음) 이어 붙인다.
 *  자막은 영상 길이를 그 영상 대사 글자 수 비율로 나눠 어림한다 */
async function renderNative(r, emit) {
  const dir = dirOf(r.id), tmp = await fs.mkdtemp(path.join(dir, "render_"));
  try {
    const parts = [], srt = [], vf = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
    const aout = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-ac", "2"];
    let t = 0;
    for (const [i, c] of r.clips.entries()) {
      emit({ message: `영상 ${i + 1}/${r.clips.length} 맞추는 중` });
      const sc = r.scenes[c.id] || {}, out = path.join(tmp, `p${i}.mp4`);
      let len;
      if (sc.video) {
        const v = path.join(dir, sc.video); len = await probe(v);
        const au = await hasAudio(v); // 소리가 안 붙어 나온 영상은 무음으로 채운다
        await run("ffmpeg", ["-y", "-v", "error", "-i", v, ...(au ? [] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]), "-t", len.toFixed(2), "-vf", vf, "-map", "0:v", "-map", au ? "0:a" : "1:a", ...aout, out]);
      } else {
        const still = r.shots.find((s) => s.shot === c.shot)?.frame || sc.frame || r.cast[c.speaker]?.photo;
        if (!still) throw new Error(`영상 ${i + 1} 에 쓸 화면이 없습니다 (말하는 영상·화면 이미지·진행자 사진 중 하나가 필요합니다)`);
        len = Math.max(1, c.dur);
        await run("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-i", path.join(dir, still), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", len.toFixed(2), "-vf", vf, "-map", "0:v", "-map", "1:a", ...aout, out]);
      }
      const ls = clipLines(r, c), chars = ls.reduce((a, l) => a + l.text.length, 0) || 1;
      let u = t; for (const l of ls) { const d = (len * l.text.length) / chars; srt.push({ start: u, end: u + d, text: l.text }); u += d; }
      t += len; parts.push(out);
    }
    await fs.writeFile(path.join(tmp, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
    emit({ message: "이어 붙이는 중" });
    const file = `out_${Date.now()}.mp4`;
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-c", "copy", path.join(dir, file)], { maxBuffer: 1 << 24 });
    if (r.out) await fs.rm(path.join(dir, r.out), { force: true });
    r.out = file; r.srt_native = srt;
    await save(r);
    emit({ message: "mp4 완성 (영상 모델 목소리)" });
    return { id: r.id, out: file };
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}
export async function renderRadio(id, emit = () => {}) {
  const r = await getRadio(id);
  if (!r) throw new Error("없음");
  if (!r.clips?.length) planClips(r);
  if (r.voice_mode === "model") return renderNative(r, emit);
  if (!r.track) throw new Error("목소리를 먼저 만드세요 (④)");
  const dir = dirOf(id), tmp = await fs.mkdtemp(path.join(dir, "render_"));
  try {
    if (!r.clips?.length) planClips(r);
    const total = await probe(path.join(dir, r.track)), parts = [];
    for (const [i, c] of r.clips.entries()) {
      emit({ message: `영상 ${i + 1}/${r.clips.length} 맞추는 중` });
      const ls = clipLines(r, c), s0 = i === 0 ? 0 : ls[0].start, next = r.clips[i + 1] ? clipLines(r, r.clips[i + 1])[0].start : total;
      const sc = r.scenes[c.id] || {}, len = Math.max(0.5, next - s0);
      const out = path.join(tmp, `p${i}.mp4`), vf = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
      if (sc.video) await run("ffmpeg", ["-y", "-v", "error", "-stream_loop", "-1", "-i", path.join(dir, sc.video), "-t", len.toFixed(2), "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
      else {
        const still = r.shots.find((s) => s.shot === c.shot)?.frame || sc.frame || r.cast[c.speaker]?.photo;
        if (!still) throw new Error(`영상 ${i + 1} 에 쓸 화면이 없습니다 (말하는 영상·화면 이미지·진행자 사진 중 하나가 필요합니다)`);
        await run("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-i", path.join(dir, still), "-t", len.toFixed(2), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
      }
      parts.push(out);
    }
    await fs.writeFile(path.join(tmp, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
    emit({ message: "이어 붙이고 음성 얹는 중" });
    const file = `out_${Date.now()}.mp4`;
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-i", path.join(dir, r.track), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", path.join(dir, file)], { maxBuffer: 1 << 24 });
    if (r.out) await fs.rm(path.join(dir, r.out), { force: true });
    r.out = file;
    await save(r);
    emit({ message: "mp4 완성" });
    return { id, out: file };
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

/** 자막 SRT (줄 시작·길이 그대로) */
export function radioSrt(r) {
  const ts = (x) => { const ms = Math.round(x * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  if (r.voice_mode === "model") return (r.srt_native || []).map((x, i) => `${i + 1}\n${ts(x.start)} --> ${ts(x.end)}\n${x.text}\n`).join("\n");
  return r.lines.filter((l) => l.dur).map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.start + l.dur)}\n${l.text}\n`).join("\n");
}
