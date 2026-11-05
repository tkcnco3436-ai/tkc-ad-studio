// 포스터 이미지 만들기 — 내용(무엇을·누구에게·언제·어디서) → Claude 가 카피와 글자 없는 배경 프롬프트를 쓰고
// → 배경 이미지(직접 올리기 · 힉스필드 생성) 위에 글자 층을 화면에서 배치해 PNG 로 뽑는다.
// 저장: <DATA_DIR>/_posters/po_…/ (poster.json · bg_*.png · out_*.png)
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, AD_DIR_RE, readJson, writeJson, listBrands, listAds, getBrand, brandDir } from "./store.js";
import { askClaude, extractJson } from "./claude.js";
import { listKits, kitBrief } from "./cardnews.js";
import { listTemplates, getTemplate, TEMPLATES_DIR } from "./template.js";
import { LAYER_RULES, templateLayout } from "./tplayout.js";

export const POSTERS_DIR = path.join(DATA_DIR, "_posters");
// 크기: 가로 1080 기준 픽셀
export const SIZES = {
  a4: { label: "A4 세로 (인쇄·게시판)", w: 1080, h: 1528, aspect: "3:4" },
  "4:5": { label: "인스타 피드 4:5", w: 1080, h: 1350, aspect: "4:5" },
  "1:1": { label: "정사각 1:1", w: 1080, h: 1080, aspect: "1:1" },
  "9:16": { label: "스토리·릴스 9:16", w: 1080, h: 1920, aspect: "9:16" },
};
export const STYLES = ["미니멀 타이포", "따뜻한 사진 배경", "강렬한 세일", "프리미엄·고급", "귀엽고 밝은 일러스트", "레트로", "시네마틱 영화 포스터"];

// 기록: 포스터마다 한 일(만들기·템플릿·카피·고치기·최종 프롬프트·생성·PNG…)을 최근 300개까지 남긴다 — "기록" 탭에서 본다
const logIt = (p, e) => { p.log = [{ at: new Date().toISOString(), ...e }, ...(p.log || [])].slice(0, 300); };
const dirOf = (id) => { if (!/^po_\d+$/.test(id)) throw new Error("잘못된 포스터 ID"); return path.join(POSTERS_DIR, id); };
const fileOf = (id) => path.join(dirOf(id), "poster.json");

export async function listPosters() {
  const ids = await fs.readdir(POSTERS_DIR).catch(() => []);
  const out = [];
  for (const id of ids.filter((x) => /^po_\d+$/.test(x))) { const p = await readJson(fileOf(id), null); if (p) out.push(p); }
  return out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}
export const getPoster = (id) => readJson(fileOf(id), null);

export async function createPoster(inputs = {}) {
  const id = `po_${Date.now()}`;
  await fs.mkdir(dirOf(id), { recursive: true });
  const p = { id, name: String(inputs.headline || inputs.product || "새 포스터").slice(0, 40), inputs, size: SIZES[inputs.size] ? inputs.size : "4:5", style: inputs.style || STYLES[0],
    copy: null, layers: null, bg: "", bgs: [], outputs: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  logIt(p, { type: "create", title: "포스터 만들기" });
  await writeJson(fileOf(id), p);
  return p;
}

/** 화면에서 고친 것 저장 (넘긴 칸만) */
export async function updatePoster(id, patch = {}) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  for (const k of ["name", "inputs", "size", "style", "copy", "layers", "bg", "overlay", "bg_fit", "bg_color", "nl"]) if (k in patch) p[k] = patch[k];
  if (patch.template === null) p.template = null; // 템플릿 빼기 (입히기는 /template 로만)
  if (Array.isArray(patch.refs)) p.refs = (p.refs || []).filter((r) => patch.refs.includes(r.file)); // 참고 이미지 빼기만
  if (Array.isArray(patch.assets)) { // 내 이미지: 이름 바꾸기·빼기만 (파일은 올릴 때만 생긴다)
    const by = Object.fromEntries(patch.assets.map((a) => [a.file, a]));
    p.assets = (p.assets || []).filter((a) => by[a.file]).map((a) => ({ ...a, name: String(by[a.file].name || a.name).trim().slice(0, 30) || a.name }));
  }
  if (p.bg && !p.bgs.includes(p.bg)) throw new Error("없는 배경입니다");
  for (const L of Object.values(p.layers || {})) if (L?.src && !/^img_\d+\.\w+$/.test(L.src)) throw new Error("잘못된 사진 칸");
  p.updated_at = new Date().toISOString();
  await writeJson(fileOf(id), p);
  return p;
}

export async function deletePoster(id) { await fs.rm(dirOf(id), { recursive: true, force: true }); }

