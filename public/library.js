// 리소스 (#res) · 레퍼런스 (#ref) — 같은 화면을 두 갈래로 쓴다 (서버: /api/resources · /api/clients · /api/hf/generate · /api/uploads/url)
//   리소스: 고객사 폴더 · 종류별 보기 · 개별/묶음 올리기 · 시트로 만들기 (AI 는 이것 하나 — 크레딧, 매번 확인)
//   레퍼런스: 스타일·구도·색감 참고 이미지 (kind "reference") · 태그로 나눠 보기 · 링크로 넣기. 이미지 소재·이미지 변형에서 참고 이미지로 불러 쓴다
import { esc } from "./fields.js";

const $ = (s) => document.querySelector(s);
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

const RES_KINDS = { person: "인물", background: "배경", product: "소품·제품", voice: "목소리", asset: "고객사 에셋", target: "페르소나", doc: "참고 문서", color: "브랜드 컬러" }; // 사업체 소개(company)는 페르소나 위자드로 합침 (2026-11-04)
// 문서 종류 — md·txt·pdf·이미지를 올리거나 화면에서 md 로 바로 쓴다. md·txt 는 상세 창에서 읽고 고친다
const DOC_KINDS = new Set(["asset", "target", "doc"]);
const DOC_HINT = { asset: "로고·브랜드 가이드·컬러·폰트 규칙", target: "고객사 마케팅 기준 — 사업체 소개·소구점·차별점·혜택·말투·금지어", doc: "그 밖에 제작 때 볼 자료" };
const isDocFile = (name) => /\.(md|txt|pdf)$/i.test(name);
const isText = (name) => /\.(md|txt)$/i.test(name);
export const REF_TAGS = ["스타일", "구도", "색감", "레이아웃", "타이포", "인물 연출", "제품 연출"];
const MODE = {
  res: { kinds: RES_KINDS, title: "리소스", desc: "고객사 폴더를 만들고 인물·배경·제품·목소리와 <strong>고객사 에셋·참고 문서</strong>(md·txt·pdf)를 올려 두고, <strong>페르소나</strong>에 고객사의 사업체 소개·소구점·혜택·말투를 정해 둡니다. 문서는 화면에서 바로 써서 저장할 수도 있습니다. 사진 한 장으로 여러 각도의 <strong>시트</strong>를 만들 수 있습니다." },
  ref: { kinds: { reference: "레퍼런스" }, title: "레퍼런스", desc: "스타일·구도·색감을 참고할 이미지를 모아 둡니다. <strong>이미지 소재</strong>의 참고 이미지, <strong>이미지 변형</strong>의 스타일 레퍼런스로 불러 씁니다. 파일로 올리거나 링크로 넣습니다." },
};
let KINDS = RES_KINDS;
// 시트 — 종류마다 결과를 넣을 칸(part)과 프롬프트. 사진 속 대상을 그대로 두고 각도만 늘린다
const SHEET = {
  person: { part: "sheet", label: "인물 시트", aspect: "16:9", model: "nano_banana_pro",
    prompt: "Character reference sheet of the exact person in image 1. Keep the same face, hairstyle, body shape and outfit. Layout on one canvas: full-body front view, left side view, back view, and two close-up portraits (front and three-quarter). Neutral light-gray studio background, soft even lighting, consistent identity and proportions across every view. No text, no labels, no watermark." },
  product: { part: "sheet", label: "제품 시트", aspect: "16:9", model: "gpt_image_2_5",
    prompt: "Product reference sheet of the exact product in image 1. Do not redesign it — keep its shape, proportions, label, logo, colors and materials exactly. Layout on one canvas: front, back, left side, right side, top and three-quarter views, evenly spaced on a seamless white background with soft studio shadows. No added text, no watermark." },
  background: { part: "angles", label: "앵글 시트", aspect: "16:9", model: "gpt_image_2_5",
    prompt: "Location angle sheet of the exact place in image 1. A 2x2 grid showing the same space from four camera angles: wide front view, reverse angle, side view, and a close detail. Keep the same architecture, furniture, materials, colors and lighting in every panel. No people, no text, no watermark." },
};
const st = { mode: "res", list: [], clients: [], folder: "all", kind: "", tag: "", bound: false, open: null, busy: new Set(), upTags: new Set() };
const formOf = (f) => f.form || (["sheet", "angles", "outfit"].includes(f.part) ? "sheet" : "single"); // 형태를 넣기 전에 올린 파일은 시트 단계 결과면 시트로 본다
const url = (r, f) => `/data/_resources/${r.kind}/${r.id}/${encodeURIComponent(f)}`;
const images = (r) => (r.files || []).filter((f) => f.kind === "image");
const thumbOf = (r) => { const im = images(r); return (im.find((f) => !SHEET[r.kind] || f.part !== SHEET[r.kind].part) || im[0])?.file; };
const sheets = (r) => (SHEET[r.kind] ? images(r).filter((f) => f.part === SHEET[r.kind].part && f.source === "generated") : []);
const clientName = (id) => st.clients.find((c) => c.id === id)?.name || "일반";

