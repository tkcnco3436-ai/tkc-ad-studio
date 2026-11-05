// 3D 설명 영상 — 장면은 템플릿(explainer-voxel.js · explainer-classic.js)이 Three.js 로 그리고, 여기서는 시간표·재생·녹화·편집 화면을 맡는다.
// 프로젝트마다 template(화풍) · style(템플릿 커스텀 값) · character(주인공, 템플릿이 지원할 때) 를 갖는다.
// 서버: lib/explainer.js · 주소: #explain · app.js 의 setTab 이 window.explainer.open() 을 부른다
import { THREE, W, H, FPS } from "./explainer-kit.js";
import { esc, defaults, fieldsHTML, readFields, contentGrid, bindGrid, loadVoiceChoices, voiceOptions } from "./fields.js";
import { mountThumb } from "./thumb.js";
import voxel from "./explainer-voxel.js";
import classic from "./explainer-classic.js";

const TEMPLATES = { voxel, classic };
const VOICES = ["Yuna", "Eddy", "Flo", "Reed", "Sandy", "Shelley"];

const $ = (s) => document.querySelector(s);
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: opts.raw ? {} : { "content-type": "application/json" }, body: opts.raw || (opts.body ? JSON.stringify(opts.body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}
function toast(msg, isErr = false) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

const st = { view: "make", list: [], p: null, timeline: null, built: [], playing: false, clock: 0, t0: 0, rec: null, ready: false, lib: { characters: [], styles: [] } };
const tpl = () => TEMPLATES[st.p?.template] || voxel;
const env = () => ({ style: st.p?.style || {}, character: st.p?.character || {} });

// ── 시간표: 장면 경계와 자막 단어 시각 ───────────────
function buildTimeline(p, audioDur) {
  const sc = p.scenes.map((s) => ({ ...s, ws: s.narration.split(/\s+/).filter(Boolean) }));
  const N = sc.reduce((a, s) => a + s.ws.length, 0);
  const W0 = p.words || [];
  if (W0.length && N) { // whisper 단어 수에 대본 단어 수를 비례로 맞춰 장면 경계를 잡는다
    let cum = 0, prevEnd = 0;
    sc.forEach((s) => {
      if (!s.ws.length) { s.sp0 = s.sp1 = prevEnd + 0.3; return; }
      const i0 = Math.min(W0.length - 1, Math.round((cum / N) * W0.length)); cum += s.ws.length;
      const i1 = Math.max(i0, Math.min(W0.length - 1, Math.round((cum / N) * W0.length) - 1));
      s.sp0 = W0[i0].t0; s.sp1 = W0[i1].t1; prevEnd = s.sp1;
    });
  } else { // 음성 없음: 1초에 6.5글자로 어림
    let t = 0.3;
    sc.forEach((s) => { s.sp0 = t; s.ws.forEach((w) => (t += Math.max(0.22, w.length / 6.5) + 0.06)); s.sp1 = t; t += 0.5; });
  }
  sc.forEach((s, i) => { s.s0 = i ? Math.min(s.sp0 - 0.15, sc[i - 1].sp1 + 0.2) : 0; });
  sc.forEach((s, i) => { s.s1 = i < sc.length - 1 ? sc[i + 1].s0 : Math.max(audioDur || 0, s.sp1 + (s.ws.length ? 1.2 : 2.5)); });
  // 장면 안 단어 시각은 글자 수 비례. 글자는 대본 그대로 (음성 인식 오타를 피한다)
  sc.forEach((s) => {
    const tot = s.ws.reduce((a, w) => a + w.length + 1, 0) || 1; let acc = 0;
    s.words = s.ws.map((w) => { const a = s.sp0 + ((s.sp1 - s.sp0) * acc) / tot; acc += w.length + 1; return { w, t0: a, t1: s.sp0 + ((s.sp1 - s.sp0) * acc) / tot }; });
    s.chunks = []; let cur = [];
    s.words.forEach((x) => { if (cur.length >= 3 || (cur.length && cur.reduce((a, y) => a + y.w.length, 0) + x.w.length > 13)) { s.chunks.push(cur); cur = []; } cur.push(x); });
    if (cur.length) s.chunks.push(cur);
  });
  return { scenes: sc, total: sc.length ? sc[sc.length - 1].s1 : 0 };
}

// ── 그리기 ────────────────────────────────────────────
let renderer, out, ctx;
function setupCanvas() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  out = $("#exCanvas"); out.width = W; out.height = H; ctx = out.getContext("2d");
}

