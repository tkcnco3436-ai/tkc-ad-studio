// 카드뉴스: 수집한 캐러셀(이미지 여러 장)에서 디자인·구조·흐름을 뽑아 템플릿으로 저장하고,
// 주제와 이미지만 넣으면 같은 틀로 새 카드뉴스 내용을 쓴다. 그림(PNG)은 화면에서 이 내용을 그려 만든다.
//   <DATA_DIR>/_templates/<tpl_ID>/template.json (kind: "cardnews") · ref/slide_N.jpg · cover.jpg
//   <DATA_DIR>/_templates/<tpl_ID>/cards/<c_ID>/card.json · img_N.* · slide_N.png
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { askClaude, extractJson } from "./claude.js";
import { AD_DIR_RE, brandDir, readJson, writeJson } from "./store.js";
import { TEMPLATES_DIR, getTemplate } from "./template.js";
import { templateLayout } from "./tplayout.js";
import { extOf } from "./manual.js";

// 화면 렌더러가 아는 블록 — Claude 는 이 안에서만 고른다
const BLOCKS = `
- label: 맨 위 작은 머리말 (보통 계정·시리즈 이름) { "type": "label", "text": "" }
- tag: 강조 배경이 깔린 짧은 꼬리표 { "type": "tag", "text": "" }
- title: 큰 제목, 줄바꿈은 \\n, 강조할 낱말은 highlight 에 { "type": "title", "text": "", "highlight": "" }
- subhead: 굵은 소제목 { "type": "subhead", "text": "" }
- body: 본문 문단 { "type": "body", "text": "" }
- list: 번호 목록 { "type": "list", "items": [{ "title": "", "desc": "" }] }
- stat: 큰 숫자 { "type": "stat", "value": "6일", "unit": "이하", "caption": "" }
- compare: 전·후 비교 상자 { "type": "compare", "before": { "title": "", "items": [""] }, "after": { "title": "", "items": [""] } }
- box: 테두리·어두운 상자 { "type": "box", "title": "", "text": "", "dark": false }
- quote: 인용 { "type": "quote", "text": "", "source": "" }
- note: 작은 주석 { "type": "note", "text": "" }`;

function buildAnalyzePrompt(ad, images) {
  return `너는 카드뉴스 아트디렉터다. 아래 캐러셀(카드 ${images.length}장)을 "주제만 바꾸면 같은 디자인·구조로 다시 만들 수 있는 템플릿"으로 정리한다.
현재 폴더의 이미지를 순서대로 Read 로 직접 본다: ${images.join(", ")}

[게시물 본문]
${(ad.body_text || "").slice(0, 1500)}

[블록 종류 — 카드 안의 요소는 이 중에서만 고른다]
${BLOCKS}

[규칙]
1. 장마다 layout 하나: cover(사진이 깔린 표지) | content(흰 바탕 정보 카드) | quote(어두운 바탕 인용) | cta(강조색 바탕 마무리)
2. blocks 에는 실제 카드의 글자를 그대로 example 로 넣는다 (type 별 필드에). 각 블록에 max_chars(이 자리에 들어갈 글자 수 상한, 실제 글자 수 기준 +20%)를 붙인다.
3. image: 사진이 쓰인 장은 "full"(전체 배경) 또는 "inset"(본문 사이 사진), 없으면 "none".
4. design 의 색은 이미지에서 보이는 실제 색(hex). 글꼴은 느낌만(굵은 고딕 등).
5. flow 는 장들을 묶은 흐름(훅 → 문제 → 사례·근거 → 방법 → 실행 팁 → CTA 같은). 장 번호로.
6. 계정명·브랜드는 design.label / design.handle 에만 두고, 다른 곳은 일반화하지 말고 원문 그대로 example 에 둔다.
7. 답은 아래 JSON 하나만. 설명 문장 금지.

{
  "name": "템플릿 이름 (형식이 드러나게, 예: '사례 인터뷰형 10장 — 문제→사례→방법→CTA')",
  "summary": "이 카드뉴스가 어떻게 작동하는지 2~3문장",
  "hook_type": "질문형 | 숫자형 | 사례형 | 반전형 | 기타",
  "tone": "",
  "design": {
    "bg": "#ffffff", "text": "#111111", "muted": "#555555", "accent": "#d7f25a", "accent_text": "#111111",
    "dark_bg": "#111111", "dark_text": "#ffffff", "font": "굵은 고딕",
    "label": "맨 위 머리말 원문", "handle": "@계정", "next_button": "다음 페이지 →",
    "title_size": "크게 | 아주 크게", "align": "왼쪽 | 가운데"
  },
  "flow": [{ "section": "훅", "slides": [1], "purpose": "" }],
  "slides": [{
    "n": 1, "role": "표지 | 문제 제기 | 배경 | 사례 | 방법 | 인용 | 수치 | 비교 | 실행 팁 | CTA",
    "layout": "cover", "image": "full", "purpose": "이 장이 하는 일",
    "blocks": [{ "type": "title", "text": "", "highlight": "", "max_chars": 20 }]
  }],
  "copy_patterns": ["반복되는 문장 공식"],
  "caption_pattern": "게시물 본문(캡션)의 구조",
  "notes": ""
}`;
}

