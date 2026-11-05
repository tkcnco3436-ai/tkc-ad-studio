// 내 템플릿: 영상 템플릿의 분석값에서 "바꿀 수 있는 소재"(인물·배경·제품·소품·목소리·로고)를 한 장의 시트로 뽑고,
// 소재마다 내 이미지(캐릭터 시트·배경 사진·제품 사진)나 설정을 등록하면 그 소재로 장면별 영상 프롬프트를 다시 쓴다.
//   template.json 의 cast[] · my_prompts · <tpl>/cast/<이미지>
import fs from "node:fs/promises";
import path from "node:path";
import { askClaude, extractJson } from "./claude.js";
import { TEMPLATES_DIR, getTemplate, saveTemplate } from "./template.js";
import { resourceImage } from "./resources.js";
import { extOf } from "./manual.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { synthTo } from "./voice.js";

export const CAST_KINDS = ["인물", "배경", "제품", "소품", "목소리", "로고·브랜드"];
const tplDir = (id) => { if (!/^tpl_\w+$/.test(id)) throw new Error("잘못된 템플릿 ID"); return path.join(TEMPLATES_DIR, id); };

/** 템플릿 → 소재 시트 (이미 등록한 내 소재는 같은 id 면 남긴다) */
export async function buildCastSheet(id, emit = () => {}) {
  const t = await getTemplate(id);
  if (!t || t.kind) throw new Error("영상 템플릿만 소재 시트를 만들 수 있습니다");
  const slots = (t.slots || []).map((s) => ({ shot: s.shot, start: s.start, dur: s.dur, section: s.section, role: s.role, subject: s.subject, composition: s.composition, needs: s.resource_needs, example: s.example, frame: s.frame }));
  const step = Math.max(1, Math.ceil(slots.length / 20));
  const look = slots.filter((_, i) => i % step === 0 && slots[i].frame).map((s) => `frames/${s.frame}`);
  emit({ message: `Claude 가 컷 ${slots.length}개에서 바꿀 소재를 뽑는 중 (1~2분)` });
  const { text, durationMs } = await askClaude(`너는 광고 프로덕션 PD다. 아래 영상 템플릿을 내 소재로 다시 찍기 위해, 바꿀 수 있는 소재를 "소재 시트"로 정리한다.
현재 폴더의 프레임을 Read 로 직접 본다: ${look.join(", ")}

[템플릿] ${t.name} — ${t.summary || ""}
[컷] ${JSON.stringify(slots)}

[규칙]
1. 같은 대상은 하나로 묶는다 (같은 인물이 여러 컷에 나오면 한 줄, shots 에 컷 번호를 모두).
2. kind 는 다음 중 하나: ${CAST_KINDS.join(", ")}. 화면에 보이는 것 위주로, 목소리(내레이션·대사 화자)도 포함.
3. original: 원본에서 이 소재가 어떻게 보이는지 구체적으로 (나이대·성별·옷·헤어 / 장소·색감·조명 / 제품 형태·색).
4. fields: 내가 바꿀 때 채울 칸 2~4개 (예: 인물 → 나이·성별, 헤어·메이크업, 의상 / 배경 → 장소, 색감·조명 / 제품 → 제품명, 형태·색). original 에는 원본 값.
5. register: 이 소재를 일관되게 만들려면 무엇을 등록하면 좋은지 한 줄 (예: 정면·측면·전신이 담긴 캐릭터 시트 1장).
6. frame: 이 소재가 가장 잘 보이는 컷의 frame 파일명 그대로.
7. 답은 아래 JSON 하나만.

{ "cast": [{ "id": "c1", "kind": "인물", "name": "인물 A — 40대 여성(엄마)", "original": "", "shots": [1, 2], "frame": "", "fields": [{ "key": "나이·성별", "original": "" }], "register": "" }] }`, { cwd: tplDir(id) });
  const out = extractJson(text);
  const prev = new Map((t.cast || []).map((c) => [c.id, c]));
  const cast = (out.cast || []).map((c, i) => ({ ...c, id: c.id || `c${i + 1}`, ...(prev.get(c.id)?.mine ? { mine: prev.get(c.id).mine } : {}) }));
  await saveTemplate(id, { cast });
  emit({ message: `소재 ${cast.length}개를 뽑았습니다 (${Math.round(durationMs / 1000)}초)` });
  return { id };
}

