// 힉스필드 연동 — 두 갈래:
//   mcp: 이 PC 의 Claude Code 에 연결된 힉스필드 MCP 를 claude -p 로 부른다 (구독 계정의 힉스필드 로그인 그대로)
//   api: 힉스필드 공개 API (https://api.higgsfield.ai, Authorization: Key ID:SECRET) 를 직접 부른다
// 어느 쪽이든 참조 이미지를 올리고 → 생성 요청 → 끝날 때까지 기다리고 → 결과 파일을 내려받아 돌려준다.
// 크레딧이 드는 일이라 화면에서 매번 확인을 받은 뒤에만 부른다.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { askClaude, extractJson } from "./claude.js";
import { DATA_DIR, readJson, writeJson } from "./store.js";
import { CONFIG_DIR } from "./config.js";
import { imageParams, videoParams } from "./hfmodels.js";

// 힉스필드 키는 저장 폴더가 아니라 사용자 홈(~/.ad-studio/)에 둔다 — 저장 폴더를 공유해도 키가 같이 퍼지지 않게
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");
const OLD_SETTINGS_FILE = path.join(DATA_DIR, "_settings.json"); // 예전 위치 — 새 파일이 없을 때만 읽는다
const API = "https://api.higgsfield.ai";

// ── 설정 (API 비밀값은 화면에 돌려주지 않는다) ──
async function rawSettings() { return (await readJson(SETTINGS_FILE, null)) || readJson(OLD_SETTINGS_FILE, {}); }
export async function getHfSettings() {
  const s = await rawSettings();
  return { mode: s.hf_mode || "mcp", hasKey: !!(s.hf_key_id && s.hf_key_secret), keyIdTail: s.hf_key_id ? s.hf_key_id.slice(-4) : "", unlim: !!s.hf_unlim, videoRes: s.hf_video_res || "480p", imageRes: s.hf_image_res || "2k" };
}
export async function setHfSettings(data = {}) {
  const s = await rawSettings();
  if (["mcp", "api"].includes(data.mode)) s.hf_mode = data.mode;
  if (typeof data.keyId === "string" && data.keyId.trim()) s.hf_key_id = data.keyId.trim();
  if (typeof data.keySecret === "string" && data.keySecret.trim()) s.hf_key_secret = data.keySecret.trim();
  if (data.clearKey) { delete s.hf_key_id; delete s.hf_key_secret; }
  if (typeof data.unlim === "boolean") s.hf_unlim = data.unlim;
  if (["480p", "720p", "1080p"].includes(data.videoRes)) s.hf_video_res = data.videoRes;
  if (["1k", "2k", "4k"].includes(data.imageRes)) s.hf_image_res = data.imageRes;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await writeJson(SETTINGS_FILE, s);
  await fs.chmod(SETTINGS_FILE, 0o600).catch(() => {});
  return getHfSettings();
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".wav": "audio/wav" };
const IMG_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"];
const VID_RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const ratio = (a, list) => (list.includes(a) ? a : a === "4:5" ? "3:4" : "auto");

async function download(url, outDir, base) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`결과 파일을 받지 못했습니다 (${res.status})`);
  const ext = (path.extname(new URL(url).pathname) || (res.headers.get("content-type")?.includes("video") ? ".mp4" : ".png")).toLowerCase();
  const name = `${base}${ext}`;
  await fs.writeFile(path.join(outDir, name), Buffer.from(await res.arrayBuffer()));
  return name;
}

