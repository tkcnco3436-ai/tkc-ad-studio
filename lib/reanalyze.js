// 다시 분석: 이미 저장한 영상·이미지로 분석만 새로 돌린다 (다운로드 없음)
// 분석 기능이 바뀌었을 때 예전 광고를 최신 분석으로 맞추는 용도
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeVideo, analyzeImage, analysisMarkdown } from "./analyze.js";
import { closeOcr } from "./ocr.js";
import { AD_DIR_RE, brandDir, readJson, writeJson } from "./store.js";

/** 화면 글자(OCR) 결과가 없는 분석인가 */
export function lacksOcr(analysis) {
  if (!analysis) return true;
  return analysis.videos?.some((v) => v.shots?.some((s) => s.onscreen_text === undefined))
    || analysis.images?.some((im) => !im.error && im.text_lines == null);
}

async function reanalyzeOne(brand, dirName, opts, emit) {
  const dir = path.join(brandDir(brand), dirName);
  const ad = await readJson(path.join(dir, "ad.json"), null);
  if (!ad) throw new Error("ad.json 이 없습니다");
  const files = { ...ad.files };
  const analysis = { videos: [], images: [] };

  // 영상: files 의 video / video_2 … 키 순서대로. 키 꼬리가 프레임 폴더 등의 접미사가 된다
  const videoKeys = Object.keys(files).filter((k) => /^video(_\d+)?$/.test(k)).sort();
  for (const k of videoKeys) {
    const s = k.slice("video".length);
    emit({ message: `${dirName}: 영상${s} 분석 중` });
    const a = await analyzeVideo(dir, files[k], s, { useWhisper: opts.whisper, useOcr: opts.ocr });
    analysis.videos.push(a);
    files[`frames${s}`] = a.frames_dir + "/";
    files[`contact_sheet${s}`] = a.contact_sheet;
    if (a.transcript_file) files[`transcript${s}`] = a.transcript_file;
    else delete files[`transcript${s}`];
  }
  for (const f of Object.values(files).filter((f) => /^ph_.*\.(jpe?g|png|webp|gif)$/.test(f))) {
    emit({ message: `${dirName}: ${f} 분석 중` });
    analysis.images.push(await analyzeImage(dir, f, { useOcr: opts.ocr }).catch(() => ({ file: f, error: "분석 실패" })));
  }

  const next = { ...ad, files, reanalyzed_at: new Date().toISOString() };
  await writeJson(path.join(dir, "analysis.json"), analysis);
  let md = analysisMarkdown(next, analysis);
  if (files.analysis_manual) md += `\n수동 분석(장면 설명·구간 구조): \`${files.analysis_manual}\`\n`;
  await fs.writeFile(path.join(dir, "analysis.md"), md);
  await writeJson(path.join(dir, "ad.json"), next);
}

/**
 * dir 를 주면 그 광고 하나, 없으면 브랜드 전체.
 * missingOnly: 화면 글자가 없는 광고만
 */
export async function reanalyze(brand, { dir, missingOnly = false, whisper = true, ocr = true } = {}, emit = () => {}) {
  let targets;
  if (dir) {
    if (!AD_DIR_RE.test(dir)) throw new Error("광고 폴더 이름이 아닙니다");
    targets = [dir];
  } else {
    const names = (await fs.readdir(brandDir(brand)).catch(() => [])).filter((n) => AD_DIR_RE.test(n)).sort();
    targets = [];
    for (const n of names) {
      if (!missingOnly || lacksOcr(await readJson(path.join(brandDir(brand), n, "analysis.json"), null))) targets.push(n);
    }
  }
  if (!targets.length) emit({ message: "다시 분석할 광고가 없습니다" });
  const saved = [];
  try {
    for (const [i, d] of targets.entries()) {
      emit({ message: `다시 분석 ${i + 1}/${targets.length}: ${d}` });
      try {
        await reanalyzeOne(brand, d, { whisper, ocr }, emit);
        saved.push(d);
        emit({ type: "ad", dir: d });
      } catch (e) {
        emit({ level: "error", message: `${d}: ${e.message}` });
      }
    }
  } finally {
    await closeOcr();
  }
  return { saved };
}
