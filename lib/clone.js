// 영상 복제하기 — 힉스필드 Genjutsu(영상 속 소재를 참고 이미지로 바꾸기)에 넣을 프롬프트를 만든다. 광고 수집과 따로 논다.
//   ① 링크·mp4 → 직접 분석과 같은 기계 분석(스펙·컷·프레임·화면 글자·음성) → Claude 가 프레임을 보고 장면 설명 + 바꿀 수 있는 것
//   ② 바꿀 것마다 이미지(올리기·리소스)·메모를 넣는다. 아무것도 안 넣은 것은 원본 그대로 둔다
//      원본에 없는 것은 "추가할 것"(adds)으로 넣는다 — 이미지 + 이름 + 의도(언제·어떻게 등장하고 무엇을 하는지)
//   ③ 프롬프트 만들기 → Genjutsu 프롬프트(원본 영상 + 이미지 N) · 첫 프레임 편집 + 이미지→영상 프롬프트 · 컷별 프롬프트
// 저장: <DATA_DIR>/_clones/cl_…/ (clone.json · vd_<ID>/ 원본과 분석 · swaps/ 넣은 이미지)
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, readJson, writeJson } from "./store.js";
import { askClaude, extractJson } from "./claude.js";
import { analyzeUrl, analyzeUpload, extOf } from "./manual.js";
import { resourceImage } from "./resources.js";
import { guessForm, cropImage, FORMS } from "./imgform.js";

export const CLONES_DIR = path.join(DATA_DIR, "_clones");
const dirOf = (id) => { if (!/^cl_\d+$/.test(id)) throw new Error("잘못된 영상 복제 ID"); return path.join(CLONES_DIR, id); };
const fileOf = (id) => path.join(dirOf(id), "clone.json");
const KINDS = ["인물", "제품", "배경", "소품", "의상", "로고·글자", "동물", "기타"];
// 바꿀 범위 — 소재 종류마다 고를 수 있는 부분. 고르지 않으면 전부 바꾼다 (화면: public/clone.js 의 같은 표)
export const SCOPES = {
  인물: [["face", "얼굴", "face (face shape, eyes, nose, mouth, skin tone, age)"], ["hair", "헤어", "hairstyle and hair color"], ["body", "체형", "body type and proportions"], ["outfit", "의상", "outfit (top, bottom, shoes — type, color, material)"], ["accessory", "액세서리", "accessories (glasses, jewelry, hat, bag)"]],
  동물: [["species", "종·생김새", "species, breed and body"], ["fur", "털색·무늬", "fur color and pattern"], ["accessory", "소품", "collar and accessories"]],
  제품: [["shape", "형태 전체", "overall shape and form"], ["label", "라벨·로고", "label, logo and printed graphics"], ["color", "색", "colors and finish"]],
  배경: [["place", "장소 전체", "the whole location and its objects"], ["color", "색감·조명", "color palette and lighting only"]],
  의상: [["design", "디자인", "garment type and cut"], ["color", "색·무늬", "color and pattern"]],
};
const scopeOf = (kind, parts) => { const all = SCOPES[kind] || []; const on = all.filter(([k]) => (parts?.length ? parts.includes(k) : true)); return { on, off: all.filter((x) => !on.includes(x)), all: on.length === all.length }; };
const MAX_FRAMES = 24; // Claude 에게 보여줄 프레임 수 상한
const LOG_MAX = 30;
const IMG = /^(jpe?g|png|webp)$/;

export async function listClones() {
  const ids = (await fs.readdir(CLONES_DIR).catch(() => [])).filter((x) => /^cl_\d+$/.test(x));
  const out = [];
  for (const id of ids) { const c = await readJson(fileOf(id), null); if (c) out.push(c); }
  return out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}
