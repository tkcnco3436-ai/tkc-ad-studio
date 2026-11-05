// 저장한 영상·이미지를 ffmpeg / ffprobe / whisper-cli 로 분석한다.
// 기계로 뽑을 수 있는 것만 만든다: 스펙, 컷 분할, 컷별 대표 프레임, 컨택트시트, 음성 인식.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ocrImage, ocrAvailable } from "./ocr.js";

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };

export const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(os.homedir(), ".cache/whisper-cpp/ggml-small.bin");
const SCENE_THRESHOLD = 0.3;

export async function toolStatus() {
  const finder = process.platform === "win32" ? "where" : "which";
  const has = async (bin) => run(finder, [bin]).then(() => true, () => false);
  return {
    ffmpeg: await has("ffmpeg"),
    ffprobe: await has("ffprobe"),
    whisper: (await has("whisper-cli")) && existsSync(WHISPER_MODEL),
    ego: await has("ego-browser"),
    ocr: await ocrAvailable(),
    ytdlp: await has("yt-dlp"),
  };
}

async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration,bit_rate,size",
    "-of", "json", file]);
  return JSON.parse(stdout);
}

function aspectLabel(w, h) {
  const r = w / h;
  const known = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["4:3", 4 / 3], ["1.91:1", 1.91], ["16:9", 16 / 9]];
  const [label, v] = known.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
  return Math.abs(v - r) < 0.04 ? label : `${w}:${h}`;
}

async function sceneCuts(file) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-vsync", "vfr", "-f", "null", "-"], BIG);
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

async function transcribe(file) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mac-asr-"));
  try {
    const wav = path.join(tmp, "a.wav");
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-ar", "16000", "-ac", "1", wav]);
    const base = path.join(tmp, "a");
    await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "ko", "-f", wav, "-oj", "-osrt", "-of", base, "-np"], BIG);
    const json = JSON.parse(await fs.readFile(`${base}.json`, "utf8"));
    const srt = await fs.readFile(`${base}.srt`, "utf8");
    const segments = (json.transcription || []).map((s) => ({
      start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim(),
    }));
    return { segments, srt };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** 영상 하나 분석. suffix 는 한 광고에 영상이 여럿일 때 "_2" 등 */
