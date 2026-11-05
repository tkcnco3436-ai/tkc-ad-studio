// 리소스 화면 — 인물 · 배경 · 소품·제품 · 목소리
// 인물은 사람마다 폴더(📁)로 보이고, 열면 얼굴 · 체형 · 전신 시트를 하나씩 골라 속성 · 참고 이미지 · 결과를 채운다.
// 결과는 직접 올리거나 힉스필드로 만든다 (얼굴 결과를 체형·전신 시트의 참고로 이어 쓴다).
// 참고 이미지·결과를 넣고 뺀 일은 모두 기록에 남는다 (뺀 파일은 _history/ 로 옮겨져 기록에서 계속 보인다).
// 서버: lib/resources.js · app.js 와는 window.resPage(load·setKind) 와 "res-kind" 이벤트(목소리 만들기 칸)로만 잇는다
import { openWizard, closeWizard, wizardSteps } from "./charwizard.js";
import { openObjWizard, closeObjWizard, objWizardKinds, objWizardSteps } from "./objwizard.js";
// 위저드로 만드는 종류: 인물(charwizard) · 배경·제품(objwizard). 폴더 화면의 부분 탭(얼굴·체형·전신 시트)은 인물만 쓴다
const hasWizard = (kind) => kind === "person" || objWizardKinds.includes(kind);
const stepsOf = (kind) => (kind === "person" ? wizardSteps : objWizardSteps(kind));

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}
function toast(msg, isErr = false) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

const st = { kinds: null, list: [], kind: "person", open: null, part: "face", waiting: false, persona: false, prompting: false };
const url = (r, f) => `/data/_resources/${r.kind}/${r.id}/${f}`;
const ACTIONS = { create: "만듦", add: "넣음", generate: "힉스필드로 만듦", remove: "뺌", edit: "내용 고침", persona: "🪄 가상 페르소나 만듦", prompt: "✍️ 프롬프트 완성" };
const roleName = (role) => (role === "ref" ? "참고 이미지" : "결과");
const when = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ── 힉스필드 프롬프트 (부분마다) ───────────────────────
const line = (label, v) => (v ? ` ${label}: ${v}.` : "");
const PROMPTS = {
  face: (a, who) => `Photorealistic head-and-shoulders portrait, front view, of ${who}.${line("Impression", a.impression)}${line("Facial features", a.features)}${line("Hair", a.hair)}${line("Skin tone", a.skin)}${line("Expression", a.expression)} Plain light grey studio background, soft even lighting, sharp focus, no text, no watermark.`,
  body: (a, who) => `Full-body photo of ${who}, the same person as image 1 (keep the face exactly). Standing straight, front view, arms relaxed.${line("Height", a.height)}${line("Build", a.build)}${line("Proportions", a.proportion)}${line("Posture", a.posture)}${line("Outfit", a.outfit)} Plain light grey background, even studio lighting, no text, no watermark.`,
  pose: (a, who) => `Full-body photo of ${who} in this pose: ${a.pose || "a natural standing pose"}. Keep the same face and outfit as the reference images.${line("Background", a.scene)} No text, no watermark.`,
  outfit: (a) => `Outfit reference sheet, flat lay of every clothing item neatly arranged, seen from above.${line("Items", a.items)}${line("Style", a.style)} Plain light grey background, even soft lighting, no person, no text, no watermark.`,
  sheet: (a, who) => `Character reference sheet of ${who}, the same person as image 1 (keep the face and body exactly). Top row: front, side and back full-body views. Bottom row: four facial expressions (neutral, smile, surprised, serious).${line("Outfit", a.outfit)}${line("Accessories", a.accessory)}${line("Layout", a.layout)} Background: ${a.background || "clean light grey"}. Even studio lighting, no text, no watermark.`,
};
const whoOf = (r) => [r.attrs?.gender, r.attrs?.age_range, r.attrs?.look].filter(Boolean).join(", ") || "a person";