export async function getClone(id) {
  const c = await readJson(fileOf(id), null);
  // 형태(단일·시트)를 넣기 전에 올린 이미지는 처음 읽을 때 한 번 짐작해 둔다
  let fill = false;
  for (const sw of Object.values(c?.swaps || {})) if (sw.image && !sw.form) { sw.form = await guessForm(path.join(dirOf(id), sw.image)); fill = true; }
  for (const x of c?.adds || []) if (x.image && !x.form) { x.form = await guessForm(path.join(dirOf(id), x.image)); fill = true; }
  if (fill) await writeJson(fileOf(id), c);
  return c;
}
const save = async (c) => { c.updated_at = new Date().toISOString(); await writeJson(fileOf(c.id), c); return c; };

/** 새 작업 — 폴더만 만들고 분석은 runAnalyze 가 한다 */
export async function createClone({ url = "", name = "" }) {
  await fs.mkdir(CLONES_DIR, { recursive: true });
  let id = `cl_${Date.now()}`;
  while (await fs.stat(dirOf(id)).then(() => true, () => false)) id = `cl_${Date.now() + 1}`;
  await fs.mkdir(dirOf(id), { recursive: true });
  const c = { id, title: name || url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60) || "새 영상", source: url ? { url } : { upload: name },
    status: "analyzing", swaps: {}, promptLog: [], created_at: new Date().toISOString() };
  return save(c);
}

export async function updateClone(id, data) {
  const c = await getClone(id); if (!c) throw new Error("영상 복제 작업이 없습니다");
  if (typeof data.title === "string") c.title = data.title.trim() || c.title;
  // 메모: { e1: { note } } — 이미지는 setSwap 으로만 바꾼다
  for (const [k, v] of Object.entries(data.swaps || {})) {
    if (!c.analysis?.elements?.some((e) => e.id === k)) continue;
    c.swaps[k] = { ...(c.swaps[k] || {}), note: String(v.note ?? c.swaps[k]?.note ?? "") };
    if (FORMS.includes(v.form)) c.swaps[k].form = v.form;
    if (Array.isArray(v.parts)) { const kind = c.analysis.elements.find((e) => e.id === k)?.kind; c.swaps[k].parts = v.parts.filter((x) => (SCOPES[kind] || []).some(([id]) => id === x)); }
  }
  if (data.extra !== undefined) c.extra = String(data.extra);
  if (Array.isArray(data.adds)) { // 추가할 것: 이름·종류·의도 고치기 · 새로 추가(id 없음) · 빼기 (이미지는 setSwap 으로)
    const prev = Object.fromEntries((c.adds || []).map((x) => [x.id, x]));
    c.adds = data.adds.map((x, i) => ({ ...(prev[x.id] || {}), id: prev[x.id] ? x.id : `a${Date.now()}${i}`,
      kind: KINDS.includes(x.kind) ? x.kind : "소품", name: String(x.name ?? "").trim().slice(0, 40), note: String(x.note ?? "") }));
    for (const x of Object.values(prev)) if (x.image && !c.adds.some((y) => y.id === x.id)) await fs.rm(path.join(dirOf(id), x.image), { force: true });
  }
  if (data.prompts && c.prompts) c.prompts = { ...c.prompts, ...pick(data.prompts, ["genjutsu_prompt_en", "first_frame_prompt_en", "i2v_prompt_en", "negative_en"]), edited: true };
  return save(c);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o[k] === "string").map((k) => [k, o[k]]));

export async function deleteClone(id) { await fs.rm(dirOf(id), { recursive: true, force: true }); }

