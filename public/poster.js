// 포스터 이미지 만들기 — 캔버스 한 장 위에 배경 + 어둡게 깔기 + 글자 층(제목·서브·본문·정보·행동 유도)을 그린다.
// 글자는 캔버스에서 끌어 옮기고, 오른쪽 칸에서 글·크기·색·굵기·정렬을 고친다. PNG 는 이 캔버스를 그대로 저장한다.
// 참고·배경 이미지는 공용 광고 수집(광고 · 링크/업로드)에서 불러오거나 내 PC 에서 올린다.
// 서버: lib/poster.js · 주소: #poster(만들기) · #poster/list(만든 포스터) · #poster/po_…(그 포스터 열기)
import { esc } from "./fields.js";

const $ = (s) => document.querySelector(s);
const FONT = "'Pretendard Variable', Pretendard, -apple-system, sans-serif";
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
const status = (m) => ($("#poStatus").textContent = m || "");
const url = (p, f) => `/data/_posters/${p.id}/${f}`;

const st = { meta: null, list: [], p: null, bgImg: null, sel: "headline", boxes: {}, bound: false, waiting: false, pick: "ref", images: null };
const LAYERS = [["headline", "제목"], ["sub", "서브"], ["body", "본문"], ["info", "정보"], ["cta", "행동 유도"]];
const NAME = Object.fromEntries(LAYERS);
const keys = () => Object.keys(st.p?.layers || {}); // 그리는 순서 = 층 순서 (사진 칸이 앞이면 맨 아래)
const labelOf = (k) => st.p?.layers?.[k]?.label || NAME[k] || k;
const KIND_ICON = { text: "Aa", button: "▭", image: "🖼", logo: "◎" };
const imgCache = {};
function layerImg(src) {
  if (!src) return null;
  const u = url(st.p, src);
  if (!imgCache[u]) { const im = new Image(); im.onload = () => draw(); im.src = u; imgCache[u] = im; }
  return imgCache[u];
}

// ── 글자 층 기본 배치 (카피의 text_area · palette 로) ──
function defaultLayers(copy, tpl = st.p?.template) {
  // 포스터 템플릿이면 그 배치·색에 새 글만 넣는다
  if (tpl?.kind === "poster" && tpl.layers) return Object.fromEntries(Object.entries(tpl.layers).map(([k, L]) => [k, { ...L, text: copy[k] || "", show: L.show && !!copy[k] }]));
  const pal = copy.palette || [], area = copy.text_area || "top";
  const y0 = area === "bottom" ? 0.56 : area === "center" ? 0.34 : 0.08;
  const ink = pal[0] || "#ffffff", accent = pal[1] || "#ff5a36", soft = pal[2] || ink;
  // 제목 줄 수만큼 아래 층을 내린다 (제목 112px · 줄 간격 1.22)
  const [, H] = size(), hl = String(copy.headline || "").split("\n").length, subY = y0 + (hl * 112 * 1.22 + 28) / H, bodyY = subY + (44 * 1.3 + 20) / H;
  const out = {
    headline: { text: copy.headline || "", x: 0.5, y: y0, size: 112, color: ink, weight: 800, align: "center", show: true },
    sub: { text: copy.sub || "", x: 0.5, y: subY, size: 44, color: soft, weight: 500, align: "center", show: !!copy.sub },
    body: { text: copy.body || "", x: 0.5, y: bodyY, size: 34, color: soft, weight: 400, align: "center", show: !!copy.body },
    info: { text: copy.info || "", x: 0.5, y: area === "bottom" ? 0.05 : 0.8, size: 32, color: ink, weight: 600, align: "center", show: !!copy.info },
    cta: { text: copy.cta || "", x: 0.5, y: area === "bottom" ? 0.9 : 0.91, size: 38, color: "#ffffff", bg: accent, weight: 700, align: "center", show: !!copy.cta },
  };
  if (tpl?.kind === "cardnews") for (const [k, L] of Object.entries(out)) { // 카드뉴스 표지의 정렬·강조색
    L.align = tpl.align; L.x = L.align === "left" ? 0.07 : L.align === "right" ? 0.93 : 0.5;
    if (k === "cta") L.color = tpl.accent_text || "#111111";
  }
  return out;
}

