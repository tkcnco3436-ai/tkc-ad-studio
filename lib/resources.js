// 리소스: 제작에 쓸 내 재료 보관함 — 인물 · 배경 · 소품·제품 · 목소리 (+ 템플릿 호환용 주제)
//   <DATA_DIR>/_resources/<종류>/<res_ID>/resource.json + 파일들 (+ _history/: 뺀 파일도 기록에 남긴다)
// 종류마다 정해진 속성 칸이 있고(제작 단계에서 템플릿의 resource_needs 와 맞춰 고른다),
// 인물은 부분(얼굴 · 체형 · 전신 시트)마다 속성 · 참고 이미지 · 결과 이미지를 따로 갖는다.
// 파일 한 개 = { file, kind: image|video|audio|file, role: ref(참고) | output(결과), part, source: upload | generated, note, prompt, added_at }
// 예전 파일(role 없음)은 결과로 본다. 무엇을 언제 넣고 뺐는지는 history 에 쌓인다.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, readJson, writeJson } from "./store.js";
import { extOf } from "./manual.js";
import { askClaude, extractJson } from "./claude.js";
import { guessForm, FORMS, cropImage } from "./imgform.js";

export const RESOURCES_DIR = path.join(DATA_DIR, "_resources");

// 종류별 속성 칸 — 화면의 입력 폼도 이 정의로 그린다. hidden 은 리소스 화면 탭에 안 보이는 종류
export const KINDS = {
  person: {
    label: "인물", accept: "image/*,video/*",
    fields: [["origin", "실제 인물 / AI 인물"], ["gender", "성별"], ["age_range", "나이대"], ["look", "외모·스타일"], ["consent", "초상권 동의 (실제 인물)"]],
    // 부분마다 만들기 — 얼굴을 먼저 정하고, 체형·전신 시트는 얼굴 결과를 참고로 쓴다
    parts: {
      face: { label: "얼굴", aspect: "1:1", fields: [["impression", "인상·분위기"], ["features", "눈·코·입 특징"], ["hair", "헤어스타일·색"], ["skin", "피부톤"], ["expression", "표정"]] },
      body: { label: "체형", aspect: "9:16", fields: [["height", "키"], ["build", "체형 (마름·보통·근육·통통)"], ["proportion", "비율·어깨·다리"], ["posture", "자세 특징"], ["outfit", "기본 의상"]] },
      outfit: { label: "의상 시트", aspect: "3:2", fields: [["items", "아이템"], ["style", "스타일"]] },
      sheet: { label: "전신 시트", aspect: "16:9", fields: [["outfit", "의상 (상의·하의·신발)"], ["accessory", "액세서리·소품"], ["layout", "시트 구성 (정면·측면·뒷면·표정)"], ["background", "배경"]] },
      pose: { label: "포즈", aspect: "9:16", fields: [["pose", "포즈"], ["scene", "배경"]] }, // 위저드에서 건너뛸 수 있는 단계
    },
    // 가상 페르소나 — 참고 이미지를 보고 Claude 가 지어 넣는다 (makePersona). 직접 고쳐도 된다
    persona: [["tagline", "한 줄 소개"], ["job", "직업·하는 일"], ["personality", "성격"], ["speech", "말투 (예시 한 문장)"], ["background", "배경 이야기"],
      ["likes", "좋아하는 것·취미"], ["values", "가치관"], ["roles", "어울리는 역할·콘텐츠"], ["voice", "목소리 느낌"]],
  },
  background: {
    label: "배경", accept: "image/*,video/*",
    fields: [["place", "장소"], ["mood", "분위기"], ["time_of_day", "시간대"], ["topic", "어울리는 주제"]],
    // 배경 만들기 위저드 (public/objwizard.js) — 기본 장면을 먼저 정하고, 앵글 시트·시간 바꾸기는 그 결과를 image 1 로 쓴다
    parts: {
      base: { label: "기본 장면", aspect: "16:9", fields: [] },
      angles: { label: "앵글 시트", aspect: "16:9", fields: [] },
      variant: { label: "시간·날씨", aspect: "16:9", fields: [] },
    },
  },
  product: {
    label: "소품·제품", accept: "image/*,video/*",
    fields: [["product_name", "제품·소품 이름"], ["brand", "브랜드"], ["usp", "핵심 장점 (쉼표로)"], ["price", "가격·혜택"], ["colors", "색상·옵션"]],
    // 제품 만들기 위저드 (public/objwizard.js) — 제품컷을 먼저 정하고, 제품 시트·연출컷은 그 결과를 image 1 로 쓴다
    parts: {
      front: { label: "제품컷", aspect: "1:1", fields: [] },
      sheet: { label: "제품 시트", aspect: "16:9", fields: [] },
      scene: { label: "연출컷", aspect: "4:5", fields: [] },
    },
  },
  voice: {
    label: "목소리", accept: "audio/*,video/*",
    fields: [["gender", "성별"], ["age_range", "나이대"], ["tone", "톤 (밝음·차분·신뢰 등)"], ["language", "언어"], ["provider_voice_id", "생성 서비스 음성 ID"]],
  },
  // 레퍼런스 — 스타일·구도·색감 참고 이미지 (레퍼런스 메뉴 · public/library.js). 이미지 소재·이미지 변형에서 참고 이미지로 불러 쓴다
  reference: {
    label: "레퍼런스", accept: "image/*", hidden: true,
    fields: [["use", "쓰임 (스타일·구도·색감·레이아웃)"], ["source", "출처 링크"]],
  },
  // 고객사 자료 — 로고·브랜드 가이드 · 타깃 페르소나 · 사업체 소개 · 그 밖의 참고 문서 (리소스 메뉴 · public/library.js).
  // md·txt·pdf·이미지를 올리거나 화면에서 md 로 바로 쓴다. 속성 칸 없이 파일 + 메모로 둔다
  asset: { label: "고객사 에셋", accept: "image/*,application/pdf,.md,.txt", hidden: true, fields: [] },
  // target: 고객사 마케팅 기준 (사업체 소개 · 소구점 · 차별점 · 타깃 · 혜택 · 신뢰 근거 · 말투 · 금지어 · 행동 유도)
  target: { label: "페르소나", accept: "image/*,application/pdf,.md,.txt", hidden: true, fields: [] },
  // company: 예전 종류 — 2026-11-04 페르소나(target) 위자드의 "사업체 소개" 단계로 합침. 화면에는 안 나온다
  company: { label: "사업체 소개", accept: "image/*,application/pdf,.md,.txt", hidden: true, fields: [] },
  doc: { label: "참고 문서", accept: "image/*,application/pdf,.md,.txt", hidden: true, fields: [] },
  // color: 고객사 브랜드 컬러 — colors: [{ hex, name, role }] (role: main 주색 · sub 보조색 · accent 강조색 · bg 바탕색 · text 글자색). 파일은 없어도 된다
  color: { label: "브랜드 컬러", accept: "image/*", hidden: true, fields: [] },
  topic: {
    label: "주제", accept: "image/*,application/pdf,text/*", hidden: true,
    fields: [["target", "타깃"], ["message", "핵심 메시지"], ["tone", "말투"], ["cta", "행동 유도 문구"], ["banned_words", "금지어 (쉼표로)"]],
  },
};