/** 소재에 내 이미지 등록 (올린 파일을 템플릿 cast/ 로 옮긴다). file=null 이면 뺀다 */
export async function setCastImage(id, cid, upload) {
  const t = await getTemplate(id);
  const c = t?.cast?.find((x) => x.id === cid);
  if (!c) throw new Error("소재가 없습니다");
  const dir = path.join(tplDir(id), "cast");
  await fs.mkdir(dir, { recursive: true });
  if (c.mine?.image) await fs.rm(path.join(tplDir(id), c.mine.image), { force: true });
  let image = null;
  if (upload) {
    const ext = extOf(upload.name);
    if (!/^(jpe?g|png|webp|gif)$/.test(ext)) throw new Error("이미지만 등록할 수 있습니다");
    image = `cast/${cid}_${Date.now()}.${ext}`;
    await fs.copyFile(upload.tmp, path.join(tplDir(id), image));
  }
  c.mine = { ...(c.mine || {}), image };
  if (!image) delete c.mine.image;
  return saveTemplate(id, { cast: t.cast });
}

/** 내 소재(이미지·설정)로 장면별 영상 프롬프트를 다시 쓴다. opts = { topic } */
export async function makeMyPrompts(id, { topic = "" } = {}, emit = () => {}) {
  const t = await getTemplate(id);
  if (!t?.cast?.length) throw new Error("먼저 소재 시트를 만드세요");
  const script = t.my_script?.lines?.length ? t.my_script : null; // 3단계에서 쓴 대본이 있으면 그대로 쓴다
  if (script && !topic) topic = script.topic || script.product || "";
  // 참조 이미지: 직접 올린 것, 없으면 리소스에서 고른 것 (리소스는 cast/ 로 복사해 Read 할 수 있게)
  const refs = [];
  for (const c of t.cast) {
    let file = c.mine?.image || null;
    if (!file && c.mine?.resource) {
      const r = await resourceImage(c.mine.resource.kind, c.mine.resource.id).catch(() => null);
      if (r) {
        file = `cast/res_${c.id}${path.extname(r.file).toLowerCase() || ".jpg"}`;
        await fs.mkdir(path.join(tplDir(id), "cast"), { recursive: true });
        await fs.copyFile(r.file, path.join(tplDir(id), file));
      }
    }
    if (file) refs.push({ n: refs.length + 1, cid: c.id, name: c.name, file });
  }
  const castLines = t.cast.map((c) => {
    const ref = refs.find((r) => r.cid === c.id);
    const fields = (c.fields || []).map((f) => `${f.key}: ${c.mine?.fields?.[f.key] || `(원본 유지: ${f.original})`}`).join(" / ");
    return `- ${c.id} ${c.name} [${c.kind}] 컷 ${(c.shots || []).join(",")}
  원본: ${c.original}
  내 소재: ${ref ? `참조 이미지 ${ref.n}번 (${ref.file})` : "이미지 없음"}${c.mine?.desc ? ` · 설명: ${c.mine.desc}` : ""} · ${fields}${c.mine?.keep ? " · 원본 그대로" : ""}`;
  }).join("\n");
  const slots = (t.slots || []).map((s) => ({ shot: s.shot, start: s.start, dur: s.dur, section: s.section, role: s.role, shot_type: s.shot_type, composition: s.composition, camera: s.camera, audio: s.audio, example: s.example, frame: s.frame ? `frames/${s.frame}` : "" }));
  const look = slots.filter((x) => x.frame).slice(0, 8).map((x) => x.frame);
  emit({ message: `Claude 가 내 소재 ${refs.length}장으로 장면 ${slots.length}개 프롬프트를 쓰는 중 (1~3분)` });
  const { text, durationMs } = await askClaude(`너는 AI 영상 프롬프트 작가다. 원본 영상의 분위기(조명·색감·심도·구도·카메라)를 그대로 지키면서 소재만 "내 소재"로 바꾸는 프롬프트를 쓴다.
방식: 컷마다 ① 원본 프레임을 편집해 시작 프레임을 만들고(이미지 편집 모델) ② 그 시작 프레임을 움직여 영상을 만든다(이미지→영상). 장면을 처음부터 새로 그리지 않는다.
원본 프레임과 내 소재 이미지를 Read 로 직접 본다: 원본 ${look.join(", ")}${refs.length ? ` / 내 소재 ${refs.map((r) => `${r.cid}=${r.file}`).join(", ")}` : ""}

[템플릿] ${t.name} — ${t.summary || ""} (${t.format?.width}x${t.format?.height}, ${t.format?.aspect}, ${t.format?.duration_s}초)
[소재 시트]
${castLines}
[컷] ${JSON.stringify(slots)}
${script ? `[확정 대본] 컷마다 아래 대사(voiceover)·화면 글자(onscreen_text)를 글자 하나 바꾸지 말고 그대로 넣는다. 입 모양·표정은 이 대사에 맞춘다.\n${JSON.stringify(script.lines.map((l) => ({ shot: l.shot, voiceover: l.voiceover, onscreen_text: l.onscreen_text })))}` : topic ? `[새 제품·주제] ${topic} — 화면 글자·대사·내레이션을 이 주제로 새로 쓴다. 원본 형식(질문형·반복 등)과 길이는 유지한다. 확인 안 된 수치·효능은 쓰지 않는다.` : "[화면 글자·대사] 원본 형식 그대로, 소재 이름만 바꾼다."}

[규칙]
1. 컷 하나 = 장면 하나. shot·start·dur 는 그대로.
2. assets: 그 컷에서 바꿀 소재 id 목록 (이미지가 있는 소재만, 그 컷에 실제로 나오는 것만, 최대 3개). 첨부 순서는 image 1 = 그 컷의 원본 프레임, image 2·3·4 = assets 순서다.
3. frame_edit_en (시작 프레임 — 이미지 편집 모델용): "Edit image 1." 로 시작한다. 먼저 유지할 것을 쓴다 — "Keep the exact camera angle, framing, crop, lens and depth of field, lighting direction and color grade, and overall mood of image 1." 그다음 바꿀 것만 짧게 쓴다 — 예: "Replace the woman with the man from image 2 (same pose and position). Replace the background wall and decor with the room from image 3, re-lit to match image 1's warm side light." 바꿀 소재의 생김새는 글로 다시 묘사하지 않고 이미지 번호로만 가리킨다. 원본 화면 글자·자막·로고는 지운다.
3-1. 인물을 바꿀 때는 얼굴·헤어·체형뿐 아니라 **의상·액세서리까지 모두 내 소재 이미지(캐릭터 시트)를 따른다** — 예: "Replace the woman with the man from image 2, including his outfit and accessories exactly as in image 2 (same pose and position)." 원본 인물의 옷·액세서리를 남기지 않는다 ("Keep image 1's shirt" 같은 문장 금지). 단, 그 인물 소재 칸에 의상 설정을 적었으면 그 글을 따르고, "원본 그대로 두기"면 원본 인물을 그대로 둔다. 원본에서 유지하는 것은 구도·카메라·조명·색감·심도·자세뿐이다.
4. 이미지가 없고 설정만 있는 소재는 frame_edit_en 에서 설정대로 짧게 바꾼다 (예: "Change his shirt to a navy knit sweater"). 아무것도 없는 소재는 원본 그대로 둔다.
5. motion_en (영상 — 이미지→영상 모델용, 시작 프레임을 넣고 돌린다): 장면·인물·배경을 다시 묘사하지 않는다. 컷 길이 안의 움직임·표정·입 모양(말하는지)·카메라 움직임만 1~3문장. 끝에 "Keep the look, lighting and colors of the start frame unchanged." 를 붙인다.
6. style: 원본 프레임에서 본 공통 룩 (조명·색온도·대비·심도·렌즈 느낌) 한두 문장 — 모든 컷이 이 룩을 지킨다.
7. 글자·자막·로고는 그리지 않는다. 화면 글자는 onscreen_text 로 따로.
8. 답은 아래 JSON 하나만.

{ "style": "", "scenes": [{ "shot": 1, "start": 0, "dur": 0, "assets": ["c1"], "frame_edit_en": "", "motion_en": "", "prompt_ko": "두 프롬프트의 한국어 요약", "onscreen_text": "", "voiceover": "" }], "notes": "" }`, { cwd: tplDir(id) });
  const out = extractJson(text);
  // 컷마다 첨부 파일 순서를 정해 둔다: 원본 프레임 → 그 컷의 내 소재
  const byCid = Object.fromEntries(refs.map((r) => [r.cid, r.file]));
  const frameOf = Object.fromEntries((t.slots || []).map((s) => [s.shot, s.frame ? `frames/${s.frame}` : null]));
  const lineOf = Object.fromEntries((script?.lines || []).map((l) => [l.shot, l]));
  out.scenes = (out.scenes || []).map((x) => ({ ...x, ...(lineOf[x.shot] ? { voiceover: lineOf[x.shot].voiceover, onscreen_text: lineOf[x.shot].onscreen_text } : {}), edit_files: [frameOf[x.shot], ...(x.assets || []).map((c) => byCid[c])].filter(Boolean), video_prompt_en: x.motion_en, start_frame_prompt_en: x.frame_edit_en }));
  const my_prompts = { topic, refs, method: "frame_edit", created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000), ...out };
  await saveTemplate(id, { my_prompts });
  emit({ message: `내 소재 프롬프트 완성 (${my_prompts.took_s}초)` });
  return { id };
}