// ── 그리기 ──
function size() { const s = st.meta?.sizes?.[st.p?.size] || { w: 1080, h: 1350 }; return [s.w, s.h]; }
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of para) { if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; }
    out.push(line);
  }
  return out;
}
function draw() {
  const c = $("#poCanvas"), p = st.p; if (!p) return;
  const [W, H] = size();
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext("2d"), pal = p.copy?.palette || [];
  ctx.fillStyle = p.bg_color || pal[3] || "#1b1c1f"; ctx.fillRect(0, 0, W, H);
  const im = st.bgImg;
  if (im?.naturalWidth) { // 배경은 꽉 채우기
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }
  const ov = Number(p.overlay ?? 0.35), area = p.copy?.text_area || "top";
  if (ov > 0) { // 글자가 놓이는 쪽을 어둡게 — 읽히게
    const g = area === "center" ? ctx.createLinearGradient(0, 0, 0, H) : area === "bottom" ? ctx.createLinearGradient(0, H, 0, 0) : ctx.createLinearGradient(0, 0, 0, H);
    if (area === "center") { g.addColorStop(0, `rgba(0,0,0,${ov * 0.4})`); g.addColorStop(0.5, `rgba(0,0,0,${ov})`); g.addColorStop(1, `rgba(0,0,0,${ov * 0.4})`); }
    else { g.addColorStop(0, `rgba(0,0,0,${ov})`); g.addColorStop(0.55, "rgba(0,0,0,0)"); g.addColorStop(0.85, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${ov * 0.8})`); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  st.boxes = {};
  for (const k of keys()) {
    const L = p.layers[k]; if (!L?.show) continue;
    if (L.kind === "image") { // 사진 칸: 내 사진을 꽉 채워 넣고, 없으면 편집 화면에서만 자리 표시
      const x = L.x * W, y = L.y * H, w = L.w * W, h = L.h * H, im = layerImg(L.src);
      if (im?.naturalWidth) {
        const s2 = Math.max(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * s2, ih = im.naturalHeight * s2;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore();
      } else if (!st.exporting) {
        ctx.save(); ctx.fillStyle = "rgba(65,84,255,.08)"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "rgba(65,84,255,.5)"; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(65,84,255,.8)"; ctx.font = `600 ${Math.max(22, Math.min(40, w / 12))}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(`🖼 ${L.label || k} — 사진 넣기`, x + w / 2, y + h / 2); ctx.restore();
      }
      st.boxes[k] = { x, y, w, h };
      continue;
    }
    if (!String(L.text || "").trim()) continue;
    ctx.font = `${L.weight} ${L.size}px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = L.align;
    const lines = wrap(ctx, L.text, W * 0.86), lh = L.size * 1.22;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)), th = lines.length * lh;
    const ax = L.x * W, top = L.y * H;
    const left = L.align === "center" ? ax - tw / 2 : L.align === "right" ? ax - tw : ax;
    if (L.bg && (L.kind === "button" || !L.kind)) { // 버튼은 알약 모양
      const px = L.size * 0.9, py = L.size * 0.45;
      ctx.fillStyle = L.bg; ctx.beginPath(); ctx.roundRect(left - px, top - py, tw + px * 2, th + py * 2 - (lh - L.size), (th + py * 2) / 2); ctx.fill();
    }
    ctx.fillStyle = L.color;
    if (!L.bg && (p.bg || ov > 0.2)) { ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = L.size * 0.15; } // 사진 위에서만 그림자
    lines.forEach((l, i) => ctx.fillText(l, ax, top + i * lh));
    ctx.shadowBlur = 0;
    st.boxes[k] = { x: left - 12, y: top - 12, w: tw + 24, h: th + 24 };
  }
  // 고른 층 테두리 (PNG 를 만들 때는 그리지 않는다)
  const b = st.boxes[st.sel];
  if (b && !st.exporting) { ctx.strokeStyle = "rgba(65,84,255,.9)"; ctx.lineWidth = 4; ctx.setLineDash([14, 10]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]); }
}

// ── 화면 칸 ──
function render() {
  const p = st.p;
  $("#poPick").innerHTML = st.list.map((x) => `<option value="${x.id}" ${x.id === p?.id ? "selected" : ""}>${esc(x.name || x.id)}</option>`).join("") || `<option value="">포스터 없음</option>`;
  $("#poSize").innerHTML = Object.entries(st.meta.sizes).map(([k, v]) => `<option value="${k}" ${k === p?.size ? "selected" : ""}>${esc(v.label)}</option>`).join("");
  $("#poStyle").innerHTML = st.meta.styles.map((v) => `<option ${v === p?.style ? "selected" : ""}>${esc(v)}</option>`).join("");
  $("#poKit").innerHTML = `<option value="">없음</option>` + (st.meta.kits || []).map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("");
  document.querySelectorAll("[data-pi]").forEach((i) => (i.value = p?.inputs?.[i.dataset.pi] || ""));
  if (!p) return;
  const T = p.template;
  $("#poTplNow").innerHTML = T ? `지금 템플릿: <b>${esc(T.name)}</b> (${T.kind === "cardnews" ? "카드뉴스 표지" : "포스터 템플릿"}) <button type="button" class="btn btn--ghost btn--sm" data-potplx>빼기</button>` : "템플릿 없음 — 스타일만으로 만듭니다.";
  // 왼쪽: 템플릿 원본 ↔ 내 포스터
  $("#poCompare").hidden = !T?.image;
  if (T?.image) $("#poTplImg").src = url(p, T.image);
  $("#poStage").classList.toggle("has-tpl", !!T?.image);
  // 바꿀 수 있는 소재 + 자연어로 고치기
  $("#poEditBox").hidden = false; // 템플릿·글자 층이 없어도 내 이미지 → 최종 프롬프트 → 힉스필드 생성은 할 수 있다
  $("#poNlGo").disabled = !p.layers;
  const els = Object.entries(p.layers || {}).map(([k, L]) => ({ key: k, kind: L.kind || (L.bg ? "button" : "text"), name: L.label || NAME[k] || k, text: L.kind === "image" ? (L.src ? "내 사진 들어감" : L.desc || "사진 비어 있음") : L.text }));
  $("#poEls").innerHTML = T?.needs_layout ? `<p class="muted small" style="margin:0">⏳ Claude 가 템플릿에서 바꿀 소재를 뽑는 중… (1분 안팎)</p>`
    : els.map((e) => `<button type="button" class="po__el ${st.sel === e.key ? "is-on" : ""}" data-poel="${esc(e.key)}"><b>${KIND_ICON[e.kind] || "Aa"}</b><span>${esc(e.name)}</span><small>${esc(String(e.text || "").replace(/\n/g, " / ").slice(0, 40))}</small></button>`).join("")
    || `<p class="muted small" style="margin:0">템플릿 없음 — 아래 내 이미지와 요청만으로 "최종 이미지 프롬프트 만들기"를 누르면 됩니다. (캔버스 배치는 템플릿·카피가 있을 때만)</p>`;
  const le = p.last_edit;
  $("#poNlNote").innerHTML = le ? `<p class="note small" style="margin:0">✍ 마지막 수정: "${esc(le.instruction.slice(0, 60))}"${le.notes ? ` — ${esc(le.notes)}` : ""}${le.needs_image?.length ? `<br>📷 필요한 사진: ${le.needs_image.map(esc).join(", ")}` : ""}</p>` : "";
  $("#poUndo").disabled = !p.history?.length;
  renderAssets();
  renderFinal();
  $("#poBgColor").value = /^#[0-9a-f]{6}$/i.test(p.bg_color || "") ? p.bg_color : (p.copy?.palette?.[3] || "#1b1c1f");
  $("#poRefs").innerHTML = (p.refs || []).map((r) => `<figure><img src="${url(p, r.file)}" alt="" loading="lazy"><figcaption>${esc(r.from || "")}</figcaption><button type="button" class="po__x" data-porefdel="${r.file}" aria-label="빼기">×</button></figure>`).join("") || `<p class="muted small" style="margin:0">없음 — 수집한 광고·링크 이미지를 불러오면 Claude 가 분위기를 참고하고, 힉스필드에도 참고로 넣습니다.</p>`;
  const c = p.copy;
  $("#poCopyOut").innerHTML = c ? `<div class="po__copy">
      <label class="field"><span>배경 프롬프트 (글자 없는 배경 · 힉스필드용)</span><textarea id="poBgPrompt" rows="4">${esc(c.bg_prompt_en || "")}</textarea></label>
      <div class="ex__row"><button class="btn btn--sm" type="button" data-copy="${esc(c.bg_prompt_en || "")}">프롬프트 복사</button>
        <span class="po__pal">${(c.palette || []).map((x) => `<i style="background:${esc(x)}" title="${esc(x)}"></i>`).join("")}</span></div>
      ${c.notes ? `<p class="note small" style="margin:0">✍ ${esc(c.notes)}</p>` : ""}</div>` : `<p class="muted small" style="margin:0">아직 카피가 없습니다.</p>`;
  $("#poHf").innerHTML = c?.bg_prompt_en ? `<button class="btn btn--sm btn--primary hf-btn" type="button" data-hf="${esc(JSON.stringify({ target: { type: "poster", id: p.id }, kind: "image", purpose: "scene", prompt: c.bg_prompt_en, refs: (p.refs || []).map((r) => r.file), aspect: st.meta.sizes[p.size].aspect }))}">✦ 힉스필드로 배경 만들기</button>` : "";
  $("#poBgs").innerHTML = (p.bgs || []).map((f) => `<figure class="${f === p.bg ? "is-on" : ""}"><button type="button" data-pobg="${f}"><img src="${url(p, f)}" alt="" loading="lazy"></button></figure>`).join("") || `<p class="muted small" style="margin:0">아직 배경이 없습니다 — 색만 깔린 상태로 그립니다.</p>`;
  $("#poOverlay").value = p.overlay ?? 0.35;
  $("#poLayers").innerHTML = keys().map((k) => `<button type="button" class="chip ${st.sel === k ? "is-on" : ""}" data-polayer="${k}">${esc(labelOf(k))}${p.layers[k].show ? "" : " (숨김)"}</button>`).join("");
  if (p.layers && !p.layers[st.sel]) st.sel = keys()[0];
  const L = p.layers?.[st.sel];
  $("#poLayerEdit").innerHTML = L?.kind === "image" ? `<div class="po__grid">
      <p class="small po__wide" style="margin:0">🖼 <b>${esc(L.label || st.sel)}</b>${L.desc ? ` — 템플릿: ${esc(L.desc)}` : ""}</p>
      <div class="ex__row po__wide"><label class="btn btn--sm btn--primary">사진 올리기<input type="file" data-poimgup="${esc(st.sel)}" accept="image/*" hidden></label><button class="btn btn--sm" type="button" data-popick="layer:${esc(st.sel)}">📥 수집한 이미지에서</button></div>
      <label class="ex-field ex-field--range"><span>가로 크기</span><input type="range" data-pl="w" min="0.05" max="1" step="0.01" value="${L.w}"><output>${Math.round(L.w * 100)}%</output></label>
      <label class="ex-field ex-field--range"><span>세로 크기</span><input type="range" data-pl="h" min="0.05" max="1" step="0.01" value="${L.h}"><output>${Math.round(L.h * 100)}%</output></label>
      <label class="ex-field"><span>보이기</span><input type="checkbox" data-pl="show" ${L.show ? "checked" : ""}></label>
    </div>` : L ? `<div class="po__grid">
      <label class="field po__wide"><span>글 (줄바꿈 그대로)</span><textarea data-pl="text" rows="2">${esc(L.text)}</textarea></label>
      <label class="ex-field ex-field--range"><span>크기</span><input type="range" data-pl="size" min="16" max="220" value="${L.size}"><output>${L.size}</output></label>
      <label class="ex-field"><span>글자색</span><input type="color" data-pl="color" value="${esc(L.color)}"></label>
      ${"bg" in L ? `<label class="ex-field"><span>버튼색</span><input type="color" data-pl="bg" value="${esc(L.bg)}"></label>` : ""}
      <label class="ex-field"><span>굵기</span><select data-pl="weight">${[300, 400, 500, 600, 700, 800, 900].map((w) => `<option ${w === +L.weight ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      <label class="ex-field"><span>정렬</span><select data-pl="align">${[["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]].map(([v, n]) => `<option value="${v}" ${v === L.align ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="ex-field"><span>보이기</span><input type="checkbox" data-pl="show" ${L.show ? "checked" : ""}></label>
    </div>` : `<p class="muted small" style="margin:0">카피를 쓰면 글자 층이 생깁니다.</p>`;
  $("#poOuts").innerHTML = (p.outputs || []).slice(0, 6).map((f) => `<a href="${url(p, f)}" download="${esc(p.name || p.id)}.png" title="받기"><img src="${url(p, f)}" alt="" loading="lazy"></a>`).join("");
  loadBg(); draw();
}
function loadBg() {
  const p = st.p, src = p?.bg ? url(p, p.bg) : "";
  if ((st.bgImg?.dataset?.src || "") === src) return;
  if (!src) { st.bgImg = null; return; }
  const im = new Image(); im.dataset.src = src; im.onload = () => draw(); im.src = src; st.bgImg = im;
}

// ── 저장 (고칠 때마다 잠깐 뒤에) ──
let saveT = 0;
// 저장 상태 표시: 고치면 "저장 중…" → 0.5초 뒤 자동 저장 → "자동 저장됨 HH:MM"
function savedMark(msg, err = false) {
  const el = $("#poSaved"); if (!el) return;
  el.textContent = msg ? `${msg} ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "";
  el.classList.toggle("vm-over", err);
}
function save(patch) {
  if (st.viewing) return; // 기록 보기 중엔 저장하지 않는다
  Object.assign(st.p, patch);
  $("#poSaved").textContent = "저장 중…";
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const p = st.p;
    try { await api(`/api/posters/${p.id}`, { method: "PUT", body: { name: p.name, inputs: p.inputs, size: p.size, style: p.style, layers: p.layers, overlay: p.overlay, copy: p.copy, bg_color: p.bg_color } }); savedMark("자동 저장됨"); }
    catch (e) { toast(e.message, true); savedMark("저장 실패", true); }
  }, 500);
}
// 기록 보기: 그 시점 상태를 만들기 화면에 그대로 띄운다 (읽기 전용 — 저장되지 않는다)
async function openVersion(pid, vid) {
  await loadList(pid);
  const v = await api(`/api/posters/${pid}/versions/${vid}`);
  st.viewing = { pid, vid, at: v.at, type: v.type };
  st.p = { ...st.p, ...structuredClone(v.state) };
  st.finIdx = 0; st.finTab = "with_text_en";
  $("#poNl").value = v.state.nl || "";
  $("#poMakeView").classList.add("is-viewing");
  $("#poViewBar").hidden = false;
  $("#poViewBar").innerHTML = `<span>🕘 <b>기록 보기</b> — ${new Date(v.at).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} ${v.type === "save" ? `💾 ${esc(v.memo || "저장")}` : "✦ 최종 이미지 프롬프트"} · 읽기 전용 (보기만 하고 바뀌지 않습니다)</span>
    <button class="btn btn--sm btn--primary" type="button" data-porestore="${pid}|${vid}">이 버전으로 되돌리기</button><a class="btn btn--sm" href="#poster/${pid}">지금 포스터로</a><a class="btn btn--sm btn--ghost" href="#poster/log">← 기록</a>`;
  document.querySelectorAll(".po__fold").forEach((d) => (d.open = true)); // 값이 다 보이게 펼친다
  render();
}
function leaveVersion() { st.viewing = null; $("#poMakeView").classList.remove("is-viewing"); $("#poViewBar").hidden = true; }
async function loadList(open) {
  st.list = await api("/api/posters");
  $("#poCount").textContent = st.list.length ? `${st.list.length}개` : "";
  const id = open || st.p?.id || st.list[0]?.id;
  st.p = id ? await api(`/api/posters/${id}`).catch(() => null) : null;
  if (!st.p) { st.p = await api("/api/posters", { method: "POST", body: {} }); st.list = await api("/api/posters"); } // 처음이면 빈 포스터 하나
  if (st.p.copy && !st.p.layers) save({ layers: defaultLayers(st.p.copy) }); // 화면을 닫은 사이에 카피가 끝났으면 여기서 배치
  $("#poNl").value = st.p.nl || "";
  $("#poSaved").textContent = st.p.saved_at ? `💾 마지막 저장 ${new Date(st.p.saved_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 고치면 자동 저장` : "고치면 자동 저장됩니다";
  render(); renderList();
}
function renderList() {
  $("#poGrid").innerHTML = st.list.map((x) => `<article class="cl-card"><a class="cl-card__media" href="#poster/${x.id}">${x.outputs?.[0] ? `<img src="${url(x, x.outputs[0])}" alt="" loading="lazy">` : x.bg ? `<img src="${url(x, x.bg)}" alt="" loading="lazy">` : `<span class="cl-card__ph" aria-hidden="true">🖼️</span>`}</a>
    <div class="cl-card__body"><strong class="cl-card__title">${esc(x.name || x.id)}</strong><p class="muted small">PNG ${x.outputs?.length || 0}장 · ${new Date(x.updated_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</p>
      <div class="ex__row"><a class="btn btn--ghost btn--sm" href="#poster/${x.id}">열기</a>${x.outputs?.[0] ? `<a class="btn btn--ghost btn--sm" href="${url(x, x.outputs[0])}" download>PNG 받기</a>` : ""}<button class="btn btn--ghost btn--sm" type="button" data-podel="${x.id}">지우기</button></div></div></article>`).join("")
    || `<p class="muted cl-empty">아직 만든 포스터가 없습니다.</p>`;
}

// ── 내 이미지 (이름 붙인 이미지 — 자연어 요청에서 「이름」으로 부른다) ──
function renderAssets() {
  const p = st.p;
  $("#poAssets").innerHTML = (p.assets || []).map((a) => `<figure class="po__asset">
    <button type="button" class="po__asset-img" data-poassetuse="${esc(a.name)}" title="눌러서 「${esc(a.name)}」을 요청 칸에 넣기"><img src="${url(p, a.file)}" alt=""></button>
    <input data-poassetname="${a.file}" value="${esc(a.name)}" aria-label="이미지 이름" placeholder="이름">
    <button type="button" class="po__x" data-poassetdel="${a.file}" aria-label="${esc(a.name)} 빼기">×</button></figure>`).join("")
    || `<p class="muted small" style="margin:0">없음 — 제품 사진·모델 사진·로고 등을 올리고 이름(예: 정수기 제품)을 붙이세요.</p>`;
}
const insertName = (name) => {
  const ta = $("#poNl"), tag = `「${name}」 `;
  ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + " " : ta.value) + tag; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
};
async function saveAssets() {
  const assets = [...document.querySelectorAll("[data-poassetname]")].map((i) => ({ file: i.dataset.poassetname, name: i.value }));
  try { st.p = await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { assets } }); } catch (e) { toast(e.message, true); }
}