const kindDir = (kind) => {
  if (!KINDS[kind]) throw new Error("알 수 없는 리소스 종류");
  return path.join(RESOURCES_DIR, kind);
};
const resDir = (kind, id) => {
  if (!/^res_\w+$/.test(id)) throw new Error("잘못된 리소스 ID");
  return path.join(kindDir(kind), id);
};
const fileKind = (name) => {
  const e = extOf(name);
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(e)) return "image";
  if (["mp4", "mov", "m4v", "webm", "mkv"].includes(e)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg"].includes(e)) return "audio";
  return "file";
};
const partOk = (kind, part) => (part && KINDS[kind].parts?.[part] ? part : null);
const pick = (fields, obj = {}) => {
  const allowed = new Set(fields.map(([k]) => k));
  return Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => allowed.has(k) && String(v).trim()).map(([k, v]) => [k, String(v).trim()]));
};
const log = (r, e) => { (r.history ||= []).push({ at: new Date().toISOString(), ...e }); };
const save = (kind, r) => writeJson(path.join(resDir(kind, r.id), "resource.json"), r);

export async function listResources(kind) {
  const kinds = kind ? [kind] : Object.keys(KINDS);
  const out = [];
  for (const k of kinds) {
    for (const n of await fs.readdir(kindDir(k)).catch(() => [])) {
      const r = await readJson(path.join(kindDir(k), n, "resource.json"), null);
      if (r) out.push(r);
    }
  }
  return out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/** 파일들을 리소스 폴더로 옮기고 목록에 붙인다. files = [{ tmp, name }] */
async function moveIn(kind, r, files, { role = "output", part = null, source = "upload", note = "", prompt = "" } = {}) {
  const dir = resDir(kind, r.id), stamp = Date.now(), added = [];
  part = partOk(kind, part);
  for (const [i, f] of files.entries()) {
    const ext = extOf(f.name) || "bin", fk = fileKind(f.name);
    const fname = `${role === "ref" ? "ref" : fk}_${part || "main"}_${stamp}_${i + 1}.${ext}`;
    await fs.rename(f.tmp, path.join(dir, fname)).catch(async () => { await fs.copyFile(f.tmp, path.join(dir, fname)); });
    const e = { file: fname, kind: fk, role, part, original_name: path.basename(f.name), source, added_at: new Date().toISOString() };
    if (note) e.note = String(note);
    if (prompt) e.prompt = String(prompt);
    if (fk === "image") e.form = await guessForm(path.join(dir, fname), part || ""); // 단일 / 시트 (화면에서 바꿀 수 있다)
    r.files.push(e); added.push(e);
  }
  return added;
}

/** 새 리소스. files = [{ tmp, name }] (업로드 대기 파일) — 예전 화면처럼 만들 때 올린 파일은 결과(대표 파일)로 둔다 */
export const DRAFT_NAME = "이름 없는 캐릭터";
const DRAFT_NAMES = { person: DRAFT_NAME, background: "이름 없는 배경", product: "이름 없는 제품" };
const draftName = (kind) => DRAFT_NAMES[kind] || "이름 없음";
const nameOf = (r) => (r.status === "draft" && r.name === draftName(r.kind) ? { person: "이 캐릭터", background: "이 배경", product: "이 제품" }[r.kind] || "이것" : r.name);

/** status: "draft" 면 인물 만들기 위저드의 작성 중 리소스 — 이름 없이 시작하고 마지막 단계에서 이름을 붙여 저장한다 */
export const COLOR_ROLES = { main: "주색", sub: "보조색", accent: "강조색", bg: "바탕색", text: "글자색" };
// 컬러 칸 정리 — #RGB/#RRGGBB 만, 12개까지
export function cleanColors(list) {
  return (Array.isArray(list) ? list : []).map((c) => {
    let hex = String(c?.hex || "").trim().toUpperCase(); if (!hex.startsWith("#")) hex = `#${hex}`;
    if (/^#[0-9A-F]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((x) => x + x).join("")}`;
    return /^#[0-9A-F]{6}$/.test(hex) ? { hex, name: String(c.name || "").trim().slice(0, 40), role: COLOR_ROLES[c.role] ? c.role : "" } : null;
  }).filter(Boolean).slice(0, 12);
}

export async function createResource({ kind, name, tags = [], description = "", attrs = {}, parts = {}, status = "", client = "", colors = [] }, files = []) {
  if (status === "draft" && !name?.trim()) name = draftName(kind);
  if (!name?.trim()) throw new Error("이름이 필요합니다");
  if (!KINDS[kind]) throw new Error("알 수 없는 리소스 종류");
  const id = `res_${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}`;
  await fs.mkdir(resDir(kind, id), { recursive: true });
  const r = {
    id, kind, name: name.trim(),
    tags: (Array.isArray(tags) ? tags : String(tags).split(",")).map((t) => t.trim()).filter(Boolean),
    description: String(description || ""),
    attrs: pick(KINDS[kind].fields, attrs),
    ...(KINDS[kind].parts ? { parts: cleanParts(kind, parts) } : {}),
    ...(kind === "color" ? { colors: cleanColors(colors) } : {}),
    files: [], history: [],
    ...(clientOk(client) ? { client } : {}),
    ...(status === "draft" ? { status: "draft", wizard: {} } : {}),
    created_at: new Date().toISOString(),
  };
  log(r, { action: status === "draft" ? "draft" : "create" });
  const added = await moveIn(kind, r, files);
  if (added.length) log(r, { action: "add", role: "output", files: added.map((x) => x.file) });
  await save(kind, r);
  return r;
}

function cleanParts(kind, parts = {}) {
  return Object.fromEntries(Object.entries(KINDS[kind].parts).map(([k, def]) => [k, { attrs: pick(def.fields, parts?.[k]?.attrs), prompt: String(parts?.[k]?.prompt || ""), negative: String(parts?.[k]?.negative || "") }]));
}

/** 이름·태그·설명·속성·부분 속성 고치기. 바뀐 칸 이름을 기록에 남긴다 */
export async function updateResource(kind, id, patch = {}) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  // 위저드 진행 상태(고른 값·단계)는 기록 없이 덮어 둔다
  let quiet = false;
  if (patch.wizard && typeof patch.wizard === "object") {
    if (JSON.stringify(patch.wizard).length > 400_000) throw new Error("위저드 저장값이 너무 큽니다");
    r.wizard = patch.wizard; quiet = true;
  }
  const saving = patch.status === "saved" && r.status === "draft";
  const before = JSON.stringify({ n: r.name, t: r.tags, d: r.description, a: r.attrs, p: r.parts, q: r.persona, c: r.client, k: r.colors });
  if (kind === "color" && patch.colors !== undefined) r.colors = cleanColors(patch.colors);
  if (patch.name !== undefined && String(patch.name).trim()) r.name = String(patch.name).trim();
  if (patch.tags !== undefined) r.tags = (Array.isArray(patch.tags) ? patch.tags : String(patch.tags).split(",")).map((t) => t.trim()).filter(Boolean);
  if (patch.description !== undefined) r.description = String(patch.description);
  if (patch.client !== undefined) { if (clientOk(patch.client)) r.client = patch.client; else delete r.client; }
  if (patch.attrs !== undefined) r.attrs = pick(KINDS[kind].fields, patch.attrs);
  if (KINDS[kind].parts && patch.parts !== undefined) r.parts = cleanParts(kind, { ...r.parts, ...patch.parts });
  if (KINDS[kind].persona && patch.persona !== undefined) r.persona = pick(KINDS[kind].persona, patch.persona);
  if (saving) { // 위저드 마지막 단계: 이름을 붙여 리소스로 저장하고, 만든 최종 프롬프트를 기록에 같이 남긴다
    if (!r.name.trim() || r.name === draftName(kind)) throw new Error(`${{ person: "캐릭터", background: "배경", product: "제품" }[kind] || ""} 이름을 적으세요`);
    r.status = "saved";
    for (const [p, v] of Object.entries(r.parts || {})) pushPrompt(r, { part: p, prompt: v.prompt, negative: v.negative, source: "save" });
    log(r, { action: "save", prompts: Object.fromEntries(Object.entries(r.parts || {}).map(([k, v]) => [k, v.prompt]).filter(([, v]) => v)) });
    await save(kind, r);
    return r;
  }
  if (JSON.stringify({ n: r.name, t: r.tags, d: r.description, a: r.attrs, p: r.parts, q: r.persona, c: r.client, k: r.colors }) === before) { if (quiet) await save(kind, r); return r; }
  // 같은 칸을 잇달아 고치면 기록 한 줄로 합친다 (타자 칠 때마다 쌓이지 않게)
  const last = r.history?.[r.history.length - 1], part = partOk(kind, patch.part);
  if (last?.action === "edit" && last.part === part && Date.now() - Date.parse(last.at) < 10 * 60_000) last.at = new Date().toISOString();
  else log(r, { action: "edit", part });
  await save(kind, r);
  return r;
}

/** 파일 붙이기 — 참고 이미지(role: ref) 또는 결과(role: output). files = [{ tmp, name }] */
export async function addResourceFiles(kind, id, files, opts = {}) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const role = opts.role === "ref" ? "ref" : "output";
  const added = await moveIn(kind, r, files, { ...opts, role });
  log(r, { action: opts.source === "generated" ? "generate" : "add", role, part: partOk(kind, opts.part), files: added.map((x) => x.file), ...(opts.prompt ? { prompt: String(opts.prompt) } : {}), ...(opts.refs?.length ? { refs: opts.refs } : {}) });
  await save(kind, r);
  return r;
}

