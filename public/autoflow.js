// 이미지 광고 자동화 (#auto) — 서버 lib/autoflow.js · /api/autoflows
//   목록: 자동화 카드 (켜기·끄기 · 지금 돌리기 · 고치기 · 지우기 · 최근 결과)
//   편집: 경쟁사(광고 수집에 등록한 브랜드) · 고객사(리소스 폴더)와 쓸 재료 · 이미지 비율(여러 개)·모델·해상도·품질 · 몇 장(경쟁사마다 가져올 새 광고 · 변형할 광고 · 비율 수 = 최대 장수) · 일정(요일·시각)
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

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const RES = [["product", "제품"], ["person", "인물"], ["background", "배경"]];
const PLAT = { meta: "메타", youtube: "유튜브", instagram: "인스타" };
const st = { list: [], brands: [], clients: [], res: [], models: [], plans: [], draft: null, bound: false, cmp: {}, tab: "list", pf: "pending", hpage: {}, ppage: 0 };
// 만든 광고 이력 — 5개씩 쪽 나누기 · 자동화마다 접어 두기 (접힘은 이 브라우저에 기억)
const PER = 5;
const FOLD_KEY = "af.folded";
const folds = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]")); } catch { return new Set(); } };
const isFolded = (id) => folds().has(id);
function toggleFold(id) { const f = folds(); f.has(id) ? f.delete(id) : f.add(id); try { localStorage.setItem(FOLD_KEY, JSON.stringify([...f])); } catch {} }
// 쪽 버튼 — key: "h|<자동화 ID>"(이력) · "p"(기획 승인)
function pager(total, pg, key) {
  const n = Math.ceil(total / PER); if (n <= 1) return "";
  const btn = (i, l = i + 1, dis = false) => `<button type="button" class="af-pg__b ${i === pg ? "is-on" : ""}" data-pg="${key}|${i}" ${dis ? "disabled" : ""} ${i === pg ? 'aria-current="page"' : ""}>${l}</button>`;
  return `<nav class="af-pg" aria-label="쪽">${btn(pg - 1, "‹", pg === 0)}${Array.from({ length: n }, (_, i) => btn(i)).join("")}${btn(pg + 1, "›", pg === n - 1)}<span class="muted small">${pg * PER + 1}–${Math.min(total, pg * PER + PER)} / ${total}</span></nav>`;
}
const modelOf = (id) => st.models.find((m) => m.id === id) || st.models[0];
const imgUrl = (x, f) => `/data/${encodeURIComponent(x.folder)}/${x.dir}/${f.split("/").map(encodeURIComponent).join("/")}`;
const when = (iso) => iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const schedText = (s) => !s?.days?.length ? "요일 없음" : `${s.days.length === 7 ? "매일" : s.days.join() === "1,2,3,4,5" ? "평일" : s.days.map((d) => DAYS[d]).join("·")} ${s.time}`;
const clientName = (id) => (id ? st.clients.find((c) => c.id === id)?.name || "(지운 폴더)" : "일반 (고객사 없음)");
// 예전 저장본은 aspect 하나 — 서버 lib/autoflow.js aspectsOf 와 같은 규칙
const aspectsOf = (af) => { const a = Array.isArray(af.aspects) && af.aspects.length ? af.aspects : af.aspect ? [af.aspect] : ["1:1"]; return [...new Set(a)]; };
const maxImages = (af) => af.maxMake * aspectsOf(af).length;
const brandName = (id) => st.brands.find((b) => b.id === id)?.name || "(지운 경쟁사)";

