// 이미지 변형 (#vary) — 목록: 이미지 변형 에셋 · 상세(#vary/<brandId>/<dir>/<file>): 변형 만드는 페이지
// 상세 순서: ① 브랜드 에셋(리소스) 고르기 → ② 변형 추천(Claude) → ③ 아이디어로 변형 프롬프트 → ④ 힉스필드로 생성(모델·비율·개수·화질)
// 서버: /api/vary/assets · /api/brands/:id/prompts/suggest · /prompts/variants(+/delete) · /api/hf/generate (target variant, count)
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

const st = { list: [], st: "", bound: false, cur: null, pj: null, res: [], clients: [], client: "", pick: {}, models: [], hf: null, busy: {}, idea: "", brief: "" };
const PLAT = { meta: "메타", youtube: "유튜브", instagram: "인스타", manual: "직접" };
const SLOTS = [["product", "제품"], ["person", "인물"], ["background", "배경"]];
// 생성에 쓸 프롬프트 — 참조형은 변형에 첨부한 사진(refs)을 같이 보낸다
const PROMPTS = [["ref_text_en", "참조 사진 + 글자 포함", "ref"], ["ref_notext_en", "참조 사진 + 글자 없음", "ref"], ["edit_product_en", "제품 그대로 (편집형)", "prod"], ["plain_text_en", "글로만 + 글자 포함", ""], ["plain_notext_en", "글로만 + 글자 없음", ""]];
const dataUrl = (x, f) => `/data/${encodeURIComponent(x.folder)}/${x.dir}/${f.split("/").map(encodeURIComponent).join("/")}`;
const resUrl = (r, f) => `/data/_resources/${r.kind}/${r.id}/${encodeURIComponent(f)}`;
const resThumb = (r) => (r.files || []).find((f) => f.kind === "image")?.file;

// ── 목록 ──
function renderList() {
  const brand = $("#vaBrand").value, q = $("#vaQ").value.trim().toLowerCase();
  const base = st.list.filter((x) => (!brand || x.brandId === brand) && (!q || `${x.text} ${x.prompt_ko}`.toLowerCase().includes(q)));
  const n = { "": base.length, new: base.filter((x) => !x.variants).length, made: base.filter((x) => x.variants).length };
  document.querySelectorAll("#vaState [data-n]").forEach((e) => (e.textContent = n[e.dataset.n] || ""));
  const list = base.filter((x) => !st.st || (st.st === "new" ? !x.variants : x.variants));
  $("#vaHow").hidden = !!st.list.length;
  $("#vaGrid").hidden = !st.list.length;
  $("#vaGrid").innerHTML = list.map((x) => `<a class="va-card" href="#vary/${encodeURIComponent(x.brandId)}/${encodeURIComponent(x.dir)}/${encodeURIComponent(x.file)}">
    <span class="va-card__media"><img src="${esc(x.thumb)}" alt="" loading="lazy">${x.variants ? `<span class="va-card__n">변형 ${x.variants}</span>` : ""}</span>
    <span class="va-card__brand">${esc(x.brand)} <span class="muted">${esc(PLAT[x.platform] || "")}</span></span>
    <strong class="va-card__t">${esc(x.text.replace(/\s+/g, " ") || "(글자 없음)")}</strong>
    ${x.subjects.length ? `<span class="va-card__tags">${x.subjects.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join("")}</span>` : ""}
    <span class="va-card__go">변형 만들기 ›</span>
  </a>`).join("") || `<p class="va-empty">조건에 맞는 에셋이 없습니다.</p>`;
}
async function loadList() {
  try { st.list = await (await fetch("/api/vary/assets")).json(); } catch { st.list = []; }
  const sel = $("#vaBrand"), cur = sel.value;
  const brands = [...new Map(st.list.map((x) => [x.brandId, x.brand])).entries()];
  sel.innerHTML = `<option value="">모든 브랜드 (${st.list.length})</option>` + brands.map(([id, name]) => `<option value="${esc(id)}">${esc(name)} (${st.list.filter((x) => x.brandId === id).length})</option>`).join("");
  sel.value = brands.some(([id]) => id === cur) ? cur : "";
  renderList();
}