/** 이미지 광고(캐러셀) → 카드뉴스 템플릿 */
export async function createCardTemplate(brand, adDirName, emit = () => {}) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const adDir = path.join(brandDir(brand), adDirName);
  const ad = await readJson(path.join(adDir, "ad.json"), null);
  if (!ad) throw new Error("광고 정보가 없습니다");
  // ph_image.jpg, ph_image_2.jpg … 순서대로 (포스터는 뺀다)
  const order = (f) => Number(f.match(/_(\d+)\.\w+$/)?.[1] || 1);
  const images = Object.values(ad.files || {}).filter((f) => /^ph_image(_\d+)?\.(jpe?g|png|webp)$/i.test(f)).sort((a, b) => order(a) - order(b));
  if (!images.length) throw new Error("이미지가 없는 광고입니다");

  emit({ message: `Claude 가 카드 ${images.length}장을 보는 중 (1~3분)` });
  const { text, durationMs } = await askClaude(buildAnalyzePrompt(ad, images), { cwd: adDir });
  const tpl = extractJson(text);
  emit({ message: `카드뉴스 템플릿 정리 완료 (${Math.round(durationMs / 1000)}초)` });

  const id = `tpl_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const dir = path.join(TEMPLATES_DIR, id);
  await fs.mkdir(path.join(dir, "ref"), { recursive: true });
  const refs = [];
  for (const [i, f] of images.entries()) {
    const name = `ref/slide_${i + 1}.${extOf(f) || "jpg"}`;
    await fs.copyFile(path.join(adDir, f), path.join(dir, name));
    refs.push(name);
  }
  await fs.copyFile(path.join(adDir, images[0]), path.join(dir, "cover.jpg"));
  const analysis = await readJson(path.join(adDir, "analysis.json"), {});
  const first = analysis.images?.find((im) => im.file === images[0]);
  const full = {
    id, kind: "cardnews", ...tpl,
    format: { width: first?.width || 1080, height: first?.height || 1350, aspect: first?.aspect || "4:5", slide_count: images.length },
    media: { cover: "cover.jpg", refs },
    source: { brand: brand.name, brand_id: brand.id, ad_dir: adDirName, library_id: ad.library_id, platform: ad.platform, url: ad.source_url || ad.landing_url || null },
    cards: [],
    created_at: new Date().toISOString(),
  };
  await writeJson(path.join(dir, "template.json"), full);
  // 포스터에서 불러 쓸 소재(글·버튼·사진·로고와 자리)를 지금 한 번 뽑아 둔다 — 실패해도 템플릿은 남기고, 처음 불러올 때 다시 뽑는다
  await templateLayout(id, { emit }).catch((e) => emit({ message: `소재 분석은 건너뜀: ${e.message}` }));
  return { id, kind: "cardnews" };
}

// ── 만들기: 주제 + 이미지 → 같은 틀의 새 카드 내용 ──
function buildMakePrompt(t, { topic, details, imageFiles, kit, links }) {
  const imgSlides = t.slides.filter((s) => s.image && s.image !== "none").map((s) => s.n);
  return `너는 카드뉴스 에디터다. 아래 템플릿의 장 수·장마다의 layout·블록 구성·흐름을 그대로 지키고, 새 주제로 글만 새로 쓴다.
