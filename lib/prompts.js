// 장면별 프롬프트: 분석한 광고를 컷 하나 = 프롬프트 하나로 옮긴다. 이미지 광고는 이미지 프롬프트.
//   <광고 폴더>/prompts.json
// 원칙
//  - 컷 수·시간은 기계 분석 값을 그대로 쓴다 (줄이거나 합치지 않는다)
//  - 영상 프롬프트에는 글자·자막·로고를 넣지 않는다 (영상 모델의 한글 렌더가 불안정). 화면 글자·대사는 따로 둔다
//  - 이미지는 두 벌: 글자 없는 버전(나중에 캡컷·디자인 툴에서 얹기) + 글자까지 그리는 버전(글자 렌더가 되는 이미지 모델용)
//  - 프롬프트는 영어(모델 정확도), 확인용 한국어 번역을 같이 둔다
//  - 영상 컷에는 첫 프레임 이미지 프롬프트도 둔다 (이미지 → 영상으로 만드는 모델용)
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { askClaude, extractJson } from "./claude.js";
import { AD_DIR_RE, brandDir, readJson, writeJson } from "./store.js";
import { resourceImage, resourcePath } from "./resources.js";

const MAX_FRAMES = 30;
const NEGATIVE = "text, captions, subtitles, logo, watermark, distorted hands, extra fingers";
const NEGATIVE_TEXT = "misspelled text, garbled letters, broken Korean characters, watermark, distorted hands, extra fingers";
// 영상 광고의 포스터는 첫 프레임과 겹치므로 이미지 프롬프트에서 뺀다
const promptImages = (analysis) => (analysis?.images || []).filter((im) => !im.error && !(analysis.videos?.length && /poster/.test(im.file)));