// ── 상세 ──
const curIm = () => st.pj?.images?.find((im) => im.file === st.cur.file);
const curVariants = () => (st.pj?.variants || []).filter((v) => v.image === st.cur.file);
const modelOf = (id) => st.models.find((m) => m.id === id) || st.models[0];
function defaultGen(v) {
  const g = (st.gen ||= {})[v.vid] ||= { model: "gpt_image_2_5", count: 1, prompt: v.edit_product_en && v.refs?.some((r) => r.role === "product") ? "edit_product_en" : "ref_text_en" };
  const m = modelOf(g.model); if (!m) return g;
  const want = curIm()?.aspect || "";
  if (!g.aspect || !m.aspects.includes(g.aspect)) g.aspect = m.aspects.includes(want) ? want : m.aspects.includes("4:5") && want === "4:5" ? "4:5" : m.aspects.includes("3:4") ? "3:4" : m.aspects[0];
  if (m.res && !m.res.options.includes(g.res)) g.res = m.res.def;
  if (m.quality && !m.quality.options.includes(g.quality)) g.quality = m.quality.def;
  return g;
}

function slotHTML(kind, label) {
  const list = st.res.filter((r) => r.kind === kind && (!st.client || r.client === st.client));
  return `<div class="vd-slot"><div class="vd-slot__head"><strong>${label}</strong><span class="muted small">${st.pick[kind] ? esc(st.res.find((r) => r.id === st.pick[kind])?.name || "") : "고르지 않음 — 원본 그대로"}</span></div>
    <div class="vd-res">${list.map((r) => { const t = resThumb(r); return `<button type="button" class="vd-res__item ${st.pick[kind] === r.id ? "is-on" : ""}" data-pick="${kind}:${r.id}" title="${esc(r.name)}">${t ? `<img src="${resUrl(r, t)}" alt="" loading="lazy">` : `<span class="xp-ph"></span>`}<span>${esc(r.name)}</span></button>`; }).join("")
      || `<p class="muted small">이 폴더에 ${label} 리소스가 없습니다. <a href="#res">리소스</a>에서 올리세요.</p>`}</div></div>`;
}

function genHTML(v) {
  const g = defaultGen(v), m = modelOf(g.model), busy = st.busy[v.vid];
  const opt = (list, val) => list.map(([k, l]) => `<option value="${esc(k)}" ${k === val ? "selected" : ""}>${esc(l)}</option>`).join("");
  const avail = PROMPTS.filter(([k]) => v[k]);
  return `<div class="vd-gen" data-gen="${v.vid}">
    <label class="field"><span>쓸 프롬프트</span><select data-g="prompt">${opt(avail.map(([k, l]) => [k, l]), g.prompt)}</select></label>
    <label class="field"><span>모델</span><select data-g="model">${opt(st.models.map((x) => [x.id, `${x.name} — ${x.note}`]), g.model)}</select></label>
    <label class="field"><span>비율</span><select data-g="aspect">${opt(m.aspects.map((a) => [a, a]), g.aspect)}</select></label>
    <label class="field"><span>개수</span><select data-g="count">${opt([1, 2, 3, 4].map((n) => [String(n), `${n}장`]), String(g.count))}</select></label>
    ${m.res ? `<label class="field"><span>해상도</span><select data-g="res">${opt(m.res.options.map((o) => [o, o]), g.res)}</select></label>` : ""}
    ${m.quality ? `<label class="field"><span>화질</span><select data-g="quality">${opt(m.quality.options.map((o) => [o, o]), g.quality)}</select></label>` : ""}
    <button class="btn btn--primary" type="button" data-hf="${v.vid}" ${busy ? "disabled" : ""}>${busy ? "생성 중…" : "힉스필드로 생성"}</button>
  </div>${st.hf?.mode === "api" ? `<p class="muted small">지금 힉스필드 연결이 API 방식이라 모델 고르기는 적용되지 않습니다 (API 는 마케팅 스튜디오 이미지 고정). 오른쪽 위에서 MCP 로 바꾸면 고른 모델로 만듭니다.</p>` : ""}`;
}