/**
 * 결과 이미지 줌 — 이미지 모델이 "가까이·멀리" 말을 잘 못 따라서, 이미 만든 이미지를 직접 다룬다 (ffmpeg)
 *   in:  scale 배로 잘라 원래 크기로 키운다 → 새 결과 이미지 (크레딧 없음)
 *   out: 원본을 anchor 쪽(기본 가운데)에 두고 둘레를 회색으로 넓힌 판 → 참고 이미지(note "줌아웃 판")로 넣는다.
 *        화면이 이 판을 image 1 로 힉스필드 편집에 보내 회색 테두리를 채운다
 * anchor: center | left | right | top | bottom
 */
const run = promisify(execFile);
export async function zoomImage(kind, id, { file, mode = "in", scale = 1.5, anchor = "center" } = {}) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const f = r.files.find((x) => x.file === file && x.kind === "image");
  if (!f) throw new Error("줌할 이미지가 없습니다");
  scale = Math.min(4, Math.max(1.1, Number(scale) || 1.5));
  const src = path.join(resDir(kind, id), file);
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src]);
  const [w, h] = stdout.trim().split(",").map(Number);
  const pos = { center: [0.5, 0.5], left: [0, 0.5], right: [1, 0.5], top: [0.5, 0], bottom: [0.5, 1] }[anchor] || [0.5, 0.5];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zoom-"));
  const out = path.join(tmpDir, `${mode === "in" ? "zoomin" : "zoomout"}.png`);
  try {
    if (mode === "in") {
      const cw = Math.round(w / scale), ch = Math.round(h / scale), x = Math.round((w - cw) * pos[0]), y = Math.round((h - ch) * pos[1]);
      await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `crop=${cw}:${ch}:${x}:${y},scale=${w}:${h}:flags=lanczos`, out]);
      return addResourceFiles(kind, id, [{ tmp: out, name: "zoomin.png" }], { role: "output", part: f.part, note: `줌인 ${scale}배 (${file})`, prompt: f.prompt || "" });
    }
    const pw = Math.round(w * scale / 2) * 2, ph = Math.round(h * scale / 2) * 2, x = Math.round((pw - w) * pos[0]), y = Math.round((ph - h) * pos[1]); // 원본이 anchor 쪽에 남고 반대쪽으로 넓어진다
    await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `pad=${pw}:${ph}:${x}:${y}:color=0x808080,scale=${w}:${h}:flags=lanczos`, out]);
    return addResourceFiles(kind, id, [{ tmp: out, name: "zoomout.png" }], { role: "ref", part: f.part, note: `줌아웃 판 ${scale}배 (${file})` });
  } finally { await fs.rm(tmpDir, { recursive: true, force: true }); }
}