function buildPrompt(ad, analysis, { topic }) {
  const videos = (analysis.videos || []).map((v, vi) => {
    const step = Math.max(1, Math.ceil(v.shots.length / MAX_FRAMES));
    return {
      video: vi, file: v.file, duration_s: v.spec.duration_s, aspect: v.spec.aspect,
      shots: v.shots.map((s, i) => ({
        shot: s.shot, start: s.start, dur: s.dur, onscreen_text: s.onscreen_text || "", speech: s.speech || "",
        frame: i % step === 0 ? s.frame : undefined,
      })),
    };
  });
  const images = promptImages(analysis).map((im) => ({
    file: im.file, size: `${im.width}x${im.height}`, aspect: im.aspect,
    colors: (im.dominant_colors || []).map((c) => c.hex), text: (im.text_lines || []).map((l) => l.text),
  }));
  const look = [...videos.flatMap((v) => v.shots.map((s) => s.frame).filter(Boolean)), ...images.map((im) => im.file)];

  return `너는 광고 촬영 감독이자 AI 생성 프롬프트 작가다. 아래 광고를 장면(컷)마다 AI 생성 모델에 바로 넣을 프롬프트로 옮긴다.
현재 폴더의 이미지를 Read 로 직접 보고 써라: ${look.join(", ")}
(프레임이 없는 컷은 앞뒤 프레임·화면 글자·음성으로 판단한다)

[광고 정보]
- 광고주: ${ad.advertiser || ad.brand || "?"}
- 본문: ${(ad.body_text || ad.title || "").slice(0, 600)}
- 영상: ${JSON.stringify(videos)}
- 이미지: ${JSON.stringify(images)}

[제품·주제] ${topic ? `${topic} — 원본 제품·브랜드 자리에 이것을 넣는다` : "원본 그대로 재현한다. 단 브랜드명·로고는 프롬프트에 쓰지 않고 [제품] [브랜드] 자리표시로 둔다"}

[규칙]
1. 영상은 컷 하나 = 장면 하나. 컷 번호·시작·길이는 위 값을 그대로 쓴다. 줄이거나 합치지 않는다.
2. video_prompt_en: 영어 한 문단. 샷 종류 → 피사체와 동작(컷 길이 안에 일어나는 움직임) → 장소·소품 → 조명·색감 → 카메라 움직임 → 스타일. 비율("9:16 vertical" 등)을 적는다.
3. start_frame_prompt_en: 그 컷의 첫 프레임을 정지 이미지로 만드는 영어 프롬프트 (동작 대신 구도·포즈).
4. 이미지는 파일 하나 = 프롬프트 하나. image_prompt_en: 피사체 → 구도·배치(글자가 들어갈 빈 공간 위치 포함) → 배경 → 조명·색감(주요 색 hex 참고) → 스타일·질감 → 비율.
5. video_prompt_en·start_frame_prompt_en·image_prompt_en 에는 글자·자막·로고·워터마크를 넣으라고 쓰지 않는다. 원래 화면 글자·대사는 onscreen_text·voiceover 에 한국어로 따로 정리한다 (OCR·음성 인식 오타는 고친다).
5-2. text_elements: 화면 글자를 덩어리(스티커·박스·캡션)마다 하나씩. x·y·w·h 는 이미지 크기 대비 퍼센트(0~100), 왼쪽 위 모서리 기준. 이미지를 보고 실제 위치에 맞게 잡는다.
5-3. subjects: 이미지 속 주요 소재(인물·제품·소품·로고)마다 하나씩, 그 소재를 감싸는 상자. 단위는 text_elements 와 같다. 글자는 넣지 않는다.
5-1. 이미지는 image_with_text_prompt_en 을 하나 더 쓴다: image_prompt_en 의 장면 묘사에 화면 글자를 전부 넣은 버전. 글자는 원문 한국어 그대로 큰따옴표로 감싸고(예: the Korean text "15% 할인 중" ), 요소마다 위치·크기·글꼴 느낌(굵은 고딕, 손글씨 등)·색(hex)·배경 박스·강조를 적는다. 스티커·말풍선·가격 배지 같은 그래픽 요소도 묘사한다. 로고는 [브랜드] 자리표시로.
6. 같은 인물·제품이 여러 컷에 나오면 묘사를 똑같이 반복해 일관성을 지킨다 (characters 에 한 번 정의하고 각 프롬프트에 같은 문장으로 넣는다).
7. 모르는 것은 빈 문자열. 답은 아래 JSON 하나만. 설명 문장 금지.

{
  "style": "광고 전체 스타일 한 줄 (영어)",
  "characters": [{ "name": "인물 A", "desc_en": "모든 컷에 똑같이 넣을 외모 묘사" }],
  "scenes": [{
    "video": 0, "shot": 1, "start": 0, "dur": 0,
    "purpose": "이 컷이 하는 일 (한국어 한 줄)",
    "video_prompt_en": "", "video_prompt_ko": "위 영어 프롬프트의 한국어 번역",
    "start_frame_prompt_en": "",
    "camera": "고정 | 패닝 | 줌인 | 줌아웃 | 돌리 | 핸드헬드",
    "onscreen_text": "", "text_position": "상단 | 중앙 | 하단 | 없음",
    "voiceover": "",
    "resources": [{ "kind": "제품 | 인물 | 목소리 | 배경 | 주제", "desc": "" }]
  }],
  "images": [{
    "file": "",
    "image_prompt_en": "", "image_prompt_ko": "",
    "image_with_text_prompt_en": "",
    "aspect": "",
    "onscreen_text": "", "text_layout": "글자 위치·크기·색",
    "text_elements": [{
      "text": "요소 하나의 글자 (줄바꿈은 \\n)", "role": "제목 | 질문 스티커 | 답변 | 캡션 | 가격·할인 | 버튼 | 기타",
      "x": 0, "y": 0, "w": 0, "h": 0,
      "size": "작게 | 보통 | 크게 | 아주 크게", "weight": "보통 | 굵게",
      "color": "#ffffff", "bg": "#000000 또는 none", "align": "왼쪽 | 가운데 | 오른쪽"
    }],
    "subjects": [{ "kind": "person | product | prop | logo", "label": "무엇인지 한국어 짧게", "x": 0, "y": 0, "w": 0, "h": 0 }],
    "resources": [{ "kind": "", "desc": "" }]
  }]
}`;
}

/** 분석된 광고 → 장면별 프롬프트 (prompts.json) */
export async function createPrompts(brand, adDirName, { topic = "" } = {}, emit = () => {}) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const adDir = path.join(brandDir(brand), adDirName);
  const ad = await readJson(path.join(adDir, "ad.json"), null);
  const analysis = await readJson(path.join(adDir, "analysis.json"), null);
  const shots = (analysis?.videos || []).reduce((n, v) => n + v.shots.length, 0);
  const imgs = promptImages(analysis).length;
  if (!ad || (!shots && !imgs)) throw new Error("분석 결과가 없는 광고입니다");

  emit({ message: `Claude 가 ${[shots && `컷 ${shots}개`, imgs && `이미지 ${imgs}장`].filter(Boolean).join(" · ")}를 보는 중 (1~3분)` });
  const { text, durationMs } = await askClaude(buildPrompt(ad, analysis, { topic: topic.trim() }), { cwd: adDir });
  const out = extractJson(text);

  // 시간은 기계 분석 값으로 덮어쓰고, 프레임 경로를 붙인다
  const shotOf = (vi, n) => analysis.videos?.[vi]?.shots.find((s) => s.shot === n);
  out.scenes = (out.scenes || []).map((s) => {
    const m = shotOf(Number(s.video) || 0, s.shot);
    return { ...s, negative_en: NEGATIVE, ...(m ? { start: m.start, dur: m.dur, frame: m.frame } : {}) };
  });
  out.images = (out.images || []).map((im) => ({ ...im, negative_en: NEGATIVE, negative_text_en: NEGATIVE_TEXT }));

  const prev = await readJson(path.join(adDir, "prompts.json"), null);
  const result = { variants: prev?.variants || [], topic: topic.trim(), created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000), ...out };
  await writeJson(path.join(adDir, "prompts.json"), result);
  emit({ message: `장면별 프롬프트 완성 (${result.took_s}초)` });
  return { dir: adDirName, prompts: true };
}