function variantHTML(v, i) {
  const gens = v.generated || [];
  return `<article class="vd-var" id="var-${v.vid}">
    <header class="vd-var__head"><div><strong>${esc(v.title || `변형 ${i + 1}`)}</strong><span class="muted small"> · ${new Date(v.created_at).toLocaleString("ko-KR")}</span></div>
      <button class="btn btn--ghost btn--sm" type="button" data-delv="${v.vid}">지우기</button></header>
    ${v.inputs?.idea ? `<p class="vd-var__idea"><b>아이디어</b> ${esc(v.inputs.idea)}</p>` : ""}
    ${v.idea_summary || v.changes ? `<p class="muted small">${esc(v.idea_summary || v.changes)}</p>` : ""}
    ${v.refs?.length ? `<div class="vd-refs">${v.refs.map((r) => `<figure><img src="${dataUrl(st.cur, r.file)}" alt=""><figcaption>${r.n}. ${esc(r.label || r.role)}</figcaption></figure>`).join("")}</div>` : ""}
    <details class="vd-var__p"><summary>프롬프트 보기</summary><pre>${esc(v.prompt_ko || v.ref_text_en || "")}</pre></details>
    ${genHTML(v)}
    <div class="vd-outs">${gens.slice().reverse().map((g) => `<figure><a href="${dataUrl(st.cur, g.file)}" target="_blank" rel="noopener"><img src="${dataUrl(st.cur, g.file)}" alt="" loading="lazy"></a><figcaption>${esc(g.model || g.mode || "")} · <a href="${dataUrl(st.cur, g.file)}" download>받기</a></figcaption></figure>`).join("") || `<p class="muted small">아직 만든 이미지가 없습니다.</p>`}</div>
  </article>`;
}

