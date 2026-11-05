// 직접 분석: 사용자가 준 링크나 업로드한 파일을 같은 방식으로 저장·분석한다
//   링크 — 영상/이미지 파일 주소면 바로 받고, 아니면 yt-dlp (유튜브·틱톡·인스타 등 페이지)
//   업로드 — mp4·mov·jpg·png 등
// 저장 위치: <DATA_DIR>/직접 분석/vd_<ID>/ · ph_<ID>/
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeVideo, analyzeImage, analysisMarkdown } from "./analyze.js";
import { closeOcr } from "./ocr.js";
import { MANUAL, brandDir, writeJson } from "./store.js";
import { runEgo } from "./ego.js";
import { pageMediaScript, instagramMediaScript } from "./browser-scripts.js";

const run = promisify(execFile);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif"];

export const extOf = (name) => (name.match(/\.([a-z0-9]{2,4})$/i)?.[1] || "").toLowerCase();
export const kindOf = (ext) => (VIDEO_EXT.includes(ext) ? "vd" : IMAGE_EXT.includes(ext) ? "ph" : null);
// 같은 초에 여러 개를 받아도 겹치지 않게 밀리초까지
const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 17);
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const slug = (s) => s.replace(/[^\w-]+/g, "").slice(0, 40);

// root: 저장할 곳 (기본 직접 분석 폴더 — 영상 복제는 자기 작업 폴더를 준다)
async function newAdDir(type, id, root = brandDir(MANUAL)) {
  const dir = path.join(root, `${type}_${id}`);
  await fs.rm(dir, { recursive: true, force: true }); // 같은 링크를 다시 분석하면 덮어쓴다
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// 받기·분석 중 실패하면 만들다 만 폴더를 지운다
async function cleanupOnError(dir, fn) {
  try { return await fn(); } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

/** 파일을 두고 분석 → analysis.* · ad.json 작성 */
async function finish(dir, type, mainFile, meta, opts, emit) {
  const files = { text: "text.txt" };
  const analysis = { videos: [], images: [] };
  await fs.writeFile(path.join(dir, "text.txt"), meta.body_text || "");
  emit({ message: "분석 중" });
  try {
    if (type === "vd") {
      files.video = mainFile;
      const a = await analyzeVideo(dir, mainFile, "", { useWhisper: opts.whisper, useOcr: opts.ocr });
      analysis.videos.push(a);
      Object.assign(files, { frames: a.frames_dir + "/", contact_sheet: a.contact_sheet });
      if (a.transcript_file) files.transcript = a.transcript_file;
      if (meta.poster) files.poster = meta.poster;
    } else {
      files.image = mainFile;
    }
    Object.assign(files, meta.extra_files || {});
    for (const f of Object.values(files).filter((f) => /^ph_.*\.(jpe?g|png|webp|gif)$/.test(f))) {
      analysis.images.push(await analyzeImage(dir, f, { useOcr: opts.ocr }).catch(() => ({ file: f, error: "분석 실패" })));
    }
  } finally {
    await closeOcr();
  }
  const ad = {
    library_id: path.basename(dir).slice(3),
    type,
    platform: "manual",
    brand: MANUAL.name,
    advertiser: meta.uploader || null,
    title: meta.title || null,
    source: meta.source,
    source_url: meta.source_url || null,
    original_filename: meta.original_filename || null,
    landing_url: meta.source_url || null,
    collected_at: new Date().toISOString(),
    body_text: meta.body_text || "",
    files: { ...files, analysis: "analysis.md", analysis_data: "analysis.json" },
  };
  await writeJson(path.join(dir, "analysis.json"), analysis);
  await fs.writeFile(path.join(dir, "analysis.md"), analysisMarkdown(ad, analysis));
  await writeJson(path.join(dir, "ad.json"), ad);
  emit({ type: "ad", dir: path.basename(dir) });
  return { saved: [path.basename(dir)] };
}

async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** 링크 하나 분석 */
export async function analyzeUrl(url, opts = {}, emit = () => {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error("올바른 URL 이 아닙니다"); }

  // 1) 파일 주소인지 먼저 본다 (확장자 → Content-Type)
  let ext = extOf(u.pathname);
  if (!kindOf(ext)) {
    const head = await fetch(url, { method: "HEAD", headers: { "user-agent": UA } }).catch(() => null);
    const ct = head?.headers.get("content-type") || "";
    if (/^video\//.test(ct)) ext = ct.includes("webm") ? "webm" : "mp4";
    else if (/^image\//.test(ct)) ext = (ct.split("/")[1] || "jpg").replace("jpeg", "jpg").split(";")[0];
  }
  const direct = kindOf(ext);
  if (direct) {
    const id = `${slug(u.hostname.replace(/^www\./, ""))}_${stamp()}`;
    const dir = await newAdDir(direct, id, opts.root);
    const name = `${direct}_${direct === "vd" ? "video" : "image"}.${ext}`;
    return cleanupOnError(dir, async () => {
      emit({ message: "파일 받는 중" });
      await download(url, path.join(dir, name));
      return finish(dir, direct, name, { source: "url", source_url: safeDecode(url), title: safeDecode(path.basename(u.pathname)) }, opts, emit);
    });
  }

  // 2) 인스타그램은 로그인이 필요해 yt-dlp 대신 이고 라이트(로그인된 프로필)로 받는다
  if (/(^|\.)instagram\.com$/.test(u.hostname)) {
    emit({ message: "인스타그램 — 이고 라이트로 여는 중" });
    return analyzeViaBrowser(url, opts, emit);
  }

  // 3) 그 밖의 페이지 링크 → yt-dlp
  emit({ message: "영상 정보 확인 중 (yt-dlp)" });
  let info;
  try {
    const { stdout } = await run("yt-dlp", ["-J", "--no-playlist", "--no-warnings", url], { maxBuffer: 64 * 1024 * 1024 });
    info = JSON.parse(stdout);
  } catch (e) {
    const msg = String(e.stderr || e.message).split("\n").find((l) => l.includes("ERROR")) || e.message;
    // yt-dlp 가 막히면(로그인 요구·제한) 이고 라이트로 페이지를 열어 공유용 영상·이미지 주소를 찾는다
    emit({ message: "yt-dlp 로 못 읽어서 이고 라이트로 페이지를 엽니다" });
    const viaBrowser = await analyzeViaBrowser(url, opts, emit).catch((be) => { emit({ level: "warn", message: `브라우저로도 실패: ${be.message}` }); return null; });
    if (viaBrowser) return viaBrowser;
    throw new Error(/ENOENT/.test(e.code || e.message) ? "yt-dlp 가 설치돼 있지 않습니다" : `링크를 읽지 못했습니다: ${msg.slice(0, 200)}`);
  }
  const id = slug(`${info.extractor_key || "web"}_${info.id || stamp()}`);
  const dir = await newAdDir("vd", id, opts.root);
  return cleanupOnError(dir, async () => {
    emit({ message: `영상 받는 중: ${info.title || url}` });
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mac-dl-"));
    try {
      // H.264 우선 — AV1 은 사파리·일부 윈도우 플레이어에서 재생이 안 된다
      await run("yt-dlp", ["--no-playlist", "--no-warnings",
        "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b",
        "--merge-output-format", "mp4", "-o", path.join(tmp, "v.%(ext)s"), url], { maxBuffer: 16 * 1024 * 1024 });
      const got = (await fs.readdir(tmp)).find((f) => f.startsWith("v."));
      if (!got) throw new Error("영상 파일이 만들어지지 않았습니다");
      await fs.copyFile(path.join(tmp, got), path.join(dir, `vd_video.${extOf(got) || "mp4"}`));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
    let poster = null;
    if (info.thumbnail) {
      await download(info.thumbnail, path.join(dir, "ph_poster.jpg")).then(() => { poster = "ph_poster.jpg"; }, () => {});
    }
    const video = (await fs.readdir(dir)).find((f) => f.startsWith("vd_video."));
    return finish(dir, "vd", video, {
      source: "url", source_url: info.webpage_url || url, title: info.title, uploader: info.uploader || info.channel,
      body_text: [info.title, info.description].filter(Boolean).join("\n\n"), poster,
    }, opts, emit);
  });
}

/** 이고 라이트로 페이지를 열어 받기 — 인스타는 로그인 세션의 미디어 API, 그 밖은 og:video / og:image */
async function analyzeViaBrowser(url, opts, emit) {
  const u = new URL(url);
  const ig = /(^|\.)instagram\.com$/.test(u.hostname);
  const r = await runEgo((ig ? instagramMediaScript : pageMediaScript)({ url }), { onEvent: emit, timeoutMs: 120_000 });
  if (r.error) throw new Error(r.error);

  // 받을 목록: 영상이 하나라도 있으면 영상 광고(첫 영상), 아니면 이미지 광고(사진 전부)
  let items, meta;
  if (ig) {
    items = r.media;
    meta = { uploader: r.full_name || r.user, title: r.caption.split("\n")[0].slice(0, 80) || `@${r.user}`, body_text: r.caption, source_url: `https://www.instagram.com/p/${r.code}/` };
  } else {
    items = [{ video: r.video, image: r.image }];
    // og:title 은 '<사이트>의 <작성자>님 : "본문…"' 꼴일 때가 많다
    const m = (r.title || "").match(/^.+?의 (.+?)님\s*:\s*"([\s\S]*)"?$/);
    meta = { uploader: m?.[1] || r.site || null, title: m ? m[2].split("\n")[0].slice(0, 80) : r.title,
      body_text: m ? m[2].replace(/"$/, "") : [r.title, r.description].filter(Boolean).join("\n\n"), source_url: r.url || url };
  }
  const firstVideo = items.find((x) => x.video);
  const images = items.map((x) => x.image).filter(Boolean);
  if (!firstVideo && !images.length) throw new Error("페이지에서 영상·이미지 주소를 찾지 못했습니다");
  const type = firstVideo ? "vd" : "ph";
  const code = r.code || u.pathname.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1];
  const id = slug(`${u.hostname.replace(/^www\./, "").split(".")[0]}_${code || stamp()}`);
  const dir = await newAdDir(type, id, opts.root);
  return cleanupOnError(dir, async () => {
    const extra = {};
    let name, poster = null;
    if (type === "vd") {
      name = "vd_video.mp4";
      emit({ message: "영상 받는 중 (이고 라이트 경로)" });
      await download(firstVideo.video, path.join(dir, name));
      if (firstVideo.image) await download(firstVideo.image, path.join(dir, "ph_poster.jpg")).then(() => { poster = "ph_poster.jpg"; }, () => {});
    } else {
      name = "ph_image.jpg";
      emit({ message: `이미지 ${images.length}장 받는 중 (이고 라이트 경로)` });
      for (const [i, src] of images.entries()) {
        const f = i ? `ph_image_${i + 1}.jpg` : name;
        await download(src, path.join(dir, f));
        if (i) extra[`image_${i + 1}`] = f;
      }
    }
    return finish(dir, type, name, { source: "url", ...meta, poster, extra_files: extra }, opts, emit);
  });
}

/** 업로드된 파일(임시 경로) 분석 */
export async function analyzeUpload(tmpFile, originalName, opts = {}, emit = () => {}) {
  const ext = extOf(originalName);
  const type = kindOf(ext);
  if (!type) throw new Error(`지원하지 않는 파일 형식: .${ext || "?"} (영상 ${VIDEO_EXT.join("·")}, 이미지 ${IMAGE_EXT.join("·")})`);
  const base = slug(path.basename(originalName, path.extname(originalName)).normalize("NFC")) || "file";
  const dir = await newAdDir(type, `up_${stamp()}_${base}`.slice(0, 60), opts.root);
  const name = `${type}_${type === "vd" ? "video" : "image"}.${ext}`;
  return cleanupOnError(dir, async () => {
    await fs.rename(tmpFile, path.join(dir, name)).catch(async () => {
      await fs.copyFile(tmpFile, path.join(dir, name)); await fs.rm(tmpFile, { force: true });
    });
    return finish(dir, type, name, { source: "upload", original_filename: originalName, title: originalName }, opts, emit);
  });
}