/** Claude: 카피(헤드라인·서브·본문·정보·행동 유도) + 글자 없는 배경 프롬프트 + 색 */
export async function writePosterCopy(id, emit = () => {}) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const i = p.inputs || {}, size = SIZES[p.size];
  const kit = i.kitId ? (await listKits()).find((k) => k.id === i.kitId) : null;
  const refs = (p.refs || []).map((r) => r.file);
  emit({ message: `Claude 가 포스터 카피와 배경 프롬프트를 쓰는 중${refs.length ? ` (참고 이미지 ${refs.length}장)` : ""} (1분 안팎)` });
  const { text } = await askClaude(`너는 포스터 아트디렉터 겸 카피라이터다. 아래 내용으로 포스터 한 장의 글과 배경 이미지 프롬프트를 쓴다.
[무엇] ${i.purpose || ""} · ${i.product || ""}
[꼭 들어갈 말] ${i.message || "-"}
[일시·장소·가격 등 정보] ${i.info || "-"}
[누구에게] ${i.target || "-"}
[행동 유도] ${i.cta || "-"}
[스타일] ${p.style} · 크기 ${size.label} (${size.w}x${size.h})
${refs.length ? `[참고 이미지] ${refs.join(", ")} — Read 로 직접 본다. 색감·레이아웃·글자 배치·분위기만 참고하고, 그 안의 글·로고·인물은 베끼지 않는다. bg_prompt_en 은 이 참고 이미지들의 분위기를 따른다 (힉스필드에 참고 이미지로 같이 넣는다).` : ""}
${tplBrief(p.template)}
${kit ? `[브랜드] ${kit.name} — ${JSON.stringify(kit.design || {}).slice(0, 600)} ${kitBrief(kit).slice(0, 900)}` : ""}

[규칙]
1. headline: 한눈에 읽히는 큰 제목 (한국어 14자 안쪽, 줄바꿈은 \\n 으로 최대 2줄).
2. sub: 헤드라인을 받쳐 주는 한 줄 (25자 안쪽). body: 필요할 때만 2줄 이내. info: 일시·장소·가격처럼 받은 정보만 줄바꿈으로 — 받지 않은 날짜·가격·수치는 지어내지 않는다. cta: 짧은 행동 유도 (예: "지금 예약하기").
3. bg_prompt_en: 배경 이미지 생성 프롬프트(영어). 글자·로고·숫자를 절대 그리지 않는다 ("no text, no letters, no logo" 를 넣는다). 제목이 놓일 자리를 비워 둔다 — text_area 에 맞춰 "clean empty space at the top third" 처럼 쓴다. 스타일·조명·색감·구도를 구체적으로.
4. text_area: 글자를 놓을 자리 "top" | "center" | "bottom".
5. palette: 배경과 어울리는 색 4개 (#hex) — [글자 주색, 강조색, 보조색, 배경 어두운 색].
6. 답은 JSON 하나만:
{ "headline": "", "sub": "", "body": "", "info": "", "cta": "", "bg_prompt_en": "", "text_area": "top", "palette": ["#ffffff", "#ff5a36", "#dddddd", "#111111"], "notes": "" }`, { cwd: dirOf(id), timeoutMs: 4 * 60_000 });
  const copy = extractJson(text);
  if (p.template?.palette?.length) copy.palette = p.template.palette; // 템플릿 색은 그대로 (Claude 가 바꾸지 않게)
  if (p.template?.kind === "poster" && p.template.text_area) copy.text_area = p.template.text_area;
  p.copy = copy;
  if (!p.template?.elements) p.layers = null; // 새 카피면 글자 층을 다시 배치한다 (화면이 기본 배치를 만든다). 템플릿 배치를 쓰는 중이면 그대로 둔다
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "copy", title: "Claude 카피 쓰기", detail: [copy.headline, copy.sub, copy.cta].filter(Boolean).join(" / "), prompt: copy.bg_prompt_en || "" });
  await writeJson(fileOf(id), p);
  emit({ message: "포스터 카피 완성" });
  return { id, copy: true };
}

const IMG_EXT = /^\.(jpe?g|png|webp)$/;
/** 배경 이미지 넣기 (올린 파일 · 힉스필드 결과) — 넣은 배경이 지금 배경이 된다 */
export async function addPosterBg(id, src, name) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const ext = (path.extname(name) || ".png").toLowerCase();
  if (!IMG_EXT.test(ext)) throw new Error(`배경으로 쓸 수 없는 파일입니다: ${name}`);
  const file = `bg_${Date.now()}${ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  p.bgs = [...(p.bgs || []), file]; p.bg = file; p.updated_at = new Date().toISOString();
  logIt(p, { type: "bg", title: /^hf_/.test(name) ? "힉스필드 배경 생성" : "배경 넣기", files: [file] });
  await writeJson(fileOf(id), p);
  return p;
}

/** 화면에서 그린 PNG 저장 */
export async function savePosterPng(id, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  const p = await getPoster(id);
  if (!m || !p) throw new Error("잘못된 요청");
  const file = `out_${Date.now()}.png`;
  await fs.writeFile(path.join(dirOf(id), file), Buffer.from(m[1], "base64"));
  p.outputs = [file, ...(p.outputs || [])];
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "png", title: "PNG 만들기", files: [file] });
  await writeJson(fileOf(id), p);
  return { file };
}

// ── 수집한 이미지 불러오기 (공용 광고 수집 · 링크/업로드) ──
const COLLECT_IMG = /\.(jpe?g|png|webp)$/i;
/** 모든 광고주(직접 분석 포함)의 이미지 광고 사진 + 영상 광고 썸네일 */
export async function collectedImages() {
  const out = [];
  for (const b of await listBrands()) {
    for (const ad of await listAds(b)) {
      for (const [k, f] of Object.entries(ad.files || {})) {
        if (!COLLECT_IMG.test(f) || !/^ph_/.test(f)) continue;
        const thumb = /poster/.test(k) || ad.dir.startsWith("vd_"), img = !thumb; // 영상 광고의 ph_poster 는 썸네일
        out.push({ brandId: b.id, brand: b.name, manual: b.platform === "manual", folder: b.folder, dir: ad.dir, file: f, kind: img ? "이미지" : "영상 썸네일",
          text: String(ad.body_text || ad.title || "").replace(/\s+/g, " ").slice(0, 80), at: ad.collected_at || "" });
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
/** 수집 이미지를 포스터로 가져온다 — as "bg"(배경) | "ref"(참고: 카피·배경 프롬프트·힉스필드 참조) */
export async function importCollected(id, { brandId, dir, file, as = "ref" }) {
  const brand = await getBrand(brandId);
  if (!brand || !AD_DIR_RE.test(dir) || !/^[\w.-]+$/.test(file) || !COLLECT_IMG.test(file)) throw new Error("잘못된 이미지");
  const src = path.join(brandDir(brand), dir, file);
  await fs.access(src).catch(() => { throw new Error("이미지 파일이 없습니다"); });
  if (as === "bg") return addPosterBg(id, src, file);
  if (/^layer:\w+$/.test(as)) return setLayerImage(id, as.slice(6), src, file);
  if (as === "asset") return addPosterAsset(id, src, file, `${brand.name} 이미지`);
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const name = `ref_${Date.now()}${path.extname(file).toLowerCase()}`;
  await fs.copyFile(src, path.join(dirOf(id), name));
  p.refs = [...(p.refs || []), { file: name, from: `${brand.name} · ${dir}` }];
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "ref", title: "참고 이미지 (수집)", detail: `${brand.name} · ${dir}`, files: [name] });
  await writeJson(fileOf(id), p);
  return p;
}
/** 내 PC 에서 올린 참고 이미지 */
export async function addPosterRef(id, src, name) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const ext = (path.extname(name) || ".png").toLowerCase();
  if (!IMG_EXT.test(ext)) throw new Error(`참고로 쓸 수 없는 파일입니다: ${name}`);
  const file = `ref_${Date.now()}${ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  p.refs = [...(p.refs || []), { file, from: name }];
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "ref", title: "참고 이미지 올리기", detail: name, files: [file] });
  await writeJson(fileOf(id), p);
  return p;
}

