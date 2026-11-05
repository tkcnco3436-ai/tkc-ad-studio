// 브랜드 하나를 수집한다: 브라우저로 광고 목록 → 파일 다운로드 → 분석 → 저장
import fs from "node:fs/promises";
import path from "node:path";
import { runEgo } from "./ego.js";
import { collectAdsScript, collectInstagramScript } from "./browser-scripts.js";
import { collectGoogleAdsScript } from "./google-scripts.js";
import { analyzeVideo, analyzeImage, analysisMarkdown } from "./analyze.js";
import { closeOcr } from "./ocr.js";
import { brandDir, listAdIds, touchBrand, writeJson } from "./store.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

const extOf = (url, fallback) => {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|mp4|mov)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : fallback;
};

// 한 광고에 같은 종류가 여럿이면 _2, _3 을 붙인다
const nth = (i, n) => (n > 1 && i > 0 ? `_${i + 1}` : "");

async function saveAd(brand, raw, emit, opts) {
  const videos = raw.videos.filter((v) => v.src && !v.src.startsWith("blob:"));
  const type = raw.videos.length ? "vd" : "ph";
  if (!videos.length && !raw.images.length && !raw.videos.some((v) => v.poster)) {
    emit({ level: "warn", message: `${raw.libraryId}: 저장할 영상·이미지를 못 찾아 건너뜀` });
    return null;
  }
  const dirName = `${type}_${raw.libraryId}`;
  const dir = path.join(brandDir(brand), dirName);
  await fs.mkdir(dir, { recursive: true });

  const files = {}, sourceUrls = {};
  const analysis = { videos: [], images: [] };

  await fs.writeFile(path.join(dir, "text.txt"), raw.bodyText || "");
  files.text = "text.txt";

  for (const [i, v] of videos.entries()) {
    const s = nth(i, videos.length);
    const name = `vd_video${s}.${extOf(v.src, "mp4")}`;
    emit({ message: `${raw.libraryId}: 영상${s} 받는 중` });
    await download(v.src, path.join(dir, name));
    files[`video${s}`] = name; sourceUrls[`video${s}`] = v.src;
    if (v.poster) {
      const p = `ph_poster${s}.jpg`;
      await download(v.poster, path.join(dir, p)).then(() => { files[`poster${s}`] = p; sourceUrls[`poster${s}`] = v.poster; }, () => {});
    }
  }
  if (!videos.length) {
    // 영상 src 를 못 얻은 영상 광고: 포스터만이라도 남긴다
    for (const [i, v] of raw.videos.filter((v) => v.poster).entries()) {
      const p = `ph_poster${nth(i, raw.videos.length)}.jpg`;
      await download(v.poster, path.join(dir, p)).then(() => { files[p.slice(3, -4)] = p; sourceUrls[p.slice(3, -4)] = v.poster; }, () => {});
    }
  }
  for (const [i, src] of raw.images.entries()) {
    const s = nth(i, raw.images.length);
    const name = `ph_image${s}.${extOf(src, "jpg")}`;
    await download(src, path.join(dir, name)).then(() => { files[`image${s}`] = name; sourceUrls[`image${s}`] = src; },
      (e) => emit({ level: "warn", message: `${raw.libraryId}: 이미지${s} ${e.message}` }));
  }

  emit({ message: `${raw.libraryId}: 분석 중` });
  for (const [i, v] of videos.entries()) {
    const s = nth(i, videos.length);
    const a = await analyzeVideo(dir, files[`video${s}`], s, { useWhisper: opts.whisper, useOcr: opts.ocr });
    analysis.videos.push(a);
    files[`frames${s}`] = a.frames_dir + "/";
    files[`contact_sheet${s}`] = a.contact_sheet;
    if (a.transcript_file) files[`transcript${s}`] = a.transcript_file;
  }
  for (const f of Object.values(files).filter((f) => /^ph_.*\.(jpg|png|webp|gif)$/.test(f))) {
    analysis.images.push(await analyzeImage(dir, f, { useOcr: opts.ocr }).catch(() => ({ file: f, error: "분석 실패" })));
  }

  const ad = {
    library_id: raw.libraryId,
    type,
    platform: "meta",
    brand: brand.name,
    page_id: brand.id,
    advertiser: raw.advertiser,
    status: raw.status,
    start_date: raw.startDate,
    landing_url: raw.landingUrl,
    collected_at: new Date().toISOString(),
    body_text: raw.bodyText,
    files: { ...files, analysis: "analysis.md", analysis_data: "analysis.json" },
    source_urls: sourceUrls,
  };
  if (raw.videos.length && !videos.length) ad.warning = "영상 주소를 얻지 못해 포스터만 저장";
  await writeJson(path.join(dir, "analysis.json"), analysis);
  await fs.writeFile(path.join(dir, "analysis.md"), analysisMarkdown(ad, analysis));
  await writeJson(path.join(dir, "ad.json"), ad);
  return dirName;
}