// ── 주제·대본 ──
// 원본 컷 구조(길이·역할·대사 패턴·화면 글자 패턴)는 그대로 두고, 내 주제로 컷마다 대사·화면 글자를 새로 쓴다.
// 저장: template.json 의 my_script = { topic, product, target, message, tone, notes, title, hook, cta, lines: [{ shot, start, dur, section, orig_speech, orig_text, voiceover, onscreen_text }] }
const brief = (inp) => [
  inp.product && `제품·서비스: ${inp.product}`, inp.target && `누구에게: ${inp.target}`, inp.message && `꼭 전할 말·혜택: ${inp.message}`,
  inp.tone && `톤: ${inp.tone}`, inp.notes && `참고·금지: ${inp.notes}`,
].filter(Boolean).join("\n");
const scriptSlots = (t) => (t.slots || []).map((s) => ({
  shot: s.shot, start: s.start, dur: s.dur, section: s.section, role: s.role,
  speech_pattern: s.audio?.pattern || "", speech_type: s.audio?.type || "", text_pattern: s.text_overlay?.pattern || "",
  orig_speech: s.example?.speech || "", orig_text: s.example?.onscreen_text || "",
}));

/** 주제 추천 (저장하지 않는다) → { ideas: [{ topic, hook, angle }] } */
export async function suggestMyTopics(id, inp = {}) {
  const t = await getTemplate(id);
  if (!t) throw new Error("템플릿이 없습니다");
  const { text } = await askClaude(`너는 숏폼 광고 기획자다. 아래 영상 템플릿의 형식(훅 방식·구조)을 그대로 살려 찍을 수 있는 영상 주제 5개를 제안한다.
[템플릿] ${t.name} — ${t.summary || ""} / 훅: ${t.hook_type || ""} / 톤: ${t.tone || ""} / ${t.format?.duration_s || "?"}초 ${t.slots?.length || 0}컷
[구조] ${JSON.stringify((t.structure || []).slice(0, 12))}
[원본 컷 대사 예] ${scriptSlots(t).map((x) => x.orig_speech).filter(Boolean).slice(0, 6).join(" / ")}
${brief(inp) ? `[내 정보]\n${brief(inp)}` : "[내 정보] 없음 — 템플릿 형식에 잘 맞는 일반 주제로."}
규칙: 주제마다 이 템플릿 첫 컷(훅)에 들어갈 한 문장을 같이 쓴다. 확인 안 된 수치·효능은 쓰지 않는다. 사람에게 묻지 말 것.
답은 JSON 하나만: { "ideas": [{ "topic": "주제 한 줄", "hook": "첫 컷 대사·화면 글자", "angle": "왜 이 형식에 맞는지 한 줄" }] }`, { timeoutMs: 4 * 60_000 });
  return extractJson(text);
}

