// 템플릿: 분석한 영상에서 "틀"만 뽑아 template.json 으로 저장한다.
// 기계 분석(컷 길이·화면 글자·음성)은 그대로 쓰고, 장면의 역할·구도·자막 스타일은 Claude 가 프레임을 보고 붙인다.
//   <DATA_DIR>/_templates/<tpl_ID>/template.json · cover.jpg · contact_sheet.jpg
import fs from "node:fs/promises";
import path from "node:path";
import { askClaude, extractJson } from "./claude.js";
import { DATA_DIR, brandDir, readJson, writeJson } from "./store.js";

export const TEMPLATES_DIR = path.join(DATA_DIR, "_templates");
const SECTIONS = ["훅", "문제·상황", "제품 소개", "증명·기능", "혜택", "CTA", "브랜딩"];
const RESOURCE_KINDS = ["제품", "인물", "목소리", "배경", "주제"];
const MAX_FRAMES = 30; // 한 번에 보여줄 프레임 수 상한

function buildPrompt(ad, video) {
  const shots = video.shots.map((s) => ({
    shot: s.shot, start: s.start, dur: s.dur, frame: s.frame,
    onscreen_text: s.onscreen_text || "", speech: s.speech || "",
  }));
  // 컷이 많으면 고르게 골라 보여준다 (나머지는 글자·음성만으로 판단)
  const step = Math.max(1, Math.ceil(shots.length / MAX_FRAMES));
  const look = shots.filter((_, i) => i % step === 0).map((s) => s.frame);

  return `너는 숏폼 광고 기획자다. 아래 광고 영상을 "다른 제품·주제에도 쓸 수 있는 틀(템플릿)"로 정리한다.
현재 폴더의 프레임 이미지를 Read 로 직접 보고 판단해라: ${look.join(", ")}

[광고 정보]
- 광고주: ${ad.advertiser || ad.brand || "?"} / 길이 ${video.spec.duration_s}초 / ${video.spec.width}x${video.spec.height} (${video.spec.aspect})
- 본문: ${(ad.body_text || "").slice(0, 600)}

[컷 목록 — 기계 분석 결과. 화면 글자는 OCR, 음성은 자동 인식이라 오타가 있을 수 있다]
${JSON.stringify(shots)}

[규칙]
- 컷 수·시작·길이는 위 값을 그대로 쓴다. 지어내지 않는다.
- 특정 브랜드·제품명은 템플릿 필드에 넣지 말고 "제품명" 같은 자리표시로 일반화한다. 원래 문구는 example 에만 둔다.
- section 은 다음 중 하나: ${SECTIONS.join(", ")}
- resource_needs 의 kind 는 다음 중 하나: ${RESOURCE_KINDS.join(", ")}
- 모르는 것은 빈 문자열. 추측이면 notes 에 "추정" 이라고 쓴다.
- 답은 아래 JSON 하나만. 설명 문장 금지.

{
  "name": "템플릿 이름 (형식을 드러내는 짧은 한국어, 예: '가족 반복 개그 → 제품 반전')",
  "summary": "이 형식이 어떻게 작동하는지 2~3문장",
  "hook_type": "질문형 | 상황극 | 문제 제기 | 결과 먼저 | 숫자·통계 | 기타",
  "tone": "유머 | 감성 | 정보 | 프리미엄 | 기타",
  "structure": [{ "section": "", "start": 0, "end": 0, "purpose": "이 구간이 하는 일" }],
  "slots": [{
    "shot": 1, "start": 0, "dur": 0, "section": "",
    "role": "이 컷이 하는 일 (한 줄)",
    "shot_type": "익스트림 와이드 | 와이드 | 미디엄 | 클로즈업 | 익스트림 클로즈업 | CG·그래픽 | 패키지샷",
    "subject": "화면의 주인공 (인물 | 제품 | 배경 | 텍스트 | 혼합)",
    "composition": "구도·배치 한 줄",
    "camera": "고정 | 패닝 | 줌인 | 줌아웃 | 핸드헬드 | 기타",
    "text_overlay": { "pattern": "자막·카피의 형식 (예: 질문형 대사, 기능 설명)", "position": "상단 | 중앙 | 하단 | 없음", "style": "색·굵기·효과" },
    "audio": { "type": "대사 | 내레이션 | 음악만 | 효과음 | 없음", "pattern": "말의 형식" },
    "resource_needs": [{ "kind": "인물", "desc": "필요한 소스 설명" }],
    "example": { "onscreen_text": "원래 화면 글자(정리)", "speech": "원래 대사(정리)" }
  }],
  "copy_patterns": ["반복되는 카피 공식"],
  "music": { "mood": "", "tempo": "느림 | 보통 | 빠름" },
  "brand_elements": { "logo_position": "", "end_card": "" },
  "notes": ""
}`;
}