// ── 템플릿 ──
// ① 포스터 템플릿: 내가 만든 포스터의 크기·스타일·색·글자 층 배치(글은 빼고)를 저장해 새 포스터에 그대로 입힌다
// ② 카드뉴스 템플릿: 수집한 캐러셀에서 뽑은 디자인 토큰(색·정렬·글꼴·라벨)과 표지 장 구조를 포스터에 입힌다
const PTPL_FILE = path.join(POSTERS_DIR, "_templates.json");
const ALIGN = { 왼쪽: "left", 가운데: "center", 오른쪽: "right" };
const tplBrief = (t) => !t ? "" : t.kind === "cardnews"
  ? `[따를 템플릿] 카드뉴스 "${t.name}" 표지 — 디자인 ${JSON.stringify(t.design || {}).slice(0, 500)} / 표지 구성 ${JSON.stringify(t.cover || {}).slice(0, 600)}
  표지의 글 구조(제목 줄 수·강조할 부분·라벨)와 글자 수 제한(max_chars)을 따르고 내용만 내 주제로 바꾼다. palette 는 이 디자인 색을 그대로 쓴다.`
  : `[따를 템플릿] 포스터 "${t.name}" — 글자 자리(text_area ${t.text_area}) · 색 ${JSON.stringify(t.palette || [])} 를 그대로 쓴다. 글 길이는 템플릿 글자 층에 맞춘다.`;

export async function listPosterTemplates() {
  const mine = (await readJson(PTPL_FILE, [])).map((t) => ({ ...t, source: "포스터 템플릿", thumb: t.thumb ? `/data/_posters/_templates/${t.thumb}` : "" }));
  const cards = (await listTemplates()).filter((t) => t.kind === "cardnews").map((t) => ({
    id: `card:${t.id}`, name: t.name, source: "카드뉴스 템플릿", thumb: `/data/_templates/${t.id}/cover.jpg`,
    summary: [t.design?.font, t.design?.align, t.tone].filter(Boolean).join(" · "), colors: [t.design?.text, t.design?.accent, t.design?.bg, t.design?.dark_bg].filter(Boolean),
  }));
  return [...mine, ...cards];
}

/** 지금 포스터를 템플릿으로 저장 (글은 빼고 배치·색·크기만, 썸네일은 마지막 PNG) */
export async function savePosterTemplate(id, name) {
  const p = await getPoster(id);
  if (!p?.layers) throw new Error("글자 층이 있는 포스터만 템플릿으로 저장할 수 있습니다 (카피를 먼저 쓰세요)");
  const list = await readJson(PTPL_FILE, []);
  const tid = `ptpl_${Date.now()}`;
  let thumb = "";
  if (p.outputs?.[0]) {
    await fs.mkdir(path.join(POSTERS_DIR, "_templates"), { recursive: true });
    thumb = `${tid}.png`;
    await fs.copyFile(path.join(dirOf(id), p.outputs[0]), path.join(POSTERS_DIR, "_templates", thumb));
  }
  const layers = Object.fromEntries(Object.entries(p.layers).map(([k, L]) => [k, { ...L, text: "", sample: L.text, src: "" }]));
  list.unshift({ id: tid, name: String(name || p.name || "포스터 템플릿").slice(0, 40), size: p.size, style: p.style, overlay: p.overlay ?? 0.35, bg_color: p.bg_color || "",
    palette: p.copy?.palette || [], text_area: p.copy?.text_area || "top", layers, thumb, created_at: new Date().toISOString() });
  await fs.mkdir(POSTERS_DIR, { recursive: true });
  await writeJson(PTPL_FILE, list);
  return list[0];
}
export async function deletePosterTemplate(tid) {
  const list = await readJson(PTPL_FILE, []), t = list.find((x) => x.id === tid);
  if (t?.thumb) await fs.rm(path.join(POSTERS_DIR, "_templates", t.thumb), { force: true });
  await writeJson(PTPL_FILE, list.filter((x) => x.id !== tid));
}