// 3D 는 여기서 그리고, 합성·글자·전환은 템플릿의 compose 가 맡는다
function drawFrame(t) {
  const tl = st.timeline;
  if (!tl?.scenes.length) { ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, W, H); return; }
  const i = Math.max(0, tl.scenes.findIndex((s) => t < s.s1)), idx = i < 0 ? tl.scenes.length - 1 : i;
  const s = tl.scenes[idx], b = st.built[idx], lt = Math.max(0, t - s.s0), dur = s.s1 - s.s0, T = tpl();
  b.update(lt, dur);
  renderer.toneMapping = T.toneMapping ?? THREE.NoToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.render(b.scene, b.camera);
  T.compose({ ctx, src: renderer.domElement, s, b, t, lt, dur, idx, p: st.p, ...env() });
}

// ── 재생 ─────────────────────────────────────────────
const audio = () => $("#exAudio");
const hasAudio = () => !!st.p?.audio;
// 음성이 도는 동안은 음성 시각, 음성이 끝난 뒤(마무리 장면 꼬리)나 음성이 없으면 벽시계
const now = () => (!st.playing ? st.clock : st.audioLive ? audio().currentTime : st.clock + (performance.now() - st.t0) / 1000);
const audioDur = () => (hasAudio() ? audio().duration || 0 : 0);

function loop() {
  if (!st.ready) return;
  if (($("#explainView").hidden || st.view === "list") && !st.rec) return requestAnimationFrame(loop); // 다른 화면·목록에서는 그리지 않는다
  const t = now();
  if (st.playing && t >= st.timeline.total) { pause(); seek(st.timeline.total); if (st.rec) st.rec.stop(); }
  if (!st.rec) drawPreview(); // 녹화 중엔 본 화면만
  drawFrame(Math.min(t, st.timeline?.total || 0));
  $("#exTime").textContent = `${fmt(t)} / ${fmt(st.timeline?.total || 0)}`;
  if (!st.seeking) $("#exSeek").value = st.timeline?.total ? (t / st.timeline.total) * 1000 : 0;
  requestAnimationFrame(loop);
}
function play() {
  if (!st.timeline?.total) return;
  if (now() >= st.timeline.total - 0.05) seek(0);
  st.playing = true; st.t0 = performance.now();
  st.audioLive = st.clock < audioDur() - 0.05;
  if (st.audioLive) audio().play();
  $("#exPlay").textContent = "⏸";
}
function pause() {
  if (!st.playing) return;
  st.clock = now(); st.playing = false;
  if (hasAudio()) audio().pause();
  $("#exPlay").textContent = "▶";
}
function seek(t) {
  st.clock = t; st.t0 = performance.now();
  if (!hasAudio()) return;
  audio().currentTime = Math.min(t, audioDur());
  if (st.playing) { st.audioLive = t < audioDur() - 0.05; st.audioLive ? audio().play() : audio().pause(); }
}

// 녹화: 캔버스 화면 + 음성 → webm → 서버 ffmpeg → mp4
let actx, aDest;
async function record() {
  if (!st.timeline?.total) return toast("장면이 없습니다", true);
  pause(); seek(0);
  const stream = out.captureStream(FPS);
  if (hasAudio()) {
    if (!actx) { actx = new AudioContext(); const src = actx.createMediaElementSource(audio()); aDest = actx.createMediaStreamDestination(); src.connect(aDest); src.connect(actx.destination); }
    await actx.resume();
    aDest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  const q = $("#exQuality").value, rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: { small: 4_000_000, std: 8_000_000, high: 16_000_000 }[q] || 8_000_000 }), chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    st.rec = null; $("#exRecord").disabled = false; status("mp4 로 바꾸는 중");
    try {
      st.p = await api(`/api/explainers/${st.p.id}/render?q=${q}`, { method: "POST", raw: new Blob(chunks, { type: "video/webm" }) });
      status(""); renderResult(); toast("mp4 를 만들었습니다");
      st.list = await api("/api/explainers"); renderGrid(); // 목록 썸네일·길이 갱신
    } catch (e) { status(""); toast(e.message, true); }
  };
  st.rec = rec; $("#exRecord").disabled = true; status("녹화 중 — 끝날 때까지 이 탭을 앞에 두세요 (실제 길이만큼 걸립니다)");
  rec.start(500); play();
}