${imageFiles.length ? `사용자가 준 이미지(현재 폴더, Read 로 본다): ${imageFiles.join(", ")} — 사진이 들어가는 장(${imgSlides.join(", ") || "없음"})에 순서대로 들어간다. 사진 내용과 글이 어울리게 쓴다.` : "사용자 이미지는 없다."}

[새 주제] ${topic}
[참고 내용·사실] ${details || (links.length ? "(아래 자료 링크에서 확인한 것만)" : "(없음 — 주제에서 일반적으로 맞는 내용만 쓰고, 확인 안 된 수치·고유명사는 지어내지 않는다. 수치 자리는 [수치] 처럼 빈칸으로 둔다)")}
${kit ? `[브랜드] ${kit.name} — 이 브랜드 계정에서 올리는 카드뉴스다. 아래 소개·말투·금지어를 지킨다.
${kitBrief(kit) || "(소개 없음)"}
` : ""}${links.length ? `[자료 링크] 아래 링크를 WebFetch 로 하나씩 열어 읽고, 거기서 확인한 사실·수치만 쓴다. 열리지 않는 링크는 건너뛰고 sources 에 이유를 적는다. 링크끼리 말이 다르면 더 최근·원출처를 따른다.
${links.map((u, i) => `${i + 1}. ${u}`).join("\n")}
` : ""}

[템플릿]
- 이름: ${t.name}
- 흐름: ${JSON.stringify(t.flow)}
- 문장 공식: ${JSON.stringify(t.copy_patterns || [])}
- 캡션 구조: ${t.caption_pattern || ""}
- 장 구성(예시 글 포함): ${JSON.stringify(t.slides)}

[규칙]
1. 장 수 ${t.slides.length}장, n·layout·image·블록의 type 순서는 템플릿과 같게. list 항목 수·compare 줄 수도 비슷하게.
2. 블록마다 max_chars 를 넘기지 않는다. 제목은 2줄 안(\\n 으로 끊기), 강조 낱말(highlight)은 제목 안에 실제로 있는 낱말.
3. 예시 글의 말투·문장 공식을 따른다. 예시의 사실·이름은 가져오지 않는다.
4. caption: 인스타 게시물 본문을 캡션 구조대로 새로 쓴다 (해시태그 포함).
5. 답은 아래 JSON 하나만.