/** 템플릿을 포스터에 입힌다 — 이미 쓴 글은 남기고 배치·색·크기만 바꾼다 */
export async function applyPosterTemplate(id, tid) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  if (tid.startsWith("card:")) {
    const t = await getTemplate(tid.slice(5));
    if (!t || t.kind !== "cardnews") throw new Error("카드뉴스 템플릿을 찾지 못했습니다");
    const d = t.design || {}, cover = (t.slides || []).find((s) => s.n === 1) || t.slides?.[0] || {};
    const dark = /full|photo|사진/.test(`${cover.image || ""} ${cover.layout || ""}`); // 사진 위 표지면 어두운 바탕 글자색
    const palette = [dark ? d.dark_text || "#ffffff" : d.text || "#111111", d.accent || "#ff5a36", d.muted || "#777777", dark ? d.dark_bg || "#0b0b0b" : d.bg || "#ffffff"];
    p.template = { id: tid, name: t.name, kind: "cardnews", design: d, cover: { role: cover.role, layout: cover.layout, image: cover.image, purpose: cover.purpose, blocks: cover.blocks }, palette, align: ALIGN[d.align] || "center", accent_text: d.accent_text,
      image: await copyTplImage(id, path.join(TEMPLATES_DIR, t.id, "cover.jpg")), needs_layout: !t.poster_layout?.elements?.length };
    const ar = String(t.format?.aspect || ""); if (SIZES[ar]) p.size = ar;
    if (t.poster_layout?.elements?.length) { // 템플릿 저장 때 뽑아 둔 소재 — Claude 를 다시 부르지 않는다
      pushHistory(p);
      p.layers = toLayers(t.poster_layout.elements); p.bg_color = t.poster_layout.bg_color || ""; p.overlay = t.poster_layout.overlay ?? 0;
      p.template.elements = Object.entries(p.layers).map(([k, L]) => ({ key: k, kind: L.kind, name: L.label, text: L.text || L.desc || "" }));
    }
    p.copy = p.copy ? { ...p.copy, palette } : null;
    if (p.layers && !t.poster_layout?.elements?.length) for (const [k, L] of Object.entries(p.layers)) { // 저장된 소재 배치가 없을 때만 정렬·색을 덮는다
      L.align = p.template.align; L.x = L.align === "left" ? 0.07 : L.align === "right" ? 0.93 : 0.5;
      L.color = k === "cta" ? d.accent_text || "#111111" : k === "headline" || k === "info" ? palette[0] : palette[2];
      if (k === "cta") L.bg = palette[1];
    }
  } else {
    const t = (await readJson(PTPL_FILE, [])).find((x) => x.id === tid);
    if (!t) throw new Error("포스터 템플릿을 찾지 못했습니다");
    p.template = { id: t.id, name: t.name, kind: "poster", palette: t.palette, text_area: t.text_area, layers: t.layers,
      image: t.thumb ? await copyTplImage(id, path.join(POSTERS_DIR, "_templates", t.thumb)) : "",
      elements: Object.entries(t.layers).map(([k, L]) => ({ key: k, kind: L.kind || (L.bg ? "button" : "text"), name: L.label || k, text: L.sample || "" })) };
    if (t.bg_color) p.bg_color = t.bg_color;
    p.size = t.size; p.style = t.style; p.overlay = t.overlay;
    if (p.copy) p.copy = { ...p.copy, palette: t.palette, text_area: t.text_area };
    if (p.layers) p.layers = Object.fromEntries(Object.entries(t.layers).map(([k, L]) => [k, { ...L, text: p.layers[k]?.text ?? "", show: L.show && !!(p.layers[k]?.text) }]));
  }
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "template", title: `템플릿 불러오기 — ${p.template?.name || tid}`, files: p.template?.image ? [p.template.image] : [] });
  await writeJson(fileOf(id), p);
  return p;
}

async function copyTplImage(id, src) {
  if (!src || !(await fs.access(src).then(() => true, () => false))) return "";
  const name = `tpl_ref_${Date.now()}${path.extname(src).toLowerCase() || ".jpg"}`;
  await fs.copyFile(src, path.join(dirOf(id), name));
  return name;
}
const snap = (p) => ({ layers: p.layers, bg_color: p.bg_color || "", overlay: p.overlay, bg: p.bg || "", at: new Date().toISOString() });
const pushHistory = (p) => { p.history = [snap(p), ...(p.history || [])].slice(0, 15); };

// 글자 층 { kind: "text" | "button" | "image", label, text, x, y, size, color, weight, align, bg, show, w, h, src, desc }
//   text·button: x 는 정렬 기준점(왼쪽 정렬이면 왼쪽 끝), y 는 윗변, size 는 가로 1080 기준 글자 크기(px)
//   image: x·y 는 왼쪽 위, w·h 는 캔버스 비율(0~1) — 내 사진(src)을 꽉 채워 넣는다
function toLayers(elements = []) {
  const out = {};
  elements.forEach((e, i) => {
    const key = /^[a-z]\w{0,15}$/.test(e.key || "") ? e.key : `e${i + 1}`;
    const x = +e.x || 0, y = +e.y || 0, w = +e.w > 0 ? +e.w : 1 - x, h = +e.h > 0 ? +e.h : 1 - y; /* 크기를 안 주면 끝까지 */ const align = ["left", "center", "right"].includes(e.align) ? e.align : "left";
    if (e.kind === "image" || e.kind === "logo" && !e.text) out[key] = { kind: "image", label: e.name || key, x, y, w, h, src: "", desc: e.desc || e.photo_desc || "", show: true };
    else out[key] = { kind: e.kind === "button" ? "button" : "text", label: e.name || key, text: String(e.text || ""), x, y, // x 는 이미 정렬 기준점 (LAYER_RULES)
      size: Math.max(12, Math.min(260, Math.round(+e.size || 40))), color: e.color || "#111111", weight: +e.weight || 700, align, ...(e.kind === "button" ? { bg: e.bg || "#ff5a36" } : {}), show: true };
  });
  return out;
}