/** 파일 빼기 — 지우지 않고 _history/ 로 옮겨 기록에서 계속 보이게 한다 */
export async function removeResourceFile(kind, id, file) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const i = r.files.findIndex((f) => f.file === file);
  if (i < 0) throw new Error("그 파일이 없습니다");
  const [f] = r.files.splice(i, 1), dir = resDir(kind, id);
  await fs.mkdir(path.join(dir, "_history"), { recursive: true });
  await fs.rename(path.join(dir, f.file), path.join(dir, "_history", f.file)).catch(() => {});
  (r.removed ||= []).push({ ...f, file: `_history/${f.file}`, removed_at: new Date().toISOString() });
  // 앞선 기록이 가리키던 경로도 옮긴 곳으로 바꿔 기록의 그림이 끊기지 않게
  const moved = (x) => (x === f.file ? `_history/${f.file}` : x);
  for (const h of r.history || []) { if (h.files) h.files = h.files.map(moved); if (h.refs) h.refs = h.refs.map(moved); }
  log(r, { action: "remove", role: f.role || "output", part: f.part || null, files: [`_history/${f.file}`] });
  await save(kind, r);
  return r;
}

export async function deleteResource(kind, id) {
  await fs.rm(resDir(kind, id), { recursive: true, force: true });
}

export async function getResource(kind, id) {
  return readJson(path.join(resDir(kind, id), "resource.json"), null);
}
export const resourcePath = (kind, id, file) => path.join(resDir(kind, id), file);

/** 리소스의 대표 이미지 파일 경로 (없으면 null) — 결과 이미지 우선(인물은 전신 시트 → 얼굴 → 체형), 없으면 참고 이미지 */
// 대표 이미지로 먼저 쓸 부분 (결과 중에서)
const RANK = { person: ["sheet", "face", "body", "pose", "outfit"], background: ["base", "variant", "angles"], product: ["front", "scene", "sheet"] };
export async function resourceImage(kind, id) {
  const r = await getResource(kind, id);
  if (!r) return null;
  const imgs = r.files.filter((x) => x.kind === "image"), outs = imgs.filter((x) => x.role !== "ref");
  const rank = (x) => (RANK[kind] || RANK.person).indexOf(x.part) + 1 || 5;
  const f = outs.sort((a, b) => rank(a) - rank(b))[0] || imgs[0];
  return f ? { res: r, file: path.join(resDir(kind, id), f.file), name: f.file, form: f.form || (["sheet", "angles", "outfit"].includes(f.part) ? "sheet" : "single"), part: f.part || "" } : null;
}

/** 파일 하나의 형태(단일·시트) 바꾸기 */
export async function setFileForm(kind, id, file, form) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  if (!FORMS.includes(form)) throw new Error("single 또는 sheet");
  const f = r.files.find((x) => x.file === file); if (!f) throw new Error("파일이 없습니다");
  f.form = form; await save(kind, r);
  return r;
}

/**
 * 가상 페르소나 만들기 — 고른 참고 이미지(없으면 이 인물의 이미지 전부, 최대 4장)를 Claude 가 보고
 * 인물 속성 · 얼굴/체형/전신 시트 속성과 생성 프롬프트(영어) · 가상의 페르소나를 채운다.
 * 사진 속 사람이 누구인지 추측하지 않고, 겉모습에서 영감을 받은 가상의 인물로 만든다. 덮어쓴 값은 기록에 남긴다.
 */