// ── 소재 바꿔 만들기 (이미지) ─────────────────────────
// 원본 이미지 프롬프트의 구도·글자 배치는 두고, 고른 제품·인물·배경과 고친 글자로 다시 쓴다.
// 결과는 prompts.json 의 variants[] 에 쌓인다. 참조 사진은 <광고 폴더>/variants/<vid>/ref_N.* 로 복사해 둔다.
const ROLE = { product: "제품", person: "인물", background: "배경", upload: "참조", logo: "로고", original: "원본", flipped: "좌우반전한 원본", style: "스타일·구도 레퍼런스" };

const elementLines = (els) => els.map((e, i) =>
  `${i + 1}. "${e.text}" (${e.role || "글자"}) — 위치 왼쪽 ${Math.round(e.x)}% 위 ${Math.round(e.y)}%, 너비 ${Math.round(e.w)}% 높이 ${Math.round(e.h)}%, 크기 ${e.size || "보통"}, ${e.weight || "보통"}, 글자색 ${e.color || "#ffffff"}, 배경 ${!e.bg || e.bg === "none" ? "없음" : e.bg}, ${e.align || "가운데"} 정렬`).join("\n");

/** 이미 만든 프롬프트에 소재 위치(subjects)가 없을 때 — 이미지를 보고 소재마다 상자를 잡아 prompts.json 에 넣는다 */
export async function detectSubjects(brand, adDirName, image) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const adDir = path.join(brandDir(brand), adDirName);
  const pj = await readJson(path.join(adDir, "prompts.json"), null);
  const im = pj?.images?.find((x) => x.file === image);
  if (!im) throw new Error("먼저 이 이미지의 프롬프트를 만드세요");
  const { text } = await askClaude(`현재 폴더의 이미지 ${im.file} 를 Read 로 본다.
이미지 속 주요 소재(인물·제품·소품·로고)마다, 그 소재를 감싸는 상자를 잡는다. x·y·w·h 는 이미지 크기 대비 퍼센트(0~100), 왼쪽 위 모서리 기준.
인물은 보이는 몸 전체(머리~잘린 곳), 제품은 제품만. 화면 글자·스티커는 넣지 않는다. 소재가 없으면 빈 배열.
답은 JSON 하나만: { "subjects": [{ "kind": "person | product | prop | logo", "label": "무엇인지 한국어 짧게", "x": 0, "y": 0, "w": 0, "h": 0 }] }`, { cwd: adDir });
  const subjects = (extractJson(text).subjects || []).filter((x) => PLACE_NAME[x.kind])
    .map((x) => ({ ...x, x: Math.round(+x.x), y: Math.round(+x.y), w: Math.round(+x.w), h: Math.round(+x.h) }));
  const cur = await readJson(path.join(adDir, "prompts.json"), pj);
  cur.images = cur.images.map((x) => (x.file === image ? { ...x, subjects } : x));
  await writeJson(path.join(adDir, "prompts.json"), cur);
  return { subjects };
}

// 사용자가 이미지 위에 정한 소재 자리 → 말로 (예: "인물: 왼쪽에서 25~75%, 위에서 15~90% — 화면 가운데 아래")
const PLACE_NAME = { person: "인물", product: "제품", prop: "소품", logo: "로고" };
function placementLines(pl) {
  const where = (c, a, b, m) => (c < 34 ? a : c > 66 ? b : m);
  const box = (b) => `왼쪽에서 ${b.x}~${b.x + b.w}%, 위에서 ${b.y}~${b.y + b.h}%`;
  return pl.map((p) => {
    const name = `${PLACE_NAME[p.kind] || p.kind}${p.label ? `(원본의 ${p.label})` : ""}`;
    if (p.remove) return `- ${name}: 없앤다 — 원래 ${box(p.from)} 자리는 배경으로 자연스럽게 채운다`;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    return `- ${name}: ${p.from ? `원래 ${box(p.from)} → ` : "새로 넣는다, "}${box(p)} (화면 ${where(cy, "위", "아래", "가운데")} ${where(cx, "왼쪽", "오른쪽", "가운데")}, 화면 넓이의 약 ${Math.round(p.w * p.h / 100)}%)${p.note ? ` — ${p.note}` : ""}`;
  }).join("\n");
}