/** 템플릿 이미지를 Claude 가 보고 바꿀 수 있는 소재(글·버튼·사진·로고)와 자리·글꼴·색을 뽑아 같은 배치로 시작한다 */
export async function analyzePosterTemplate(id, { force = false } = {}, emit = () => {}) {
  const p = await getPoster(id);
  if (!p?.template) throw new Error("템플릿을 먼저 불러오세요");
  let out;
  if (p.template.kind === "cardnews") out = await templateLayout(p.template.id.slice(5), { force, emit }); // 템플릿에 저장된 분석 (없을 때만 새로)
  else if (p.template.layers) out = null; // 포스터 템플릿은 저장된 층 그대로
  else throw new Error("이 템플릿에는 소재 정보가 없습니다");
  const q = await getPoster(id); // 그사이 고친 것 위에
  pushHistory(q);
  if (out) {
    q.layers = toLayers(out.elements);
    q.bg_color = out.bg_color || q.bg_color || "";
    q.overlay = out.overlay ?? 0;
  } else q.layers = Object.fromEntries(Object.entries(p.template.layers).map(([k, L]) => [k, { ...L, text: L.sample || "" }]));
  q.template = { ...q.template, needs_layout: false, elements: Object.entries(q.layers).map(([k, L]) => ({ key: k, kind: L.kind, name: L.label, text: L.text || L.desc || "" })) };
  q.updated_at = new Date().toISOString();
  logIt(q, { type: "analyze", title: force ? "템플릿 소재 다시 뽑기" : "템플릿 소재 배치", detail: Object.values(q.layers || {}).map((L) => L.label).join(", ") });
  await writeJson(fileOf(id), q);
  return { id, layout: true };
}

/** 자연어로 고치기 — "입금되었습니다 + 30만원 글자, '30만원 받고 정수기 바꾸기' 버튼, 배경 라이트블루" → 글자 층·배경 */
export async function editPosterNL(id, { instruction, preview } = {}, emit = () => {}) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  if (!String(instruction || "").trim()) throw new Error("어떻게 바꿀지 적으세요");
  const [W, H] = [SIZES[p.size].w, SIZES[p.size].h];
  // 지금 화면(캔버스 PNG)을 Claude 가 볼 수 있게 잠깐 저장
  let shot = "";
  const m = String(preview || "").match(/^data:image\/png;base64,(.+)$/);
  if (m) { shot = "preview_now.png"; await fs.writeFile(path.join(dirOf(id), shot), Buffer.from(m[1], "base64")); }
  emit({ message: "Claude 가 요청대로 고치는 중 (1분 안팎)" });
  const layers = Object.fromEntries(Object.entries(p.layers || {}).map(([k, L]) => [k, { ...L, src: L.src ? "(내 사진 있음)" : "" }]));
  const { text } = await askClaude(`너는 포스터 편집자다. 아래 요청대로 포스터의 글자 층과 배경을 고친다. 사람에게 묻지 말 것.
[요청] ${instruction}
[캔버스] ${W}x${H} · 배경색 ${p.bg_color || "(없음)"} · 배경 사진 ${p.bg ? "있음" : "없음"} · 어둡게 깔기 ${p.overlay ?? 0}
${shot ? `[지금 화면] ${shot} — Read 로 본다.` : ""}${p.template?.image ? ` [템플릿 원본] ${p.template.image} — Read 로 보고 배치·글꼴 느낌을 지킨다.` : ""}
[지금 글자 층] ${JSON.stringify(layers)}
[내 이미지] ${(p.assets || []).map((a) => `「${a.name}」`).join(", ") || "없음"} — 요청에 나오면 kind "image" 층을 만들고 "asset": "이름" 을 적는다 (x·y·w·h 로 자리).
${LAYER_RULES}
[규칙]
1. 요청에 나온 것만 바꾸고 나머지 층(위치·크기·색)은 그대로 둔다. 요청에 새 글·버튼이 있으면 알맞은 기존 층의 글을 바꾸고, 맞는 층이 없으면 새 층을 만든다. 요청과 상관없는 템플릿 원래 글이 남아 어색하면 show:false 로 숨긴다.
2. 글 길이가 바뀌면 크기를 조정해 캔버스 밖으로 나가거나 다른 층과 겹치지 않게 한다. 강조할 숫자(예: 금액)는 크게·굵게·강조색으로.
3. 배경색을 바꾸라면 bg_color 를 바꾸고, 배경 사진 위라 색이 안 보이면 remove_bg_image: true. 글자색은 새 배경과 대비되게 맞춘다.
4. image 층의 src 는 건드리지 않는다 ("(내 사진 있음)" 그대로 두면 유지된다). 새 사진이 필요하면 needs_image 에 적는다.
5. 답은 JSON 하나만:
{ "layers": { "key": { "kind": "text", "label": "", "text": "", "x": 0, "y": 0, "size": 40, "color": "#111111", "weight": 700, "align": "left", "bg": "", "show": true } }, "bg_color": "", "overlay": 0, "remove_bg_image": false, "needs_image": [""], "notes": "" }`, { cwd: dirOf(id), timeoutMs: 4 * 60_000 });
  const out = extractJson(text);
  const q = await getPoster(id);
  pushHistory(q);
  const prev = q.layers || {};
  q.layers = Object.fromEntries(Object.entries(out.layers || {}).map(([k, L]) => {
    const key = /^[a-z]\w{0,15}$/.test(k) ? k : `n${Math.random().toString(36).slice(2, 6)}`;
    const asset = L.asset && (q.assets || []).find((a) => a.name === String(L.asset).replace(/[「」]/g, ""));
    const keepSrc = asset ? asset.file : prev[k]?.src && (!L.src || L.src === "(내 사진 있음)") ? prev[k].src : "";
    const clean = { ...L, src: keepSrc }; delete clean.asset; if (asset) Object.assign(clean, { kind: "image", label: clean.label || asset.name }); if (clean.kind !== "button") delete clean.bg; if (clean.kind === "button" && !clean.bg) clean.bg = prev[k]?.bg || "#ff5a36";
    return [key, clean];
  }));
  if (out.bg_color) q.bg_color = out.bg_color;
  if (out.overlay != null) q.overlay = Math.max(0, Math.min(0.85, +out.overlay || 0));
  if (out.remove_bg_image) q.bg = "";
  q.last_edit = { instruction, notes: out.notes || "", needs_image: (out.needs_image || []).filter(Boolean), at: new Date().toISOString() };
  q.updated_at = new Date().toISOString();
  logIt(q, { type: "edit", title: "캔버스 배치 고치기", instruction, detail: out.notes || "" });
  await writeJson(fileOf(id), q);
  if (shot) await fs.rm(path.join(dirOf(id), shot), { force: true });
  emit({ message: "요청대로 고쳤습니다" });
  return { id, edited: true };
}