// ── 만든 콘텐츠 탭 ───────────────────────────────────
function setView(v) {
  st.view = v;
  $("#exMakeView").hidden = v !== "make"; $("#exListView").hidden = v !== "list";
  document.querySelectorAll("#exTabs [data-v]").forEach((a) => a.classList.toggle("is-on", a.dataset.v === v));
  if (v === "list") pause();
}
function renderGrid() {
  const q = $("#exSearch").value.trim().toLowerCase();
  const items = st.list.filter((x) => !q || `${x.title} ${x.topic}`.toLowerCase().includes(q));
  $("#exGrid").innerHTML = contentGrid(items, { base: "/data/_explainers", hash: "#explain", unit: "장면", icon: "🌐" });
  $("#exCount").textContent = st.list.length;
}

// ── 화면 ─────────────────────────────────────────────
function status(msg) { $("#exStatus").textContent = msg; $("#exStatus").hidden = !msg; }

async function loadList(selectId) {
  st.list = await api("/api/explainers");
  $("#exPick").innerHTML = `<option value="">— 만든 영상 ${st.list.length}개 —</option>` + st.list.map((x) => `<option value="${x.id}">${esc(x.title || x.topic || x.id)} · 장면 ${x.count}</option>`).join("");
  renderGrid();
  const id = selectId || st.p?.id || st.list[0]?.id;
  if (id) { $("#exPick").value = id; await loadProject(id); } else { st.p = null; renderProject(); }
}

async function loadProject(id) {
  pause(); st.p = await api(`/api/explainers/${id}`);
  renderProject(); await rebuild();
}

async function rebuild() {
  // 블록 상자·재질은 모든 장면이 같이 쓰므로 인스턴스 버퍼만 버린다
  st.built.forEach((b) => b.scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose?.(); } }));
  st.built = []; st.timeline = null;
  if (!st.p?.scenes.length) return;
  const a = audio();
  if (hasAudio()) {
    a.src = `/data/_explainers/${st.p.id}/${st.p.audio}?v=${encodeURIComponent(st.p.updatedAt)}`;
    await new Promise((ok) => { a.onloadedmetadata = ok; a.onerror = ok; });
  } else a.removeAttribute("src");
  st.timeline = buildTimeline(st.p, hasAudio() ? a.duration || 0 : 0);
  const T = tpl(), e = env();
  await T.prepare(e);
  st.built = st.timeline.scenes.map((s) => T.build(s, e));
  seek(0);
}