/** 컷별 대본 쓰기 → my_script 저장 */
export async function makeMyScript(id, inp = {}, emit = () => {}) {
  const t = await getTemplate(id);
  if (!t) throw new Error("템플릿이 없습니다");
  if (!String(inp.topic || inp.product || "").trim()) throw new Error("주제나 제품을 적으세요");
  const slots = scriptSlots(t);
  emit({ message: `Claude 가 컷 ${slots.length}개 대본을 쓰는 중 (1~2분)` });
  const { text, durationMs } = await askClaude(`너는 숏폼 광고 카피라이터다. 원본 영상의 컷 구조와 말투 패턴을 그대로 따라, 내 주제로 컷마다 대사(voiceover)와 화면 글자(onscreen_text)를 새로 쓴다.
[템플릿] ${t.name} — ${t.summary || ""} / 훅: ${t.hook_type || ""} / 톤: ${t.tone || ""} / ${t.format?.duration_s || "?"}초
[주제] ${inp.topic || inp.product}
${brief(inp)}
[컷] ${JSON.stringify(slots)}

[규칙]
1. 컷 수·shot·start·dur 는 그대로. 컷마다 하나씩.
2. speech_pattern·text_pattern(원본의 말 형식)을 따른다 — 질문형이면 질문형, 반복이면 반복. orig_speech·orig_text 는 형식 참고용이고 내용은 내 주제로 바꾼다.
3. 대사 길이는 컷 길이에 맞춘다 — 한국어 기준 1초에 4~5음절 안쪽. 원본에 대사가 없던 컷(speech_type 이 음악·없음 등)은 voiceover 를 비운다.
4. 화면 글자는 짧게(한 줄 12자 안팎, 최대 2줄). 원본에 화면 글자가 없던 컷은 비운다.
5. 확인 안 된 수치·효능·최상급 표현("1위", "100%")은 쓰지 않는다. 내 정보에 있는 사실만 쓴다.
6. title: 영상 제목 한 줄. hook: 첫 컷이 잡는 포인트. cta: 마지막 행동 유도 한 줄.
7. 답은 JSON 하나만.

{ "title": "", "hook": "", "cta": "", "lines": [{ "shot": 1, "voiceover": "", "onscreen_text": "" }], "notes": "" }`, { timeoutMs: 6 * 60_000 });
  const out = extractJson(text);
  const by = Object.fromEntries((out.lines || []).map((x) => [Number(x.shot), x]));
  const lines = slots.map((s) => ({ shot: s.shot, start: s.start, dur: s.dur, section: s.section, orig_speech: s.orig_speech, orig_text: s.orig_text,
    voiceover: String(by[s.shot]?.voiceover || ""), onscreen_text: String(by[s.shot]?.onscreen_text || "") }));
  const my_script = { ...pickInputs(inp), title: out.title || "", hook: out.hook || "", cta: out.cta || "", ai_notes: out.notes || "", lines, created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000) };
  await saveTemplate(id, { my_script });
  emit({ message: `대본 완성 (${my_script.took_s}초)` });
  return { id, script: true };
}
const pickInputs = (inp) => Object.fromEntries(["topic", "product", "target", "message", "tone", "notes"].map((k) => [k, String(inp[k] || "").trim()]));