/** 되돌리기 — 자연어 수정·템플릿 분석 직전으로 */
export async function undoPoster(id) {
  const p = await getPoster(id);
  const h = p?.history?.[0];
  if (!h) throw new Error("되돌릴 것이 없습니다");
  Object.assign(p, { layers: h.layers, bg_color: h.bg_color, overlay: h.overlay, bg: h.bg });
  p.history = p.history.slice(1);
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "undo", title: "되돌리기" });
  await writeJson(fileOf(id), p);
  return p;
}

/** 사진 칸(image 층)에 내 사진 넣기 */
export async function setLayerImage(id, key, src, name) {
  const p = await getPoster(id);
  const L = p?.layers?.[key];
  if (!L || L.kind !== "image") throw new Error("사진 칸이 아닙니다");
  const ext = (path.extname(name) || ".png").toLowerCase();
  if (!IMG_EXT.test(ext)) throw new Error(`사진으로 쓸 수 없는 파일입니다: ${name}`);
  const file = `img_${Date.now()}${ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  if (L.src && !(p.assets || []).some((a) => a.file === L.src)) await fs.rm(path.join(dirOf(id), L.src), { force: true });
  L.src = file;
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "image", title: `사진 칸 「${L.label || key}」에 사진 넣기`, files: [file] });
  await writeJson(fileOf(id), p);
  return p;
}

// ── 최종 이미지 프롬프트 (변형처럼) ──
// 템플릿 원본(1번) + 내 소재 사진(사진 칸) + 참고 이미지 + 지금 캔버스(배치 가이드)를 첨부 순서대로 묶고,
// 자연어 요청과 글자 층 내용을 합쳐 이미지 생성·편집 모델에 바로 넣을 프롬프트 3가지를 쓴다.
//   with_text_en: 글자까지 그린 완성 포스터 · edit_en: "Edit reference image 1:" 템플릿 편집형 · no_text_en: 글자 없는 배경(캔버스 글자와 합성용)
export async function writeFinalPrompt(id, { instruction = "", preview } = {}, emit = () => {}) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const size = SIZES[p.size], refs = [];
  const add = (file, role, label) => file && refs.push({ n: refs.length + 1, file, role, label });
  for (const [k, L] of Object.entries(p.layers || {})) if (L.kind === "image" && L.src && L.show) add(L.src, "material", `내 소재: ${L.label || k}${L.desc ? ` (템플릿에선 ${L.desc})` : ""}`);
  for (const a of p.assets || []) add(a.file, "asset", `내 이미지 「${a.name}」`);
  for (const r of p.refs || []) add(r.file, "style", `참고 이미지 (${r.from || ""})`);
  const m = String(preview || "").match(/^data:image\/png;base64,(.+)$/);
  if (m && p.layers) { const g = `guide_${Date.now()}.png`; await fs.writeFile(path.join(dirOf(id), g), Buffer.from(m[1], "base64")); add(g, "guide", "배치 가이드 (지금 캔버스)"); }
  // 템플릿 원본은 맨 뒤 번호 — 편집형에만 붙이므로, 앞 번호가 세 버전 모두에서 같다
  add(p.template?.image, "template", `템플릿 원본 (${p.template?.name || ""})`);
  const tn = refs.find((r) => r.role === "template")?.n;
  const texts = Object.entries(p.layers || {}).filter(([, L]) => L.kind !== "image" && L.show && String(L.text || "").trim())
    .map(([k, L]) => ({ name: L.label || k, text: L.text, kind: L.kind, pos: `x${Math.round(L.x * 100)}% y${Math.round(L.y * 100)}% ${L.align}`, size: L.size, color: L.color, bg: L.bg || "" }));
  emit({ message: `Claude 가 최종 이미지 프롬프트를 쓰는 중 (첨부 ${refs.length}장 · 1분 안팎)` });
  const { text } = await askClaude(`너는 광고 포스터 이미지 프롬프트 작가다. 아래 재료로 이미지 생성·편집 모델(gpt-image 계열, 참조 이미지 여러 장 첨부)에 바로 넣을 최종 프롬프트를 쓴다. 사람에게 묻지 말 것.
[첨부 순서] ${refs.map((r) => `${r.n}번 ${r.file} = ${r.label}`).join(" / ") || "없음"} — 모두 Read 로 직접 본다.
[요청] ${instruction || "(따로 없음 — 아래 글자 층과 내용대로)"}
[포스터 내용] ${JSON.stringify(p.inputs || {})}
[넣을 글자] ${JSON.stringify(texts)}
[배경] 색 ${p.bg_color || "(템플릿대로)"} · 스타일 ${p.style} · 크기 ${size.label} ${size.w}x${size.h} (${size.aspect})

[규칙]
1. 생성 모델은 템플릿을 본 적이 없다. "같은 레이아웃으로", "원본처럼" 같은 비교·상대 표현 대신, 결과 그림만 보고 알 수 있게 절대 묘사한다 (어느 자리에 무엇이, 얼마나 크게, 무슨 색으로). 템플릿 원본(${tn ? `${tn}번` : "없음"})은 edit_en 에만 첨부된다 — with_text_en·no_text_en 은 템플릿 번호를 가리키지 않는다.
2. 글자는 한국어 원문 그대로 큰따옴표로 감싸 정확히 적는다 (예: headline text "입금되었습니다"). 글자마다 위치·크기(화면 대비)·굵기·색·서체 느낌(굵은 고딕 등)을 쓴다. 맞춤법을 바꾸지 않는다. 버튼은 모양·색·글자를 같이 쓴다.
3. 내 이미지(asset)는 요청에 「이름」으로 나오면 그 이미지를 그 자리에 그대로 쓴다 ("Use reference image N as the exact ○○ …"). 요청에 안 나온 asset 도 이름으로 보아 쓸 곳이 분명하면 쓰고, 아니면 changes 에 "안 씀"이라고 적는다. 내 소재 사진(material)은 "Use reference image N as the exact ○○ — keep its face/shape/colors/label exactly; do not redraw" 처럼 그대로 쓰라고 하고, 놓을 자리·크기만 정한다. 참고 이미지(style)는 색감·분위기만 따르라고 한다. 배치 가이드(guide)는 요소 위치를 따르라고 하되 그 안의 점선·안내 글자는 그리지 말라고 한다.
4. 요청에서 바꾸라는 것은 확실히 바꾸고, 말하지 않은 템플릿 요소(구도·조명·여백 느낌)는 유지한다. 단 템플릿·캔버스에 남은 원래 글이 요청한 새 글·주제와 맞지 않으면(다른 브랜드·다른 주제 문구) 남기지 말고 요청한 글로 그 자리를 대신한다 — 어떻게 했는지 changes 에 적는다. 요청에 없는 수치·효능·로고는 지어내지 않는다.
5. with_text_en: 글자까지 모두 그린 완성 포스터 한 장 (참조: material·asset·style·guide 번호만). edit_en: ${tn ? `"Edit reference image ${tn}:" 로 시작` : "템플릿이 없으므로 빈칸"} — 템플릿에서 유지할 것과 바꿀 것을 나눠 쓴다 (템플릿이 없으면 빈칸). no_text_en: 글자·로고·숫자 없는 배경·비주얼만, 글자가 들어갈 자리를 비워 둔다 ("no text, no letters, no logo").
6. 각 프롬프트 끝에 비율(${size.aspect})과 "high quality, sharp Korean typography"(글자 있는 것만)를 붙인다.
7. 답은 JSON 하나만:
{ "with_text_en": "", "edit_en": "", "no_text_en": "", "prompt_ko": "무엇을 만드는지 한국어 요약 2~3줄", "texts": [{ "text": "", "where": "" }], "changes": "요청을 어떻게 해석했는지", "notes": "" }`, { cwd: dirOf(id), timeoutMs: 5 * 60_000 });
  const out = extractJson(text);
  const q = await getPoster(id);
  const fin = { ...out, refs, instruction, aspect: size.aspect, created_at: new Date().toISOString() };
  q.finals = [fin, ...(q.finals || [])].slice(0, 30);
  q.updated_at = new Date().toISOString();
  logIt(q, { type: "final", title: "최종 이미지 프롬프트", vid: `v_${Date.now()}`, state: stateOf({ ...q, nl: instruction || q.nl, finals: [fin, ...(q.finals || [])] }), instruction, detail: out.prompt_ko || "", prompts: { with_text_en: out.with_text_en || "", edit_en: out.edit_en || "", no_text_en: out.no_text_en || "" }, refs, files: refs.map((r) => r.file) });
  await writeJson(fileOf(id), q);
  emit({ message: "최종 이미지 프롬프트 완성" });
  return { id, final: true };
}

/** 생성 결과를 완성 포스터(만든 PNG 목록)로 넣기 */
export async function addPosterOutput(id, src, name) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const file = `out_${Date.now()}${(path.extname(name) || ".png").toLowerCase()}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  p.outputs = [file, ...(p.outputs || [])];
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "output", title: "힉스필드 포스터 생성", files: [file] });
  await writeJson(fileOf(id), p);
  return p;
}