{ "title": "이 카드뉴스 이름", "slides": [{ "n": 1, "layout": "", "image": "", "blocks": [] }], "caption": ""${links.length ? `, "sources": [{ "url": "", "used": "이 링크에서 가져온 것 한 줄 (못 열었으면 이유)" }]` : ""} }`;
}

/** opts = { topic, details, uploads: [{ tmp, name }], kitId(브랜드 에셋), links(자료 링크) } */
export async function makeCards(id, { topic, details = "", uploads = [], kitId = "", links = [] }, emit = () => {}) {
  const t = await getTemplate(id);
  if (!t || t.kind !== "cardnews") throw new Error("카드뉴스 템플릿이 아닙니다");
  if (!topic?.trim()) throw new Error("주제를 적으세요");
  const cid = `c_${Date.now()}`;
  const dir = path.join(TEMPLATES_DIR, id, "cards", cid);
  await fs.mkdir(dir, { recursive: true });
  const imageFiles = [];
  for (const [i, u] of uploads.entries()) {
    const name = `img_${i + 1}.${extOf(u.name) || "jpg"}`;
    await fs.copyFile(u.tmp, path.join(dir, name));
    imageFiles.push(name);
  }
  const kit = kitId ? (await listKits()).find((k) => k.id === kitId) : null;
  // 올린 사진이 없으면 브랜드 에셋 사진을 쓴다
  if (kit && !imageFiles.length) {
    for (const [i, f] of (kit.images || []).entries()) {
      const name = `img_${i + 1}.${extOf(f) || "jpg"}`;
      await fs.copyFile(path.join(kitDir(kit.id), f), path.join(dir, name)).then(() => imageFiles.push(name), () => {});
    }
  }
  links = (Array.isArray(links) ? links : String(links).split("\n")).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 15);
  try {
    emit({ message: `Claude 가 "${topic}" 카드뉴스 ${t.slides.length}장을 쓰는 중${links.length ? ` — 자료 링크 ${links.length}개를 읽고 (2~5분)` : " (1~2분)"}` });
    const { text, durationMs } = await askClaude(buildMakePrompt(t, { topic: topic.trim(), details: details.trim(), imageFiles, kit, links }), {
      cwd: dir, allowedTools: links.length ? ["Read", "WebFetch"] : ["Read"],
    });
    const out = extractJson(text);
    // 사진 자리에 올린 이미지를 순서대로 붙인다
    let k = 0;
    for (const s of out.slides || []) if (s.image && s.image !== "none" && imageFiles[k]) s.image_file = imageFiles[k++];
    // 정렬은 템플릿 값을 그대로 쓴다 (Claude 가 빠뜨려도 유지)
    for (const [i, s] of (out.slides || []).entries()) {
      const ts = t.slides[i]; if (!ts) continue;
      for (const k of ["align", "valign"]) if (ts[k] && !s[k]) s[k] = ts[k];
      (s.blocks || []).forEach((b, j) => { const tb = ts.blocks?.[j]; if (tb?.align && tb.type === b.type && !b.align) b.align = tb.align; });
    }
    const card = {
      cid, topic: topic.trim(), details: details.trim(), images: imageFiles, links, created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000), ...out, pngs: [],
      // 브랜드 에셋의 색·글자를 이 카드뉴스에 씌운다
      ...(kit ? { kit: { id: kit.id, name: kit.name }, design: kit.design || {} } : {}),
    };
    await writeJson(path.join(dir, "card.json"), card);
    emit({ message: `카드뉴스 글 완성 (${card.took_s}초) — 화면에서 그림으로 만듭니다` });
    return { id, cid };
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

// ── 주제 추천: 브랜드 소개 또는 모은 자료(링크·웹 검색)에서 이 템플릿 구조에 맞는 주제를 뽑는다 ──
const parseLinks = (links) => (Array.isArray(links) ? links : String(links || "").split("\n")).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 15);

/** opts = { mode: "brand" | "research", kitId, links, keyword } */
export async function suggestTopics(id, { mode = "brand", kitId = "", links = [], keyword = "" }) {
  const t = await getTemplate(id);
  if (!t || t.kind !== "cardnews") throw new Error("카드뉴스 템플릿이 아닙니다");
  const kit = kitId ? (await listKits()).find((k) => k.id === kitId) : null;
  links = parseLinks(links);
  keyword = String(keyword || "").trim();
  if (mode === "brand" && !kit) throw new Error("브랜드 에셋을 고르세요");
  if (mode === "research" && !links.length && !keyword) throw new Error("자료 링크나 키워드를 넣으세요");
  const search = mode === "research" && !links.length;
  const roles = (t.slides || []).map((s) => s.role).join(" → ");
  const prompt = `너는 카드뉴스 기획자다. 아래 템플릿 구조로 만들기 좋은 카드뉴스 주제 5개를 추천한다.

[템플릿] ${t.name}
- 훅 유형: ${t.hook_type || ""} · 말투: ${t.tone || ""}
- 장 흐름: ${roles}
- 흐름 묶음: ${JSON.stringify(t.flow || [])}
- 문장 공식: ${JSON.stringify(t.copy_patterns || [])}
${kit ? `
[브랜드] ${kit.name}
${kitBrief(kit) || "(소개 없음)"}
` : ""}${keyword ? `
[키워드·방향] ${keyword}
` : ""}${links.length ? `
[자료 링크] WebFetch 로 하나씩 열어 읽는다. 열리지 않으면 건너뛴다.
${links.map((u, i) => `${i + 1}. ${u}`).join("\n")}
` : ""}${search ? `
[자료 찾기] WebSearch 로 키워드 관련 최신 자료를 여러 번 찾고, 쓸 만한 페이지는 WebFetch 로 열어 사실을 확인한다.
` : ""}
[규칙]
1. 템플릿 구조가 요구하는 재료가 있는 주제만 고른다 (예: 숫자 훅이면 실제 숫자, 사례형이면 실제 사례, 단계형이면 단계로 나눌 방법).
2. ${mode === "brand" ? "브랜드 소개에 있는 제품·서비스·고객 고민과 연결한다. 브랜드 자체 실적은 소개에 있는 것만 쓴다. 주제를 받쳐 줄 시장·업계 사실이 필요하면 WebSearch·WebFetch 로 찾고 출처 URL 을 붙인다." : "자료에서 확인한 사실만 facts 에 넣고, 각 사실에 출처 URL 을 붙인다."}
3. facts 는 카드에 바로 쓸 수 있는 구체적 사실·수치·사례 3~8개. 확인 못 한 것은 넣지 않는다.
4. 제목은 실제 카드 표지에 쓸 만한 문장 (30자 안팎).
5. 답은 아래 JSON 하나만.