/** ① 받기 + 기계 분석 + 바꿀 수 있는 것 찾기 */
export async function runAnalyze(id, { url, upload, whisper = true, ocr = true }, emit = () => {}) {
  const c = await getClone(id); if (!c) throw new Error("영상 복제 작업이 없습니다");
  const root = dirOf(id);
  try {
    const opts = { whisper, ocr, root };
    const r = url ? await analyzeUrl(url, opts, emit) : await analyzeUpload(upload.file, upload.name, opts, emit);
    const src = r.saved?.[0];
    if (!src?.startsWith("vd_")) throw new Error("영상이 아닙니다 — 영상 링크나 mp4·mov·webm 파일을 넣으세요");
    const ad = await readJson(path.join(root, src, "ad.json"), {});
    const v = (await readJson(path.join(root, src, "analysis.json"), {})).videos?.[0];
    if (!v) throw new Error("영상 분석 결과가 없습니다");
    Object.assign(c, {
      src, title: c.source.url && ad.title ? ad.title.slice(0, 80) : c.title,
      video: `${src}/${v.file}`, poster: ad.files?.poster ? `${src}/${ad.files.poster}` : `${src}/${v.shots[0]?.frame}`,
      contact_sheet: `${src}/${v.contact_sheet}`, transcript: v.transcript_file ? `${src}/${v.transcript_file}` : null,
      spec: v.spec, cuts: v.cuts,
      shots: v.shots.map((s) => ({ shot: s.shot, start: s.start, end: s.end, dur: s.dur, frame: `${src}/${s.frame}`, onscreen_text: s.onscreen_text || "", speech: s.speech || "" })),
      body_text: ad.body_text || "",
    });
    await save(c);
    await findElements(c, emit);
    c.status = "ready"; c.error = null;
    await save(c);
    return { id };
  } catch (e) {
    c.status = c.shots?.length ? "ready" : "error"; c.error = e.message; await save(c);
    throw e;
  }
}

/** 다시 찾기 — 기계 분석은 그대로 두고 Claude 단계만 */
export async function reanalyzeElements(id, emit = () => {}) {
  const c = await getClone(id); if (!c?.shots?.length) throw new Error("먼저 영상을 분석하세요");
  await findElements(c, emit);
  c.status = "ready"; c.error = null;
  await save(c);
  return { id };
}

function lookFrames(shots) {
  const step = Math.max(1, Math.ceil(shots.length / MAX_FRAMES));
  return shots.filter((_, i) => i % step === 0).map((s) => s.frame);
}