// ── API 갈래 ──
async function apiCall(s, method, url, body) {
  const res = await fetch(url.startsWith("http") ? url : `${API}/${url}`, {
    method,
    headers: { Authorization: `Key ${s.hf_key_id}:${s.hf_key_secret}`, "Content-Type": "application/json", ...(method === "POST" && body ? { "Idempotency-Key": crypto.randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`힉스필드 API ${res.status}: ${data.detail || data.error || JSON.stringify(data).slice(0, 200)}`);
  return data;
}
async function apiUpload(s, file) {
  const ct = MIME[path.extname(file).toLowerCase()] || "image/jpeg";
  const up = await apiCall(s, "POST", "files/generate-upload-url", { content_type: ct });
  const put = await fetch(up.upload_url, { method: "PUT", headers: up.upload_headers || { "Content-Type": ct }, body: await fs.readFile(file) });
  if (!put.ok) throw new Error(`참조 파일 올리기 실패 (${put.status})`);
  return up.public_url;
}
async function viaApi(s, req, emit) {
  if (!s.hf_key_id || !s.hf_key_secret) throw new Error("힉스필드 API 키가 없습니다 — 오른쪽 위 ⚙ 에서 키 ID·시크릿을 넣으세요");
  if (req.audio) throw new Error("음성을 넣어 말하는 영상(립싱크)은 MCP 연결에서만 됩니다 — 오른쪽 위 토글을 MCP 로 바꾸세요");
  if (req.native) throw new Error("영상 모델 목소리(모델이 대사를 직접 말하기)는 MCP 연결에서만 됩니다 — 오른쪽 위 토글을 MCP 로 바꾸세요");
  if (req.kind === "video" && req.videoModel && req.videoModel !== "seedance_2_5") throw new Error("영상 모델 고르기는 MCP 연결에서만 됩니다 (API 는 Seedance 2.5 고정) — 오른쪽 위 토글을 MCP 로 바꾸거나 모델을 Seedance 2.5 로 두세요");
  if (req.kind === "video") req.refs = req.refs.slice(0, 1); // API 영상은 시작 이미지 한 장만 쓴다
  emit({ message: `힉스필드 API — 참조 ${req.refs.length}개 올리는 중` });
  const urls = [];
  for (const f of req.refs) urls.push(await apiUpload(s, f));
  let endpoint, body;
  if (req.kind === "video") {
    if (!urls[0]) throw new Error("영상은 시작 이미지가 필요합니다 (장면 이미지를 먼저 올리세요)");
    endpoint = "bytedance/seedance-2.5/image-to-video";
    body = { image_url: urls[0], prompt: req.prompt, duration: Math.max(4, Math.min(30, Math.round(req.duration || 5))), resolution: ["480p", "720p", "1080p"].includes(req.resolution) ? req.resolution : s.hf_video_res || "480p" };
  } else {
    endpoint = "marketing-studio/image";
    body = { prompt: req.prompt.slice(0, 5000), image_urls: urls.slice(0, 16), enhance_prompt: false, quality: "high", resolution: ["1k", "2k", "4k"].includes(req.resolution) ? req.resolution : s.hf_image_res || "2k", aspect_ratio: ratio(req.aspect, IMG_RATIOS) };
  }
  emit({ message: `힉스필드 API — ${endpoint} 요청` });
  const sub = await apiCall(s, "POST", endpoint, body);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await apiCall(s, "GET", sub.status_url);
    if (st.status === "completed") {
      const out = st.video ? [st.video.url] : (st.images || []).map((x) => x.url);
      return { urls: out, request_id: sub.request_id, via: "api", endpoint };
    }
    if (["failed", "nsfw", "canceled"].includes(st.status)) throw new Error(`힉스필드 생성 ${st.status}${st.error ? `: ${st.error}` : ""}`);
    emit({ message: `힉스필드 API — ${st.status} (${Math.round((Date.now() - t0) / 1000)}초)` });
    if (Date.now() - t0 > 20 * 60_000) throw new Error(`힉스필드 응답이 20분 넘게 끝나지 않았습니다 (request ${sub.request_id})`);
  }
}

// ── MCP 갈래: Claude 가 힉스필드 MCP 도구로 올리고·만들고·기다린다 ──
const HF = "mcp__claude_ai_Higgsfield__";
// Genjutsu (영상 복제) — 원본 영상(video_references) + 바꿀 이미지(image_references). params 는 해상도뿐이고 비율·길이는 원본 영상을 따른다
// (힉스필드 models_explore 로 확인: hf_mult_replace_object = 소재 바꾸기, hf_mult_motion_control = 이미지 속 대상에 원본 움직임 옮기기, 2026-11-03)
const GENJUTSU = { replace: "hf_mult_replace_object", motion: "hf_mult_motion_control" };
async function viaMcpGenjutsu(s, req, emit, cwd) {
  const params = { model: GENJUTSU[req.genjutsu] || GENJUTSU.replace, prompt: req.prompt, resolution: ["480p", "720p", "1080p"].includes(req.resolution) ? req.resolution : "720p", use_unlim: !!s.hf_unlim };
  emit({ message: `힉스필드 MCP — Genjutsu(${params.model}) 원본 영상 + 이미지 ${req.refs.length}장 올리고 만드는 중 (3~10분)` });
  const { text } = await askClaude(`힉스필드 MCP 도구로 Genjutsu 생성 한 건을 처리한다. 사람에게 묻지 말고 아래 순서대로만 한다. 다른 생성은 하지 않는다.
1. 원본 영상 ${req.video} 를 ${HF}media_upload 로 upload_url 을 받고 Bash 의 curl 로 PUT 한 뒤 (HTTP 200 확인) ${HF}media_confirm (type: "video") 으로 확인한다.
2. 이미지 ${req.refs.length}개를 같은 방법으로 올린다 (type: "image")${req.refs.length ? `: ${req.refs.join(", ")} — 이 순서가 image 1, 2 … 이다` : " (없으면 건너뛴다)"}.
3. ${HF}generate_video_batch 를 requests 1개로 부른다. params 는 아래 값 그대로에, medias 에 원본 영상을 role "video_references", 이미지들을 순서대로 role "image_references" 로 넣는다.
   params = ${JSON.stringify(params)}
   unlim_choice 같은 질문이 돌아오면 use_unlim 을 ${!!s.hf_unlim} 로 다시 보낸다. 실패하면 다시 시도하지 말고 그대로 보고한다.
4. ${HF}jobs_wait 로 끝날 때까지 기다린다 (all_terminal 이 false 면 반복).
5. 답은 JSON 하나만: { "status": "completed | failed", "urls": ["결과 파일 URL"], "job_ids": [""], "error": "" }`, {
    cwd, timeoutMs: 30 * 60_000,
    allowedTools: [`${HF}media_upload`, `${HF}media_confirm`, `${HF}generate_video_batch`, `${HF}jobs_wait`, "Bash(curl:*)"],
  });
  const out = extractJson(text);
  if (out.status !== "completed" || !out.urls?.length) throw new Error(`힉스필드 Genjutsu 생성 실패: ${out.error || "결과 URL 없음"}`);
  return { urls: out.urls, job_ids: out.job_ids, via: "mcp", model: params.model };
}
async function viaMcp(s, req, emit, cwd) {
  const video = req.kind === "video";
  // 립싱크: 시작 이미지 + 음성 참조(audio_references)를 받는 영상 모델 (기본 seedance_2_5 omni_reference · wan2_7 · minimax_h3)
  const LIPSYNC = ["seedance_2_5", "wan2_7", "minimax_h3"];
  // 영상 모델 목소리(req.native): 음성 파일 없이 프롬프트의 대사를 모델이 직접 소리 낸다 (seedance_2_5 generate_audio · gemini_omni_flash_1_1 native audio)
  const NATIVE = ["seedance_2_5", "gemini_omni_flash_1_1"];
  const model = video ? (req.native ? (NATIVE.includes(req.model) ? req.model : "seedance_2_5") : req.audio && LIPSYNC.includes(req.model) ? req.model : "seedance_2_5") : req.purpose === "product" ? "marketing_studio_image" : "gpt_image_2_5";
  const role = video ? "start_image" : model === "marketing_studio_image" ? "image" : "image_references";
  const dur = Math.round(req.duration || 5);
  const params = video
    ? model === "seedance_2_5" ? { model, prompt: req.prompt, mode: "omni_reference", duration: Math.max(4, Math.min(30, dur)), resolution: s.hf_video_res || "480p", aspect_ratio: ratio(req.aspect, VID_RATIOS), ...(req.native ? { generate_audio: true } : {}) }
      : model === "gemini_omni_flash_1_1" ? { model, prompt: req.prompt, mode: "image-to-video", duration: Math.max(3, Math.min(10, dur)), resolution: "720p", aspect_ratio: ratio(req.aspect, ["16:9", "9:16"]) }
      : model === "wan2_7" ? { model, prompt: req.prompt, duration: Math.max(2, Math.min(15, dur)), resolution: "720p", aspect_ratio: ratio(req.aspect, VID_RATIOS) }
      : { model, prompt: req.prompt, duration: Math.max(4, Math.min(15, dur)), aspect_ratio: ratio(req.aspect, VID_RATIOS) }
    : { model, prompt: req.prompt, resolution: s.hf_image_res || "2k", aspect_ratio: ratio(req.aspect, IMG_RATIOS), ...(model === "gpt_image_2_5" ? { quality: "high" } : {}) };
  // 이미지: 화면에서 모델·비율·해상도·품질을 골랐으면 (req.imageModel) 그 값으로 바꾼다 — 리소스 인물 만들기
  const chosen = !video && imageParams({ model: req.imageModel, aspect: req.aspect, resolution: req.resolution, quality: req.quality });
  if (chosen) { for (const k of Object.keys(params)) if (k !== "prompt") delete params[k]; Object.assign(params, chosen.params); req.refs = req.refs.slice(0, chosen.max); }
  const mediaRole = chosen ? chosen.role : role;
  // 영상: 화면에서 모델을 골랐으면 (req.videoModel — 드라마 영상 단계) 그 모델 params 로 바꾼다. 립싱크·모델 목소리(라디오)는 위 갈래 그대로
  let vchosen = video && !req.native && videoParams({ model: req.videoModel, duration: req.duration, resolution: req.resolution, audio: req.withAudio, aspect: req.aspect });
  if (vchosen && req.audio && !vchosen.audioRef) vchosen = null; // 음성 참고를 못 받는 모델이면 립싱크 갈래(기본 seedance_2_5)로
  if (vchosen) { for (const k of Object.keys(params)) if (k !== "prompt") delete params[k]; Object.assign(params, vchosen.params); if (!vchosen.refs) req.refs = req.refs.slice(0, 1); }
  const sheetRefs = video && req.refs.length > 1 && (vchosen ? vchosen.refs : !["wan2_7", "gemini_omni_flash_1_1"].includes(model));
  params.use_unlim = !!s.hf_unlim;
  emit({ message: `힉스필드 MCP — Claude 가 참조 ${req.refs.length}개를 올리고 ${params.model} 로 만드는 중 (${video ? "2~10분" : "1~3분"})` });
  const { text } = await askClaude(`힉스필드 MCP 도구로 생성 한 건을 처리한다. 사람에게 묻지 말고 아래 순서대로만 한다. 다른 생성은 하지 않는다.
1. 참조 파일 ${req.refs.length}개를 올린다${req.refs.length ? `: ${req.refs.join(", ")}` : " (없으면 건너뛴다)"}.
   ${HF}media_upload 로 upload_url 을 받고, Bash 의 curl 로 파일을 PUT 한 뒤 (HTTP 200 확인), ${HF}media_confirm (type: "image") 으로 확인한다. 파일 순서를 지킨다.${req.audio ? `
   음성 파일 ${req.audio} 도 같은 방법으로 올리고 ${HF}media_confirm (type: "audio") 으로 확인한다.` : ""}
2. ${HF}generate_${video ? "video" : "image"}_batch 를 requests 1개로 부른다. params 는 아래 값 그대로에, medias 에 올린 media_id 를 순서대로 role "${mediaRole}" 로 넣는다 (영상은 첫 파일 = start_image${sheetRefs ? `, 나머지 파일 = role "image_references" (인물 시트 — 얼굴·옷을 유지하는 참고)` : ", 나머지는 넣지 않는다"}).${req.audio ? ` 음성은 role "audio_references" 로 medias 에 더한다 (인물의 입이 이 음성에 맞춰 움직이게).` : ""}
   params = ${JSON.stringify(params)}
   unlim_choice 같은 질문이 돌아오면 use_unlim 을 ${!!s.hf_unlim} 로 다시 보낸다. 실패하면 다시 시도하지 말고 그대로 보고한다.
3. ${HF}jobs_wait 로 끝날 때까지 기다린다 (all_terminal 이 false 면 반복).
4. 답은 JSON 하나만: { "status": "completed | failed", "urls": ["결과 파일 URL"], "job_ids": [""], "error": "" }`, {
    cwd, timeoutMs: 25 * 60_000,
    allowedTools: [`${HF}media_upload`, `${HF}media_confirm`, `${HF}generate_image_batch`, `${HF}generate_video_batch`, `${HF}jobs_wait`, "Bash(curl:*)"],
  });
  const out = extractJson(text);
  if (out.status !== "completed" || !out.urls?.length) throw new Error(`힉스필드 MCP 생성 실패: ${out.error || "결과 URL 없음"}`);
  return { urls: out.urls, job_ids: out.job_ids, via: "mcp", model: params.model };
}

/**
 * req = { kind: "image" | "video", purpose: "edit" | "product" | "scene" | "sheet" | "shot" | "video", prompt, refs: [절대경로], aspect, duration }
 * outDir 에 결과를 내려받고 파일 이름 목록을 돌려준다.
 */
export async function hfGenerate(req, outDir, base, emit = () => {}) {
  if (!String(req.prompt || "").trim()) throw new Error("프롬프트가 없습니다");
  for (const f of [...(req.refs || []), ...(req.audio ? [req.audio] : []), ...(req.video ? [req.video] : [])]) await fs.access(f).catch(() => { throw new Error(`참조 파일이 없습니다: ${path.basename(f)}`); });
  const s = await rawSettings();
  const mode = s.hf_mode || "mcp";
  await fs.mkdir(outDir, { recursive: true });
  if (req.genjutsu && mode === "api") throw new Error("Genjutsu(영상 복제)는 MCP 연결에서만 됩니다 — 오른쪽 위 토글을 MCP 로 바꾸세요");
  const r = mode === "api" ? await viaApi(s, { ...req, refs: req.refs || [] }, emit)
    : req.genjutsu ? await viaMcpGenjutsu(s, { ...req, refs: req.refs || [] }, emit, outDir)
    : await viaMcp(s, { ...req, refs: req.refs || [] }, emit, outDir);
  await fs.mkdir(outDir, { recursive: true });
  const files = [];
  for (const [i, u] of r.urls.entries()) files.push(await download(u, outDir, `${base}${r.urls.length > 1 ? `_${i + 1}` : ""}`));
  emit({ message: `힉스필드(${mode.toUpperCase()}) 결과 ${files.length}개 저장` });
  return { files, ...r, mode };
}