export async function analyzeVideo(adDir, videoFile, suffix = "", { useWhisper = true, useOcr = true } = {}) {
  const file = path.join(adDir, videoFile);
  const info = await probe(file);
  const v = info.streams.find((s) => s.codec_type === "video") || {};
  const a = info.streams.find((s) => s.codec_type === "audio");
  const duration = Number(info.format.duration);
  const [num, den] = (v.r_frame_rate || "0/1").split("/").map(Number);

  const cuts = (await sceneCuts(file)).filter((t) => t > 0.05 && t < duration - 0.05);
  const bounds = [0, ...cuts, duration];
  const framesDir = `vd_frames${suffix}`;
  await fs.rm(path.join(adDir, framesDir), { recursive: true, force: true });
  await fs.mkdir(path.join(adDir, framesDir), { recursive: true });

  const shots = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1];
    const frame = `${framesDir}/shot${String(i + 1).padStart(2, "0")}_${start.toFixed(1).padStart(4, "0")}s.jpg`;
    // 영상 끝 0.1초짜리 컷처럼 가운데 시점에 디코딩할 프레임이 없으면 ffmpeg 가 엉뚱한 인코더 오류를 낸다
    // → 컷 시작, 끝에서 1초 앞으로 차례로 다시 잡고, 그래도 안 되면 그 컷은 앞 컷에 붙인다
    let ok = false;
    for (const t of [(start + end) / 2, start, Math.max(0, duration - 1)]) {
      ok = await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", path.join(adDir, frame)]).then(() => true, () => false);
      if (ok) break;
    }
    if (!ok && shots.length) {
      const prev = shots[shots.length - 1];
      prev.end = +end.toFixed(2); prev.dur = +(end - prev.start).toFixed(2);
      continue;
    }
    if (!ok) throw new Error("영상에서 프레임을 하나도 뽑지 못했습니다");
    shots.push({ shot: shots.length + 1, start: +start.toFixed(2), end: +end.toFixed(2), dur: +(end - start).toFixed(2), frame });
  }

  const cols = Math.min(5, shots.length);
  const rows = Math.ceil(shots.length / cols);
  const contactSheet = `vd_contact_sheet${suffix}.jpg`;
  // 프레임 목록 파일로 이어 붙인다 (윈도우 ffmpeg 는 -pattern_type glob 을 지원하지 않는다)
  const listFile = path.join(adDir, framesDir, "_list.txt");
  await fs.writeFile(listFile, shots.map((s) => `file '${path.join(adDir, s.frame).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", `scale=320:-1,tile=${cols}x${rows}`, "-frames:v", "1", path.join(adDir, contactSheet)]);
  await fs.rm(listFile, { force: true });

  // 컷마다 화면 글자(자막·카피) 읽기
  if (useOcr) {
    for (const s of shots) {
      s.onscreen_text = (await ocrImage(path.join(adDir, s.frame)).catch(() => [])).map((l) => l.text).join(" / ");
    }
  }

  let transcript = null, segments = [];
  if (useWhisper && a && existsSync(WHISPER_MODEL)) {
    try {
      const asr = await transcribe(file);
      segments = asr.segments;
      transcript = `vd_transcript_asr${suffix}.srt`;
      await fs.writeFile(path.join(adDir, transcript), asr.srt);
      for (const s of shots) {
        s.speech = segments.filter((g) => g.start < s.end && g.end > s.start).map((g) => g.text).join(" / ");
      }
    } catch {
      transcript = null;
    }
  }

  const durs = shots.map((s) => s.dur);
  return {
    file: videoFile,
    spec: {
      duration_s: +duration.toFixed(2),
      width: v.width, height: v.height,
      aspect: aspectLabel(v.width, v.height),
      orientation: v.height > v.width ? "세로" : v.height === v.width ? "정사각" : "가로",
      fps: den ? +(num / den).toFixed(2) : null,
      video_codec: v.codec_name,
      audio: a ? `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch` : "없음",
      bitrate_kbps: Math.round(Number(info.format.bit_rate) / 1000),
      size_kb: Math.round(Number(info.format.size) / 1024),
    },
    cuts: {
      count: shots.length,
      avg_s: +(duration / shots.length).toFixed(2),
      shortest_s: Math.min(...durs),
      longest_s: Math.max(...durs),
      scene_threshold: SCENE_THRESHOLD,
    },
    frames_dir: framesDir,
    contact_sheet: contactSheet,
    transcript_file: transcript,
    speech: segments,
    shots,
  };
}

/** 이미지 하나 분석: 크기·비율·대표 색 */
export async function analyzeImage(adDir, imageFile, { useOcr = true } = {}) {
  const file = path.join(adDir, imageFile);
  const info = await probe(file);
  const v = info.streams.find((s) => s.codec_type === "video") || {};
  // 16x16 으로 줄여 픽셀을 32단계로 묶은 뒤 많이 나온 색 5개
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=16:16", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", ...BIG });
  const counts = new Map();
  for (let i = 0; i + 2 < stdout.length; i += 3) {
    const q = (x) => Math.min(255, Math.round(x / 32) * 32);
    const hex = "#" + [stdout[i], stdout[i + 1], stdout[i + 2]].map((x) => q(x).toString(16).padStart(2, "0")).join("");
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const total = stdout.length / 3;
  const colors = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([hex, n]) => ({ hex, ratio: +(n / total).toFixed(2) }));
  const stat = await fs.stat(file);
  return {
    file: imageFile,
    width: v.width, height: v.height,
    aspect: aspectLabel(v.width, v.height),
    orientation: v.height > v.width ? "세로" : v.height === v.width ? "정사각" : "가로",
    size_kb: Math.round(stat.size / 1024),
    dominant_colors: colors,
    text_lines: useOcr ? await ocrImage(file).catch(() => []) : null,
  };
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|"); // 표 칸 안의 | 이스케이프
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** analysis.json 내용을 사람이 읽는 analysis.md 로 */
export function analysisMarkdown(ad, analysis) {
  const L = [];
  L.push(`# 광고 분석 — ${ad.advertiser || ad.brand} (ID ${ad.library_id})`, "");
  const when = ad.platform === "youtube"
    ? `유튜브 (Google 광고 투명성 센터) · 마지막 게재 ${ad.last_shown || "?"}`
    : ad.platform === "instagram"
      ? `인스타 릴스 @${ad.handle || "?"} · 게시 ${ad.start_date || "?"}${ad.metrics ? ` · 조회 ${ad.metrics.plays ?? "?"} · 좋아요 ${ad.metrics.likes ?? "?"} · 댓글 ${ad.metrics.comments ?? "?"} · 평소 대비 ${ad.metrics.multiple ?? "?"}배 (중앙값 ${ad.metrics.median_plays ?? "?"}, 릴스 ${ad.metrics.sample}개 기준)` : ""}`
    : ad.platform === "manual"
      ? `직접 분석 · ${ad.source === "upload" ? `업로드 파일 ${ad.original_filename}` : "링크"}`
      : `메타 · 게재 시작 ${ad.start_date || "?"} · 상태 ${ad.status || "?"}`;
  L.push(`- 유형: ${ad.type === "vd" ? "영상 광고 (vd)" : "이미지 광고 (ph)"} · ${when}`);
  if (ad.title) L.push(`- 제목: ${ad.title}`);
  if (ad.landing_url) L.push(`- ${ad.platform === "manual" ? "원본 링크" : "랜딩"}: ${ad.landing_url}`);
  L.push(`- 본문: \`text.txt\` · 구조화 데이터: \`analysis.json\``, "");

  for (const [i, v] of analysis.videos.entries()) {
    L.push(`## 영상${analysis.videos.length > 1 ? ` ${i + 1}` : ""} — \`${v.file}\``, "");
    L.push("| 항목 | 값 |", "|---|---|");
    L.push(`| 길이 | ${v.spec.duration_s}초 |`);
    L.push(`| 해상도·비율 | ${v.spec.width}×${v.spec.height}, ${v.spec.aspect} ${v.spec.orientation} |`);
    L.push(`| 프레임·코덱 | ${v.spec.fps}fps, ${v.spec.video_codec} |`);
    L.push(`| 오디오 | ${v.spec.audio} |`);
    L.push(`| 컷 | ${v.cuts.count}컷, 평균 ${v.cuts.avg_s}초 (최단 ${v.cuts.shortest_s} · 최장 ${v.cuts.longest_s}) |`, "");
    L.push(`컷별 대표 프레임 \`${v.frames_dir}/\` · 한 장 요약 \`${v.contact_sheet}\``, "");
    L.push("| # | 시작 | 길이 | 프레임 | 화면 글자 (OCR) | 음성 (자동 인식) |", "|---|---|---|---|---|---|");
    for (const s of v.shots) L.push(`| ${s.shot} | ${fmt(s.start)} | ${s.dur}s | \`${path.basename(s.frame)}\` | ${cell(s.onscreen_text)} | ${cell(s.speech)} |`);
    L.push("");
    if (!v.transcript_file) L.push("음성 인식은 하지 않았다 (whisper 없음 또는 오디오 없음).", "");
  }

  for (const [i, im] of analysis.images.entries()) {
    L.push(`## 이미지${analysis.images.length > 1 ? ` ${i + 1}` : ""} — \`${im.file}\``, "");
    L.push(`- ${im.width}×${im.height}, ${im.aspect} ${im.orientation}, ${im.size_kb}KB`);
    L.push(`- 대표 색: ${im.dominant_colors.map((c) => `${c.hex} (${Math.round(c.ratio * 100)}%)`).join(" · ")}`);
    if (im.text_lines?.length) L.push("- 글자 (OCR):", ...im.text_lines.map((l) => `  - ${l.text} (${l.conf})`));
    L.push("");
  }

  L.push("## 참고", "");
  L.push("- 컷 분할은 ffmpeg 장면 감지(임계값 0.3) 기준이다. 디졸브·빠른 움직임에서 실제와 어긋날 수 있다");
  L.push("- 음성 인식은 whisper(small) 자동 결과라 고유명사 오인식이 있다. 화면 자막과 대조해서 쓴다");
  L.push("- 화면 글자는 tesseract OCR(신뢰도 70 이상만) 결과다. 장식 폰트·작은 글씨는 빠지거나 틀릴 수 있다");
  L.push("- 장면 내용·구간 구조(훅·제품 증명 등)는 자동 분석에 들어 있지 않다");
  return L.join("\n") + "\n";
}