async function findElements(c, emit) {
  const look = lookFrames(c.shots);
  emit({ message: `Claude 가 컷 ${c.shots.length}개를 보고 바꿀 수 있는 것을 찾는 중 (1~3분)` });
  const prompt = `너는 AI 영상 편집 감독이다. 아래 영상을 "구조·움직임·카메라·타이밍은 그대로 두고, 화면 속 소재만 다른 것으로 바꿔 다시 만드는" 작업(힉스필드 Genjutsu: 원본 영상 + 참고 이미지로 소재 교체)을 준비한다.
현재 폴더의 프레임 이미지를 Read 로 직접 보고 판단해라: ${look.join(", ")}

[영상] ${c.spec.duration_s}초 · ${c.spec.width}x${c.spec.height} (${c.spec.aspect}) · 컷 ${c.shots.length}개
[본문] ${(c.body_text || "").slice(0, 500)}
[컷 목록 — 기계 분석. 화면 글자는 OCR, 음성은 자동 인식이라 오타가 있을 수 있다]
${JSON.stringify(c.shots.map(({ shot, start, dur, frame, onscreen_text, speech }) => ({ shot, start, dur, frame, onscreen_text, speech })))}

[할 일]
1. scenes: 컷마다 무엇이 보이고 어떻게 움직이는지. 컷 번호·시간은 위 값 그대로.
2. elements: 다른 이미지로 바꿀 수 있는 소재. 같은 인물·제품이 여러 컷에 나오면 하나로 묶고 나오는 컷 번호를 shots 에 모두 적는다.
   - kind 는 다음 중 하나: ${KINDS.join(", ")}
   - 화면에서 눈에 띄는 것만 (보통 3~8개). 바꾸면 영상이 달라 보이는 순서(중요도)로 정렬한다.
   - 인물의 옷이 따로 바꿀 만하면 "의상" 으로 따로 둔다. 화면 글자·로고는 "로고·글자".
   - frame: 그 소재가 가장 잘 보이는 프레임 파일 경로 (위 목록에 있는 것 그대로). box: 그 프레임에서 소재를 감싸는 상자, 이미지 크기 대비 퍼센트(0~100, 왼쪽 위 기준).
   - desc_en: 원본 소재를 프롬프트에서 가리킬 때 쓸 영어 묘사 (예: "the woman in a beige knit sweater with shoulder-length black hair"). 생김새·색·위치로 구분되게.
   - image_hint: 바꿀 이미지로 무엇을 넣으면 좋은지 (예: "정면 전신 사진, 흰 배경", "제품 단독 누끼컷").
   - difficulty: 쉬움 | 보통 | 어려움 — Genjutsu 로 바꿀 때 (가려짐·빠른 움직임·작은 크기·손에 쥔 물건이면 어려움).
3. keep: 바꾸지 않고 지켜야 할 것 (움직임·카메라·구도·조명·타이밍·편집 리듬) 짧게 여러 줄.
4. 모르는 것은 빈 문자열. 사진 속 실제 인물이 누구인지 추측하지 않는다. 답은 아래 JSON 하나만, 설명 문장 금지.

{
  "summary": "영상이 무엇이고 어떻게 흘러가는지 2~3문장 (한국어)",
  "style_en": "전체 촬영 스타일·색감·조명 한 줄 (영어)",
  "scenes": [{ "shot": 1, "desc_ko": "화면에 보이는 것", "action_en": "이 컷의 움직임·카메라 (영어 한 줄)", "camera": "고정 | 패닝 | 줌인 | 줌아웃 | 돌리 | 핸드헬드 | 기타" }],
  "elements": [{ "kind": "인물", "name": "짧은 이름 (예: 주인공 여성)", "desc_ko": "", "desc_en": "", "shots": [1], "frame": "", "box": { "x": 0, "y": 0, "w": 0, "h": 0 }, "image_hint": "", "difficulty": "보통" }],
  "keep": [""]
}`;
  const { text, durationMs } = await askClaude(prompt, { cwd: dirOf(c.id) });
  const a = extractJson(text);
  const frames = new Set(c.shots.map((s) => s.frame));
  const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
  a.elements = (a.elements || []).map((e, i) => ({
    ...e, id: `e${i + 1}`, kind: KINDS.includes(e.kind) ? e.kind : "기타",
    shots: (e.shots || []).map(Number).filter((n) => c.shots.some((s) => s.shot === n)),
    frame: frames.has(e.frame) ? e.frame : c.shots.find((s) => s.shot === Number(e.shots?.[0]))?.frame || c.shots[0].frame,
    box: e.box && Number(e.box.w) > 0 ? { x: clamp(e.box.x), y: clamp(e.box.y), w: clamp(e.box.w), h: clamp(e.box.h) } : null,
  }));
  // 다시 찾으면 소재 번호가 바뀌므로 넣어 둔 이미지는 이름이 같은 소재로 옮긴다
  const old = Object.fromEntries((c.analysis?.elements || []).map((e) => [e.id, e.name]));
  const swaps = {};
  for (const [k, v] of Object.entries(c.swaps || {})) {
    const to = a.elements.find((e) => e.name === old[k]);
    if (to) swaps[to.id] = v; else if (v.image) await fs.rm(path.join(dirOf(c.id), v.image), { force: true });
  }
  c.swaps = swaps;
  c.analysis = { ...a, at: new Date().toISOString() };
  emit({ message: `바꿀 수 있는 것 ${a.elements.length}개 (${Math.round(durationMs / 1000)}초)` });
}