{ "topics": [{ "title": "", "angle": "이 주제를 어떤 관점으로 풀지 한두 문장", "fit": "왜 이 템플릿에 맞는지 한 줄", "facts": [{ "text": "", "source": "URL 또는 '브랜드 소개'" }] }], "notes": "자료를 찾으며 한계·주의할 점" }`;
  const tools = ["Read", ...(links.length ? ["WebFetch"] : []), ...(search || mode === "brand" ? ["WebSearch", "WebFetch"] : [])];
  const { text, durationMs } = await askClaude(prompt, { cwd: path.join(TEMPLATES_DIR, id), allowedTools: [...new Set(tools)] });
  const out = extractJson(text);
  return { ...out, took_s: Math.round(durationMs / 1000) };
}

const cardDir = (id, cid) => {
  if (!/^tpl_\w+$/.test(id) || !/^c_\d+$/.test(cid)) throw new Error("잘못된 ID");
  return path.join(TEMPLATES_DIR, id, "cards", cid);
};

export async function listCards(id) {
  const base = path.join(TEMPLATES_DIR, id, "cards");
  const out = [];
  for (const n of await fs.readdir(base).catch(() => [])) {
    const c = await readJson(path.join(base, n, "card.json"), null);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 모든 템플릿에서 만든 카드뉴스 (최신순, tpl_id 를 붙인다) */
export async function listAllCards() {
  const out = [];
  for (const id of (await fs.readdir(TEMPLATES_DIR).catch(() => [])).filter((n) => /^tpl_\w+$/.test(n)))
    for (const c of await listCards(id)) out.push({ ...c, tpl_id: id });
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 화면에서 고친 글 저장 */
export async function saveCard(id, cid, data) {
  const file = path.join(cardDir(id, cid), "card.json");
  const cur = await readJson(file, null);
  if (!cur) throw new Error("카드뉴스가 없습니다");
  // design: 이 카드뉴스에만 씌우는 색·글자 (템플릿 디자인 위에 덮는다)
  const next = { ...cur, slides: data.slides ?? cur.slides, caption: data.caption ?? cur.caption, title: data.title ?? cur.title, design: data.design ?? cur.design, updated_at: new Date().toISOString() };
  await writeJson(file, next);
  return next;
}

/** 화면에서 그린 PNG 한 장 저장 (data:image/png;base64,…) */
export async function saveCardPng(id, cid, n, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  if (!m || !Number.isInteger(n) || n < 1 || n > 30) throw new Error("잘못된 이미지");
  const dir = cardDir(id, cid);
  const name = `slide_${String(n).padStart(2, "0")}.png`;
  await fs.writeFile(path.join(dir, name), Buffer.from(m[1], "base64"));
  await setOutput(dir, n, name);
  return { file: name };
}

// 장마다 결과 파일은 하나 (slide_NN.png 또는 영상 장이면 slide_NN.mp4). pngs 에 장 순서대로 둔다
async function setOutput(dir, n, name) {
  const nn = String(n).padStart(2, "0");
  const file = path.join(dir, "card.json");
  const cur = await readJson(file, null);
  if (!cur) return;
  const old = (cur.pngs || []).filter((f) => f.startsWith(`slide_${nn}.`) && f !== name);
  for (const f of old) await fs.rm(path.join(dir, f), { force: true });
  cur.pngs = [...new Set([...(cur.pngs || []).filter((f) => !old.includes(f)), name])]
    .filter((f) => Number(f.match(/^slide_(\d+)\./)?.[1]) <= (cur.slides?.length || 99)).sort();
  await writeJson(file, cur);
}

const MEDIA_RE = /^(jpe?g|png|webp|gif|mp4|mov|m4v|webm)$/;
const VIDEO_RE = /^(mp4|mov|m4v|webm)$/;
/** 만든 카드뉴스의 장에 넣을 사진·영상 (올린 파일을 카드 폴더로 옮긴다) */
export async function addCardMedia(id, cid, { tmp, name }) {
  const ext = extOf(name);
  if (!MEDIA_RE.test(ext)) throw new Error(`사진·영상만 넣을 수 있습니다: ${name}`);
  const file = `m_${Date.now()}.${ext}`;
  await fs.copyFile(tmp, path.join(cardDir(id, cid), file));
  return { file, kind: VIDEO_RE.test(ext) ? "video" : "image" };
}

/** 영상 장: 화면에서 그린 글자 층(배경 투명 PNG)을 영상 위에 얹어 slide_NN.mp4 로 만든다 (최대 60초) */
export async function saveCardVideo(id, cid, { n, video, data, width = 1080, height = 1350 }) {
  const m = String(data).match(/^data:image\/png;base64,(.+)$/);
  n = Number(n);
  if (!m || !Number.isInteger(n) || n < 1 || n > 30) throw new Error("잘못된 요청");
  if (!video || path.basename(video) !== video || !VIDEO_RE.test(extOf(video))) throw new Error("잘못된 영상 파일");
  const dir = cardDir(id, cid);
  const nn = String(n).padStart(2, "0");
  const overlay = path.join(dir, `slide_${nn}_overlay.png`);
  await fs.writeFile(overlay, Buffer.from(m[1], "base64"));
  const W = Math.round(Number(width) / 2) * 2, H = Math.round(Number(height) / 2) * 2;
  const out = `slide_${nn}.mp4`;
  try {
    await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, video), "-i", overlay,
      "-filter_complex", `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg];[bg][1:v]overlay=0:0[v]`,
      "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-t", "60", "-movflags", "+faststart", path.join(dir, out)], { maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`영상 합성 실패 (ffmpeg): ${String(e.stderr || e.message).slice(0, 200)}`);
  } finally {
    await fs.rm(overlay, { force: true });
  }
  await setOutput(dir, n, out);
  return { file: out };
}

export async function deleteCard(id, cid) {
  await fs.rm(cardDir(id, cid), { recursive: true, force: true });
}

// ── 브랜드 에셋(키트): 디자인 값 + 브랜드 소개(말투·제품·금지어) + 사진. 카드뉴스를 만들 때 고르거나 템플릿에 씌운다 ──
//   <DATA_DIR>/_brand_kits.json · <DATA_DIR>/_brand_kits/<kit_id>/<사진>
const KITS_FILE = path.join(path.dirname(TEMPLATES_DIR), "_brand_kits.json");
export const KITS_DIR = path.join(path.dirname(TEMPLATES_DIR), "_brand_kits");
export const listKits = () => readJson(KITS_FILE, []);
const kitDir = (id) => { if (!/^kit_\d+$/.test(id)) throw new Error("잘못된 키트 ID"); return path.join(KITS_DIR, id); };

/** 같은 이름이 있으면 그 키트에 덮어쓴다 (넘긴 칸만 바꾸고 소개·사진은 그대로) */
// 브랜드 기본 정보 — 카드뉴스·포스터·인물 라디오 기획이 같이 쓰는 맥락 (about 은 예전 자유 글)
export const KIT_PROFILE = [["category", "업종·분야"], ["offer", "무엇을 파나요 (제품·서비스)"], ["usp", "핵심 장점·차별점"], ["target", "주 고객 (누가·무슨 고민)"],
  ["tone", "말투·톤"], ["banned", "금지어·주의 (과장·규제)"], ["proof", "확인된 실적·수치 (있는 것만)"], ["links", "홈페이지·SNS 링크"], ["competitors", "경쟁사·비교 대상"]];
export const kitBrief = (k) => !k ? "" : [`브랜드: ${k.name}`, ...KIT_PROFILE.map(([key, label]) => (k.profile?.[key] ? `${label}: ${k.profile[key]}` : "")), k.about ? `소개: ${k.about}` : ""].filter(Boolean).join("\n");
export async function saveKit({ id, name, design, about, profile }) {
  name = String(name || "").trim();
  if (!name) throw new Error("에셋 이름을 적으세요");
  const kits = await listKits();
  const i = kits.findIndex((k) => (id ? k.id === id : k.name === name));
  const cur = i >= 0 ? kits[i] : { id: `kit_${Date.now()}`, design: {}, about: "", images: [] };
  const kit = { ...cur, name, ...(design && typeof design === "object" ? { design } : {}), ...(about !== undefined ? { about: String(about) } : {}),
    ...(profile && typeof profile === "object" ? { profile: Object.fromEntries(KIT_PROFILE.map(([k]) => [k, String(profile[k] ?? cur.profile?.[k] ?? "").trim()])) } : {}), updated_at: new Date().toISOString() };
  if (i >= 0) kits[i] = kit; else kits.push(kit);
  await writeJson(KITS_FILE, kits);
  return kit;
}

export async function deleteKit(id) {
  await writeJson(KITS_FILE, (await listKits()).filter((k) => k.id !== id));
  await fs.rm(kitDir(id), { recursive: true, force: true });
}

/** 에셋 사진 추가 — files = [{ tmp, name }] */
export async function addKitImages(id, files) {
  const kits = await listKits();
  const kit = kits.find((k) => k.id === id);
  if (!kit) throw new Error("에셋이 없습니다");
  await fs.mkdir(kitDir(id), { recursive: true });
  kit.images ||= [];
  for (const [i, f] of files.entries()) {
    const ext = extOf(f.name);
    if (!/^(jpe?g|png|webp|gif)$/.test(ext)) continue;
    const name = `img_${Date.now()}_${i}.${ext}`;
    await fs.copyFile(f.tmp, path.join(kitDir(id), name));
    kit.images.push(name);
  }
  await writeJson(KITS_FILE, kits);
  return kit;
}

export async function deleteKitImage(id, file) {
  const kits = await listKits();
  const kit = kits.find((k) => k.id === id);
  if (!kit || path.basename(file) !== file) throw new Error("잘못된 요청");
  kit.images = (kit.images || []).filter((f) => f !== file);
  await fs.rm(path.join(kitDir(id), file), { force: true });
  await writeJson(KITS_FILE, kits);
  return kit;
}

// ── 자료 링크 묶음: 카드뉴스 만들 때 Claude 가 읽을 링크 모음을 이름 붙여 저장 ──
const LINKSETS_FILE = path.join(path.dirname(TEMPLATES_DIR), "_link_sets.json");
export const listLinkSets = () => readJson(LINKSETS_FILE, []);
export async function saveLinkSet({ name, urls }) {
  name = String(name || "").trim();
  urls = (Array.isArray(urls) ? urls : String(urls || "").split("\n")).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
  if (!name) throw new Error("묶음 이름을 적으세요");
  if (!urls.length) throw new Error("http 로 시작하는 링크를 한 줄에 하나씩 적으세요");
  const sets = await listLinkSets();
  const i = sets.findIndex((x) => x.name === name);
  const set = { id: i >= 0 ? sets[i].id : `ls_${Date.now()}`, name, urls, updated_at: new Date().toISOString() };
  if (i >= 0) sets[i] = set; else sets.push(set);
  await writeJson(LINKSETS_FILE, sets);
  return set;
}
export async function deleteLinkSet(id) {
  await writeJson(LINKSETS_FILE, (await listLinkSets()).filter((x) => x.id !== id));
}

// ── AI로 고치기: 말로 한 지시대로 템플릿(디자인·장 구성·블록)을 고친 안을 만든다. 저장은 화면에서 ──
function buildEditPrompt(cur, instruction) {
  const slides = (cur.slides || []).map(({ ref, _k, ...s }, i) => ({ ...s, n: i + 1 }));
  return `너는 카드뉴스 아트디렉터다. 아래 카드뉴스 템플릿을 사용자 지시대로 고친다.
