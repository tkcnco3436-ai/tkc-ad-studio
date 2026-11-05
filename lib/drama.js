// 드라마 릴스: 상황극·시트콤형 릴스에서 "이야기 구조"(인물·비트·반복 개그·반전·제품이 들어오는 방식)를 뽑아 템플릿으로 저장하고,
// 제품·주제만 넣으면 같은 구조로 새 대본(장면·대사·자막·시간)을 쓴다.
//   <DATA_DIR>/_templates/<tpl_ID>/template.json (kind: "drama") · cover.jpg · contact_sheet.jpg · source.mp4 · frames/
//   <DATA_DIR>/_templates/<tpl_ID>/scripts/<s_ID>/script.json
import fs from "node:fs/promises";
import path from "node:path";
import { askClaude, extractJson } from "./claude.js";
import { brandDir, readJson, writeJson } from "./store.js";
import { TEMPLATES_DIR, getTemplate } from "./template.js";
import { listKits, kitBrief } from "./cardnews.js";

const BEATS = ["훅", "설정", "갈등", "반복", "고조", "반전", "해결", "제품 공개", "CTA"];
const MAX_FRAMES = 30;

function buildAnalyzePrompt(ad, video) {
  const shots = video.shots.map((s) => ({ shot: s.shot, start: s.start, dur: s.dur, frame: s.frame, onscreen_text: s.onscreen_text || "", speech: s.speech || "" }));
  const step = Math.max(1, Math.ceil(shots.length / MAX_FRAMES));
  const look = shots.filter((_, i) => i % step === 0).map((s) => s.frame);
  return `너는 숏폼 드라마·상황극 작가다. 아래 릴스를 "다른 제품·주제로 다시 찍을 수 있는 이야기 틀"로 정리한다.
현재 폴더의 프레임 이미지를 Read 로 직접 본다: ${look.join(", ")}

[영상] 길이 ${video.spec.duration_s}초 · ${video.spec.width}x${video.spec.height} (${video.spec.aspect})
[본문] ${(ad.body_text || ad.title || "").slice(0, 600)}
[컷 목록 — 화면 글자는 OCR, 대사는 자동 인식이라 오타가 있다]
${JSON.stringify(shots)}
${video.speech?.length ? `[전체 대사(자동 인식, 초)]\n${video.speech.map((x) => `${x.start}-${x.end} ${x.text}`).join("\n").slice(0, 3000)}` : ""}

[규칙]
1. 컷 번호·시간은 위 값을 쓴다. 지어내지 않는다.
2. beat 는 다음 중 하나: ${BEATS.join(", ")}. 이야기가 실제로 꺾이는 지점마다 하나씩 (컷 여러 개를 묶어도 된다).
3. 인물·브랜드·제품 이름은 일반화한다(인물 A, [제품]). 원래 대사는 example_dialogue 에만 둔다.
4. 웃음·몰입이 생기는 장치(반복, 엇박자 대답, 예상 뒤집기, 정적, 리액션 컷)를 구체적으로 적는다. 몇 초에 무엇이 터지는지 timing 에 적는다.
5. 확인이 안 되는 건 빈 문자열, 추측이면 notes 에 "추정".
6. 답은 아래 JSON 하나만.

{
  "name": "템플릿 이름 (구조가 드러나게, 예: '가족 문답 반복 → 마지막에 묻는 사람도 같은 대답')",
  "summary": "이 이야기가 어떻게 작동하는지 2~3문장",
  "logline_pattern": "[누가] [어떤 상황]에서 [무엇이 반복·충돌] → [반전] → [제품이 답]",
  "genre": "가족극 | 직장물 | 연애 | 친구 | 1인 독백 | 패러디 | 기타",
  "hook_type": "", "tone": "",
  "characters": [{ "id": "A", "role": "이야기 속 역할 (묻는 사람 등)", "archetype": "성격·유형", "relation": "다른 인물과의 관계", "look": "외형 (일반화)", "voice": "말투" }],
  "beats": [{
    "n": 1, "beat": "", "start": 0, "end": 0, "shots": [1],
    "what": "무엇이 일어나는지 (일반화)", "dialogue_pattern": "대사의 형식 (예: '아직도 [제품]이야?' 같은 질문)",
    "example_dialogue": "원래 대사", "camera": "구도·카메라", "purpose": "이 비트가 하는 일"
  }],
  "running_gag": "반복 장치", "twist": "반전 장치", "product_role": "제품이 이야기에 들어오는 방식",
  "dialogue_style": "", "timing": "몇 초에 무엇이 터지는지", "sound": "음악·효과음",
  "copy_patterns": ["반복되는 대사·자막 공식"], "notes": ""
}`;
}

