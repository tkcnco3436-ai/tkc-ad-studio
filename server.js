// 광고소재 스튜디오 — 로컬 서버 (광고 수집 · 이미지 소재 · 영상 복제 · 드라마 릴스)
// npm start → start.js 가 이 파일을 띄운다 → http://localhost:5179
import { IMAGE_MODELS, VIDEO_MODELS } from "./lib/hfmodels.js";
import { extractYoutubeAudio, saveYoutubeVoice } from "./lib/ytaudio.js";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEgo } from "./lib/ego.js";
import { searchAdvertisersScript, resolveAdvertiserScript, resolveInstagramScript } from "./lib/browser-scripts.js";
import { searchGoogleAdvertisersScript, resolveGoogleAdvertiserScript } from "./lib/google-scripts.js";
import { collectBrand } from "./lib/collect.js";
import { analyzeUrl, analyzeUpload, kindOf, extOf } from "./lib/manual.js";
import { reanalyze } from "./lib/reanalyze.js";
import { getHfSettings, setHfSettings } from "./lib/higgsfield.js";
import { runHf, saveComposite } from "./lib/hfjobs.js";
import { listRadios, getRadio, createRadio, updateRadio, deleteRadio, setCastPhoto, writeRadioScript, voiceRadio, revoiceLine, writeRadioPrompts, setRadioScene, renderRadio, radioSrt, suggestRadioTopics, refineRadioPrompt, listRadioSets, saveRadioSet, deleteRadioSet, previewVoice } from "./lib/radio.js";
import { SIZES as POSTER_SIZES, STYLES as POSTER_STYLES, listPosters, getPoster, createPoster, updatePoster, deletePoster, writePosterCopy, addPosterBg, addPosterRef, savePosterPng, collectedImages, importCollected, listPosterTemplates, savePosterTemplate, deletePosterTemplate, applyPosterTemplate, analyzePosterTemplate, editPosterNL, undoPoster, setLayerImage, writeFinalPrompt, addPosterAsset, posterLog, savePosterVersion, restorePosterVersion, posterVersion, importResource } from "./lib/poster.js";
import { listClones, getClone, createClone, updateClone, deleteClone, runAnalyze as runCloneAnalyze, reanalyzeElements, setSwap, makeClonePrompts, restoreClonePrompts } from "./lib/clone.js";
import { SPEAKERS, STYLES, voiceStatus, downloadModels, listProfiles, cloneVoice, deleteProfile, speak, saveVoiceResource, voiceChoices } from "./lib/voice.js";
import { listDramas, createDrama, getDrama, updateDrama, deleteDrama, draftIdeas, developStory, makeShotlist, autoPlan, setReference, fixShot, setDramaMedia, dramaSrt, thumbFrame, suggestThumbTitles } from "./lib/dramastudio.js";
import { buildCastSheet, setCastImage, makeMyPrompts, suggestMyTopics, makeMyScript, saveMyScript, makeMyVoice, setMyMedia } from "./lib/mytemplate.js";
import { createDramaTemplate, guessVideoStyle, makeScript, listAllScripts, deleteScript } from "./lib/drama.js";
import { createTemplate, listTemplates, getTemplate, saveTemplate, deleteTemplate, duplicateTemplate } from "./lib/template.js";
import { listClients, createClient, renameClient, deleteClient, setFileForm, cropResourceFile } from "./lib/resources.js";
import { KINDS, listResources, createResource, deleteResource, getResource, updateResource, addResourceFiles, removeResourceFile, resourcePath, makePersona, completePrompt, analyzeRefs, importFile, addPromptVersion, zoomImage } from "./lib/resources.js";
import { createPrompts, createVariant, deleteVariant, detectSubjects, hasImagePrompts, registerVaryAsset, suggestVariants } from "./lib/prompts.js";
import { createCardTemplate, makeCards, listCards, listAllCards, saveCard, saveCardPng, deleteCard, addCardMedia, saveCardVideo, listKits, saveKit, deleteKit, autofillKit, KIT_PROFILE, addKitImages, deleteKitImage, listLinkSets, saveLinkSet, deleteLinkSet, aiEditTemplate, suggestTopics } from "./lib/cardnews.js";
import { findCompetitors, listCompetitorSearches, deleteCompetitorSearch } from "./lib/competitors.js";
import { listAutoflows, getAutoflow, createAutoflow, updateAutoflow, deleteAutoflow, runAutoflow, dueAutoflows, markScheduled, nextRun, readLink, listPlans, getPlan, updatePlan, replan, makeApproved, suggestSetup, collectedAds, planPicked } from "./lib/autoflow.js";
import { listPodcasts, getPodcast, createPodcast, updatePodcast, deletePodcast, writeScript as writePodcastScript, voiceLines, setAudio as setPodcastAudio, renderStart, renderFrame, renderFinish, podcastLib, setHostPhoto } from "./lib/podcast.js";
import { listExplainers, getExplainer, createExplainer, updateExplainer, deleteExplainer, writeScript, setAudio, draftVoice, saveRender, listLib, saveLib, deleteLib } from "./lib/explainer.js";
import os from "node:os";
import { toolStatus } from "./lib/analyze.js";
import { explore, variantAssets } from "./lib/explore.js";
import { addHistory, listHistory } from "./lib/history.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { setupStatus, checkClaude, checkHiggsfield, pickFolder, setDataDir, runInstall, INSTALLABLE, openClaudeLogin } from "./lib/setup.js";
import { DATA_DIR, DATA_DIR_SET, listBrands, addBrand, removeBrand, getBrand, listAds, readJson, brandDir } from "./lib/store.js";

const PORT = Number(process.env.PORT || 5179);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

// ── 실시간 이벤트 (SSE) ──────────────────────────────
const clients = new Set();
const history = [];
// 작업 두 갈래:
//  - 혼자 도는 작업(solo): 수집·브라우저·목소리·포스터 등 — 브라우저 작업 공간이 하나라서, 그리고 같은 파일을 덮어쓰지 않게 한 번에 하나만
//  - 같이 도는 작업: 드라마 스튜디오의 Claude 단계와 드라마 힉스필드 생성 — key 가 겹치지 않으면 solo 와도 동시에 돈다
//    key 는 위계: "drama:d_1" 은 "drama:d_1:fix:3" 과 겹친다. 드라마 파일 쓰기는 dramastudio 의 잠금이 맞춘다
const jobs = new Map(); // id → { id, kind, label, startedAt, key }
let solo = null; // 지금 도는 혼자 작업 (없으면 null)
const MAX_PARALLEL = 6; // 같이 도는 작업 최대 수 — 힉스필드·Claude 요청 폭주 방지
let jobSeq = 0;
const jobList = () => [...jobs.values()];
const keyOverlap = (a, b) => a === b || a.startsWith(b + ":") || b.startsWith(a + ":");
const staged = new Map(); // 올려 두고 아직 분석을 시작하지 않은 파일: 토큰 → { file, name }

// 이미지 광고 자동화 — 1분마다 돌 차례인 것을 찾는다. 다른 혼자 작업이 돌고 있으면 다음 확인 때 다시 본다 (그날 한 번)
function startAuto(af, trigger) {
  startJob("auto", `이미지 광고 자동화 · ${af.name}`, (emit) => runAutoflow(af.id, { trigger }, emit)).catch(() => {});
  if (solo) solo.afId = af.id; // 목록에 "도는 중" 표시용
}
// 승인한 기획이 있으면 서버가 빌 때 차례로 만든다 (승인 화면 · 1분마다 확인)
async function kickPlans() {
  if (solo || !(await listPlans({ status: "approved" })).length) return false;
  startJob("auto", "승인한 기획 만들기", (emit) => makeApproved(emit)).catch(() => {});
  return true;
}
setInterval(async () => {
  try {
    if (solo) return;
    if (await kickPlans()) return;
    const [af] = await dueAutoflows();
    if (!af) return;
    await markScheduled(af.id);
    startAuto(af, "schedule");
  } catch (e) { console.error("자동화 일정 확인 실패:", e.message); }
}, 60_000).unref();