export async function makePersona(kind, id, files = [], emit = () => {}, { keepParts = false } = {}) {
  const def = KINDS[kind];
  if (!def?.persona) throw new Error("페르소나는 인물에만 만들 수 있습니다");
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const imgs = r.files.filter((f) => f.kind === "image");
  const use = (files.length ? imgs.filter((f) => files.includes(f.file)) : [...imgs.filter((f) => f.role === "ref"), ...imgs.filter((f) => f.role !== "ref")]).slice(0, 4);
  if (!use.length) throw new Error("먼저 참고 이미지를 넣으세요");
  const list = (pairs) => pairs.map(([k, l]) => `"${k}": "${l}"`).join(", ");
  const parts = Object.entries(def.parts).map(([p, d]) => `"${p}": { "attrs": { ${list(d.fields)} }, "prompt": "영어 이미지 생성 프롬프트" }`).join(",\n    ");
  const fixed = Object.entries(r.parts || {}).filter(([, v]) => v.prompt).map(([p, v]) => `- ${def.parts[p]?.label}: ${v.prompt}`).join("\n");
  emit({ message: `Claude 가 참고 이미지 ${use.length}장을 보고 가상 페르소나를 만드는 중 (1~2분)` });
  const { text } = await askClaude(`이 폴더의 이미지 ${use.length}장을 Read 도구로 본다: ${use.map((f) => f.file).join(", ")}
이 사진들을 참고해 콘텐츠 제작에 쓸 **가상의 인물** "${nameOf(r)}" 을 만든다.${keepParts && fixed ? `
생김새는 이미 정해졌다 (아래 최종 프롬프트 — 바꾸지 말고 여기에 맞춰 성격·이야기를 짓는다):
${fixed}` : ""}

규칙:
- 사진 속 사람이 실제로 누구인지 추측하거나 이름·신원을 말하지 않는다. 겉모습(나이대 느낌·헤어·체형·옷차림·분위기)에서 영감만 받은 가상의 인물이다.
- 인종·민족·종교·건강 같은 민감한 속성은 추측해 적지 않는다. 겉으로 보이는 피부톤·머리색 같은 외형 묘사만 쓴다.
- 칸 값은 한국어로 짧게 (속성은 한 줄, 페르소나는 1~2문장). 사진에서 안 보이는 것(키·체형 등)은 자연스럽게 정하되 과장하지 않는다.
- prompt 는 영어 이미지 생성 프롬프트. 같은 사람으로 이어지게 얼굴 생김새를 구체적으로 적고, 배경은 밝은 회색 무지, 글자·워터마크 없음.
  face = 정면 머리·어깨 초상, body = 정면 전신(같은 얼굴), sheet = 캐릭터 시트(위 줄 정면·측면·뒷면 전신, 아래 줄 표정 4가지).
- 지금 적혀 있는 값(참고): 속성 ${JSON.stringify(r.attrs)} · 설명 ${JSON.stringify(r.description || "")}

JSON 하나만 답한다:
{
  "attrs": { "origin": "AI 인물", "gender": "성별", "age_range": "나이대", "look": "외모·스타일 한 줄" },
  "description": "이 인물 소개 2~3문장",
  "tags": ["콘텐츠에서 찾기 쉬운 태그 4~6개 (분위기·스타일·어울리는 장르)"],
${keepParts ? "" : `  "parts": {
    ${parts}
  },
`}  "persona": { ${list(def.persona)} },
  "name_ideas": ["어울리는 캐릭터 이름 후보 4개 (한국어, 실존 유명인 이름은 피한다)"]
}`, { cwd: resDir(kind, id), allowedTools: ["Read"] });
  const j = extractJson(text);
  const fresh = await getResource(kind, id); // 그동안 화면에서 고친 것 위에 덮는다
  const before = { attrs: fresh.attrs, description: fresh.description, tags: fresh.tags, parts: fresh.parts, persona: fresh.persona || {} };
  // 이름 빼고 기본 칸을 모두 채운다. 초상권은 사진만으로 알 수 없으니 정해진 문장으로 둔다
  fresh.attrs = { ...fresh.attrs, ...pick(def.fields, j.attrs), origin: "AI 인물", consent: "AI 가상 인물 — 참고 사진이 실제 인물이면 본인 동의를 확인할 것" };
  if (j.description) fresh.description = String(j.description);
  if (Array.isArray(j.tags) && j.tags.length) fresh.tags = [...new Set(j.tags.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean))].slice(0, 8);
  if (!keepParts) fresh.parts = cleanParts(kind, Object.fromEntries(Object.entries(def.parts).map(([p]) => [p, { ...fresh.parts?.[p], attrs: { ...fresh.parts?.[p]?.attrs, ...j.parts?.[p]?.attrs }, prompt: j.parts?.[p]?.prompt || fresh.parts?.[p]?.prompt }])));
  if (Array.isArray(j.name_ideas)) fresh.wizard = { ...(fresh.wizard || {}), nameIdeas: j.name_ideas.map(String).slice(0, 6) };
  fresh.persona = pick(def.persona, j.persona);
  log(fresh, { action: "persona", files: use.map((f) => f.file), before });
  await save(kind, fresh);
  emit({ message: "페르소나를 채웠습니다" });
  return fresh;
}

/**
 * 프롬프트 완성하기 (힉스필드와 별개) — 고른 이미지 · 인물 속성 · 부분 속성 · 페르소나를 Claude 가 보고
 * 그 부분(얼굴·체형·전신 시트)의 완성된 영어 이미지 프롬프트와 네거티브 프롬프트를 쓴다. 미드저니·GPT 등 어디에 붙여도 되게.
 */