// ── 최종 이미지 프롬프트 ──
const FIN_TABS = [["with_text_en", "글자 포함 완성본", "output"], ["edit_en", "템플릿 편집형", "output"], ["no_text_en", "글자 없는 배경", "bg"]];
st.finTab = "with_text_en"; st.finIdx = 0;
function renderFinal() {
  const p = st.p, list = p?.finals || [], f = list[st.finIdx] || list[0];
  if (!f) { $("#poFinal").innerHTML = ""; return; }
  const tabs = FIN_TABS.filter(([k]) => f[k]);
  if (!f[st.finTab]) st.finTab = tabs[0]?.[0];
  const [, , as] = FIN_TABS.find(([k]) => k === st.finTab) || [];
  // 첨부: 템플릿 원본은 맨 뒤 번호라 편집형에만 붙인다 — 나머지 번호는 세 버전이 같다
  const refs = (f.refs || []).filter((r) => st.finTab === "edit_en" || r.role !== "template");
  const prompt = f[st.finTab] || "";
  $("#poFinal").innerHTML = `<div class="po__final-head"><strong>✦ 최종 이미지 프롬프트</strong>
      ${list.length > 1 ? `<span class="muted small">${list.length}개 중</span><select id="poFinPick" aria-label="이전 프롬프트">${list.map((x, i) => `<option value="${i}" ${i === st.finIdx ? "selected" : ""}>${new Date(x.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${esc((x.instruction || "").slice(0, 18))}</option>`).join("")}</select>` : ""}</div>
    ${f.prompt_ko ? `<p class="small" style="margin:0">${esc(f.prompt_ko)}</p>` : ""}
    <div class="seg">${tabs.map(([k, n]) => `<button type="button" class="seg__btn ${k === st.finTab ? "is-on" : ""}" data-pofin="${k}">${n}</button>`).join("")}</div>
    <textarea class="po__finbox" readonly rows="9">${esc(prompt)}</textarea>
    <div class="po__refs">${refs.map((r) => `<figure><img src="${url(p, r.file)}" alt=""><figcaption><b>${r.n}번</b> ${esc(r.label)}</figcaption></figure>`).join("") || `<span class="muted small">첨부 없음</span>`}</div>
    <div class="ex__row"><button class="btn btn--sm" type="button" data-copy="${esc(prompt)}">프롬프트 복사</button>
      <button class="btn btn--sm btn--primary hf-btn" type="button" data-hf="${esc(JSON.stringify({ target: { type: "poster", id: p.id, as }, kind: "image", purpose: "edit", prompt, refs: refs.map((r) => r.file), aspect: f.aspect }))}">✦ 힉스필드로 ${as === "bg" ? "배경" : "포스터"} 만들기</button>
      <span class="muted small">${as === "bg" ? "결과는 4. 배경에 들어갑니다" : "결과는 완성 포스터(PNG 목록)에 들어갑니다"} · 첨부는 위 순서대로</span></div>
    ${f.changes ? `<p class="note small" style="margin:0">해석: ${esc(f.changes)}</p>` : ""}${f.notes ? `<p class="note small" style="margin:0">✍ ${esc(f.notes)}</p>` : ""}`;
}