/** 분석된 영상(릴스·광고) → 드라마 템플릿 */
// 광고 상세의 [템플릿으로 저장] 하나로 합쳤다 — 영상이 상황극형(drama)인지 광고형(ad)인지 Claude 가 컷 글자·대사·컷 프레임 모음을 보고 고른다
export async function guessVideoStyle(brand, adDirName) {
  const adDir = path.join(brandDir(brand), adDirName);
  const ad = await readJson(path.join(adDir, "ad.json"), {});
  const video = (await readJson(path.join(adDir, "analysis.json"), {}))?.videos?.[0];
  if (!video) return "ad";
  const shots = (video.shots || []).slice(0, 40).map((s) => ({ dur: s.dur, text: s.onscreen_text || "", speech: s.speech || "" }));
  const prompt = `아래 숏폼 영상이 어느 쪽인지 하나만 고른다.
- drama: 인물이 연기하는 상황극·시트콤·스토리 (등장인물·대사·갈등·반전이 있다)
- ad: 제품 소개·후기·정보 나열형 광고 (후킹 → 장점 → 혜택 → CTA)
${video.contact_sheet ? `현재 폴더의 컷 프레임 모음을 Read 로 본다: ${video.contact_sheet}\n` : ""}[본문] ${(ad.body_text || ad.title || "").slice(0, 400)}
[컷] ${JSON.stringify(shots)}
JSON 하나만 답한다: {"style":"drama" 또는 "ad","why":"한 줄"}`;
  try { return extractJson((await askClaude(prompt, { cwd: adDir, timeoutMs: 3 * 60_000 })).text).style === "drama" ? "drama" : "ad"; }
  catch { return "ad"; }
}