// inspire: 원본은 참고만 — 광고 유형·정보 위계만 빌리고 구도·글자 배치·제품 연출은 아이디어의 [새 레이아웃]대로 새로 짠다 (광고 자동화 기획 승인)
function buildVariantPrompt(ad, im, refs, { texts, elements, note, idea, textsEdited, placements = [], inspire = false }) {
  const refLines = refs.map((r) => `- 첨부 ${r.n}번 (${r.label}): ${r.file}${r.desc ? ` — ${r.desc}` : ""}`).join("\n");
  idea = String(idea || "").trim();
  // 아이디어가 있고 사용자가 글자를 안 고쳤으면, 원본 글자 배치는 두고 글은 새 주제로 새로 쓴다
  const rewrite = idea && !textsEdited;
  const hasPerson = refs.some((r) => r.role === "person");
  return `${inspire ? "너는 광고 이미지 프롬프트 작가다. 아래 원본 광고는 참고만 한다 — 광고 유형과 정보 순서만 빌리고, 구도·글자 배치·요소 배치·제품 연출은 변형 아이디어의 [새 레이아웃]대로 새로 짠 프롬프트를 쓴다. 원본과 나란히 놓아도 베낀 것으로 보이지 않아야 한다." : "너는 광고 이미지 프롬프트 작가다. 아래 원본 광고 이미지의 구도·글자 배치·분위기는 유지하고, 소재만 바꾼 새 프롬프트를 쓴다."}
현재 폴더의 이미지를 Read 로 직접 본다: 원본 ${im.file}${refs.length ? `, 참조 ${refs.map((r) => r.file).join(", ")}` : ""}

[원본 프롬프트]
- 글자 없음: ${im.image_prompt_en}
- 글자 포함: ${im.image_with_text_prompt_en || "(없음)"}
- 원본 글자 배치: ${im.text_layout || ""}

[참조 이미지 — 생성 서비스에 이 순서대로 첨부한다]
${refLines || "(없음 — 원본 소재 유지)"}

${idea ? `[변형 아이디어 — 사용자 지시. 의도·주제·카피·인물·제품·배경·색을 이대로 바꾼다]
${idea}

` : ""}${rewrite && inspire ? `[새 화면 글자 — 아이디어의 [화면 글자] 목록을 글자 그대로 쓴다. 위치·크기·색은 [새 레이아웃]과 브랜드 컬러를 따른다. 원본 글자의 위치·크기·박스 모양은 따르지 않는다]
(참고용 원본 글자: ${String(im.onscreen_text || "").replace(/\n/g, " / ")})` : rewrite ? `[새 화면 글자 — 아이디어의 주제로 새로 쓴다]
원본 글자 요소의 개수·역할(헤드라인·보조 문구·버튼·배지 등)·대략의 길이는 유지하고, 내용만 새 주제에 맞게 쓴다. 지시에 따옴표로 준 문구가 있으면 그 문구를 그대로 헤드라인에 쓴다. 숫자·혜택은 지시에 있는 것만 쓰고 지어내지 않는다.
${im.text_elements?.length ? `원본 글자 배치(위치·크기·색은 디자인 지시가 없으면 유지):
${elementLines(im.text_elements)}` : `원본 글자: ${im.onscreen_text || ""}`}` : elements?.length ? `[새 화면 글자 배치 — 사용자가 편집기에서 직접 정한 값. 위치·크기·색을 이대로 따른다. 퍼센트는 이미지 크기 대비, 왼쪽 위 기준]
${elementLines(elements)}` : `[새 화면 글자 — 한 줄이 한 요소]
${texts?.trim() || "(원본 글자 유지)"}`}

${placements.length ? `
[소재 위치 — 사용자가 이미지 위에 직접 정한 자리. 그 요소가 이 영역을 차지하도록 구도를 다시 잡는다. 퍼센트는 이미지 크기 대비, 왼쪽 위 기준]
${placementLines(placements)}
` : ""}
${refs.some((r) => r.role === "style") ? `[스타일·구도 레퍼런스] 첨부 ${refs.filter((r) => r.role === "style").map((r) => r.n).join("·")}번은 화풍·색감·조명·구도·여백만 따른다. 그 이미지 속 인물·제품·글자·로고는 가져오지 않는다.

` : ""}[바꿀 점] ${note?.trim() || "(없음)"}

[규칙]
${inspire ? "1. 원본의 배경·소품·효과(빛 줄기·소용돌이·컵 등)·제품 각도를 그대로 가져오지 않는다. 고르지 않은 요소도 [새 레이아웃]과 장면 연출에 맞게 새로 정하고, 제품은 고객사 제품에 맞는 단순하고 깔끔한 연출로 둔다." : "1. 고르지 않은 요소(인물·배경 등)는 원본 그대로 둔다."}
2. ref_* 프롬프트: 참조한 요소는 길게 묘사하지 말고 "the product shown in reference image 1" 처럼 첨부 번호로 가리킨다. 위치·포즈·손에 든 방식 등 배치만 쓴다.
3. plain_* 프롬프트: 첨부 없이 글로만. 참조 사진을 보고 생김새(모양·색 hex·재질·라벨 형태)를 구체적으로 묘사한다.
3-0. 제품 일관성용 두 가지를 더 쓴다 (제품이 없는 광고면 주인공 소재 기준).
  - scene_noproduct_en (합성용): 제품을 빼고 그 자리를 빈 바닥·빈 공간으로 남긴 장면. 나중에 실제 제품 사진을 그 자리에 얹는다. 빈 자리 위치(퍼센트), 조명 방향, 그림자가 떨어질 바닥면을 분명히 쓴다. 글자·로고 없음. product_box 에 그 자리(이미지 대비 퍼센트, 왼쪽 위 기준)를 숫자로 적는다.
  - edit_product_en (편집형 모델용): ${refs.some((r) => r.role === "product") ? `첨부 ${refs.filter((r) => r.role === "product").map((r) => r.n).join("·")}번이 실제 제품 사진이다. "Use reference image N as the exact product. Do not redraw or restyle it — keep its shape, proportions, label text, logo, colors and materials exactly as in the photo." 로 시작하고, 그 제품을 놓을 자리·크기·각도·조명만 장면과 함께 쓴다.` : "제품 사진 첨부가 없으면 주인공 소재를 바꾸지 말라는 같은 형식으로 쓴다."} 글자는 넣지 않는다.
3-1. 생성 모델은 원본 광고를 본 적이 없다. "compared with the original", "mirrored", "same as before", "bigger than the original" 같은 비교·상대 표현은 쓰지 않는다. 좌우반전·크기 변경 같은 지시는 결과 그림만 보고 알 수 있는 절대 묘사로 옮긴다 (예: 좌우반전 → 반전된 결과에서 종이가 어느 쪽 가장자리로 당겨져 모이고, 주름이 어느 방향으로 기우는지, 어둠이 화면 어느 쪽에 드러나는지). 지시가 화면 전체 반전인지 한 요소의 방향만인지 애매하면, 지시 문장을 그대로 따르는 쪽으로 정하고 changes 에 어떻게 해석했는지 적는다.${refs.some((r) => r.role === "original" || r.role === "flipped") ? `
3-2. 원본 참조가 첨부됐다 (${refs.filter((r) => r.role === "original" || r.role === "flipped").map((r) => `${r.n}번 ${r.label}`).join(", ")}). ref_* 프롬프트는 "Edit reference image N:" 으로 시작해, 그 이미지에서 유지할 것과 바꿀 것을 나눠 쓴다 (이미지 편집 모델용).${refs.some((r) => r.role === "flipped") ? " 좌우반전한 원본은 이미 좌우가 뒤집혀 있다 — 구도·방향은 그 이미지를 그대로 따르고, 뒤집혀 거울글자가 된 글자·로고는 모두 지운 뒤 새 화면 글자를 정방향으로 얹는다." : ""}` : ""}
4. *_text_en: 새 화면 글자를 한국어 원문 그대로 큰따옴표로 넣고 위치·크기·글꼴 느낌·색(hex)·배경 박스를 적는다. 글자 배치 값이 주어졌으면 그 위치를 "upper-left area, about 10-30% from the left and 55-70% from the top" 처럼 프롬프트 말로 옮긴다. 없으면 ${inspire ? "아이디어의 [새 레이아웃] 배치를 따른다 (원본 배치 아님)" : "원본 배치를 따른다"}. *_notext_en: 글자·로고 없이, 글자 자리는 빈 공간으로 둔다.
5. 제품이 바뀌면 손동작·색감·소품도 그 제품에 맞게 자연스럽게 고친다. 바꾼 내용을 changes 에 한국어로 적는다.${placements.length ? `
5-1. 소재 위치가 주어진 요소는 모든 프롬프트(ref·plain, 글자 포함·없음)에서 그 자리를 말로 분명히 쓴다 — 예: "the person occupies the center-bottom of the frame, roughly 25-75% from the left and 15-90% from the top". 크기(화면에서 차지하는 비율)와 잘림(상반신·전신)도 영역에 맞춘다. 위치를 정하지 않은 요소는 정한 요소를 피해 자연스럽게 다시 배치한다. 글자 자리와 겹치면 changes 에 적는다.` : ""}
${idea ? `6. 아이디어에서 바꾸라고 한 것만 바꾸고, 말하지 않은 요소(구도·카메라·조명·글자 배치)는 원본을 따른다. 색 지시는 hex 로 구체화한다(예: 하늘색 → #BFE3FF 계열).
7. 인물: ${hasPerson ? "인물 참조 사진이 첨부됐다. 그 사람의 얼굴·체형·헤어를 그대로 따르고(ref_* 는 첨부 번호로 가리킨다), 복장·포즈·표정만 지시와 장면에 맞춘다." : "인물 참조 사진이 없다. 지시에 인물이 나오면 가상 인물을 새로 설계한다 — 나이대·성별·헤어·복장·표정·포즈를 구체적으로 쓰고, 실존 인물·연예인을 닮게 하지 않는다. 같은 인물을 다시 만들 수 있게 person_source 에 그 설계를 적는다."}
8. idea_summary: 지시를 어떻게 해석해 무엇을 바꿨는지 한국어 한두 문장.
9. 답은 아래 JSON 하나만.` : "6. 답은 아래 JSON 하나만."}

{
  "title": "변형 이름 (짧은 한국어)",
  "ref_text_en": "", "ref_notext_en": "",
  "plain_text_en": "", "plain_notext_en": "",
  "prompt_ko": "ref_text_en 의 한국어 번역",
  "onscreen_text": "", "text_layout": "",
  "scene_noproduct_en": "", "product_box": { "x": 0, "y": 0, "w": 0, "h": 0 }, "edit_product_en": "",
  "changes": ""${idea ? `,
  "idea_summary": "",
  "person_source": "${hasPerson ? "참조 사진 N번" : "가상 인물: (설계) 또는 인물 없음"}"${rewrite ? `,
  "text_elements": [{ "text": "", "role": "", "x": 0, "y": 0, "w": 0, "h": 0, "size": "작게|보통|크게|아주 크게", "weight": "보통|굵게", "color": "#ffffff", "bg": "none", "align": "가운데" }]` : ""}` : ""}
}`;
}

/**
 * opts = { image, resources: { product, person, background } (리소스 id), uploads: [{ tmp, name }], texts, elements, note }
 */
export async function createVariant(brand, adDirName, opts, emit = () => {}) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const adDir = path.join(brandDir(brand), adDirName);
  const pj = await readJson(path.join(adDir, "prompts.json"), null);
  const im = pj?.images?.find((x) => x.file === opts.image);
  if (!im) throw new Error("먼저 이 이미지의 프롬프트를 만드세요");
  const ad = await readJson(path.join(adDir, "ad.json"), {});

  const vid = `v_${Date.now()}`;
  const vdir = path.join(adDir, "variants", vid);
  await fs.mkdir(vdir, { recursive: true });
  const refs = [];
  const addRef = async (src, role, extra = {}) => {
    const n = refs.length + 1;
    const file = `variants/${vid}/ref_${n}${path.extname(src).toLowerCase() || ".jpg"}`;
    await fs.copyFile(src, path.join(adDir, file));
    refs.push({ n, role, label: ROLE[role], file, ...extra });
  };
  // 원본 광고 이미지를 참조로 (편집 모델이 "이 이미지에서 무엇을 바꿀지"로 알아듣게). 좌우반전본은 앱이 직접 뒤집어 정확하다
  const origSrc = path.join(adDir, im.file);
  if (opts.attachOriginal) await addRef(origSrc, "original", { name: im.file, desc: "원본 광고 이미지 (구도·배치 기준)" });
  if (opts.attachFlipped) {
    const tmp = path.join(vdir, `flipped${path.extname(im.file).toLowerCase() || ".jpg"}`);
    await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-i", origSrc, "-vf", "hflip", "-q:v", "2", tmp]);
    await addRef(tmp, "flipped", { name: `${im.file} (좌우반전)`, desc: "원본을 좌우로 뒤집은 이미지 — 구도·방향의 기준 (글자는 거울글자라 다시 얹는다)" });
    await fs.rm(tmp, { force: true });
  }
  for (const kind of ["product", "person", "background"]) {
    const id = opts.resources?.[kind];
    if (!id) continue;
    const r = await resourceImage(kind, id);
    if (!r) throw new Error(`${ROLE[kind]} 리소스에 이미지가 없습니다`);
    const a = r.res.attrs || {};
    await addRef(r.file, kind, { name: r.res.name, desc: [r.res.name, ...Object.values(a), r.res.description, r.form === "sheet" ? "여러 각도를 한 장에 모은 시트 — 한 대상이다, 정면 모습을 기준으로" : "단일 이미지"].filter(Boolean).join(" · ") });
  }
  // 역할을 정해 올린 사진 (인물·제품·배경) — 아이디어에서 그 요소는 이 사진을 따른다
  for (const kind of ["person", "product", "background"])
    for (const u of opts.roleUploads?.[kind] || []) await addRef(u.tmp, kind, { name: u.name, desc: `사용자가 올린 ${ROLE[kind]} 사진` });
  for (const u of opts.uploads || []) await addRef(u.tmp, "upload", { name: u.name, desc: u.name });
  // 고객사 로고 (광고 자동화 기획의 로고) — 다시 그리지 않고 그대로 얹을 이미지
  if (opts.logo?.file) await addRef(opts.logo.file, "logo", { name: opts.logo.name, desc: `${opts.logo.name} — 고객사 로고 이미지. 브랜드 자리에 이 로고를 모양·글자·색 그대로 얹는다 (다시 그리거나 바꾸지 않는다)` });
  // 레퍼런스 메뉴에서 고른 스타일·구도 참고 이미지 — 화풍·색감·구도만 따르고 소재는 가져오지 않는다
  for (const x of (opts.styleRefs || []).slice(0, 4)) {
    if (!/^res_\w+$/.test(x.id) || !/^[\w.-]+$/.test(x.file)) continue;
    const src = resourcePath("reference", x.id, x.file);
    await fs.access(src).then(() => addRef(src, "style", { name: x.name || x.file, desc: "스타일·구도·색감만 참고 (소재·글자는 가져오지 않음)" }), () => {});
  }

  try {
    emit({ message: `Claude 가 소재를 바꿔 쓰는 중 (참조 ${refs.length}장, 1분 안팎)` });
    const { text, durationMs } = await askClaude(buildVariantPrompt(ad, im, refs, opts), { cwd: adDir });
    const v = {
      vid, image: im.file, created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000),
      inputs: { resources: opts.resources || {}, texts: opts.texts || "", elements: opts.elements || null, note: opts.note || "", idea: opts.idea || "", textsEdited: !!opts.textsEdited, placements: opts.placements || [], attachOriginal: !!opts.attachOriginal, attachFlipped: !!opts.attachFlipped, inspire: !!opts.inspire },
      refs: refs.map(({ n, role, label, file, name }) => ({ n, role, label, file, name })),
      // 글자 배치: 아이디어로 새로 쓴 경우는 Claude 가 낸 배치, 사용자가 편집기로 고친 경우는 그 배치
      ...extractJson(text), ...(opts.elements?.length && !(String(opts.idea || "").trim() && !opts.textsEdited) ? { text_elements: opts.elements } : {}), negative_en: NEGATIVE, negative_text_en: NEGATIVE_TEXT,
    };
    const cur = await readJson(path.join(adDir, "prompts.json"), pj);
    await writeJson(path.join(adDir, "prompts.json"), { ...cur, variants: [v, ...(cur.variants || [])] });
    emit({ message: `변형 완성: ${v.title || vid} (${v.took_s}초)` });
    return { dir: adDirName, vid };
  } catch (e) {
    await fs.rm(vdir, { recursive: true, force: true });
    throw e;
  }
}