// ── 유튜브 (Google 광고 투명성 센터) ─────────────────
// 소재 content.js 안의 VAST XML 에서 영상 파일 주소·길이·랜딩을 꺼낸다
function parseVast(js) {
  const s = js
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const media = [...s.matchAll(/<MediaFile([^>]*)>\s*<!\[CDATA\[([^\]]+)\]\]>/g)]
    .map((m) => ({ type: m[1].match(/type="([^"]+)"/)?.[1] || "", url: m[2].trim() }))
    .filter((m) => /mp4/.test(m.type) || /\.mp4|videoplayback/.test(m.url));
  const click = s.match(/<ClickThrough>\s*<!\[CDATA\[([^\]]+)/)?.[1];
  let landing = null;
  try { landing = click ? new URL(click).searchParams.get("adurl") || click : null; } catch {}
  return { media, duration: s.match(/<Duration>([^<]+)/)?.[1] || null, landing };
}

async function saveGoogleAd(brand, raw, emit, opts) {
  // 대안(variant)마다 소재를 읽고, 같은 영상은 하나로 친다
  const found = [];
  let landing = null, vastDuration = null;
  for (const url of raw.variants) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) continue;
    const v = parseVast(await res.text());
    landing ||= v.landing; vastDuration ||= v.duration;
    for (const m of v.media) {
      const key = new URL(m.url).searchParams.get("id") || m.url;
      if (!found.some((f) => f.key === key)) found.push({ key, url: m.url });
    }
  }
  if (!found.length) {
    emit({ level: "warn", message: `${raw.creativeId}: 영상 파일을 못 찾아 건너뜀 (영상 소재가 아닐 수 있음)` });
    return null;
  }

  const dirName = `vd_${raw.creativeId}`;
  const dir = path.join(brandDir(brand), dirName);
  await fs.mkdir(dir, { recursive: true });
  const files = { text: "text.txt" }, sourceUrls = {};
  const analysis = { videos: [], images: [] };
  await fs.writeFile(path.join(dir, "text.txt"), "");

  for (const [i, m] of found.entries()) {
    const s = nth(i, found.length);
    const name = `vd_video${s}.mp4`;
    emit({ message: `${raw.creativeId}: 영상${s} 받는 중` });
    await download(m.url, path.join(dir, name));
    files[`video${s}`] = name; sourceUrls[`video${s}`] = m.url;
  }
  emit({ message: `${raw.creativeId}: 분석 중` });
  for (const [i] of found.entries()) {
    const s = nth(i, found.length);
    const a = await analyzeVideo(dir, files[`video${s}`], s, { useWhisper: opts.whisper, useOcr: opts.ocr });
    analysis.videos.push(a);
    files[`frames${s}`] = a.frames_dir + "/";
    files[`contact_sheet${s}`] = a.contact_sheet;
    if (a.transcript_file) files[`transcript${s}`] = a.transcript_file;
  }

  const ad = {
    library_id: raw.creativeId,
    type: "vd",
    platform: "youtube",
    brand: brand.name,
    advertiser_id: brand.id,
    advertiser: raw.advertiser,
    status: null,
    start_date: null,
    last_shown: raw.lastShown ? new Date(raw.lastShown).toISOString().slice(0, 10) : null,
    variants: raw.variants.length,
    landing_url: landing,
    collected_at: new Date().toISOString(),
    body_text: "",
    files: { ...files, analysis: "analysis.md", analysis_data: "analysis.json" },
    source_urls: sourceUrls,
  };
  await writeJson(path.join(dir, "analysis.json"), analysis);
  await fs.writeFile(path.join(dir, "analysis.md"), analysisMarkdown(ad, analysis));
  await writeJson(path.join(dir, "ad.json"), ad);
  return dirName;
}