export async function completePrompt(kind, id, part, files = [], emit = () => {}) {
  const def = KINDS[kind], pd = def?.parts?.[part];
  if (!pd) throw new Error("프롬프트 완성은 인물·배경·제품 만들기 단계에서 씁니다");
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const use = r.files.filter((f) => f.kind === "image" && files.includes(f.file)).slice(0, 4);
  if (kind !== "person") return completeObjPrompt(kind, id, r, pd, part, use, emit);
  const label = (defs, vals) => defs.map(([k, l]) => (vals?.[k] ? `${l}: ${vals[k]}` : "")).filter(Boolean).join(" / ") || "(비어 있음)";
  const SHOT = { face: "정면 머리·어깨 초상 (1:1)", body: "정면 전신, 같은 얼굴 (9:16)", sheet: "캐릭터 시트 — 위 줄 정면·측면·뒷면 전신, 아래 줄 표정 4가지 (16:9)" };
  emit({ message: `Claude 가 ${pd.label} 프롬프트를 쓰는 중${use.length ? ` (이미지 ${use.length}장 참고)` : ""}` });
  const { text } = await askClaude(`${use.length ? `이 폴더의 이미지 ${use.length}장을 Read 도구로 본다: ${use.map((f) => f.file).join(", ")}\n` : ""}가상 인물 "${nameOf(r)}" 의 ${pd.label} 이미지를 만들 **완성된 영어 이미지 생성 프롬프트**를 쓴다.
구도: ${SHOT[part]}
인물 속성: ${label(def.fields.filter(([k]) => k !== "consent"), r.attrs)}
${pd.label} 속성: ${label(pd.fields, r.parts?.[part]?.attrs)}
페르소나: ${label(def.persona || [], r.persona)}
지금 적힌 프롬프트(있으면 다듬는다): ${r.parts?.[part]?.prompt || "(없음)"}

규칙:
- 사진 속 사람이 누구인지 추측하거나 이름을 쓰지 않는다. "a fictional ..." 으로 시작하는 가상 인물이다.
- 지금 프롬프트에 사용자가 고른 세부값과 "image N" 지시(예: image 1 = 같은 사람, image 3 = 눈만 참고)가 있으면 빠짐없이 지키고 번호도 그대로 둔다. 다듬기만 한다.
- 지금 프롬프트의 Wardrobe(옷)·Background(배경) 지시는 그대로 지킨다. 참고 이미지 속 옷·배경을 새로 가져와 적지 않는다.
- 같은 사람으로 이어지게 얼굴 생김새(눈·코·입·눈썹·얼굴형·피부·머리)를 구체적으로, 그다음 옷·자세·표정·조명·배경·카메라를 적는다.
- 사진처럼 사실적, 배경은 밝은 회색 무지, 글자·워터마크 없음. 한 문단, 60~120 단어.
- negative 는 피할 것을 쉼표로 (예: extra fingers, distorted face, text, watermark, blurry).

JSON 하나만 답한다: { "prompt": "", "negative": "" }`, { cwd: resDir(kind, id), allowedTools: ["Read"] });
  const j = extractJson(text);
  if (!String(j.prompt || "").trim()) throw new Error("프롬프트가 비어 있습니다");
  const fresh = await getResource(kind, id);
  const before = { prompt: fresh.parts?.[part]?.prompt || "", negative: fresh.parts?.[part]?.negative || "" };
  fresh.parts = cleanParts(kind, { ...fresh.parts, [part]: { ...fresh.parts?.[part], prompt: String(j.prompt).trim(), negative: String(j.negative || "").trim() } });
  log(fresh, { action: "prompt", part, files: use.map((f) => f.file), prompt: fresh.parts[part].prompt, before });
  pushPrompt(fresh, { part, prompt: before.prompt, negative: before.negative, source: "before-claude" });
  pushPrompt(fresh, { part, prompt: fresh.parts[part].prompt, negative: fresh.parts[part].negative, source: "claude" });
  await save(kind, fresh);
  emit({ message: `${pd.label} 프롬프트를 완성했습니다` });
  return fresh;
}

// 배경·제품 위저드의 다듬기 — 사람이 아니라 장소·물건이라 규칙이 다르다 (기록 남기는 방식은 인물과 같다)
const OBJ_RULES = {
  background: `- 장소(공간) 이미지다. 사람은 넣지 않는다 (지금 프롬프트에 사람 지시가 있을 때만 그대로 둔다).
- 같은 공간으로 이어지게 구조·가구·재질·색·조명·소품을 구체적으로, 그다음 시간대·날씨·분위기·카메라(시점·렌즈)를 적는다.
- 인물·제품을 나중에 얹을 빈 자리 지시가 있으면 그대로 지킨다.`,
  product: `- 제품(물건) 이미지다. 참고 이미지 속 제품의 모양·색·소재·라벨·로고를 정확히 따르게 쓴다. 제품 디자인을 새로 지어내지 않는다.
- 라벨·로고 글자는 지금 프롬프트에 큰따옴표로 적힌 것만 그대로 둔다. 새 글자를 넣지 않는다.
- 제품 → 모양·소재·마감·색 → 각도·구도 → 배경·조명·그림자 순서로 적는다.`,
};
async function completeObjPrompt(kind, id, r, pd, part, use, emit) {
  const label = (defs, vals) => defs.map(([k, l]) => (vals?.[k] ? `${l}: ${vals[k]}` : "")).filter(Boolean).join(" / ") || "(비어 있음)";
  emit({ message: `Claude 가 ${pd.label} 프롬프트를 쓰는 중${use.length ? ` (이미지 ${use.length}장 참고)` : ""}` });
  const { text } = await askClaude(`${use.length ? `이 폴더의 이미지 ${use.length}장을 Read 도구로 본다: ${use.map((f) => f.file).join(", ")}\n` : ""}${KINDS[kind].label} "${nameOf(r)}" 의 ${pd.label} 이미지를 만들 **완성된 영어 이미지 생성 프롬프트**를 다듬는다.
${KINDS[kind].label} 속성: ${label(KINDS[kind].fields, r.attrs)}
지금 적힌 프롬프트: ${r.parts?.[part]?.prompt || "(없음)"}

규칙:
- 지금 프롬프트에 사용자가 고른 세부값과 "image N" 지시(예: image 1 = 같은 장소·같은 제품, image 2 = 색만 참고), "Panel N" 칸 목록, "Do not include" 줄이 있으면 빠짐없이 지키고 번호도 그대로 둔다. 다듬기만 한다.
${OBJ_RULES[kind]}
- 글자·워터마크를 새로 넣지 않는다. 한 문단(시트는 칸 목록 유지), 60~160 단어.
- negative 는 피할 것을 쉼표로.

JSON 하나만 답한다: { "prompt": "", "negative": "" }`, { cwd: resDir(kind, id), allowedTools: ["Read"] });
  const j = extractJson(text);
  if (!String(j.prompt || "").trim()) throw new Error("프롬프트가 비어 있습니다");
  const fresh = await getResource(kind, id);
  const before = { prompt: fresh.parts?.[part]?.prompt || "", negative: fresh.parts?.[part]?.negative || "" };
  fresh.parts = cleanParts(kind, { ...fresh.parts, [part]: { ...fresh.parts?.[part], prompt: String(j.prompt).trim(), negative: String(j.negative || "").trim() } });
  log(fresh, { action: "prompt", part, files: use.map((f) => f.file), prompt: fresh.parts[part].prompt, before });
  pushPrompt(fresh, { part, prompt: before.prompt, negative: before.negative, source: "before-claude" });
  pushPrompt(fresh, { part, prompt: fresh.parts[part].prompt, negative: fresh.parts[part].negative, source: "claude" });
  await save(kind, fresh);
  emit({ message: `${pd.label} 프롬프트를 완성했습니다` });
  return fresh;
}