export async function deleteVariant(brand, adDirName, vid) {
  if (!AD_DIR_RE.test(adDirName) || !/^v_\d+$/.test(vid)) throw new Error("잘못된 요청");
  const adDir = path.join(brandDir(brand), adDirName);
  const pj = await readJson(path.join(adDir, "prompts.json"), null);
  if (!pj) return;
  await writeJson(path.join(adDir, "prompts.json"), { ...pj, variants: (pj.variants || []).filter((v) => v.vid !== vid) });
  await fs.rm(path.join(adDir, "variants", vid), { recursive: true, force: true });
}

// ── 이미지 변형 에셋으로 저장 — 광고 수집 상세 창의 버튼 ──
// 이미지 프롬프트가 이미 있으면 바로 등록, 없으면 먼저 프롬프트를 만들고(createPrompts) 등록한다.
// 등록 = prompts.json 의 images[] 에 asset_at 을 적는다 → 이미지 변형 메뉴(/api/vary/assets)에 뜬다
export async function hasImagePrompts(brand, adDirName) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const pj = await readJson(path.join(brandDir(brand), adDirName, "prompts.json"), null);
  return !!pj?.images?.some((im) => im.image_prompt_en);
}
export async function registerVaryAsset(brand, adDirName, emit = () => {}) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const adDir = path.join(brandDir(brand), adDirName);
  const analyzed = !(await hasImagePrompts(brand, adDirName));
  if (analyzed) {
    const analysis = await readJson(path.join(adDir, "analysis.json"), null);
    if (!promptImages(analysis).length) throw new Error("이미지가 있는 광고만 이미지 변형 에셋으로 저장할 수 있습니다");
    emit({ message: "프롬프트 분석이 없어 먼저 이미지 프롬프트를 만듭니다" });
    await createPrompts(brand, adDirName, {}, emit);
  }
  const file = path.join(adDir, "prompts.json"), pj = await readJson(file, {});
  const now = new Date().toISOString();
  pj.images = (pj.images || []).map((im) => (im.image_prompt_en ? { ...im, asset_at: im.asset_at || now } : im));
  await writeJson(file, pj);
  const n = pj.images.filter((im) => im.asset_at).length;
  emit({ message: `이미지 변형 에셋으로 저장 (${n}장)` });
  return { dir: adDirName, asset: true, n, analyzed };
}