/** ② 바꿀 이미지 넣기·빼기: { el, src+name | resource:{kind,id} | clear } */
// 인물 얼굴 사진 — 전신·시트 이미지는 얼굴이 작아 영상 모델이 옷만 바꾸고 얼굴은 원본을 남기기 쉽다.
// 얼굴 클로즈업을 따로 넣으면 image 번호를 하나 더 주고 "얼굴은 이 사진과 똑같이"라고 못 박는다
async function setFace(c, el, { src, name, resource, clear, crop }) {
  const sw = c.swaps[el] ||= {};
  if (sw.face_image) await fs.rm(path.join(dirOf(c.id), sw.face_image), { force: true });
  if (clear) { delete sw.face_image; delete sw.face_from; return save(c); }
  if (crop) { // 넣은 이미지(시트)에서 얼굴 부분을 잘라 얼굴 사진으로
    if (!sw.image) throw new Error("먼저 바꿀 이미지를 넣으세요");
    const rel = `swaps/${el}_face_${Date.now()}.png`;
    await cropImage(path.join(dirOf(c.id), sw.image), path.join(dirOf(c.id), rel), crop);
    Object.assign(sw, { face_image: rel, face_from: "넣은 이미지에서 자름" });
    return save(c);
  }
  let file = src, ext = extOf(name || ""), from = "";
  if (resource) {
    const { getResource, resourcePath } = await import("./resources.js");
    const r = await getResource(resource.kind, resource.id);
    const f = (r?.files || []).filter((x) => x.kind === "image" && x.part === "face").pop();
    if (!f) throw new Error("이 리소스에 얼굴 이미지가 없습니다");
    file = resourcePath(resource.kind, resource.id, f.file); ext = extOf(f.file); from = r.name;
  }
  if (!IMG.test(ext)) throw new Error("jpg·png·webp 이미지만 넣을 수 있습니다");
  await fs.mkdir(path.join(dirOf(c.id), "swaps"), { recursive: true });
  const rel = `swaps/${el}_face_${Date.now()}.${ext.replace("jpeg", "jpg")}`;
  await fs.copyFile(file, path.join(dirOf(c.id), rel));
  Object.assign(sw, { face_image: rel, face_from: from });
  return save(c);
}

export async function setSwap(id, { el, src, name, resource, clear, slot, crop }) {
  const c = await getClone(id); if (!c) throw new Error("영상 복제 작업이 없습니다");
  const add = (c.adds || []).find((x) => x.id === el); // 추가할 것이면 그 항목에 이미지를 단다
  if (!add && !c.analysis?.elements?.some((e) => e.id === el)) throw new Error("바꿀 소재를 찾지 못했습니다");
  if (slot === "face" && !add) return setFace(c, el, { src, name, resource, clear, crop });
  const cur = add || c.swaps[el] || {};
  if (cur.image) await fs.rm(path.join(dirOf(id), cur.image), { force: true });
  if (clear) { if (add) { add.image = ""; add.from = ""; } else c.swaps[el] = { note: cur.note || "" }; return save(c); }
  let from = "", file = src, ext = extOf(name || ""), form = "";
  if (resource) {
    const r = await resourceImage(resource.kind, resource.id);
    if (!r) throw new Error("이미지가 있는 리소스가 아닙니다");
    file = r.file; ext = extOf(r.file); from = r.res.name; form = r.form;
  }
  if (!IMG.test(ext)) throw new Error("jpg·png·webp 이미지만 넣을 수 있습니다");
  await fs.mkdir(path.join(dirOf(id), "swaps"), { recursive: true });
  const rel = `swaps/${el}_${Date.now()}.${ext.replace("jpeg", "jpg")}`;
  await fs.copyFile(file, path.join(dirOf(id), rel));
  form ||= await guessForm(path.join(dirOf(id), rel)); // 단일 / 시트 — 화면에서 바꿀 수 있다
  if (add) Object.assign(add, { image: rel, from, form }); else c.swaps[el] = { ...cur, image: rel, from, form };
  // 인물 리소스에 얼굴 결과가 있으면 얼굴 사진 칸도 같이 채운다 (리소스 인물 만들기의 "얼굴" 단계 결과)
  const kind = c.analysis?.elements?.find((e) => e.id === el)?.kind;
  if (resource && kind === "인물" && !add && !c.swaps[el].face_image) {
    await save(c);
    return setFace(await getClone(id), el, { resource }).catch(() => getClone(id));
  }
  return save(c);
}