템플릿은 "주제만 바꾸면 같은 구조로 다시 쓰는 틀"이다. blocks 의 글은 예시 글이고, Claude 가 나중에 이 구성·글자 수·말투를 따라 새 글을 쓴다.

[사용자 지시]
${instruction}

[현재 템플릿]
- 이름: ${cur.name || ""}
- design: ${JSON.stringify(cur.design || {})}
- flow: ${JSON.stringify(cur.flow || [])}
- copy_patterns: ${JSON.stringify(cur.copy_patterns || [])}
- slides: ${JSON.stringify(slides)}

[쓸 수 있는 것 — 이 밖의 것은 화면이 그리지 못한다]
- 블록 종류: ${BLOCKS}
- 장 layout: cover(사진 배경 표지) | content(밝은 바탕) | quote(어두운 바탕 인용) | cta(강조색 바탕 마무리)
- 장 image: none | full | inset
- 정렬: 장의 align(왼쪽|가운데|오른쪽)·valign(위|가운데|아래), 블록의 align(왼쪽|가운데|오른쪽). 지정 안 하면 빼 둔다.
- design 키: bg, text, muted, accent, accent_text, dark_bg, dark_text (hex), label, handle, next_button, cta_button, title_size(크게|아주 크게), align(왼쪽|가운데|오른쪽), valign(위|가운데|아래)