// ── 변형 추천 — 원본 광고 이미지 + 고른 브랜드 에셋(리소스)을 보고 바로 쓸 변형 아이디어 몇 개를 낸다 ──
// 결과는 prompts.json 의 suggestions[이미지 파일] 에 남는다. 아이디어 문장은 그대로 createVariant 의 idea 로 쓴다
export async function suggestVariants(brand, adDirName, { image, resources = {}, brief = "" } = {}, emit = () => {}) {
  if (!AD_DIR_RE.test(adDirName)) throw new Error("잘못된 광고 폴더");
  const adDir = path.join(brandDir(brand), adDirName);
  const pj = await readJson(path.join(adDir, "prompts.json"), null);
  const im = pj?.images?.find((x) => x.file === image);
  if (!im) throw new Error("먼저 이 이미지를 이미지 변형 에셋으로 저장하세요");
  // Claude 가 Read 로 볼 수 있게 고른 리소스 사진을 광고 폴더 안 임시 칸에 복사한다
  const tmp = path.join(adDir, "variants", `_suggest_${Date.now()}`);
  await fs.mkdir(tmp, { recursive: true });
  const assets = [];
  try {
    for (const kind of ["product", "person", "background"]) {
      const id = resources[kind]; if (!id) continue;
      const r = await resourceImage(kind, id);
      if (!r) continue;
      const rel = path.relative(adDir, path.join(tmp, `${kind}${path.extname(r.file).toLowerCase() || ".jpg"}`));
      await fs.copyFile(r.file, path.join(adDir, rel));
      assets.push({ kind: ROLE[kind], name: r.res.name, desc: [r.res.description, ...(r.res.tags || [])].filter(Boolean).join(" · "), file: rel });
    }
    emit({ message: `Claude 가 변형 아이디어를 고르는 중 (브랜드 에셋 ${assets.length}개, 1분 안팎)` });
    const { text } = await askClaude(`너는 퍼포먼스 광고 크리에이티브 디렉터다. 잘 되는 경쟁 광고 이미지 한 장을 우리 브랜드 소재로 바꾼 변형 아이디어를 낸다.
현재 폴더의 이미지를 Read 로 직접 본다: 원본 ${im.file}${assets.length ? `, 브랜드 에셋 ${assets.map((a) => a.file).join(", ")}` : ""}

[원본 광고]
- 장면: ${im.image_prompt_ko || im.image_prompt_en}
- 화면 글자: ${im.onscreen_text || "(없음)"}

[우리 브랜드 에셋 — 변형에 이것을 쓴다]
${assets.map((a) => `- ${a.kind}: ${a.name}${a.desc ? ` (${a.desc})` : ""} — ${a.file}`).join("\n") || "(고른 에셋 없음 — 원본 구조를 살린 일반 아이디어)"}
${brief.trim() ? `\n[요청 메모]\n${brief.trim()}\n` : ""}
[규칙]
1. 원본이 잘 되는 이유(구도·후킹 문구 구조·정보 배치)를 살리고, 소재와 카피를 우리 에셋에 맞게 바꾼다.
2. 아이디어 4개. 서로 방향이 달라야 한다 (예: 그대로 치환 / 혜택 강조 / 상황극 / 비교·전후).
3. idea 는 이미지 변형 작가에게 그대로 넘길 한국어 지시 2~3문장: 무엇을 무엇으로 바꾸는지, 새 헤드라인 문구(큰따옴표), 배경·색. 에셋에 없는 가격·혜택 숫자는 지어내지 말고 [혜택] 같은 빈칸으로 둔다.
4. 답은 JSON 하나만: { "items": [{ "title": "짧은 이름", "idea": "", "why": "왜 먹힐지 한 줄" }] }`, { cwd: adDir });
    const items = (extractJson(text).items || []).slice(0, 6).map((x) => ({ title: String(x.title || ""), idea: String(x.idea || ""), why: String(x.why || "") })).filter((x) => x.idea);
    const cur = await readJson(path.join(adDir, "prompts.json"), pj);
    cur.suggestions = { ...(cur.suggestions || {}), [im.file]: { at: new Date().toISOString(), resources, items } };
    await writeJson(path.join(adDir, "prompts.json"), cur);
    emit({ message: `변형 추천 ${items.length}개` });
    return { dir: adDirName, image: im.file, suggest: true, n: items.length };
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}