/**
 * 참고 이미지 분석 — 위저드가 보낸 조정 칸 목록(schema)에 맞춰, 사진 속 외모(얼굴·체형·옷)를 칸 값으로 옮긴다.
 * schema = [{ key, label, type: chips|multi|scale|num|swatch|text, options?: [[값, 이름]], lo?, hi?, min?, max? }]
 * refUse = { 파일: [따를 부위] } — 부위를 고른 사진은 그 부위만 본다. 사진 속 사람이 누구인지는 추측하지 않는다.
 * 돌려주는 값: { part, sel: { key: 값 }, memo, summary } — 칸에 없는 값은 버린다
 */
export async function analyzeRefs(kind, id, { part, files = [], refUse = {}, schema = [], memoKey = "" } = {}, emit = () => {}) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const use = r.files.filter((f) => f.kind === "image" && files.includes(f.file)).slice(0, 4);
  if (!use.length) throw new Error("분석할 참고 이미지가 없습니다");
  if (!Array.isArray(schema) || !schema.length || JSON.stringify(schema).length > 60_000) throw new Error("칸 목록이 없습니다");
  const what = kind === "background" ? "장소·분위기·조명·재질" : kind === "product" ? "제품의 모양·소재·색·라벨"
    : { face: "얼굴·머리·피부", body: "체형·자세·몸", outfit: "옷·신발·액세서리", sheet: "의상·배치·스타일", pose: "자세·동작·카메라 구도·배경" }[part] || "외모";
  const goal = { background: "배경(장소) 이미지를 만드는", product: "제품 이미지를 만드는" }[kind] || "가상 캐릭터를 만드는";
  const spec = schema.map((c) => {
    const o = c.options ? ` 값: ${c.options.map(([v, l]) => `${v}(${l})`).join(" | ")}` : "";
    const rng = c.type === "scale" ? ` 1~5 정수 (1=${c.lo}, 3=보통, 5=${c.hi})` : c.type === "num" ? ` ${c.min}~${c.max} 숫자` : c.type === "multi" ? " (값 배열)" : c.type === "text" ? " 짧은 영어 구절 (프롬프트에 그대로 들어간다)" : "";
    return `- ${c.key} [${c.label}] ${c.type}${rng}${o}`;
  }).join("\n");
  emit({ message: `Claude 가 참고 이미지 ${use.length}장에서 ${what}을 읽는 중 (30초~1분)` });
  const { text } = await askClaude(`이 폴더의 이미지 ${use.length}장을 Read 도구로 본다: ${use.map((f) => `${f.file}${refUse[f.file]?.length ? ` (이 사진은 ${refUse[f.file].join(", ")} 만 본다)` : ""}`).join(", ")}
사진 속 ${what}을 보고, ${goal} 아래 조정 칸 값으로 옮긴다.

규칙:
- ${kind === "person" ? "사진 속 사람이 누구인지 추측하거나 이름을 쓰지 않는다. 보이는 외형만 옮긴다." : kind === "product" ? "제품에 적힌 글자(브랜드·제품명·라벨)는 보이는 그대로 옮긴다. 안 읽히면 넣지 않는다." : "사진 속 사람은 무시하고 공간만 본다. 카메라 위치·거리·구도는 memo 에도 적지 않는다 (사용자가 따로 정한다 — 넓은 방 사진이어도 가까운 장면을 만들 수 있다). memo 에는 공간의 재질·색·특징만."}
- 사진에서 분명히 보이는 것만 채운다. 안 보이거나 애매한 칸은 넣지 않는다 (빼면 "자동"이 된다). 보통이면 scale 은 3.
- 값은 각 칸에 적힌 값 중에서만 고른다 (chips·swatch 는 하나, multi 는 배열). 가장 가까운 것을 고른다.
- 칸으로 못 담은 특징(예: ${kind === "background" ? "창틀의 아치 모양, 벽의 타일 무늬" : kind === "product" ? "뚜껑의 홈 무늬, 병 어깨의 각인" : "왼쪽 눈썹 흉터, 웃을 때 보조개, 셔츠 단추 디테일"})만 memo 에 영어 한 문장으로. 칸이 있는 항목(머리·피어싱·귀걸이·액세서리·안경·점·타투 등)은 memo 에 다시 쓰지 않는다 — 사용자가 그 칸을 끄면 memo 때문에 다시 생기기 때문이다.${kind === "person" && ["face", "body", "pose"].includes(part) ? `
- 이 단계에서는 ${part === "pose" ? "사진 속 사람의 얼굴·머리·옷" : "옷·배경·조명·소품"}을 memo 에도 적지 않는다 (${part === "pose" ? "얼굴과 옷은 앞 단계에서 정한 캐릭터 것을 쓴다" : "옷과 배경은 사용자가 따로 정한다"}). ${part === "face" ? "얼굴·머리·피부·귀 장신구 특징만" : part === "body" ? "체형·자세·몸 특징만" : "자세·손 모양·몸 방향·카메라 구도 특징만"} 적는다.` : ""}
- summary 는 무엇을 읽었는지 한국어 한두 문장.

칸 목록:
${spec}

JSON 하나만 답한다: { "sel": { "칸 key": 값 }, "memo": "", "summary": "" }`, { cwd: resDir(kind, id), allowedTools: ["Read"] });
  const j = extractJson(text), byKey = new Map(schema.map((c) => [c.key, c])), sel = {};
  for (const [k, v] of Object.entries(j.sel || {})) {
    const c = byKey.get(k); if (!c) continue;
    const okOpt = (x) => c.options?.some(([o]) => o === x);
    if ((c.type === "chips" || c.type === "swatch") && okOpt(v)) sel[k] = v;
    else if (c.type === "multi" && Array.isArray(v)) { const a = v.filter(okOpt); if (a.length) sel[k] = a; }
    else if (c.type === "scale" && Number.isInteger(Number(v)) && v >= 1 && v <= 5) sel[k] = Number(v);
    else if (c.type === "num" && Number(v) >= c.min && Number(v) <= c.max) sel[k] = Math.round(Number(v));
    else if (c.type === "text" && String(v).trim()) sel[k] = String(v).trim().slice(0, 200);
  }
  const fresh = await getResource(kind, id);
  log(fresh, { action: "analyze", part: partOk(kind, part), files: use.map((f) => f.file), note: String(j.summary || "").slice(0, 300) });
  await save(kind, fresh);
  emit({ message: `참고 이미지에서 ${Object.keys(sel).length}칸을 채웠습니다` });
  return { part, sel, memo: String(j.memo || "").slice(0, 300), memoKey, summary: String(j.summary || "") };
}