// ── 템플릿 ──
async function openTpl() {
  $("#poTplDialog").showModal();
  $("#poTplGrid").innerHTML = `<p class="muted">불러오는 중…</p>`;
  st.tpls = await api("/api/poster-templates").catch((e) => (toast(e.message, true), []));
  renderTpl();
}
function renderTpl() {
  const src = $("#poTplSrc").value, list = st.tpls.filter((t) => !src || t.source === src);
  $("#poTplGrid").innerHTML = list.map((t) => `<div class="po-pick__item" role="button" tabindex="0" data-potpl="${esc(t.id)}">
    ${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'po-pick__ph',textContent:'🖼️'}))">` : `<div class="po-pick__ph">🖼️</div>`}
    <span>${esc(t.name)}</span><small>${esc(t.source)}${t.summary ? ` · ${esc(t.summary)}` : ""}</small>
    <div class="po__pal" style="padding:0 8px 8px">${(t.colors || t.palette || []).map((c) => `<i style="background:${esc(c)}"></i>`).join("")}
      ${t.source === "포스터 템플릿" ? `<button type="button" class="btn btn--ghost btn--sm" data-potpldel="${t.id}" style="margin-left:auto">지우기</button>` : ""}</div></div>`).join("")
    || `<p class="muted">템플릿이 없습니다. 포스터를 만든 뒤 "이 포스터를 템플릿으로 저장"을 누르거나, 카드뉴스에서 캐러셀을 템플릿으로 저장하세요.</p>`;
}

// ── 수집한 이미지 고르기 ──
async function openPick(as) {
  st.pick = as;
  $("#poPickTitle").textContent = as === "asset" ? "수집한 이미지를 내 이미지로" : as === "bg" ? "수집한 이미지를 배경으로" : as.startsWith("layer:") ? `수집한 이미지를 "${labelOf(as.slice(6))}" 사진 칸에` : "수집한 이미지를 참고로";
  $("#poPickDialog").showModal();
  if (!st.images) { $("#poPickGrid").innerHTML = `<p class="muted">불러오는 중…</p>`; st.images = await api("/api/collected-images").catch((e) => (toast(e.message, true), [])); }
  const brands = [...new Map(st.images.map((x) => [x.brandId, x])).values()];
  $("#poPickBrand").innerHTML = `<option value="">모든 광고주</option>` + brands.map((b) => `<option value="${esc(b.brandId)}">${esc(b.manual ? "링크·업로드 (직접 분석)" : b.brand)}</option>`).join("");
  renderPick();
}
function renderPick() {
  const b = $("#poPickBrand").value, k = $("#poPickKind").value;
  const list = st.images.filter((x) => (!b || x.brandId === b) && (!k || x.kind === k)).slice(0, 240);
  $("#poPickGrid").innerHTML = list.map((x, i) => `<button type="button" class="po-pick__item" data-poimg="${st.images.indexOf(x)}">
    <img src="/data/${encodeURIComponent(x.folder)}/${x.dir}/${encodeURIComponent(x.file)}" alt="" loading="lazy">
    <span>${esc(x.manual ? "링크·업로드" : x.brand)} · ${esc(x.kind)}</span>${x.text ? `<small>${esc(x.text)}</small>` : ""}</button>`).join("")
    || `<p class="muted">수집한 이미지가 없습니다. 홈 → 광고 수집(공용)에서 모으거나 링크·업로드로 넣으세요.</p>`;
}

function bind() {
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "log" && st.waiting) status(e.message);
    if (e.type !== "job" || e.state === "start") return;
    const mine = e.kind === "poster" || (e.kind === "hf" && e.result?.type === "poster");
    if (!mine) return;
    st.waiting = false; status("");
    if (e.state === "error") return toast(e.message, true);
    toast(e.kind === "hf" ? (e.result?.as === "output" ? "힉스필드 포스터가 완성 목록에 들어왔습니다" : "힉스필드 배경이 들어왔습니다") : e.result?.layout ? "템플릿 소재를 뽑았습니다 — 아래 칸에 바꿀 내용을 적으세요" : e.result?.edited ? "요청대로 고쳤습니다" : e.result?.final ? "최종 이미지 프롬프트가 준비됐습니다" : "카피가 준비됐습니다");
    if (e.result?.final) st.finIdx = 0;
    if (st.p && (e.result?.id === st.p.id)) api(`/api/posters/${st.p.id}`).then((p) => { st.p = p; if (p.copy && !p.layers) save({ layers: defaultLayers(p.copy) }); render(); });
  });
  $("#poNew").addEventListener("click", async () => { const p = await api("/api/posters", { method: "POST", body: {} }); location.hash = `#poster/${p.id}`; });
  $("#poPick").addEventListener("change", () => (location.hash = `#poster/${$("#poPick").value}`));
  document.querySelectorAll("[data-pi]").forEach((i) => i.addEventListener("input", () => {
    const inputs = { ...(st.p.inputs || {}), [i.dataset.pi]: i.value };
    save({ inputs, name: (inputs.product || inputs.purpose || "새 포스터").slice(0, 40) });
  }));
  $("#poSize").addEventListener("change", () => { save({ size: $("#poSize").value }); draw(); });
  $("#poStyle").addEventListener("change", () => save({ style: $("#poStyle").value }));
  $("#poOverlay").addEventListener("input", () => { save({ overlay: Number($("#poOverlay").value) }); draw(); });
  $("#poCopy").addEventListener("click", async () => {
    if (!st.p.inputs?.product && !st.p.inputs?.purpose && !st.p.inputs?.message) return toast("무엇을·제품·꼭 들어갈 말 중 하나는 적으세요", true);
    if (st.p.copy && !confirm("카피를 다시 쓰면 글자 배치가 처음으로 돌아갑니다. 계속할까요?")) return;
    clearTimeout(saveT); await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { inputs: st.p.inputs, size: st.p.size, style: st.p.style } });
    try { await api(`/api/posters/${st.p.id}/copy`, { method: "POST" }); st.waiting = true; status("Claude 가 쓰는 중…"); } catch (e) { toast(e.message, true); }
  });
  $("#posterView").addEventListener("input", (e) => {
    if (e.target.id === "poBgPrompt") return save({ copy: { ...st.p.copy, bg_prompt_en: e.target.value } }); // 힉스필드 버튼은 다음 그리기 때 반영
    const f = e.target.closest("[data-pl]"); if (!f) return;
    const L = { ...st.p.layers[st.sel] }, k = f.dataset.pl;
    L[k] = f.type === "checkbox" ? f.checked : ["size", "weight"].includes(k) ? Number(f.value) : f.value;
    if (k === "size") f.nextElementSibling.textContent = f.value;
    if (k === "w" || k === "h") { L[k] = Number(f.value); f.nextElementSibling.textContent = `${Math.round(f.value * 100)}%`; }
    save({ layers: { ...st.p.layers, [st.sel]: L } }); draw();
    if (k === "show") $("#poLayers").querySelector(`[data-polayer="${st.sel}"]`).textContent = labelOf(st.sel) + (L.show ? "" : " (숨김)");
  });
  $("#posterView").addEventListener("change", (e) => { if (e.target.id === "poBgPrompt") render(); });
  $("#posterView").addEventListener("click", async (e) => {
    if (e.target.closest("[data-potplx]")) { st.p.template = null; await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { template: null } }).catch((x) => toast(x.message, true)); return render(); }
    const au = e.target.closest("[data-poassetuse]"); if (au) return insertName(au.dataset.poassetuse);
    const ad = e.target.closest("[data-poassetdel]");
    if (ad) { ad.closest("figure").remove(); await saveAssets(); return render(); }
    const ft = e.target.closest("[data-pofin]"); if (ft) { st.finTab = ft.dataset.pofin; return renderFinal(); }
    const el = e.target.closest("[data-poel]");
    if (el) { // 소재를 누르면 그 층을 고르고, 자연어 칸에 이름을 넣어 준다
      st.sel = el.dataset.poel; const ta = $("#poNl"), name = `「${labelOf(st.sel)}」 `;
      if (!ta.value.includes(name)) { ta.value = (ta.value ? ta.value.trimEnd() + "\n" : "") + name; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return render();
    }
    const ly = e.target.closest("[data-polayer]"); if (ly) { st.sel = ly.dataset.polayer; return render(); }
    const bg = e.target.closest("[data-pobg]"); if (bg) { save({ bg: bg.dataset.pobg }); return render(); }
    const rd = e.target.closest("[data-porefdel]");
    if (rd) { const refs = (st.p.refs || []).filter((r) => r.file !== rd.dataset.porefdel); st.p.refs = refs; await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { refs: refs.map((r) => r.file) } }).catch((x) => toast(x.message, true)); return render(); }
    const pk = e.target.closest("[data-popick]"); if (pk) return openPick(pk.dataset.popick);
    const del = e.target.closest("[data-podel]");
    if (del) { if (!confirm("이 포스터를 지울까요? 만든 PNG 도 같이 지워집니다.")) return; await api(`/api/posters/${del.dataset.podel}`, { method: "DELETE" }); if (st.p?.id === del.dataset.podel) st.p = null; return loadList(); }
  });
  // 파일 올리기 (배경·참고)
  for (const [inp, kind] of [["#poBgUp", "bg"], ["#poRefUp", "ref"]]) $(inp).addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const up = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const d = await up.json(); if (!up.ok) throw new Error(d.error || up.status);
      st.p = await api(`/api/posters/${st.p.id}/${kind}`, { method: "POST", body: { token: d.token } }); render();
    } catch (err) { toast(err.message, true); }
    e.target.value = "";
  });
  // 자연어로 고치기
  $("#poNl").addEventListener("input", () => save({ nl: $("#poNl").value }));
  $("#poNlGo").addEventListener("click", async () => {
    const instruction = $("#poNl").value.trim();
    if (!instruction) return toast("어떻게 바꿀지 적으세요", true);
    clearTimeout(saveT); await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { layers: st.p.layers, overlay: st.p.overlay, bg_color: st.p.bg_color } }).catch(() => {});
    st.exporting = true; draw(); const preview = $("#poCanvas").toDataURL("image/png"); st.exporting = false; draw();
    try { await api(`/api/posters/${st.p.id}/edit`, { method: "POST", body: { instruction, preview } }); st.waiting = true; status("Claude 가 고치는 중…"); toast("고치는 중 (1분 안팎)"); }
    catch (e) { toast(e.message, true); }
  });
  $("#poFinalGo").addEventListener("click", async () => {
    const instruction = $("#poNl").value.trim();
    clearTimeout(saveT); await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { layers: st.p.layers, overlay: st.p.overlay, bg_color: st.p.bg_color } }).catch(() => {});
    // 배치 가이드: 고른 테두리는 빼고 사진 칸 자리 표시는 남긴다
    const sel = st.sel; st.sel = null; draw(); const preview = $("#poCanvas").toDataURL("image/png"); st.sel = sel; draw();
    try { await api(`/api/posters/${st.p.id}/final`, { method: "POST", body: { instruction, preview } }); st.waiting = true; status("Claude 가 최종 프롬프트를 쓰는 중…"); toast("최종 이미지 프롬프트 쓰는 중 (1분 안팎)"); }
    catch (e) { toast(e.message, true); }
  });
  $("#poUndo").addEventListener("click", async () => { try { st.p = await api(`/api/posters/${st.p.id}/undo`, { method: "POST" }); render(); toast("되돌렸습니다"); } catch (e) { toast(e.message, true); } });
  $("#poReAnalyze").addEventListener("click", async () => {
    if (!st.p?.template?.image) return toast("템플릿을 먼저 불러오세요", true);
    if (!confirm("템플릿에서 소재를 다시 뽑으면 지금 글자 층이 템플릿 배치로 돌아갑니다 (되돌리기 가능). 계속할까요?")) return;
    try { await api(`/api/posters/${st.p.id}/analyze`, { method: "POST" }); st.waiting = true; st.p.template.needs_layout = true; render(); } catch (e) { toast(e.message, true); }
  });
  $("#posterView").addEventListener("change", (e) => {
    if (e.target.id === "poFinPick") { st.finIdx = Number(e.target.value); renderFinal(); }
    if (e.target.matches("[data-poassetname]")) saveAssets().then(() => { renderAssets(); render(); }); // 이름을 바꾸면 겹침 정리 후 다시 그림
  });
  $("#poAssetUp").addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    for (const [i, f] of files.entries()) {
      try {
        status(`이미지 올리는 중 ${i + 1}/${files.length}`);
        const r = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
        st.p = await api(`/api/posters/${st.p.id}/asset`, { method: "POST", body: { token: d.token, name: f.name.replace(/\.[^.]+$/, "") } });
      } catch (err) { toast(`${f.name}: ${err.message}`, true); }
    }
    status(""); render();
    const last = [...document.querySelectorAll("[data-poassetname]")].at(-1); if (last) { last.focus(); last.select(); } // 바로 이름 고치기
    if (files.length) toast("이미지를 넣었습니다 — 이름을 알아보기 쉽게 바꾸세요");
  });
  $("#poBgColor").addEventListener("input", (e) => { save({ bg_color: e.target.value }); draw(); });
  $("#posterView").addEventListener("change", async (e) => {
    const up = e.target.closest("[data-poimgup]"); if (!up) return;
    const f = up.files[0]; if (!f) return;
    try {
      const r = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
      clearTimeout(saveT); await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { layers: st.p.layers } });
      st.p = await api(`/api/posters/${st.p.id}/layer-image`, { method: "POST", body: { token: d.token, key: up.dataset.poimgup } }); render(); toast("사진을 넣었습니다");
    } catch (err) { toast(err.message, true); }
  });
  $("#poLogAll").addEventListener("change", renderLog);
  $("#poLogList").addEventListener("click", (e) => { const r = e.target.closest("[data-poview]"); if (r) location.hash = `#poster/${r.dataset.poview}`; });
  $("#poLogList").addEventListener("keydown", (e) => { const r = e.target.closest("[data-poview]"); if (r && e.key === "Enter") location.hash = `#poster/${r.dataset.poview}`; });
  $("#poViewBar").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-porestore]"); if (!b) return;
    const [pid, vid] = b.dataset.porestore.split("|");
    if (!confirm("이 저장 버전으로 되돌릴까요? 지금 상태는 '되돌리기' 버튼으로 다시 돌아올 수 있습니다.")) return;
    try { await api(`/api/posters/${pid}/restore`, { method: "POST", body: { vid } }); toast("되돌렸습니다"); location.hash = `#poster/${pid}`; }
    catch (err) { toast(err.message, true); }
  });
  $("#poLogPoster").addEventListener("change", renderLog); $("#poLogType").addEventListener("change", renderLog);
  // 템플릿
  $("#poTplOpen").addEventListener("click", openTpl);
  $("#poTplClose").addEventListener("click", () => $("#poTplDialog").close());
  $("#poTplSrc").addEventListener("change", renderTpl);
  $("#poTplSave").addEventListener("click", async () => {
    if (!st.p?.layers) return toast("카피를 먼저 써서 글자 층을 만든 뒤 저장하세요", true);
    const name = prompt("템플릿 이름", st.p.name || "포스터 템플릿"); if (!name) return;
    try { clearTimeout(saveT); await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { layers: st.p.layers, overlay: st.p.overlay, copy: st.p.copy } }); await api("/api/poster-templates", { method: "POST", body: { posterId: st.p.id, name } }); toast("템플릿으로 저장했습니다 — 썸네일은 마지막으로 만든 PNG 입니다"); }
    catch (e) { toast(e.message, true); }
  });
  $("#poTplGrid").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-potpldel]");
    if (del) { e.stopPropagation(); if (!confirm("이 포스터 템플릿을 지울까요?")) return; await api(`/api/poster-templates/${del.dataset.potpldel}`, { method: "DELETE" }); st.tpls = st.tpls.filter((t) => t.id !== del.dataset.potpldel); return renderTpl(); }
    const it = e.target.closest("[data-potpl]"); if (!it) return;
    try {
      clearTimeout(saveT);
      st.p = await api(`/api/posters/${st.p.id}/template`, { method: "POST", body: { tid: it.dataset.potpl } });
      if (st.p.copy && !st.p.layers) save({ layers: defaultLayers(st.p.copy) });
      $("#poTplDialog").close(); render(); toast(`템플릿 "${st.p.template.name}"을 입혔습니다`);
    } catch (err) { toast(err.message, true); }
  });
  // 수집 이미지 고르기
  $("#poPickClose").addEventListener("click", () => $("#poPickDialog").close());
  $("#poPickBrand").addEventListener("change", renderPick); $("#poPickKind").addEventListener("change", renderPick);
  $("#poPickGrid").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-poimg]"); if (!b) return;
    const x = st.images[Number(b.dataset.poimg)];
    try {
      st.p = await api(`/api/posters/${st.p.id}/import`, { method: "POST", body: { brandId: x.brandId, dir: x.dir, file: x.file, as: st.pick } });
      $("#poPickDialog").close(); render(); toast(st.pick === "asset" ? "내 이미지로 넣었습니다 — 이름을 바꾸세요" : st.pick === "bg" ? "배경으로 넣었습니다" : st.pick.startsWith("layer:") ? "사진 칸에 넣었습니다" : "참고 이미지로 넣었습니다");
    } catch (err) { toast(err.message, true); }
  });
  // 캔버스에서 글자 끌기
  const cv = $("#poCanvas");
  cv.addEventListener("pointerdown", (e) => {
    if (!st.p?.layers || st.viewing) return;
    const r = cv.getBoundingClientRect(), [W, H] = size(), sx = W / r.width, sy = H / r.height;
    const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy;
    const hit = keys().reverse().find((k) => { const b = st.boxes[k]; return b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; });
    if (!hit) return;
    st.sel = hit; $("#poLayers").closest("details").open = true; render();
    const L0 = { ...st.p.layers[hit] };
    cv.setPointerCapture(e.pointerId);
    const move = (m) => {
      const L = { ...L0, x: Math.min(1, Math.max(0, L0.x + ((m.clientX - e.clientX) * sx) / W)), y: Math.min(0.98, Math.max(0, L0.y + ((m.clientY - e.clientY) * sy) / H)) };
      st.p.layers = { ...st.p.layers, [hit]: L }; draw();
    };
    const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); save({ layers: st.p.layers }); };
    cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
  });
  $("#poSave").addEventListener("click", async () => {
    const memo = prompt("저장 메모 (선택) — 기록 탭에서 이 이름으로 보입니다", "");
    if (memo === null) return;
    clearTimeout(saveT);
    try {
      await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { name: st.p.name, inputs: st.p.inputs, size: st.p.size, style: st.p.style, layers: st.p.layers, overlay: st.p.overlay, copy: st.p.copy, bg_color: st.p.bg_color } });
      const sel = st.sel; st.sel = null; st.exporting = true; draw(); const preview = $("#poCanvas").toDataURL("image/png"); st.exporting = false; st.sel = sel; draw();
      await api(`/api/posters/${st.p.id}/save`, { method: "POST", body: { memo, preview } });
      savedMark("💾 저장됨"); toast("저장했습니다 — 기록 탭에서 이 버전을 볼 수 있습니다");
    } catch (e) { toast(e.message, true); }
  });
  $("#poPng").addEventListener("click", async () => {
    st.exporting = true; draw();
    const data = $("#poCanvas").toDataURL("image/png");
    st.exporting = false; draw();
    try {
      clearTimeout(saveT); await api(`/api/posters/${st.p.id}`, { method: "PUT", body: { layers: st.p.layers, overlay: st.p.overlay, copy: st.p.copy } });
      const r = await api(`/api/posters/${st.p.id}/png`, { method: "POST", body: { data } });
      st.p.outputs = [r.file, ...(st.p.outputs || [])]; render();
      const a = document.createElement("a"); a.href = url(st.p, r.file); a.download = `${st.p.name || st.p.id}.png`; a.click();
      toast("PNG 를 저장했습니다");
    } catch (err) { toast(err.message, true); }
  });
}