/** 분석된 광고 → 템플릿 */
export async function createTemplate(brand, adDirName, emit = () => {}) {
  const adDir = path.join(brandDir(brand), adDirName);
  const ad = await readJson(path.join(adDir, "ad.json"), null);
  const analysis = await readJson(path.join(adDir, "analysis.json"), null);
  const video = analysis?.videos?.[0];
  if (!ad || !video) throw new Error("영상 분석 결과가 없는 광고입니다");

  emit({ message: `Claude 가 컷 ${video.shots.length}개를 보는 중 (1~3분)` });
  const { text, durationMs } = await askClaude(buildPrompt(ad, video), { cwd: adDir });
  const tpl = extractJson(text);
  emit({ message: `템플릿 정리 완료 (${Math.round(durationMs / 1000)}초)` });

  // 기계 분석 값으로 시간 정보를 덮어써서 어긋나지 않게 한다
  const byShot = new Map(video.shots.map((s) => [s.shot, s]));
  tpl.slots = (tpl.slots || []).map((s) => {
    const m = byShot.get(s.shot);
    return m ? { ...s, start: m.start, dur: m.dur, frame: path.basename(m.frame) } : s;
  });

  const id = `tpl_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const dir = path.join(TEMPLATES_DIR, id);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  for (const s of video.shots) await fs.copyFile(path.join(adDir, s.frame), path.join(dir, "frames", path.basename(s.frame))).catch(() => {});
  await fs.copyFile(path.join(adDir, video.contact_sheet), path.join(dir, "contact_sheet.jpg")).catch(() => {});
  // 원본 영상도 템플릿 폴더에 복사해 둔다 (원래 광고를 지워도 템플릿에서 볼 수 있게)
  const sourceVideo = `source${path.extname(video.file) || ".mp4"}`;
  await fs.copyFile(path.join(adDir, video.file), path.join(dir, sourceVideo));
  const coverSrc = ad.files?.poster || video.shots[0]?.frame;
  if (coverSrc) await fs.copyFile(path.join(adDir, coverSrc), path.join(dir, "cover.jpg")).catch(() => {});

  const full = {
    id, ...tpl,
    format: { duration_s: video.spec.duration_s, width: video.spec.width, height: video.spec.height, aspect: video.spec.aspect, shot_count: video.shots.length },
    media: { video: sourceVideo, cover: coverSrc ? "cover.jpg" : null },
    source: { brand: brand.name, brand_id: brand.id, ad_dir: adDirName, library_id: ad.library_id, platform: ad.platform },
    created_at: new Date().toISOString(),
  };
  await writeJson(path.join(dir, "template.json"), full);
  return { id };
}

export async function listTemplates() {
  const names = await fs.readdir(TEMPLATES_DIR).catch(() => []);
  const out = [];
  for (const n of names.filter((n) => n.startsWith("tpl_"))) {
    const t = await readJson(path.join(TEMPLATES_DIR, n, "template.json"), null);
    if (t) out.push(t);
  }
  return out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

const tplDir = (id) => {
  if (!/^tpl_\w+$/.test(id)) throw new Error("잘못된 템플릿 ID");
  return path.join(TEMPLATES_DIR, id);
};

export const getTemplate = (id) => readJson(path.join(tplDir(id), "template.json"), null);

/** 화면에서 고친 내용 저장 (id·출처·형식 정보는 그대로 둔다) */
export async function saveTemplate(id, data) {
  const cur = await getTemplate(id);
  if (!cur) throw new Error("템플릿이 없습니다");
  // 카드뉴스는 장 수가 바뀔 수 있다
  const format = Array.isArray(data.slides) && cur.kind === "cardnews" ? { ...cur.format, slide_count: data.slides.length } : cur.format;
  const next = { ...cur, ...data, id: cur.id, kind: cur.kind, source: cur.source, format, media: cur.media, created_at: cur.created_at, updated_at: new Date().toISOString() };
  await writeJson(path.join(tplDir(id), "template.json"), next);
  return next;
}

/** 템플릿 복제 — 원본은 그대로 두고 고쳐 쓸 사본을 만든다 (만든 카드뉴스는 안 가져간다) */
export async function duplicateTemplate(id) {
  const cur = await getTemplate(id);
  if (!cur) throw new Error("템플릿이 없습니다");
  let nid = `tpl_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  for (let i = 2; await fs.stat(tplDir(nid)).then(() => true, () => false); i++) nid = `${nid.split("_").slice(0, 2).join("_")}_${i}`;
  const src = tplDir(id), cards = path.join(src, "cards");
  await fs.cp(src, tplDir(nid), { recursive: true, filter: (f) => f !== cards && !f.startsWith(cards + path.sep) });
  const { updated_at, ...rest } = cur;
  const next = { ...rest, id: nid, name: `${cur.name || id} (복제)`, forked_from: id, cards: [], created_at: new Date().toISOString() };
  await writeJson(path.join(tplDir(nid), "template.json"), next);
  return next;
}

export async function deleteTemplate(id) {
  await fs.rm(tplDir(id), { recursive: true, force: true });
}