/** 화면에서 고친 대본 저장 (입력값·제목·컷별 대사·화면 글자) */
export async function saveMyScript(id, data = {}) {
  const t = await getTemplate(id);
  if (!t) throw new Error("템플릿이 없습니다");
  const cur = t.my_script || { lines: [] };
  const edits = Object.fromEntries((data.lines || []).map((x) => [Number(x.shot), x]));
  const lines = (cur.lines || []).map((l) => edits[l.shot] ? { ...l, voiceover: String(edits[l.shot].voiceover ?? l.voiceover), onscreen_text: String(edits[l.shot].onscreen_text ?? l.onscreen_text) } : l);
  const my_script = { ...cur, ...pickInputs({ ...cur, ...data }), ...Object.fromEntries(["title", "hook", "cta"].filter((k) => typeof data[k] === "string").map((k) => [k, data[k]])), lines, updated_at: new Date().toISOString() };
  return saveTemplate(id, { my_script });
}

// ── 목소리: 대본 대사를 고른 목소리로 컷마다 읽히고, 컷 시작 시각에 맞춰 한 줄 내레이션(my/narration.wav)으로 잇는다 ──
// voice 값은 /api/voice/choices 의 id (res:… · qwen3:profile:… · qwen3:speaker:…). shot 을 주면 그 컷만 다시 만든다.
const run = promisify(execFile);
export async function makeMyVoice(id, { voice, voiceName = "", shot = null } = {}, emit = () => {}) {
  const t = await getTemplate(id);
  const lines = (t?.my_script?.lines || []).filter((l) => String(l.voiceover || "").trim());
  if (!lines.length) throw new Error("먼저 3단계에서 대본을 쓰세요 (대사가 있는 컷이 없습니다)");
  if (!voice) throw new Error("목소리를 고르세요");
  const dir = tplDir(id), prev = t.my_voice?.voice === voice ? t.my_voice : null; // 목소리를 바꾸면 전부 새로
  await fs.mkdir(path.join(dir, "my"), { recursive: true });
  const done = Object.fromEntries((prev?.lines || []).map((x) => [x.shot, x]));
  const todo = lines.filter((l) => shot == null ? true : l.shot === Number(shot));
  for (const [i, l] of todo.entries()) {
    emit({ message: `컷 ${l.shot} 읽히는 중 (${i + 1}/${todo.length})` });
    const file = `my/voice_shot${l.shot}_${Date.now()}.wav`;
    const dur = await synthTo(voice, l.voiceover, path.join(dir, file));
    if (done[l.shot]?.file) await fs.rm(path.join(dir, done[l.shot].file), { force: true });
    done[l.shot] = { shot: l.shot, file, dur: Math.round(dur * 100) / 100, cut_dur: +l.dur || 0, start: +l.start || 0, text: l.voiceover };
  }
  // 대본에서 빠진 컷은 버린다
  const keep = lines.map((l) => done[l.shot]).filter(Boolean);
  for (const x of Object.values(done)) if (!keep.includes(x)) await fs.rm(path.join(dir, x.file), { force: true });
  emit({ message: "컷 시작 시각에 맞춰 내레이션 한 줄로 잇는 중" });
  const total = Number(t.format?.duration_s) || Math.max(...keep.map((x) => x.start + x.dur)) + 0.5;
  const track = "my/narration.wav";
  const args = ["-y", "-v", "error"];
  keep.forEach((x) => args.push("-i", path.join(dir, x.file)));
  const chains = keep.map((x, i) => `[${i}:a]aresample=24000,adelay=${Math.round(x.start * 1000)}:all=1[a${i}]`);
  args.push("-filter_complex", `${chains.join(";")};${keep.map((_, i) => `[a${i}]`).join("")}amix=inputs=${keep.length}:normalize=0,apad,atrim=0:${Math.max(total, ...keep.map((x) => x.start + x.dur)).toFixed(2)}[out]`,
    "-map", "[out]", "-ac", "1", path.join(dir, track));
  await run("ffmpeg", args, { maxBuffer: 1 << 24 });
  const my_voice = { voice, voice_name: voiceName || prev?.voice_name || voice, lines: keep, track, updated_at: new Date().toISOString() };
  await saveTemplate(id, { my_voice });
  emit({ message: `내레이션 완성 — 컷 ${keep.length}개` });
  return { id, voice: true };
}

/** 내 템플릿의 컷별 결과(시작 프레임·영상) 저장. field = "frame" | "video" */
export async function setMyMedia(id, shot, field, src, name) {
  if (!["frame", "video"].includes(field)) throw new Error("잘못된 칸");
  const t = await getTemplate(id);
  if (!t) throw new Error("템플릿이 없습니다");
  const ext = (path.extname(name) || (field === "video" ? ".mp4" : ".png")).toLowerCase();
  if (field === "video" ? !/^\.(mp4|mov|webm|m4v)$/.test(ext) : !/^\.(jpe?g|png|webp)$/.test(ext)) throw new Error(`이 칸에 넣을 수 없는 파일입니다: ${name}`);
  const file = `my/shot${shot}_${field}_${Date.now()}${ext}`;
  await fs.mkdir(path.join(tplDir(id), "my"), { recursive: true });
  const media = t.my_media || {};
  const cur = media[shot]?.[field];
  if (cur) await fs.rm(path.join(tplDir(id), cur), { force: true });
  await fs.copyFile(src, path.join(tplDir(id), file));
  media[shot] = { ...(media[shot] || {}), [field]: file };
  return saveTemplate(id, { my_media: media });
}