export async function createDramaTemplate(brand, adDirName, emit = () => {}) {
  const adDir = path.join(brandDir(brand), adDirName);
  const ad = await readJson(path.join(adDir, "ad.json"), null);
  const analysis = await readJson(path.join(adDir, "analysis.json"), null);
  const video = analysis?.videos?.[0];
  if (!ad || !video) throw new Error("영상 분석 결과가 없는 광고입니다");
  emit({ message: `Claude 가 컷 ${video.shots.length}개로 이야기 구조를 보는 중 (1~3분)` });
  const { text, durationMs } = await askClaude(buildAnalyzePrompt(ad, video), { cwd: adDir });
  const tpl = extractJson(text);
  emit({ message: `드라마 구조 정리 완료 (${Math.round(durationMs / 1000)}초)` });

  const id = `tpl_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const dir = path.join(TEMPLATES_DIR, id);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  for (const s of video.shots) await fs.copyFile(path.join(adDir, s.frame), path.join(dir, "frames", path.basename(s.frame))).catch(() => {});
  await fs.copyFile(path.join(adDir, video.contact_sheet), path.join(dir, "contact_sheet.jpg")).catch(() => {});
  const sourceVideo = `source${path.extname(video.file) || ".mp4"}`;
  await fs.copyFile(path.join(adDir, video.file), path.join(dir, sourceVideo));
  const coverSrc = ad.files?.poster || video.shots[0]?.frame;
  if (coverSrc) await fs.copyFile(path.join(adDir, coverSrc), path.join(dir, "cover.jpg")).catch(() => {});
  const full = {
    id, kind: "drama", ...tpl,
    format: { duration_s: video.spec.duration_s, width: video.spec.width, height: video.spec.height, aspect: video.spec.aspect, shot_count: video.shots.length },
    shots: video.shots.map((s) => ({ shot: s.shot, start: s.start, dur: s.dur, frame: path.basename(s.frame) })),
    media: { video: sourceVideo, cover: coverSrc ? "cover.jpg" : null },
    source: { brand: brand.name, brand_id: brand.id, ad_dir: adDirName, library_id: ad.library_id, platform: ad.platform, url: ad.source_url || ad.landing_url || null },
    created_at: new Date().toISOString(),
  };
  await writeJson(path.join(dir, "template.json"), full);
  return { id, kind: "drama" };
}

// ── 대본 쓰기 ──
function buildScriptPrompt(t, { product, topic, details, cast, length, kit }) {
  const L = Number(length) || t.format?.duration_s || 30;
  return `너는 숏폼 드라마 작가다. 아래 이야기 틀의 비트 순서·반복 장치·반전·제품이 들어오는 방식을 그대로 지키고, 새 제품·주제로 대본을 쓴다.

[이야기 틀] ${t.name}
- 요약: ${t.summary || ""}
- 로그라인 공식: ${t.logline_pattern || ""}
- 인물: ${JSON.stringify(t.characters || [])}
- 비트(원본 ${t.format?.duration_s || "?"}초 기준): ${JSON.stringify((t.beats || []).map(({ example_dialogue, ...b }) => ({ ...b, example_dialogue })))}
- 반복 장치: ${t.running_gag || ""} / 반전: ${t.twist || ""} / 제품 역할: ${t.product_role || ""}
- 대사 스타일: ${t.dialogue_style || ""} / 타이밍: ${t.timing || ""} / 소리: ${t.sound || ""}

[새 대본]
- 제품·서비스: ${product}
- 주제·전할 메시지: ${topic || "(제품의 핵심 장점 하나)"}
- 참고 사실: ${details || "(없음 — 확인 안 된 수치·효능·가격은 쓰지 않는다. 필요한 자리는 [수치]로 비운다)"}
- 등장인물 설정: ${cast || "(틀의 인물 구성을 따르고, 제품에 맞게 나이·관계를 정한다)"}
- 길이: ${L}초 (비트 시간을 이 길이에 맞게 비례로 줄이거나 늘린다)
${kit ? `- 브랜드: ${kitBrief(kit).replace(/\n/g, " · ")}` : ""}

[규칙]
1. 비트 순서와 장치는 틀을 따른다. 원본 대사·인물 이름·사실은 가져오지 않는다.
2. 대사는 한국어 구어체. 한 장면의 대사 길이는 그 장면 길이에 맞춘다 (1초에 4~5음절 안팎).
3. 인물마다 look_en 에 영상 생성용 영어 외형 묘사를 쓰고, 모든 장면에서 같은 사람이 되게 한다. 실존 인물·연예인을 닮게 하지 않는다.
4. 제품은 product_role 방식대로 자연스럽게 들어오고, 과장 광고·의료 효능 표현은 쓰지 않는다.
5. start·dur 는 초. 마지막 장면 끝이 ${L}초.
6. 답은 아래 JSON 하나만.

{
  "title": "", "logline": "",
  "characters": [{ "id": "A", "name": "", "desc": "한국어 설정 (나이·관계·성격)", "look_en": "", "voice": "목소리·말투" }],
  "scenes": [{
    "n": 1, "beat": "", "start": 0, "dur": 0, "location": "",
    "action": "화면에서 일어나는 일 (카메라에 보이는 것)",
    "dialogue": [{ "who": "A", "line": "" }],
    "onscreen_text": "자막·화면 글자", "camera": "", "sound": "", "product_moment": "제품이 나오면 어떻게"
  }],
  "caption": "게시물 본문 (해시태그 포함)",
  "notes": "찍을 때 주의할 점"
}`;
}

/** opts = { product, topic, details, cast, length, kitId } */
export async function makeScript(id, opts, emit = () => {}) {
  const t = await getTemplate(id);
  if (!t || t.kind !== "drama") throw new Error("드라마 템플릿이 아닙니다");
  if (!String(opts.product || "").trim()) throw new Error("제품·서비스를 적으세요");
  const kit = opts.kitId ? (await listKits()).find((k) => k.id === opts.kitId) : null;
  const sid = `s_${Date.now()}`;
  emit({ message: `Claude 가 "${opts.product}" 드라마 대본을 쓰는 중 (1~2분)` });
  const { text, durationMs } = await askClaude(buildScriptPrompt(t, { ...opts, kit }), { cwd: path.join(TEMPLATES_DIR, id) });
  const out = extractJson(text);
  const script = {
    sid, product: opts.product.trim(), topic: String(opts.topic || "").trim(), details: String(opts.details || "").trim(),
    cast: String(opts.cast || "").trim(), length_s: Number(opts.length) || t.format?.duration_s || null,
    ...(kit ? { kit: { id: kit.id, name: kit.name } } : {}),
    created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000), ...out,
  };
  const dir = path.join(TEMPLATES_DIR, id, "scripts", sid);
  await fs.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "script.json"), script);
  emit({ message: `대본 완성: ${script.title || sid} (${script.took_s}초)` });
  return { id, sid };
}

export async function listAllScripts() {
  const out = [];
  for (const id of (await fs.readdir(TEMPLATES_DIR).catch(() => [])).filter((n) => /^tpl_\w+$/.test(n))) {
    const base = path.join(TEMPLATES_DIR, id, "scripts");
    for (const n of await fs.readdir(base).catch(() => [])) {
      const s = await readJson(path.join(base, n, "script.json"), null);
      if (s) out.push({ ...s, tpl_id: id });
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function deleteScript(id, sid) {
  if (!/^tpl_\w+$/.test(id) || !/^s_\d+$/.test(sid)) throw new Error("잘못된 ID");
  await fs.rm(path.join(TEMPLATES_DIR, id, "scripts", sid), { recursive: true, force: true });
}