// ── 기록 탭: 모든 포스터에서 한 일 (최근 먼저) ──
const LOG_TYPES = { save: "저장", restore: "버전 복원", create: "만들기", template: "템플릿", analyze: "소재 배치", copy: "카피", edit: "배치 고치기", final: "최종 프롬프트", undo: "되돌리기", bg: "배경", ref: "참고 이미지", asset: "내 이미지", image: "사진 칸", png: "PNG", output: "생성 결과" };
async function loadLog() {
  st.log = await api("/api/poster-log").catch((e) => (toast(e.message, true), []));
  $("#poLogCount").textContent = st.log.length ? `${st.log.length}` : "";
  const posters = [...new Map(st.log.map((e) => [e.poster, e.posterName])).entries()];
  const keep = (sel, html) => { const v = $(sel).value; $(sel).innerHTML = html; if ([...$(sel).options].some((o) => o.value === v)) $(sel).value = v; };
  keep("#poLogPoster", `<option value="">모든 포스터</option>` + posters.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(""));
  keep("#poLogType", `<option value="">모든 기록</option>` + Object.entries(LOG_TYPES).filter(([k]) => st.log.some((e) => e.type === k)).map(([k, n]) => `<option value="${k}">${n}</option>`).join(""));
  renderLog();
}
function renderLog() {
  const pid = $("#poLogPoster").value, ty = $("#poLogType").value, all = $("#poLogAll").checked;
  // 기본은 열어 볼 수 있는 기록(저장·최종 프롬프트)만, "자세한 활동도 보기"면 전부
  const list = (st.log || []).filter((e) => (!pid || e.poster === pid) && (!ty || e.type === ty) && (all || ty || e.hasState));
  $("#poLogInfo").textContent = `${list.length}개`;
  const fu = (e, f) => `/data/_posters/${e.poster}/${f}`;
  const day = (d) => new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  let cur = "", html = "";
  for (const e of list) {
    const d = day(e.at);
    if (d !== cur) { cur = d; html += `<li class="po__logday">${esc(d)}</li>`; }
    const thumb = (e.files || []).find((f) => /^(snap|out|guide)_/.test(f)) || e.files?.[0];
    const open = e.hasState && e.vid;
    html += `<li class="po__logrow ${open ? "is-open" : ""} po__logrow--${e.type}" ${open ? `data-poview="${e.poster}~${e.vid}" role="button" tabindex="0"` : ""}>
      <span class="po__logtime">${new Date(e.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
      <span class="po__logthumb">${thumb ? `<img src="${fu(e, thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>
      <span class="po__logmain"><b>${esc(e.type === "save" ? (e.detail || "저장") : e.type === "final" ? "최종 이미지 프롬프트" : e.title || "")}</b>
        <small>${esc(e.posterName)}${e.template ? ` · 템플릿 ${esc(e.template)}` : ""}${e.instruction ? ` · “${esc(e.instruction.slice(0, 50))}”` : ""}</small></span>
      <span class="po__logtype">${LOG_TYPES[e.type] || e.type}</span>
      ${open ? `<span class="po__logopen">열어 보기 →</span>` : ""}
    </li>`;
  }
  $("#poLogList").innerHTML = html || `<li class="muted">기록이 없습니다. 만들기에서 💾 저장하거나 최종 이미지 프롬프트를 만들면 여기에 쌓입니다.</li>`;
}

function setView(v) {
  $("#poMakeView").hidden = v !== "make"; $("#poListView").hidden = v !== "list"; $("#poLogView").hidden = v !== "log";
  if (v === "log") loadLog();
  document.querySelectorAll("#poTabs .subtabs__item").forEach((a) => { const on = a.dataset.v === v; a.classList.toggle("is-on", on); a.setAttribute("aria-selected", on); });
}

window.poster = {
  // sub: "" 만들기 · "list" 만든 포스터 · "po_…" 그 포스터 열기
  async open(sub = "") {
    if (!st.bound) { bind(); st.bound = true; }
    setView(["list", "log"].includes(sub) ? sub : "make");
    st.meta = await api("/api/poster-meta");
    st.images = null; // 다시 열 때마다 새로 모은 이미지 반영
    await document.fonts?.load(`800 40px ${FONT}`).catch(() => {});
    leaveVersion();
    const vm = String(sub).match(/^(po_\d+)~(v_\d+)$/);
    if (vm) return openVersion(vm[1], vm[2]).catch((e) => toast(e.message, true));
    await loadList(/^po_\d+$/.test(sub) ? sub : undefined).catch((e) => toast(e.message, true));
  },
  close() {},
};

// 참고 이미지 — 레퍼런스 메뉴에서 고르기 (public/refpick.js)
document.addEventListener("click", async (e) => {
  if (!e.target.closest?.("#poRefLib") || !st.p) return;
  const picked = await window.pickReferences?.({ max: 6 }) || [];
  if (!picked.length) return;
  try {
    for (const x of picked) st.p = await api(`/api/posters/${st.p.id}/import-res`, { method: "POST", body: { kind: "reference", resId: x.id, file: x.file, name: x.name, as: "ref" } });
    render(); toast(`참고 이미지 ${picked.length}장을 넣었습니다`);
  } catch (err) { toast(err.message, true); }
});