// ── 목록 ──
function renderList() {
  $("#afList").innerHTML = st.list.map((af) => {
    const last = af.runs?.[0];
    // 원본과 결과를 광고 하나씩 나란히 — 최근 6개
    const fromPlans = st.plans.filter((p) => p.afId === af.id && p.status === "made" && p.made?.files?.length).map((p) => ({ brandName: p.brandName, folder: p.folder, dir: p.dir, image: p.image, title: p.plan.concept, files: p.made.files, aspects: p.made.aspects, at: p.made.at, plan: p.id }));
    const seen = new Set(fromPlans.map((x) => x.plan));
    const made = [...fromPlans, ...(af.runs || []).flatMap((r) => (r.made || []).map((x) => ({ ...x, at: r.at }))).filter((x) => x.files?.length && !seen.has(x.plan))].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const pg = Math.min(st.hpage[af.id] || 0, Math.max(0, Math.ceil(made.length / PER) - 1)), shown = made.slice(pg * PER, pg * PER + PER), folded = isFolded(af.id);
    const waiting = st.plans.filter((p) => p.afId === af.id && p.status === "pending").length;
    made.forEach((x, i) => (st.cmp[`${af.id}:${i}`] = x));
    return `<article class="af-card ${af.enabled ? "is-on" : ""}">
      <div class="af-card__head">
        <label class="af-switch" title="켜 두면 일정에 돕니다"><input type="checkbox" data-toggle="${af.id}" ${af.enabled ? "checked" : ""}><span></span></label>
        <div class="af-card__t"><strong>${esc(af.name)}</strong>
          <span class="muted small">${af.enabled ? `${schedText(af.schedule)} · 다음 ${when(af.next)}` : "꺼짐 — 일정에 돌지 않음"}</span></div>
        <div class="af-card__acts">
          <button class="btn btn--sm" type="button" data-run="${af.id}" ${af.running ? "disabled" : ""}>${af.running ? "도는 중…" : "지금 돌리기"}</button>
          <button class="btn btn--ghost btn--sm" type="button" data-pick="${af.id}" title="이미 모은 경쟁사 광고에서 골라 기획안 만들기">수집한 광고에서 고르기</button>
          <button class="btn btn--ghost btn--sm" type="button" data-edit="${af.id}">고치기</button>
          <button class="btn btn--ghost btn--sm" type="button" data-del="${af.id}">지우기</button>
        </div>
      </div>
      <dl class="af-card__meta">
        <div><dt>경쟁사</dt><dd>${af.brands.map((b) => esc(brandName(b))).join(", ") || "없음"}</dd></div>
        <div><dt>고객사</dt><dd>${esc(clientName(af.client))}</dd></div>
        <div><dt>규칙</dt><dd>${af.rules?.length ? `${af.rules.length}개${bannedOf(af.rules).length ? ` · 금지어 ${bannedOf(af.rules).map(esc).join(", ")}` : ""}` : "없음"}</dd></div>
        <div><dt>타깃</dt><dd>${af.targets?.length ? af.targets.map((t) => esc(t.length > 24 ? t.slice(0, 24) + "…" : t)).join(" · ") : "페르소나의 타깃 고객"}</dd></div>
        <div><dt>이미지</dt><dd>${aspectsOf(af).map(esc).join(" · ")} · ${esc(modelOf(af.model)?.name || af.model)}${af.resolution ? ` · ${esc(af.resolution)}` : ""}${af.quality ? ` · ${esc(af.quality)}` : ""}</dd></div>
        <div><dt>몇 장</dt><dd>경쟁사마다 새 광고 ${af.perBrand}개까지 가져와 ${af.maxMake}개까지 변형 × 비율 ${aspectsOf(af).length}개 = 한 번에 최대 ${maxImages(af)}장</dd></div>
      </dl>
      ${waiting ? `<p class="af-card__wait"><button type="button" class="btn btn--primary btn--sm" data-gotab="plans">기획 승인 대기 ${waiting}개 →</button></p>` : ""}
      ${last ? `<p class="af-card__last small">최근 ${when(last.at)} (${last.trigger === "schedule" ? "일정" : "직접"}) — 새 광고 ${last.collected}개${last.planned ? ` · 기획안 ${last.planned.length}개` : ""} · 변형 ${last.made.length}개 · 이미지 ${last.made.reduce((n, x) => n + (x.files?.length || 0), 0)}장${last.skipped ? ` · 상한으로 건너뜀 ${last.skipped}` : ""}${last.errors.length ? ` · <span class="af-err">오류 ${last.errors.length}</span>` : ""}</p>
        ${last.errors.length ? `<details class="af-errs small"><summary>오류 보기</summary><ul>${last.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}` : `<p class="af-card__last small muted">아직 돈 적이 없습니다.</p>`}
      ${made.length ? `<section class="af-hist">
        <button type="button" class="af-hist__head" data-fold="${af.id}" aria-expanded="${!folded}"><span class="af-hist__caret" aria-hidden="true">${folded ? "▸" : "▾"}</span><strong>만든 광고</strong> <span class="muted small">${made.length}개 · 원본 ↔ 결과</span><span class="af-hist__sp"></span><span class="muted small">${folded ? "펼치기" : "접기"}</span></button>
        ${folded ? "" : `<div class="af-cmps">${shown.map((x, i) => cmpRow(x, `${af.id}:${pg * PER + i}`)).join("")}</div>${pager(made.length, pg, `h|${af.id}`)}`}
      </section>` : ""}
    </article>`;
  }).join("") || `<div class="af-empty"><p>아직 자동화가 없습니다.</p><p class="muted small">먼저 <a href="#collect">광고 수집</a>에서 경쟁사를 등록하고, <a href="#res">리소스</a>에 고객사 폴더와 제품·페르소나를 넣어 두세요.</p></div>`;
}

// 원본 ↔ 결과 비교 한 줄 (누르면 크게)
const figs = (x) => [{ src: imgUrl(x, x.image), label: `원본 · ${x.brandName}`, orig: true }, ...x.files.map((f, i) => ({ src: imgUrl(x, f), label: x.aspects?.[i] || "결과" }))];
function cmpRow(x, key) {
  return `<button type="button" class="af-cmp" data-cmp="${esc(key)}" title="크게 비교하기">
    <span class="af-cmp__t"><strong>${esc(x.title || "변형")}</strong><span class="muted small">${esc(x.brandName)} · ${when(x.at)}</span></span>
    <span class="af-cmp__imgs">${figs(x).map((g) => `<figure class="${g.orig ? "is-orig" : ""}"><img src="${g.src}" alt="${esc(g.label)}" loading="lazy"><figcaption>${esc(g.label)}</figcaption></figure>`).join("")}</span></button>`;
}
function openCmp(key) {
  const x = st.cmp[key]; if (!x) return;
  const d = $("#afCmp");
  d.querySelector("[data-t]").textContent = `${x.brandName} → ${x.title || "변형"}`;
  d.querySelector("[data-body]").innerHTML = figs(x).map((g) => `<figure class="${g.orig ? "is-orig" : ""}"><a href="${g.src}" target="_blank" rel="noopener"><img src="${g.src}" alt="${esc(g.label)}"></a><figcaption>${esc(g.label)}</figcaption></figure>`).join("");
  d.showModal();
}

// ── 수집한 광고에서 고르기 — 이 자동화의 경쟁사가 모아 둔 이미지 광고. 고른 것만 기획안을 만든다 (이미지 크레딧 없음) ──
const PICK_PER = 20, PICK_MAX = 10;
const pk = { af: null, ads: [], sel: new Set(), page: 0, filter: "fresh", brand: "" };
async function openPick(id) {
  pk.af = st.list.find((x) => x.id === id); pk.sel = new Set(); pk.page = 0; pk.filter = "fresh"; pk.brand = "";
  const d = $("#afPick"); d.querySelector("[data-t]").textContent = `수집한 광고에서 고르기 · ${pk.af.name}`;
  d.querySelector("[data-body]").innerHTML = `<p class="muted">불러오는 중…</p>`; d.showModal();
  try { pk.ads = await api(`/api/autoflows/${id}/ads`); renderPick(); } catch (e) { toast(e.message, true); }
}
function renderPick() {
  const d = $("#afPick"), list = pk.ads.filter((a) => (pk.filter === "all" || !a.plan) && (!pk.brand || a.brandId === pk.brand));
  const n = Math.ceil(list.length / PICK_PER), pg = Math.min(pk.page, Math.max(0, n - 1)); pk.page = pg;
  const brands = [...new Map(pk.ads.map((a) => [a.brandId, a.brandName])).entries()];
  const ST = { pending: "기획 대기", approved: "만들 차례", making: "만드는 중", made: "만든 것", error: "오류", dropped: "버림" };
  d.querySelector("[data-body]").innerHTML = `
    <div class="ap-bar">
      <div class="seg seg--sm">${[["fresh", `기획 안 한 것 ${pk.ads.filter((a) => !a.plan).length}`], ["all", `전체 ${pk.ads.length}`]].map(([k, l]) => `<button type="button" class="seg__btn ${pk.filter === k ? "is-on" : ""}" data-pkf="${k}">${l}</button>`).join("")}</div>
      <select data-pkb aria-label="경쟁사"><option value="">경쟁사 전체</option>${brands.map(([id, nm]) => `<option value="${id}" ${pk.brand === id ? "selected" : ""}>${esc(nm)}</option>`).join("")}</select>
    </div>
    <div class="pk-grid">${list.slice(pg * PICK_PER, pg * PICK_PER + PICK_PER).map((a) => { const key = `${a.brandId}|${a.dir}`, on = pk.sel.has(key); return `<label class="pk-ad ${on ? "is-on" : ""}">
      <input type="checkbox" data-pka="${esc(key)}" ${on ? "checked" : ""}>
      <img src="${imgUrl(a, a.image)}" alt="" loading="lazy">
      <span class="pk-ad__m"><b>${esc(a.brandName)}</b>${a.plan ? ` · <em>${ST[a.plan.status] || a.plan.status}</em>` : ""}<br><span class="muted">${a.collected_at ? when(a.collected_at) : ""}</span></span></label>`; }).join("") || `<p class="muted">${pk.filter === "fresh" ? "기획 안 한 광고가 없습니다 — [전체]에서 다시 기획할 광고를 고를 수 있습니다." : "모아 둔 이미지 광고가 없습니다."}</p>`}</div>
    ${n > 1 ? `<nav class="af-pg">${Array.from({ length: n }, (_, i) => `<button type="button" class="af-pg__b ${i === pg ? "is-on" : ""}" data-pkp="${i}">${i + 1}</button>`).join("")}</nav>` : ""}
    <div class="ap-acts"><span class="muted small">${pk.sel.size}개 고름 (한 번에 ${PICK_MAX}개까지) · 기획안만 만듭니다 (Claude, 1개에 1분 안팎 · 이미지 크레딧 없음)</span><span class="ap-acts__sp"></span>
      <button type="button" class="btn btn--ghost btn--sm" data-close>닫기</button><button type="button" class="btn btn--primary btn--sm" data-pkgo ${pk.sel.size ? "" : "disabled"}>기획안 만들기 ${pk.sel.size ? `(${pk.sel.size}개)` : ""}</button></div>`;
}
function bindPick() {
  const d = $("#afPick");
  d.addEventListener("click", async (e) => {
    if (e.target === d || e.target.closest("[data-close]")) return d.close();
    const f = e.target.closest("[data-pkf]"); if (f) { pk.filter = f.dataset.pkf; pk.page = 0; return renderPick(); }
    const pg = e.target.closest("[data-pkp]"); if (pg) { pk.page = Number(pg.dataset.pkp); return renderPick(); }
    if (e.target.closest("[data-pkgo]")) {
      const ads = [...pk.sel].map((k) => { const [brandId, dir] = k.split("|"); return { brandId, dir }; });
      try { await api(`/api/autoflows/${pk.af.id}/plan`, { method: "POST", body: { ads } }); d.close(); toast(`기획안 ${ads.length}개를 만드는 중입니다 — 끝나면 기획 승인에 쌓입니다`); await load(); }
      catch (e2) { toast(e2.message, true); }
    }
  });
  d.addEventListener("change", (e) => {
    const b = e.target.closest("[data-pkb]"); if (b) { pk.brand = b.value; pk.page = 0; return renderPick(); }
    const a = e.target.closest("[data-pka]"); if (!a) return;
    if (a.checked && pk.sel.size >= PICK_MAX) { a.checked = false; return toast(`한 번에 ${PICK_MAX}개까지 고를 수 있습니다`, true); }
    a.checked ? pk.sel.add(a.dataset.pka) : pk.sel.delete(a.dataset.pka); renderPick();
  });
}

// ── 기획 승인 ──
const PF = [["pending", "승인 대기"], ["approved", "만들 차례·만드는 중"], ["made", "만든 것"], ["other", "버림·오류"]];
const pfOf = (p) => (p.status === "pending" ? "pending" : p.status === "approved" || p.status === "making" ? "approved" : p.status === "made" ? "made" : "other");
const ST_LABEL = { pending: "승인 대기", approved: "만들 차례", making: "만드는 중", made: "만든 것", error: "오류", dropped: "버림" };
const COPY_ROLES = ["타깃 호명", "제목", "부제", "배지", "라벨", "가격·혜택", "행동 유도", "브랜드", "기타"];
const RK = [["product", "제품"], ["person", "인물"], ["background", "배경"]];
const resThumb = (id) => { const r = st.res.find((x) => x.id === id), f = r?.files?.find((x) => x.kind === "image"); return f ? `/data/_resources/${r.kind}/${r.id}/${encodeURIComponent(f.file)}` : ""; };
function setTab(t) {
  st.tab = t;
  document.querySelectorAll("#afTabs [data-tab]").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === t));
  if (t === "plans" && st.draft) closeEdit();
  $("#afList").hidden = t !== "list"; $("#afNew").hidden = t !== "list"; $("#afPlans").hidden = t !== "plans";
  if (t === "plans") renderPlans(); else renderList();
}
// 규칙의 금지어 — 서버 lib/autoflow.js bannedOf 와 같은 규칙
function bannedOf(rules = []) {
  const out = new Set();
  for (const r of rules) {
    if (!/(쓰지|금지|사용하지|넣지|말 것|않는다|안 ?한다|안 ?쓴다|빼)/.test(r)) continue;
    for (const m of r.matchAll(/["'“”‘’「」『』]([^"'“”‘’「」『』]{1,30})["'“”‘’「」『』]/g)) out.add(m[1].trim());
    for (const m of r.matchAll(/([가-힣A-Za-z0-9·]{2,20})(?:이)?라는 ?(?:키워드|단어|표현|말)/g)) out.add(m[1].trim());
  }
  return [...out].filter(Boolean);
}
const ruleHits = (plan, rules) => { const t = [plan.concept, plan.visual, ...(plan.copy || []).map((c) => c.text), ...(plan.changes || []).map((c) => c.to)].join("\n"); return bannedOf(rules).filter((w) => t.includes(w)); };
const OPS = ["좌우 반전", "위아래 바꾸기", "주인공 크게", "분할 구도", "박스 모양 바꾸기", "배경 바꾸기", "어두운 바탕", "대각선 구도"];
const MODES = [["remix", "요소별 바꾸기 — 원본 요소를 하나씩 (추천)"], ["inspire", "참고만 — 새 구성으로"], ["follow", "구조 따르기 — 배치 그대로"]];
const CH_ACTIONS = ["유지", "바꾸기", "빼기", "더하기"];
const chRow = (c = {}) => `<div class="ap-ch" data-ch>
    <input data-chel value="${esc(c.el || "")}" placeholder="원본 요소 (예: 왼쪽 인물)" aria-label="원본 요소">
    <select data-chact aria-label="처리">${CH_ACTIONS.map((a) => `<option ${(c.action || "바꾸기") === a ? "selected" : ""}>${a}</option>`).join("")}</select>
    <input data-chto value="${esc(c.to || "")}" placeholder="무엇으로 (바꾸기·더하기)" aria-label="무엇으로">
    <button type="button" class="btn btn--ghost btn--sm" data-chdel aria-label="이 줄 빼기">빼기</button></div>`;
const copyRow = (c = {}) => `<div class="ap-copy" data-copy>
    <select data-crole aria-label="역할">${COPY_ROLES.map((r) => `<option ${c.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>
    <input data-ctext value="${esc(c.text || "")}" placeholder="새 문구" aria-label="새 문구">
    <span class="ap-copy__src muted small" data-csrc="${esc(c.source || "")}">${c.source ? `참고한 원본: ${esc(c.source)}` : "새 문구"}</span>
    <button type="button" class="btn btn--ghost btn--sm" data-cdel aria-label="이 문구 빼기">빼기</button></div>`;
function planCard(p) {
  const af = st.list.find((x) => x.id === p.afId), m = modelOf(af?.model), edit = ["pending", "error", "made"].includes(p.status);
  const ro = edit ? "" : "disabled", x = { folder: p.folder, dir: p.dir }, hits = ruleHits(p.plan, af?.rules || []);
  const resSel = ([k, l]) => {
    const pool = p.pool?.[k] || [], cur = p.plan.resources?.[k] || "", th = resThumb(cur);
    return `<label class="field ap-res"><span>${l}</span><span class="ap-res__row">${th ? `<img src="${th}" alt="">` : `<i class="ap-res__none">—</i>`}<select data-res="${k}" ${ro}>
      <option value="">${k === "logo" ? "안 넣음 — 이름을 글자로" : "안 씀"}</option>${pool.map((r) => `<option value="${r.id}" ${cur === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></span></label>`;
  };
  const results = p.made?.files?.length ? `<div class="ap-made">${p.made.files.map((f, i) => `<a href="${imgUrl(x, f)}" target="_blank" rel="noopener"><img src="${imgUrl(x, f)}" alt="" loading="lazy"><em>${esc(p.made.aspects?.[i] || "")}</em></a>`).join("")}</div>` : "";
  return `<article class="ap-card is-${p.status}" data-plan="${p.id}">
    <div class="ap-orig">
      <a href="${imgUrl(x, p.image)}" target="_blank" rel="noopener"><img src="${imgUrl(x, p.image)}" alt="원본 광고" loading="lazy"></a>
      <p class="small"><strong>원본 · ${esc(p.brandName)}</strong><br><span class="muted">${when(p.created_at)} · ${esc(p.afName || "")}</span></p>
      <span class="ap-st">${ST_LABEL[p.status] || p.status}</span>
      ${results ? `<p class="small"><strong>결과</strong></p>${results}` : ""}
    </div>
    <div class="ap-body">
      <label class="field"><span>기획</span><input data-f="concept" value="${esc(p.plan.concept)}" ${ro}></label>
      <div class="af-row">
        <label class="field"><span>타깃</span><input data-f="target" list="apT-${p.id}" value="${esc(p.plan.target || "")}" placeholder="예: 약정 끝나 가는 30~40대 맞벌이 부부" ${ro}>
          <datalist id="apT-${p.id}">${(af?.targets || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label>
        <label class="field"><span>소구점</span><input data-f="angle" value="${esc(p.plan.angle)}" ${ro}></label>
      </div>
      <label class="check"><input type="checkbox" data-callt ${p.plan.callTarget ? "checked" : ""} ${ro}> 카피에 타깃 명시 <span class="muted small">— "타깃 호명" 문구를 눈에 띄게 넣습니다 (예: 보험·상조 영업하는 분들께)</span></label>
      ${p.plan.callTarget && !p.plan.copy.some((c) => c.role === "타깃 호명" && c.text) ? `<p class="ap-warn small">⚠ 타깃 명시를 켰는데 카피에 "타깃 호명" 문구가 없습니다 — [＋ 문구 더하기]로 넣으세요</p>` : ""}
      ${p.plan.why ? `<p class="muted small ap-why">왜: ${esc(p.plan.why)}</p>` : ""}
      <div class="af-row">
        <label class="field"><span>원본을 얼마나 따를까</span><select data-f="mode" ${ro}>
          ${MODES.map(([k, l]) => `<option value="${k}" ${(p.plan.mode || "remix") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          ${edit ? `<span class="muted small">바꾼 뒤 [다시 기획…]을 누르면 그 방식으로 글을 다시 짭니다</span>` : ""}</label>
        <label class="field"><span>원본에서 빌린 것</span><input data-f="borrow" value="${esc(p.plan.borrow || "")}" placeholder="예: 비교형 · 문제 → 해결 순서" ${ro}></label>
      </div>
      <div class="field"><span>요소별 바꾸기 <span class="muted small">원본 요소마다 유지·바꾸기·빼기 — 더하기는 새로 넣을 비주얼 (예: 체크리스트 메모, 카톡 말풍선, 2컷 비교)</span></span>
        <div class="ap-chs" data-chs>${(p.plan.changes || []).map(chRow).join("") || `<p class="muted small" data-chempty>요소별 바꾸기가 없습니다${p.plan.mode === "inspire" ? " — 새 구성 방식은 원본 요소를 쓰지 않습니다" : ""}.</p>`}</div>
        ${edit ? `<button type="button" class="btn btn--ghost btn--sm" data-chadd>＋ 요소 더하기</button>` : ""}</div>
      <div class="field"><span>레이아웃 변주 <span class="muted small">원본 배치를 이렇게 비틉니다 — 여러 개 조합 가능</span></span>
        <div class="af-chips">${OPS.map((o) => `<label class="af-chip ${(p.plan.ops || []).includes(o) ? "is-on" : ""}"><input type="checkbox" data-op="${esc(o)}" ${(p.plan.ops || []).includes(o) ? "checked" : ""} ${ro}>${esc(o)}</label>`).join("")}</div></div>
      <label class="field"><span>배치 <span class="muted small">요소별 바꾸기는 바뀌는 점만 · 새 구성은 헤드라인·제품·버튼을 어디에</span></span><textarea data-f="layout" rows="3" ${ro}>${esc(p.plan.layout || "")}</textarea></label>
      <label class="field"><span>장면 연출</span><textarea data-f="visual" rows="3" ${ro}>${esc(p.plan.visual)}</textarea></label>
      <div class="field"><span>카피 <span class="muted small">이 문구가 글자 그대로 들어갑니다 · 3~6개 권장</span></span>
        <div class="ap-copies" data-copies>${p.plan.copy.map(copyRow).join("")}</div>
        ${edit ? `<button type="button" class="btn btn--ghost btn--sm" data-cadd>＋ 문구 더하기</button>` : ""}</div>
      <div class="field"><span>쓸 리소스 <span class="muted small">안 씀이면 넣지 않습니다 (원본에 없는 사람은 새로 넣지 않음)</span></span>
        <div class="af-row ap-ress">${[["logo", "로고"], ...RK].map(resSel).join("")}</div>
        ${!(p.pool?.logo || []).length ? `<p class="muted small">이 고객사 폴더에 로고가 없습니다 — <a href="#res">리소스</a>의 고객사 에셋으로 로고 이미지를 올리면 고를 수 있습니다.</p>` : ""}
        ${p.plan.resource_reason ? `<p class="muted small">왜: ${esc(p.plan.resource_reason)}</p>` : ""}
        ${edit ? `<p class="muted small">여기서 리소스를 바꾸면 만들 때 위 기획 글보다 우선합니다 (넣은 것은 꼭 화면에, 뺀 것은 넣지 않음). 글까지 맞추려면 [다시 기획…].</p>` : ""}</div>
      <div class="field"><span>비율</span><div class="af-chips">${(m?.aspects || p.aspects).map((a) => `<label class="af-chip ${p.aspects.includes(a) ? "is-on" : ""}"><input type="checkbox" data-pasp="${esc(a)}" ${p.aspects.includes(a) ? "checked" : ""} ${ro}>${esc(a)}</label>`).join("")}</div></div>
      <label class="field"><span>덧붙일 지시 (선택)</span><textarea data-f="note" rows="2" placeholder="예: 정수기를 더 크게, 배경은 밝은 주방" ${ro}>${esc(p.note || "")}</textarea></label>
      ${hits.length ? `<p class="ap-warn small">⚠ 규칙의 금지어가 들어 있습니다: <b>${hits.map(esc).join(", ")}</b> — 카피·장면에서 고치거나 [다시 기획…]</p>` : ""}
      ${p.error ? `<p class="af-err small">오류: ${esc(p.error)}</p>` : ""}
      ${edit ? `<div class="ap-acts">
        <button type="button" class="btn btn--ghost btn--sm" data-pact="drop">버리기</button>
        <button type="button" class="btn btn--ghost btn--sm" data-pact="replan">다시 기획…</button>
        <span class="ap-acts__sp"></span>
        <button type="button" class="btn btn--sm" data-pact="save">저장</button>
        <button type="button" class="btn btn--primary btn--sm" data-pact="approve">${p.status === "made" ? "다시 만들기" : "승인하고 만들기"} (${p.aspects.length}장)</button></div>`
        : p.status === "dropped" ? `<div class="ap-acts"><button type="button" class="btn btn--ghost btn--sm" data-pact="restore">대기로 되돌리기</button></div>` : `<p class="muted small">${p.status === "making" ? "만드는 중입니다…" : "차례를 기다리는 중입니다 — 다른 작업이 끝나면 만듭니다"}</p>`}
    </div></article>`;
}
function renderPlans() {
  const cnt = (k) => st.plans.filter((p) => pfOf(p) === k).length;
  $("#apFilter").innerHTML = PF.map(([k, l]) => `<button type="button" class="seg__btn ${st.pf === k ? "is-on" : ""}" data-pf="${k}">${l} <span data-n>${cnt(k)}</span></button>`).join("");
  $("#apAll").hidden = st.pf !== "pending" || !cnt("pending");
  const list = st.plans.filter((p) => pfOf(p) === st.pf);
  const pg = Math.min(st.ppage, Math.max(0, Math.ceil(list.length / PER) - 1)); st.ppage = pg;
  $("#apList").innerHTML = list.slice(pg * PER, pg * PER + PER).map(planCard).join("") + pager(list.length, pg, "p") || `<p class="af-empty muted">${st.pf === "pending" ? "승인을 기다리는 기획안이 없습니다. 자동화가 돌면 광고마다 기획안이 여기에 쌓입니다." : "없습니다."}</p>`;
}
function readPlanCard(el) {
  const f = (k) => el.querySelector(`[data-f="${k}"]`)?.value ?? "";
  return {
    plan: {
      concept: f("concept"), angle: f("angle"), visual: f("visual"), mode: f("mode") || "remix", borrow: f("borrow"), layout: f("layout"), target: f("target"),
      ops: [...el.querySelectorAll("[data-op]:checked")].map((x) => x.dataset.op),
      callTarget: !!el.querySelector("[data-callt]")?.checked,
      changes: [...el.querySelectorAll("[data-ch]")].map((r) => ({ el: r.querySelector("[data-chel]").value.trim(), action: r.querySelector("[data-chact]").value, to: r.querySelector("[data-chto]").value.trim() })).filter((c) => c.el || c.to),
      copy: [...el.querySelectorAll("[data-copy]")].map((r) => ({ role: r.querySelector("[data-crole]").value, text: r.querySelector("[data-ctext]").value.trim(), source: r.querySelector("[data-csrc]").dataset.csrc })).filter((c) => c.text),
      resources: Object.fromEntries([...el.querySelectorAll("[data-res]")].map((x) => [x.dataset.res, x.value])),
    },
    aspects: [...el.querySelectorAll("[data-pasp]:checked")].map((x) => x.dataset.pasp),
    note: f("note"),
  };
}
async function planAct(el, act) {
  const id = el.dataset.plan, body = readPlanCard(el);
  try {
    if (act === "save") { await api(`/api/autoplans/${id}`, { method: "PUT", body }); toast("기획을 저장했습니다"); }
    if (act === "approve") {
      if (!body.aspects.length) return toast("비율을 하나 이상 고르세요", true);
      const af = st.list.find((x) => x.id === st.plans.find((q) => q.id === id)?.afId), bad = ruleHits(body.plan, af?.rules || []);
      if (bad.length && !confirm(`규칙의 금지어가 들어 있습니다: ${bad.join(", ")}\n그래도 만들까요?`)) return;
      if (!confirm(`이 기획으로 만들까요?\n비율 ${body.aspects.join("·")} — 이미지 ${body.aspects.length}장 (힉스필드 크레딧이 듭니다)`)) return;
      const r = await api(`/api/autoplans/${id}`, { method: "PUT", body: { ...body, status: "approved" } });
      toast(r.started ? "만들기 시작했습니다 — 진행은 오른쪽 아래 작업 알림에서" : "승인했습니다 — 지금 도는 작업이 끝나면 만듭니다");
    }
    if (act === "drop") { if (!confirm("이 기획안을 버릴까요? (버림·오류에서 되돌릴 수 있습니다)")) return; await api(`/api/autoplans/${id}`, { method: "PUT", body: { status: "dropped" } }); toast("버렸습니다"); }
    if (act === "restore") { await api(`/api/autoplans/${id}`, { method: "PUT", body: { status: "pending" } }); toast("승인 대기로 되돌렸습니다"); }
    if (act === "replan") {
      const hint = prompt("어떤 방향으로 다시 짤까요? (비워 두면 다른 각도로 새로 짭니다)\n예: 비데 위생 이야기로, 인물 없이, 혜택 강조", "");
      if (hint === null) return;
      await api(`/api/autoplans/${id}`, { method: "PUT", body }); // 고친 것을 먼저 남긴다
      await api(`/api/autoplans/${id}/replan`, { method: "POST", body: { hint } });
      toast("다시 기획하는 중입니다 (1분 안팎)");
    }
    await load();
  } catch (e) { toast(e.message, true); }
}
function bindPlans() {
  $("#apFilter").addEventListener("click", (e) => { const b = e.target.closest("[data-pf]"); if (b) { st.pf = b.dataset.pf; st.ppage = 0; renderPlans(); } });
  $("#apAll").addEventListener("click", async () => {
    const ids = st.plans.filter((p) => p.status === "pending").map((p) => p.id);
    const n = st.plans.filter((p) => p.status === "pending").reduce((a, p) => a + p.aspects.length, 0);
    if (!ids.length || !confirm(`대기 중 기획 ${ids.length}개를 고친 그대로 승인할까요?\n이미지 ${n}장 (힉스필드 크레딧) — 저장 안 한 수정은 빠집니다`)) return;
    try { const r = await api("/api/autoplans/approve", { method: "POST", body: { ids } }); toast(`${r.approved}개 승인 — ${r.started ? "만들기 시작" : "지금 작업이 끝나면 만듭니다"}`); await load(); } catch (e) { toast(e.message, true); }
  });
  $("#apList").addEventListener("click", (e) => {
    const pgb = e.target.closest("[data-pg]"); if (pgb) { st.ppage = Number(pgb.dataset.pg.split("|")[1]); renderPlans(); return $("#afPlans").scrollIntoView({ block: "start" }); }
    const card = e.target.closest("[data-plan]"); if (!card) return;
    const a = e.target.closest("[data-pact]"); if (a) return planAct(card, a.dataset.pact);
    if (e.target.closest("[data-chadd]")) { const box = card.querySelector("[data-chs]"); box.querySelector("[data-chempty]")?.remove(); box.insertAdjacentHTML("beforeend", chRow({ action: "바꾸기" })); return; }
    const chd = e.target.closest("[data-chdel]"); if (chd) { chd.closest("[data-ch]").remove(); return; }
    if (e.target.closest("[data-cadd]")) { const cl = card.querySelector("[data-callt]")?.checked && ![...card.querySelectorAll("[data-crole]")].some((x) => x.value === "타깃 호명"); card.querySelector("[data-copies]").insertAdjacentHTML("beforeend", copyRow({ role: cl ? "타깃 호명" : "라벨" })); return; }
    const del = e.target.closest("[data-cdel]"); if (del) del.closest("[data-copy]").remove();
  });
  $("#apList").addEventListener("change", (e) => {
    const r = e.target.closest("[data-res]");
    if (r) { const img = r.parentElement.querySelector("img, .ap-res__none"), th = resThumb(r.value); img.outerHTML = th ? `<img src="${th}" alt="">` : `<i class="ap-res__none">—</i>`; }
    const a = e.target.closest("[data-pasp], [data-op]"); if (a) a.closest(".af-chip").classList.toggle("is-on", a.checked);
  });
}

// ── 편집 ──
const blank = () => ({ name: "", enabled: true, brands: [], client: "", resources: { product: "auto", person: "auto", background: "" }, persona: "auto", colors: "auto", docs: [], links: [], approval: true, targets: [], planMode: "remix", rules: [], callTarget: "auto", aspects: ["1:1"], model: "gpt_image_2_5", resolution: "", quality: "", perBrand: 3, maxMake: 3, note: "", schedule: { days: [1, 2, 3, 4, 5], time: "09:00" } });
function renderEdit() {
  const d = st.draft, m = modelOf(d.model);
  d.aspects = aspectsOf(d).filter((a) => !m || m.aspects.includes(a)); delete d.aspect;
  if (!d.aspects.length && m) d.aspects = [m.aspects.includes("1:1") ? "1:1" : m.aspects[0]];
  if (m?.res && !m.res.options.includes(d.resolution)) d.resolution = m.res.def;
  if (m?.quality && !m.quality.options.includes(d.quality)) d.quality = m.quality.def;
  if (!m?.res) d.resolution = ""; if (!m?.quality) d.quality = "";
  const mine = st.res.filter((r) => (d.client ? r.client === d.client : !r.client));
  const resSel = (k, l) => {
    const opts = mine.filter((r) => r.kind === k && r.files?.some((f) => f.kind === "image") && r.status !== "draft");
    return `<label class="field"><span>${l}</span><select data-res="${k}">
      <option value="auto" ${d.resources[k] === "auto" ? "selected" : ""}>자동 — 폴더의 첫 ${l}${opts[0] ? ` (${esc(opts[0].name)})` : " (없음)"}</option>
      <option value="" ${!d.resources[k] ? "selected" : ""}>안 씀 — 원본 그대로</option>
      ${opts.map((r) => `<option value="${r.id}" ${d.resources[k] === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>`;
  };
  const personas = mine.filter((r) => r.kind === "target");
  const docs = mine.filter((r) => (r.kind === "doc" || r.kind === "asset") && r.files?.some((f) => /\.(md|txt)$/i.test(f.file)));
  d.docs = (d.docs || []).filter((id) => docs.some((r) => r.id === id));
  const palettes = mine.filter((r) => r.kind === "color" && r.colors?.length), d_colors = d.colors ?? "auto";
  const chips = (r) => r ? ` ${r.colors.map((c) => c.hex).join(" ")}` : "";
  const imgBrands = st.brands.filter((b) => b.platform !== "manual");
  $("#afEdit").innerHTML = `
    <div class="af-edit__head"><h3>${d.id ? "자동화 고치기" : "새 자동화"}</h3><button class="btn btn--ghost btn--sm" type="button" data-close>닫기</button></div>
    <label class="field"><span>이름</span><input id="afName" value="${esc(d.name)}" placeholder="예: 햇살대리점 — 정수기 경쟁사 아침 자동화"></label>

    <section class="af-sec"><h4>1. 경쟁사 <span class="muted small">광고 수집에 등록한 브랜드 · 이미지 광고는 메타가 가장 잘 모입니다</span></h4>
      <div class="af-chips">${imgBrands.map((b) => `<label class="af-chip ${d.brands.includes(b.id) ? "is-on" : ""}"><input type="checkbox" data-brand="${esc(b.id)}" ${d.brands.includes(b.id) ? "checked" : ""}>${esc(b.name)} <span class="muted small">${PLAT[b.platform] || b.platform}</span></label>`).join("") || `<p class="small">등록한 경쟁사가 없습니다 — <a href="#collect">광고 수집</a>에서 먼저 등록하세요.</p>`}</div>
    </section>

    <section class="af-sec"><h4>2. 고객사 <span class="muted small">리소스의 고객사 폴더 — 이 재료로 바꿔 만듭니다</span></h4>
      <div class="af-row">
        <label class="field"><span>고객사 폴더</span><select id="afClient"><option value="">일반 (고객사 없음)</option>${st.clients.map((c) => `<option value="${c.id}" ${d.client === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label class="field"><span>페르소나 (사업체 소개·소구점·말투)</span><select id="afPersona">
          <option value="auto" ${d.persona === "auto" ? "selected" : ""}>자동 — 폴더의 페르소나${personas[0] ? ` (${esc(personas[0].name)})` : " (없음)"}</option>
          <option value="" ${!d.persona ? "selected" : ""}>안 씀</option>
          ${personas.map((r) => `<option value="${r.id}" ${d.persona === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>
      </div>
      <div class="af-row">${RES.map(([k, l]) => resSel(k, l)).join("")}
        <label class="field"><span>브랜드 컬러</span><select id="afColors">
          <option value="auto" ${d_colors === "auto" ? "selected" : ""}>자동 — 폴더의 컬러${palettes[0] ? ` (${esc(palettes[0].name)}${chips(palettes[0])})` : " (없음)"}</option>
          <option value="" ${!d_colors ? "selected" : ""}>안 씀 — 원본 색 그대로</option>
          ${palettes.map((r) => `<option value="${r.id}" ${d_colors === r.id ? "selected" : ""}>${esc(r.name)}${chips(r)}</option>`).join("")}</select></label></div>
      ${!personas.length ? `<p class="small af-warn">이 폴더에 페르소나가 없습니다 — 카피는 원본 구조만 살리고 혜택 숫자는 빈칸으로 둡니다. <a href="#res">리소스</a>에서 페르소나를 만들면 소구점·혜택·말투가 들어갑니다.</p>` : ""}
      <label class="field"><span>추가 지시 (선택)</span><textarea id="afNote" rows="2" placeholder="예: 배경은 밝은 거실 톤, 헤드라인은 짧게">${esc(d.note)}</textarea></label>
    </section>

    <section class="af-sec"><h4>타깃 <span class="muted small">한 줄에 하나 · 8개까지 — 광고마다 원본에 맞는 타깃 하나를 골라 카피·장면을 맞춥니다 (겹치지 않게 돌아가며). 비우면 페르소나의 타깃 고객을 씁니다</span></h4>
      <textarea id="afTargets" rows="4" placeholder="예: 정수기 약정이 끝나 가는 30~40대 맞벌이 부부&#10;월급 외 소액을 원하는 30대 직장인 (회사 통보 걱정)&#10;이웃·지인이 많은 40~50대 주부">${esc((d.targets || []).join("\n"))}</textarea>
      <label class="field af-calltgt"><span>카피에 타깃 명시</span><select id="afCallTarget">${[["auto", "기획이 정함 — 효과적일 때만 부르기"], ["always", "항상 — \"○○하는 분들께\" 같은 호명 문구 넣기"], ["never", "안 함 — 타깃을 글로 부르지 않기"]].map(([k, l]) => `<option value="${k}" ${(d.callTarget || "auto") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="af-tgtbtns"><button class="btn btn--sm" type="button" id="afSuggest">참고 자료로 타깃·지시 채우기</button><button class="btn btn--ghost btn--sm" type="button" id="afTgtLoad">페르소나의 타깃 고객 불러오기</button>
        <span class="muted small" id="afSuggestMsg">아래 참고 자료에서 고른 문서·링크와 페르소나를 Claude 가 읽고 타깃과 추가 지시를 채웁니다 (1분 안팎, 저장해야 반영)</span></div>
    </section>

    <section class="af-sec"><h4>규칙 <span class="muted small">한 줄에 하나 · 15개까지 — 기획·만들기 모두 반드시 지킵니다. 따옴표로 묶은 말이나 "○○라는 키워드"는 금지어로 기획안에서 검사합니다</span></h4>
      <textarea id="afRules" rows="4" placeholder="예: 카피에 '다단계'라는 키워드는 절대 쓰지 않는다&#10;'고수익', '보장' 같은 말은 쓰지 않는다&#10;인물은 항상 정장 차림&#10;로고는 왼쪽 위에만">${esc((d.rules || []).join("\n"))}</textarea>
      <p class="muted small" id="afBanned">${bannedOf(d.rules || []).length ? `검사할 금지어: ${bannedOf(d.rules).map((w) => `<b>${esc(w)}</b>`).join(", ")}` : ""}</p>
    </section>

    <section class="af-sec"><h4>참고 자료 <span class="muted small">선택 · 카피·소구점을 정할 때 참고합니다 (페르소나는 따로 늘 들어갑니다)</span></h4>
      <div class="field"><span>참고 문서 <span class="muted small">이 고객사 폴더의 md·txt 문서</span></span>
        <div class="af-chips">${docs.map((r) => `<label class="af-chip ${d.docs.includes(r.id) ? "is-on" : ""}"><input type="checkbox" data-doc="${r.id}" ${d.docs.includes(r.id) ? "checked" : ""}>${esc(r.name)} <span class="muted small">${r.kind === "asset" ? "에셋" : "문서"}</span></label>`).join("") || `<p class="small muted">이 폴더에 md·txt 문서가 없습니다 — <a href="#res">리소스</a>의 참고 문서로 올리거나 바로 써서 저장하세요.</p>`}</div></div>
      <label class="field"><span>참고 링크 <span class="muted small">한 줄에 하나 · 5개까지 · 구글 문서·시트는 공유를 "링크가 있는 모든 사용자"로</span></span>
        <textarea id="afLinks" rows="3" placeholder="https://docs.google.com/document/d/…&#10;https://www.example.com/event">${esc((d.links || []).join("\n"))}</textarea></label>
      <div class="af-linkchk"><button class="btn btn--ghost btn--sm" type="button" id="afLinkChk">링크 확인</button><ul class="small" id="afLinkRes"></ul></div>
    </section>

    <section class="af-sec"><h4>3. 이미지 <span class="muted small">비율 · 화질</span></h4>
      <div class="field"><span>비율 <span class="muted small">여러 개 고르면 광고 하나를 비율마다 한 장씩 만듭니다</span></span>
        <div class="af-chips">${(m?.aspects || []).map((a) => `<label class="af-chip ${d.aspects.includes(a) ? "is-on" : ""}"><input type="checkbox" data-aspect="${esc(a)}" ${d.aspects.includes(a) ? "checked" : ""}>${esc(a)}</label>`).join("")}</div></div>
      <div class="af-row">
        <label class="field"><span>모델</span><select id="afModel">${st.models.map((x) => `<option value="${x.id}" ${x.id === d.model ? "selected" : ""}>${esc(x.name)} — ${esc(x.note)}</option>`).join("")}</select></label>
        ${m?.res ? `<label class="field"><span>해상도</span><select id="afRes">${m.res.options.map((o) => `<option ${o === d.resolution ? "selected" : ""}>${o}</option>`).join("")}</select></label>` : ""}
        ${m?.quality ? `<label class="field"><span>품질</span><select id="afQual">${m.quality.options.map((o) => `<option ${o === d.quality ? "selected" : ""}>${o}</option>`).join("")}</select></label>` : ""}
      </div>
    </section>

    <section class="af-sec"><h4>4. 몇 장 만들지 <span class="muted small">크레딧이 드는 양을 여기서 막습니다</span></h4>
      <div class="af-row">
        <label class="field"><span>경쟁사 한 곳에서 가져올 새 광고 (개)</span><input id="afPer" type="number" min="1" max="20" value="${d.perBrand}"></label>
        <label class="field"><span>그중 변형할 광고 (개)</span><input id="afMax" type="number" min="1" max="20" value="${d.maxMake}"></label>
      </div>
      <p class="af-total" id="afTotal"></p>
      <label class="field"><span>기획 방식</span><select id="afPlanMode">${MODES.map(([k, l]) => `<option value="${k}" ${(d.planMode || "remix") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="check"><input id="afApproval" type="checkbox" ${d.approval !== false ? "checked" : ""}> 만들기 전에 기획안 승인 받기 <span class="muted small">(추천 — 돌 때는 기획안까지만 만들고, 기획 승인에서 고치고 승인한 것만 이미지를 만듭니다. 끄면 기획안대로 바로 만듭니다)</span></label>
      <ul class="muted small af-help">
        <li><b>가져올 새 광고</b> — 돌 때마다 경쟁사의 이미지 광고를 이 개수까지 모읍니다. 지난번에 이미 모은 광고는 빼고 새로 올라온 것만 셉니다.</li>
        <li><b>변형할 광고</b> — 모은 광고 전체(모든 경쟁사 합계) 중 이 개수까지만 고객사 것으로 바꿔 만듭니다. 나머지는 광고 수집에 남아 있어 나중에 이미지 변형에서 직접 만들 수 있습니다.</li>
      </ul>
    </section>

    <section class="af-sec"><h4>5. 일정</h4>
      <div class="af-row af-row--mid">
        <div class="seg seg--sm" id="afDays">${DAYS.map((l, i) => `<button type="button" class="seg__btn ${d.schedule.days.includes(i) ? "is-on" : ""}" data-day="${i}">${l}</button>`).join("")}</div>
        <label class="field"><span>시각</span><input id="afTime" type="time" value="${d.schedule.time}"></label>
        <label class="check"><input id="afOn" type="checkbox" ${d.enabled ? "checked" : ""}> 켜기 (일정에 돌기)</label>
      </div>
    </section>

    <div class="af-edit__foot">
      <button class="btn btn--ghost" type="button" data-close>취소</button>
      <button class="btn btn--primary" type="button" id="afSave">저장</button>
    </div>`;
  showTotal();
}
// 입력 칸 → draft (다시 그리기 전에)
function readEdit() {
  const d = st.draft, v = (id) => $(id)?.value;
  d.name = v("#afName") ?? d.name; d.client = v("#afClient") ?? d.client; d.persona = v("#afPersona") ?? d.persona; d.colors = v("#afColors") ?? d.colors; d.note = v("#afNote") ?? d.note;
  d.model = v("#afModel") ?? d.model; d.resolution = v("#afRes") ?? d.resolution; d.quality = v("#afQual") ?? d.quality;
  d.perBrand = Number(v("#afPer")) || d.perBrand; d.maxMake = Number(v("#afMax")) || d.maxMake;
  const asp = [...document.querySelectorAll("#afEdit [data-aspect]:checked")].map((x) => x.dataset.aspect); if (document.querySelector("#afEdit [data-aspect]")) d.aspects = asp;
  if ($("#afLinks")) d.links = $("#afLinks").value.split("\n").map((x) => x.trim()).filter(Boolean);
  if (document.querySelector("#afEdit [data-doc]")) d.docs = [...document.querySelectorAll("#afEdit [data-doc]:checked")].map((x) => x.dataset.doc);
  if ($("#afApproval")) d.approval = $("#afApproval").checked;
  if ($("#afPlanMode")) d.planMode = $("#afPlanMode").value;
  if ($("#afCallTarget")) d.callTarget = $("#afCallTarget").value;
  if ($("#afRules")) d.rules = $("#afRules").value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 15);
  if ($("#afTargets")) d.targets = $("#afTargets").value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);
  d.schedule.time = v("#afTime") || d.schedule.time; d.enabled = $("#afOn")?.checked ?? d.enabled;
  document.querySelectorAll("#afEdit [data-res]").forEach((s) => (d.resources[s.dataset.res] = s.value));
}
// 변형할 광고 × 비율 = 한 번에 최대 장수
function showTotal() {
  const el = $("#afTotal"); if (!el) return;
  const max = Number($("#afMax")?.value) || 0, n = document.querySelectorAll("#afEdit [data-aspect]:checked").length;
  el.innerHTML = `한 번 돌 때 최대 <strong>${max * n}장</strong> = 변형할 광고 ${max}개 × 비율 ${n}개`;
}
function openEdit(af) {
  st.draft = af ? JSON.parse(JSON.stringify(af)) : blank();
  $("#afList").hidden = true; $("#afNew").hidden = true; $("#afEdit").hidden = false;
  renderEdit(); $("#afName").focus();
}
function closeEdit() { st.draft = null; $("#afEdit").hidden = true; $("#afList").hidden = false; $("#afNew").hidden = false; renderList(); }
// 참고 링크를 서버가 실제로 읽을 수 있는지 미리 본다 (자동화가 돌 때와 같은 방법)
async function checkLinks() {
  const links = $("#afLinks").value.split("\n").map((x) => x.trim()).filter(Boolean), out = $("#afLinkRes");
  if (!links.length) { out.innerHTML = `<li class="muted">링크를 적으세요</li>`; return; }
  out.innerHTML = links.map(() => `<li class="muted">읽는 중…</li>`).join("");
  const rows = await Promise.all(links.map((u) => api("/api/autoflows/link-check", { method: "POST", body: { url: u } }).then((x) => `<li class="is-ok">✓ <strong>${esc(x.title)}</strong> · ${x.length.toLocaleString()}자<br><span class="muted">${esc(x.text.slice(0, 120))}…</span></li>`, (e) => `<li class="af-err">✕ ${esc(u)} — ${esc(e.message)}</li>`)));
  out.innerHTML = rows.join("");
}
// 참고 자료(고른 문서·링크)와 페르소나로 타깃·추가 지시를 채운다 — 화면 값만 바꾸고 저장은 [저장]으로
async function suggest() {
  readEdit();
  const d = st.draft, btn = $("#afSuggest"), msg = $("#afSuggestMsg");
  if (!d.docs?.length && !d.links?.length && !confirm("참고 자료에서 문서·링크를 고르지 않았습니다. 페르소나만으로 채울까요?")) return;
  btn.disabled = true; btn.textContent = "읽는 중… (1분 안팎)";
  try {
    const r = await api("/api/autoflows/suggest", { method: "POST", body: d });
    if (!r.targets.length) throw new Error("제안된 타깃이 없습니다");
    const had = (d.targets || []).length || d.note.trim();
    if (had && !confirm(`지금 적힌 타깃·추가 지시를 제안으로 바꿀까요?\n\n타깃 ${r.targets.length}개:\n${r.targets.map((t) => `· ${t}`).join("\n")}\n\n추가 지시: ${r.note || "(없음)"}`)) { btn.disabled = false; btn.textContent = "참고 자료로 타깃·지시 채우기"; return; }
    d.targets = r.targets; if (r.note) d.note = r.note;
    renderEdit();
    $("#afSuggestMsg").textContent = `채웠습니다 — 근거: ${r.sources.join(", ") || "참고 자료"}${r.warns?.length ? ` · 못 읽은 자료 ${r.warns.length}개` : ""}. 고쳐 쓰고 [저장]을 누르세요`;
    $("#afTargets").scrollIntoView({ block: "center" });
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = "참고 자료로 타깃·지시 채우기"; if (msg) msg.textContent = ""; }
}
// 페르소나 md 의 "## 타깃 고객" 절을 줄마다 타깃으로 불러온다 (이미 적은 것 뒤에 겹치지 않게)
async function loadTargets() {
  readEdit();
  const d = st.draft, mine = st.res.filter((r) => r.kind === "target" && (d.client ? r.client === d.client : !r.client));
  const pr = d.persona === "auto" ? mine[0] : mine.find((r) => r.id === d.persona);
  const f = pr?.files?.find((x) => /\.(md|txt)$/i.test(x.file));
  if (!f) return toast("이 고객사 폴더에 페르소나 문서가 없습니다", true);
  try {
    const md = await (await fetch(`/data/_resources/target/${pr.id}/${encodeURIComponent(f.file)}`)).text();
    const sec = md.split(/\n(?=## )/).find((x) => /^## *타깃/.test(x.trim()));
    const lines = (sec || "").split("\n").slice(1).map((x) => x.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
    if (!lines.length) return toast("페르소나에 '타깃 고객' 절이 없습니다", true);
    d.targets = [...new Set([...(d.targets || []), ...lines])].slice(0, 8);
    renderEdit(); toast(`타깃 ${lines.length}줄을 불러왔습니다 — 고쳐 써도 됩니다`);
  } catch (e) { toast(e.message, true); }
}
async function save() {
  readEdit();
  const d = st.draft;
  if (!d.brands.length) return toast("경쟁사를 하나 이상 고르세요", true);
  if (!d.aspects.length) return toast("비율을 하나 이상 고르세요", true);
  if (!d.schedule.days.length && d.enabled) return toast("요일을 하나 이상 고르세요", true);
  if (!d.name.trim()) d.name = `${clientName(d.client)} 자동화`;
  try {
    await api(d.id ? `/api/autoflows/${d.id}` : "/api/autoflows", { method: d.id ? "PUT" : "POST", body: d });
    closeEdit(); await load(); toast("자동화를 저장했습니다");
  } catch (e) { toast(e.message, true); }
}

async function load() {
  [st.list, st.brands, st.clients, st.res, st.plans] = await Promise.all([api("/api/autoflows"), api("/api/brands"), api("/api/clients"), api("/api/resources"), api("/api/autoplans")]);
  if (!st.models.length) st.models = await api("/api/hf/image-models").catch(() => []);
  const n = st.plans.filter((p) => p.status === "pending").length;
  $("#afPlanN").textContent = n ? n : "";
  if (!st.draft) { renderList(); if (st.tab === "plans") renderPlans(); }
}

function bind() {
  $("#afNew").addEventListener("click", () => { setTab("list"); openEdit(null); });
  $("#afTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
  bindPlans(); bindPick();
  $("#afCmp").addEventListener("click", (e) => { if (e.target === e.currentTarget || e.target.closest("[data-close]")) $("#afCmp").close(); });
  $("#afList").addEventListener("click", async (e) => {
    const cmp = e.target.closest("[data-cmp]"); if (cmp) return openCmp(cmp.dataset.cmp);
    const gt = e.target.closest("[data-gotab]"); if (gt) return setTab(gt.dataset.gotab);
    const pk = e.target.closest("[data-pick]"); if (pk) return openPick(pk.dataset.pick);
    const fd = e.target.closest("[data-fold]"); if (fd) { toggleFold(fd.dataset.fold); return renderList(); }
    const pgb = e.target.closest("[data-pg]"); if (pgb) { const [, id, i] = pgb.dataset.pg.split("|"); st.hpage[id] = Number(i); return renderList(); }
    const run = e.target.closest("[data-run]"), ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) return openEdit(st.list.find((x) => x.id === ed.dataset.edit));
    if (del) {
      const af = st.list.find((x) => x.id === del.dataset.del);
      if (!confirm(`"${af.name}" 자동화를 지울까요? 이미 만든 광고는 이미지 변형에 남습니다.`)) return;
      try { await api(`/api/autoflows/${af.id}`, { method: "DELETE" }); await load(); toast("지웠습니다"); } catch (e2) { toast(e2.message, true); }
      return;
    }
    if (run) {
      const af = st.list.find((x) => x.id === run.dataset.run);
      if (!confirm(af.approval !== false ? `"${af.name}" 을(를) 지금 돌릴까요?\n경쟁사 ${af.brands.length}곳에서 새 이미지 광고를 모으고 광고 ${af.maxMake}개까지 기획안을 만듭니다.\n이미지는 기획 승인에서 승인한 것만 만듭니다 (그때 크레딧).`
        : `"${af.name}" 을(를) 지금 돌릴까요?\n경쟁사 ${af.brands.length}곳에서 새 이미지 광고를 모으고, 광고 ${af.maxMake}개까지 비율 ${aspectsOf(af).join("·")}로 — 최대 ${maxImages(af)}장을 힉스필드로 만듭니다 (크레딧이 듭니다).`)) return;
      try { await api(`/api/autoflows/${af.id}/run`, { method: "POST" }); toast("자동화를 시작했습니다 — 진행은 오른쪽 아래 작업 알림에서 볼 수 있습니다"); await load(); } catch (e2) { toast(e2.message, true); }
    }
  });
  $("#afList").addEventListener("change", async (e) => {
    const t = e.target.closest("[data-toggle]"); if (!t) return;
    try { await api(`/api/autoflows/${t.dataset.toggle}`, { method: "PUT", body: { enabled: t.checked } }); await load(); toast(t.checked ? "켰습니다 — 일정에 돕니다" : "껐습니다"); }
    catch (e2) { t.checked = !t.checked; toast(e2.message, true); }
  });
  $("#afEdit").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeEdit();
    if (e.target.id === "afSave") return save();
    if (e.target.id === "afLinkChk") return checkLinks();
    if (e.target.id === "afTgtLoad") return loadTargets();
    if (e.target.id === "afSuggest") return suggest();
    const day = e.target.closest("[data-day]");
    if (day) { readEdit(); const n = Number(day.dataset.day), s = st.draft.schedule.days; st.draft.schedule.days = s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort(); renderEdit(); }
  });
  $("#afEdit").addEventListener("change", (e) => {
    const b = e.target.closest("[data-brand]");
    if (b) { readEdit(); const id = b.dataset.brand; st.draft.brands = b.checked ? [...st.draft.brands, id] : st.draft.brands.filter((x) => x !== id); return renderEdit(); }
    // 고객사를 바꾸면 재료를 자동으로 되돌리고, 모델을 바꾸면 비율·해상도·품질 칸을 다시 그린다
    if (e.target.id === "afClient") { readEdit(); st.draft.resources = { product: "auto", person: "auto", background: "" }; st.draft.persona = "auto"; st.draft.colors = "auto"; return renderEdit(); }
    if (e.target.id === "afModel") { readEdit(); return renderEdit(); }
    const dc = e.target.closest("[data-doc]"); if (dc) dc.closest(".af-chip").classList.toggle("is-on", dc.checked);
    const a = e.target.closest("[data-aspect]");
    if (a) { a.closest(".af-chip").classList.toggle("is-on", a.checked); showTotal(); }
  });
  $("#afEdit").addEventListener("input", (e) => {
    if (e.target.id === "afMax") showTotal();
    if (e.target.id === "afRules") { const b = bannedOf(e.target.value.split("\n")); $("#afBanned").innerHTML = b.length ? `검사할 금지어: ${b.map((w) => `<b>${esc(w)}</b>`).join(", ")}` : ""; }
  });
  // 자동화 작업이 시작·끝나면 목록을 새로 읽는다
  window.addEventListener("srv-event", ({ detail: ev }) => {
    if (ev.type === "job" && ev.kind === "auto" && !$("#autoView").hidden && !st.draft && !document.activeElement?.closest?.("#apList")) load().catch(() => {});
  });
}

window.autoPage = {
  async open() { if (!st.bound) { bind(); st.bound = true; } await load().catch((e) => toast(e.message, true)); },
  close() {},
};