/** ③ 프롬프트 만들기 — 이미지·메모를 넣은 소재만 바꾸고 나머지는 원본 그대로 */
export async function makeClonePrompts(id, emit = () => {}) {
  const c = await getClone(id); if (!c?.analysis) throw new Error("먼저 영상을 분석하세요");
  const els = c.analysis.elements;
  const changes = els.filter((e) => c.swaps[e.id]?.image || c.swaps[e.id]?.note?.trim());
  const adds = (c.adds || []).filter((x) => x.name.trim() || x.image);
  if (!changes.length && !adds.length && !c.extra?.trim()) throw new Error("바꿀 것이나 추가할 것을 하나 이상 넣으세요");
  // 이미지 번호: Genjutsu 는 원본 영상(video reference) + 이미지 1·2…, 첫 프레임 편집은 원본 첫 프레임이 image 1 이라 하나씩 밀린다
  let n = 0;
  const refs = changes.map((e) => { const sw = c.swaps[e.id]; const image = sw?.image ? ++n : null; return { el: e, sw, image, face: sw?.face_image ? ++n : null }; });
  const addRefs = adds.map((x) => ({ x, image: x.image ? ++n : null }));
  const keeps = els.filter((e) => !changes.includes(e));
  const first = c.shots[0].frame;
  const look = [...new Set([...lookFrames(c.shots).slice(0, 12), ...changes.map((e) => e.frame)])];
  emit({ message: `Claude 가 프롬프트를 쓰는 중 — 바꿀 것 ${changes.length}개 · 추가 ${adds.length}개 · 그대로 ${keeps.length}개 (1~2분)` });
  const prompt = `너는 AI 영상 편집 프롬프트 작가다. 원본 영상의 움직임·카메라·구도·타이밍은 그대로 두고, 지정한 소재만 새 이미지로 바꾸는 프롬프트를 쓴다.
현재 폴더의 이미지를 Read 로 직접 보고 써라.
- 원본 프레임: ${look.join(", ")}
- 새 이미지 (반드시 하나하나 Read 로 열어 생김새를 확인한다): ${[...refs.flatMap((r) => [r.image && `${r.sw.image} (= image ${r.image}, ${r.el.name} 자리에 들어갈 것)`, r.face && `${r.sw.face_image} (= image ${r.face}, ${r.el.name} 의 얼굴 클로즈업 — 얼굴은 이 사진과 똑같이)`].filter(Boolean)), ...addRefs.filter((r) => r.image).map((r) => `${r.x.image} (= image ${r.image}, 원본에 없는 ${r.x.name} — 새로 등장시킬 것)`)].join(", ") || "없음"}

[원본 영상] ${c.spec.duration_s}초 · ${c.spec.aspect} ${c.spec.orientation} · 컷 ${c.shots.length}개
- 요약: ${c.analysis.summary || ""}
- 스타일: ${c.analysis.style_en || ""}
- 컷: ${JSON.stringify((c.analysis.scenes || []).map((s) => { const m = c.shots.find((x) => x.shot === Number(s.shot)); return { ...s, start: m?.start, dur: m?.dur }; }))}
- 지킬 것: ${(c.analysis.keep || []).join(" / ")}

[바꿀 것]
${refs.map((r) => { const sc = scopeOf(r.el.kind, r.sw.parts); return `- ${r.el.id} ${r.el.kind} "${r.el.name}" — 원본: ${r.el.desc_en} (컷 ${r.el.shots.join(",")}) → ${r.image ? `image ${r.image} 의 ${r.el.kind} (${r.sw.form === "sheet" ? "여러 각도를 한 장에 모은 시트 — 한 대상이다. 정면 모습을 기준으로" : "단일 이미지"})` : "이미지 없음"}${r.face ? ` · 얼굴은 image ${r.face} (얼굴 클로즈업)와 똑같이` : ""}${sc.on.length ? `
    · 바꿀 부분: ${sc.all ? `전부 (${sc.on.map((x) => x[1]).join("·")}) — 원본의 흔적이 남지 않게 완전히 교체` : sc.on.map((x) => x[1]).join("·")}${sc.off.length ? ` · 원본 그대로 둘 부분: ${sc.off.map((x) => x[1]).join("·")}` : ""}` : ""}${r.sw.note?.trim() ? `
    · 메모: ${r.sw.note.trim()}` : ""}`; }).join("\n") || "없음"}
${addRefs.length ? `[추가할 것 — 원본에 없다. 의도대로 새로 등장시키고, 그 동작은 원본 움직임보다 우선한다]
${addRefs.map((r) => `- ${r.x.kind} "${r.x.name}"${r.image ? ` = image ${r.image}` : " (이미지 없음 — 이름대로)"} · 의도: ${r.x.note?.trim() || "자연스러운 자리에 보이게"}`).join("\n")}` : ""}
${c.extra?.trim() ? `[전체 메모] ${c.extra.trim()}` : ""}

[그대로 둘 것 — 프롬프트에서 바꾸라고 하지 않는다]
${keeps.map((e) => `- ${e.kind} "${e.name}": ${e.desc_en}`).join("\n") || "없음"}

[규칙]
1. genjutsu_prompt_en: 힉스필드 Genjutsu(원본 영상 + 참고 이미지 ${n ? `1~${n}` : "없음"})에 넣을 영어 한 문단. 소재마다 "Replace <원본 묘사> with the <kind> from image N" 꼴로 원본을 생김새·위치로 콕 집어 가리키고, 새 이미지에서 따를 점(얼굴·머리·옷·색·라벨·모양)을 적는다. 메모만 있는 것은 메모대로 바꾸라고 쓴다. 추가할 것이 있으면 "Add the <kind> from image N: …" 로 생김새와 의도(언제 — 컷·초, 누가, 어떤 동작)를 구체적으로 쓴다 (예: "In the final 2 seconds, after the dance ends, the dancer picks up the beef jerky from image 2 with the right hand and waves it toward the camera"). 끝에 "Keep everything else exactly as in the source video: …" 로 그대로 둘 소재·움직임·카메라·조명·타이밍을 적되, 추가 동작이 들어가는 구간은 "except …" 로 예외를 밝힌다.
1-1. 바꿀 부분이 정해진 소재(특히 인물)는 그 부분을 하나씩 이름 붙여 바꾸라고 쓴다. 새 이미지를 Read 로 보고 그 부분의 생김새를 구체적으로 적는다 — 얼굴(얼굴형·눈·눈썹·코·입·피부톤·나이대), 헤어(길이·색·스타일·앞머리), 체형, 의상(상의·하의·신발의 종류·색 hex·소재·핏), 액세서리(안경·장신구·모자 유무). 이미지에 없는 액세서리는 "no glasses"처럼 없다고 쓴다.
   · "전부"면 "Completely replace the person — face, hair, body and outfit must all come from image N; nothing of the original person's face, hairstyle or clothing remains." 처럼 원본 흔적이 남지 않게 못 박는다. 안경 하나 더하거나 옷 색만 바꾸는 식으로 일부만 바꾸지 않는다.
   · 일부만이면 바꿀 부분은 image N 을 따르고, 원본 그대로 둘 부분은 "keep the original person's <부분> unchanged" 로 따로 밝힌다.
   · 얼굴 클로즈업 image 가 따로 있으면: "The face must exactly match the close-up in image M — same face shape, eyes, eyebrows, nose, lips, skin tone, hairline and glasses; do not keep any feature of the original person's face." 를 넣고, 전신 이미지(image N)는 체형·의상 기준으로만 쓴다.
   · 위 [바꿀 것]에 "시트"라고 적힌 이미지는 "image N is a reference sheet of ONE <person/product> shown from several angles — use the front view as the main reference" 라고 반드시 밝힌다. "단일 이미지"는 그런 말을 쓰지 않는다.
   · first_frame_prompt_en · shots 에도 같은 범위를 같은 문장으로 쓴다.
2. first_frame_prompt_en: 이미지 편집 모델용 (추가할 것은 첫 프레임에 이미 보여야 하면 넣고, 나중에 등장하면 넣지 않는다). image 1 = 원본 첫 프레임(${first}), 새 이미지는 번호가 하나씩 밀려 image 2 부터다. 첫 프레임에서 같은 소재를 바꾸고 나머지·구도는 그대로 두라는 영어 프롬프트.
3. i2v_prompt_en: 위 첫 프레임 결과를 이미지→영상 모델에 넣을 때 쓸 영어 프롬프트. 원본의 움직임·카메라를 컷 흐름 순서로, 추가할 것의 의도 동작은 그 시점에 (${c.spec.duration_s}초, ${c.spec.aspect}).
4. shots: 컷마다 바뀐 소재·추가 동작을 반영한 영어 영상 프롬프트(컷 단위로 다시 만들 때). 컷 번호·시간은 위 값 그대로, 줄이거나 합치지 않는다. 같은 소재는 모든 컷에서 같은 문장으로 묘사한다.
5. 프롬프트에 글자·자막·워터마크를 새로 넣으라고 쓰지 않는다. 로고·글자를 바꾸는 경우만 그 글자를 큰따옴표로 적는다.
6. checklist: 사람이 확인할 위험 (예: 가려진 손에 든 제품은 잘 안 바뀔 수 있음, 이미지 각도가 원본과 다름, 원본에 없는 동작은 원본 움직임을 따라가는 모델에서 약하게 나올 수 있음) 한국어 짧게.
7. 답은 아래 JSON 하나만. 설명 문장 금지.

{
  "genjutsu_prompt_en": "", "genjutsu_prompt_ko": "위 영어의 한국어 번역",
  "first_frame_prompt_en": "", "i2v_prompt_en": "",
  "negative_en": "",
  "shots": [{ "shot": 1, "start": 0, "dur": 0, "prompt_en": "", "prompt_ko": "" }],
  "checklist": [""]
}`;
  const { text, durationMs } = await askClaude(prompt, { cwd: dirOf(id) });
  const out = extractJson(text);
  const byShot = new Map(c.shots.map((s) => [s.shot, s]));
  out.shots = (out.shots || []).map((s) => ({ ...s, start: byShot.get(Number(s.shot))?.start ?? s.start, dur: byShot.get(Number(s.shot))?.dur ?? s.dur }));
  out.references = [...refs.flatMap((r) => [r.image && { image: r.image, el: r.el.id, name: r.el.name, kind: r.el.kind, file: r.sw.image }, r.face && { image: r.face, el: r.el.id, name: `${r.el.name} 얼굴`, kind: r.el.kind, file: r.sw.face_image, face: true }].filter(Boolean)),
    ...addRefs.filter((r) => r.image).map((r) => ({ image: r.image, el: r.x.id, name: r.x.name, kind: r.x.kind, file: r.x.image, added: true }))];
  out.added = adds.map((x) => ({ id: x.id, name: x.name, note: x.note || "" }));
  out.first_frame = first;
  out.changed = refs.map((r) => r.el.id); out.kept = keeps.map((e) => e.id);
  out.at = new Date().toISOString();
  const cur = await getClone(id); // 쓰는 동안 고친 메모를 덮지 않게 다시 읽는다
  cur.prompts = out;
  cur.promptLog = [{ at: out.at, prompts: out, swaps: structuredClone(cur.swaps), adds: structuredClone(cur.adds || []), extra: cur.extra || "" }, ...(cur.promptLog || [])].slice(0, LOG_MAX);
  await save(cur);
  emit({ message: `프롬프트 완성 (${Math.round(durationMs / 1000)}초)` });
  return { id };
}

/** 기록에서 그때 프롬프트로 되돌리기 */
export async function restoreClonePrompts(id, at) {
  const c = await getClone(id); if (!c) throw new Error("영상 복제 작업이 없습니다");
  const v = (c.promptLog || []).find((x) => x.at === at); if (!v) throw new Error("그 기록이 없습니다");
  c.prompts = structuredClone(v.prompts);
  return save(c);
}