/** 다른 리소스의 파일을 이 리소스로 복사해 온다 (예: 다른 인물의 의상 시트, 소품·제품 사진을 의상으로) */
export async function importFile(kind, id, { fromKind, fromId, file, role = "ref", part = null } = {}) {
  const src = await getResource(fromKind, fromId);
  const f = src?.files.find((x) => x.file === file);
  if (!f) throw new Error("가져올 파일이 없습니다");
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  const tmp = path.join(resDir(kind, id), `.import_${Date.now()}_${path.basename(file)}`);
  await fs.copyFile(path.join(resDir(fromKind, fromId), file), tmp);
  return addResourceFiles(kind, id, [{ tmp, name: f.original_name || file }], { role, part, note: `가져옴: ${src.name} (${KINDS[fromKind].label})` });
}

/**
 * 프롬프트 버전 기록 — 부분(얼굴·의상 시트·전신·시트)마다 쓴 프롬프트를 시간순으로 남긴다 (r.promptLog, 최근 300개).
 * source: manual(직접 저장) · analyze(사진 분석) · claude(다듬기) · generate(힉스필드에 씀) · apply(의상 적용) · save(캐릭터 저장)
 * 바로 앞 기록과 같은 프롬프트면 남기지 않는다.
 */
export function pushPrompt(r, { part, prompt, negative = "", source = "manual" }) {
  prompt = String(prompt || "").trim(); if (!prompt) return false;
  const log_ = (r.promptLog ||= []), last = [...log_].reverse().find((x) => x.part === part);
  if (last && last.prompt === prompt && last.negative === negative) return false;
  log_.push({ at: new Date().toISOString(), part, prompt, negative: String(negative || ""), source });
  if (log_.length > 300) log_.splice(0, log_.length - 300);
  return true;
}
export async function addPromptVersion(kind, id, v) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  if (pushPrompt(r, v)) await save(kind, r);
  return r;
}

// ── 고객사 폴더 — 리소스를 고객사별로 묶는다. 리소스에는 client(폴더 ID)만 적고, 폴더 목록은 따로 둔다
//   <DATA_DIR>/_resources/_clients.json = [{ id, name, created_at }]
const CLIENTS_FILE = path.join(RESOURCES_DIR, "_clients.json");
const clientOk = (id) => typeof id === "string" && /^co_\d+$/.test(id);
export async function listClients() { return readJson(CLIENTS_FILE, []); }
export async function createClient(name) {
  name = String(name || "").trim().slice(0, 60);
  if (!name) throw Object.assign(new Error("고객사 이름을 적으세요"), { status: 400 });
  const list = await listClients();
  if (list.some((c) => c.name === name)) throw Object.assign(new Error("같은 이름의 폴더가 있습니다"), { status: 400 });
  const c = { id: `co_${Date.now()}`, name, created_at: new Date().toISOString() };
  await fs.mkdir(RESOURCES_DIR, { recursive: true });
  await writeJson(CLIENTS_FILE, [...list, c]);
  return c;
}
export async function renameClient(id, name) {
  name = String(name || "").trim().slice(0, 60);
  const list = await listClients(), c = list.find((x) => x.id === id);
  if (!c || !name) throw Object.assign(new Error("잘못된 요청"), { status: 400 });
  c.name = name; await writeJson(CLIENTS_FILE, list);
  return c;
}
/** 폴더만 지운다 — 안의 리소스는 지우지 않고 미분류로 옮긴다 */
export async function deleteClient(id) {
  await writeJson(CLIENTS_FILE, (await listClients()).filter((x) => x.id !== id));
  for (const r of await listResources()) if (r.client === id) { delete r.client; await save(r.kind, r); }
}

/** 이미지 한 부분을 잘라 같은 리소스의 새 결과로 넣는다 (예: 인물 시트에서 얼굴만 → part "face") — box 는 퍼센트 */
export async function cropResourceFile(kind, id, { file, box, part = "face" } = {}) {
  const r = await getResource(kind, id);
  if (!r) throw Object.assign(new Error("없음"), { status: 404 });
  if (!r.files.some((x) => x.file === file && x.kind === "image")) throw new Error("이미지 파일이 없습니다");
  const tmp = path.join(os.tmpdir(), `crop_${Date.now()}.png`);
  await cropImage(path.join(resDir(kind, id), file), tmp, box || {});
  return addResourceFiles(kind, id, [{ tmp, name: `${part}_crop.png` }], { role: "output", part, note: `${file} 에서 잘라 냄` });
}
