// 드라마 스튜디오: AI 숏드라마 한 편을 단계별로 만든다 (참고: 실제 제작 흐름 — 기획 → 디벨롭 → 샷리스트·소재 → 시트 → 장면 이미지 → 영상(힉스필드) → 편집)
//   <DATA_DIR>/_dramas/<d_ID>/project.json · media/ (시트·장면 이미지·영상·목소리 레퍼런스)
// Claude 는 글(아이디어·대본·샷리스트·시트/장면/영상 프롬프트)만 쓰고, 이미지·영상은 힉스필드에서 만들어 다시 올린다.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { askClaude, extractJson } from "./claude.js";
import { DATA_DIR, readJson, writeJson } from "./store.js";
import { getTemplate, TEMPLATES_DIR } from "./template.js";
import { listKits, kitBrief } from "./cardnews.js";
import { extOf, analyzeUrl, analyzeUpload } from "./manual.js";

export const DRAMAS_DIR = path.join(DATA_DIR, "_dramas");
export const STEPS = ["기획", "디벨롭", "샷리스트·소재", "시트", "장면 이미지", "영상", "편집"];
const dDir = (id) => { if (!/^d_\d+$/.test(id)) throw new Error("잘못된 드라마 ID"); return path.join(DRAMAS_DIR, id); };
export const getDrama = (id) => readJson(path.join(dDir(id), "project.json"), null);
async function saveDrama(p) { p.updated_at = new Date().toISOString(); await writeJson(path.join(dDir(p.id), "project.json"), p); return p; }
// 같은 드라마에 작업이 여럿 같이 돌 수 있다 (Claude 단계 + 힉스필드 칸 여러 개). 파일을 고칠 때는 잠금 안에서
// 최신 파일을 다시 읽고 바꿀 값만 얹어 쓴다 — 몇 분 전에 읽은 사본을 통째로 쓰면 그사이 들어온 이미지가 사라진다
const locks = new Map();
function withLock(id, fn) {
  const run = (locks.get(id) || Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}
const patchDrama = (id, mutate) => withLock(id, async () => {
  const p = await getDrama(id);
  if (!p) throw new Error("드라마가 없습니다");
  await mutate(p);
  return saveDrama(p);
});

// kind: "drama"(숏드라마) | "ad"(제품 광고영상) — 같은 단계·화면을 쓰고 Claude 에게 주는 지시만 다르다
export async function listDramas(kind = "drama") {
  const out = [];
  for (const n of (await fs.readdir(DRAMAS_DIR).catch(() => [])).filter((x) => /^d_\d+$/.test(x))) {
    const p = await getDrama(n);
    if (p && (p.kind || "drama") === kind) out.push({ id: p.id, kind, title: p.title, step: p.step, created_at: p.created_at, updated_at: p.updated_at, length: p.inputs?.length, cover: p.cover || null });
  }
  return out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

export async function createDrama(inputs = {}, kind = "drama") {
  const id = `d_${Date.now()}`;
  await fs.mkdir(path.join(DRAMAS_DIR, id, "media"), { recursive: true });
  const p = { id, kind, title: inputs.title || (kind === "ad" ? "새 광고영상" : "새 드라마"), step: 0, inputs, ideas: [], idea: null, develop: null, shots: [], assets: { characters: [], locations: [], props: [] }, media: { assets: {}, shots: {} }, created_at: new Date().toISOString() };
  return saveDrama(p);
}

/** 화면에서 직접 고친 값 저장 (inputs·idea·develop·shots·assets·step·title 만) */
export async function updateDrama(id, data) {
  return patchDrama(id, (p) => { for (const k of ["title", "step", "inputs", "idea", "develop", "shots", "assets", "edit"]) if (data[k] !== undefined) p[k] = data[k]; });
}

export async function deleteDrama(id) { await fs.rm(dDir(id), { recursive: true, force: true }); }

// ── 공통 맥락 ──
const isAd = (p) => p.kind === "ad";
// 제품 광고: 올린 실제 제품 사진 (Claude 가 Read 로 본다)
const productPhotos = (p) => Object.entries(p.media?.assets?.PRODUCT || {}).filter(([k]) => k.startsWith("sheet_")).map(([, f]) => f);
// 레퍼런스 영상 — 템플릿에서 고른 수집 영상(영상·드라마 템플릿). 구조와 컨택트시트(프레임 모음)를 Claude 에게 보여 준다
async function refBlock(p) {
  const rv = p.inputs?.ref_video;
  if (rv?.dir) { // 직접 올리거나 링크로 넣은 참고 영상 — 기계 분석(컷·화면 글자·음성)과 컷 프레임 모음
    const v = (await readJson(path.join(dDir(p.id), rv.dir, "analysis.json"), {})).videos?.[0];
    if (v) return `[참고 영상 — 사용자가 올린 영상 "${rv.name}". 리듬·컷 길이·구도·후킹 방식·전개 구조를 따른다. 소재·인물·대사는 베끼지 않는다]
${JSON.stringify({ duration_s: v.spec?.duration_s, aspect: v.spec?.aspect, cuts: v.cuts?.count, shots: (v.shots || []).slice(0, 40).map((x) => ({ shot: x.shot, start: x.start, dur: x.dur, onscreen_text: x.onscreen_text || "", speech: x.speech || "" })) })}
${v.contact_sheet ? `[참고 영상 프레임 모음 — Read 로 직접 본다] ${rv.dir}/${v.contact_sheet}\n` : ""}`;
  }
  const id = p.inputs?.ref_tpl_id; if (!id) return "";
  const r = await getTemplate(id).catch(() => null); if (!r) return "";
  let sheet = "";
  const src = path.join(TEMPLATES_DIR, id, "contact_sheet.jpg");
  if (await fs.access(src).then(() => true, () => false)) { sheet = "ref_contact_sheet.jpg"; await fs.copyFile(src, path.join(dDir(p.id), sheet)); }
  const body = r.kind === "drama"
    ? { name: r.name, logline_pattern: r.logline_pattern, beats: (r.beats || []).map(({ beat, what, dialogue_pattern }) => ({ beat, what, dialogue_pattern })), running_gag: r.running_gag, twist: r.twist }
    : { name: r.name, structure: r.structure, slots: (r.slots || []).map(({ section, role, dur, shot_type }) => ({ section, role, dur, shot_type })), copy_patterns: r.copy_patterns };
  return `[레퍼런스 영상 — 사용자가 고른 수집 영상. 리듬·컷 길이·구도·후킹 방식·전개 구조를 따른다. 소재·인물·대사는 베끼지 않는다]
${JSON.stringify(body)}
${sheet ? `[레퍼런스 영상 프레임 모음 — Read 로 직접 본다] ${sheet}
` : ""}`;
}
const briefBlock = (p) => (p.inputs?.brief?.trim() ? `[사용자가 자연어로 적은 요청 — 가장 우선한다]
${p.inputs.brief.trim()}
` : "");

async function context(p) {
  return (await baseContext(p)) + briefBlock(p) + (await refBlock(p));
}
async function baseContext(p) {
  const t = p.inputs?.tpl_id ? await getTemplate(p.inputs.tpl_id).catch(() => null) : null;
  const kit = p.inputs?.kit_id ? (await listKits()).find((k) => k.id === p.inputs.kit_id) : null;
  const i = p.inputs || {};
  if (isAd(p)) {
    const photos = productPhotos(p);
    return `[만들 것] 제품 광고 영상 · 길이 ${i.length || 30}초 · 화면 ${i.aspect || "9:16"}${i.platform ? ` · 올릴 곳 ${i.platform}` : ""}
[제품] ${i.product || "(이름 없음)"}${i.product_desc ? ` — ${i.product_desc}` : ""}
${i.usp ? `[핵심 장점] ${i.usp}
` : ""}${i.offer ? `[가격·혜택] ${i.offer}
` : ""}${i.target ? `[타깃] ${i.target}
` : ""}${i.formats?.length ? `[원하는 광고 형식] ${i.formats.join(", ")}
` : ""}${i.keyword ? `[방향·요청] ${i.keyword}
` : ""}${kit ? `[브랜드] ${kitBrief(kit).replace(/\n/g, " · ")}
` : ""}${photos.length ? `[실제 제품 사진 — Read 로 직접 보고 형태·색·라벨·재질을 정확히 파악한다] ${photos.join(", ")}
` : "[제품 사진 없음 — 제품 생김새는 설명으로만 추정하고, 추정이라고 notes 에 적는다]\n"}${t ? `[참고 광고 구조 — 수집한 광고에서 뽑은 영상 템플릿. 구간·컷 역할을 참고한다]
${JSON.stringify({ name: t.name, structure: t.structure, slots: (t.slots || []).map(({ section, role, dur, shot_type }) => ({ section, role, dur, shot_type })), copy_patterns: t.copy_patterns })}
` : ""}[지킬 것] 효능·수치·가격·순위는 위에 적힌 것만 쓴다. 의료·과장 표현("완치", "100%", "최고")은 쓰지 않는다.
`;
  }
  return `[만들 것] AI 숏드라마 · 길이 ${i.length || 60}초 · 화면 ${i.aspect || "9:16"}
${i.product ? `[광고할 제품·서비스] ${i.product} — 이야기 안에 자연스럽게 들어가야 한다 (억지 광고 금지, 확인 안 된 효능·수치 금지)\n` : ""}${i.genres?.length ? `[섞을 장르·재료] ${i.genres.join(", ")}\n` : ""}${i.keyword ? `[키워드·방향] ${i.keyword}\n` : ""}${kit ? `[브랜드] ${kitBrief(kit).replace(/\n/g, " · ")}\n` : ""}${t ? `[참고 이야기 구조 — 수집한 릴스에서 뽑은 틀. 비트·반복·반전 방식을 참고한다]
${JSON.stringify({ name: t.name, logline_pattern: t.logline_pattern, beats: (t.beats || []).map(({ beat, what, dialogue_pattern }) => ({ beat, what, dialogue_pattern })), running_gag: t.running_gag, twist: t.twist })}\n` : ""}`;
}

// ── 1. 기획: 아이디어 여러 개 ──
export async function draftIdeas(id, emit = () => {}) {
  const p = await getDrama(id);
  emit({ message: isAd(p) ? "Claude 가 광고 콘셉트를 내는 중 (1분 안팎)" : "Claude 가 숏드라마 아이디어를 내는 중 (1분 안팎)" });
  const { text, durationMs } = await askClaude(isAd(p) ? `너는 퍼포먼스 광고 크리에이티브 디렉터다. 아래 제품으로 숏폼 광고 영상 콘셉트 8개를 낸다.
${await context(p)}
[좋은 콘셉트의 조건]
- 첫 3초 훅이 분명하다: 결과·문제 상황·의외의 장면·질문 중 하나로 스크롤을 멈춘다
- 소구점 하나에 집중한다 (장점을 다 말하지 않는다)
- 형식이 서로 다르다: UGC 후기, 문제→해결, 비포·애프터, 제품 시연, 언박싱, 가격·혜택, 비교, 상황극, 감성 브랜딩 등
- AI 영상으로 만들기 쉽다 (인물 0~2명, 장소 1~2곳, 제품 컷이 분명)

답은 JSON 하나만:
{ "ideas": [{ "title": "콘셉트 이름", "logline": "한두 문장 — 무엇을 보여 주고 무엇을 말하는지", "hook": "첫 3초에 보여 줄 장면·한마디", "twist": "소구점 (왜 사야 하는지 한 가지)", "link": "광고 형식", "cast": "등장인물·화자 구성", "why": "왜 이 타깃에게 먹히는지" }] }` : `너는 숏폼 드라마 기획자다. 아래 조건으로 AI 숏드라마 아이디어 10개를 낸다.
${await context(p)}
[좋은 아이디어의 조건]
- 익숙한 상황에 이상한 변수 하나 (예: 전래동화 악당들이 기자회견을 한다, 복수하려던 대공이 강아지로 빙의했다)
- 제목 한 줄만 봐도 상황이 이해되고, 처음 5초 안에 무슨 이야기인지 알 수 있다
- 복잡한 세계관·설명이 필요 없다. 웃기거나 궁금해서 끝까지 보게 된다
- 장르를 섞으면 재료들이 만나는 접점을 딱 하나 정한다 (예: 등불이 현대와 조선을 잇는다)
- AI 영상으로 만들기 쉬운 것 (인물 2~4명, 장소 1~3곳)

답은 JSON 하나만:
{ "ideas": [{ "title": "제목 한 줄", "logline": "한두 문장", "hook": "첫 5초에 보여 줄 것", "twist": "이상한 변수·반전", "link": "장르 접점 (없으면 빈 문자열)", "cast": "등장인물 수와 구성", "why": "왜 끝까지 보게 되는지" }] }`, { cwd: dDir(id) });
  const ideas = extractJson(text).ideas || [];
  await patchDrama(id, (q) => { q.ideas = ideas; q.step = Math.max(q.step, 0); });
  emit({ message: `${isAd(p) ? "콘셉트" : "아이디어"} ${ideas.length}개 (${Math.round(durationMs / 1000)}초)` });
  return { id, step: 0 };
}

// ── 참고 영상 올리기·링크 — 릴스 폴더 안 ref/ 에 받아 기계 분석까지 한다 (광고 수집 목록에는 쌓이지 않는다) ──
export async function setReference(id, { url = "", upload = null } = {}, emit = () => {}) {
  if (!url && !upload) throw new Error("영상 파일이나 링크를 넣으세요");
  const root = path.join(dDir(id), "ref");
  await fs.mkdir(root, { recursive: true });
  emit({ message: "참고 영상 받고 분석하는 중 (컷·화면 글자·음성, 1~2분)" });
  const r = url ? await analyzeUrl(url, { root, whisper: true, ocr: true }, emit) : await analyzeUpload(upload.file, upload.name, { root, whisper: true, ocr: true }, emit);
  const src = r.saved?.[0];
  if (!src?.startsWith("vd_")) throw new Error("영상이 아닙니다 — 영상 링크나 mp4·mov·webm 파일을 넣으세요");
  const ad = await readJson(path.join(root, src, "ad.json"), {});
  await patchDrama(id, (q) => { q.inputs = { ...(q.inputs || {}), ref_tpl_id: "", ref_video: { dir: `ref/${src}`, video: `ref/${src}/${ad.files?.video || "vd_video.mp4"}`, poster: ad.files?.poster ? `ref/${src}/${ad.files.poster}` : "", name: url || upload.name, at: new Date().toISOString() } }; });
  emit({ message: "참고 영상을 넣었습니다" });
  return { id, step: 0, ref: true };
}

// ── 한 번에: 자연어 요청·레퍼런스 영상 → 아이디어 1개 → 디벨롭 → 샷리스트·소재(시트 프롬프트)까지. 시트 단계 앞에서 멈춘다 ──
export async function autoPlan(id, _opts = {}, emit = () => {}) {
  let p = await getDrama(id);
  const hasRef = p.inputs?.ref_tpl_id || p.inputs?.ref_video?.dir;
  if (!p.inputs?.brief?.trim() && !hasRef && !p.idea) throw new Error("자연어 요청을 적거나 참고 영상을 넣으세요");
  if (!p.inputs?.brief?.trim() && !hasRef && p.idea) emit({ message: "고른 아이디어로 이어서 구성합니다" });
  else {
    emit({ message: "1/3 기획 — Claude 가 요청과 레퍼런스로 아이디어 하나를 잡는 중 (1분 안팎)" });
    const { text } = await askClaude(`너는 ${isAd(p) ? "퍼포먼스 광고 크리에이티브 디렉터" : "숏폼 드라마 기획자"}다. 아래 요청을 그대로 살린 ${isAd(p) ? "광고 콘셉트" : "숏폼 릴스 아이디어"} 하나를 잡는다.
${await context(p)}
[규칙]
- 자연어 요청에 적힌 상황·인물·분위기·결말·제품을 빠짐없이 반영한다. 적히지 않은 것만 채운다.
- 레퍼런스 영상이 있으면 그 전개 구조·리듬을 따른다.
- AI 영상으로 만들기 쉽게 (인물 0~4명, 장소 1~3곳). 처음 ${isAd(p) ? 3 : 5}초에 무슨 이야기인지 보이게.
답은 JSON 하나만: { "idea": { "title": "제목 한 줄", "logline": "한두 문장", "hook": "첫 장면", "twist": "${isAd(p) ? "소구점" : "이상한 변수·반전"}", "link": "", "cast": "등장인물 구성", "why": "왜 끝까지 보게 되는지" } }`, { cwd: dDir(id) });
    const idea = { ...(extractJson(text).idea || {}), auto: true };
    if (!idea.title) throw new Error("아이디어를 잡지 못했습니다 — 요청을 조금 더 구체적으로 적어 보세요");
    await patchDrama(id, (q) => { q.idea = idea; q.ideas = [idea, ...(q.ideas || []).filter((x) => x.title !== idea.title)]; q.step = Math.max(q.step, 0); });
  }
  emit({ message: "2/3 디벨롭 — 줄거리·인물·목소리" });
  await developStory(id, {}, emit);
  emit({ message: "3/3 샷리스트·소재·시트 프롬프트" });
  await makeShotlist(id, {}, emit);
  emit({ message: "시트 제작 직전까지 구성했습니다 — 샷리스트를 확인하고 시트 단계로 넘어가세요" });
  return { id, step: 2, auto: true };
}

// ── 2. 디벨롭: 고른 아이디어 → 줄거리 + 고를 질문(캐릭터·목소리·연출) ──
export async function developStory(id, { answers = [], note = "" } = {}, emit = () => {}) {
  const p = await getDrama(id);
  if (!p.idea) throw new Error("먼저 아이디어를 고르세요");
  emit({ message: answers.length ? "Claude 가 고른 답을 반영해 줄거리를 다시 쓰는 중" : "Claude 가 줄거리를 디벨롭하는 중 (1~2분)" });
  const prev = p.develop;
  const { text, durationMs } = await askClaude(isAd(p) ? `너는 숏폼 광고 카피라이터 겸 디렉터다. 고른 콘셉트를 ${p.inputs?.length || 30}초 광고 한 편의 카피·전략으로 디벨롭한다.
${await context(p)}
[고른 콘셉트] ${JSON.stringify(p.idea)}
${prev ? `[지금까지의 안] ${JSON.stringify({ synopsis: prev.synopsis, characters: prev.characters, direction: prev.direction, target: prev.target, pain: prev.pain, usp: prev.usp, offer: prev.offer, cta: prev.cta })}` : ""}
${answers.length ? `[사용자가 고른 답 — 반드시 반영]\n${answers.map((a) => `- ${a.q}: ${a.a}`).join("\n")}` : ""}
${note ? `[추가 요청] ${note}` : ""}

[규칙]
1. 메시지는 하나. 첫 3초 훅 → 문제·상황 → 제품 등장 → 증거(시연·후기·비교) → 혜택 → CTA 흐름으로 ${p.inputs?.length || 30}초에 맞춘다.
2. 효능·수치·가격은 입력에 있는 것만. 없으면 빈칸([혜택])으로 두고 notes 에 적는다.
3. 모델·화자가 있으면 생김새를 "캐릭터 고정 문장"(영어 한 문장)으로 정하고 목소리를 정한다. 제품만 나오는 광고면 내레이터 목소리만.
4. direction: 색감·조명·음악·편집 템포 (예: 첫 3초 빠른 컷 → 제품 등장 순간 정적 → 혜택에서 밝은 톤).
5. questions: 결과를 크게 바꾸는 선택 3~6개를 보기 3~4개와 함께 묻는다 (모델 유무·나이대, 말투, 훅 방식, 혜택 강조 방식, CTA 문구 등). 이미 답한 것은 다시 묻지 않는다.
6. 답은 JSON 하나만:
{
  "title": "", "logline": "한 줄 메시지", "synopsis": "광고 흐름 300자 안팎 (장면 순서대로)",
  "target": "", "pain": "타깃의 문제·상황", "usp": ["소구점"], "offer": "혜택 문구 (입력 기준)", "cta": "행동 유도 문구",
  "characters": [{ "id": "A", "name": "모델·화자 이름", "role": "", "desc": "", "fixed_en": "", "looks": [], "voice": "" }],
  "direction": "", "ending": "엔드카드 구성",
  "questions": [{ "q": "", "options": ["", "", ""] }],
  "notes": ""
}` : `너는 숏폼 드라마 작가다. 고른 아이디어를 ${p.inputs?.length || 60}초 분량 한 편으로 디벨롭한다.
${await context(p)}
[고른 아이디어] ${JSON.stringify(p.idea)}
${prev ? `[지금까지의 줄거리] ${JSON.stringify({ synopsis: prev.synopsis, characters: prev.characters, direction: prev.direction })}` : ""}
${answers.length ? `[사용자가 고른 답 — 반드시 반영]\n${answers.map((a) => `- ${a.q}: ${a.a}`).join("\n")}` : ""}
${note ? `[추가 요청] ${note}` : ""}

[규칙]
1. 분량을 지킨다. ${p.inputs?.length || 60}초에 담기지 않는 사건은 빼고, 처음 5초에 상황이 보이게 한다.
2. 등장인물마다 생김새를 "캐릭터 고정 문장"(영어 한 문장)으로 정한다 — 모든 장면 프롬프트에 그대로 붙여 얼굴이 바뀌지 않게 하는 신분증. 시대·장면에 따라 옷이 바뀌면 looks 를 따로 둔다.
3. 목소리를 인물마다 정한다 (속마음 목소리가 따로 있으면 그것도).
4. direction: 색감·음악이 언제 어떻게 바뀌는지 (예: 앞은 차갑고 무거운 음악 → 반전 순간 음악이 뚝 끊김 → 끝은 따뜻한 주황빛).
5. questions: 아직 정하지 않은 것 중 결과를 크게 바꾸는 것 3~6개를 보기 3~4개와 함께 묻는다 (캐릭터 생김새 포인트, 표정, 목소리, 결말 세기, 톤 등). 이미 답한 것은 다시 묻지 않는다.
6. 답은 JSON 하나만:
{
  "title": "", "logline": "", "synopsis": "300~500자 줄거리",
  "characters": [{ "id": "A", "name": "", "role": "", "desc": "한국어 설정", "fixed_en": "캐릭터 고정 문장 (영어)", "looks": [{ "when": "현대 / 조선 등", "outfit_en": "" }], "voice": "목소리 설정 (성별·나이·톤·말투)" }],
  "direction": "", "ending": "",
  "questions": [{ "q": "", "options": ["", "", ""] }]
}`, { cwd: dDir(id) });
  const out = extractJson(text);
  const develop = { ...out, answers: [...(prev?.answers || []), ...answers], took_s: Math.round(durationMs / 1000) };
  await patchDrama(id, (q) => { q.develop = develop; if (out.title) q.title = out.title; q.step = Math.max(q.step, 1); });
  emit({ message: `${isAd(p) ? "카피·전략" : "줄거리"} 완성 (${develop.took_s}초)` });
  return { id, step: 1 };
}

// 카메라 무빙 이름 — https://aicameramovements.com/ 의 46가지 (영상 툴에서 알아듣는 이름으로 통일)
export const CAMERA_MOVES = {
  "Pan/Tilt": ["Static shot", "Pan right", "Pan left", "Whip pan right", "Whip pan left", "Tilt up", "Tilt down"],
  "Zoom/Lens": ["Slow zoom in", "Slow zoom out", "Fast zoom in", "Fast zoom out", "Crash zoom in", "Crash zoom out"],
  "Dolly/Track": ["Dolly in", "Dolly out", "Tracking shot", "Follow shot (over-the-shoulder)", "Reverse tracking (walk-and-talk)", "Side tracking", "Low tracking", "Vehicle tracking", "Chase shot"],
  "Physical": ["Truck right", "Truck left", "Pedestal up", "Pedestal down", "Slider right", "Slider left", "Push past (pass-by)", "Arc right", "Arc left", "Orbit clockwise", "Orbit counterclockwise"],
  "Drone/Crane": ["Crane up", "Crane down", "Drone push in", "Drone pull back", "Helicopter shot"],
  "Human camera": ["Handheld shot", "Body-mounted camera (Snorricam)"],
  "Special": ["First-person view", "Tilt-shift", "Infinite zoom", "Earth zoom out", "Time-lapse", "Pass-through objects"],
};
const CAMERA_LIST = Object.values(CAMERA_MOVES).flat().join(", ");

// ── 3. 샷리스트 + 소재 리스트(인물 A·장소 1·소품 a) + 시트 프롬프트 ──
const SHEET_RULES = `[시트 프롬프트 양식 — 영어, 글자·워터마크 없음]
- 캐릭터 시트: 깨끗한 밝은 회색 배경, 위 줄은 정면·측면·뒷면·전신, 아래 줄은 표정 4가지(무표정·웃음·놀람·화남 등 인물에 맞게). 고정 문장의 생김새·의상을 그대로. 옷이 바뀌는 시대·장면마다 시트를 따로.
- 장소 시트: 화면 비율 9:16 세로, 사람 없이 장소의 구조(입구·창·가구 배치)가 보이는 넓은 샷, 조명·색감 명시.
- 소품 시트: 중간 회색 무지 배경, 평평한 스튜디오 조명, 제품 사진처럼 — 왼쪽 정면, 가운데 뒷면, 오른쪽 디테일 클로즈업.`;
export async function makeShotlist(id, { hardcut = true, emotionLong = true, slack = true, note = "" } = {}, emit = () => {}) {
  const p = await getDrama(id);
  if (!p.develop) throw new Error("먼저 줄거리를 디벨롭하세요");
  const L = p.inputs?.length || 60;
  emit({ message: `Claude 가 ${L}초 ${isAd(p) ? "광고 콘티" : "샷리스트"}와 소재·시트 프롬프트를 쓰는 중 (2~4분)` });
  const adRules = isAd(p) ? `
[광고 규칙 — 꼭 지킨다]
- 구성: 첫 3초 훅 → 문제·상황 → 제품 등장 → 증거(시연·사용 장면·후기·비교) → 혜택 → CTA 엔드카드. ${L}초에 맞춘다.
- 제품은 소품 P0, element_id "product" 로 고정한다. 실제 제품 사진이 있으면 그 형태·색·라벨·재질을 그대로 따르고 바꾸지 않는다 (sheet_prompt_en 은 "올린 제품 사진을 참고 이미지로 쓰고, 부족한 각도만 패키지샷 시트로 만든다"는 프롬프트).
- 제품 컷은 패키지샷·사용 클로즈업·손에 든 샷 등 제품이 분명히 보이게, 최소 3컷 이상.
- 컷마다 caption: 화면에 얹을 짧은 자막·카피 (15자 안팎, 한국어). 이미지·영상 프롬프트에는 글자를 넣지 않고, 자막은 편집에서 얹는다.
- 마지막 컷은 제품 + 혜택 + CTA 엔드카드 구도 (글자가 들어갈 빈 공간을 남긴다).
- 효능·수치·가격은 입력에 있는 것만.
[카피·전략] ${JSON.stringify({ target: p.develop.target, pain: p.develop.pain, usp: p.develop.usp, offer: p.develop.offer, cta: p.develop.cta })}` : "";
  const { text, durationMs } = await askClaude(`너는 ${isAd(p) ? "숏폼 광고 연출·촬영감독" : "AI 숏드라마 연출·촬영감독"}이다. 아래 줄거리로 샷리스트(콘티)를 짜고, 영상 생성에 필요한 소재(인물·장소·소품)와 시트 프롬프트를 모두 만든다.
${await context(p)}
[${isAd(p) ? "광고 흐름" : "줄거리"}] ${JSON.stringify({ title: p.develop.title, synopsis: p.develop.synopsis, characters: p.develop.characters, direction: p.develop.direction, ending: p.develop.ending })}
${adRules}

[샷리스트 규칙]
- 전체 ${L}초. ${hardcut ? "감정 장면을 뺀 모든 컷은 2~3초마다 바뀌는 하드컷, 컷마다 다른 앵글(멀티앵글)." : "컷 길이는 장면에 맞게."} ${emotionLong ? "고백·눈물·반전의 정적 같은 감정 장면은 길게(4~8초) 둔다." : ""}
- ${slack ? "대사가 있는 컷은 대사 길이보다 2초 여유를 둔다 (1초에 4~5음절). 대사가 길면 컷을 둘로 나눈다." : ""}
- 컷마다 앵글·인물 배치·대사가 한 줄로 검수되게 쓴다.
- camera 는 다음 무빙 이름 중 하나를 그대로 쓴다 (영상 툴이 알아듣는 표준 이름): ${CAMERA_LIST}. 2~3초 하드컷은 대부분 Static shot·Slow zoom·Dolly in 처럼 짧고 단순한 무빙 (Tracking·Pan 처럼 새 공간이 드러나는 무빙은 배경이 깨지기 쉬워 피한다), 감정·반전 컷에서만 Arc·Crane·Crash zoom 같은 큰 무빙을 쓴다. video_prompt_en 에도 같은 무빙 이름을 문장 앞쪽에 넣는다.
- 인물은 A·B, 장소는 L1·L2, 소품은 P1·P2 처럼 id 로 가리킨다. 각 소재의 element_id 는 힉스필드에서 @로 부를 짧은 영어 소문자 (예: dog, duke, castle, poison).
- image_prompt_en: 이 컷의 첫 프레임 이미지 프롬프트. 등장 소재를 @element_id 로 부르고, 인물마다 캐릭터 고정 문장을 그대로 붙인다. 구도·조명·색감·비율. 글자 없음.
- video_prompt_en: 위 이미지를 시작 프레임으로 움직이는 이미지→영상 프롬프트. 영상 모델은 @element_id 를 모르므로 @ 를 쓰지 않고, 인물은 생김새 짧은 묘사(예: "the man with round glasses and a navy cardigan")로 가리킨다.
  · 첫 문장은 "Photorealistic live-action footage, continuing exactly from the start image. Keep the same background, layout, lighting and color grade for the whole clip; the background stays fixed and does not change, morph or warp." 를 그대로 쓴다.
  · 동작은 컷 길이 안에서 끝나는 작은 동작. 인물이 화면 밖으로 크게 이동하거나 카메라가 새 공간을 비추게 하지 않는다 (배경이 새로 지어지며 깨진다).
  · 대사는 따옴표 안 한국어 원문 + "in Korean, in a <나이·성별·톤> voice" 로 말하는 사람과 목소리를 적는다. 효과음·실내 소리만 적고 음악은 "no background music" (음악은 편집에서 깐다).
  · 끝 문장: "No new people appearing, no scene change, no cuts, no on-screen text or subtitles."
${note ? `- 추가 요청: ${note}` : ""}

${SHEET_RULES}

답은 JSON 하나만:
{
  "shots": [{ "n": 1, "scene": "장면 이름", "start": 0, "dur": 2.5, "emotion": false,
    "angle": "샷 크기·앵글 (예: 하이앵글 와이드)", "camera": "무빙 이름 (목록 중 하나)", "cast": ["A"], "location": "L1", "props": ["P1"],
    "action": "화면에서 일어나는 일 (한국어)", "dialogue": [{ "who": "A", "line": "", "inner": false }], "caption": "${isAd(p) ? "화면 자막·카피" : "(없으면 빈 문자열)"}", "sfx": "", "music": "",
    "image_prompt_en": "", "video_prompt_en": "" }],
  "characters": [{ "id": "A", "name": "", "element_id": "", "fixed_en": "", "voice": "", "sheets": [{ "label": "기본 / 조선 의상 등", "prompt_en": "" }] }],
  "locations": [{ "id": "L1", "name": "", "element_id": "", "desc": "", "sheet_prompt_en": "" }],
  "props": [{ "id": "P1", "name": "", "element_id": "", "desc": "", "sheet_prompt_en": "" }],
  "notes": "검수할 때 볼 점"
}`, { cwd: dDir(id) });
  const out = extractJson(text);
  // 다시 짜도 이미 올린 시트·장면 파일은 같은 id 면 남긴다
  const shots = out.shots || [], assets = { characters: out.characters || [], locations: out.locations || [], props: out.props || [] };
  await patchDrama(id, (q) => { q.shots = shots; q.assets = assets; q.shot_notes = out.notes || ""; q.shot_opts = { hardcut, emotionLong, slack }; q.step = Math.max(q.step, 2); });
  emit({ message: `샷 ${shots.length}개 · 인물 ${assets.characters.length} · 장소 ${assets.locations.length} · 소품 ${assets.props.length} (${Math.round(durationMs / 1000)}초)` });
  return { id, step: 2 };
}

/** 한 컷만 고치기 — 다른 컷은 절대 건드리지 않는다 */
export async function fixShot(id, { n, request }, emit = () => {}) {
  const p = await getDrama(id);
  const i = p.shots.findIndex((s) => s.n === Number(n));
  if (i < 0) throw new Error("컷이 없습니다");
  emit({ message: `Claude 가 컷 ${n} 만 고치는 중` });
  const { text } = await askClaude(`너는 AI 숏드라마 연출가다. 아래 컷 하나만 사용자 요청대로 고친다. 요청한 것 말고는 이 컷의 다른 값도 그대로 둔다. 다른 컷은 보지도 고치지도 않는다.
[인물·소재] ${JSON.stringify({ characters: p.assets.characters.map(({ id, name, element_id, fixed_en }) => ({ id, name, element_id, fixed_en })), locations: p.assets.locations.map(({ id, name, element_id }) => ({ id, name, element_id })), props: p.assets.props.map(({ id, name, element_id }) => ({ id, name, element_id })) })}
[고칠 컷] ${JSON.stringify(p.shots[i])}
[요청] ${request}
답은 고친 컷 JSON 하나만 (같은 키 구조).`, { cwd: dDir(id) });
  const fixed = extractJson(text);
  await patchDrama(id, (q) => {
    const j = q.shots.findIndex((s) => s.n === Number(n));
    if (j < 0) throw new Error("그사이 샷리스트가 바뀌어 컷이 없습니다");
    q.shots[j] = { ...q.shots[j], ...fixed, n: q.shots[j].n, fixed_at: new Date().toISOString(), fix_request: request };
  });
  emit({ message: `컷 ${n} 수정 완료` });
  return { id, step: 2 };
}

/** 시트·장면 이미지·영상·목소리 레퍼런스 올리기. slot = "asset:A:0" (시트) | "voice:A" | "shot:3:image" | "shot:3:video" | "shot:3:audio" (입 모양 맞출 그 컷 음성)
 *  썸네일은 "asset:THUMB:frame" (영상에서 뽑은 장면) · "asset:THUMB:ref" (글자 스타일 참고) · "asset:THUMB:out" (완성) */
export async function setDramaMedia(id, slot, upload) {
  return patchDrama(id, async (p) => {
    const [kind, key, sub] = slot.split(":");
    const bag = kind === "shot" ? (p.media.shots[key] ||= {}) : (p.media.assets[key] ||= {});
    const field = kind === "shot" ? sub : kind === "voice" ? "voice" : `sheet_${sub || 0}`;
    if (bag[field]) await fs.rm(path.join(dDir(id), bag[field]), { force: true });
    if (upload) {
      const ext = extOf(upload.name);
      const ok = field === "video" ? /^(mp4|mov|m4v|webm)$/ : field === "voice" || field === "audio" ? /^(mp3|wav|m4a|aac|ogg|mp4|mov)$/ : /^(jpe?g|png|webp)$/;
      if (!ok.test(ext)) throw new Error(`이 칸에 넣을 수 없는 파일입니다: ${upload.name}`);
      const name = `media/${kind}_${key}_${field}_${Date.now()}.${ext}`;
      await fs.copyFile(upload.tmp, path.join(dDir(id), name));
      bag[field] = name;
    } else delete bag[field];
    // 목록 썸네일: 첫 장면 이미지, 없으면 첫 시트
    p.cover = p.shots.map((x) => p.media.shots[x.n]?.image).find(Boolean) || Object.values(p.media.assets).map((x) => x.sheet_0).find(Boolean) || null;
    const s = p.shots.length;
    const imgs = Object.values(p.media.shots).filter((m) => m.image).length, vids = Object.values(p.media.shots).filter((m) => m.video).length;
    p.step = Math.max(p.step, vids ? 5 : imgs ? 4 : 3);
    if (vids && vids >= s) p.step = Math.max(p.step, 6);
  });
}

/** 썸네일 제목 추천 — 궁금증 유발(후킹)용 큰 글자/작은 글자 조합 6개. 답은 숨기고, 제목이 비어 있으면 첫 안을 바로 넣는다 */
export async function suggestThumbTitles(id, emit = () => {}) {
  const p = await getDrama(id);
  if (!p) throw new Error("드라마가 없습니다");
  if (!p.shots?.length) throw new Error("샷리스트가 있어야 제목을 추천할 수 있습니다");
  emit({ message: "Claude 가 썸네일 제목을 고르는 중 (1분 안팎)" });
  const lines = p.shots.flatMap((s) => (s.dialogue || []).map((d) => d.line)).filter(Boolean);
  const caps = p.shots.map((s) => s.caption).filter(Boolean);
  const { text } = await askClaude(`너는 숏폼(릴스·쇼츠) 썸네일 후킹 카피라이터다. 아래 영상의 썸네일에 얹을 제목을 6개 낸다. 목표는 단 하나 — 피드를 넘기던 손을 멈추고 "뭔데?" 하고 눌러 보게 만드는 궁금증 유발.
[영상] ${JSON.stringify({ title: p.title, logline: p.develop?.logline || p.idea?.logline, hook: p.idea?.hook, twist: p.idea?.twist, product: p.inputs?.product })}
[대사] ${lines.join(" / ")}
${caps.length ? `[화면 자막] ${caps.join(" / ")}\n` : ""}[후킹 규칙]
- 답을 제목에 말하지 않는다. 영상의 핵심 반전·정답·이유는 숨기고, 그 빈칸이 궁금해서 누르게 만든다 (정보 공백).
- 큰 글자(title): 공백 포함 최대 14자. 0.5초 안에 읽히는 짧은 한 줄. 끝을 "…", "?", "이유", "차이", "하나" 처럼 열어 두거나 끊는다.
- 작은 글자(sub): 0~14자. 궁금증을 한 번 더 조이는 한 줄 (힌트·대상 지목·경고). 답을 풀지 않는다.
- 6개는 방식이 모두 다르게: ① 숨긴 이유 ("~한 진짜 이유") ② 경고·손해 ("이거 모르고 ~하면…") ③ 미완성 문장 (말을 끊음) ④ 의외의 사실 (상식과 반대) ⑤ 대상 지목 ("~하는 사람 필독" 류, 과장 없이) ⑥ 대사 반전 인용 (영상 속 가장 의외인 한마디를 그대로, 앞뒤 맥락은 숨김).
- 영상에 실제로 나오는 말·숫자·상황만 재료로 쓴다. 영상에 없는 금액·효과·순위, '100% 보장'·'무조건'·'충격' 같은 과장·낚시 단어는 쓰지 않는다 (클릭 후 내용과 어긋나면 안 된다).
- angle: 위 방식 이름 2~5자 (예: 숨긴이유).
답은 JSON 하나만: { "titles": [{ "title": "", "sub": "", "angle": "" }] }`, { cwd: dDir(id) });
  const titles = (extractJson(text).titles || []).filter((x) => x?.title).slice(0, 8);
  if (!titles.length) throw new Error("제목을 받지 못했습니다");
  await patchDrama(id, (q) => {
    const th = { ...(q.edit?.thumb || {}) };
    if (!(th.title || "").trim()) { th.title = titles[0].title; th.sub = titles[0].sub || ""; }
    q.edit = { ...(q.edit || {}), thumb: th, thumb_ideas: titles };
  });
  emit({ message: `썸네일 제목 ${titles.length}개 추천` });
  return { id, step: 6 };
}

/** 썸네일: 만든 컷 영상의 t 초 장면을 한 장 뽑아 asset:THUMB:frame 에 둔다 */
export async function thumbFrame(id, { n, t = 0 } = {}) {
  const p = await getDrama(id);
  const v = p?.media?.shots?.[String(n)]?.video;
  if (!v) throw new Error(`컷 ${n} 영상이 없습니다`);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "thumb-"));
  try {
    const out = path.join(tmp, "frame.png");
    await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, +t || 0)), "-i", path.join(dDir(id), v), "-frames:v", "1", out]);
    return await setDramaMedia(id, "asset:THUMB:frame", { tmp: out, name: "frame.png" });
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

/** 편집용: 자막 SRT (대사 + 컷 시간) */
export async function dramaSrt(id) {
  const p = await getDrama(id);
  const ts = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  const names = Object.fromEntries((p.assets.characters || []).map((c) => [c.id, c.name || c.id]));
  let n = 0, t = 0;
  const out = [];
  for (const s of p.shots) {
    const lines = (s.dialogue || []).filter((d) => d.line);
    if (!lines.length && s.caption) lines.push({ who: "", line: s.caption });
    const start = Number.isFinite(+s.start) ? +s.start : t, dur = +s.dur || 2;
    lines.forEach((d, i) => {
      const a = start + (dur * i) / lines.length, b = start + (dur * (i + 1)) / lines.length;
      out.push(`${++n}\n${ts(a)} --> ${ts(b - 0.05)}\n${d.inner ? `(${names[d.who] || d.who} 속마음) ` : ""}${d.line}\n`);
    });
    t = start + dur;
  }
  return out.join("\n");
}