function renderDetail() {
  const x = st.cur, im = curIm();
  if (!im) { $("#vaDetail").innerHTML = `<p class="va-empty">이 에셋을 찾지 못했습니다. <a href="#vary">목록으로</a></p>`; return; }
  const sug = st.pj.suggestions?.[x.file];
  const vs = curVariants(), busy = st.busy;
  $("#vaDetail").innerHTML = `
    <a class="vd-back" href="#vary">← 이미지 변형 목록</a>
    <div class="vd-cols">
      <aside class="vd-orig">
        <img src="${dataUrl(x, x.file)}" alt="원본 광고 이미지">
        <div class="vd-orig__meta"><strong>${esc(x.brand)}</strong> <span class="muted small">${esc(PLAT[x.platform] || "")} · ${esc(x.dir)}</span></div>
        ${im.onscreen_text ? `<p class="vd-orig__text">${esc(im.onscreen_text)}</p>` : ""}
        <details><summary>원본 장면 설명</summary><p class="small">${esc(im.image_prompt_ko || im.image_prompt_en)}</p></details>
      </aside>
      <div class="vd-main">
        <section class="vd-step">
          <h3><span class="su__n">1</span> 브랜드 에셋 고르기 <span class="muted small">— 원본의 제품·인물·배경을 무엇으로 바꿀지</span></h3>
          <label class="field vd-client"><span>고객사 폴더</span><select id="vdClient"><option value="">전체</option>${st.clients.map((c) => `<option value="${c.id}" ${st.client === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          ${SLOTS.map(([k, l]) => slotHTML(k, l)).join("")}
        </section>
        <section class="vd-step">
          <h3><span class="su__n">2</span> 변형 추천 <span class="muted small">— 고른 에셋으로 Claude 가 아이디어를 냅니다</span></h3>
          <div class="ra-row"><input id="vdBrief" class="ra-grow" value="${esc(st.brief)}" placeholder="추가 요청 (선택) — 예: 신규 가입 혜택 강조, 20대 여성 타깃"><button class="btn" type="button" id="vdSuggest" ${busy.suggest ? "disabled" : ""}>${busy.suggest ? "추천 받는 중… (1분 안팎)" : sug ? "다시 추천 받기" : "추천 받기"}</button></div>
          ${sug?.items?.length ? `<div class="vd-sugs">${sug.items.map((s, i) => `<button type="button" class="vd-sug ${st.idea === s.idea ? "is-on" : ""}" data-sug="${i}"><strong>${esc(s.title)}</strong><span>${esc(s.idea)}</span>${s.why ? `<em>${esc(s.why)}</em>` : ""}</button>`).join("")}</div>` : ""}
        </section>
        <section class="vd-step">
          <h3><span class="su__n">3</span> 변형 프롬프트 만들기</h3>
          <label class="field"><span>변형 아이디어 — 추천을 누르면 채워집니다. 직접 고쳐도 됩니다</span><textarea id="vdIdea" rows="3" placeholder="예: 제품을 우리 정수기로 바꾸고 헤드라인은 &quot;렌탈료 첫 달 0원&quot;, 배경은 밝은 하늘색">${esc(st.idea)}</textarea></label>
          <label class="check"><input type="checkbox" id="vdOrig" ${st.attachOrig === false ? "" : "checked"}> 원본 이미지를 참조로 첨부 <span class="muted small">(구도가 정확히 유지됩니다)</span></label>
          <button class="btn btn--primary" type="button" id="vdMake" ${busy.make ? "disabled" : ""}>${busy.make ? "프롬프트 만드는 중… (1분 안팎)" : "변형 프롬프트 만들기"}</button>
        </section>
        <section class="vd-step">
          <h3><span class="su__n">4</span> 만든 변형 · 힉스필드로 생성 <span class="muted small">${vs.length}개</span></h3>
          ${vs.map(variantHTML).join("") || `<p class="muted small">아직 만든 변형이 없습니다. 3단계에서 만드세요.</p>`}
        </section>
      </div>
    </div>`;
}

async function openDetail(brandId, dir, file) {
  if (!st.list.length) await loadList();
  st.cur = st.list.find((x) => x.brandId === brandId && x.dir === dir && x.file === file) || null;
  $("#vaList").hidden = true; $("#vaDetail").hidden = false;
  document.querySelector("#varyView .page__head").hidden = true;
  if (!st.cur) return renderDetail();
  window.nav?.sub([{ label: st.cur.text.replace(/\s+/g, " ").slice(0, 20) || st.cur.dir, go: () => {} }]);
  // 브랜드 폴더 이름 — 예전 서버(에셋 목록에 folder 가 없는 판)에서도 열리게 브랜드 목록에서 찾는다
  if (!st.cur.folder) st.cur.folder = (await api("/api/brands")).find((b) => b.id === brandId)?.folder || "";
  const readPj = async () => {
    const r = await fetch(dataUrl(st.cur, "prompts.json"), { cache: "no-store" });
    if (!r.ok) throw new Error("이 에셋의 프롬프트 파일을 읽지 못했습니다 — 광고 수집에서 [이미지 변형 에셋으로 저장]을 다시 눌러 보세요");
    return r.json();
  };
  const [pj, res, clients, models, hf] = await Promise.all([
    readPj(),
    st.res.length ? st.res : api("/api/resources"), st.clients.length ? st.clients : api("/api/clients"),
    st.models.length ? st.models : api("/api/hf/image-models"), api("/api/hf/settings").catch(() => null),
  ]);
  if (st.openKey !== `${brandId}/${dir}/${file}`) { st.openKey = `${brandId}/${dir}/${file}`; st.idea = ""; st.brief = ""; st.pick = { ...(pj.suggestions?.[file]?.resources || {}) }; }
  Object.assign(st, { pj, res: res.filter((r) => ["product", "person", "background"].includes(r.kind)), clients, models, hf });
  renderDetail();
}
async function reloadDetail() { if (st.cur && !$("#vaDetail").hidden) { st.res = []; await openDetail(st.cur.brandId, st.cur.dir, st.cur.file); } }

function showList() {
  $("#vaList").hidden = false; $("#vaDetail").hidden = true;
  document.querySelector("#varyView .page__head").hidden = false;
  return loadList();
}

function bind() {
  $("#vaBrand").addEventListener("change", renderList);
  $("#vaQ").addEventListener("input", renderList);
  $("#vaState").addEventListener("click", (e) => {
    const b = e.target.closest("[data-st]"); if (!b) return;
    st.st = b.dataset.st;
    document.querySelectorAll("#vaState .seg__btn").forEach((x) => x.classList.toggle("is-on", x === b));
    renderList();
  });

  const D = $("#vaDetail");
  D.addEventListener("input", (e) => {
    if (e.target.id === "vdIdea") st.idea = e.target.value;
    if (e.target.id === "vdBrief") st.brief = e.target.value;
  });
  D.addEventListener("change", (e) => {
    if (e.target.id === "vdClient") { st.client = e.target.value; return renderDetail(); }
    if (e.target.id === "vdOrig") { st.attachOrig = e.target.checked; return; }
    const g = e.target.closest("[data-gen]"); if (!g || !e.target.dataset.g) return;
    const cfg = st.gen[g.dataset.gen]; cfg[e.target.dataset.g] = e.target.dataset.g === "count" ? Number(e.target.value) : e.target.value;
    if (e.target.dataset.g === "model") renderDetail(); // 모델마다 비율·해상도·화질 칸이 다르다
  });
  D.addEventListener("click", async (e) => {
    const x = st.cur;
    const pick = e.target.closest("[data-pick]");
    if (pick) { const [k, id] = pick.dataset.pick.split(":"); st.pick[k] = st.pick[k] === id ? "" : id; return renderDetail(); }
    const sug = e.target.closest("[data-sug]");
    if (sug) { st.idea = st.pj.suggestions[x.file].items[Number(sug.dataset.sug)].idea; renderDetail(); $("#vdIdea").focus(); return; }
    if (e.target.id === "vdSuggest") {
      try { st.busy.suggest = true; renderDetail(); await api(`/api/brands/${x.brandId}/prompts/suggest`, { method: "POST", body: { dir: x.dir, image: x.file, resources: st.pick, brief: st.brief } }); }
      catch (err) { st.busy.suggest = false; renderDetail(); toast(err.message, true); }
      return;
    }
    if (e.target.id === "vdMake") {
      const idea = $("#vdIdea").value.trim();
      if (!idea && !Object.values(st.pick).some(Boolean)) return toast("아이디어를 적거나 브랜드 에셋을 고르세요", true);
      const resources = Object.fromEntries(Object.entries(st.pick).filter(([, v]) => v));
      try { st.busy.make = true; renderDetail(); await api(`/api/brands/${x.brandId}/prompts/variants`, { method: "POST", body: { dir: x.dir, image: x.file, idea, resources, attachOriginal: $("#vdOrig")?.checked ?? true, tokens: [], roleTokens: {}, note: "" } }); }
      catch (err) { st.busy.make = false; renderDetail(); toast(err.message, true); }
      return;
    }
    const del = e.target.closest("[data-delv]");
    if (del) {
      if (!confirm("이 변형을 지울까요? 만든 이미지도 함께 지워집니다.")) return;
      try { await api(`/api/brands/${x.brandId}/prompts/variants/delete`, { method: "POST", body: { dir: x.dir, vid: del.dataset.delv } }); await reloadDetail(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    const hf = e.target.closest("[data-hf]");
    if (hf) {
      const v = curVariants().find((y) => y.vid === hf.dataset.hf), g = defaultGen(v), kind = PROMPTS.find(([k]) => k === g.prompt)?.[2];
      const refs = kind === "ref" ? [...(v.refs || [])].sort((a, b) => a.n - b.n).map((r) => r.file)
        : kind === "prod" ? [...(v.refs || [])].sort((a, b) => (a.role === "product" ? -1 : 0) - (b.role === "product" ? -1 : 0)).map((r) => r.file) : [];
      const m = modelOf(g.model);
      if (!confirm(`힉스필드로 ${g.count}장 만들까요? 크레딧이 듭니다.\n모델 ${m.name} · 비율 ${g.aspect}${g.res ? ` · ${g.res}` : ""}${g.quality ? ` · ${g.quality}` : ""}`)) return;
      try {
        st.busy[v.vid] = true; renderDetail();
        await api("/api/hf/generate", { method: "POST", body: { target: { type: "variant", brandId: x.brandId, dir: x.dir, vid: v.vid }, kind: "image", purpose: kind === "prod" ? "product" : "edit", prompt: v[g.prompt], refs, imageModel: g.model, aspect: g.aspect, resolution: g.res, quality: g.quality, count: g.count } });
        toast(`${g.count}장 만드는 중 — 끝나면 이 변형 아래에 붙습니다`);
      } catch (err) { st.busy[v.vid] = false; renderDetail(); toast(err.message, true); }
    }
  });

  // 작업 끝 → 이 페이지를 새로 읽는다 (추천 · 프롬프트 · 생성)
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type !== "job" || e.state === "start" || $("#varyView").hidden) return;
    if (e.kind === "prompts") { st.busy.suggest = false; st.busy.make = false; } // 알림은 app.js 가 띄운다
    else if (e.kind === "hf") { if (e.result?.type === "variant") delete st.busy[e.result.vid]; else if (e.state === "error") st.busy = {}; }
    else return;
    if ($("#vaDetail").hidden) loadList(); else reloadDetail();
  });
  $("#detail")?.addEventListener("close", () => { if (!$("#varyView").hidden && $("#vaDetail").hidden) loadList(); });
}

window.varyPage = {
  async open() {
    if (!st.bound) { bind(); st.bound = true; }
    const [, b, d, f] = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent);
    if (b && d && f) return openDetail(b, d, f).catch((e) => toast(e.message, true));
    return showList();
  },
  close() {},
};