const hintOf = (type) => tpl().types[type]?.hint || "";
// 다른 템플릿의 장면 이름이면 그대로 두고 (다른 템플릿) 표시 — 그림은 가까운 장면으로 나온다
function typeOptions(cur) {
  const ts = tpl().types, o = Object.entries(ts).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(v.label)}</option>`);
  if (cur && !ts[cur]) o.push(`<option value="${esc(cur)}" selected>${esc(cur)} (다른 템플릿)</option>`);
  return o.join("");
}

function sceneCard(s, i) {
  return `<li class="ex-scene" data-i="${i}">
    <div class="ex-scene__head">
      <strong>${i + 1}</strong>
      <select data-k="type" aria-label="장면 종류">${typeOptions(s.type)}</select>
      <button class="btn btn--ghost btn--sm" type="button" data-act="up" aria-label="위로">↑</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="down" aria-label="아래로">↓</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="go" title="이 장면부터 재생">▶</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="del" aria-label="지우기">✕</button>
    </div>
    <textarea data-k="narration" rows="2" placeholder="나레이션">${esc(s.narration)}</textarea>
    <div class="ex-scene__row">
      <input data-k="chip" value="${esc(s.chip)}" placeholder="${s.type === "title" ? "큰 제목 (비우면 영상 제목)" : "강조 라벨 (예: 500+ 케이블)"}">
      <select data-k="chipColor" aria-label="라벨 색"><option value="blue">파랑</option><option value="orange" ${s.chipColor === "orange" ? "selected" : ""}>주황</option></select>
    </div>
    <div class="ex-scene__row">
      <input data-k="tag" value="${esc(s.tag)}" placeholder="작은 영어 설명 (예: DATA CENTER)">
      <input data-k="value" value="${esc(s.value)}" placeholder="${esc(hintOf(s.type))}" ${hintOf(s.type) ? "" : "hidden"}>
    </div>
  </li>`;
}

function renderProject() {
  const p = st.p, on = !!p;
  $("#exEditor").hidden = !on; $("#exPlayer").hidden = !on;
  if (!on) return;
  $("#exTitle").value = p.title || "";
  renderStyle(); renderCharacter();
  $("#exScenes").innerHTML = p.scenes.map(sceneCard).join("") || `<li class="muted small">대본이 아직 없습니다. "대본 다시 쓰기"를 누르세요.</li>`;
  $("#exAudioInfo").textContent = p.audio
    ? `음성 있음 · ${p.words ? `whisper 단어 ${p.words.length}개로 자막 시각을 맞춤` : "단어 시각 없음 — 글자 수로 나눔"}`
    : "음성 없음 — 1초 6.5글자로 어림해 미리보기합니다";
  renderResult();
}

function renderResult() {
  const v = st.p?.video;
  $("#exResult").innerHTML = v ? `<a class="btn btn--ghost btn--sm" href="/data/_explainers/${st.p.id}/${v}?v=${encodeURIComponent(st.p.updatedAt)}" download="${esc(st.p.title || st.p.id)}.mp4">mp4 받기</a>` : "";
}

function readScenes() {
  return [...document.querySelectorAll("#exScenes .ex-scene")].map((li) => Object.fromEntries([...li.querySelectorAll("[data-k]")].map((x) => [x.dataset.k, x.value])));
}

async function saveScenes() {
  st.p = await api(`/api/explainers/${st.p.id}`, { method: "PUT", body: { title: $("#exTitle").value, scenes: readScenes() } });
  renderProject(); await rebuild();
}

let saveT;
function bind() {
  $("#exNew").addEventListener("submit", async (e) => {
    e.preventDefault();
    const topic = $("#exTopic").value.trim(); if (!topic) return;
    const p = await api("/api/explainers", { method: "POST", body: { topic, seconds: $("#exSec").value, ...presetOf($("#exTpl").value) } });
    await loadList(p.id);
    $("#exTopic").value = "";
    runJob(`/api/explainers/${p.id}/script`);
  });
  $("#exPick").addEventListener("change", (e) => e.target.value && loadProject(e.target.value));
  const del = async (id) => {
    const x = st.list.find((y) => y.id === id) || st.p; if (!x || !confirm(`"${x.title || x.topic}" 을 지울까요? 음성·mp4 도 같이 지워집니다.`)) return;
    await api(`/api/explainers/${id}`, { method: "DELETE" }); if (st.p?.id === id) st.p = null; await loadList();
  };
  $("#exDel").addEventListener("click", () => st.p && del(st.p.id));
  bindGrid($("#exGrid"), del);
  $("#exSearch").addEventListener("input", renderGrid);
  $("#exRescript").addEventListener("click", () => st.p && (!st.p.scenes.length || confirm("지금 장면을 버리고 새로 쓸까요?")) && runJob(`/api/explainers/${st.p.id}/script`));
  // 칸을 고치면 0.6초 뒤 저장하고 미리보기를 다시 만든다
  const onEdit = () => { clearTimeout(saveT); saveT = setTimeout(() => saveScenes().catch((e) => toast(e.message, true)), 600); };
  $("#exTitle").addEventListener("input", onEdit);
  $("#exScenes").addEventListener("input", (e) => { if (e.target.dataset.k === "type") { $("#exScenes").querySelectorAll(".ex-scene").forEach((li) => { const v = li.querySelector('[data-k="value"]'), h = hintOf(li.querySelector('[data-k="type"]').value); v.hidden = !h; v.placeholder = h; }); } onEdit(); });
  $("#exScenes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const i = Number(b.closest(".ex-scene").dataset.i), sc = readScenes();
    if (b.dataset.act === "go") { if (st.timeline?.scenes[i]) { seek(st.timeline.scenes[i].s0); play(); } return; }
    if (b.dataset.act === "del") sc.splice(i, 1);
    if (b.dataset.act === "up" && i > 0) [sc[i - 1], sc[i]] = [sc[i], sc[i - 1]];
    if (b.dataset.act === "down" && i < sc.length - 1) [sc[i + 1], sc[i]] = [sc[i], sc[i + 1]];
    st.p.scenes = sc; renderProject(); onEdit();
  });
  $("#exAdd").addEventListener("click", () => { st.p.scenes = [...readScenes(), { type: Object.keys(tpl().types)[1], narration: "", chip: "", chipColor: "blue", tag: "", value: "" }]; renderProject(); });
  $("#exAudioFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !st.p) return;
    status("음성 올리는 중");
    try { await api(`/api/explainers/${st.p.id}/audio?name=${encodeURIComponent(f.name)}`, { method: "POST", raw: f }); }
    catch (err) { status(""); toast(err.message, true); }
  });
  bindStyle(); bindCharacter();
  // 고른 화질은 이 브라우저에 기억한다
  try { $("#exQuality").value = localStorage.getItem("mp4Quality") || "std"; } catch {}
  $("#exQuality").addEventListener("change", (e) => { try { localStorage.setItem("mp4Quality", e.target.value); } catch {} });
  mountThumb({ source: $("#exCanvas"), after: $("#exRecord").parentElement, get: () => ({ key: st.p?.id, title: st.p?.title || st.p?.topic || "", sub: "", name: st.p?.title || st.p?.id }) });
  $("#exSay").addEventListener("click", () => st.p && runJob(`/api/explainers/${st.p.id}/voice`, { voice: $("#exVoice").value }));
  $("#exPlay").addEventListener("click", () => (st.playing ? pause() : play()));
  audio().addEventListener("ended", () => { if (st.playing) { st.clock = audioDur(); st.t0 = performance.now(); st.audioLive = false; } });
  const sk = $("#exSeek");
  sk.addEventListener("input", () => { st.seeking = true; seek((sk.value / 1000) * (st.timeline?.total || 0)); });
  sk.addEventListener("change", () => (st.seeking = false));
  $("#exRecord").addEventListener("click", () => record().catch((e) => toast(e.message, true)));
  // 서버 작업(대본·음성) 진행은 app.js 의 공용 이벤트 줄(srv-event)에서 받는다
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "log" && st.waiting) status(e.message);
    if (e.type === "job" && e.kind === "explain" && e.state !== "start") {
      st.waiting = false; status("");
      if (e.state === "error") toast(e.message, true); else { toast(e.message); if (st.p) loadProject(st.p.id).then(() => loadList(st.p.id)); }
    }
  });
}

// ── 템플릿·스타일 ─────────────────────────────────────
// 템플릿 고르기 값: "tpl:<id>" 기본 템플릿 · "my:<id>" 내가 저장한 템플릿(기본 템플릿 + 스타일 + 캐릭터)
function tplOptions(cur) {
  const base = Object.values(TEMPLATES).map((t) => `<option value="tpl:${t.id}" ${cur === `tpl:${t.id}` ? "selected" : ""}>${esc(t.name)} — ${esc(t.desc)}</option>`).join("");
  const mine = st.lib.styles.map((x) => `<option value="my:${x.id}" ${cur === `my:${x.id}` ? "selected" : ""}>${esc(x.name)} (${esc(TEMPLATES[x.base]?.name || x.base)})</option>`).join("");
  return `<optgroup label="기본 템플릿">${base}</optgroup>${mine ? `<optgroup label="내 템플릿">${mine}</optgroup>` : ""}`;
}
function presetOf(v) {
  const [kind, id] = String(v || "tpl:voxel").split(":");
  if (kind === "my") { const x = st.lib.styles.find((y) => y.id === id); if (x) return { template: x.base, style: x.style || {}, character: x.character || {} }; }
  return { template: TEMPLATES[id] ? id : "voxel", style: {}, character: {} };
}

async function loadLib() {
  const [characters, styles] = await Promise.all([api("/api/explainer-lib/characters"), api("/api/explainer-lib/styles")]);
  st.lib = { characters, styles };
  $("#exTpl").innerHTML = tplOptions($("#exTpl").value || "tpl:voxel");
  if (st.p) { renderStyle(); renderCharacter(); }
}

function renderStyle() {
  const T = tpl();
  $("#exTplCur").innerHTML = tplOptions(`tpl:${T.id}`);
  $("#exStyle").innerHTML = fieldsHTML(T.options, st.p.style || {});
}

let styleT;
async function saveProject(patch) {
  st.p = await api(`/api/explainers/${st.p.id}`, { method: "PUT", body: patch });
  await rebuild();
}
function bindStyle() {
  $("#exTpl").innerHTML = tplOptions("tpl:voxel");
  $("#exTplCur").addEventListener("change", async (e) => {
    const pre = presetOf(e.target.value), keep = pre.template === st.p.template;
    // 같은 템플릿 안에서 기본으로 돌아갈 때는 캐릭터를 지우지 않는다
    await saveProject({ template: pre.template, style: pre.style, character: e.target.value.startsWith("my:") || !keep ? pre.character : st.p.character });
    renderProject();
  });
  $("#exStyle").addEventListener("input", (e) => {
    if (e.target.type === "range") e.target.nextElementSibling.textContent = e.target.value;
    clearTimeout(styleT); styleT = setTimeout(() => saveProject({ style: readFields($("#exStyle")) }).catch((err) => toast(err.message, true)), 400);
  });
  $("#exStyleReset").addEventListener("click", async () => { await saveProject({ style: {} }); renderStyle(); });
  $("#exStyleSave").addEventListener("click", async () => {
    const name = prompt("템플릿 이름", `${tpl().name} · ${st.p.title || "내 스타일"}`); if (!name) return;
    const x = await api("/api/explainer-lib/styles", { method: "POST", body: { name, base: tpl().id, style: st.p.style || {}, character: tpl().character ? st.p.character || {} : {} } });
    await loadLib(); $("#exTplCur").value = `my:${x.id}`; toast(`"${name}" 템플릿을 저장했습니다. 새로 만들 때 고를 수 있습니다`);
  });
  $("#exStyleDel").addEventListener("click", async () => {
    const v = $("#exTplCur").value; if (!v.startsWith("my:")) return toast("내 템플릿을 고른 뒤 지우세요", true);
    const x = st.lib.styles.find((y) => `my:${y.id}` === v); if (!x || !confirm(`"${x.name}" 템플릿을 지울까요? 이미 만든 영상은 그대로입니다.`)) return;
    await api(`/api/explainer-lib/styles/${x.id}`, { method: "DELETE" }); await loadLib();
  });
}

// ── 캐릭터 만들기 ─────────────────────────────────────
// 미리보기도 본 화면 렌더러 하나로 그린다 (WebGL 을 둘 띄우면 재질을 같이 써서 페이지가 멈춘다).
// 캔버스 왼쪽 아래 PV×PV 칸에 그린 뒤 2D 미리보기 캔버스로 옮기고, 다음 본 프레임이 덮는다
const PV = 280, pv = { built: null, t0: performance.now(), ctx: null };
function drawPreview() {
  if (!pv.built || $("#exCharPanel").hidden) return;
  pv.ctx ||= $("#exCharCanvas").getContext("2d");
  pv.built.update((performance.now() - pv.t0) / 1000);
  renderer.setViewport(0, 0, PV, PV); renderer.setScissor(0, 0, PV, PV); renderer.setScissorTest(true);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(pv.built.scene, pv.built.camera);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
  pv.ctx.drawImage(renderer.domElement, 0, H - PV, PV, PV, 0, 0, PV, PV);
}
function renderCharacter() {
  const C = tpl().character;
  $("#exCharPanel").hidden = !C;
  if (!C) return;
  $("#exCharFields").innerHTML = fieldsHTML(C.fields, st.p.character || {});
  $("#exCharPick").innerHTML = `<option value="">— 저장한 캐릭터 ${st.lib.characters.length}개 —</option>` + st.lib.characters.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  buildPreview();
}
function buildPreview() {
  const C = tpl().character; if (!C) return;
  pv.built?.scene.traverse((o) => o.isInstancedMesh && o.dispose());
  pv.built = C.preview({ ...defaults(C.fields), ...readFields($("#exCharFields")) }, st.p.style);
}
let charT;
function bindCharacter() {
  $("#exCharFields").addEventListener("input", (e) => {
    if (e.target.type === "range") e.target.nextElementSibling.textContent = e.target.value;
    buildPreview(); // 미리보기는 바로, 영상 장면은 잠시 뒤 저장하며 다시 짓는다
    clearTimeout(charT); charT = setTimeout(() => saveProject({ character: readFields($("#exCharFields")) }).catch((err) => toast(err.message, true)), 500);
  });
  $("#exCharRandom").addEventListener("click", () => {
    const r = Object.fromEntries(tpl().character.fields.map((f) => [f.k,
      f.type === "color" ? `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}` : f.type === "check" ? Math.random() < 0.5
      : f.type === "select" ? f.choices[Math.floor(Math.random() * f.choices.length)][0] : f.def]));
    $("#exCharFields").innerHTML = fieldsHTML(tpl().character.fields, r); $("#exCharFields").dispatchEvent(new Event("input"));
  });
  $("#exCharReset").addEventListener("click", () => { $("#exCharFields").innerHTML = fieldsHTML(tpl().character.fields, {}); $("#exCharFields").dispatchEvent(new Event("input")); });
  $("#exCharPick").addEventListener("change", (e) => {
    const x = st.lib.characters.find((y) => y.id === e.target.value); if (!x) return;
    $("#exCharFields").innerHTML = fieldsHTML(tpl().character.fields, x.spec); $("#exCharFields").dispatchEvent(new Event("input"));
  });
  $("#exCharSave").addEventListener("click", async () => {
    const name = prompt("캐릭터 이름", "내 캐릭터"); if (!name) return;
    await api("/api/explainer-lib/characters", { method: "POST", body: { name, base: tpl().id, spec: readFields($("#exCharFields")) } });
    await loadLib(); toast(`"${name}" 캐릭터를 저장했습니다`);
  });
  $("#exCharDel").addEventListener("click", async () => {
    const x = st.lib.characters.find((y) => y.id === $("#exCharPick").value); if (!x || !confirm(`"${x.name}" 캐릭터를 지울까요?`)) return;
    await api(`/api/explainer-lib/characters/${x.id}`, { method: "DELETE" }); await loadLib();
  });
}

async function runJob(url, body = {}) {
  try { await api(url, { method: "POST", body }); st.waiting = true; status("시작했습니다"); }
  catch (e) { toast(e.message, true); }
}

window.explainer = {
  // sub: "" 만들기 · "list" 만든 콘텐츠 · "ex_…" 그 영상을 만들기 화면에 연다
  async open(sub = "") {
    if (!st.ready) { setupCanvas(); bind(); st.ready = true; requestAnimationFrame(loop); }
    setView(sub === "list" ? "list" : "make");
    const cur = $("#exVoice").value;
    $("#exVoice").innerHTML = voiceOptions(await loadVoiceChoices(true), VOICES, cur || VOICES[0]);
    await loadLib().catch((e) => toast(e.message, true));
    await loadList(/^ex_\d+$/.test(sub) ? sub : undefined).catch((e) => toast(e.message, true));
  },
  close() { if (st.ready && !st.rec) pause(); },
  frame(t) { pause(); seek(t); drawFrame(Math.min(t, st.timeline?.total || 0)); return st.timeline?.total || 0; },
};