// 한 시간 넘게 시작하지 않은 업로드는 지운다
setInterval(() => {
  for (const [t, it] of staged) {
    if (Date.now() - it.at > 3600_000) { staged.delete(t); fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
  }
}, 600_000).unref();

function broadcast(evt) {
  const e = { time: new Date().toISOString(), ...evt };
  history.push(e); if (history.length > 300) history.shift();
  for (const res of clients) res.write(`data: ${JSON.stringify(e)}\n\n`);
}

/** 작업 시작. key 를 주면 같이 도는 작업, 안 주면 혼자 도는 작업. 겹치면 바로(동기) 409 를 던진다 */
const reqCtx = new AsyncLocalStorage(); // 작업을 시작한 요청 주소 — 제작 기록에 "어디서 열지"를 남긴다
function startJob(kind, label, fn, key = null) {
  const reqPath = reqCtx.getStore()?.p || "";
  if (key) {
    const hit = jobList().find((j) => j.key && keyOverlap(j.key, key));
    if (hit) throw Object.assign(new Error(`같은 대상의 작업이 진행 중입니다: ${hit.label}`), { status: 409 });
    if (jobList().filter((j) => j.key).length >= MAX_PARALLEL) throw Object.assign(new Error(`동시에 ${MAX_PARALLEL}개까지 돌릴 수 있습니다. 하나가 끝나면 다시 눌러 주세요`), { status: 409 });
  } else if (solo) throw Object.assign(new Error(`다른 작업이 진행 중입니다: ${solo.label}`), { status: 409 });
  const j = { id: `j${++jobSeq}`, kind, label, startedAt: Date.now(), key };
  jobs.set(j.id, j);
  if (!key) solo = j;
  broadcast({ type: "job", state: "start", kind, job: j.id, shared: !!key, message: `시작: ${label}` });
  return (async () => {
    try {
      const result = await fn((e) => broadcast({ type: "log", job: j.id, ...e }));
      broadcast({ type: "job", state: "done", kind, job: j.id, shared: !!key, message: `완료: ${label}`, result });
      addHistory({ kind, label, state: "done", startedAt: j.startedAt, reqPath, result });
      return result;
    } catch (e) {
      broadcast({ type: "job", state: "error", kind, job: j.id, shared: !!key, message: `실패: ${label} — ${e.message}` });
      addHistory({ kind, label, state: "error", startedAt: j.startedAt, reqPath, error: e.message });
      throw e;
    } finally {
      jobs.delete(j.id);
      if (solo === j) solo = null;
    }
  })();
}

// ── 유틸 ─────────────────────────────────────────────
const send = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
const body = (req) => new Promise((ok, fail) => {
  let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
});

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) { // 영상 탐색용
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${st.size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
}

// 경로가 root 밖으로 나가지 않게
const inside = (root, rel) => {
  const p = path.resolve(root, "." + path.sep + rel);
  return p.startsWith(root + path.sep) || p === root ? p : null;
};

// ── 라우팅 ───────────────────────────────────────────
const server = http.createServer((req, res) => reqCtx.run({ p: decodeURIComponent(new URL(req.url, "http://x").pathname) }, () => handle(req, res)));
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  // 이 PC 의 브라우저에서 이 주소로 연 화면만 받는다 — 다른 웹사이트가 몰래 요청을 보내 Claude·힉스필드를 돌리지 못하게
  const host = (req.headers.host || "").replace(/:\d+$/, ""), origin = req.headers.origin;
  if (!["localhost", "127.0.0.1"].includes(host) || (origin && !new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${PORT}$`).test(origin))) return send(res, 403, { error: "forbidden" });
  try {
    if (p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ type: "hello", jobs: jobList(), history: history.slice(-80) })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (p === "/api/explore") return send(res, 200, await explore());
    if (p === "/api/vary/assets") return send(res, 200, await variantAssets());
    if (p === "/api/history") return send(res, 200, await listHistory({ menu: url.searchParams.get("menu") || "", state: url.searchParams.get("state") || "", q: url.searchParams.get("q") || "" }));
    // ── 처음 설정 (lib/setup.js · public/setup.js) ──
    if (p === "/api/setup" && req.method === "GET") return send(res, 200, await setupStatus());
    if (p === "/api/setup/claude" && req.method === "POST") return send(res, 200, await checkClaude().catch((e) => ({ ok: false, text: e.message })));
    if (p === "/api/setup/hf" && req.method === "POST") return send(res, 200, await checkHiggsfield().catch((e) => ({ ok: false, text: e.message })));
    if (p === "/api/setup/install" && req.method === "POST") {
      const { id } = await body(req);
      if (!INSTALLABLE.includes(id)) return send(res, 400, { error: "설치할 수 없는 항목입니다" });
      const j = startJob("setup", `설치: ${{ ffmpeg: "ffmpeg", ytdlp: "yt-dlp", whisper: "음성 인식(whisper)", claude: "Claude Code" }[id]}`, (emit) => runInstall(id, emit)); j.catch(() => {});
      return send(res, 202, { started: true });
    }
    if (p === "/api/setup/login" && req.method === "POST") return send(res, 200, await openClaudeLogin());
    if (p === "/api/setup/pick" && req.method === "POST") return send(res, 200, { path: await pickFolder() });
    if (p === "/api/setup/data" && req.method === "POST") {
      if (solo || jobs.size) return send(res, 409, { error: "진행 중인 작업이 끝난 뒤에 바꿔 주세요" });
      const r = await setDataDir((await body(req)).path);
      send(res, 200, r);
      if (r.restart) setTimeout(() => process.exit(75), 300); // start.js 가 새 폴더로 다시 켠다
      return;
    }
    if (p === "/api/status") return send(res, 200, { dataDir: DATA_DIR, dataDirSet: DATA_DIR_SET, job: solo, jobs: jobList(), tools: await toolStatus() });
    if (p === "/api/brands" && req.method === "GET") return send(res, 200, await listBrands());
    if (p === "/api/brands" && req.method === "POST") return send(res, 200, await addBrand(await body(req)));

    let m;
    if ((m = p.match(/^\/api\/brands\/(\w+)$/)) && req.method === "DELETE") { await removeBrand(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/brands\/(\w+)\/ads$/))) {
      const brand = await getBrand(m[1]);
      return brand ? send(res, 200, await listAds(brand)) : send(res, 404, { error: "브랜드 없음" });
    }
    if ((m = p.match(/^\/api\/brands\/(\w+)\/collect$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      if (!brand) return send(res, 404, { error: "브랜드 없음" });
      const opts = await body(req);
      opts.limit = Math.max(1, Math.min(50, Number(opts.limit) || 5));
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      // 오래 걸리므로 바로 응답하고, 진행은 /api/events 로 흘려보낸다
      startJob("collect", `${brand.name} 광고 ${opts.limit}개 수집`, (emit) => collectBrand(brand, opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 다시 분석: { dir } 이면 광고 하나, 없으면 브랜드 전체 (missingOnly 면 화면 글자 없는 것만)
    if ((m = p.match(/^\/api\/brands\/(\w+)\/reanalyze$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      if (!brand) return send(res, 404, { error: "브랜드 없음" });
      const opts = await body(req);
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const label = opts.dir ? `다시 분석 ${opts.dir}` : `${brand.name} ${opts.missingOnly ? "글자 없는 광고" : "전체"} 다시 분석`;
      startJob("collect", label, (emit) => reanalyze(brand, opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }

    // 직접 분석: 링크 (여러 개면 차례로 하나씩, 실패한 링크는 기록만 남기고 다음으로)
    if (p === "/api/analyze/url" && req.method === "POST") {
      const { url: one, urls, whisper = true, ocr = true } = await body(req);
      const list = [...new Set([].concat(urls || one || []).flatMap((x) => String(x).split(/\s+/)).filter(Boolean))];
      if (!list.length) return send(res, 400, { error: "링크가 필요합니다" });
      if (list.length > 30) return send(res, 400, { error: "한 번에 30개까지 넣을 수 있습니다" });
      const bad = list.filter((x) => !/^https?:\/\/\S+$/i.test(x));
      if (bad.length) return send(res, 400, { error: `링크 형식이 아닙니다: ${bad.slice(0, 3).join(", ")}` });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const label = list.length === 1 ? `링크 분석 ${list[0].slice(0, 60)}` : `링크 ${list.length}개 분석`;
      startJob("collect", label, async (emit) => {
        const saved = [];
        for (const [i, link] of list.entries()) {
          if (list.length > 1) emit({ message: `링크 ${i + 1}/${list.length}: ${link}` });
          try { saved.push(...(await analyzeUrl(link, { whisper, ocr }, emit)).saved); }
          catch (e) { emit({ level: "error", message: `${link}: ${e.message}` }); }
        }
        return { saved };
      }).catch(() => {});
      return send(res, 202, { started: true, count: list.length });
    }
    // 직접 분석: 파일 업로드 — ① 파일마다 올려 두고(토큰) ② 토큰 묶음으로 작업 하나를 시작
    // 링크로 이미지 받기 (레퍼런스): { url } → { token, name } — 이미지 주소가 아니면 페이지의 og:image 를 찾는다
    if (p === "/api/uploads/url" && req.method === "POST") {
      let { url: link = "" } = await body(req);
      if (!/^https?:\/\//i.test(link)) return send(res, 400, { error: "http(s) 링크를 넣으세요" });
      const get = (u) => fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      let r = await get(link);
      if (!r.ok) return send(res, 400, { error: `받지 못했습니다 (${r.status})` });
      if (!/^image\//.test(r.headers.get("content-type") || "")) {
        const html = (await r.text()).slice(0, 400_000);
        const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
        if (!og) return send(res, 400, { error: "이 링크에서 이미지를 찾지 못했습니다 — 이미지 주소를 넣거나 파일로 올리세요" });
        link = new URL(og[1].replace(/&amp;/g, "&"), link).href;
        r = await get(link);
        if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "")) return send(res, 400, { error: "이미지를 받지 못했습니다" });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 25 * 1024 * 1024) return send(res, 400, { error: "25MB 넘는 이미지는 받지 않습니다" });
      const ext = ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[r.headers.get("content-type").split(";")[0]] || "jpg";
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mac-up-"));
      const file = path.join(dir, "file");
      await fsp.writeFile(file, buf);
      const name = `${(new URL(link).pathname.split("/").pop() || "reference").replace(/\.[^.]+$/, "").replace(/[^\w가-힣-]+/g, "_").slice(0, 40) || "reference"}.${ext}`;
      const token = path.basename(dir);
      staged.set(token, { file, name, at: Date.now() });
      return send(res, 200, { token, name, from: link });
    }
    if (p === "/api/uploads" && req.method === "POST") {
      const name = url.searchParams.get("name") || "upload.bin";
      // 리소스용 업로드는 음성·문서도 받는다
      const okExt = url.searchParams.get("purpose") === "resource"
        ? /^(jpe?g|png|webp|gif|mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|ogg|pdf|txt|md)$/.test(extOf(name))
        : !!kindOf(extOf(name));
      if (!okExt) { req.resume(); return send(res, 400, { error: `지원하지 않는 파일 형식: ${name}` }); }
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mac-up-"));
      const file = path.join(dir, "file");
      await new Promise((ok, fail) => { const w = fs.createWriteStream(file); req.pipe(w); w.on("finish", ok); w.on("error", fail); req.on("error", fail); });
      const token = path.basename(dir);
      staged.set(token, { file, name, at: Date.now() });
      return send(res, 200, { token });
    }
    if (p === "/api/analyze/uploads" && req.method === "POST") {
      const { tokens = [], whisper = true, ocr = true } = await body(req);
      const items = tokens.map((t) => staged.get(t)).filter(Boolean);
      if (!items.length) return send(res, 400, { error: "올린 파일이 없습니다" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      tokens.forEach((t) => staged.delete(t));
      const label = items.length === 1 ? `파일 분석 ${items[0].name}` : `파일 ${items.length}개 분석`;
      startJob("collect", label, async (emit) => {
        const saved = [];
        for (const [i, it] of items.entries()) {
          if (items.length > 1) emit({ message: `파일 ${i + 1}/${items.length}: ${it.name}` });
          try { saved.push(...(await analyzeUpload(it.file, it.name, { whisper, ocr }, emit)).saved); }
          catch (e) { emit({ level: "error", message: `${it.name}: ${e.message}` }); }
          finally { await fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
        }
        return { saved };
      }).catch(() => {});
      return send(res, 202, { started: true, count: items.length });
    }

    // 변형 추천: { dir, image, resources: { product, person, background }, brief } → 작업 완료 이벤트 result { suggest: true }
    if ((m = p.match(/^\/api\/brands\/(\w+)\/prompts\/suggest$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      const b = await body(req);
      if (!brand || !b.dir || !b.image) return send(res, 400, { error: "광고와 이미지를 지정하세요" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startJob("prompts", `변형 추천 ${b.dir}`, (emit) => suggestVariants(brand, b.dir, b, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 이미지 변형 에셋으로 저장: { dir } — 프롬프트가 있으면 바로(200), 없으면 분석부터 하는 작업으로(202)
    if ((m = p.match(/^\/api\/brands\/(\w+)\/vary-asset$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      const { dir } = await body(req);
      if (!brand || !dir) return send(res, 400, { error: "광고를 지정하세요" });
      if (await hasImagePrompts(brand, dir)) return send(res, 200, await registerVaryAsset(brand, dir));
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startJob("prompts", `이미지 변형 에셋 만들기 ${dir}`, (emit) => registerVaryAsset(brand, dir, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 장면별 프롬프트: { dir, topic } — 광고 하나를 컷마다(이미지는 장마다) 생성 프롬프트로
    if ((m = p.match(/^\/api\/brands\/(\w+)\/prompts$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      const { dir, topic = "" } = await body(req);
      if (!brand || !dir) return send(res, 400, { error: "광고를 지정하세요" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startJob("prompts", `장면별 프롬프트 ${dir}`, (emit) => createPrompts(brand, dir, { topic }, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }

    // 소재 바꿔 만들기 (이미지): { dir, image, resources: { product, person, background }, tokens, texts, note }
    // 원본 이미지 속 소재 위치 읽기: { dir, image } → { subjects } (prompts.json 에 저장)
    if ((m = p.match(/^\/api\/brands\/(\w+)\/prompts\/subjects$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      const { dir, image } = await body(req);
      if (!brand || !dir || !image) return send(res, 400, { error: "광고와 이미지를 지정하세요" });
      return send(res, 200, await detectSubjects(brand, dir, image));
    }
    if ((m = p.match(/^\/api\/brands\/(\w+)\/prompts\/variants$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      const { tokens = [], roleTokens = {}, ...opts } = await body(req);
      if (!brand || !opts.dir || !opts.image) return send(res, 400, { error: "광고와 이미지를 지정하세요" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const take = (list) => { const items = (list || []).map((t) => staged.get(t)).filter(Boolean); (list || []).forEach((t) => staged.delete(t)); return items; };
      const items = take(tokens);
      const roleItems = Object.fromEntries(["person", "product", "background"].map((k) => [k, take(roleTokens[k])]));
      opts.uploads = items.map((it) => ({ tmp: it.file, name: it.name }));
      opts.roleUploads = Object.fromEntries(Object.entries(roleItems).map(([k, v]) => [k, v.map((it) => ({ tmp: it.file, name: it.name }))]));
      const cleanup = () => [...items, ...Object.values(roleItems).flat()].forEach((it) => fsp.rm(path.dirname(it.file), { recursive: true, force: true }));
      startJob("prompts", `소재 바꿔 만들기 ${opts.dir}`, (emit) => createVariant(brand, opts.dir, opts, emit)).catch(() => {}).finally(cleanup);
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/brands\/(\w+)\/prompts\/variants\/delete$/)) && req.method === "POST") {
      const brand = await getBrand(m[1]);
      const { dir, vid } = await body(req);
      if (!brand) return send(res, 404, { error: "브랜드 없음" });
      await deleteVariant(brand, dir, vid); return send(res, 200, { ok: true });
    }

    // ── 경쟁사 찾기 ──
    if (p === "/api/competitors" && req.method === "GET") return send(res, 200, await listCompetitorSearches());
    if (p === "/api/competitors" && req.method === "POST") {
      const opts = await body(req);
      if (!opts.query?.trim()) return send(res, 400, { error: "찾을 제품·서비스를 적으세요" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startJob("competitors", `경쟁사 찾기 "${opts.query}"`, (emit) => findCompetitors(opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/competitors\/(cmp_\d+)$/)) && req.method === "DELETE") {
      await deleteCompetitorSearch(m[1]); return send(res, 200, { ok: true });
    }

    // ── 템플릿 ──
    if (p === "/api/templates" && req.method === "GET") return send(res, 200, await listTemplates());
    if (p === "/api/templates" && req.method === "POST") {
      const { brandId, dir, kind } = await body(req);
      const brand = await getBrand(brandId);
      if (!brand || !dir) return send(res, 400, { error: "광고를 지정하세요" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      // 드라마 템플릿: 이야기 구조(인물·비트·반전)를 뽑는다
      if (kind === "drama") {
        startJob("template", `드라마 템플릿 만들기 ${dir}`, (emit) => createDramaTemplate(brand, dir, emit)).catch(() => {});
        return send(res, 202, { started: true });
      }
      // 영상이 있으면 영상 템플릿, 이미지뿐이면 카드뉴스 템플릿
      const a = await readJson(path.join(brandDir(brand), dir, "analysis.json"), {});
      const cardnews = !a.videos?.length;
      // kind "auto": 영상이 상황극형이면 드라마 템플릿, 광고형이면 영상 템플릿 — Claude 가 먼저 고른다
      if (kind === "auto" && !cardnews) {
        startJob("template", `템플릿 만들기 ${dir}`, async (emit) => {
          emit({ message: "Claude 가 광고형인지 상황극형인지 보는 중" });
          const style = await guessVideoStyle(brand, dir);
          emit({ message: style === "drama" ? "상황극형 — 이야기 구조로 저장합니다" : "광고형 — 컷 구조로 저장합니다" });
          return style === "drama" ? createDramaTemplate(brand, dir, emit) : createTemplate(brand, dir, emit);
        }).catch(() => {});
        return send(res, 202, { started: true });
      }
      startJob("template", `${cardnews ? "카드뉴스 " : ""}템플릿 만들기 ${dir}`, (emit) => (cardnews ? createCardTemplate : createTemplate)(brand, dir, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 카드뉴스 만들기: { topic, details, tokens(이미지) }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cards$/))) {
      if (req.method === "GET") return send(res, 200, await listCards(m[1]));
      if (req.method === "POST") {
        const { tokens = [], ...opts } = await body(req);
        if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
        const items = tokens.map((t) => staged.get(t)).filter(Boolean);
        tokens.forEach((t) => staged.delete(t));
        opts.uploads = items.map((it) => ({ tmp: it.file, name: it.name }));
        const cleanup = () => items.forEach((it) => fsp.rm(path.dirname(it.file), { recursive: true, force: true }));
        startJob("cardnews", `카드뉴스 만들기 "${opts.topic || ""}"`, (emit) => makeCards(m[1], opts, emit)).catch(() => {}).finally(cleanup);
        return send(res, 202, { started: true });
      }
    }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cards\/(c_\d+)$/))) {
      if (req.method === "PUT") return send(res, 200, await saveCard(m[1], m[2], await body(req)));
      if (req.method === "DELETE") { await deleteCard(m[1], m[2]); return send(res, 200, { ok: true }); }
    }
    // 만든 카드뉴스 장에 사진·영상 넣기: { token } (먼저 /api/uploads?purpose=resource 로 올린다)
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cards\/(c_\d+)\/media$/)) && req.method === "POST") {
      const { token } = await body(req);
      const it = staged.get(token);
      if (!it) return send(res, 400, { error: "올린 파일이 없습니다" });
      staged.delete(token);
      try { return send(res, 200, await addCardMedia(m[1], m[2], { tmp: it.file, name: it.name })); }
      finally { fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    // 영상 장 합성: { n, video, data(글자 층 PNG), width, height }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cards\/(c_\d+)\/video$/)) && req.method === "POST") {
      return send(res, 200, await saveCardVideo(m[1], m[2], await body(req)));
    }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cards\/(c_\d+)\/png$/)) && req.method === "POST") {
      const { n, data } = await body(req);
      return send(res, 200, await saveCardPng(m[1], m[2], Number(n), data));
    }
    // 주제 추천: { mode, kitId, links, keyword } → { topics[], notes } (저장하지 않는다)
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/suggest$/)) && req.method === "POST") return send(res, 200, await suggestTopics(m[1], await body(req)));
    // AI로 고치기: { instruction, template(편집 중인 상태) } → 고친 안 (저장하지 않는다)
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/ai-edit$/)) && req.method === "POST") return send(res, 200, await aiEditTemplate(m[1], await body(req)));
    if (p === "/api/cards" && req.method === "GET") return send(res, 200, await listAllCards());
    // ── 영상 복제하기 (lib/clone.js) — 광고 수집과 따로 ──
    if (p === "/api/clones" && req.method === "GET") return send(res, 200, await listClones());
    // 새로: { url } 또는 { token } (먼저 /api/uploads 로 올린다) → 받기·분석을 작업으로 돌리고 { id } 를 바로 준다
    if (p === "/api/clones" && req.method === "POST") {
      const { url: link = "", token, whisper = true, ocr = true } = await body(req);
      const it = token ? staged.get(token) : null;
      if (!it && !/^https?:\/\/\S+$/i.test(link.trim())) return send(res, 400, { error: "영상 링크나 파일을 넣으세요" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      if (it) staged.delete(token);
      const c = await createClone({ url: it ? "" : link.trim(), name: it?.name || "" });
      startJob("clone", `영상 복제 분석 ${c.title}`, (emit) => runCloneAnalyze(c.id, { url: it ? "" : link.trim(), upload: it, whisper, ocr }, emit))
        .catch(() => {}).finally(() => { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); });
      return send(res, 202, { id: c.id });
    }
    if ((m = p.match(/^\/api\/clones\/(cl_\d+)$/))) {
      if (req.method === "GET") { const x = await getClone(m[1]); return x ? send(res, 200, x) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updateClone(m[1], await body(req)));
      if (req.method === "DELETE") { await deleteClone(m[1]); return send(res, 200, { ok: true }); }
    }
    // 작업: elements(바꿀 것 다시 찾기) · prompts(프롬프트 만들기)
    if ((m = p.match(/^\/api\/clones\/(cl_\d+)\/(elements|prompts)$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const fn = m[2] === "elements" ? reanalyzeElements : makeClonePrompts;
      startJob("clone", m[2] === "elements" ? "바꿀 수 있는 것 다시 찾기" : "영상 복제 프롬프트 만들기", (emit) => fn(m[1], emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 바꿀 이미지: { el, token | resource:{kind,id} | clear }
    if ((m = p.match(/^\/api\/clones\/(cl_\d+)\/swap$/)) && req.method === "POST") {
      const b = await body(req), it = b.token ? staged.get(b.token) : null;
      if (b.token && !it) return send(res, 400, { error: "파일을 먼저 올리세요" });
      if (it) staged.delete(b.token);
      try { return send(res, 200, await setSwap(m[1], { el: b.el, clear: !!b.clear, resource: b.resource, slot: b.slot === "face" ? "face" : "", crop: b.crop && typeof b.crop === "object" ? b.crop : null, ...(it ? { src: it.file, name: it.name } : {}) })); }
      finally { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    if ((m = p.match(/^\/api\/clones\/(cl_\d+)\/restore$/)) && req.method === "POST") return send(res, 200, await restoreClonePrompts(m[1], String((await body(req)).at || "")));
    // ── 인물 라디오 (lib/radio.js) ──
    if (p === "/api/radio-voice-preview" && req.method === "POST") return send(res, 200, await previewVoice((await body(req)).voice));
    if (p === "/api/radio-sets" && req.method === "GET") return send(res, 200, await listRadioSets());
    if ((m = p.match(/^\/api\/radio-sets\/(rs_\d+)$/)) && req.method === "DELETE") { await deleteRadioSet(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)\/save-set$/)) && req.method === "POST") return send(res, 200, await saveRadioSet(m[1], await body(req)));
    if (p === "/api/radios" && req.method === "GET") return send(res, 200, await listRadios());
    if (p === "/api/radios" && req.method === "POST") return send(res, 200, await createRadio(await body(req)));
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)$/))) {
      if (req.method === "GET") { const x = await getRadio(m[1]); return x ? send(res, 200, x) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updateRadio(m[1], await body(req)));
      if (req.method === "DELETE") { await deleteRadio(m[1]); return send(res, 200, { ok: true }); }
    }
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)\/topics$/)) && req.method === "POST") return send(res, 200, await suggestRadioTopics(m[1], await body(req)));
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)\/refine$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const b = await body(req);
      startJob("radio", "인물 라디오 프롬프트 다듬기", (emit) => refineRadioPrompt(m[1], b, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 작업: script(대본) · voice(목소리) · revoice{n} · prompts(장면 프롬프트) · render(합치기)
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)\/(script|voice|revoice|prompts|render)$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const b = await body(req), fn = { script: writeRadioScript, voice: voiceRadio, prompts: writeRadioPrompts, render: renderRadio }[m[2]];
      const label = { script: "인물 라디오 대본", voice: "인물 라디오 목소리", revoice: `인물 라디오 줄 ${b.n} 다시 읽기`, prompts: "인물 라디오 장면 프롬프트", render: "인물 라디오 mp4 합치기" }[m[2]];
      startJob("radio", label, (emit) => (m[2] === "revoice" ? revoiceLine(m[1], b.n, emit) : fn(m[1], emit))).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 진행자 사진: { i, token | resource:{kind,id} | collected:{brandId,dir,file} } · 장면 올리기: { n, field, token }
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)\/(cast-photo|scene)$/)) && req.method === "POST") {
      const b = await body(req), it = b.token ? staged.get(b.token) : null;
      if (b.token && !it) return send(res, 400, { error: "파일을 먼저 올리세요" });
      if (it) staged.delete(b.token);
      try {
        if (m[2] === "scene") return send(res, 200, await setRadioScene(m[1], b.n, b.field, it.file, it.name));
        return send(res, 200, await setCastPhoto(m[1], b.i, { pid: b.pid, ...(it ? { src: it.file, name: it.name } : { resource: b.resource, collected: b.collected }) }));
      } finally { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    if ((m = p.match(/^\/api\/radios\/(ra_\d+)\/srt$/))) { const x = await getRadio(m[1]); res.writeHead(200, { "content-type": "application/x-subrip; charset=utf-8", "content-disposition": `attachment; filename="radio.srt"` }); return res.end(radioSrt(x)); }
    // ── 포스터 이미지 (lib/poster.js) ──
    if (p === "/api/poster-meta") return send(res, 200, { sizes: POSTER_SIZES, styles: POSTER_STYLES, kits: await listKits() });
    if (p === "/api/collected-images") return send(res, 200, await collectedImages());
    // 포스터 템플릿: 목록(내 포스터 템플릿 + 카드뉴스 템플릿) · 저장 { posterId, name } · 지우기 · 입히기 { tid }
    if (p === "/api/poster-templates" && req.method === "GET") return send(res, 200, await listPosterTemplates());
    if (p === "/api/poster-templates" && req.method === "POST") { const b = await body(req); return send(res, 200, await savePosterTemplate(b.posterId, b.name)); }
    if ((m = p.match(/^\/api\/poster-templates\/(ptpl_\d+)$/)) && req.method === "DELETE") { await deletePosterTemplate(m[1]); return send(res, 200, { ok: true }); }
    // 템플릿 입히기 → 카드뉴스 템플릿이면 Claude 가 소재·배치를 뽑는 작업을 바로 시작한다
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/template$/)) && req.method === "POST") {
      const x = await applyPosterTemplate(m[1], String((await body(req)).tid || ""));
      if (x.template?.needs_layout && !solo) startJob("poster", "템플릿 소재 뽑기 (최초 1회)", (emit) => analyzePosterTemplate(m[1], {}, emit)).catch(() => {});
      return send(res, 200, x);
    }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/(analyze|edit|final)$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const b = await body(req);
      if (m[2] === "analyze") startJob("poster", "템플릿 소재 다시 뽑기", (emit) => analyzePosterTemplate(m[1], { force: true }, emit)).catch(() => {});
      else if (m[2] === "final") startJob("poster", "최종 이미지 프롬프트", (emit) => writeFinalPrompt(m[1], b, emit)).catch(() => {});
      else startJob("poster", `포스터 고치기 "${String(b.instruction || "").slice(0, 20)}"`, (emit) => editPosterNL(m[1], b, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/undo$/)) && req.method === "POST") return send(res, 200, await undoPoster(m[1]));
    // 저장(버전): { memo, preview } · 되돌리기: { vid }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/versions\/(v_\d+)$/)) && req.method === "GET") return send(res, 200, await posterVersion(m[1], m[2]));
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/save$/)) && req.method === "POST") return send(res, 200, await savePosterVersion(m[1], await body(req)));
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/restore$/)) && req.method === "POST") return send(res, 200, await restorePosterVersion(m[1], String((await body(req)).vid || "")));
    // 내 이미지 추가: { token, name }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/asset$/)) && req.method === "POST") {
      const { token, name } = await body(req), it = staged.get(token);
      if (!it) return send(res, 400, { error: "이미지를 먼저 올리세요" });
      staged.delete(token);
      try { return send(res, 200, await addPosterAsset(m[1], it.file, it.name, name)); }
      finally { fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    // 사진 칸에 내 사진: { token, key }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/layer-image$/)) && req.method === "POST") {
      const { token, key } = await body(req), it = staged.get(token);
      if (!it) return send(res, 400, { error: "사진을 먼저 올리세요" });
      staged.delete(token);
      try { return send(res, 200, await setLayerImage(m[1], String(key), it.file, it.name)); }
      finally { fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    if (p === "/api/poster-log") return send(res, 200, await posterLog());
    if (p === "/api/posters" && req.method === "GET") return send(res, 200, await listPosters());
    if (p === "/api/posters" && req.method === "POST") return send(res, 200, await createPoster(await body(req)));
    if ((m = p.match(/^\/api\/posters\/(po_\d+)$/))) {
      if (req.method === "GET") { const x = await getPoster(m[1]); return x ? send(res, 200, x) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updatePoster(m[1], await body(req)));
      if (req.method === "DELETE") { await deletePoster(m[1]); return send(res, 200, { ok: true }); }
    }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/copy$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startJob("poster", "포스터 카피 쓰기", (emit) => writePosterCopy(m[1], emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 배경·참고 이미지: { token } (먼저 /api/uploads?purpose=resource 로 올린다)
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/(bg|ref)$/)) && req.method === "POST") {
      const { token } = await body(req), it = staged.get(token);
      if (!it) return send(res, 400, { error: "파일을 먼저 올리세요" });
      staged.delete(token);
      try { return send(res, 200, await (m[2] === "bg" ? addPosterBg : addPosterRef)(m[1], it.file, it.name)); }
      finally { fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    // 수집한 이미지 가져오기: { brandId, dir, file, as: "bg" | "ref" }
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/import-res$/)) && req.method === "POST") return send(res, 200, await importResource(m[1], await body(req)));
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/import$/)) && req.method === "POST") return send(res, 200, await importCollected(m[1], await body(req)));
    if ((m = p.match(/^\/api\/posters\/(po_\d+)\/png$/)) && req.method === "POST") return send(res, 200, await savePosterPng(m[1], (await body(req)).data));
    // ── 힉스필드 (MCP / API) ──
    if (p === "/api/hf/settings" && req.method === "GET") return send(res, 200, await getHfSettings());
    if (p === "/api/hf/video-models") return send(res, 200, VIDEO_MODELS); // 드라마 영상 단계의 모델·해상도·소리 칸
    if (p === "/api/hf/image-models") return send(res, 200, IMAGE_MODELS); // 인물 만들기 위저드의 모델·비율·해상도·품질 칸
    if (p === "/api/hf/settings" && req.method === "PUT") return send(res, 200, await setHfSettings(await body(req)));
    // { target, kind, purpose, prompt, refs, aspect, duration } — 크레딧이 드는 생성. 화면에서 확인을 받은 뒤에만 부른다
    if (p === "/api/hf/generate" && req.method === "POST") {
      const { target, ...r } = await body(req);
      // 드라마 칸(시트·장면)은 칸마다 같이 돈다. 다른 대상은 파일을 통째로 고쳐 써서 예전처럼 혼자 돈다
      const key = target?.type === "drama" && target.slot ? `hfdrama:${target.id}:${target.slot}` : null;
      if (!key && solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const mode = (await getHfSettings()).mode.toUpperCase();
      const what = key ? ` · ${String(target.slot).replace(/^asset:/, "시트 ").replace(/^shot:(\d+):/, "컷 $1 ")}` : "";
      startJob("hf", `힉스필드(${mode}) ${r.kind === "video" ? "영상" : "이미지"} 만들기${what}`, (emit) => runHf(target || {}, r, emit), key).catch(() => {});
      return send(res, 202, { started: true });
    }
    // ── 목소리 만들기 (이 PC 의 Qwen3-TTS) ──
    // 영상 메뉴의 목소리 고르기: 저장한 목소리 · 복제 · 기본
    if (p === "/api/voice/choices") return send(res, 200, await voiceChoices());
    if (p === "/api/voice/status") return send(res, 200, { ...(await voiceStatus()), speakers: SPEAKERS, styles: STYLES, profiles: await listProfiles() });
    // 모델 받기 (약 2GB 씩) — 화면에서 용량을 보여 주고 확인을 받은 뒤에만 부른다
    if (p === "/api/voice/download" && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startJob("voice", "목소리 모델 받기", (emit) => downloadModels(emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 복제: { token(녹음 파일), name, refText, language, consent }
    if (p === "/api/voice/clone" && req.method === "POST") {
      const b = await body(req);
      if (!b.consent) return send(res, 400, { error: "본인 목소리이거나 허락받은 목소리인지 확인해 주세요" });
      const it = staged.get(b.token);
      if (!it) return send(res, 400, { error: "녹음 파일을 먼저 올리세요" });
      try { return send(res, 200, await cloneVoice({ name: b.name, tmp: it.file, refText: b.refText || "", language: b.language })); }
      finally { staged.delete(b.token); fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    if ((m = p.match(/^\/api\/voice\/profiles\/(vp_\d+)$/)) && req.method === "DELETE") { await deleteProfile(m[1]); return send(res, 200, { ok: true }); }
    // 문장 읽기: { text, speaker, instruct | profileId, language } → { file } (DATA_DIR/_voices)
    if (p === "/api/voice/speak" && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const b = await body(req);
      return send(res, 200, await startJob("voice", `목소리 만들기 "${String(b.text || "").slice(0, 20)}"`, (emit) => speak(b, emit)));
    }
    if (p === "/api/voice/save" && req.method === "POST") return send(res, 200, await saveVoiceResource(await body(req)));
    // 유튜브에서 목소리 가져오기 (lib/ytaudio.js): { url, start, end, denoise } → { file, url, title, duration, range, text } · 저장: { file, name, source, range, text }
    if (p === "/api/voice/youtube" && req.method === "POST") return send(res, 200, await extractYoutubeAudio(await body(req)));
    if (p === "/api/voice/youtube/save" && req.method === "POST") return send(res, 200, await saveYoutubeVoice(await body(req)));
    // 제품 합성 결과 저장 { dir, vid, data }
    if ((m = p.match(/^\/api\/brands\/(\w+)\/prompts\/variants\/composite$/)) && req.method === "POST") {
      const { dir, vid, data } = await body(req);
      return send(res, 200, await saveComposite(m[1], dir, vid, data));
    }
    // ── 3D 설명 영상 (코드로 그리는 쇼츠) ──
    if (p === "/api/explainers" && req.method === "GET") return send(res, 200, await listExplainers());
    if ((m = p.match(/^\/api\/explainer-lib\/(\w+)(?:\/([\w-]+))?$/))) {
      if (req.method === "GET" && !m[2]) return send(res, 200, await listLib(m[1]));
      if (req.method === "POST" && !m[2]) return send(res, 200, await saveLib(m[1], await body(req)));
      if (req.method === "DELETE" && m[2]) { await listLib(m[1]); await deleteLib(m[1], m[2]); return send(res, 200, { ok: true }); }
    }
    if (p === "/api/explainers" && req.method === "POST") return send(res, 200, await createExplainer(await body(req)));
    if ((m = p.match(/^\/api\/explainers\/(ex_\d+)$/))) {
      if (req.method === "GET") { const x = await getExplainer(m[1]); return x ? send(res, 200, x) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updateExplainer(m[1], await body(req)));
      if (req.method === "DELETE") { await deleteExplainer(m[1]); return send(res, 200, { ok: true }); }
    }
    if ((m = p.match(/^\/api\/explainers\/(ex_\d+)\/(script|voice)$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const opts = await body(req);
      if (m[2] === "script") startJob("explain", "설명 영상 대본", (emit) => writeScript(m[1], emit)).catch(() => {});
      else startJob("explain", "설명 영상 음성", (emit) => draftVoice(m[1], opts.voice, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 음성 파일·녹화 webm 은 본문 그대로 받는다
    if ((m = p.match(/^\/api\/explainers\/(ex_\d+)\/(audio|render)$/)) && req.method === "POST") {
      if (m[2] === "audio" && solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ex-up-"));
      const file = path.join(tmp, m[2] === "render" ? "rec.webm" : "in" + (path.extname(url.searchParams.get("name") || "") || ".bin"));
      await new Promise((ok, fail) => { const w = fs.createWriteStream(file); req.pipe(w); w.on("finish", ok); w.on("error", fail); req.on("error", fail); });
      const clean = () => fsp.rm(tmp, { recursive: true, force: true });
      if (m[2] === "render") { try { return send(res, 200, await saveRender(m[1], file, url.searchParams.get("q"))); } finally { clean(); } }
      startJob("explain", "음성 올리기·단어 시각", (emit) => setAudio(m[1], file, emit)).catch(() => {}).finally(clean);
      return send(res, 202, { started: true });
    }
    // ── 라디오 팟캐스트 릴스 (lib/podcast.js) ──
    if (p === "/api/podcasts" && req.method === "GET") return send(res, 200, await listPodcasts());
    if (p === "/api/podcasts" && req.method === "POST") return send(res, 200, await createPodcast(await body(req)));
    if ((m = p.match(/^\/api\/podcasts\/(pc_\d+)$/))) {
      if (req.method === "GET") { const x = await getPodcast(m[1]); return x ? send(res, 200, x) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updatePodcast(m[1], await body(req)));
      if (req.method === "DELETE") { await deletePodcast(m[1]); return send(res, 200, { ok: true }); }
    }
    if ((m = p.match(/^\/api\/podcasts\/(pc_\d+)\/(script|voice)$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      await body(req);
      if (m[2] === "script") startJob("podcast", "팟캐스트 대본", (emit) => writePodcastScript(m[1], emit)).catch(() => {});
      else startJob("podcast", "팟캐스트 음성", (emit) => voiceLines(m[1], emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 진행자 사진: { i, token } (먼저 /api/uploads?purpose=resource) 또는 { i, resource: { kind, id } }
    if ((m = p.match(/^\/api\/podcasts\/(pc_\d+)\/host-photo$/)) && req.method === "POST") {
      const b = await body(req), it = b.token ? staged.get(b.token) : null;
      if (!it && !b.resource) return send(res, 400, { error: "사진을 먼저 올리세요" });
      if (it) staged.delete(b.token);
      try { return send(res, 200, await setHostPhoto(m[1], b.i, it ? { src: it.file, name: it.name } : { resource: b.resource })); }
      finally { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    if ((m = p.match(/^\/api\/podcasts\/(pc_\d+)\/audio$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pc-up-"));
      const file = path.join(tmp, "in" + (path.extname(url.searchParams.get("name") || "") || ".bin"));
      await new Promise((ok, fail) => { const w = fs.createWriteStream(file); req.pipe(w); w.on("finish", ok); w.on("error", fail); req.on("error", fail); });
      startJob("podcast", "팟캐스트 음성 올리기", (emit) => setPodcastAudio(m[1], file, emit)).catch(() => {}).finally(() => fsp.rm(tmp, { recursive: true, force: true }));
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/podcast-lib\/(\w+)(?:\/([\w-]+))?$/))) {
      if (req.method === "GET" && !m[2]) return send(res, 200, await podcastLib.list(m[1]));
      if (req.method === "POST" && !m[2]) return send(res, 200, await podcastLib.save(m[1], await body(req)));
      if (req.method === "DELETE" && m[2]) { await podcastLib.list(m[1]); await podcastLib.del(m[1], m[2]); return send(res, 200, { ok: true }); }
    }
    // 굽기: start → frame?i=N (jpg 본문) … → finish
    if ((m = p.match(/^\/api\/podcasts\/(pc_\d+)\/render\/(start|frame|finish)$/)) && req.method === "POST") {
      if (m[2] === "start") { await body(req); return send(res, 200, await renderStart(m[1])); }
      if (m[2] === "frame") { await renderFrame(m[1], url.searchParams.get("i"), req); return send(res, 200, { ok: true }); }
      const b = await body(req); return send(res, 200, await renderFinish(m[1], undefined, b.quality));
    }
    // ── 드라마 스튜디오 ──
    if (p === "/api/dramas" && req.method === "GET") return send(res, 200, await listDramas(url.searchParams.get("kind") || "drama"));
    if (p === "/api/dramas" && req.method === "POST") { const b = await body(req); return send(res, 200, await createDrama(b.inputs || {}, b.kind === "ad" ? "ad" : "drama")); }
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)$/))) {
      if (req.method === "GET") { const d = await getDrama(m[1]); return d ? send(res, 200, d) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updateDrama(m[1], await body(req)));
      if (req.method === "DELETE") { await deleteDrama(m[1]); return send(res, 200, { ok: true }); }
    }
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)\/(ideas|develop|shotlist|fix|auto)$/)) && req.method === "POST") {
      const opts = await body(req);
      const fn = { ideas: draftIdeas, develop: developStory, shotlist: makeShotlist, fix: fixShot, auto: autoPlan }[m[2]];
      const label = { ideas: "릴스 아이디어", develop: "릴스 디벨롭", shotlist: "샷리스트·소재", fix: `컷 ${opts.n} 고치기`, auto: "시트 제작 직전까지 구성하기" }[m[2]];
      startJob("drama", label, (emit) => (m[2] === "ideas" ? fn(m[1], emit) : fn(m[1], opts, emit)), m[2] === "fix" ? `drama:${m[1]}:fix:${Number(opts.n)}` : `drama:${m[1]}`).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 참고 영상: { token } (먼저 /api/uploads) 또는 { url } — 받고 분석하는 작업 (끝나면 drama 작업 완료 이벤트)
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)\/ref$/)) && req.method === "POST") {
      const { token, url: link = "" } = await body(req);
      const it = token ? staged.get(token) : null;
      if (token && !it) return send(res, 400, { error: "올린 파일이 없습니다" });
      if (token) staged.delete(token);
      const id = m[1];
      startJob("drama", "참고 영상 넣기", (emit) => setReference(id, { url: link.trim(), upload: it ? { file: it.file, name: it.name } : null }, emit), `drama:${id}`)
        .catch(() => {}).finally(() => { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); });
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)\/media$/)) && req.method === "POST") {
      const { slot, token } = await body(req);
      const it = token ? staged.get(token) : null;
      if (token && !it) return send(res, 400, { error: "올린 파일이 없습니다" });
      if (token) staged.delete(token);
      try { return send(res, 200, await setDramaMedia(m[1], String(slot || ""), it ? { tmp: it.file, name: it.name } : null)); }
      finally { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    // 썸네일: { n, t } — 컷 n 영상의 t 초 장면을 한 장 뽑는다
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)\/thumb-frame$/)) && req.method === "POST") return send(res, 200, await thumbFrame(m[1], await body(req)));
    // 썸네일 제목 추천 (Claude) — 같은 드라마의 다른 Claude 단계와는 겹치지 않게
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)\/thumbtitles$/)) && req.method === "POST") {
      startJob("drama", "썸네일 제목 추천", (emit) => suggestThumbTitles(m[1], emit), `drama:${m[1]}:thumb`).catch(() => {});
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/dramas\/(d_\d+)\/srt$/)) && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/x-subrip; charset=utf-8", "content-disposition": `attachment; filename="${m[1]}.srt"` });
      return res.end(await dramaSrt(m[1]));
    }
    // 내 템플릿: { copy } — copy 면 복제한 뒤 소재 시트를 뽑는다 → { id }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cast$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const { copy } = await body(req);
      const tid = copy ? (await duplicateTemplate(m[1])).id : m[1];
      if (copy) await saveTemplate(tid, { name: (await getTemplate(tid)).name.replace(/ \(복제\)$/, "") + " (내 템플릿)", my: true });
      startJob("cast", `소재 시트 만들기 ${tid}`, (emit) => buildCastSheet(tid, emit)).catch(() => {});
      return send(res, 202, { id: tid });
    }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/cast\/(\w+)\/image$/)) && req.method === "POST") {
      const { token } = await body(req);
      const it = token ? staged.get(token) : null;
      if (token && !it) return send(res, 400, { error: "올린 파일이 없습니다" });
      if (token) staged.delete(token);
      try { return send(res, 200, await setCastImage(m[1], m[2], it ? { tmp: it.file, name: it.name } : null)); }
      finally { if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    // 내 템플릿 컷별 시작 프레임·영상을 직접 올리기 { shot, field, token }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/my-media$/)) && req.method === "POST") {
      const { shot, field, token } = await body(req);
      const it = staged.get(token);
      if (!it) return send(res, 400, { error: "올린 파일이 없습니다" });
      staged.delete(token);
      try { return send(res, 200, await setMyMedia(m[1], Number(shot), field, it.file, it.name)); }
      finally { fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
    }
    // 주제·대본: 추천(저장 안 함) · 쓰기(작업) · 고친 것 저장
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/my-topics$/)) && req.method === "POST") return send(res, 200, await suggestMyTopics(m[1], await body(req)));
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/my-script$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const opts = await body(req);
      startJob("myscript", `대본 쓰기 "${String(opts.topic || opts.product || "").slice(0, 20)}"`, (emit) => makeMyScript(m[1], opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 목소리: { voice, voiceName, shot? } → 컷별 읽기 + 내레이션 한 줄
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/my-voice$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const opts = await body(req);
      startJob("myvoice", opts.shot != null ? `컷 ${opts.shot} 다시 읽히기` : "대본 읽히기", (emit) => makeMyVoice(m[1], opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/my-script$/)) && req.method === "PUT") return send(res, 200, await saveMyScript(m[1], await body(req)));
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/my-prompts$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const opts = await body(req);
      startJob("cast", `내 소재 프롬프트 ${m[1]}`, (emit) => makeMyPrompts(m[1], opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 드라마 대본: { product, topic, details, cast, length, kitId }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/scripts$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const opts = await body(req);
      startJob("script", `드라마 대본 쓰기 "${opts.product || ""}"`, (emit) => makeScript(m[1], opts, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/scripts\/(s_\d+)$/)) && req.method === "DELETE") { await deleteScript(m[1], m[2]); return send(res, 200, { ok: true }); }
    if (p === "/api/scripts" && req.method === "GET") return send(res, 200, await listAllScripts());
    // 브랜드 키트
    if (p === "/api/kits" && req.method === "GET") return send(res, 200, await listKits());
    if (p === "/api/kits" && req.method === "POST") return send(res, 200, await saveKit(await body(req)));
    if (p === "/api/kit-profile") return send(res, 200, KIT_PROFILE);
    if (p === "/api/kits/autofill" && req.method === "POST") return send(res, 200, await autofillKit(await body(req)));
    if ((m = p.match(/^\/api\/kits\/(kit_\d+)$/)) && req.method === "DELETE") { await deleteKit(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/kits\/(kit_\d+)$/)) && req.method === "PUT") return send(res, 200, await saveKit({ ...(await body(req)), id: m[1] }));
    if ((m = p.match(/^\/api\/kits\/(kit_\d+)\/images$/)) && req.method === "POST") {
      const { tokens = [] } = await body(req);
      const items = tokens.map((t) => staged.get(t)).filter(Boolean);
      tokens.forEach((t) => staged.delete(t));
      try { return send(res, 200, await addKitImages(m[1], items.map((it) => ({ tmp: it.file, name: it.name })))); }
      finally { items.forEach((it) => fsp.rm(path.dirname(it.file), { recursive: true, force: true })); }
    }
    if ((m = p.match(/^\/api\/kits\/(kit_\d+)\/images\/([\w.-]+)$/)) && req.method === "DELETE") return send(res, 200, await deleteKitImage(m[1], m[2]));
    // 자료 링크 묶음
    if (p === "/api/linksets" && req.method === "GET") return send(res, 200, await listLinkSets());
    if (p === "/api/linksets" && req.method === "POST") return send(res, 200, await saveLinkSet(await body(req)));
    if ((m = p.match(/^\/api\/linksets\/(ls_\d+)$/)) && req.method === "DELETE") { await deleteLinkSet(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)\/duplicate$/)) && req.method === "POST") return send(res, 200, await duplicateTemplate(m[1]));
    if ((m = p.match(/^\/api\/templates\/(tpl_\w+)$/))) {
      if (req.method === "GET") { const t = await getTemplate(m[1]); return t ? send(res, 200, t) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await saveTemplate(m[1], await body(req)));
      if (req.method === "DELETE") { await deleteTemplate(m[1]); return send(res, 200, { ok: true }); }
    }

    // ── 이미지 광고 자동화 (lib/autoflow.js · public/autoflow.js) ──
    if (p === "/api/autoflows" && req.method === "GET") return send(res, 200, (await listAutoflows()).map((af) => ({ ...af, next: nextRun(af), running: jobList().some((j) => j.kind === "auto" && j.afId === af.id) })));
    if (p === "/api/autoflows" && req.method === "POST") return send(res, 200, await createAutoflow(await body(req)));
    // 기획 승인 (#auto 기획 승인 탭) — 목록 · 고치기/승인/버리기 · 다시 기획
    if (p === "/api/autoplans" && req.method === "GET") return send(res, 200, await listPlans({ status: url.searchParams.get("status") || undefined, afId: url.searchParams.get("afId") || undefined }));
    if (p === "/api/autoplans/approve" && req.method === "POST") { // { ids } 여러 개 승인
      const { ids = [] } = await body(req); let n = 0;
      for (const id of ids) { try { await updatePlan(id, { status: "approved" }); n++; } catch {} }
      return send(res, 200, { approved: n, started: await kickPlans() });
    }
    if ((m = p.match(/^\/api\/autoplans\/(pl_\d+)$/))) {
      if (req.method === "GET") { const x = await getPlan(m[1]); return x ? send(res, 200, x) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") { const x = await updatePlan(m[1], await body(req)); const started = x.status === "approved" ? await kickPlans() : false; return send(res, 200, { ...x, started }); }
    }
    if ((m = p.match(/^\/api\/autoplans\/(pl_\d+)\/replan$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const { hint = "" } = await body(req);
      startJob("auto", "기획 다시 짜기", (emit) => replan(m[1], String(hint).slice(0, 500), emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 참고 자료·페르소나로 타깃·추가 지시 채우기 (편집 화면 [참고 자료로 타깃·지시 채우기]) — Claude, 저장은 화면에서
    if (p === "/api/autoflows/suggest" && req.method === "POST") {
      try { return send(res, 200, await suggestSetup(await body(req))); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    // 참고 링크 미리 읽어 보기 (편집 화면 [링크 확인]) — { url } → { title, text(앞 300자), length }
    if (p === "/api/autoflows/link-check" && req.method === "POST") {
      try { const x = await readLink((await body(req)).url || ""); return send(res, 200, { title: x.title, text: x.text.slice(0, 300), length: x.text.length }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if ((m = p.match(/^\/api\/autoflows\/(af_\d+)$/))) {
      if (req.method === "PUT") return send(res, 200, await updateAutoflow(m[1], await body(req)));
      if (req.method === "DELETE") { await deleteAutoflow(m[1]); return send(res, 200, { ok: true }); }
    }
    // 지금 한 번 돌리기 — 수집이 브라우저를 쓰므로 혼자 도는 작업
    // 수집한 광고에서 골라 기획하기 — 목록 · 고른 것 기획 (Claude 만, 이미지 크레딧 없음)
    if ((m = p.match(/^\/api\/autoflows\/(af_\d+)\/ads$/)) && req.method === "GET") return send(res, 200, await collectedAds(m[1]));
    if ((m = p.match(/^\/api\/autoflows\/(af_\d+)\/plan$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const { ads = [] } = await body(req), id = m[1];
      if (!ads.length) return send(res, 400, { error: "광고를 고르세요" });
      startJob("auto", `고른 광고 기획 · ${ads.length}개`, (emit) => planPicked(id, ads, emit)).catch(() => {});
      if (solo) solo.afId = id;
      return send(res, 202, { started: true });
    }
    if ((m = p.match(/^\/api\/autoflows\/(af_\d+)\/run$/)) && req.method === "POST") {
      const af = await getAutoflow(m[1]);
      if (!af) return send(res, 404, { error: "없음" });
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      startAuto(af, "manual");
      return send(res, 202, { started: true });
    }

    // ── 리소스 ──
    if (p === "/api/resource-kinds") return send(res, 200, KINDS);
    // 리소스 이미지 잘라 새 결과로: { file, box: { x, y, w, h } (%), part }
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/crop$/)) && req.method === "POST") return send(res, 200, await cropResourceFile(m[1], m[2], await body(req)));
    // 리소스 파일 형태: { form: "single" | "sheet" }
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/form\/([\w.-]+)$/)) && req.method === "PUT") return send(res, 200, await setFileForm(m[1], m[2], m[3], (await body(req)).form));
    if (p === "/api/clients" && req.method === "GET") return send(res, 200, await listClients());
    if (p === "/api/clients" && req.method === "POST") return send(res, 200, await createClient((await body(req)).name));
    if ((m = p.match(/^\/api\/clients\/(co_\d+)$/))) {
      if (req.method === "PUT") return send(res, 200, await renameClient(m[1], (await body(req)).name));
      if (req.method === "DELETE") { await deleteClient(m[1]); return send(res, 200, { ok: true }); }
    }
    if (p === "/api/resources" && req.method === "GET") return send(res, 200, await listResources(url.searchParams.get("kind") || undefined));
    if (p === "/api/resources" && req.method === "POST") {
      const { tokens = [], ...meta } = await body(req);
      const files = tokens.map((t) => staged.get(t)).filter(Boolean).map((it) => ({ tmp: it.file, name: it.name }));
      const r = await createResource(meta, files);
      for (const t of tokens) { const it = staged.get(t); staged.delete(t); if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); }
      return send(res, 200, r);
    }
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)$/))) {
      if (req.method === "GET") { const r = await getResource(m[1], m[2]); return r ? send(res, 200, r) : send(res, 404, { error: "없음" }); }
      if (req.method === "PUT") return send(res, 200, await updateResource(m[1], m[2], await body(req)));
      if (req.method === "DELETE") { await deleteResource(m[1], m[2]); return send(res, 200, { ok: true }); }
    }
    // 파일 붙이기: { tokens, role: "ref" | "output", part, note } (먼저 /api/uploads?purpose=resource 로 올린다)
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/files$/)) && req.method === "POST") {
      const { tokens = [], ...opts } = await body(req);
      const files = tokens.map((t) => staged.get(t)).filter(Boolean).map((it) => ({ tmp: it.file, name: it.name }));
      if (!files.length) return send(res, 400, { error: "올린 파일이 없습니다" });
      try { return send(res, 200, await addResourceFiles(m[1], m[2], files, { role: opts.role, part: opts.part, note: opts.note })); }
      finally { for (const t of tokens) { const it = staged.get(t); staged.delete(t); if (it) fsp.rm(path.dirname(it.file), { recursive: true, force: true }); } }
    }
    // 가상 페르소나 만들기: { files } (비우면 이 인물의 이미지) — Claude 가 이미지를 보고 속성·프롬프트·페르소나를 채운다
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/persona$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const { files = [], keepParts = false } = await body(req);
      startJob("persona", "가상 페르소나 만들기", (emit) => makePersona(m[1], m[2], files, emit, { keepParts: !!keepParts })).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 프롬프트 완성하기 (힉스필드와 별개): { part, files } — Claude 가 이미지·속성·페르소나로 완성 프롬프트를 쓴다
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/prompt$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const { part = "", files = [] } = await body(req);
      startJob("persona", "프롬프트 완성하기", (emit) => completePrompt(m[1], m[2], part, files, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 참고 이미지 분석: { part, files, refUse, schema, memoKey } — 위저드 조정 칸을 사진에서 채운다 (결과는 작업 완료 이벤트의 result)
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/analyze$/)) && req.method === "POST") {
      if (solo) return send(res, 409, { error: `다른 작업이 진행 중입니다: ${solo.label}` });
      const b = await body(req);
      startJob("persona", "참고 이미지 분석", (emit) => analyzeRefs(m[1], m[2], b, emit)).catch(() => {});
      return send(res, 202, { started: true });
    }
    // 프롬프트 버전 남기기: { part, prompt, negative, source }
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/prompts$/)) && req.method === "POST") {
      return send(res, 200, await addPromptVersion(m[1], m[2], await body(req)));
    }
    // 결과 이미지 줌: { file, mode: "in" | "out", scale, anchor } — in 은 새 결과, out 은 힉스필드로 채울 판(참고 이미지)
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/zoom$/)) && req.method === "POST") {
      return send(res, 200, await zoomImage(m[1], m[2], await body(req)));
    }
    // 다른 리소스 파일 가져오기: { fromKind, fromId, file, role, part }
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/import$/)) && req.method === "POST") {
      return send(res, 200, await importFile(m[1], m[2], await body(req)));
    }
    // 그 리소스 폴더를 Finder(맥)·탐색기(윈도우)로 연다
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/reveal$/)) && req.method === "POST") {
      if (!(await getResource(m[1], m[2]))) return send(res, 404, { error: "없음" });
      const dir = path.dirname(resourcePath(m[1], m[2], "x"));
      spawn(process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
      return send(res, 200, { ok: true, dir });
    }
    // 파일 빼기 (기록에는 남는다)
    if ((m = p.match(/^\/api\/resources\/(\w+)\/(res_\w+)\/files\/([\w.-]+)$/)) && req.method === "DELETE") {
      return send(res, 200, await removeResourceFile(m[1], m[2], m[3]));
    }

    // 광고주 찾기: platform = meta (Page ID) | youtube (광고주 ID)
    // 인스타 계정 확인: { username } → { pk, name }
    if (p === "/api/instagram/resolve" && req.method === "POST") {
      const username = String((await body(req)).username || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").split(/[/?]/)[0];
      if (!/^[\w.]+$/.test(username)) return send(res, 400, { error: "인스타 아이디를 적으세요 (예: hongik.man)" });
      const r = await startJob("resolve", `인스타 계정 확인 @${username}`, (emit) => runEgo(resolveInstagramScript({ username }), { onEvent: emit }));
      if (r.error) return send(res, 404, { error: r.error });
      return send(res, 200, { ...r, username });
    }
    if (p === "/api/advertisers/search" && req.method === "POST") {
      const { query, country = "KR", platform = "meta" } = await body(req);
      if (!query?.trim()) return send(res, 400, { error: "검색어가 필요합니다" });
      const make = platform === "youtube" ? searchGoogleAdvertisersScript : searchAdvertisersScript;
      const r = await startJob("search", `광고주 검색 "${query}"`, (emit) => runEgo(make({ query, country }), { onEvent: emit }));
      return send(res, 200, r);
    }
    if (p === "/api/advertisers/resolve" && req.method === "POST") {
      const { query, index, country = "KR", platform = "meta" } = await body(req);
      const make = platform === "youtube" ? resolveGoogleAdvertiserScript : resolveAdvertiserScript;
      const r = await startJob("resolve", "광고주 ID 확인", (emit) => runEgo(make({ query, index, country }), { onEvent: emit }));
      return send(res, 200, r);
    }

    if (p.startsWith("/data/")) {
      const file = inside(DATA_DIR, p.slice(6));
      return file ? serveFile(req, res, file) : send(res, 403, { error: "forbidden" });
    }
    const file = inside(PUBLIC, p === "/" ? "index.html" : p.slice(1));
    return file ? serveFile(req, res, file) : send(res, 403, { error: "forbidden" });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
}

await fsp.mkdir(DATA_DIR, { recursive: true });
// 다시 켤 때는 앞 서버가 포트를 놓기까지 잠깐 기다린다
let tries = 0;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && tries++ < 20) return setTimeout(() => server.listen(PORT, "127.0.0.1"), 300);
  console.error(e.code === "EADDRINUSE" ? `포트 ${PORT} 를 이미 쓰고 있습니다 — 이미 켜져 있는지 확인하세요` : e.message);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`광고소재 스튜디오 → http://localhost:${PORT}`);
  console.log(`저장 폴더 → ${DATA_DIR}${DATA_DIR_SET ? "" : " (아직 고르지 않음 — 처음 설정 화면에서 고르세요)"}`);
});