/** 내 이미지 추가 (이름을 붙여 자연어 요청에서 「이름」으로 부른다) */
export async function addPosterAsset(id, src, filename, name = "") {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const ext = (path.extname(filename) || ".png").toLowerCase();
  if (!IMG_EXT.test(ext)) throw new Error(`이미지로 쓸 수 없는 파일입니다: ${filename}`);
  const file = `img_${Date.now()}${ext}`;
  await fs.copyFile(src, path.join(dirOf(id), file));
  const base = String(name || path.basename(filename, path.extname(filename))).trim().slice(0, 30) || "이미지";
  let n = base, i = 2; while ((p.assets || []).some((a) => a.name === n)) n = `${base} ${i++}`; // 이름 겹치지 않게
  p.assets = [...(p.assets || []), { file, name: n }];
  p.updated_at = new Date().toISOString();
  logIt(p, { type: "asset", title: `내 이미지 추가 「${n}」`, files: [file] });
  await writeJson(fileOf(id), p);
  return p;
}

/** 모든 포스터의 기록을 시간 순(최근 먼저)으로 — "기록" 탭 */
export async function posterLog() {
  const out = [];
  for (const p of await listPosters()) for (const e of p.log || []) {
    const { state, ...rest } = e;
    out.push({ ...rest, poster: p.id, posterName: p.name || p.id, hasState: !!state, template: state?.template?.name || "", size: state?.size || "" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
}

// ── 저장(버전) — 지금 상태와 화면 썸네일을 기록에 남기고, 기록에서 그 버전으로 되돌릴 수 있다 ──
const stateOf = (p) => ({ name: p.name, inputs: p.inputs, size: p.size, style: p.style, copy: p.copy, layers: p.layers, bg: p.bg || "", bg_color: p.bg_color || "", overlay: p.overlay,
  template: p.template || null, assets: p.assets || [], refs: p.refs || [], nl: p.nl || "", finals: (p.finals || []).slice(0, 1), last_edit: p.last_edit || null }); // 기록에서 그 시점 화면을 그대로 보여 주는 값
export async function savePosterVersion(id, { memo = "", preview } = {}) {
  const p = await getPoster(id);
  if (!p) throw new Error("포스터가 없습니다");
  const m = String(preview || "").match(/^data:image\/png;base64,(.+)$/);
  let file = "";
  if (m) { file = `snap_${Date.now()}.png`; await fs.writeFile(path.join(dirOf(id), file), Buffer.from(m[1], "base64")); }
  const vid = `v_${Date.now()}`;
  logIt(p, { type: "save", title: memo ? `저장 — ${String(memo).slice(0, 40)}` : "저장", vid, detail: memo || "", files: file ? [file] : [], state: stateOf(p) });
  p.saved_at = new Date().toISOString(); p.updated_at = p.saved_at;
  await writeJson(fileOf(id), p);
  return { saved_at: p.saved_at, vid };
}
export async function restorePosterVersion(id, vid) {
  const p = await getPoster(id);
  const e = p?.log?.find((x) => x.vid === vid && x.state);
  if (!e?.state) throw new Error("그 저장 버전을 찾지 못했습니다");
  pushHistory(p); // 되돌리기 버튼으로 다시 돌아올 수 있게
  const { finals, ...rest } = structuredClone(e.state); // 최종 프롬프트 목록은 지금 것을 지킨다 (그 버전 프롬프트는 맨 앞으로)
  Object.assign(p, rest);
  if (finals?.[0] && !(p.finals || []).some((f) => f.created_at === finals[0].created_at)) p.finals = [finals[0], ...(p.finals || [])].slice(0, 10);
  logIt(p, { type: "restore", title: `저장 버전으로 되돌리기 (${new Date(e.at).toLocaleString("ko-KR")})`, files: e.files || [] });
  p.updated_at = new Date().toISOString();
  await writeJson(fileOf(id), p);
  return p;
}

/** 기록 한 줄의 그 시점 상태 (기록 탭에서 눌러 만들기 화면으로 볼 때) */
export async function posterVersion(id, vid) {
  const p = await getPoster(id);
  const e = p?.log?.find((x) => x.vid === vid && x.state);
  if (!e) throw new Error("그 기록을 찾지 못했습니다");
  // 그 시점까지 쓴 프롬프트 전부 (최종 이미지 프롬프트 + 카피 단계 배경 프롬프트) — 최근 먼저
  const finals = p.log.filter((x) => x.at <= e.at && ((x.type === "final" && x.prompts) || (x.type === "copy" && x.prompt))).map((x) => x.type === "final"
    ? { ...x.prompts, refs: x.refs || [], instruction: x.instruction || "", prompt_ko: x.detail || "", aspect: x.state?.finals?.[0]?.aspect || SIZES[x.state?.size]?.aspect || "", created_at: x.at }
    : { no_text_en: x.prompt, refs: [], instruction: "(카피 쓰기) 배경 프롬프트", prompt_ko: x.detail || "", aspect: SIZES[p.size]?.aspect || "", created_at: x.at });
  return { at: e.at, type: e.type, title: e.title, memo: e.detail || "", files: e.files || [], state: { ...e.state, finals: finals.length ? finals : e.state.finals || [] } };
}

/** 리소스·레퍼런스 파일을 포스터로 — as: "ref"(참고 이미지) | "asset"(내 이미지) */
export async function importResource(id, { kind, resId, file, name = "", as = "ref" }) {
  const { resourcePath } = await import("./resources.js");
  if (!/^res_\w+$/.test(resId) || !/^[\w.-]+$/.test(file || "")) throw new Error("잘못된 리소스");
  const src = resourcePath(kind, resId, file);
  await fs.access(src).catch(() => { throw new Error("리소스 파일이 없습니다"); });
  return as === "asset" ? addPosterAsset(id, src, file, name) : addPosterRef(id, src, name ? `레퍼런스 · ${name}` : file);
}