[규칙]
1. 지시한 것만 고친다. 지시와 상관없는 장·블록·디자인 값은 그대로 둔다.
2. 장마다 from 에 원래 장 번호(n)를 적는다. 새로 만든 장은 from: null. 장을 복제했으면 원래 번호를 적는다.
3. 장 번호 n 은 1부터 다시 매기고, flow 의 slides 도 새 번호로 고친다.
4. 블록마다 max_chars 를 붙인다. 새 블록의 예시 글은 템플릿 말투에 맞춘다. 계정명·라벨은 {{design.label}} 같은 자리표시를 그대로 쓴다.
5. changes: 무엇을 고쳤는지 한국어 한 줄씩.
6. 답은 아래 JSON 하나만. 설명 문장 금지.

{ "design": {}, "slides": [{ "from": 1, "n": 1, "role": "", "layout": "", "image": "", "purpose": "", "blocks": [] }], "flow": [], "copy_patterns": [], "changes": [""] }`;
}

/** cur = 화면에서 편집 중인 템플릿 (저장 전 상태). 없으면 저장된 것 */
export async function aiEditTemplate(id, { instruction, template }) {
  const t = await getTemplate(id);
  if (!t || t.kind !== "cardnews") throw new Error("카드뉴스 템플릿이 아닙니다");
  if (!String(instruction || "").trim()) throw new Error("무엇을 고칠지 적으세요");
  const cur = template?.slides ? template : t;
  const { text, durationMs } = await askClaude(buildEditPrompt(cur, instruction.trim()), { cwd: path.join(TEMPLATES_DIR, id) });
  const out = extractJson(text);
  if (!Array.isArray(out.slides) || !out.slides.length) throw new Error("Claude 가 고친 안을 만들지 못했습니다");
  return { ...out, took_s: Math.round(durationMs / 1000) };
}

/** 링크(홈페이지·스토어·SNS)를 Claude 가 열어 읽고 브랜드 기본 정보 칸을 채운 안 (저장하지 않는다 — 화면에서 고쳐 저장) */
export async function autofillKit({ url = "", name = "", note = "" } = {}) {
  if (!/^https?:\/\//.test(String(url).trim()) && !String(note).trim()) throw new Error("홈페이지 주소(https://…)나 소개 글을 넣으세요");
  const { text } = await askClaude(`브랜드 기본 정보를 정리한다. 사람에게 묻지 말 것.
${url ? `[링크] ${url} — WebFetch 로 열어 읽는다 (회사 소개·제품·가격·고객 후기 페이지가 링크돼 있으면 2~3개 더 연다).` : ""}${note ? `\n[받은 소개] ${note}` : ""}${name ? `\n[브랜드 이름] ${name}` : ""}
규칙: 읽은 곳에서 확인한 것만 쓴다. 확인 못 한 칸은 비운다. 실적·수치(proof)는 페이지에 적힌 그대로, 출처 페이지를 괄호로 붙인다. 짧게 (칸마다 1~2문장).
답은 JSON 하나만: { "name": "", ${KIT_PROFILE.map(([k, l]) => `"${k}": "${l}"`).join(", ")}, "sources": ["읽은 URL"] }`, { allowedTools: ["WebFetch"], timeoutMs: 4 * 60_000 });
  return extractJson(text);
}