// ── 브랜드 컬러 (kind color · r.colors = [{ hex, name, role }]) — 올리기 칸과 상세 창에서 같은 편집기를 쓴다 ──
const COLOR_ROLES = [["main", "주색"], ["sub", "보조색"], ["accent", "강조색"], ["bg", "바탕색"], ["text", "글자색"]];
const hexOk = (v) => { let h = String(v || "").trim().toUpperCase(); if (!h.startsWith("#")) h = `#${h}`; if (/^#[0-9A-F]{3}$/.test(h)) h = `#${[...h.slice(1)].map((x) => x + x).join("")}`; return /^#[0-9A-F]{6}$/.test(h) ? h : ""; };
const colorRow = (c = {}) => `<div class="lib-color" data-crow>
    <input type="color" value="${hexOk(c.hex) || "#000000"}" data-cpick aria-label="색 고르기">
    <input class="lib-color__hex" value="${esc(c.hex || "")}" placeholder="#0057FF" data-chex aria-label="색 코드">
    <input value="${esc(c.name || "")}" placeholder="이름 (예: 로고 파랑)" data-cname aria-label="색 이름">
    <select data-crole aria-label="쓰임">${[["", "쓰임"], ...COLOR_ROLES].map(([k, l]) => `<option value="${k}" ${c.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button type="button" class="btn btn--ghost btn--sm" data-cdel aria-label="이 색 빼기">빼기</button></div>`;
const colorEditor = (list) => `<div class="lib-colors" data-colors>${(list?.length ? list : [{ role: "main" }]).map(colorRow).join("")}</div>
  <button type="button" class="btn btn--ghost btn--sm" data-cadd>＋ 색 더하기</button>`;
const readColors = (box) => [...box.querySelectorAll("[data-crow]")].map((row) => ({ hex: hexOk(row.querySelector("[data-chex]").value), name: row.querySelector("[data-cname]").value.trim(), role: row.querySelector("[data-crole]").value })).filter((c) => c.hex);
const swatches = (r) => `<span class="lib-swatches">${(r.colors || []).map((c) => `<i style="background:${c.hex}" title="${esc(`${c.name || ""} ${c.hex}`)}"></i>`).join("")}</span>`;
// 편집기 안의 클릭·입력 — 색 더하기 · 빼기 · 팔레트와 코드 칸 맞추기
function bindColorEditor(root) {
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-cadd]")) { const box = e.target.closest("[data-cadd]").previousElementSibling; box.insertAdjacentHTML("beforeend", colorRow()); box.lastElementChild.querySelector("[data-chex]").focus(); }
    const del = e.target.closest("[data-cdel]"); if (del) del.closest("[data-crow]").remove();
  });
  root.addEventListener("input", (e) => {
    const row = e.target.closest("[data-crow]"); if (!row) return;
    if (e.target.matches("[data-cpick]")) row.querySelector("[data-chex]").value = e.target.value.toUpperCase();
    if (e.target.matches("[data-chex]")) { const h = hexOk(e.target.value); if (h) row.querySelector("[data-cpick]").value = h; }
  });
}
async function saveColorNew() {
  const name = $("#libCName").value.trim(), colors = readColors($("#libColorNew"));
  if (st.upMode === "client" && !upClient()) return toast("고객사를 고르거나 새로 만드세요", true);
  if (!name) { $("#libCName").focus(); return toast("이름을 적으세요", true); }
  if (!colors.length) return toast("색 코드를 하나 이상 적으세요 (예: #0057FF)", true);
  try {
    await api("/api/resources", { method: "POST", body: { kind: "color", client: upClient(), name, colors } });
    $("#libCName").value = ""; $("#libColorNew [data-colors]").innerHTML = colorRow({ role: "main" });
    $("#libUpMsg").textContent = "브랜드 컬러 1개 저장"; toast(`"${name}" 컬러를 저장했습니다`); await load();
  } catch (e) { toast(e.message, true); }
}

function renderFolders() {
  const n = (f) => st.list.filter((r) => f === "all" || (f === "none" ? !r.client : r.client === f)).length;
  // ⋯ 를 누르면 그 줄 아래 메뉴 — 이름 바꾸기 · 폴더만 지우기(리소스는 일반으로) · 폴더와 리소스 모두 지우기
  const menu = (id) => st.fmenu === id ? `<div class="lib-fmenu" role="menu"><button type="button" role="menuitem" data-fact="rename|${id}">이름 바꾸기</button><button type="button" role="menuitem" data-fact="move|${id}">폴더만 지우기 <span class="muted small">리소스는 일반으로</span></button><button type="button" role="menuitem" class="is-danger" data-fact="purge|${id}">폴더와 리소스 모두 지우기 <span class="small">${n(id)}개</span></button></div>` : "";
  const row = (id, name, del) => `<li><button class="lib-folder ${st.folder === id ? "is-on" : ""}" type="button" data-folder="${id}"><span>${esc(name)}</span><span class="muted">${n(id)}</span></button>${del ? `<button class="lib-folder__more ${st.fmenu === id ? "is-on" : ""}" type="button" data-fmore="${id}" aria-haspopup="menu" aria-expanded="${st.fmenu === id}" aria-label="${esc(name)} 폴더 이름 바꾸기·지우기">⋯</button>` : `<span class="lib-folder__sp" aria-hidden="true"></span>`}${menu(id)}</li>`; // ⋯ 없는 줄도 같은 자리를 비워 숫자 줄을 맞춘다
  $("#libFolders").innerHTML = row("all", "전체") + st.clients.map((c) => row(c.id, c.name, true)).join("") + row("none", "일반 (고객사 없음)");
}

function renderKinds() {
  const inFolder = st.list.filter((r) => st.folder === "all" || (st.folder === "none" ? !r.client : r.client === st.folder));
  if (st.mode === "ref") {
    $("#libKinds").innerHTML = [["", "전체"], ...REF_TAGS.map((t) => [t, t])].map(([k, l]) => `<button class="seg__btn ${st.tag === k ? "is-on" : ""}" type="button" data-tag="${esc(k)}">${esc(l)} <span data-n>${inFolder.filter((r) => !k || (r.tags || []).includes(k)).length}</span></button>`).join("");
    return;
  }
  $("#libKinds").innerHTML = [["", "전체"], ...Object.entries(KINDS)].map(([k, l]) => `<button class="seg__btn ${st.kind === k ? "is-on" : ""}" type="button" data-kind="${k}">${l} <span data-n>${inFolder.filter((r) => !k || r.kind === k).length}</span></button>`).join("");
}

function renderGrid() {
  const q = $("#libQ").value.trim().toLowerCase();
  const list = st.list.filter((r) => (st.folder === "all" || (st.folder === "none" ? !r.client : r.client === st.folder)) && (!st.kind || r.kind === st.kind) && (!st.tag || (r.tags || []).includes(st.tag))
    && (!q || `${r.name} ${(r.tags || []).join(" ")} ${r.description || ""}`.toLowerCase().includes(q)));
  $("#libGrid").innerHTML = list.map((r) => {
    const t = thumbOf(r), sh = sheets(r).length, busy = st.busy.has(r.id), key = `${r.kind}/${r.id}`, on = st.sel?.has(key);
    // 카드 위 수정·삭제 (마우스를 올리면) · 여러 개 고르기 중에는 체크 표시
    return `<div class="lib-cw ${st.sel ? "is-sel" : ""} ${on ? "is-on" : ""}">${st.sel ? `<span class="lib-cw__check" aria-hidden="true">${on ? "✓" : ""}</span>`
      : `<div class="lib-cw__acts"><button type="button" data-edit="${key}">수정</button><button type="button" data-del="${key}">삭제</button></div>`}
    <button class="lib-card" type="button" data-open="${key}" ${st.sel ? `aria-pressed="${!!on}"` : ""}>
      <span class="lib-card__media">${r.kind === "color" && r.colors?.length ? swatches(r) : t ? `<img src="${url(r, t)}" alt="" loading="lazy">` : `<span class="xp-ph">${r.kind === "voice" ? "목소리" : KINDS[r.kind] || ""}</span>`}
        <span class="lib-card__kind">${esc(st.mode === "ref" ? (r.tags || []).slice(0, 2).join(" · ") || "레퍼런스" : KINDS[r.kind] || r.kind)}</span>${busy ? `<span class="lib-card__sheet is-run">시트 만드는 중</span>` : sh ? `<span class="lib-card__sheet">시트 ${sh}</span>` : ""}</span>
      <strong class="lib-card__t">${esc(r.name)}</strong>
      <span class="lib-card__m">${esc(clientName(r.client))} · ${r.kind === "color" ? `색 ${(r.colors || []).length}` : `파일 ${(r.files || []).length}`}</span>
    </button></div>`;
  }).join("") || `<p class="lib-empty">${st.list.length ? "조건에 맞는 것이 없습니다." : st.mode === "ref" ? "아직 레퍼런스가 없습니다. [＋ 올리기]로 이미지를 올리거나 링크로 넣어 보세요." : "아직 리소스가 없습니다. [＋ 올리기]로 사진·영상·음성을 올려 보세요."}</p>`;
}

const renderAll = () => { renderFolders(); renderKinds(); renderGrid(); if (st.open) renderDetail(); };

// ── 지우기 · 여러 개 고르기 ──
const byKey = (key) => { const [kind, id] = key.split("/"); return st.list.find((r) => r.kind === kind && r.id === id); };
async function removeMany(list) {
  const msg = list.length === 1 ? `"${list[0].name}" 리소스를 지울까요? 파일도 함께 지워집니다.` : `리소스 ${list.length}개를 지울까요? 파일도 함께 지워집니다.\n\n${list.slice(0, 8).map((r) => `· ${r.name}`).join("\n")}${list.length > 8 ? `\n· 외 ${list.length - 8}개` : ""}`;
  if (!confirm(msg)) return false;
  let fail = 0;
  for (const r of list) { try { await api(`/api/resources/${r.kind}/${r.id}`, { method: "DELETE" }); } catch { fail++; } }
  if (st.open && list.some((r) => r.id === st.open.id) && $("#libDialog").open) $("#libDialog").close();
  toast(`${list.length - fail}개 지웠습니다${fail ? ` · ${fail}개 실패` : ""}`, !!fail); await load();
  return true;
}
function setSel(on) {
  st.sel = on ? new Set() : null;
  $("#libSelBar").hidden = !on; $("#libSelBtn").hidden = on;
  if (on) $("#libSelMove").innerHTML = `<option value="">일반 (고객사 없음)</option>` + st.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  renderGrid(); selText();
}
const selText = () => { if (st.sel) $("#libSelN").textContent = `${st.sel.size}개 고름`; };

async function load() {
  [st.list, st.clients] = await Promise.all([api("/api/resources"), api("/api/clients")]);
  st.list = st.list.filter((r) => KINDS[r.kind]);
  if (st.mode === "ref") $("#libKinds").setAttribute("aria-label", "태그");
  if (st.folder !== "all" && st.folder !== "none" && !st.clients.some((c) => c.id === st.folder)) st.folder = "all";
  if (st.open) st.open = st.list.find((r) => r.id === st.open.id) || null;
  fillUpSelects(); renderAll();
}

// ── 올리기 ──
function fillUpSelects() {
  const k = $("#libUpKind"), c = $("#libUpClient"), kv = k.value, cv = c.value;
  k.innerHTML = Object.entries(KINDS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  c.innerHTML = `<option value="" disabled>고객사를 고르세요</option>` + st.clients.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  k.value = st.mode === "ref" ? "reference" : KINDS[kv] ? kv : st.kind || "product";
  c.value = cv && [...c.options].some((o) => o.value === cv) ? cv : st.clients.some((x) => x.id === st.folder) ? st.folder : "";
  kindChanged();
}
// 문서 종류를 고르면 "바로 쓰기" 칸을 보이고 파일 고르기에 md·txt·pdf 를 더한다
function kindChanged() {
  const k = $("#libUpKind").value, doc = st.mode === "res" && DOC_KINDS.has(k);
  $("#libWrite").hidden = !doc;
  const color = st.mode === "res" && k === "color"; // 컬러는 파일 대신 색 코드를 적는다
  $("#libColorNew").hidden = !color; $("#libDrop").hidden = color; $("#libUpOneF").hidden = color;
  if (color && !$("#libColorNew [data-colors]").children.length) $("#libColorNew [data-colors]").innerHTML = colorRow({ role: "main" });
  $("#libWizStart").hidden = !WIZ[k]; $("#libWriteFree").hidden = !!WIZ[k];
  if (doc) $("#libWBody").placeholder = `# ${RES_KINDS[k]}\n\n${DOC_HINT[k]}`;
  $("#libFiles").accept = st.mode === "ref" ? "image/*" : doc ? "image/*,.md,.txt,.pdf" : "image/*,video/*,audio/*,.md,.txt,.pdf";
}
// 올리기 — 먼저 "고객사 리소스 / 일반 리소스"를 고른다 (레퍼런스 모드는 고르지 않고 바로 일반으로)
function openUpload() {
  fillUpSelects();
  if (st.kind) $("#libUpKind").value = st.kind;
  kindChanged();
  $("#libUp").hidden = false; $("#libUpMsg").textContent = "";
  // 고객사 폴더를 보고 있으면 그 고객사로 바로, 일반을 보고 있으면 일반으로 바로, 전체면 고르게 한다
  const inClient = st.clients.some((x) => x.id === st.folder);
  setUpMode(st.mode === "ref" ? "general" : inClient ? "client" : st.folder === "none" ? "general" : null);
  if (inClient) { $("#libUpClient").value = st.folder; whereText(); }
}
function whereText() {
  const c = st.clients.find((x) => x.id === $("#libUpClient").value);
  $("#libUpWhere").innerHTML = st.upMode === "general" ? "<strong>일반 리소스</strong>로 올립니다 (고객사 없음)"
    : c ? `<strong>${esc(c.name)}</strong> 고객사 폴더로 올립니다` : "고객사를 고르거나 새로 만드세요";
  $("#libDrop").classList.toggle("is-off", st.upMode === "client" && !c);
}
function setUpMode(m) {
  st.upMode = m;
  $("#libUpChoose").hidden = !!m; $("#libUpBody").hidden = !m;
  $("#libUpClientRow").hidden = m !== "client";
  $("#libUpBack").hidden = st.mode === "ref";
  if (m === "client" && !$("#libUpClient").value) { $("#libUpClient").selectedIndex = 0; if (!st.clients.length) $("#libUpNewClient").focus(); }
  if (m) whereText();
}
const upClient = () => (st.upMode === "client" ? $("#libUpClient").value || "" : "");
const baseName = (n) => n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60) || "이름 없음";
const kindOfFile = (f, chosen) => (chosen === "reference" ? "reference" : DOC_KINDS.has(chosen) ? chosen : isDocFile(f.name) ? "doc"
  : /^audio\//.test(f.type) ? "voice" : chosen === "voice" && /^image\//.test(f.type) ? "product" : chosen);
const upTags = () => (st.mode === "ref" ? [...st.upTags] : []);

async function uploadOne(f) {
  const r = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
  return d.token;
}
async function upload(fileList) {
  const docKind = DOC_KINDS.has($("#libUpKind").value);
  // md 는 브라우저가 type 을 비워 두는 일이 많아 이름으로 본다. 문서 종류에는 영상·음성을 넣지 않는다
  const files = [...fileList].filter((f) => !f.name.startsWith(".") && (st.mode === "ref" ? /^image\//.test(f.type)
    : docKind ? /^image\//.test(f.type) || isDocFile(f.name) : /^(image|video|audio)\//.test(f.type) || isDocFile(f.name)));
  if (!files.length) return toast(docKind ? "올릴 수 있는 문서(md·txt·pdf)·이미지가 없습니다" : "올릴 수 있는 사진·영상·음성·문서가 없습니다", true);
  if (st.upMode === "client" && !upClient()) return toast("고객사를 고르거나 새로 만드세요", true);
  const kind = $("#libUpKind").value, client = upClient(), one = $("#libUpOne").checked;
  if (one && !$("#libUpName").value.trim()) { $("#libUpName").focus(); return toast("묶을 리소스 이름을 적으세요", true); }
  const msg = $("#libUpMsg"); let done = 0, fail = 0;
  try {
    if (one) {
      const tokens = [];
      for (const f of files) { msg.textContent = `올리는 중 ${tokens.length + 1}/${files.length}`; tokens.push(await uploadOne(f)); }
      await api("/api/resources", { method: "POST", body: { kind, client, name: $("#libUpName").value.trim(), tokens, tags: upTags() } });
      done = 1;
    } else {
      for (const f of files) {
        msg.textContent = `올리는 중 ${done + fail + 1}/${files.length} — ${f.name}`;
        try { await api("/api/resources", { method: "POST", body: { kind: kindOfFile(f, kind), client, name: baseName(f.name), tokens: [await uploadOne(f)], tags: upTags() } }); done++; }
        catch { fail++; }
      }
    }
  } catch (e) { return toast(e.message, true); }
  finally { $("#libFiles").value = ""; $("#libDir").value = ""; }
  msg.textContent = `${done}개 올림${fail ? ` · ${fail}개 실패` : ""}`;
  toast(one ? `리소스 1개로 묶어 올렸습니다 (파일 ${files.length}장)` : `리소스 ${done}개를 올렸습니다${fail ? ` (${fail}개 실패)` : ""}`, !!fail && !done);
  $("#libUpName").value = "";
  await load();
}

// 링크로 넣기 (레퍼런스) — 이미지 주소 또는 페이지 링크(og:image)
async function uploadUrl() {
  const link = $("#libUrl").value.trim(); if (!link) return;
  const msg = $("#libUpMsg");
  try {
    msg.textContent = "링크에서 이미지를 받는 중…";
    const r = await api("/api/uploads/url", { method: "POST", body: { url: link } });
    await api("/api/resources", { method: "POST", body: { kind: "reference", client: upClient(), name: baseName(r.name), tokens: [r.token], tags: upTags(), attrs: { source: r.from } } });
    $("#libUrl").value = ""; msg.textContent = "링크에서 1개 넣음"; toast("레퍼런스를 넣었습니다"); await load();
  } catch (e) { msg.textContent = ""; toast(e.message, true); }
}

// 문서 바로 쓰기 — 적은 내용을 <제목>.md 파일로 만들어 올린다 (고객사 에셋·참고 문서 — 페르소나는 위자드)
const mdFile = (title, text) => new File([text], `${title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "문서"}.md`, { type: "text/markdown" });
async function writeDoc() {
  const kind = $("#libUpKind").value, title = $("#libWTitle").value.trim(), text = $("#libWBody").value;
  if (!DOC_KINDS.has(kind)) return;
  if (st.upMode === "client" && !upClient()) return toast("고객사를 고르거나 새로 만드세요", true);
  if (!title) { $("#libWTitle").focus(); return toast("제목을 적으세요", true); }
  if (!text.trim()) { $("#libWBody").focus(); return toast("내용을 적으세요", true); }
  try {
    const token = await uploadOne(mdFile(title, text));
    await api("/api/resources", { method: "POST", body: { kind, client: upClient(), name: title, tokens: [token] } });
    $("#libWTitle").value = ""; $("#libWBody").value = "";
    $("#libUpMsg").textContent = `${RES_KINDS[kind]} 1개 저장`; toast(`"${title}" 문서를 저장했습니다`); await load();
  } catch (e) { toast(e.message, true); }
}
// ── 문서 위자드 — 질문을 한 단계씩. 단계마다 글 · 첨부, 이전 · 건너뛰기 · 다음. 마지막에 md 를 보여 주고 저장 ──
//   답한 단계만 md 의 절(## 제목)이 되고, 첨부는 리소스 파일로 같이 붙는다 (md 끝에 어느 단계 첨부인지 적는다)
const WIZ = {
  // 페르소나 = 고객사 한 곳의 마케팅 기준표 — 사업체 소개 + 소구점·차별점·혜택·말투·금지어. 소재(카피·이미지·영상)를 만들 때 이 기준을 따른다
  target: { title: "페르소나 만들기", steps: [
    { key: "name", q: "이 페르소나를 뭐라고 부를까요?", hint: "보통 고객사 이름 — 목록에 이 이름으로 보입니다", ph: "예: 코웨이 햇살대리점", one: true, need: true },
    { key: "intro", h: "사업체 소개", q: "어떤 곳인가요?", hint: "업종 · 하는 일 · 지역 · 운영 기간 · 규모", ph: "예: 경기 화성 동탄의 코웨이 정수기·비데 렌탈 대리점. 2015년부터 운영, 방문 관리 직원 5명" },
    { key: "product", h: "주력 상품·서비스", q: "무엇을 가장 팔고 싶나요?", hint: "이번 소재에서 밀 상품 · 서비스", ph: "예: 아이콘 정수기 2, 노블 비데" },
    { key: "usp", h: "소구점", q: "왜 여기서 사야 하나요? 가장 먼저 말할 장점은?", hint: "고객이 얻는 것 기준으로 · 중요한 순서대로", ph: "예: 1. 직접 방문 관리 — 필터 교체 걱정 없음\n2. 설치 당일 가능\n3. 렌탈료 첫 3개월 반값" },
    { key: "diff", h: "차별점", q: "다른 대리점·경쟁 브랜드와 무엇이 다른가요?", ph: "예: 동네 대리점이라 A/S 가 24시간 안에 온다, 본사 이벤트에 대리점 사은품을 더 준다" },
    { key: "target", h: "타깃 고객", q: "누구에게 팔고 싶나요?", hint: "나이대 · 상황 · 고민", ph: "예: 동탄 신도시 30~40대 맞벌이 부부, 아이가 어려 물 관리가 신경 쓰이는 집" },
    { key: "offer", h: "혜택·프로모션", q: "지금 내세울 혜택이 있나요?", hint: "가격 · 할인 · 사은품 · 기간", ph: "예: 11월 한 달 렌탈료 3개월 50% · 설치비 무료 · 상품권 5만원" },
    { key: "proof", h: "신뢰 근거", q: "믿을 만한 근거가 있나요?", hint: "후기 · 수상 · 인증 · 숫자 (확인된 것만)", ph: "예: 지역 맘카페 후기 다수, 본사 우수 대리점 선정 (2025)" },
    { key: "tone", h: "말투·톤", q: "어떤 말투로 말할까요?", hint: "브랜드 느낌 · 자주 쓰는 표현", ph: "예: 이웃처럼 친근하게, 반말 X, \"알아서 챙겨 드려요\"" },
    { key: "banned", h: "금지어·주의", q: "쓰면 안 되는 말이나 주의할 점이 있나요?", hint: "광고 심의 · 본사 가이드 · 과장 표현", ph: "예: \"최저가\" \"무조건\" 금지, 본사 로고 변형 금지, 타사 비방 금지" },
    { key: "cta", h: "행동 유도", q: "보고 나서 무엇을 하게 할까요?", hint: "연락 방법 · 버튼 문구", ph: "예: 카카오톡 상담 → '무료 상담 받기', 전화 031-000-0000" },
  ] },
};
// edit: 고치는 중인 리소스 (없으면 새로 만들기) · oldMd: 바꿔 끼울 옛 md 파일 · keep: 그대로 두는 옛 첨부 이름
const wz = { kind: "", i: 0, ans: {}, files: [], client: "", edit: null, oldMd: "", keep: [] };
const wzDef = () => WIZ[wz.kind];
const wzLast = () => wz.i >= wzDef().steps.length; // 마지막(확인) 단계
function wzMd() {
  const d = wzDef(), cname = wz.client ? st.clients.find((c) => c.id === wz.client)?.name : "";
  const out = [`# ${wz.ans.name || "이름 없음"}`, "", `> ${RES_KINDS[wz.kind]}${cname ? ` · ${cname}` : ""} · ${new Date().toISOString().slice(0, 10)}`, ""];
  for (const s of d.steps.slice(1)) if (wz.ans[s.key]?.trim()) out.push(`## ${s.h}`, "", wz.ans[s.key].trim(), "");
  if (wz.keep.length || wz.files.length) out.push("## 첨부", "", ...wz.keep.map((n) => `- ${n}`), ...wz.files.map((f) => `- ${f.file.name} (${d.steps.find((s) => s.key === f.step)?.h || "기본"})`), "");
  return out.join("\n");
}
function wzSaveText() { const t = $("#libWzText"); if (t) wz.ans[wzDef().steps[wz.i].key] = t.value; }
function wzRender() {
  const d = wzDef(), n = d.steps.length;
  $("#libWzTitle").textContent = wz.edit ? `${d.title.replace("만들기", "고치기")} · ${wz.edit.name}` : d.title;
  $("#libWzCount").textContent = wzLast() ? "확인" : `${wz.i + 1} / ${n}`;
  $("#libWzBar").style.width = `${Math.round((wz.i / n) * 100)}%`;
  $("#libWzPrev").disabled = wz.i === 0;
  $("#libWzSkip").hidden = wzLast() || !!d.steps[wz.i]?.need;
  $("#libWzNext").textContent = wzLast() ? "저장" : wz.i === n - 1 ? "다 했어요 →" : "다음 →";
  if (wzLast()) {
    const answered = d.steps.filter((s) => wz.ans[s.key]?.trim()).length;
    $("#libWzBody").innerHTML = `<h3 class="lib-wiz__q">이렇게 저장할까요?</h3>
      <p class="muted small">${answered}/${n} 단계 답함 · 첨부 ${wz.keep.length + wz.files.length}개${wz.keep.length ? ` (그대로 두는 것 ${wz.keep.length})` : ""} · 단계를 눌러 돌아가 고칠 수 있습니다</p>
      <div class="lib-wiz__jump">${d.steps.map((s, i) => `<button type="button" class="seg__btn ${wz.ans[s.key]?.trim() ? "is-on" : ""}" data-wzgo="${i}">${i + 1}. ${esc(s.h || "이름")}</button>`).join("")}</div>
      <div class="lib-doc"><pre>${esc(wzMd())}</pre></div>`;
    return;
  }
  const s = d.steps[wz.i], mine = wz.files.map((f, j) => [f, j]).filter(([f]) => f.step === s.key);
  $("#libWzBody").innerHTML = `<h3 class="lib-wiz__q">${esc(s.q)}</h3>${s.hint ? `<p class="muted small">${esc(s.hint)}</p>` : ""}
    ${s.one ? `<input id="libWzText" placeholder="${esc(s.ph)}" value="${esc(wz.ans[s.key] || "")}">` : `<textarea id="libWzText" rows="6" placeholder="${esc(s.ph)}">${esc(wz.ans[s.key] || "")}</textarea>`}
    ${s.one ? "" : `<div class="lib-wiz__files">${mine.map(([f, j]) => `<span class="lib-wiz__chip">${esc(f.file.name)}<button type="button" data-wzrm="${j}" aria-label="${esc(f.file.name)} 빼기">×</button></span>`).join("")}
      <label class="btn btn--ghost btn--sm">＋ 첨부<input id="libWzFiles" type="file" multiple accept="image/*,.md,.txt,.pdf" hidden></label>
      <span class="muted small">글 대신 파일만 넣어도 됩니다 · ⌘/Ctrl+Enter 다음</span></div>`}`;
  $("#libWzText").focus();
}
function openWizard(kind) {
  if (st.upMode === "client" && !upClient()) return toast("고객사를 고르거나 새로 만드세요", true);
  const cname = st.clients.find((c) => c.id === upClient())?.name;
  Object.assign(wz, { kind, i: 0, ans: cname ? { name: cname } : {}, files: [], client: upClient(), edit: null, oldMd: "", keep: [] });
  wzRender(); $("#libWiz").showModal();
  $("#libWzText").focus(); // showModal 이 첫 버튼(닫기)으로 옮긴 포커스를 입력 칸으로 되돌린다
}
// 고치기 — 저장된 md 를 읽어 "## 제목" 절을 단계 답으로 되돌린다. 확인 단계에서 시작한다
async function editWizard(r) {
  const d = WIZ[r.kind], md = (r.files || []).find((f) => /\.md$/i.test(f.file));
  const ans = { name: r.name };
  if (md) {
    try {
      const text = await fetch(url(r, md.file)).then((x) => x.text());
      let cur = null;
      for (const line of text.split("\n")) {
        const h = line.match(/^## (.+)$/);
        if (h) { cur = d.steps.find((s) => s.h === h[1].trim())?.key || null; continue; }
        if (cur) ans[cur] = (ans[cur] ? ans[cur] + "\n" : "") + line;
      }
      for (const k of Object.keys(ans)) ans[k] = ans[k].trim();
    } catch { toast("저장된 문서를 읽지 못했습니다 — 빈 칸에서 고칩니다", true); }
  }
  Object.assign(wz, { kind: r.kind, i: d.steps.length, ans, files: [], client: r.client || "", edit: r, oldMd: md?.file || "",
    keep: (r.files || []).filter((f) => f !== md).map((f) => f.original_name || f.file) });
  if ($("#libDialog").open) $("#libDialog").close();
  wzRender(); $("#libWiz").showModal();
}
function wzMove(step) {
  wzSaveText();
  const s = wzDef().steps[wz.i];
  if (step > 0 && s?.need && !wz.ans[s.key]?.trim()) { $("#libWzText").focus(); return toast("이 단계는 꼭 적어야 합니다", true); }
  wz.i = Math.max(0, Math.min(wzDef().steps.length, wz.i + step)); wzRender();
}
async function wzSave() {
  const btn = $("#libWzNext"); btn.disabled = true;
  try {
    const tokens = [await uploadOne(mdFile(wz.ans.name, wzMd()))];
    for (const [j, f] of wz.files.entries()) { btn.textContent = `첨부 올리는 중 ${j + 1}/${wz.files.length}`; tokens.push(await uploadOne(f.file)); }
    if (wz.edit) { // 고치기: 새 md·첨부를 붙이고 옛 md 는 빼서(_history 기록) 바꿔 끼운다
      const r = wz.edit, base = `/api/resources/${r.kind}/${r.id}`;
      await api(`${base}/files`, { method: "POST", body: { tokens, role: "output" } });
      if (wz.oldMd) await api(`${base}/files/${encodeURIComponent(wz.oldMd)}`, { method: "DELETE" });
      if (wz.ans.name.trim() !== r.name) await api(base, { method: "PUT", body: { name: wz.ans.name.trim() } });
    } else await api("/api/resources", { method: "POST", body: { kind: wz.kind, client: wz.client, name: wz.ans.name.trim(), tokens } });
    const label = RES_KINDS[wz.kind];
    wz.kind = ""; $("#libWiz").close(); toast(`"${wz.ans.name.trim()}" ${label}를 저장했습니다`); await load();
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; if (wz.kind) wzRender(); }
}
function bindWizard() {
  $("#libWizGo").addEventListener("click", () => openWizard($("#libUpKind").value));
  $("#libWzPrev").addEventListener("click", () => wzMove(-1));
  $("#libWzSkip").addEventListener("click", () => { $("#libWzText").value = ""; wzMove(1); });
  $("#libWzNext").addEventListener("click", () => (wzLast() ? wzSave() : wzMove(1)));
  // 닫기·Esc — 적은 게 있으면 묻는다
  $("#libWzClose").addEventListener("click", () => { if (wzClose()) $("#libWiz").close(); });
  $("#libWiz").addEventListener("cancel", (e) => { if (wz.kind && !wzClose()) e.preventDefault(); });
  $("#libWzBody").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey) { e.preventDefault(); wzMove(1); }
  });
  $("#libWzBody").addEventListener("click", (e) => {
    const go = e.target.closest("[data-wzgo]"); if (go) { wz.i = Number(go.dataset.wzgo); return wzRender(); }
    const rm = e.target.closest("[data-wzrm]"); if (rm) { wzSaveText(); wz.files.splice(Number(rm.dataset.wzrm), 1); wzRender(); }
  });
  $("#libWzBody").addEventListener("change", (e) => {
    if (e.target.id !== "libWzFiles") return;
    wzSaveText();
    const ok = [...e.target.files].filter((f) => /^image\//.test(f.type) || isDocFile(f.name));
    wz.files.push(...ok.map((file) => ({ file, step: wzDef().steps[wz.i].key })));
    if (ok.length < e.target.files.length) toast("md·txt·pdf·이미지만 첨부합니다", true);
    wzRender();
  });
}
function wzClose() {
  wzSaveText();
  const dirty = Object.values(wz.ans).some((v) => v?.trim()) || wz.files.length;
  if (dirty && !confirm("적은 내용이 저장되지 않습니다. 닫을까요?")) return false;
  wz.kind = ""; return true;
}

// 상세 창의 md·txt 미리보기 — 그린 뒤 파일 내용을 받아 채운다
async function fillDocs(r) {
  for (const el of $("#libDBody").querySelectorAll("[data-doc]")) {
    try { const t = await fetch(url(r, el.dataset.doc)).then((x) => (x.ok ? x.text() : Promise.reject(new Error(x.status)))); el.querySelector("pre").textContent = t || "(빈 문서)"; el.dataset.text = t; }
    catch { el.querySelector("pre").textContent = "읽지 못했습니다"; }
  }
}

// ── 상세 ──
function renderDetail() {
  const r = st.open; if (!r) return;
  $("#libDTitle").textContent = `${KINDS[r.kind]} · ${r.name}`;
  const sh = SHEET[r.kind], srcs = images(r).filter((f) => !sh || f.part !== sh.part || f.source !== "generated"), outs = sheets(r);
  const pick = st.sheetSrc && srcs.some((f) => f.file === st.sheetSrc) ? st.sheetSrc : srcs[0]?.file;
  const busy = st.busy.has(r.id);
  const fileTile = (f, sel) => `<figure class="lib-file ${sel ? "is-on" : ""}" ${sel !== undefined ? `data-src="${esc(f.file)}"` : ""}>
      ${f.kind === "image" ? `<img src="${url(r, f.file)}" alt="" loading="lazy">` : f.kind === "video" ? `<video src="${url(r, f.file)}" controls preload="metadata"></video>` : f.kind === "audio" ? `<audio src="${url(r, f.file)}" controls></audio>`
        : isText(f.file) ? `<div class="lib-doc" data-doc="${esc(f.file)}"><pre>읽는 중…</pre></div>`
        : /\.pdf$/i.test(f.file) ? `<a class="xp-ph lib-doc__pdf" href="${url(r, f.file)}" target="_blank" rel="noopener">PDF 열기 ↗</a>` : `<span class="xp-ph">${esc(f.file)}</span>`}
      <figcaption><span>${esc(f.original_name || f.file)}${f.part === "face" ? " · 얼굴" : ""}</span><span class="lib-file__acts">${isText(f.file) ? `<button type="button" data-editdoc="${esc(f.file)}">고치기</button>` : ""}<a href="${url(r, f.file)}" download>받기</a><button type="button" data-rmfile="${esc(f.file)}">빼기</button></span></figcaption>
      ${f.kind === "image" && st.mode !== "ref" ? `<div class="lib-file__form"><span class="form-seg">${[["single", "단일"], ["sheet", "시트"]].map(([k, l]) => `<button type="button" class="seg__btn ${formOf(f) === k ? "is-on" : ""}" data-form="${esc(f.file)}|${k}">${l}</button>`).join("")}</span>
        ${r.kind === "person" && formOf(f) === "sheet" ? `<button type="button" class="lib-file__crop" data-crop="${esc(f.file)}">얼굴 잘라 저장</button>` : ""}</div>` : ""}</figure>`;
  $("#libDBody").innerHTML = `
    <div class="lib-dlg__cols">
      <div class="lib-dlg__files">
        <h4>올린 파일 <span class="muted">${srcs.length + (r.files || []).filter((f) => f.kind !== "image").length}</span></h4>
        <div class="lib-files ${DOC_KINDS.has(r.kind) ? "lib-files--wide" : ""}">${(r.files || []).filter((f) => !outs.includes(f)).map((f) => fileTile(f, f.kind === "image" && sh ? f.file === pick : undefined)).join("") || `<p class="muted small">파일이 없습니다.</p>`}</div>
        <label class="btn btn--ghost btn--sm lib-addfile">＋ 파일 더하기<input id="libAddFiles" type="file" multiple accept="${DOC_KINDS.has(r.kind) ? "image/*,.md,.txt,.pdf" : "image/*,video/*,audio/*,.md,.txt,.pdf"}" hidden></label>
        ${sh ? `<h4>${sh.label} <span class="muted">${outs.length}</span></h4>
        <div class="lib-files lib-files--wide">${outs.map((f) => fileTile(f)).join("") || `<p class="muted small">아직 만든 시트가 없습니다.</p>`}</div>` : ""}
      </div>
      <div class="lib-dlg__side">
        <label class="field"><span>이름</span><input id="libDName" value="${esc(r.name)}"></label>
        <label class="field"><span>고객사 폴더</span><select id="libDClient"><option value="">일반 (고객사 없음)</option>${st.clients.map((c) => `<option value="${c.id}" ${r.client === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label class="field"><span>태그 (쉼표로)</span><input id="libDTags" value="${esc((r.tags || []).join(", "))}" placeholder="${st.mode === "ref" ? "예: 구도, 색감" : "예: 정수기, 화이트"}"></label>
        ${st.mode === "ref" ? `<div class="lib-tagpick">${REF_TAGS.map((t) => `<button type="button" class="seg__btn ${(r.tags || []).includes(t) ? "is-on" : ""}" data-dtag="${esc(t)}">${esc(t)}</button>`).join("")}</div>
        ${r.attrs?.source ? `<p class="small"><a href="${esc(r.attrs.source)}" target="_blank" rel="noopener">출처 링크 ↗</a></p>` : ""}` : ""}
        ${r.kind === "color" ? `<div class="field"><span>색 <span class="muted small">광고 자동화·소재 만들기가 이 색을 씁니다</span></span><div id="libDColors">${colorEditor(r.colors)}</div></div>` : ""}
        <label class="field"><span>메모</span><textarea id="libDDesc" rows="3">${esc(r.description || "")}</textarea></label>
        <button class="btn btn--sm" id="libDSave" type="button">저장</button>
        ${WIZ[r.kind] ? `<button class="btn btn--ghost btn--sm" id="libDWiz" type="button">질문 단계로 고치기</button>` : ""}
        ${afRefBox(r)}
        ${sh ? `<section class="lib-sheet">
          <h4>${sh.label}로 만들기</h4>
          <p class="muted small">왼쪽에서 고른 사진 한 장을 그대로 두고 여러 각도를 한 장에 모읍니다. 힉스필드 크레딧이 듭니다.</p>
          ${srcs.length ? `<label class="field"><span>모델</span><select id="libSModel">${(st.models || []).map((m) => `<option value="${m.id}" ${m.id === sh.model ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
          <details class="lib-sheet__p"><summary>프롬프트 보기·고치기</summary><textarea id="libSPrompt" rows="6">${esc(st.sheetPrompt?.[r.kind] || sh.prompt)}</textarea></details>
          <button class="btn btn--primary" id="libSGo" type="button" ${busy ? "disabled" : ""}>${busy ? "시트 만드는 중…" : `${sh.label} 만들기`}</button>`
          : `<p class="small">먼저 사진을 올리세요.</p>`}
        </section>` : ""}
      </div>
    </div>`;
  fillDocs(r);
}

// 광고 자동화 참고 자료로 넣기 — 같은 고객사의 자동화마다 켜고 끈다 (af.docs). md·txt 가 있는 고객사 에셋·참고 문서만
function afRefBox(r) {
  if (st.mode !== "res" || !["doc", "asset"].includes(r.kind) || !(r.files || []).some((f) => /\.(md|txt)$/i.test(f.file))) return "";
  const afs = (st.afs || []).filter((a) => (a.client || "") === (r.client || ""));
  return `<section class="lib-afref"><h4>광고 자동화 참고 자료</h4>
    <p class="muted small">켜 두면 그 자동화가 광고를 기획할 때 이 문서 내용을 참고합니다 (카피·소구점 보충).</p>
    ${afs.length ? afs.map((a) => `<label class="check"><input type="checkbox" data-afref="${a.id}" ${(a.docs || []).includes(r.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("")
      : `<p class="small">${r.client ? "이 고객사의" : "일반(고객사 없음)"} 광고 자동화가 없습니다 — <a href="#auto">광고 자동화</a>에서 먼저 만드세요.</p>`}</section>`;
}

async function openDetail(kind, id) {
  st.open = st.list.find((r) => r.kind === kind && r.id === id); st.sheetSrc = "";
  if (!st.open) return;
  if (!st.models) st.models = await api("/api/hf/image-models").catch(() => []);
  st.afs = await api("/api/autoflows").catch(() => []);
  renderDetail();
  if (!$("#libDialog").open) $("#libDialog").showModal();
}

async function makeSheet() {
  const r = st.open, sh = SHEET[r.kind];
  const src = $("#libDBody .lib-file.is-on")?.dataset.src || images(r)[0]?.file;
  if (!src) return toast("사진을 고르세요", true);
  const prompt = $("#libSPrompt").value.trim() || sh.prompt, model = $("#libSModel").value;
  if (!confirm(`${r.name} — ${sh.label}를 만들까요?\n힉스필드 크레딧이 듭니다. (모델: ${$("#libSModel").selectedOptions[0]?.textContent || model})`)) return;
  try {
    await api("/api/hf/generate", { method: "POST", body: { target: { type: "resource", kind: r.kind, id: r.id, part: sh.part }, kind: "image", purpose: "sheet", prompt, refs: [src], imageModel: model, aspect: sh.aspect } });
    st.busy.add(r.id); renderAll(); toast(`${sh.label}를 만드는 중입니다 — 끝나면 여기에 붙습니다`);
  } catch (e) { toast(e.message, true); }
}

function bind() {
  $("#libUpBtn").addEventListener("click", () => ($("#libUp").hidden ? openUpload() : ($("#libUp").hidden = true)));
  $("#libUpClose").addEventListener("click", () => ($("#libUp").hidden = true));
  $("#libUpClose0").addEventListener("click", () => ($("#libUp").hidden = true));
  $("#libUpChoose").addEventListener("click", (e) => { const b = e.target.closest("[data-upmode]"); if (b) setUpMode(b.dataset.upmode); });
  $("#libUpBack").addEventListener("click", () => setUpMode(null));
  $("#libUpClient").addEventListener("change", whereText);
  $("#libUpKind").addEventListener("change", kindChanged);
  $("#libWGo").addEventListener("click", writeDoc);
  bindColorEditor($("#libColorNew")); bindColorEditor($("#libDBody"));
  $("#libCGo").addEventListener("click", saveColorNew);
  bindWizard();
  const makeClient = async () => {
    const name = $("#libUpNewClient").value.trim(); if (!name) return $("#libUpNewClient").focus();
    try {
      const c = await api("/api/clients", { method: "POST", body: { name } });
      $("#libUpNewClient").value = ""; st.folder = c.id; await load();
      $("#libUpClient").value = c.id; whereText(); toast(`"${c.name}" 폴더를 만들었습니다 — 이제 파일을 올리세요`);
    } catch (e) { toast(e.message, true); }
  };
  $("#libUpMakeClient").addEventListener("click", makeClient);
  $("#libUpNewClient").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); makeClient(); } });
  $("#libUpOne").addEventListener("change", (e) => { $("#libUpNameF").hidden = !e.target.checked; if (e.target.checked) $("#libUpName").focus(); });
  $("#libFiles").addEventListener("change", (e) => upload(e.target.files));
  $("#libDir").addEventListener("change", (e) => upload(e.target.files));
  const drop = $("#libDrop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); upload(e.dataTransfer.files); });

  $("#libFolders").addEventListener("click", async (e) => {
    const more = e.target.closest("[data-fmore]");
    if (more) { st.fmenu = st.fmenu === more.dataset.fmore ? null : more.dataset.fmore; return renderFolders(); }
    const act = e.target.closest("[data-fact]");
    if (act) {
      const [what, id] = act.dataset.fact.split("|"), c = st.clients.find((x) => x.id === id);
      st.fmenu = null; renderFolders();
      if (!c) return;
      const inside = st.list.filter((r) => r.client === id);
      try {
        if (what === "rename") {
          const name = prompt("새 폴더 이름", c.name);
          if (!name?.trim() || name.trim() === c.name) return;
          await api(`/api/clients/${id}`, { method: "PUT", body: { name } }); toast("폴더 이름을 바꿨습니다");
        } else if (what === "move") {
          if (!confirm(`"${c.name}" 폴더를 지울까요?\n안의 리소스 ${inside.length}개는 지우지 않고 "일반 (고객사 없음)"으로 옮깁니다.`)) return;
          await api(`/api/clients/${id}`, { method: "DELETE" }); toast(`"${c.name}" 폴더를 지웠습니다 — 리소스 ${inside.length}개는 일반으로 옮겼습니다`);
        } else if (what === "purge") {
          if (!confirm(`"${c.name}" 폴더와 안의 리소스 ${inside.length}개를 모두 지울까요?\n파일도 함께 지워지고 되돌릴 수 없습니다.`)) return;
          let fail = 0;
          for (const r of inside) { try { await api(`/api/resources/${r.kind}/${r.id}`, { method: "DELETE" }); } catch { fail++; } }
          if (fail) { toast(`리소스 ${fail}개를 지우지 못해 폴더는 남겨 뒀습니다`, true); return load(); }
          await api(`/api/clients/${id}`, { method: "DELETE" }); toast(`"${c.name}" 폴더와 리소스 ${inside.length}개를 지웠습니다`);
        }
        if (what !== "rename" && st.folder === id) st.folder = "all";
        await load();
      } catch (e2) { toast(e2.message, true); }
      return;
    }
    const b = e.target.closest("[data-folder]"); if (!b) return;
    st.folder = b.dataset.folder; renderAll();
  });
  document.addEventListener("click", (e) => { if (st.fmenu && !e.target.closest(".lib-fmenu, [data-fmore]")) { st.fmenu = null; renderFolders(); } });
  $("#libNewClient").addEventListener("click", async () => {
    const name = prompt("새 고객사 폴더 이름"); if (!name?.trim()) return;
    try { const c = await api("/api/clients", { method: "POST", body: { name } }); st.folder = c.id; await load(); toast(`"${c.name}" 폴더를 만들었습니다`); }
    catch (e) { toast(e.message, true); }
  });
  $("#libKinds").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tag]"); if (t) { st.tag = t.dataset.tag; renderKinds(); renderGrid(); return; }
    const b = e.target.closest("[data-kind]"); if (!b) return; st.kind = b.dataset.kind; renderKinds(); renderGrid();
  });
  $("#libUrlGo").addEventListener("click", uploadUrl);
  $("#libUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); uploadUrl(); } });
  $("#libUpTags").addEventListener("click", (e) => {
    const b = e.target.closest("[data-uptag]"); if (!b) return;
    const t = b.dataset.uptag; st.upTags.has(t) ? st.upTags.delete(t) : st.upTags.add(t); b.classList.toggle("is-on", st.upTags.has(t));
  });
  $("#libQ").addEventListener("input", renderGrid);
  $("#libGrid").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { const r = byKey(del.dataset.del); if (r) await removeMany([r]); return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) { const r = byKey(ed.dataset.edit); if (r) WIZ[r.kind] ? editWizard(r) : openDetail(r.kind, r.id); return; }
    const c = e.target.closest("[data-open]"); if (!c) return;
    if (st.sel) { st.sel.has(c.dataset.open) ? st.sel.delete(c.dataset.open) : st.sel.add(c.dataset.open); renderGrid(); return selText(); }
    openDetail(...c.dataset.open.split("/"));
  });
  // 여러 개 고르기
  $("#libSelBtn").addEventListener("click", () => setSel(!st.sel));
  $("#libSelX").addEventListener("click", () => setSel(false));
  $("#libSelAll").addEventListener("click", () => { $("#libGrid").querySelectorAll("[data-open]").forEach((b) => st.sel.add(b.dataset.open)); renderGrid(); selText(); });
  $("#libSelDel").addEventListener("click", async () => {
    const list = [...st.sel].map(byKey).filter(Boolean); if (!list.length) return toast("고른 것이 없습니다", true);
    if (await removeMany(list)) setSel(false);
  });
  $("#libSelMoveGo").addEventListener("click", async () => {
    const list = [...st.sel].map(byKey).filter(Boolean); if (!list.length) return toast("고른 것이 없습니다", true);
    const to = $("#libSelMove").value;
    try { for (const r of list) await api(`/api/resources/${r.kind}/${r.id}`, { method: "PUT", body: { client: to } }); }
    catch (e2) { toast(e2.message, true); }
    toast(`${list.length}개를 "${to ? clientName(to) : "일반"}"(으)로 옮겼습니다`); setSel(false); await load();
  });

  // 상세 창
  $("#libDClose").addEventListener("click", () => $("#libDialog").close());
  $("#libDialog").addEventListener("close", () => { st.open = null; });
  $("#libDialog").addEventListener("click", (e) => { if (e.target === $("#libDialog")) $("#libDialog").close(); });
  $("#libDDel").addEventListener("click", async () => {
    const r = st.open; if (!r || !confirm(`"${r.name}" 리소스를 지울까요? 파일도 함께 지워집니다.`)) return;
    try { await api(`/api/resources/${r.kind}/${r.id}`, { method: "DELETE" }); $("#libDialog").close(); await load(); toast("지웠습니다"); }
    catch (e) { toast(e.message, true); }
  });
  $("#libDBody").addEventListener("click", async (e) => {
    const r = st.open;
    const ed = e.target.closest("[data-editdoc]");
    if (ed) { // md·txt 고치기 — 미리보기 자리를 입력 칸으로 바꾼다
      const box = $("#libDBody").querySelector(`[data-doc="${CSS.escape(ed.dataset.editdoc)}"]`);
      if (!box || box.querySelector("textarea")) return;
      box.innerHTML = `<textarea rows="14">${esc(box.dataset.text || "")}</textarea><div class="lib-doc__acts"><button type="button" class="btn btn--sm btn--primary" data-savedoc="${esc(ed.dataset.editdoc)}">저장</button><button type="button" class="btn btn--sm btn--ghost" data-canceldoc>취소</button></div>`;
      box.querySelector("textarea").focus();
      return;
    }
    if (e.target.closest("[data-canceldoc]")) return renderDetail();
    const sv = e.target.closest("[data-savedoc]");
    if (sv) { // 새 판을 올리고 옛 판은 빼서 기록(_history)에 남긴다
      const old = r.files.find((f) => f.file === sv.dataset.savedoc);
      const text = sv.closest("[data-doc]").querySelector("textarea").value;
      sv.disabled = true;
      try {
        const token = await uploadOne(new File([text], old?.original_name || sv.dataset.savedoc, { type: "text/plain" }));
        await api(`/api/resources/${r.kind}/${r.id}/files`, { method: "POST", body: { tokens: [token], role: "output" } });
        await api(`/api/resources/${r.kind}/${r.id}/files/${encodeURIComponent(sv.dataset.savedoc)}`, { method: "DELETE" });
        await load(); toast("문서를 저장했습니다");
      } catch (e2) { sv.disabled = false; toast(e2.message, true); }
      return;
    }
    const rm = e.target.closest("[data-rmfile]");
    if (rm) {
      if (!confirm("이 파일을 뺄까요? (기록에는 남습니다)")) return;
      try { await api(`/api/resources/${r.kind}/${r.id}/files/${encodeURIComponent(rm.dataset.rmfile)}`, { method: "DELETE" }); await load(); }
      catch (e2) { toast(e2.message, true); }
      return;
    }
    const fm = e.target.closest("[data-form]");
    if (fm) { // 이미지 형태 — 단일 / 시트 (영상 복제·이미지 변형이 프롬프트에 그대로 넘긴다)
      const [file, form] = fm.dataset.form.split("|");
      try { await api(`/api/resources/${r.kind}/${r.id}/form/${encodeURIComponent(file)}`, { method: "PUT", body: { form } }); await load(); } catch (e2) { toast(e2.message, true); }
      return;
    }
    const cr = e.target.closest("[data-crop]");
    if (cr) { // 시트에서 얼굴만 잘라 이 인물의 "얼굴" 결과로 저장 — 영상 복제에서 이 인물을 고르면 얼굴 칸이 자동으로 채워진다
      const box = await window.pickCrop?.(url(r, cr.dataset.crop), { title: "얼굴 부분을 네모로 고르세요 — 정면 얼굴을 이마부터 턱까지" });
      if (!box) return;
      try { await api(`/api/resources/${r.kind}/${r.id}/crop`, { method: "POST", body: { file: cr.dataset.crop, box, part: "face" } }); await load(); toast("얼굴을 잘라 저장했습니다"); } catch (e2) { toast(e2.message, true); }
      return;
    }
    const dt = e.target.closest("[data-dtag]");
    if (dt) { // 레퍼런스 태그 빠른 고르기 — 태그 칸에 넣고 빼기
      const cur = $("#libDTags").value.split(",").map((x) => x.trim()).filter(Boolean), t = dt.dataset.dtag;
      $("#libDTags").value = (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]).join(", "); dt.classList.toggle("is-on"); return;
    }
    const tile = e.target.closest("[data-src]");
    if (tile && !e.target.closest("a, button, video, audio")) { st.sheetSrc = tile.dataset.src; $("#libDBody").querySelectorAll("[data-src]").forEach((x) => x.classList.toggle("is-on", x === tile)); return; }
    if (e.target.id === "libSGo") return makeSheet();
    if (e.target.id === "libDWiz") return editWizard(r);
    if (e.target.id === "libDSave") {
      try {
        await api(`/api/resources/${r.kind}/${r.id}`, { method: "PUT", body: { name: $("#libDName").value, client: $("#libDClient").value, tags: $("#libDTags").value, description: $("#libDDesc").value, ...(r.kind === "color" ? { colors: readColors($("#libDColors")) } : {}) } });
        await load(); toast("저장했습니다");
      } catch (e2) { toast(e2.message, true); }
    }
  });
  $("#libDBody").addEventListener("input", (e) => { if (e.target.id === "libSPrompt") (st.sheetPrompt ||= {})[st.open.kind] = e.target.value; });
  $("#libDBody").addEventListener("change", async (e) => {
    const ar = e.target.closest("[data-afref]");
    if (ar) {
      const a = st.afs.find((x) => x.id === ar.dataset.afref), id = st.open.id;
      const docs = ar.checked ? [...new Set([...(a.docs || []), id])] : (a.docs || []).filter((x) => x !== id);
      try { Object.assign(a, await api(`/api/autoflows/${a.id}`, { method: "PUT", body: { docs } })); toast(ar.checked ? `"${a.name}" 참고 자료에 넣었습니다` : `"${a.name}" 참고 자료에서 뺐습니다`); }
      catch (e2) { ar.checked = !ar.checked; toast(e2.message, true); }
      return;
    }
    if (e.target.id !== "libAddFiles") return;
    const r = st.open;
    try {
      const tokens = []; for (const f of e.target.files) tokens.push(await uploadOne(f));
      await api(`/api/resources/${r.kind}/${r.id}/files`, { method: "POST", body: { tokens, role: "output" } });
      await load(); toast(`파일 ${tokens.length}개를 더했습니다`);
    } catch (e2) { toast(e2.message, true); }
  });
  // 시트 생성이 끝나면 (서버 이벤트) 목록을 새로 읽는다
  window.addEventListener("srv-event", ({ detail: ev }) => {
    if (ev.type !== "job" || ev.kind !== "hf" || ev.state === "start") return;
    const id = ev.result?.type === "resource" ? ev.result.id : null;
    if (id) st.busy.delete(id); else if (ev.state === "error") st.busy.clear();
    if (ev.state === "error") toast(ev.message, true); else if (id) toast("시트를 만들었습니다");
    if (!$("#libView").hidden) load();
  });
}

function setMode(mode) {
  if (st.mode !== mode) { st.mode = mode; st.kind = ""; st.tag = ""; st.folder = "all"; $("#libUp").hidden = true; st.sel = null; $("#libSelBar").hidden = true; $("#libSelBtn").hidden = false; }
  KINDS = MODE[mode].kinds;
  const head = document.querySelector("#libView .page__head");
  head.querySelector("h2").textContent = MODE[mode].title;
  head.querySelector("p").innerHTML = MODE[mode].desc;
  // 레퍼런스: 종류 칸·묶기 대신 태그 고르기 · 링크로 넣기
  $("#libUpKindF").hidden = $("#libUpOneF").hidden = mode === "ref";
  $("#libUpRef").hidden = mode !== "ref";
  $("#libUpTags").innerHTML = REF_TAGS.map((t) => `<button type="button" class="seg__btn ${st.upTags.has(t) ? "is-on" : ""}" data-uptag="${esc(t)}">${esc(t)}</button>`).join("");
  $("#libFiles").accept = mode === "ref" ? "image/*" : "image/*,video/*,audio/*";
}
const page = (mode) => ({
  async open() { if (!st.bound) { bind(); st.bound = true; } setMode(mode); await load().catch((e) => toast(e.message, true)); },
  close() { if ($("#libDialog").open) $("#libDialog").close(); },
});
window.libPage = page("res");
window.refPage = page("ref");