// ── 인스타그램 (계정의 릴스) ─────────────────────────
// 성과는 "이 계정 평소(릴스 그리드 조회수 중앙값) 대비 몇 배"로 본다
async function saveInstagramAd(brand, raw, emit, opts, baseline) {
  if (!raw.video) { emit({ level: "warn", message: `${raw.code}: 영상 주소가 없어 건너뜀` }); return null; }
  const dirName = `vd_${raw.code}`;
  const dir = path.join(brandDir(brand), dirName);
  await fs.mkdir(dir, { recursive: true });
  const files = { text: "text.txt", video: "vd_video.mp4" };
  await fs.writeFile(path.join(dir, "text.txt"), raw.caption || "");
  emit({ message: `${raw.code}: 영상 받는 중` });
  await download(raw.video, path.join(dir, "vd_video.mp4"));
  if (raw.image) await download(raw.image, path.join(dir, "ph_poster.jpg")).then(() => { files.poster = "ph_poster.jpg"; }, () => {});
  emit({ message: `${raw.code}: 분석 중` });
  const analysis = { videos: [], images: [] };
  const a = await analyzeVideo(dir, files.video, "", { useWhisper: opts.whisper, useOcr: opts.ocr });
  analysis.videos.push(a);
  Object.assign(files, { frames: a.frames_dir + "/", contact_sheet: a.contact_sheet });
  if (a.transcript_file) files.transcript = a.transcript_file;

  const approx = baseline.grid.map((g) => g.approx).filter((v) => v != null).sort((x, y) => y - x);
  const ad = {
    library_id: raw.code,
    type: "vd",
    platform: "instagram",
    brand: brand.name,
    advertiser: raw.full_name || raw.user,
    handle: raw.user,
    start_date: raw.taken_at ? new Date(raw.taken_at * 1000).toISOString().slice(0, 10) : null,
    landing_url: `https://www.instagram.com/reel/${raw.code}/`,
    collected_at: new Date().toISOString(),
    body_text: raw.caption || "",
    metrics: {
      plays: raw.plays, likes: raw.likes, comments: raw.comments, duration_s: raw.duration,
      median_plays: baseline.median, sample: baseline.sample,
      multiple: raw.plays && baseline.median ? Math.round((raw.plays / baseline.median) * 10) / 10 : null,
      rank: raw.plays != null && approx.length ? approx.filter((v) => v > raw.plays).length + 1 : null,
      like_rate: raw.plays && raw.likes != null ? Math.round((raw.likes / raw.plays) * 10000) / 100 : null,
      comment_rate: raw.plays && raw.comments != null ? Math.round((raw.comments / raw.plays) * 10000) / 100 : null,
      measured_at: new Date().toISOString(),
    },
    files: { ...files, analysis: "analysis.md", analysis_data: "analysis.json" },
  };
  await writeJson(path.join(dir, "analysis.json"), analysis);
  await fs.writeFile(path.join(dir, "analysis.md"), analysisMarkdown(ad, analysis));
  await writeJson(path.join(dir, "ad.json"), ad);
  return dirName;
}

// ── 공통 진입점 ─────────────────────────────────────
export async function collectBrand(brand, { limit = 5, mediaType = "all", activeStatus = "active", pick = "top", whisper = true, ocr = true } = {}, emit = () => {}) {
  const skipIds = await listAdIds(brand);
  emit({ message: `${brand.name}: 이미 받은 ${skipIds.length}개는 건너뜀` });
  const youtube = brand.platform === "youtube", insta = brand.platform === "instagram";
  const script = youtube
    ? collectGoogleAdsScript({ advertiserId: brand.id, country: brand.country, limit, skipIds })
    : insta ? collectInstagramScript({ username: brand.handle, limit, pick, skipIds })
    : collectAdsScript({ pageId: brand.id, country: brand.country, mediaType, activeStatus, limit, skipIds });
  const res = await runEgo(script, { onEvent: (e) => emit(e) });
  if (res.error) throw new Error(res.error);
  const { ads, baseline } = res;
  if (insta && baseline?.median) emit({ message: `기준: 릴스 ${baseline.sample}개 조회수 중앙값 ${baseline.median.toLocaleString("ko-KR")}` });
  if (!ads.length) emit({ message: "새 광고가 없습니다" });
  const saved = [];
  if (ocr && ads.length) emit({ message: "글자 인식 준비 중 (처음 한 번은 한국어 데이터를 내려받는다)" });
  try {
    for (const [i, raw] of ads.entries()) {
      const id = raw.libraryId || raw.creativeId || raw.code;
      try {
        emit({ message: `저장 ${i + 1}/${ads.length}: ${id}` });
        const d = youtube ? await saveGoogleAd(brand, raw, emit, { whisper, ocr })
          : insta ? await saveInstagramAd(brand, raw, emit, { whisper, ocr }, baseline)
          : await saveAd(brand, raw, emit, { whisper, ocr });
        if (d) { saved.push(d); emit({ type: "ad", dir: d }); }
      } catch (e) {
        emit({ level: "error", message: `${id}: ${e.message}` });
      }
    }
  } finally {
    await closeOcr();
  }
  await touchBrand(brand.id);
  return { saved };
}
