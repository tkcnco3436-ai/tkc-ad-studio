// 힉스필드 이미지 모델 목록 — 참고 이미지를 받는 인물·의상용 모델만 골랐다 (힉스필드 models_explore 로 확인한 값, 2026-10-28)
// res: 해상도 칸 이름과 고를 값 · quality: 품질 칸 이름과 고를 값 (없으면 그 칸을 안 보인다) · role: 참고 이미지를 넣는 역할 · max: 참고 이미지 최대 장수
export const IMAGE_MODELS = [
  { id: "gpt_image_2_5", name: "GPT Image 2.5", note: "참고 여러 장·편집에 강함 (기본)", role: "image_references", aspects: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"],
    res: { key: "resolution", options: ["1k", "2k", "4k"], def: "2k" }, quality: { key: "quality", options: ["low", "medium", "high", "xhigh", "max"], def: "high" } },
  { id: "nano_banana_pro", name: "Nano Banana Pro", note: "사실적·같은 얼굴 유지", role: "image_references", aspects: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"],
    res: { key: "resolution", options: ["1k", "2k", "4k"], def: "2k" } },
  { id: "nano_banana_2", name: "Nano Banana 2", note: "빠르고 사실적", role: "image_references", aspects: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"],
    res: { key: "resolution", options: ["1k", "2k", "4k"], def: "2k" } },
  { id: "seedream_v5_pro", name: "Seedream 5.0 Pro", note: "지시 따르는 편집", role: "image_references", aspects: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
    res: { key: "resolution", options: ["1k", "1.5k", "2k"], def: "2k" } },
  { id: "seedream_v4_5", name: "Seedream 4.5", note: "4K 고해상도", role: "image_references", aspects: ["1:1", "4:3", "16:9", "3:2", "21:9", "3:4", "9:16", "2:3"],
    quality: { key: "quality", options: ["basic", "high"], def: "high" } },
  { id: "flux_3_image", name: "FLUX 3", note: "참고 최대 10장", role: "image_references", aspects: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"],
    res: { key: "resolution", options: ["1k", "1.5k", "2k", "4k"], def: "2k" } },
  { id: "kling_omni_image", name: "Kling O1 Image", note: "사실적 인물", role: "image_references", aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
    res: { key: "resolution", options: ["1k", "2k"], def: "2k" } },
  { id: "soul_2", name: "Higgsfield Soul 2.0", note: "패션·인물 화보 (참고 1장)", role: "image", max: 1, aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    res: { key: "quality", options: ["1.5k", "2k"], def: "2k" } },
  { id: "gpt_image_2", name: "GPT Image 2", note: "이전 GPT 이미지", role: "image", aspects: ["1:1", "4:3", "3:4", "16:9", "21:9", "9:16", "3:2", "2:3"],
    res: { key: "resolution", options: ["1k", "2k", "4k"], def: "2k" }, quality: { key: "quality", options: ["low", "medium", "high"], def: "high" } },
];

/** 고른 모델·비율·해상도·품질을 힉스필드 params 로 — 목록에 없는 값은 모델 기본값으로 */
export function imageParams({ model, aspect, resolution, quality } = {}) {
  const m = IMAGE_MODELS.find((x) => x.id === model);
  if (!m) return null;
  const p = { model: m.id, aspect_ratio: m.aspects.includes(aspect) ? aspect : m.aspects[0] };
  if (m.res) p[m.res.key] = m.res.options.includes(resolution) ? resolution : m.res.def;
  if (m.quality) p[m.quality.key] = m.quality.options.includes(quality) ? quality : m.quality.def;
  return { params: p, role: m.role, max: m.max || 16, name: m.name };
}