// ── 목록 ──────────────────────────────────────────────
async function load() {
  if (!st.kinds) {
    st.kinds = await api("/api/resource-kinds"); window.resKinds = st.kinds; // 위저드 페르소나 칸이 쓴다
    $("#resKinds").innerHTML = Object.entries(st.kinds).filter(([, v]) => !v.hidden).map(([k, v]) => `<button class="seg__btn" type="button" data-kind="${k}">${esc(v.label)} <span class="muted" data-count="${k}"></span></button>`).join("");
  }
  st.list = await api("/api/resources");
  renderTabs(); renderList();
  if (st.open) { const r = st.list.find((x) => x.id === st.open.id); if (r) { st.open = r; renderDetail(); } else closeDetail(); }
  return st.list;
}
function renderTabs() {
  document.querySelectorAll("#resKinds .seg__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.kind === st.kind));
  for (const k of Object.keys(st.kinds)) { const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = st.list.filter((r) => r.kind === k).length || ""; }
  $("#resNew").textContent = `＋ 새 ${st.kinds[st.kind].label}`;
}
const imgOf = (r) => {
  const outs = r.files.filter((f) => f.kind === "image" && f.role !== "ref"), rank = (f) => ["face", "sheet", "body", "base", "front", "scene", "variant"].indexOf(f.part) + 1 || 9;
  return outs.sort((a, b) => rank(a) - rank(b))[0] || r.files.find((f) => f.kind === "image");
};
function renderList() {
  const q = $("#resSearch").value.trim().toLowerCase();
  const list = st.list.filter((r) => r.kind === st.kind && (!q || `${r.name} ${r.tags.join(" ")} ${r.description}`.toLowerCase().includes(q)));
  const k = st.kinds[st.kind];
  $("#resGrid").innerHTML = list.map((r) => {
    const img = imgOf(r), aud = r.files.find((f) => f.kind === "audio");
    const refs = r.files.filter((f) => f.role === "ref").length, outs = r.files.length - refs;
    const parts = k.parts ? Object.entries(k.parts).map(([p, d]) => `<span class="${r.files.some((f) => f.part === p && f.role !== "ref") ? "is-done" : ""}">${esc(d.label)}</span>`).join("") : "";
    const draft = r.status === "draft";
    return `<button type="button" class="res-folder ${draft ? "is-draft" : ""}" data-open="${r.id}">
      <span class="res-folder__thumb">${img ? `<img src="${url(r, img.file)}" alt="" loading="lazy">` : `<span class="res-folder__icon" aria-hidden="true">📁</span>`}</span>
      <strong>${k.parts ? "📁 " : ""}${esc(r.name)}</strong>
      ${draft ? `<span class="res-folder__draft">작성 중 · ${(Number(r.wizard?.step) || 0) + 1}/${stepsOf(r.kind)}단계</span>` : ""}
      ${parts ? `<span class="res-folder__parts">${parts}</span>` : ""}
      <span class="muted small">결과 ${outs} · 참고 ${refs}${r.tags.length ? ` · ${esc(r.tags.join(", "))}` : ""}</span>
      ${aud ? `<audio controls preload="none" src="${url(r, aud.file)}"></audio>` : ""}
    </button>`;
  }).join("") || `<p class="muted">${esc(k.label)} 리소스가 아직 없습니다. "＋ 새 ${esc(k.label)}"으로 시작하세요.</p>`;
}

// ── 열린 리소스 (인물 폴더) ────────────────────────────
function fields(defs, vals, scope) {
  return defs.map(([k, label]) => `<label class="field"><span>${esc(label)}</span><input data-${scope}="${k}" value="${esc(vals?.[k] || "")}"></label>`).join("");
}
function thumbs(r, files, removable) {
  return files.map((f) => `<figure class="res-thumb">
    ${f.kind === "image" ? `<a href="${url(r, f.file)}" target="_blank" rel="noopener"><img src="${url(r, f.file)}" alt="" loading="lazy"></a>`
      : f.kind === "video" ? `<video src="${url(r, f.file)}" controls preload="metadata"></video>`
      : f.kind === "audio" ? `<audio src="${url(r, f.file)}" controls preload="none"></audio>` : `<a href="${url(r, f.file)}" target="_blank">${esc(f.original_name || f.file)}</a>`}
    <figcaption class="muted small">${f.source === "generated" ? "힉스필드 · " : ""}${when(f.added_at || r.created_at)}</figcaption>
    ${removable ? `<button class="btn btn--ghost btn--sm" type="button" data-remove="${esc(f.file)}" title="빼도 기록에는 남습니다">빼기</button>` : ""}
  </figure>`).join("");
}
function dropZone(role, label, part = "") {
  return `<label class="res-drop" data-drop="${role}" ${part ? `data-forcepart="${part}"` : ""}>${esc(label)} <span class="muted small">— 끌어다 놓거나 눌러서 고르기 (여러 장)</span>
    <input type="file" multiple accept="${role === "ref" ? "image/*" : esc(st.kinds[st.kind].accept)}" data-upload="${role}" ${part ? `data-forcepart="${part}"` : ""} hidden></label>`;
}
// 힉스필드로 만들 때 기본 참고: 이 부분의 참고 이미지 + (체형·전신 시트면) 얼굴·체형의 최신 결과
function defaultRefs(r, part) {
  const latest = (p) => r.files.filter((f) => f.part === p && f.role !== "ref" && f.kind === "image").slice(-1);
  const prev = part === "body" ? latest("face") : part === "sheet" ? [...latest("face"), ...latest("body")] : [];
  return [...prev, ...r.files.filter((f) => f.part === part && f.role === "ref" && f.kind === "image")].slice(0, 4).map((f) => f.file);
}

function renderDetail() {
  const r = st.open, k = st.kinds[r.kind], part = k.persona ? st.part : null, pd = k.parts?.[part];
  const inPart = (f) => (part ? f.part === part : true);
  const refs = r.files.filter((f) => f.role === "ref" && inPart(f)), outs = r.files.filter((f) => f.role !== "ref" && inPart(f));
  const imgs = r.files.filter((f) => f.kind === "image"), picked = new Set(defaultRefs(r, part));
  const prompt = part ? r.parts?.[part]?.prompt || PROMPTS[part](r.parts?.[part]?.attrs || {}, whoOf(r)) : "";
  const files = (list) => list.map((x) => (r.files.find((f) => f.file === x) || (r.removed || []).find((f) => f.file === x))).filter(Boolean);
  $("#resDetail").innerHTML = `
    <div class="res-detail__bar">
      <input class="title-input" data-basic="name" value="${esc(r.name)}" aria-label="이름">
      ${hasWizard(r.kind) ? `<button class="btn btn--ghost btn--sm" type="button" data-rewizard title="${esc(Object.values(k.parts || {}).map((x) => x.label).join(" → "))} 단계로 다시 다듬기">🧙 위저드로 다듬기</button>` : ""}
      <button class="btn btn--ghost btn--sm" type="button" data-reveal title="이 ${esc(k.label)}의 폴더를 Finder 로 엽니다">📂 폴더 열기</button>
      <button class="btn btn--ghost btn--sm" type="button" data-delete>지우기</button>
    </div>
    <div class="res-detail__grid">
      <div class="stack">
        <section class="res-sec">
          <h4>기본</h4>
          <div class="res-fields">${fields(k.fields, r.attrs, "attr")}
            <label class="field"><span>태그 (쉼표로)</span><input data-basic="tags" value="${esc(r.tags.join(", "))}"></label></div>
          <label class="field"><span>설명</span><textarea data-basic="description" rows="2">${esc(r.description)}</textarea></label>
        </section>
        ${k.persona ? personaSec(r, k) : ""}
        ${k.persona ? `<div class="seg res-parts" role="tablist">${Object.entries(k.parts).map(([p, d]) => {
          const n = r.files.filter((f) => f.part === p && f.role !== "ref").length;
          return `<button class="seg__btn ${p === part ? "is-on" : ""}" type="button" data-part="${p}">${esc(d.label)}${n ? ` <span class="muted">${n}</span>` : ""}</button>`;
        }).join("")}</div>
        <section class="res-sec">
          <h4>${esc(pd.label)} 속성</h4>
          <div class="res-fields">${fields(pd.fields, r.parts?.[part]?.attrs, "pattr")}</div>
        </section>
        <section class="res-sec res-prompt">
          <h4>📝 ${esc(pd.label)} 프롬프트 <span class="muted small">힉스필드와 별개 — 미드저니·GPT 등 다른 도구에 붙여 써도 됩니다</span></h4>
          <span class="muted small">참고로 쓸 이미지 (Claude 완성 · 힉스필드 만들기에 같이 씀)</span>
          <div class="res-gen__refs">${imgs.length ? imgs.map((f) => `<label class="res-gen__ref"><input type="checkbox" data-genref="${esc(f.file)}" ${picked.has(f.file) ? "checked" : ""}><img src="${url(r, f.file)}" alt=""><span class="muted small">${f.role === "ref" ? "참고" : "결과"}${f.part ? ` · ${esc(k.parts[f.part]?.label || "")}` : ""}</span></label>`).join("") : `<span class="muted small">이미지가 없습니다 — 속성만으로 씁니다.</span>`}</div>
          <label class="field"><span>프롬프트</span><textarea data-prompt rows="5">${esc(prompt)}</textarea></label>
          <label class="field"><span>네거티브 (피할 것, 쉼표로)</span><textarea data-negative rows="2">${esc(r.parts?.[part]?.negative || "")}</textarea></label>
          <div class="ex__row">
            <button class="btn btn--ghost btn--sm" type="button" data-reprompt title="속성 칸으로 바로 채웁니다 (Claude 안 씀)">속성으로 채우기</button>
            <button class="btn btn--primary btn--sm" type="button" data-complete ${st.prompting ? "disabled" : ""}>${st.prompting ? "완성하는 중…" : "✍️ Claude로 프롬프트 완성하기"}</button>
            <button class="btn btn--ghost btn--sm" type="button" data-copy>📋 복사</button>
          </div>
        </section>` : ""}
        <section class="res-sec">
          <h4>참고 이미지 <span class="muted small">${refs.length}장 · 만들 때 따라 할 사진</span></h4>
          <div class="res-thumbs">${thumbs(r, refs, true)}</div>
          ${dropZone("ref", "＋ 참고 이미지 넣기")}
        </section>
        <section class="res-sec">
          <h4>${part ? `${esc(pd.label)} 결과` : "결과 · 파일"} <span class="muted small">${outs.length}개 · 제작에 쓰는 확정본</span></h4>
          <div class="res-thumbs">${thumbs(r, outs, true)}</div>
          ${dropZone("output", "＋ 결과 직접 올리기")}
          ${part ? `<details class="res-gen" ${outs.length ? "" : "open"}>
            <summary>✨ 힉스필드로 ${esc(pd.label)} 만들기 <span class="muted small">(크레딧 사용)</span></summary>
            <p class="muted small" style="margin:0">위 📝 프롬프트와 체크한 참고 이미지로 만듭니다. 결과는 이 칸에 들어오고 기록에 남습니다.</p>
            <div class="ex__row"><span style="flex:1"></span><button class="btn btn--primary btn--sm" type="button" data-generate>힉스필드로 만들기 (${esc(pd.aspect)})</button></div>
          </details>` : ""}
        </section>
      </div>
      <section class="res-sec res-history">
        <h4>기록 <span class="muted small">${(r.history || []).length}건</span></h4>
        <ol>${[...(r.history || [])].reverse().map((h) => `<li>
          <span class="muted small">${when(h.at)}</span>
          <span>${h.part && k.parts?.[h.part] ? `<b>${esc(k.parts[h.part].label)}</b> · ` : ""}${h.role ? `${roleName(h.role)} ` : ""}${ACTIONS[h.action] || esc(h.action)}${h.files?.length ? ` ${h.files.length}개` : ""}</span>
          ${h.files?.length ? `<span class="res-history__imgs">${files(h.files).filter((f) => f.kind === "image").map((f) => `<a href="${url(r, f.file)}" target="_blank" rel="noopener"><img src="${url(r, f.file)}" alt="" loading="lazy"></a>`).join("")}</span>` : ""}
          ${h.prompt ? `<details><summary class="muted small">프롬프트</summary><p class="small">${esc(h.prompt)}</p></details>` : ""}
          ${h.action === "prompt" && h.before?.prompt ? `<details><summary class="muted small">고치기 전 프롬프트</summary><p class="small">${esc(h.before.prompt)}</p></details>` : ""}
          ${h.before && Object.keys(h.before.persona || {}).length ? `<details><summary class="muted small">덮어쓰기 전 페르소나</summary><p class="small">${Object.entries(h.before.persona).map(([kk, v]) => `${esc(k.persona?.find(([f]) => f === kk)?.[1] || kk)}: ${esc(v)}`).join("<br>")}</p></details>` : ""}
        </li>`).join("")}</ol>
      </section>
    </div>`;
}
// 가상 페르소나: 인물 사진 넣기 → 쓸 사진 고르기 → 만들기. 속성·부분 프롬프트·페르소나가 채워진다
function personaSec(r, k) {
  const imgs = r.files.filter((f) => f.kind === "image"), refs = imgs.filter((f) => f.role === "ref");
  const on = new Set((refs.length ? refs : imgs).slice(0, 4).map((f) => f.file)), filled = Object.keys(r.persona || {}).length;
  return `<section class="res-sec res-persona">
    <h4>🪄 가상 페르소나 <span class="muted small">${filled ? `${filled}칸 채움` : "아직 없음"}</span></h4>
    <p class="muted small" style="margin:0">인물 사진을 넣고 쓸 사진을 고른 뒤 만들기를 누르면, 사진에서 영감을 받은 <b>가상의 인물</b>로 속성 · 얼굴/체형/전신 시트 프롬프트 · 페르소나를 채웁니다 (사진 속 사람이 누구인지는 추측하지 않습니다). 덮어쓴 값은 기록에 남습니다.</p>
    ${imgs.length ? `<div class="res-gen__refs">${imgs.map((f) => `<label class="res-gen__ref"><input type="checkbox" data-pref="${esc(f.file)}" ${on.has(f.file) ? "checked" : ""}><img src="${url(r, f.file)}" alt=""><span class="muted small">${f.role === "ref" ? "참고" : "결과"}${f.part ? ` · ${esc(k.parts?.[f.part]?.label || "")}` : ""}</span></label>`).join("")}</div>` : ""}
    ${dropZone("ref", "＋ 인물 사진 넣기", "face")}
    <div class="ex__row"><span class="muted small" style="flex:1">${st.persona ? "Claude 가 사진을 보고 만드는 중… (1~2분)" : imgs.length ? `사진 ${on.size}장으로 만듭니다 (최대 4장)` : "먼저 인물 사진을 넣으세요"}</span>
      <button class="btn btn--primary btn--sm" type="button" data-mkpersona ${imgs.length && !st.persona ? "" : "disabled"}>🪄 가상 페르소나 만들기</button></div>
    <div class="res-fields res-fields--wide">${k.persona.map(([kk, label]) => `<label class="field"><span>${esc(label)}</span><textarea data-pf="${kk}" rows="2">${esc(r.persona?.[kk] || "")}</textarea></label>`).join("")}</div>
  </section>`;
}

// 길잡이 (public/nav.js): … › 인물 › 한소율 › 위저드 단계 — 뒤로는 한 칸 위로
const kindCrumb = () => ({ label: st.kinds?.[st.kind]?.label || "리소스", go: backToList });
async function leaveWizard() { if (!$("#resWizard").hidden) { await closeWizard(); await closeObjWizard(); $("#resWizard").hidden = true; } }
async function backToList() { await leaveWizard(); clearTimeout(saveT); if (st.open && !$("#resDetail").hidden) await saveEdits().catch(() => {}); st.open = null; await load(); closeDetail(); }

function openDetail(id) {
  st.open = st.list.find((r) => r.id === id) || null; if (!st.open) return;
  window.nav?.sub([kindCrumb(), { label: st.open.name, go: async () => { await leaveWizard(); await load(); openDetail(id); } }]);
  st.part = st.part && st.kinds[st.open.kind].parts?.[st.part] ? st.part : "face";
  $("#resDetail").hidden = false; $("#resListWrap").hidden = true; renderDetail();
  $("#resDetail").scrollIntoView({ block: "start" });
}
// 위저드: 목록·열린 폴더를 가리고 위저드 칸을 연다. 닫으면 목록으로 (저장했으면 그 인물 폴더로)
function startWizard(r) {
  st.wizKind = r.kind;
  $("#resListWrap").hidden = true; $("#resDetail").hidden = true; $("#resWizard").hidden = false;
  const prefix = [kindCrumb(), ...(r.status !== "draft" ? [{ label: r.name, go: async () => { await leaveWizard(); await load(); openDetail(r.id); } }] : [])];
  (r.kind === "person" ? openWizard : openObjWizard)(r, async (id, saved) => {
    $("#resWizard").hidden = true; st.open = null;
    await load();
    if (saved) openDetail(id); else closeDetail();
  }, prefix);
  $("#resWizard").scrollIntoView({ block: "start" });
}
function closeDetail() { st.open = null; $("#resDetail").hidden = true; $("#resListWrap").hidden = false; renderList(); window.nav?.sub([kindCrumb()]); }

async function reload() { const r = st.open; st.open = await api(`/api/resources/${r.kind}/${r.id}`); const i = st.list.findIndex((x) => x.id === r.id); if (i >= 0) st.list[i] = st.open; renderDetail(); renderTabs(); }

// 칸을 고치면 0.6초 뒤 저장 (기록에는 "내용 고침" 한 줄로 합쳐진다)
let saveT;
function readEdits() {
  const d = $("#resDetail"), r = st.open, k = st.kinds[r.kind];
  const val = (sel) => Object.fromEntries([...d.querySelectorAll(`[data-${sel}]`)].map((x) => [x.dataset[sel], x.value]));
  const b = val("basic"), patch = { name: b.name, tags: b.tags, description: b.description, attrs: val("attr") };
  if (k.persona) patch.persona = val("pf");
  if (k.persona) { patch.part = st.part; patch.parts = { [st.part]: { attrs: val("pattr"), prompt: d.querySelector("[data-prompt]")?.value || "", negative: d.querySelector("[data-negative]")?.value || "" } }; }
  return patch;
}
async function saveEdits() {
  const r = st.open;
  st.open = await api(`/api/resources/${r.kind}/${r.id}`, { method: "PUT", body: readEdits() });
  const i = st.list.findIndex((x) => x.id === r.id); if (i >= 0) st.list[i] = st.open;
}

async function upload(files, role, forcePart = "") {
  const r = st.open, tokens = [];
  for (const [i, f] of [...files].entries()) {
    toast(`올리는 중 ${i + 1}/${files.length}`);
    const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${f.name}: ${d.error || res.status}`);
    tokens.push(d.token);
  }
  clearTimeout(saveT); await saveEdits();
  st.open = await api(`/api/resources/${r.kind}/${r.id}/files`, { method: "POST", body: { tokens, role, part: st.kinds[r.kind].persona ? forcePart || st.part : null } });
  toast(`${roleName(role)} ${files.length}개를 넣었습니다`); await load();
}

function bind() {
  $("#resKinds").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) setKind(b.dataset.kind); });
  $("#resSearch").addEventListener("input", renderList);
  $("#resGrid").addEventListener("click", (e) => {
    if (e.target.closest("audio")) return;
    const b = e.target.closest("[data-open]"); if (!b) return;
    const r = st.list.find((x) => x.id === b.dataset.open);
    r?.status === "draft" ? startWizard(r) : openDetail(b.dataset.open);
  });
  $("#resNew").addEventListener("click", async () => {
    // 인물·배경·제품은 위저드로 (이름은 마지막에): 인물 얼굴 → 전신 → 시트 → 페르소나 · 배경 기본 장면 → 앵글 → 시간 · 제품 제품컷 → 시트 → 연출컷
    if (hasWizard(st.kind)) {
      const r = await api("/api/resources", { method: "POST", body: { kind: st.kind, status: "draft" } }).catch((err) => toast(err.message, true));
      if (r) { await load(); startWizard(r); }
      return;
    }
    const k = st.kinds[st.kind], name = prompt(`새 ${k.label} 이름`, ""); if (!name?.trim()) return;
    const r = await api("/api/resources", { method: "POST", body: { kind: st.kind, name } }).catch((err) => toast(err.message, true));
    if (r) { await load(); st.part = "face"; openDetail(r.id); }
  });
  const d = $("#resDetail");
  d.addEventListener("input", (e) => { if (e.target.type === "checkbox" || e.target.type === "file") return; clearTimeout(saveT); saveT = setTimeout(() => saveEdits().catch((err) => toast(err.message, true)), 600); });
  d.addEventListener("change", async (e) => {
    const up = e.target.closest("[data-upload]"); if (!up || !up.files.length) return;
    try { await upload(up.files, up.dataset.upload, up.dataset.forcepart); } catch (err) { toast(err.message, true); }
  });
  ["dragenter", "dragover"].forEach((t) => d.addEventListener(t, (e) => { const z = e.target.closest("[data-drop]"); if (z) { e.preventDefault(); z.classList.add("is-over"); } }));
  ["dragleave", "drop"].forEach((t) => d.addEventListener(t, (e) => e.target.closest("[data-drop]")?.classList.remove("is-over")));
  d.addEventListener("drop", async (e) => {
    const z = e.target.closest("[data-drop]"); if (!z) return; e.preventDefault();
    if (e.dataTransfer.files.length) try { await upload(e.dataTransfer.files, z.dataset.drop, z.dataset.forcepart); } catch (err) { toast(err.message, true); }
  });
  d.addEventListener("click", async (e) => {
    const r = st.open; if (!r) return;
    if (e.target.closest("[data-back]")) { clearTimeout(saveT); await saveEdits().catch(() => {}); return closeDetail(); }
    const pb = e.target.closest("[data-part]"); if (pb) { clearTimeout(saveT); await saveEdits().catch(() => {}); st.part = pb.dataset.part; return renderDetail(); }
    if (e.target.closest("[data-rewizard]")) { clearTimeout(saveT); await saveEdits().catch(() => {}); return startWizard(st.open); }
    if (e.target.closest("[data-reveal]")) return api(`/api/resources/${r.kind}/${r.id}/reveal`, { method: "POST" }).catch((err) => toast(err.message, true));
    if (e.target.closest("[data-delete]")) {
      if (!confirm(`"${r.name}" 을 지울까요? 폴더와 올린 파일·기록이 모두 지워집니다.`)) return;
      await api(`/api/resources/${r.kind}/${r.id}`, { method: "DELETE" }); st.open = null; closeDetail(); return load();
    }
    const rm = e.target.closest("[data-remove]");
    if (rm) { await api(`/api/resources/${r.kind}/${r.id}/files/${encodeURIComponent(rm.dataset.remove)}`, { method: "DELETE" }).catch((err) => toast(err.message, true)); toast("뺐습니다 — 기록에는 남아 있습니다"); return load(); }
    if (e.target.closest("[data-mkpersona]")) {
      const files = [...d.querySelectorAll("[data-pref]:checked")].map((x) => x.dataset.pref);
      if (!files.length) return toast("쓸 사진을 하나 이상 고르세요", true);
      if (Object.keys(r.persona || {}).length && !confirm("지금 적힌 속성·프롬프트·페르소나를 새로 채웁니다 (덮어쓴 값은 기록에 남습니다). 계속할까요?")) return;
      clearTimeout(saveT); await saveEdits().catch(() => {});
      try { await api(`/api/resources/${r.kind}/${r.id}/persona`, { method: "POST", body: { files: files.slice(0, 4) } }); st.persona = true; renderDetail(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest("[data-copy]")) {
      const p = d.querySelector("[data-prompt]").value.trim(), n = d.querySelector("[data-negative]").value.trim();
      await navigator.clipboard.writeText(n ? `${p}\n\nNegative prompt: ${n}` : p).then(() => toast("프롬프트를 복사했습니다"), () => toast("복사하지 못했습니다 — 칸을 직접 선택해 복사하세요", true));
      return;
    }
    if (e.target.closest("[data-complete]")) {
      const files = [...d.querySelectorAll("[data-genref]:checked")].map((x) => x.dataset.genref);
      clearTimeout(saveT); await saveEdits().catch(() => {});
      try { await api(`/api/resources/${r.kind}/${r.id}/prompt`, { method: "POST", body: { part: st.part, files: files.slice(0, 4) } }); st.prompting = true; renderDetail(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest("[data-reprompt]")) {
      const attrs = Object.fromEntries([...d.querySelectorAll("[data-pattr]")].map((x) => [x.dataset.pattr, x.value]));
      d.querySelector("[data-prompt]").value = PROMPTS[st.part](attrs, whoOf({ attrs: Object.fromEntries([...d.querySelectorAll("[data-attr]")].map((x) => [x.dataset.attr, x.value])) }));
      return d.querySelector("[data-prompt]").dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (e.target.closest("[data-generate]")) {
      const pd = st.kinds[r.kind].parts[st.part], refs = [...d.querySelectorAll("[data-genref]:checked")].map((x) => x.dataset.genref);
      const neg = d.querySelector("[data-negative]").value.trim();
      const promptText = d.querySelector("[data-prompt]").value.trim() + (neg ? ` Avoid: ${neg}.` : ""); if (!promptText.trim()) return toast("프롬프트를 적으세요", true);
      if (!confirm(`힉스필드로 "${r.name}" ${pd.label}을 만듭니다 (참고 ${refs.length}장, ${pd.aspect}).\n크레딧이 듭니다. 계속할까요?`)) return;
      clearTimeout(saveT); await saveEdits().catch(() => {});
      try {
        await api("/api/hf/generate", { method: "POST", body: { target: { type: "resource", kind: r.kind, id: r.id, part: st.part }, kind: "image", purpose: "sheet", prompt: promptText, refs, aspect: pd.aspect } });
        st.waiting = true; toast("힉스필드에서 만드는 중 — 끝나면 결과에 들어오고 기록에 남습니다 (1~3분)");
      } catch (err) { toast(err.message, true); }
    }
  });
  // 힉스필드·페르소나 작업이 끝나면 열린 리소스를 다시 읽는다
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "job" && e.kind === "persona" && e.state !== "start" && st.prompting) {
      st.prompting = false;
      if (e.state === "error") { toast(e.message, true); renderDetail(); } else { toast("프롬프트를 완성했습니다 — 복사하거나 힉스필드로 만들 수 있습니다"); load(); }
    }
    if (e.type === "job" && e.kind === "persona" && e.state !== "start" && st.persona) {
      st.persona = false;
      if (e.state === "error") { toast(e.message, true); renderDetail(); } else { toast("가상 페르소나를 채웠습니다 — 얼굴·체형·전신 시트 프롬프트도 들어갔습니다"); load(); }
    }
    if (e.type === "job" && e.kind === "hf" && e.state !== "start" && st.waiting && e.result?.type !== "drama") {
      st.waiting = false;
      if (e.state === "error") toast(e.message, true); else { toast("힉스필드 결과를 넣었습니다"); load(); }
    }
  });
}

function setKind(kind) {
  if (!st.kinds?.[kind] || st.kinds[kind].hidden) kind = "person";
  if (!$("#resWizard").hidden && kind !== st.wizKind) { leaveWizard(); $("#resListWrap").hidden = false; } // 다른 종류로 가면 열린 위저드는 저장하고 닫는다
  st.kind = kind; if (st.open && st.open.kind !== kind) closeDetail();
  renderTabs(); renderList();
  if (!st.open && $("#resWizard").hidden) window.nav?.sub([kindCrumb()]);
  window.dispatchEvent(new CustomEvent("res-kind", { detail: kind })); // app.js: 목소리면 목소리 만들기 칸을 연다
}

let bound = false;
window.resPage = {
  async load() { if (!bound) { bind(); bound = true; } return load(); },
  setKind,
};