// 힉스필드 영상 모델 목록 — 시작 이미지(start_image)를 받는 모델만 골랐다 (힉스필드 models_explore 로 확인한 값, 2026-10-29)
// dur: 길이 범위 {min,max} 또는 고를 값 {options} · res: 해상도 칸 (kling3_0 은 화질 mode 칸) · audio: 소리 생성 칸과 켬/끔 값
// refs: start_image 말고 인물 시트를 image_references 로 더 받는지 · audioRef: 그 컷 음성을 audio_references 로 받아 입 모양을 맞추는지 · extra: 늘 넣는 값 · aspects 가 비면 비율을 안 보낸다
const ALL_RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const BOOL_AUDIO = { key: "generate_audio", on: true, off: false };
export const VIDEO_MODELS = [
  { id: "seedance_2_5", audioRef: true, name: "Seedance 2.5", note: "기본 · 인물 시트 참고 · 최대 30초", dur: { min: 4, max: 30 }, res: { key: "resolution", options: ["480p", "720p", "1080p"], def: "480p" }, audio: BOOL_AUDIO, refs: true, extra: { mode: "omni_reference" }, aspects: ALL_RATIOS },
  { id: "cinematic_studio_video_4_0", audioRef: true, name: "Cinema Studio 4.0", note: "영화 질감 · 인물 시트 참고 · 최대 30초", dur: { min: 4, max: 30 }, res: { key: "resolution", options: ["480p", "720p", "1080p"], def: "720p" }, audio: BOOL_AUDIO, refs: true, extra: { mode: "omni_reference" }, aspects: ALL_RATIOS },
  { id: "seedance_2_0", audioRef: true, name: "Seedance 2.0", note: "같은 얼굴 유지 · 인물 시트 참고", dur: { min: 4, max: 15 }, res: { key: "resolution", options: ["480p", "720p", "1080p"], def: "720p" }, audio: BOOL_AUDIO, refs: true, aspects: ALL_RATIOS },
  { id: "seedance_2_0_mini", audioRef: true, name: "Seedance 2.0 Mini", note: "싸고 빠름 · 인물 시트 참고", dur: { min: 4, max: 15 }, res: { key: "resolution", options: ["480p", "720p"], def: "480p" }, audio: BOOL_AUDIO, refs: true, aspects: ALL_RATIOS },
  { id: "kling3_0", name: "Kling 3.0", note: "움직임·물리 · 시작 이미지만", dur: { min: 3, max: 15 }, res: { key: "mode", label: "화질", options: ["std", "pro", "4k"], def: "std" }, audio: { key: "sound", on: "on", off: "off" }, refs: false, aspects: ["16:9", "9:16", "1:1"] },
  { id: "kling3_0_turbo", name: "Kling 3.0 Turbo", note: "빠르고 쌈 · 소리 없음", dur: { min: 3, max: 15 }, res: { key: "resolution", options: ["720p", "1080p"], def: "720p" }, refs: false, aspects: ["16:9", "9:16", "1:1"] },
  { id: "kling4_0", name: "Kling 4.0", note: "최신 Kling · 최대 30초 · 소리 없음", dur: { min: 3, max: 30 }, res: { key: "resolution", options: ["720p", "1080p"], def: "720p" }, refs: false, extra: { mode: "image-to-video" }, aspects: ["21:9", "16:9", "9:16", "1:1", "auto"] },
  { id: "cinematic_studio_3_0", name: "Cinema Studio 3.0", note: "시네마 최고 화질 · 시작 이미지만", dur: { min: 4, max: 15 }, res: { key: "resolution", options: ["480p", "720p", "1080p", "4k"], def: "720p" }, audio: BOOL_AUDIO, refs: false, aspects: ALL_RATIOS },
  { id: "minimax_hailuo", name: "Minimax Hailuo 2.3", note: "표정·자연스러운 물리 · 6/10초", dur: { options: [6, 10] }, res: { key: "resolution", options: ["768", "1080"], def: "768" }, refs: false, extra: { variant: "minimax-2.3" }, aspects: [] },
  { id: "minimax_h3", audioRef: true, name: "MiniMax H3", note: "2K · 인물 시트 참고", dur: { min: 4, max: 15 }, res: { key: "resolution", options: ["2K"], def: "2K" }, refs: true, aspects: ALL_RATIOS },
  { id: "grok_video_v15", audioRef: true, name: "Grok Video 1.5", note: "인물 시트 참고 · 2~15초", dur: { min: 2, max: 15 }, res: { key: "resolution", options: ["480p", "720p", "1080p"], def: "720p" }, refs: true, aspects: [] },
];

/** 고른 영상 모델·길이·해상도·소리를 힉스필드 params 로 — 목록에 없는 값은 모델 기본값·가까운 값으로 */
export function videoParams({ model, duration, resolution, audio, aspect } = {}) {
  const m = VIDEO_MODELS.find((x) => x.id === model);
  if (!m) return null;
  const d = Math.round(+duration || 5);
  const p = { model: m.id, ...(m.extra || {}) };
  p.duration = m.dur.options ? m.dur.options.find((x) => x >= d) ?? m.dur.options.at(-1) : Math.max(m.dur.min, Math.min(m.dur.max, d));
  if (m.res) p[m.res.key] = m.res.options.includes(resolution) ? resolution : m.res.def;
  if (m.audio) p[m.audio.key] = audio ? m.audio.on : m.audio.off;
  if (m.aspects.length) p.aspect_ratio = m.aspects.includes(aspect) ? aspect : m.aspects.includes("auto") ? "auto" : m.aspects[0];
  return { params: p, refs: m.refs, audioRef: !!m.audioRef, name: m.name };
}
