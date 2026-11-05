// 메타 광고 수집기 — 화면
const $ = (s) => document.querySelector(s);
// 복사: 클립보드 API 가 막히면(창 포커스·권한) 숨긴 글상자로 한 번 더 시도한다. [data-copy] 버튼은 어디에 있든 여기서 처리
async function copyText(text, msg = "복사했습니다") {
  try { await navigator.clipboard.writeText(text); return toast(msg); } catch {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  ([...document.querySelectorAll("dialog[open]")].pop() || document.body).append(ta); // 열린 창 안에 둬야 선택된다
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  ok ? toast(msg) : toast("복사 실패 — 글을 직접 선택해서 복사하세요", true);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  e.preventDefault();
  copyText(b.dataset.copy, b.dataset.copyMsg || (b.closest("[data-cid]") && b.textContent.includes("캡션") ? "캡션을 복사했습니다" : "복사했습니다"));
});
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LIB = "https://www.facebook.com/ads/library/";
const ATC = "https://adstransparency.google.com";
const PLATFORM = { meta: "메타", youtube: "유튜브", instagram: "인스타", keyword: "키워드", manual: "직접" };
const IG = "https://www.instagram.com";
// 조회수 같은 큰 수를 한국식으로 (12,300 → 1.2만)
const fmtN = (n) => n == null ? "?" : n >= 1e8 ? `${+(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${+(n / 1e4).toFixed(1)}만` : n.toLocaleString("ko-KR");

// 플랫폼별 외부 링크
const brandUrl = (b) => b.platform === "instagram" ? `${IG}/${b.handle}/reels/`
  : b.platform === "youtube"
  ? `${ATC}/advertiser/${b.id}?region=${b.country}&format=VIDEO`
  : b.platform === "keyword"
  ? `${LIB}?active_status=active&ad_type=all&country=${b.country}&media_type=all&q=${encodeURIComponent(b.keyword)}&search_type=keyword_unordered`
  : `${LIB}?active_status=active&ad_type=all&country=${b.country}&media_type=all&search_type=page&view_all_page_id=${b.id}`;
const adUrl = (ad, b) => ad.platform === "instagram" ? `${IG}/reel/${ad.library_id}/`
  : ad.platform === "youtube"
  ? `${ATC}/advertiser/${ad.advertiser_id || b.id}/creative/${ad.library_id}?region=${b.country}`
  : `${LIB}?id=${ad.library_id}`;

const state = { brands: [], current: null, ads: [], filter: "", source: "", query: "", picked: null, job: null, platform: "meta", tab: "brands", lastBrandId: null };

async function api(path, opts = {}) {
  // 0.5초 넘게 걸리는 요청은 진행 표시를 띄운다
  let shown = false;
  const slow = setTimeout(() => { shown = true; busy.reqs++; busy.reqT0 ||= Date.now(); if (opts.busy) busy.reqLabel = opts.busy; busyRender(); }, 500);
  try {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
    return data;
  } finally {
    clearTimeout(slow);
    if (shown) { busy.reqs--; if (!busy.reqs) { busy.reqT0 = 0; busy.reqLabel = ""; } busyRender(); }
  }
}

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

const fileUrl = (ad, f) => `/data/${encodeURIComponent(state.current.folder)}/${ad.dir}/${f.split("/").map(encodeURIComponent).join("/")}`;
const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// ── 상태 / 도구 ───────────────────────────────────────
async function loadStatus() {
  const s = await api("/api/status");
  $("#dataDir").textContent = s.dataDir;
  if (!s.dataDirSet && !location.hash.startsWith("#setup")) location.hash = "#setup"; // 저장 폴더를 아직 안 골랐으면 처음 설정부터
  const names = { ego: "ego lite", ffmpeg: "ffmpeg", whisper: "음성 인식", ocr: "글자 인식", ytdlp: "yt-dlp" };
  $("#tools").innerHTML = Object.entries(names)
    .map(([k, label]) => `<span class="chip ${s.tools[k] ? "" : "is-off"}" title="${s.tools[k] ? "사용 가능" : "설치 안 됨"}">${label}${s.tools[k] ? "" : " 없음"}</span>`).join("");
  const off = Object.keys(names).filter((k) => !s.tools[k]).length; // 위 줄에는 요약만 — 눌러야 하나하나 보인다
  $("#toolsSum").textContent = off ? `도구 ${off}개 없음` : "도구 준비됨";
  $("#toolsSum").classList.toggle("is-off", !!off);
  if (!s.tools.whisper) { $("#whisper").checked = false; $("#whisper").disabled = true; }
  if (!s.tools.ocr) { $("#ocr").checked = false; $("#ocr").disabled = true; }
}

// ── 브랜드 ────────────────────────────────────────────
async function loadBrands() {
  state.brands = await api("/api/brands");
  const m = state.brands.find((b) => b.platform === "manual");
  state.manualMeta = m;
  updateDirectCount();
  const mine = state.brands.filter((b) => b.platform !== "manual"), q = $("#brandQ").value.trim().toLowerCase();
  $("#brandCount").textContent = mine.length || "";
  $("#brandQ").hidden = mine.length < 6; // 몇 개 없으면 찾기 칸은 감춘다
  if (!mine.length) $("#brandAdd").hidden = false; // 처음이면 등록 칸부터
  $("#brandList").innerHTML = mine.filter((b) => !q || b.name.toLowerCase().includes(q)).map((b) => `
    <li class="brand ${state.current?.id === b.id ? "is-on" : ""}" data-id="${b.id}" tabindex="0">
      <div class="brand__main">
        <div class="brand__name">${esc(b.name)} <span class="tag tag--${b.platform}">${PLATFORM[b.platform]}</span></div>
        <div class="brand__sub">${b.platform === "manual" ? `링크·파일 ${b.adCount}개` : `광고 ${b.adCount}개 · ${b.lastCollectedAt ? new Date(b.lastCollectedAt).toLocaleDateString("ko-KR") + " 수집" : "수집 전"}`}</div>
      </div>
      ${b.platform === "manual" ? "" : `<button class="btn btn--ghost btn--sm brand__del" data-del="${b.id}" aria-label="${esc(b.name)} 등록 해제">해제</button>`}
    </li>`).join("");
}

async function selectBrand(id) {
  state.current = state.brands.find((b) => b.id === id) || null;
  $("#empty").hidden = !!state.current;
  $("#brandView").hidden = !state.current;
  document.querySelectorAll(".brand").forEach((el) => el.classList.toggle("is-on", el.dataset.id === id));
  if (id && id !== "manual") state.lastBrandId = id;
  if (!state.current) return;
  const b = state.current;
  $("#brandName").textContent = b.platform === "manual" ? "링크 · 업로드 분석" : b.name;
  const yt = b.platform === "youtube", manual = b.platform === "manual";
  $("#brandLink").hidden = manual;
  if (!manual) {
    $("#brandLink").href = brandUrl(b);
    $("#brandLink").textContent = b.platform === "instagram" ? `인스타 · @${b.handle} 릴스 ↗`
      : b.platform === "keyword" ? `메타 키워드 검색 · "${b.keyword}" ↗`
      : `${PLATFORM[b.platform]} · ${yt ? "광고주 ID" : "Page ID"} ${b.id}${b.handle ? " · " + b.handle : ""} ↗`;
  }
  const insta = b.platform === "instagram";
  $("#pickField").hidden = !insta;
  $("#limitField").querySelector("span").textContent = insta ? "새 릴스" : "새 광고";
  // 유튜브는 영상 광고만, 게재 상태 필터 없음 / 직접 분석은 수집 조건 대신 링크·업로드
  $("#mediaType").closest("label").hidden = yt || manual || insta;
  $("#activeStatus").closest("label").hidden = yt || manual || insta;
  $("#limitField").hidden = manual;
  $("#collectBtn").hidden = manual;
  $("#manualTools").hidden = !manual;
  await loadAds();
}

$("#brandList").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    const b = state.brands.find((x) => x.id === del.dataset.del);
    if (!confirm(`"${b.name}" 등록을 해제할까요?\n수집한 폴더는 지우지 않습니다.`)) return;
    await api(`/api/brands/${b.id}`, { method: "DELETE" });
    if (state.current?.id === b.id) await selectBrand(null);
    return loadBrands();
  }
  const li = e.target.closest(".brand");
  if (li) selectBrand(li.dataset.id);
});
$("#brandList").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("brand")) selectBrand(e.target.dataset.id);
});

// ＋ 추가 — 등록 칸은 필요할 때만 목록 위에 연다 (브랜드가 하나도 없으면 처음부터 열어 둔다)
function toggleBrandAdd(on = $("#brandAdd").hidden) {
  $("#brandAdd").hidden = !on; $("#brandAddBtn").setAttribute("aria-expanded", on);
  if (on) $("#searchQuery").focus();
}
$("#brandAddBtn").addEventListener("click", () => toggleBrandAdd());
$("#brandAddClose").addEventListener("click", () => toggleBrandAdd(false));
$("#brandQ").addEventListener("input", () => loadBrands());

// 플랫폼 전환
const MANUAL_HINT = {
  meta: ["Page ID 또는 광고 라이브러리 URL", "337609789607046 또는 …view_all_page_id=…"],
  instagram: ["인스타 아이디 또는 프로필 URL", "hongik.man 또는 instagram.com/hongik.man"],
  youtube: ["광고주 ID 또는 광고 투명성 센터 URL", "AR03465148261151539201 또는 …/advertiser/AR…"],
  keyword: ["", ""], // 키워드는 ID 직접 입력이 없다
};
document.querySelectorAll("#platformSeg .seg__btn").forEach((btn) => btn.addEventListener("click", () => {
  state.platform = btn.dataset.platform;
  document.querySelectorAll("#platformSeg .seg__btn").forEach((b) => { b.classList.toggle("is-on", b === btn); b.setAttribute("aria-checked", b === btn); });
  $("#manualIdLabel").textContent = MANUAL_HINT[state.platform][0];
  $("#manualId").placeholder = MANUAL_HINT[state.platform][1];
  const kw = state.platform === "keyword";
  $("#searchLabel").textContent = state.platform === "instagram" ? "인스타 아이디" : kw ? "검색 키워드 (광고 문구에 들어간 말)" : "광고주 이름";
  $("#searchQuery").placeholder = state.platform === "instagram" ? "예: hongik.man" : kw ? "예: 정수기 렌탈" : "예: 코웨이";
  $("#searchForm").querySelector("button[type=submit]").textContent = kw ? "다음" : "찾기";
  // 키워드는 광고주 ID 가 없으니 "ID 직접 입력" 을 숨기고 검색 칸만 쓴다
  $("#addModeSeg").hidden = kw;
  if (kw) { $("#manualForm").hidden = true; document.querySelectorAll(".panel .seg__btn[data-mode]").forEach((b) => { b.classList.toggle("is-on", b.dataset.mode === "search"); b.setAttribute("aria-selected", b.dataset.mode === "search"); }); }
  $("#candidates").hidden = true; $("#confirmForm").hidden = true;
  if ($("#manualForm").hidden) $("#searchForm").hidden = false;
}));

// 등록 방식 전환
document.querySelectorAll(".panel .seg__btn[data-mode]").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".panel .seg__btn[data-mode]").forEach((b) => { b.classList.toggle("is-on", b === btn); b.setAttribute("aria-selected", b === btn); });
  $("#searchForm").hidden = btn.dataset.mode !== "search";
  $("#manualForm").hidden = btn.dataset.mode !== "manual";
  $("#confirmForm").hidden = true;
}));

// 이름으로 찾기 → 후보
$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#searchQuery").value.trim();
  if (state.platform === "instagram") return resolveInsta(q, e.submitter);
  if (state.platform === "keyword") {
    state.picked = { platform: "keyword", keyword: q };
    $("#confirmText").textContent = `메타 광고 라이브러리에서 "${q}" 문구가 들어간 광고를 광고주 상관없이 모읍니다`;
    $("#confirmName").value = `키워드_${q}`;
    $("#searchForm").hidden = true; $("#confirmForm").hidden = false; $("#confirmName").focus();
    return;
  }
  const btn = e.submitter; btn.disabled = true; btn.textContent = "찾는 중…";
  $("#candidates").hidden = true;
  try {
    const { candidates } = await api("/api/advertisers/search", { method: "POST", body: { query: q, platform: state.platform } });
    state.query = q;
    $("#candidates").innerHTML = candidates.length
      ? candidates.map((c) => {
        const [name, ...rest] = c.text.split(" ");
        return `<button type="button" class="cand" data-index="${c.index}" data-text="${esc(c.text)}"><b>${esc(name)}</b> ${esc(rest.join(" "))}</button>`;
      }).join("")
      : `<p class="muted small" style="padding:8px 12px">후보가 없습니다</p>`;
    $("#candidates").hidden = false;
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = "찾기"; }
});

// 후보 선택 → Page ID 확인 → 이름 확정
$("#candidates").addEventListener("click", async (e) => {
  const c = e.target.closest(".cand"); if (!c) return;
  document.querySelectorAll(".cand").forEach((x) => (x.disabled = true));
  c.innerHTML += " <span class='muted'>— Page ID 확인 중…</span>";
  try {
    const { pageId: id } = await api("/api/advertisers/resolve", { method: "POST", body: { query: state.query, index: Number(c.dataset.index), platform: state.platform } });
    const handle = (c.dataset.text.match(/@[\w.]+/) || [""])[0];
    state.picked = { id, handle, platform: state.platform };
    $("#confirmText").textContent = `${PLATFORM[state.platform]} · ${c.dataset.text} → ${id}`;
    // 같은 브랜드를 두 플랫폼에 등록할 수 있게 유튜브는 기본 폴더 이름을 따로 둔다
    $("#confirmName").value = state.platform === "youtube" ? `${state.query}_유튜브` : state.query;
    $("#searchForm").hidden = true;
    $("#confirmForm").hidden = false;
    $("#confirmName").focus();
  } catch (err) { toast(err.message, true); }
  finally { document.querySelectorAll(".cand").forEach((x) => (x.disabled = false)); }
});

// 인스타: 아이디 → 계정 확인 → 이름 확정
async function resolveInsta(q, btn) {
  btn.disabled = true; btn.textContent = "확인 중…";
  try {
    const r = await api("/api/instagram/resolve", { method: "POST", body: { username: q } });
    state.picked = { id: `IG${r.pk}`, handle: r.username, platform: "instagram" };
    $("#confirmText").textContent = `인스타 · @${r.username}${r.name ? ` (${r.name})` : ""} → ${r.pk}`;
    $("#confirmName").value = `${r.name || r.username}_인스타`;
    $("#searchForm").hidden = true; $("#confirmForm").hidden = false; $("#confirmName").focus();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = "찾기"; }
}

async function register(body) {
  const b = await api("/api/brands", { method: "POST", body });
  toggleBrandAdd(false);
  await loadBrands();
  await selectBrand(b.id);
  toast(`${b.name} 등록됨`);
}

$("#confirmForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await register({ name: $("#confirmName").value.trim(), ...state.picked });
    $("#confirmForm").hidden = true; $("#searchForm").hidden = false; $("#candidates").hidden = true; $("#searchQuery").value = "";
  } catch (err) { toast(err.message, true); }
});
$("#confirmCancel").addEventListener("click", () => { $("#confirmForm").hidden = true; $("#searchForm").hidden = false; });

$("#manualForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = $("#manualId").value.trim();
  if (state.platform === "instagram") {
    try {
      const r = await api("/api/instagram/resolve", { method: "POST", body: { username: raw } });
      await register({ name: $("#manualName").value.trim(), id: `IG${r.pk}`, handle: r.username, platform: "instagram" }); e.target.reset();
    } catch (err) { toast(err.message, true); }
    return;
  }
  const id = state.platform === "youtube"
    ? (raw.match(/(AR\d+)/) || [])[1]
    : (raw.match(/view_all_page_id=(\d+)/) || raw.match(/^(\d+)$/) || [])[1];
  if (!id) return toast(`${MANUAL_HINT[state.platform][0]} 형식이 아닙니다`, true);
  try { await register({ name: $("#manualName").value.trim(), id, platform: state.platform }); e.target.reset(); }
  catch (err) { toast(err.message, true); }
});

// ── 직접 분석 (링크 · 업로드) ─────────────────────────
const analyzeOpts = () => ({ whisper: $("#whisper").checked, ocr: $("#ocr").checked });
const openLog = () => { $("#logList").hidden = false; $("#logToggle").textContent = "기록 접기"; };

// 줄바꿈·공백으로 나눠 링크 목록으로 (중복 제거)
const parseUrls = () => [...new Set($("#analyzeUrl").value.split(/\s+/).filter(Boolean))];
$("#analyzeUrl").addEventListener("input", () => {
  const n = parseUrls().length;
  $("#urlCount").textContent = n ? `링크 ${n}개${n > 30 ? " — 최대 30개" : ""}` : "⌘/Ctrl + Enter 로 시작";
  $("#urlBtn").textContent = n > 1 ? `링크 ${n}개 분석` : "링크 분석";
});
$("#analyzeUrl").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("#urlForm").requestSubmit(); }
});
$("#urlForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const urls = parseUrls();
  if (!urls.length) return;
  try {
    await api("/api/analyze/url", { method: "POST", body: { urls, ...analyzeOpts() } });
    $("#analyzeUrl").value = ""; $("#analyzeUrl").dispatchEvent(new Event("input")); openLog();
  } catch (err) { toast(err.message, true); }
});

// 파일을 하나씩 올려 두고(토큰), 다 올라가면 묶어서 분석 작업 하나로 시작
const OK_EXT = /\.(mp4|mov|m4v|webm|mkv|jpe?g|png|webp|gif)$/i;
async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const skipped = files.filter((f) => !OK_EXT.test(f.name));
  const ok = files.filter((f) => OK_EXT.test(f.name)).slice(0, 30);
  if (skipped.length) toast(`형식이 맞지 않아 뺀 파일 ${skipped.length}개: ${skipped.slice(0, 3).map((f) => f.name).join(", ")}`, true);
  if (files.filter((f) => OK_EXT.test(f.name)).length > 30) toast("한 번에 30개까지만 올립니다", true);
  if (!ok.length) return;
  const tokens = [];
  try {
    for (const [i, f] of ok.entries()) {
      setJob(`올리는 중 ${i + 1}/${ok.length}: ${f.name} (${Math.round(f.size / 1024 / 1024 * 10) / 10}MB)`, "run");
      const res = await fetch(`/api/uploads?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${f.name}: ${data.error || `업로드 실패 ${res.status}`}`);
      tokens.push(data.token);
    }
    await api("/api/analyze/uploads", { method: "POST", body: { tokens, ...analyzeOpts() } });
    openLog();
  } catch (err) { setJob(err.message, "err"); toast(err.message, true); }
}
$("#fileInput").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });
const drop = $("#drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("is-over")));
drop.addEventListener("drop", (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });

// ── 수집 ──────────────────────────────────────────────
$("#collectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api(`/api/brands/${state.current.id}/collect`, {
      method: "POST",
      body: { limit: Number($("#limit").value), mediaType: $("#mediaType").value, activeStatus: $("#activeStatus").value, pick: $("#pick").value, whisper: $("#whisper").checked, ocr: $("#ocr").checked },
    });
    $("#logList").hidden = false; $("#logToggle").textContent = "기록 접기";
  } catch (err) { toast(err.message, true); }
});

$("#logToggle").addEventListener("click", () => {
  const l = $("#logList"); l.hidden = !l.hidden;
  $("#logToggle").textContent = l.hidden ? "기록 펼치기" : "기록 접기";
});

// ── 진행 표시: 서버 작업·화면 작업(PNG 저장)·느린 요청이 있는 동안 위쪽 바와 오른쪽 아래 상자를 띄운다 ──
// 창(dialog) 위에도 보이게 popover(최상위 층)로 띄우고, 창이 새로 열리면 다시 맨 위로 올린다
// 서버 작업은 여러 개가 같이 돌 수 있다 (드라마 Claude 단계·힉스필드 칸) — 작업 id 별로 들고 있는다
const busy = { runs: new Map(), reqs: 0, reqT0: 0, reqLabel: "", timer: null };
const fmtElapsed = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`; };
function busyRender() {
  const el = $("#busy"); if (!el) return;
  const runs = [...busy.runs.values()], one = runs.length === 1 ? runs[0] : null;
  const on = runs.length > 0 || busy.reqs > 0;
  if (on && !el.matches(":popover-open")) el.showPopover();
  if (!on) { if (el.matches(":popover-open")) el.hidePopover(); clearInterval(busy.timer); busy.timer = null; return; }
  $("#busyText").textContent = one ? one.label : runs.length ? `작업 ${runs.length}개 진행 중` : busy.reqLabel || "처리 중…";
  $("#busyLog").textContent = one ? one.log : runs.length ? runs.map((r) => r.label).join(" · ") : "서버 응답을 기다리는 중";
  const t0 = runs.length ? Math.min(...runs.map((r) => r.t0)) : busy.reqT0;
  const tick = () => { $("#busyTime").textContent = fmtElapsed(Date.now() - (t0 || Date.now())); };
  tick();
  busy.timer ||= setInterval(tick, 1000);
}
const showModal0 = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  showModal0.call(this);
  const el = $("#busy");
  if (el?.matches(":popover-open")) { el.hidePopover(); el.showPopover(); }
};

// 아래 상태 줄 + 진행 상자. 작업이 하나 끝나도 다른 작업이 돌고 있으면 계속 "진행 중"
function setJob(text, mode) {
  if (mode !== "run" && busy.runs.size) mode = "run";
  busyRender();
  $("#jobText").textContent = text;
  $("#jobDot").className = "log__dot" + (mode ? ` is-${mode}` : "");
  $("#logBox").classList.toggle("is-idle", !mode); // 쉬는 중이고 기록도 접혀 있으면 상태 줄을 감춘다
  // 수집은 혼자 도는 작업이라 다른 혼자 작업이 돌 때만 막는다 (드라마·힉스필드 칸 작업과는 같이 돈다)
  const running = [...busy.runs.values()].some((r) => !r.shared);
  $("#collectBtn").textContent = running ? "진행 중…" : "수집 시작";
}

function addLog(e) {
  const li = document.createElement("li");
  if (e.level) li.className = e.level;
  li.innerHTML = `<time>${new Date(e.time).toLocaleTimeString("ko-KR")}</time>${esc(e.message || "")}`;
  const list = $("#logList");
  list.append(li);
  while (list.children.length > 300) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

let reloadTimer;
function handleEvent(e) {
  if (e.type === "hello") {
    e.history.forEach((h) => h.message && addLog(h));
    for (const j of e.jobs || []) busy.runs.set(j.id, { label: j.label, t0: j.startedAt, log: "", shared: !!j.key });
    if (busy.runs.size) setJob(`진행 중: ${[...busy.runs.values()].map((r) => r.label).join(" · ")}`, "run");
    return;
  }
  if (e.message) addLog(e);
  if (e.type === "job") {
    if (e.state === "start") { busy.runs.set(e.job, { label: String(e.message).replace(/^시작:\s*/, ""), t0: Date.now(), log: "", shared: !!e.shared }); setJob(e.message, "run"); }
    else busy.runs.delete(e.job);
    if (e.kind === "template") {
      $("#tplJob").textContent = e.state === "start" ? "템플릿 만드는 중…" : "";
      if (e.state === "done") { loadTemplates(); toast("템플릿을 저장했습니다 — 템플릿 탭에서 볼 수 있습니다"); }
    }
    if (e.kind === "cast") {
      if (e.state !== "start") $("#tMyPrompts").disabled = false;
      if (e.state === "done" && e.result?.id) {
        loadTemplates();
        if (state.castPending === e.result.id) {
          if (state.tab === "vmake") { state.vm.tplId = e.result.id; state.tpl = null; loadVmake(state.vm.step === 3).then(() => toast("준비됐습니다")); }
          else api(`/api/templates/${e.result.id}`).then((t) => { openTemplate(t); toast(t.my_prompts && !t.cast?.length ? "완료" : "내 소재 시트가 준비됐습니다"); });
        }
      }
    }
    if (e.kind === "myvoice" && e.state === "done" && state.tab === "vmake" && e.result?.id === state.vm.tplId) loadVmake(true).then(() => toast("목소리가 준비됐습니다"));
    if (e.kind === "myscript" && e.state === "done" && state.tab === "vmake" && e.result?.id === state.vm.tplId) loadVmake(true).then(() => toast("대본이 준비됐습니다"));
    if (e.kind === "voice" && e.result?.ok && state.resKind === "voice") vcLoad(); // 모델 받기 끝
    if (e.kind === "hf") {
      if (e.state === "done") {
        const r = e.result || {};
        toast("힉스필드 결과가 들어왔습니다");
        if (r.type === "variant" && $("#detail").open && state.detailAd?.dir === r.dir) loadPrompts(state.detailAd).then(() => setDetailTab("variants"));
        if (r.type === "drama" && state.tab === "studio" && state.st?.id === r.id) openDrama(r.id, state.stView);
        if (r.type === "template" && state.tab === "vmake" && state.vm.tplId === r.id) api(`/api/templates/${r.id}`).then((t) => { state.tpl.my_media = t.my_media; renderMyPrompts(); });
        if (r.type === "template" && $("#tplDialog").open && state.tpl?.id === r.id) api(`/api/templates/${r.id}`).then((t) => { state.tpl.my_media = t.my_media; renderMyPrompts(); });
      }
    }
    if (e.kind === "drama") {
      if (e.state !== "start" && state.stRefBusy) { state.stRefBusy = null; if (e.state === "error" && state.tab === "studio") stRender(); }
      if (e.state === "done" && e.result?.id) { toast(e.result.ref ? "참고 영상을 넣었습니다" : e.result.auto ? "시트 제작 직전까지 구성했습니다 — 샷리스트를 확인하세요" : "다 썼습니다"); if (state.tab === "studio" && state.st?.id === e.result.id) openDrama(e.result.id, e.result.step); }
    }
    if (e.kind === "script") {
      $("#scBtn").disabled = e.state === "start";
      if (e.state === "done") { toast("대본을 썼습니다"); if (state.tab === "script") location.hash = "#drama/scripts"; else if (state.tab === "scripts") loadScripts(); }
    }
    if (e.kind === "cardnews") {
      $("#cnBtn").disabled = e.state === "start";
      // 다 쓰면 만든 카드뉴스 탭으로 넘어가 PNG 로 찍는다 (다른 탭에 있으면 그 탭을 열 때 찍는다)
      if (e.state === "done") {
        toast("카드뉴스 글을 썼습니다 — 만든 카드뉴스 탭에서 그림으로 저장합니다");
        state.madeAuto = e.result;
        if (state.tab === "make") location.hash = "#card/made"; else if (state.tab === "made") loadMade();
      }
    }
    if (e.kind === "competitors") {
      $("#cmpBtn").disabled = e.state === "start";
      $("#cmpJob").textContent = e.state === "start" ? "웹에서 찾는 중… (2~5분)" : "";
      if (e.state === "done") { toast("경쟁사를 찾았습니다"); state.cmpId = e.result?.id; loadCompetitors(); }
    }
    if (e.kind === "prompts") {
      $("#pBtn").disabled = e.state === "start";
      if (e.state === "error" && $("#dAsset").textContent === "프롬프트 분석 중…") { $("#dAsset").disabled = false; $("#dAsset").textContent = "이미지 변형 에셋으로 저장"; }
      if (e.state === "done") { toast(e.result?.suggest ? `변형 추천 ${e.result.n}개를 받았습니다` : e.result?.asset ? `분석을 끝내고 이미지 변형 에셋으로 저장했습니다 (${e.result.n}장)` : e.result?.vid ? "변형을 만들었습니다" : "장면별 프롬프트를 만들었습니다"); if ($("#detail").open && state.detailAd?.dir === e.result?.dir) loadPrompts(state.detailAd).then(() => setDetailTab(e.result.vid ? "variants" : "prompts")); }
    }
    if (e.state === "done") { setJob(e.message, "ok"); if (e.kind === "collect") { loadBrands(); loadAds(); toast(`새 광고 ${e.result?.saved?.length ?? 0}개 저장`); } }
    if (e.state === "error") { setJob(e.message, "err"); toast(e.message, true); }
  } else {
    const r = e.job && busy.runs.get(e.job);
    if (r && e.message) r.log = e.message;
    if (e.message) setJob(e.message, "run");
    // 광고 하나 저장될 때마다 목록 갱신
    if (e.dir) { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAds, 300); }
  }
}

function connect() {
  const es = new EventSource("/api/events");
  // 3D 설명 영상·팟캐스트 화면도 이 한 줄을 같이 듣는다 (window "srv-event"). 화면마다 따로 열면
  // 탭 하나가 연결을 여럿 잡아 브라우저의 호스트당 연결 6개 한도에 걸리고 새 페이지가 안 열린다
  es.onmessage = (m) => { const e = JSON.parse(m.data); handleEvent(e); window.dispatchEvent(new CustomEvent("srv-event", { detail: e })); };
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

// ── 광고 그리드 ───────────────────────────────────────
async function loadAds() {
  if (!state.current) return;
  state.ads = await api(`/api/brands/${state.current.id}/ads`);
  renderAds();
}

function thumbOf(ad) {
  const f = ad.files || {};
  return f.poster || f.image || Object.values(f).find((x) => /^ph_.*\.(jpg|png|webp)$/.test(x)) || ad.analysis?.videos?.[0]?.shots?.[0]?.frame;
}

// 화면 글자(OCR) 결과가 없는 광고 — 글자 인식을 붙이기 전에 받은 것
const lacksOcr = (a) => !a || a.videos?.some((v) => v.shots?.some((s) => s.onscreen_text === undefined))
  || a.images?.some((im) => !im.error && im.text_lines == null);

function renderAds() {
  const missing = state.ads.filter((a) => lacksOcr(a.analysis)).length;
  $("#reMissing").hidden = !missing;
  $("#reMissing").textContent = `화면 글자 없는 ${missing}개 다시 분석`;
  if (state.current.platform === "instagram") state.ads.sort((x, y) => (y.metrics?.multiple ?? 0) - (x.metrics?.multiple ?? 0));
  const q = $("#adQ").value.trim().toLowerCase();
  const hit = (a) => !q || `${a.body_text || ""} ${a.title || ""} ${a.original_filename || ""}`.toLowerCase().includes(q);
  const list = state.ads.filter((a) => (!state.filter || a.type === state.filter) && (!state.source || a.source === state.source) && hit(a));
  $("#sourceFilter").hidden = state.current.platform !== "manual";
  const vd = state.ads.filter((a) => a.type === "vd").length;
  const what = state.current.platform === "manual" ? "분석한 항목" : "수집한 광고";
  $("#adCount").textContent = `${what} ${state.ads.length}개`;
  const n = { "": state.ads.length, vd, ph: state.ads.length - vd };
  document.querySelectorAll("#filter [data-n]").forEach((x) => (x.textContent = n[x.dataset.n] || ""));
  $("#grid").dataset.empty = state.current.platform === "manual"
    ? "링크를 넣거나 파일을 올리면 여기에 쌓입니다."
    : q ? `"${q}" 가 들어간 광고가 없습니다.` : "아직 수집한 광고가 없습니다. 위에서 [수집 시작]을 누르세요.";
  $("#grid").innerHTML = list.map((ad, i) => {
    const t = thumbOf(ad);
    const v = ad.analysis?.videos?.[0];
    return `<button class="card" data-i="${state.ads.indexOf(ad)}">
      <div class="card__thumb">
        ${t ? `<img src="${fileUrl(ad, t)}" alt="" loading="lazy">` : ""}
        <span class="badge">${ad.type === "vd" ? "영상" : "이미지"}</span>
        ${v ? `<span class="card__dur">${v.spec.duration_s}초 · ${v.cuts.count}컷</span>` : ""}
      </div>
      <div class="card__body">
        ${ad.metrics ? `<div class="card__metric"><b class="${ad.metrics.multiple >= 1.5 ? "is-hot" : ""}">${ad.metrics.multiple ?? "?"}배</b> 조회 ${fmtN(ad.metrics.plays)} · 좋아요 ${fmtN(ad.metrics.likes)} · 댓글 ${fmtN(ad.metrics.comments)}</div>` : ""}
        <div class="card__meta">${ad.platform === "instagram" ? `${esc(ad.start_date || "")} 게시`
          : ad.platform === "youtube" ? `마지막 게재 ${esc(ad.last_shown || "?")}`
          : ad.platform === "manual" ? `${ad.source === "upload" ? "업로드" : "링크"} · ${new Date(ad.collected_at).toLocaleDateString("ko-KR")}`
          : `${ad.keyword && ad.advertiser ? `<b>${esc(ad.advertiser)}</b> · ` : ""}${esc(ad.start_date || "")} 시작 · ${esc(ad.status || "")}`}</div>
        <div class="card__text">${esc(ad.platform === "manual" ? ad.title || ad.original_filename || ad.source_url : ad.body_text || "(본문 없음)")}</div>
      </div>
    </button>`;
  }).join("");
}

// 링크·업로드 탭 옆 개수 — 모드에 맞는 종류만 센다 (영상 모드는 영상, 카드뉴스 모드는 이미지)
function updateDirectCount() {
  const m = state.manualMeta, f = MODES[state.mode]?.filter;
  const n = !m ? 0 : f ? m.typeCount?.[f] ?? m.adCount : m.adCount;
  $("#directCount").textContent = n ? `${n}개` : "";
  $("#subDirectCount").textContent = n ? `${n}개` : "";
}
function setFilter(type) {
  state.filter = type;
  document.querySelectorAll("#filter .seg__btn").forEach((x) => x.classList.toggle("is-on", x.dataset.type === type));
  if (state.current) renderAds();
}
$("#adQ").addEventListener("input", () => state.current && renderAds());
$("#logOpen").addEventListener("click", () => {
  const l = $("#logList"); l.hidden = !l.hidden; $("#logToggle").textContent = l.hidden ? "기록 펼치기" : "기록 접기";
});
$("#filter").addEventListener("click", (e) => { const b = e.target.closest(".seg__btn"); if (b) setFilter(b.dataset.type); });
$("#grid").addEventListener("click", (e) => {
  const c = e.target.closest(".card"); if (c) openDetail(state.ads[Number(c.dataset.i)]);
});

// ── 다시 분석 ────────────────────────────────────────
async function reanalyzeReq(body) {
  try {
    await api(`/api/brands/${state.current.id}/reanalyze`, { method: "POST", body: { ...body, whisper: $("#whisper").checked, ocr: $("#ocr").checked } });
    $("#logList").hidden = false; $("#logToggle").textContent = "기록 접기";
  } catch (err) { toast(err.message, true); }
}
$("#reMissing").addEventListener("click", () => {
  const n = state.ads.filter((a) => lacksOcr(a.analysis)).length;
  if (confirm(`화면 글자가 없는 광고 ${n}개를 다시 분석할까요?\n다운로드는 하지 않고 저장된 파일로 분석만 새로 돌립니다. 광고당 30초~1분 걸립니다.`)) reanalyzeReq({ missingOnly: true });
});
$("#dTpl").addEventListener("click", async () => {
  const ad = state.detailAd;
  if (!ad?.analysis?.videos?.length && !ad?.analysis?.images?.length) return toast("분석 결과가 있는 광고만 템플릿으로 만들 수 있습니다", true);
  try {
    const isVideo = !!ad.analysis?.videos?.length;
    await api("/api/templates", { method: "POST", body: { brandId: state.current.id, dir: ad.dir, ...(isVideo ? { kind: "auto" } : {}) } });
    $("#detail").close(); openLog();
    toast(isVideo ? "템플릿 만드는 중 (1~3분) — 광고형·상황극형을 먼저 고른 뒤 저장합니다. 릴스 제작하기 참고 영상에서 씁니다" : "템플릿 만드는 중 (1~3분) — 끝나면 템플릿 메뉴에 생깁니다");
  } catch (err) { toast(err.message, true); }
});
// 이미지 변형 에셋으로 저장 — 프롬프트가 있으면 바로 등록, 없으면 서버가 분석부터 한다 (작업 완료 이벤트로 알림)
$("#dAsset").addEventListener("click", async () => {
  const ad = state.detailAd, btn = $("#dAsset");
  if (btn.dataset.done) { $("#detail").close(); location.hash = "#vary"; return; }
  try {
    btn.disabled = true;
    const r = await api(`/api/brands/${state.current.id}/vary-asset`, { method: "POST", body: { dir: ad.dir } });
    if (r.asset) { toast(`이미지 변형 에셋으로 저장했습니다 (${r.n}장)`); await loadPrompts(ad); }
    else { btn.textContent = "프롬프트 분석 중…"; toast("프롬프트 분석이 없어 먼저 분석합니다 (1~3분) — 끝나면 이미지 변형 에셋으로 저장됩니다"); }
  } catch (err) { btn.disabled = false; toast(err.message, true); }
});
$("#dRe").addEventListener("click", () => {
  const ad = state.detailAd;
  if (ad) { $("#detail").close(); reanalyzeReq({ dir: ad.dir }); }
});

$("#sourceFilter").addEventListener("click", (e) => {
  const b = e.target.closest(".seg__btn"); if (!b) return;
  state.source = b.dataset.source;
  document.querySelectorAll("#sourceFilter .seg__btn").forEach((x) => x.classList.toggle("is-on", x === b));
  renderAds();
});

// ── 처음 화면 → 모드(경쟁사 분석 · 영상 만들기 · 카드뉴스 만들기) → 탭 ──────
// 주소: #home · #cmp/competitors · #video/brands · #card/templates … (예전 주소 #direct 등도 받는다)
const TABS = ["competitors", "brands", "direct", "templates", "resources", "make", "made", "script", "scripts", "studio", "collect", "vmake"];
// 광고 수집은 공용 메뉴 하나 (계정·광고주 / 링크·업로드). 다른 메뉴에서는 탭 줄의 바로가기로 들어온다
const MODES = {
  collect: { name: "광고 수집", tabs: ["collect"], filter: "" },
  res: { name: "리소스 관리 (공용)", tabs: ["resources"] },
  tpl: { name: "템플릿 관리 (공용)", tabs: ["templates"] },
  drama: { name: "릴스 제작하기", tabs: ["studio", "templates"], filter: "vd" }, // 원본의 드라마 릴스 — 이 앱에서는 "릴스 제작하기"라 부른다
};
// 종류 하나만 보여 주는 만들기 메뉴 → 리소스 종류
const ONLY_KIND = { person: "person", bg: "background", prod: "product" };
const ONLY_DESC = {
  person: "사람마다 폴더를 만들고 얼굴 → 체형 → 전신 시트 순서로 속성·참고 이미지를 넣어 힉스필드로 만듭니다 (얼굴 결과를 체형·전신 시트의 참고로 이어 씁니다). 🪄 가상 페르소나로 성격·말투·배경 이야기와 프롬프트를 채울 수 있습니다. 만든 인물은 리소스(인물)로 남아 다른 메뉴에서 불러 씁니다.",
  background: "배경마다 폴더를 만들고 기본 장면 → 앵글 시트 → 시간·날씨 바꾸기 순서로 장소·분위기·조명·카메라를 골라 힉스필드로 만듭니다 (기본 장면 결과를 앵글 시트·변형의 image 1 로 이어 써서 같은 공간이 유지됩니다). 만든 배경은 리소스(배경)로 남아 다른 메뉴에서 불러 씁니다.",
  product: "제품마다 폴더를 만들고 실제 제품 사진을 넣어 제품컷 → 제품 시트(여러 각도) → 연출컷 순서로 만듭니다 (제품컷 결과를 다음 단계의 image 1 로 이어 써서 같은 제품이 유지됩니다). 연출컷에는 만든 배경을 장소로 가져올 수 있습니다. 만든 제품은 리소스(소품·제품)로 남습니다.",
};
function parseRoute(h) {
  const [a, b, c] = h.split("/");
  // 예전 주소(#video/brands, #card/direct, #drama/collect/links, #brands …)는 공용 광고 수집으로
  if ((MODES[a] && ["brands", "direct", "collect"].includes(b) && a !== "collect") || ["brands", "direct"].includes(a))
    return { mode: "collect", tab: "collect", sub: (b || a) === "direct" ? "links" : c || "accounts" };
  // 리소스도 공용 메뉴로 (#video/resources, #resources …)
  if ((MODES[a] && b === "resources" && a !== "res") || a === "resources") return { mode: "res", tab: "resources" };
  if (MODES[a]) return { mode: a, tab: MODES[a].tabs.includes(b) ? b : MODES[a].tabs[0], sub: c };
  return { mode: "home", tab: null };
}
const tabHref = (tab) => `#${state.mode}/${tab}`;
async function setTab(hash) {
  let { mode, tab, sub } = parseRoute(hash);
  document.body.dataset.mode = mode; // 광고 수집은 탭 줄·길잡이 없이 제목 한 줄만 (style.css)
  // 3D 설명 영상 · 라디오 팟캐스트 릴스는 따로 노는 화면 (public/explainer.js · public/podcast.js)
  // 모듈은 app.js 보다 늦게 실릴 수 있어 전역 이름으로 그때그때 찾는다
  // 이미지 소재(#poster)·레퍼런스(#ref)는 일단 메뉴에서 뺐다 — solo 에 없으니 주소로 오면 처음 화면 (개발노트.md 참고)
  const solo = { clone: ["#cloneView", "cloner"], setup: ["#setupView", "setupPage"], history: ["#historyView", "historyPage"], vary: ["#varyView", "varyPage"], auto: ["#autoView", "autoPage"], res: ["#libView", "libPage"] }, cur = hash.replace(/^#/, "").split("/")[0];
  // 한 화면을 두 메뉴가 같이 쓸 수 있다 (리소스·레퍼런스 = #libView) — 지금 메뉴의 화면만 남긴다
  for (const [k, [sel, mod]] of Object.entries(solo)) { $(sel).hidden = solo[cur]?.[0] !== sel; if (k !== cur && solo[cur]?.[0] !== sel) window[mod]?.close(); }
  if (solo[cur]) {
    document.querySelectorAll(`#homeView, #tabs, #subTabs, #layout, .page:not(${solo[cur][0]})`).forEach((x) => (x.hidden = true));
    window.nav?.base([{ label: "처음", href: "#home" }, { label: $(`${solo[cur][0]} .page__head h2`)?.textContent.trim() || cur, href: `#${cur}` }]); // 길잡이 (public/nav.js)
    return window[solo[cur][1]]?.open(hash.replace(/^#/, "").split("/")[1] || ""); // #explain/list · #explain/ex_… 처럼 화면·영상을 고른다
  }
  // "영상 수집하기" 탭은 화면 안의 작은 탭으로 계정·광고주 수집(brands)과 링크·업로드(direct)를 오간다
  const navTab = tab;
  if (tab === "collect") {
    state.collectSub = ["accounts", "links"].includes(sub) ? sub : state.collectSub || "accounts";
    tab = state.collectSub === "links" ? "direct" : "brands";
  }
  $("#subTabs").hidden = navTab !== "collect";
  document.querySelectorAll("#subTabs .subtabs__item").forEach((x) => {
    const on = navTab === "collect" && x.dataset.sub === state.collectSub;
    x.classList.toggle("is-on", on); x.setAttribute("aria-selected", on); x.href = `#${mode}/collect/${x.dataset.sub}`;
  });
  const modeChanged = mode !== state.mode;
  state.mode = mode;
  state.tab = tab;
  const home = mode === "home";
  $("#homeView").hidden = !home;
  $("#tabs").hidden = home || MODES[mode]?.tabs.length === 1; // 탭이 하나뿐이면(리소스·템플릿·광고 수집) 탭 줄은 제목과 겹쳐서 감춘다
  const page = home || ["templates", "resources", "competitors", "make", "made", "script", "scripts", "studio", "vmake"].includes(tab);
  $("#layout").hidden = page;
  $("#cmpView").hidden = tab !== "competitors";
  $("#tplView").hidden = tab !== "templates";
  $("#resView").hidden = tab !== "resources";
  $("#makeView").hidden = tab !== "make";
  $("#madeView").hidden = tab !== "made";
  $("#scriptView").hidden = tab !== "script";
  $("#scriptsView").hidden = tab !== "scripts";
  $("#studioView").hidden = tab !== "studio";
  $("#vmakeView").hidden = tab !== "vmake";
  // 길잡이: 처음 › 메뉴 › (탭이 여럿이면) 탭 › (광고 수집이면) 수집 방법 — 화면 안쪽 단계는 각 화면이 window.nav.sub 로 잇는다
  const tabLabel = (t) => document.querySelector(`.tabs__item[data-tab="${t}"]`)?.textContent.replace(/\s+/g, " ").trim().replace(/\s\d+개?$/, "");
  if (home) { window.nav?.base([]); return window.explorePage?.open(); }
  const m = MODES[mode];
  $("#modeName").textContent = m.name;
  // 탭 순서를 모드에 맞춘다 (만들기 탭이 앞)
  const nav = $("#tabs");
  m.tabs.forEach((t) => nav.append(nav.querySelector(`.tabs__item[data-tab="${t}"]`)));
  nav.append(nav.querySelector('.tabs__item[data-tab="gocollect"]'), nav.querySelector('.tabs__item[data-tab="gores"]'));
  document.querySelectorAll(".tabs__item").forEach((a) => {
    const t = a.dataset.tab, on = t === navTab;
    if (t === "gocollect") { a.hidden = mode === "collect"; return; } // 다른 메뉴에서 공용 수집으로 가는 바로가기
    if (t === "gores") { a.hidden = mode === "res"; return; } // 공용 리소스 바로가기
    a.hidden = !m.tabs.includes(t);
    a.href = tabHref(t);
    a.classList.toggle("is-on", on); a.setAttribute("aria-selected", on);
    const l = a.querySelector(`[data-label-${mode}]`); if (l) l.textContent = l.dataset[`label${mode[0].toUpperCase()}${mode.slice(1)}`];
  });
  {
    const m0 = MODES[mode], items = [{ label: "처음", href: "#home" }, { label: m0.name, href: `#${mode}` }];
    if (m0.tabs.length > 1 && tabLabel(navTab) !== m0.name) items.push({ label: tabLabel(navTab), href: tabHref(navTab) });
    if (navTab === "collect") items.push({ label: document.querySelector(`#subTabs [data-sub="${state.collectSub}"]`)?.childNodes[0]?.textContent.trim(), href: `#${mode}/collect/${state.collectSub}` });
    window.nav?.base(items);
  }
  // 영상 모드는 영상, 카드뉴스 모드는 이미지 광고부터 보여준다 (필터로 바꿀 수 있다)
  if (modeChanged) { setFilter(m.filter || ""); updateDirectCount(); if (tab !== "templates") loadTemplates().catch(() => {}); } // 탭 옆 템플릿 개수도 모드에 맞게
  $("#layout").classList.toggle("is-direct", tab === "direct");
  if (mode === "card" && modeChanged && tab !== "made") api("/api/cards").then((c) => ($("#madeCount").textContent = c.length ? `${c.length}개` : "")).catch(() => {});
  if (tab === "templates") return loadTemplates();
  if (tab === "make") return loadMake();
  if (tab === "vmake") return loadVmake();
  if (tab === "made") return loadMade();
  if (tab === "script") return loadScriptMake();
  if (tab === "scripts") return loadScripts();
  if (tab === "studio") {
    if (/^d_\d+$/.test(sub || "")) state.st = { ...(state.st?.id === sub ? state.st : {}), id: sub }; // #drama/studio/d_… — 처음 화면 썸네일에서 바로 그 드라마로
    [state.templates, state.kits] = await Promise.all([api("/api/templates"), api("/api/kits")]); return loadStudio();
  }
  if ((mode === "drama" || mode === "ad") && modeChanged) api(`/api/dramas?kind=${mode}`).then((x) => ($("#studioCount").textContent = x.length ? `${x.length}개` : "")).catch(() => {});
  if (tab === "resources") {
    // 인물·배경·제품 이미지 만들기(#person · #bg · #prod)는 같은 리소스 화면을 그 종류로만 보여 준다
    const only = ONLY_KIND[mode];
    $("#resKinds").hidden = !!only;
    $("#resTitle").textContent = only ? MODES[mode].name : "리소스";
    $("#resDesc").textContent = only ? ONLY_DESC[only]
      : "제작에 쓸 내 재료 — 인물 · 배경 · 소품·제품 · 목소리. 인물은 사람마다 폴더로 두고 얼굴 · 체형 · 전신 시트를 골라 참고 이미지와 함께 만듭니다. 넣고 뺀 이미지는 모두 기록에 남습니다.";
    await loadResources();
    window.resPage?.setKind(only || sub || state.resKind); // #res/resources/voice 처럼 종류를 고른다
    return vcLoad();
  }
  if (tab === "competitors") return loadCompetitors();
  if (tab === "direct") {
    await selectBrand("manual");
  } else {
    const b = state.brands.find((x) => x.id === state.lastBrandId) || state.brands.find((x) => x.platform !== "manual");
    await selectBrand(b ? b.id : null);
  }
}
window.addEventListener("hashchange", () => setTab(location.hash.slice(1)));
// 위 메뉴 · 왼쪽 아이콘 줄에서 지금 화면 표시 (주소 첫 칸 기준)
function markNav() {
  const k = location.hash.replace(/^#/, "").split("/")[0] || "home", on = { resources: "res", templates: "tpl" }[k] || k;
  document.querySelectorAll("[data-nav]").forEach((a) => { const is = a.dataset.nav === on; a.classList.toggle("is-on", is); if (is) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}
window.addEventListener("hashchange", markNav); markNav();

// ── 상세 ──────────────────────────────────────────────
function openDetail(ad) {
  state.detailAd = ad;
  const isVideo = !!ad.analysis?.videos?.length;
  // 템플릿으로 저장 — 영상은 영상 템플릿, 이미지는 디자인 템플릿(이미지 소재의 [템플릿 불러오기]에서 쓴다). 이미지는 변형 에셋 저장도 같이
  $("#dTpl").hidden = !isVideo && !ad.analysis?.images?.length;
  $("#dTpl").textContent = "템플릿으로 저장";
  $("#dTpl").title = isVideo ? "Claude가 광고형인지 상황극형인지 보고, 광고형은 컷 구조로 · 상황극형은 이야기 구조(인물·비트·반전)로 저장 — 릴스 제작하기에서 씁니다" : "글자 배치·색·글꼴을 디자인 템플릿으로 저장 — 템플릿 메뉴에서 봅니다";
  const hasImg = !!ad.analysis?.images?.some((im) => !im.error && !(isVideo && /poster/.test(im.file)));
  $("#dAsset").hidden = !hasImg; $("#dAsset").disabled = false; delete $("#dAsset").dataset.done;
  $("#dAsset").textContent = "이미지 변형 에셋으로 저장";
  const f = ad.files || {};
  const a = ad.analysis || { videos: [], images: [] };
  $("#dTitle").textContent = `${ad.type} · ${ad.library_id}`;

  const media = [];
  for (const [k, file] of Object.entries(f)) {
    if (/^vd_video.*\.(mp4|mov)$/.test(file)) {
      const poster = f[k.replace("video", "poster")];
      media.push(`<figure><video controls preload="metadata" src="${fileUrl(ad, file)}" ${poster ? `poster="${fileUrl(ad, poster)}"` : ""}></video><figcaption>${file}</figcaption></figure>`);
    }
  }
  for (const file of Object.values(f).filter((x) => /^ph_.*\.(jpg|png|webp|gif)$/.test(x))) {
    media.push(`<figure><img src="${fileUrl(ad, file)}" alt="${esc(file)}" loading="lazy"><figcaption>${file}</figcaption></figure>`);
  }
  $("#dMedia").innerHTML = media.join("");

  const yt = ad.platform === "youtube", manual = ad.platform === "manual";
  const lib = manual ? null : adUrl(ad, state.current);
  const mt = ad.metrics;
  const rows = ad.platform === "instagram" ? [
    ["릴스", `<a href="${lib}" target="_blank" rel="noopener">${ad.library_id} ↗</a>`],
    ["계정", `${esc(ad.advertiser)} · <a href="${IG}/${esc(ad.handle)}/" target="_blank" rel="noopener">@${esc(ad.handle)}</a>`],
    ["게시일", esc(ad.start_date)],
    ...(mt ? [
      ["평소 대비", `<b>${mt.multiple ?? "?"}배</b> <span class="muted">(릴스 ${mt.sample}개 조회수 중앙값 ${fmtN(mt.median_plays)}${mt.rank ? ` · ${mt.sample}개 중 ${mt.rank}위` : ""})</span>`],
      ["조회", `${fmtN(mt.plays)} · 좋아요 ${fmtN(mt.likes)} (${mt.like_rate ?? "?"}%) · 댓글 ${fmtN(mt.comments)} (${mt.comment_rate ?? "?"}%)`],
      ["측정", `${new Date(mt.measured_at).toLocaleString("ko-KR")} 기준`],
    ] : []),
    ["폴더", `${esc(state.current.folder)}/${ad.dir}`],
    ["분석 문서", ["analysis.md", "analysis.json"].map((x) => `<a href="${fileUrl(ad, x)}" target="_blank">${x}</a>`).join(" · ")],
  ] : [
    manual ? ["제목", esc(ad.title)] : ["광고 ID", `<a href="${lib}" target="_blank" rel="noopener">${ad.library_id} ↗</a>`],
    [manual ? "채널" : "광고주", esc(ad.advertiser)],
    ...(manual ? [["출처", ad.source === "upload" ? `업로드 · ${esc(ad.original_filename)}` : "링크"]]
      : yt ? [["마지막 게재", esc(ad.last_shown)], ["대안 수", esc(ad.variants)]] : [["상태", esc(ad.status)], ["게재 시작", esc(ad.start_date)]]),
    [manual ? "원본 링크" : "랜딩", ad.landing_url ? `<a href="${esc(ad.landing_url)}" target="_blank" rel="noopener">${esc(new URL(ad.landing_url).host)} ↗</a>` : "—"],
    ["폴더", `${esc(state.current.folder)}/${ad.dir}`],
    ["분석 문서", ["analysis.md", "analysis.json", f.analysis_manual].filter(Boolean).map((x) => `<a href="${fileUrl(ad, x)}" target="_blank">${x}</a>`).join(" · ")],
  ];
  if (ad.warning) rows.push(["주의", esc(ad.warning)]);
  $("#dMeta").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? "—"}</dd>`).join("");
  $("#dText").textContent = ad.body_text || (yt ? "(유튜브 영상 광고는 투명성 센터에 본문이 없습니다)" : "(본문 없음)");

  const parts = [];
  for (const [i, v] of a.videos.entries()) {
    const s = v.spec;
    parts.push(`<h4>영상${a.videos.length > 1 ? " " + (i + 1) : ""} 분석</h4>
      <div class="specs">
        ${spec("길이", s.duration_s + "초")}${spec("해상도", `${s.width}×${s.height}`)}${spec("비율", `${s.aspect} ${s.orientation}`)}
        ${spec("컷", v.cuts.count + "컷")}${spec("평균 컷", v.cuts.avg_s + "초")}${spec("최장 컷", v.cuts.longest_s + "초")}
        ${spec("fps", s.fps)}${spec("오디오", s.audio)}
      </div>
      <div class="timeline" aria-label="컷 길이 비율">${v.shots.map((sh) => `<i style="flex:${sh.dur}" title="#${sh.shot} ${fmtTime(sh.start)} · ${sh.dur}초"></i>`).join("")}</div>
      <details ${i === 0 ? "open" : ""}><summary class="small muted">컷 ${v.cuts.count}개${v.shots.some((x) => x.onscreen_text != null) ? " · 글자 인식 포함" : ""}${v.transcript_file ? " · 음성 인식 포함" : ""}</summary>
      <table class="shots"><thead><tr><th>#</th><th>프레임</th><th>시작</th><th>길이</th><th>화면 글자</th><th>음성 (자동 인식)</th></tr></thead><tbody>
      ${v.shots.map((sh) => `<tr><td>${sh.shot}</td><td><img src="${fileUrl(ad, sh.frame)}" alt="컷 ${sh.shot}" loading="lazy" data-seek="${sh.start}" data-video="${i}"></td><td>${fmtTime(sh.start)}</td><td>${sh.dur}s</td><td>${esc(sh.onscreen_text || "")}</td><td>${esc(sh.speech || "")}</td></tr>`).join("")}
      </tbody></table></details>
      <h4>컨택트시트</h4><img src="${fileUrl(ad, v.contact_sheet)}" alt="컷 모음" style="width:100%;border-radius:4px">`);
  }
  for (const im of a.images) {
    if (im.error) continue;
    parts.push(`<h4>이미지 분석 — ${esc(im.file)}</h4>
      <div class="specs">${spec("크기", `${im.width}×${im.height}`)}${spec("비율", `${im.aspect} ${im.orientation}`)}${spec("용량", im.size_kb + "KB")}</div>
      <div class="swatches" style="margin-top:8px">${im.dominant_colors.map((c) => `<span class="swatch"><i style="background:${c.hex}"></i>${c.hex} ${Math.round(c.ratio * 100)}%</span>`).join("")}</div>
      ${im.text_lines?.length ? `<ul class="ocr">${im.text_lines.map((l) => `<li>${esc(l.text)} <span class="muted small">${l.conf}</span></li>`).join("")}</ul>` : im.text_lines ? `<p class="muted small" style="margin-top:8px">읽힌 글자 없음</p>` : ""}`);
  }
  $("#dAnalysis").innerHTML = parts.join("");
  $("#pTopic").value = "";
  loadPrompts(ad);
  setDetailTab(state.detailTab || "info");
  $("#detail").showModal();
}
const spec = (k, v) => `<div class="spec"><span>${k}</span><b>${esc(v)}</b></div>`;

// 컷 프레임 클릭 → 영상 그 시점으로
$("#dAnalysis").addEventListener("click", (e) => {
  const img = e.target.closest("[data-seek]"); if (!img) return;
  const v = $("#dMedia").querySelectorAll("video")[Number(img.dataset.video)];
  if (v) { v.currentTime = Number(img.dataset.seek) + 0.05; v.play(); v.scrollIntoView({ block: "nearest" }); }
});
$("#dClose").addEventListener("click", () => $("#detail").close());
$("#detail").addEventListener("close", () => $("#dMedia").querySelectorAll("video").forEach((v) => v.pause()));
$("#detail").addEventListener("click", (e) => { if (e.target === $("#detail")) $("#detail").close(); });

// ── 장면별 프롬프트 ───────────────────────────────────
// 상세 화면 탭
function setDetailTab(pane) {
  if ($(`#dTabs [data-pane="${pane}"]`)?.hidden) pane = "info";
  state.detailTab = pane;
  document.querySelectorAll("#dTabs .dtabs__item").forEach((b) => { const on = b.dataset.pane === pane; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
  document.querySelectorAll("#detail .dpane").forEach((s) => (s.hidden = s.dataset.pane !== pane));
}
$("#dTabs").addEventListener("click", (e) => { const b = e.target.closest(".dtabs__item"); if (b) setDetailTab(b.dataset.pane); });
// 이미지 변형 메뉴(public/vary.js)에서 에셋을 누르면 — 그 광고의 상세 창을 [변형] 칸으로 연다 (광고 수집 화면은 건드리지 않는다)
window.openAdVariants = async (brandId, dir, image) => {
  const b = state.brands.find((x) => x.id === brandId);
  if (!b) return toast("브랜드를 찾지 못했습니다", true);
  if (state.current?.id !== brandId || !state.ads?.some((a) => a.dir === dir)) { state.current = b; state.ads = await api(`/api/brands/${brandId}/ads`); }
  const ad = state.ads.find((a) => a.dir === dir);
  if (!ad) return toast("광고를 찾지 못했습니다", true);
  state.detailTab = "variants"; state.varyImage = image || "";
  openDetail(ad);
};

async function loadPrompts(ad) {
  $("#dPrompts").innerHTML = "";
  $("#dVariants").innerHTML = `<p class="muted small">먼저 프롬프트 탭에서 [프롬프트 만들기]를 누르세요.</p>`;
  $("#dPromptCount").textContent = $("#dVariantCount").textContent = "";
  $("#dVariantTab").hidden = !ad.analysis?.images?.some((im) => !im.error && !(ad.analysis.videos?.length && /poster/.test(im.file)));
  const r = await fetch(fileUrl(ad, "prompts.json"), { cache: "no-store" });
  if (state.detailAd !== ad) return;
  if (!r.ok) return;
  const p = await r.json();
  if (p.images?.length) state.resAll = await api("/api/resources").catch(() => []);
  if (state.detailAd === ad) renderPrompts(ad, p);
}
const copyBtn = (text) => `<button class="btn btn--sm" type="button" data-copy="${esc(text)}">복사</button>`;
const promptBox = (label, text) => text ? `<div class="prompt"><span class="prompt__label">${label}</span>${esc(text)}${copyBtn(text)}</div>` : "";
const resText = (rs) => esc((rs || []).map((r) => `${r.kind}: ${r.desc}`).join(" / ") || "—");

function renderPrompts(ad, p) {
  const multi = (ad.analysis?.videos?.length || 0) > 1;
  const scenes = (p.scenes || []).map((sc) => `
    <div class="scene">
      <div class="scene__time"><b>${multi ? `영상 ${sc.video + 1} · ` : ""}컷 ${sc.shot}</b>${fmtTime(sc.start || 0)} · ${sc.dur}초
        ${sc.frame ? `<img src="${fileUrl(ad, sc.frame)}" alt="컷 ${sc.shot}" loading="lazy" data-seek="${sc.start}" data-video="${sc.video || 0}">` : ""}</div>
      <div>
        <div class="small muted" style="margin-bottom:4px">${esc(sc.purpose || "")}</div>
        ${promptBox("영상 프롬프트", sc.video_prompt_en)}
        ${promptBox("첫 프레임 이미지 프롬프트", sc.start_frame_prompt_en)}
        <dl>
          <dt>번역</dt><dd>${esc(sc.video_prompt_ko || "")}</dd>
          <dt>제외</dt><dd>${esc(sc.negative_en || "")}</dd>
          <dt>카메라</dt><dd>${esc(sc.camera || "—")}</dd>
          <dt>화면 글자</dt><dd>${esc(sc.onscreen_text || "—")} <span class="muted">(${esc(sc.text_position || "")})</span></dd>
          <dt>대사</dt><dd>${esc(sc.voiceover || "—")}</dd>
          <dt>리소스</dt><dd>${resText(sc.resources)}</dd>
        </dl>
      </div>
    </div>`).join("");
  const images = (p.images || []).map((im) => `
    <div class="scene">
      <div class="scene__time"><b>이미지</b>${esc(im.aspect || "")}
        ${im.file ? `<img src="${fileUrl(ad, im.file)}" alt="${esc(im.file)}" loading="lazy">` : ""}</div>
      <div>
        ${promptBox("이미지 프롬프트 — 글자 없음 (글자는 나중에 얹기)", im.image_prompt_en)}
        ${promptBox("이미지 프롬프트 — 글자 포함", im.image_with_text_prompt_en)}
        <dl>
          <dt>번역</dt><dd>${esc(im.image_prompt_ko || "")}</dd>
          <dt>제외</dt><dd>${esc(im.negative_en || "")}</dd>
          ${im.negative_text_en ? `<dt>제외 (글자 포함)</dt><dd>${esc(im.negative_text_en)}</dd>` : ""}
          <dt>화면 글자</dt><dd>${esc(im.onscreen_text || "—")}</dd>
          <dt>글자 배치</dt><dd>${esc(im.text_layout || "—")}</dd>
          <dt>리소스</dt><dd>${resText(im.resources)}</dd>
        </dl>
      </div>
    </div>`).join("");
  $("#dPrompts").innerHTML = `
    <div class="short">
      <div class="short__head">
        <div>${p.topic ? `<span class="tag tag--manual">${esc(p.topic)}</span> ` : ""}<span class="muted small">${new Date(p.created_at).toLocaleString("ko-KR")} · ${p.took_s}초 걸림</span>
          <p>${esc(p.style || "")}</p></div>
        <button class="btn btn--sm" type="button" data-copy="${esc(JSON.stringify(p, null, 2))}">JSON 복사</button>
      </div>
      ${(p.characters || []).length ? `<dl class="small" style="margin:8px 0">${p.characters.map((c) => `<dt><b>${esc(c.name)}</b></dt><dd>${esc(c.desc_en)}</dd>`).join("")}</dl>` : ""}
      ${scenes}${images}
    </div>`;

  // 변형 탭: 이미지마다 입력 폼 + 쌓인 변형
  const vs = p.variants || [];
  state.vmap = Object.fromEntries(vs.map((v) => [v.vid, v]));
  state.imAspect = Object.fromEntries((p.images || []).map((im) => [im.file, im.aspect]));
  $("#dPromptCount").textContent = (p.scenes?.length || 0) + (p.images?.length || 0) || "";
  $("#dVariantCount").textContent = vs.length || "";
  $("#dVariantTab").hidden = !p.images?.length;
  // 이미 에셋(또는 변형을 만든 이미지)이면 버튼을 "열기"로
  if (p.images?.some((im) => im.asset_at) || vs.length) { const b = $("#dAsset"); b.dataset.done = "1"; b.disabled = false; b.textContent = "이미지 변형에서 열기 ›"; }
  $("#dVariants").innerHTML = (p.images || []).map((im) => `
    <div class="vimg">
      ${(p.images.length > 1) ? `<div class="vimg__head"><img src="${fileUrl(ad, im.file)}" alt=""><b>${esc(im.file)}</b></div>` : ""}
      ${variantForm(im)}
      ${vs.filter((v) => v.image === im.file).map((v, i) => variantCard(ad, v, i === 0)).join("") || `<p class="muted small" style="margin-top:8px">아직 변형이 없습니다.</p>`}
    </div>`).join("");
  const byFile = Object.fromEntries((p.images || []).map((im) => [im.file, im]));
  $("#dVariants").querySelectorAll("[data-editor]").forEach((ed) => initTextEditor(ed, byFile[ed.dataset.file].text_elements));
  $("#dVariants").querySelectorAll("[data-place]").forEach((ed) => initPlaceEditor(ed, byFile[ed.dataset.file]));
  if (state.varyImage) { // 이미지 변형 메뉴에서 고른 그 이미지로 내려간다
    const el = [...$("#dVariants").querySelectorAll(".vimg")].find((v) => v.querySelector(`[data-file="${CSS.escape(state.varyImage)}"]`));
    if (p.images.length > 1) el?.scrollIntoView({ block: "start" }); state.varyImage = "";
  }
}

// ── 글자 편집기: 원본 이미지 위에 글자 상자를 놓고 위치·크기·색을 고친다 (값은 이미지 대비 %) ──
const EL_SIZES = { "작게": 1.8, "보통": 2.6, "크게": 3.8, "아주 크게": 5.5 }; // 이미지 높이 대비 글자 크기 %
const EL_ALIGN = { "왼쪽": "left", "가운데": "center", "오른쪽": "right" };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function initTextEditor(ed, original) {
  let seq = 0;
  const fresh = () => structuredClone(original || []).map((e) => ({ ...e, id: ++seq }));
  ed._els = fresh();
  ed._orig = JSON.stringify(original || []); // 고쳤는지 알아보는 데 쓴다
  const stage = ed.querySelector(".txed__stage"), layer = ed.querySelector(".txed__layer"), list = ed.querySelector(".txed__list");
  const img = stage.querySelector("img");

  const drawBoxes = () => {
    const H = stage.clientHeight || 1;
    layer.innerHTML = ed._els.map((e) => {
      const bg = !e.bg || e.bg === "none" ? "transparent" : e.bg;
      return `<div class="txed__box" data-id="${e.id}" style="left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%;color:${e.color || "#fff"};background:${bg};font-size:${(EL_SIZES[e.size] || 2.6) * H / 100}px;font-weight:${e.weight === "굵게" ? 700 : 400};text-align:${EL_ALIGN[e.align] || "center"}">${esc(e.text).replace(/\\n|\n/g, "<br>")}<i class="txed__handle"></i></div>`;
    }).join("");
  };
  const opt = (vals, cur) => vals.map((v) => `<option ${v === cur ? "selected" : ""}>${v}</option>`).join("");
  const drawList = () => {
    list.innerHTML = ed._els.map((e, i) => `<div class="txed__row" data-id="${e.id}">
      <b>${i + 1}</b>
      <textarea rows="2" data-k="text">${esc(String(e.text).replace(/\\n/g, "\n"))}</textarea>
      <div class="txed__props">
        <select data-k="size" title="크기">${opt(Object.keys(EL_SIZES), e.size)}</select>
        <select data-k="weight" title="굵기">${opt(["보통", "굵게"], e.weight)}</select>
        <select data-k="align" title="정렬">${opt(Object.keys(EL_ALIGN), e.align)}</select>
        <label title="글자색"><input type="color" data-k="color" value="${/^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#ffffff"}">글자</label>
        <label title="배경색"><input type="color" data-k="bg" value="${/^#[0-9a-f]{6}$/i.test(e.bg) ? e.bg : "#000000"}" ${!e.bg || e.bg === "none" ? "disabled" : ""}><input type="checkbox" data-k="hasbg" ${!e.bg || e.bg === "none" ? "" : "checked"}>배경</label>
        <button class="btn btn--ghost btn--sm" type="button" data-del-el>삭제</button>
      </div></div>`).join("");
  };
  const redraw = () => { drawBoxes(); drawList(); };
  if (img.complete) redraw(); else img.addEventListener("load", redraw, { once: true });
  new ResizeObserver(drawBoxes).observe(stage);

  list.addEventListener("input", (ev) => {
    const row = ev.target.closest(".txed__row"), k = ev.target.dataset.k; if (!row || !k) return;
    const e = ed._els.find((x) => x.id === Number(row.dataset.id));
    if (k === "hasbg") { e.bg = ev.target.checked ? row.querySelector("[data-k=bg]").value : "none"; row.querySelector("[data-k=bg]").disabled = !ev.target.checked; }
    else e[k] = ev.target.value;
    drawBoxes();
  });
  list.addEventListener("click", (ev) => {
    const row = ev.target.closest(".txed__row");
    if (ev.target.closest("[data-del-el]")) { ed._els = ed._els.filter((x) => x.id !== Number(row.dataset.id)); redraw(); }
  });
  ed.querySelector("[data-add-el]").addEventListener("click", () => {
    ed._els.push({ id: ++seq, text: "새 글자", role: "기타", x: 30, y: 45, w: 40, h: 8, size: "보통", weight: "굵게", color: "#ffffff", bg: "none", align: "가운데" });
    redraw();
  });
  ed.querySelector("[data-reset-el]").addEventListener("click", () => { ed._els = fresh(); redraw(); });

  // 끌기: 상자 = 이동, 모서리 = 크기
  layer.addEventListener("pointerdown", (ev) => {
    const box = ev.target.closest(".txed__box"); if (!box) return;
    ev.preventDefault();
    const e = ed._els.find((x) => x.id === Number(box.dataset.id));
    const resize = ev.target.classList.contains("txed__handle");
    const W = stage.clientWidth, H = stage.clientHeight, sx = ev.clientX, sy = ev.clientY, o = { ...e };
    box.setPointerCapture(ev.pointerId);
    list.querySelectorAll(".txed__row").forEach((r) => r.classList.toggle("is-on", r.dataset.id === box.dataset.id));
    const move = (m) => {
      const dx = (m.clientX - sx) / W * 100, dy = (m.clientY - sy) / H * 100;
      if (resize) { e.w = clamp(o.w + dx, 3, 100 - o.x); e.h = clamp(o.h + dy, 2, 100 - o.y); }
      else { e.x = clamp(o.x + dx, 0, 100 - o.w); e.y = clamp(o.y + dy, 0, 100 - o.h); }
      Object.assign(box.style, { left: e.x + "%", top: e.y + "%", width: e.w + "%", height: e.h + "%" });
    };
    const up = () => { box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); };
    box.addEventListener("pointermove", move); box.addEventListener("pointerup", up);
  });
}
// ── 소재 위치 편집기: 인물·제품·소품·로고가 들어갈 자리를 이미지 위 상자로 정한다 (원본 글자 자리는 흐리게 보여 준다) ──
const PLACE_KINDS = { person: ["인물", "#4154FF"], product: ["제품", "#E5000F"], prop: ["소품", "#008161"], logo: ["로고", "#CC4100"] };
// 원본 소재(im.subjects)는 처음부터 상자로 깔려 있어 옮기거나 없앨 수 있다. 없으면 [원본 소재 위치 불러오기]로 읽어 온다
function initPlaceEditor(ed, im) {
  let seq = 0;
  const textEls = im.text_elements || [];
  ed._pl = [];
  const stage = ed.querySelector(".txed__stage"), layer = ed.querySelector(".txed__layer"), list = ed.querySelector(".place__list");
  const load = (subjects) => {
    ed._pl = [...(subjects || []).map((x) => ({ id: ++seq, kind: x.kind, label: x.label, note: "", x: x.x, y: x.y, w: x.w, h: x.h, from: { x: x.x, y: x.y, w: x.w, h: x.h } })), ...ed._pl.filter((p) => !p.from)];
    draw();
  };
  const pos = (p) => `${Math.round(p.x)}~${Math.round(p.x + p.w)}% · ${Math.round(p.y)}~${Math.round(p.y + p.h)}%`;
  const moved = (p) => p.from && ["x", "y", "w", "h"].some((k) => Math.abs(p[k] - p.from[k]) >= 1);
  const draw = () => {
    layer.innerHTML = textEls.map((e) => `<div class="place__txt" style="left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%"></div>`).join("")
      + ed._pl.map((p) => `${p.from && (moved(p) || p.remove) ? `<div class="place__from" style="left:${p.from.x}%;top:${p.from.y}%;width:${p.from.w}%;height:${p.from.h}%;--c:${PLACE_KINDS[p.kind][1]}"></div>` : ""}
        ${p.remove ? "" : `<div class="place__box ${p.from ? "is-orig" : ""}" data-id="${p.id}" style="left:${p.x}%;top:${p.y}%;width:${p.w}%;height:${p.h}%;--c:${PLACE_KINDS[p.kind][1]}"><span>${esc(p.label || PLACE_KINDS[p.kind][0])}</span><i class="txed__handle"></i></div>`}`).join("");
    list.innerHTML = ed._pl.map((p) => `<div class="place__row ${p.remove ? "is-removed" : ""}" data-id="${p.id}">
      <i style="background:${PLACE_KINDS[p.kind][1]}"></i><strong>${PLACE_KINDS[p.kind][0]}${p.label ? ` <span class="muted small">${esc(p.label)}</span>` : ""}</strong>
      <span class="muted small" data-pos>${p.remove ? "없앰" : p.from ? (moved(p) ? `옮김 → ${pos(p)}` : "원래 자리") : `새로 · ${pos(p)}`}</span>
      <span class="place__btns">${p.from
        ? `${moved(p) ? `<button class="btn btn--ghost btn--sm" type="button" data-reset-place>원래대로</button>` : ""}<button class="btn btn--ghost btn--sm" type="button" data-remove-place>${p.remove ? "되살리기" : "없애기"}</button>`
        : `<button class="btn btn--ghost btn--sm" type="button" data-del-place>빼기</button>`}</span>
      ${p.remove ? "" : `<input data-note value="${esc(p.note || "")}" placeholder="어떻게 놓을지 (선택) — 예: 상반신, 오른손에 명함">`}</div>`).join("")
      || `<p class="muted small" style="margin:0">위 버튼으로 상자를 넣고, 끌어서 옮기거나 오른쪽 아래 모서리로 크기를 바꿉니다.</p>`;
    ed.querySelector("[data-load-subjects]").hidden = !!im.subjects;
  };
  ed._changed = () => ed._pl.filter((p) => !p.from || p.remove || moved(p) || p.note);
  const img = stage.querySelector("img");
  const start = () => load(im.subjects);
  if (img.complete) start(); else img.addEventListener("load", start, { once: true });
  ed.addEventListener("click", async (ev) => {
    const add = ev.target.closest("[data-add-place]");
    if (add) {
      const k = add.dataset.addPlace;
      ed._pl.push({ id: ++seq, kind: k, note: "", ...(k === "person" ? { x: 25, y: 15, w: 50, h: 75 } : k === "logo" ? { x: 5, y: 4, w: 22, h: 7 } : { x: 35, y: 40, w: 30, h: 25 }) });
      return draw();
    }
    const ld = ev.target.closest("[data-load-subjects]");
    if (ld) {
      ld.disabled = true; ld.textContent = "원본 소재 읽는 중… (30초 안팎)";
      try {
        const r = await api(`/api/brands/${state.current.id}/prompts/subjects`, { method: "POST", body: { dir: state.detailAd.dir, image: im.file }, busy: "원본 소재 위치 읽는 중" });
        im.subjects = r.subjects;
        load(r.subjects);
        toast(r.subjects.length ? `원본 소재 ${r.subjects.length}개를 불러왔습니다 — 끌어서 옮기세요` : "이 이미지에서 인물·제품을 찾지 못했습니다");
      } catch (err) { toast(err.message, true); }
      finally { ld.disabled = false; ld.textContent = "원본 소재 위치 불러오기"; }
      return;
    }
    const row = ev.target.closest(".place__row"); if (!row) return;
    const p = ed._pl.find((x) => x.id === Number(row.dataset.id));
    if (ev.target.closest("[data-del-place]")) ed._pl = ed._pl.filter((x) => x !== p);
    else if (ev.target.closest("[data-reset-place]")) Object.assign(p, p.from);
    else if (ev.target.closest("[data-remove-place]")) p.remove = !p.remove;
    else return;
    draw();
  });
  list.addEventListener("input", (ev) => {
    if (!ev.target.matches("[data-note]")) return;
    ed._pl.find((p) => p.id === Number(ev.target.closest("[data-id]").dataset.id)).note = ev.target.value;
  });
  layer.addEventListener("pointerdown", (ev) => {
    const box = ev.target.closest(".place__box"); if (!box) return;
    ev.preventDefault();
    const p = ed._pl.find((x) => x.id === Number(box.dataset.id));
    const resize = ev.target.classList.contains("txed__handle");
    const W = stage.clientWidth, H = stage.clientHeight, sx = ev.clientX, sy = ev.clientY, o = { ...p };
    box.setPointerCapture(ev.pointerId);
    const move = (m) => {
      const dx = (m.clientX - sx) / W * 100, dy = (m.clientY - sy) / H * 100;
      if (resize) { p.w = clamp(o.w + dx, 5, 100 - o.x); p.h = clamp(o.h + dy, 4, 100 - o.y); }
      else { p.x = clamp(o.x + dx, 0, 100 - o.w); p.y = clamp(o.y + dy, 0, 100 - o.h); }
      Object.assign(box.style, { left: p.x + "%", top: p.y + "%", width: p.w + "%", height: p.h + "%" });
      const t = list.querySelector(`[data-id="${p.id}"] [data-pos]`); if (t) t.textContent = p.from ? `옮김 → ${pos(p)}` : `새로 · ${pos(p)}`;
    };
    const up = () => { box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); draw(); };
    box.addEventListener("pointermove", move); box.addEventListener("pointerup", up);
  });
}

// ── 소재 바꿔 만들기 ──
const resOptions = (kind) => `<option value="">원본 유지</option>` +
  (state.resAll || []).filter((r) => r.kind === kind && r.files?.some((f) => f.kind === "image")).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
// 변형 만들기: ① 아이디어(주제·카피·디자인을 말로) ② 사진으로 지정(인물·제품·배경 — 없으면 가상으로) ③ 글자 직접 고치기(선택)
const VSLOTS = [["person", "인물"], ["product", "제품"], ["background", "배경"]];
function variantForm(im) {
  return `<details class="variant-form" open><summary>변형 만들기</summary>
    <form data-variant="${esc(im.file)}">
      <label class="field"><span>변형 아이디어 — 주제·카피·인물·제품·배경·색을 말로 적으세요</span>
        <textarea rows="3" data-idea placeholder="예: 제품 대신 젊은 영업사원으로 바꾸고, '전국 보험 1등이 만들어 주는 렌탈 지원금 30만 원!' 주제로, 배경은 하늘색으로"></textarea></label>
      <div class="field"><span>사진으로 지정 (선택) — 넣으면 그 사진을 따르고, 없으면 아이디어대로 가상으로 만듭니다</span>
        <div class="vslots">${VSLOTS.map(([k, label]) => `<div class="vslot">
          <strong>${label}</strong>
          <select data-res="${k}" aria-label="${label} 리소스">${resOptions(k).replace(/<option value="">[^<]*<\/option>/, `<option value="">리소스에서 고르기</option>`)}</select>
          <label class="vslot__up"><input type="file" accept="image/*" data-role-file="${k}"><span data-role-name>사진 올리기</span></label>
        </div>`).join("")}</div></div>
      <!-- 소재 위치 정하기 · 화면 글자 직접 고치기는 뺐다 (이미지 변형은 아이디어 · 리소스 · 원본 첨부로만) -->
      <div class="field"><span>원본을 참조로 첨부 (선택) — 이미지 편집 모델에 넣으면 구도가 정확히 유지됩니다</span>
        <div class="row" style="flex-wrap:wrap;gap:var(--s4)">
          <label class="check" style="min-height:32px"><input type="checkbox" data-attach-original> 원본 이미지</label>
          <label class="check" style="min-height:32px"><input type="checkbox" data-attach-flipped> 좌우반전한 원본 <span class="muted small">(앱이 직접 뒤집어 정확합니다 · 글자는 새로 얹음)</span></label>
        </div></div>
      <label class="field"><span>기타 참조 사진 (선택, 여러 장 — 소품·분위기 등)</span><input type="file" accept="image/*" multiple data-files></label>
      <button class="btn btn--primary" type="submit">변형 프롬프트 만들기</button>
    </form></details>`;
}
// 제품 일관성: B 편집형(제품 사진을 그대로 두고 주변만) · A 합성(제품 빠진 빈 배경 → 실제 제품 사진을 얹기)
function variantMake(ad, v) {
  if (!v.edit_product_en && !v.scene_noproduct_en) return "";
  const target = { type: "variant", brandId: state.current.id, dir: ad.dir, vid: v.vid };
  const aspect = state.imAspect?.[v.image] || "auto";
  const prodFirst = [...(v.refs || [])].sort((a, b) => (a.role === "product" ? -1 : 0) - (b.role === "product" ? -1 : 0));
  const origRefs = (v.refs || []).filter((r) => r.role === "original" || r.role === "flipped");
  const gens = v.generated || [], comps = v.composites || [];
  return `<div class="vmake">
    <div class="vmake__head"><strong>제품 그대로 만들기</strong> <span class="muted small">— 프롬프트로 새로 그리면 제품이 바뀝니다. 아래 둘 중 하나로 만드세요.</span></div>
    ${promptBox("B 편집형 — 첨부한 제품 사진을 그대로 두고 주변만 (이미지 편집 모델용)", v.edit_product_en)}
    ${promptBox("A 합성용 — 제품이 빠진 빈 배경 (실제 제품 사진은 앱에서 얹음)", v.scene_noproduct_en)}
    <div class="row" style="flex-wrap:wrap">
      ${v.edit_product_en ? hfBtn("B 편집형으로 만들기", { target, kind: "image", purpose: "product", prompt: v.edit_product_en, refs: prodFirst.map((r) => r.file), aspect }, true) : ""}
      ${v.scene_noproduct_en ? hfBtn("A 빈 배경 만들기", { target, kind: "image", purpose: "scene", prompt: v.scene_noproduct_en, refs: origRefs.map((r) => r.file), aspect }) : ""}
      <label class="vslot__up"><input type="file" accept="image/*" data-comp-upload="${v.vid}"><span>배경을 직접 올려 합성</span></label>
    </div>
    ${gens.length ? `<div class="vgen">${gens.map((g) => `<figure><a href="${fileUrl(ad, g.file)}" target="_blank"><img src="${fileUrl(ad, g.file)}" alt=""></a>
      <figcaption>${g.purpose === "scene" ? "A 빈 배경" : "B 편집형"} · ${esc((g.mode || "").toUpperCase())}${g.purpose === "scene" ? ` <button class="btn btn--sm" type="button" data-comp="${v.vid}" data-bg="${esc(g.file)}">제품 합성</button>` : ""}</figcaption></figure>`).join("")}</div>` : ""}
    ${comps.length ? `<div class="vgen">${comps.map((c) => `<figure><a href="${fileUrl(ad, c.file)}" target="_blank"><img src="${fileUrl(ad, c.file)}" alt=""></a><figcaption>합성 결과</figcaption></figure>`).join("")}</div>` : ""}
  </div>`;
}
$("#dVariants").addEventListener("click", (e) => {
  const t = e.target.closest("[data-vtab]");
  if (t) {
    const card = t.closest(".variant");
    card.querySelectorAll("[data-vtab]").forEach((x) => x.classList.toggle("is-on", x === t));
    card.querySelectorAll("[data-vpane]").forEach((x) => (x.hidden = x.dataset.vpane !== t.dataset.vtab));
    return;
  }
  const b = e.target.closest("[data-comp]"); if (!b) return;
  openComposite(state.detailAd, state.vmap[b.dataset.comp], fileUrl(state.detailAd, b.dataset.bg));
});
$("#dVariants").addEventListener("change", (e) => {
  const x = e.target.closest("[data-comp-upload]"); if (!x?.files[0]) return;
  openComposite(state.detailAd, state.vmap[x.dataset.compUpload], URL.createObjectURL(x.files[0]));
  x.value = "";
});
function variantCard(ad, v, open) {
  return `<details class="variant" ${open ? "open" : ""}>
    <summary><strong>${esc(v.title || v.vid)}</strong> <span class="muted small">${new Date(v.created_at).toLocaleString("ko-KR")} · ${v.took_s}초</span></summary>
    ${v.inputs?.idea ? `<p class="videa"><b>아이디어</b> ${esc(v.inputs.idea)}</p>` : ""}
    <div class="short__head"><p>${esc(v.idea_summary || v.changes || "")}</p>
      <button class="btn btn--ghost btn--sm" type="button" data-del-variant="${v.vid}">지우기</button></div>
    ${v.refs?.length ? `<div class="refs"><span class="small muted">첨부 순서</span>${v.refs.map((r) => `<a class="ref" href="${fileUrl(ad, r.file)}" target="_blank"><img src="${fileUrl(ad, r.file)}" alt=""><span>${r.n}. ${esc(r.label)}${r.name ? ` · ${esc(r.name)}` : ""}</span></a>`).join("")}</div>` : ""}
    <div class="vtabs" role="tablist" data-vtabs="${v.vid}">
      <button type="button" class="vtabs__item is-on" data-vtab="text" role="tab">글자 있는 버전</button>
      <button type="button" class="vtabs__item" data-vtab="notext" role="tab">글자 없는 버전</button>
      ${v.edit_product_en || v.scene_noproduct_en ? `<button type="button" class="vtabs__item" data-vtab="product" role="tab">제품 그대로 만들기</button>` : ""}
    </div>
    <div class="vpane" data-vpane="text">
      <p class="muted small" style="margin:0">이미지 안에 화면 글자까지 그려 넣는 프롬프트입니다.</p>
      ${v.refs?.length ? promptBox("참조 이미지 첨부용", v.ref_text_en) : ""}
      ${promptBox("글로만 (첨부 없이)", v.plain_text_en)}
      <dl><dt>화면 글자</dt><dd>${esc(v.onscreen_text || "—")}</dd><dt>글자 배치</dt><dd>${esc(v.text_layout || "—")}</dd><dt>제외</dt><dd>${esc(v.negative_text_en || "")}</dd></dl>
    </div>
    <div class="vpane" data-vpane="notext" hidden>
      <p class="muted small" style="margin:0">글자·로고 없이 그림만 — 글자는 편집에서 얹습니다 (글자 자리는 비워 둠).</p>
      ${v.refs?.length ? promptBox("참조 이미지 첨부용", v.ref_notext_en) : ""}
      ${promptBox("글로만 (첨부 없이)", v.plain_notext_en)}
      <dl><dt>제외</dt><dd>${esc(v.negative_en || "")}</dd></dl>
    </div>
    ${v.edit_product_en || v.scene_noproduct_en ? `<div class="vpane" data-vpane="product" hidden>${variantMake(ad, v)}</div>` : ""}
    <dl>
      ${v.person_source ? `<dt>인물</dt><dd>${esc(v.person_source)}</dd>` : ""}
      ${v.inputs?.placements?.length ? `<dt>정한 위치</dt><dd>${v.inputs.placements.map((p) => `${esc(PLACE_KINDS[p.kind]?.[0] || p.kind)}${p.label ? ` ${esc(p.label)}` : ""} ${p.remove ? "없앰" : `${p.from ? "옮김 → " : ""}${p.x}~${p.x + p.w}% · ${p.y}~${p.y + p.h}%`}${p.note ? ` (${esc(p.note)})` : ""}`).join("<br>")}</dd>` : ""}
      ${v.idea_summary && v.changes ? `<dt>바꾼 점</dt><dd>${esc(v.changes)}</dd>` : ""}
      <dt>번역</dt><dd>${esc(v.prompt_ko || "")}</dd>
    </dl>
  </details>`;
}
$("#dVariants").addEventListener("change", (e) => {
  const x = e.target.closest("[data-role-file]"); if (!x) return;
  const name = x.closest(".vslot__up").querySelector("[data-role-name]");
  name.textContent = x.files[0] ? `✓ ${x.files[0].name}` : "사진 올리기";
  x.closest(".vslot").classList.toggle("is-set", !!x.files[0]);
});
$("#dVariants").addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-variant]"); if (!f) return;
  e.preventDefault();
  const ad = state.detailAd, btn = f.querySelector("button[type=submit]");
  const idea = f.querySelector("[data-idea]").value.trim();
  const resources = Object.fromEntries([...f.querySelectorAll("[data-res]")].map((s) => [s.dataset.res, s.value]).filter(([, v]) => v));
  const roleFiles = [...f.querySelectorAll("[data-role-file]")].filter((x) => x.files[0]);
  const ed = f.querySelector("[data-editor]"), ta = f.querySelector("[data-texts]");
  const elements = ed?._els?.map(({ id, ...e }) => e) || null;
  const textsEdited = ed ? JSON.stringify(elements) !== ed._orig : !!ta && ta.value.trim() !== ta.defaultValue.trim();
  // 바꾼 것만 보낸다: 새로 넣은 것 · 옮긴 원본 소재 · 없앤 원본 소재 · 설명을 단 것
  const placements = (f.querySelector("[data-place]")?._changed?.() || []).map(({ id, ...p }) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) }));
  const attachOriginal = f.querySelector("[data-attach-original]").checked, attachFlipped = f.querySelector("[data-attach-flipped]").checked;
  if (!idea && !Object.keys(resources).length && !roleFiles.length && !f.querySelector("[data-files]").files.length && !textsEdited && !placements.length && !attachFlipped)
    return toast("아이디어를 적거나, 사진·위치·글자 중 하나는 바꾸세요", true);
  btn.disabled = true;
  try {
    const up = async (file) => {
      const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${file.name}: ${d.error || res.status}`);
      return d.token;
    };
    const tokens = [];
    for (const file of f.querySelector("[data-files]").files) tokens.push(await up(file));
    const roleTokens = {};
    for (const x of roleFiles) (roleTokens[x.dataset.roleFile] ||= []).push(await up(x.files[0]));
    await api(`/api/brands/${state.current.id}/prompts/variants`, { method: "POST", body: {
      dir: ad.dir, image: f.dataset.variant, resources, tokens, roleTokens, idea, textsEdited, placements, attachOriginal, attachFlipped, note: "",
      texts: ta?.value ?? "", elements,
    } });
    toast("변형 프롬프트 만드는 중 (1분 안팎) — 끝나면 이 이미지 아래에 나타납니다");
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});

$("#promptForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ad = state.detailAd; if (!ad) return;
  if (!ad.analysis?.videos?.length && !ad.analysis?.images?.some((im) => !im.error)) return toast("분석 결과가 있는 광고만 프롬프트를 만들 수 있습니다", true);
  try {
    await api(`/api/brands/${state.current.id}/prompts`, { method: "POST", body: { dir: ad.dir, topic: $("#pTopic").value } });
    toast("장면별 프롬프트 만드는 중 (1~3분) — 끝나면 여기에 나타납니다");
  } catch (err) { toast(err.message, true); }
});
async function onPromptClick(e) {
  if (e.target.closest("[data-copy]")) return; // 복사는 전체 공통 처리
  const dv = e.target.closest("[data-del-variant]");
  if (dv && confirm("이 변형을 지울까요?")) {
    await api(`/api/brands/${state.current.id}/prompts/variants/delete`, { method: "POST", body: { dir: state.detailAd.dir, vid: dv.dataset.delVariant } });
    return loadPrompts(state.detailAd);
  }
  const img = e.target.closest("[data-seek]"); if (!img) return;
  const v = $("#dMedia").querySelectorAll("video")[Number(img.dataset.video)];
  if (v) { v.currentTime = Number(img.dataset.seek) + 0.05; v.play(); v.scrollIntoView({ block: "nearest" }); }
}
$("#dPrompts").addEventListener("click", onPromptClick);
$("#dVariants").addEventListener("click", onPromptClick);

// ── 경쟁사 찾기 ───────────────────────────────────────
const CMP_TYPE_TAG = { "본사 브랜드": "", "대리점·판매점": "tag--manual", "비교·중개 플랫폼": "tag--youtube", "신규·D2C": "tag--green" };
async function loadCompetitors() {
  state.cmps = await api("/api/competitors");
  $("#cmpCount").textContent = state.cmps.length ? `${state.cmps.length}` : "";
  if (!state.cmps.find((c) => c.id === state.cmpId)) state.cmpId = state.cmps[0]?.id;
  $("#cmpHistory").innerHTML = state.cmps.map((c) => `<button class="hchip ${c.id === state.cmpId ? "is-on" : ""}" data-cmp="${c.id}">${esc(c.query)} <span class="muted">${c.competitors?.length || 0}곳 · ${new Date(c.created_at).toLocaleDateString("ko-KR")}</span></button>`).join("");
  renderCompetitors(state.cmps.find((c) => c.id === state.cmpId));
}
function renderCompetitors(r) {
  if (!r) { $("#cmpResult").innerHTML = `<p class="muted" style="padding:24px 0">아직 찾은 기록이 없습니다. 위에 제품·서비스를 적고 [찾기]를 누르세요.</p>`; return; }
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
  const registered = new Set(state.brands.map((b) => b.name));
  $("#cmpResult").innerHTML = `
    <div class="cmp-head">
      <div><h3>${esc(r.query)}${r.note ? ` <span class="muted small">· ${esc(r.note)}</span>` : ""}</h3>
        <p>${esc(r.summary || "")}</p>
        <p class="muted small">${new Date(r.created_at).toLocaleString("ko-KR")} · ${r.took_s}초 걸림</p>
        ${r.notes ? `<details class="small muted" style="margin-top:4px"><summary>찾으면서 확인 못 한 점·주의할 점</summary><p style="margin-top:4px;white-space:pre-wrap">${esc(r.notes)}</p></details>` : ""}</div>
      <button class="btn btn--ghost btn--sm" type="button" data-del-cmp="${r.id}">기록 지우기</button>
    </div>
    <div class="cmp-grid">${(r.competitors || []).map((c, i) => `
      <article class="cmp-card" data-i="${i}">
        <div class="cmp-card__top"><strong>${esc(c.name)}</strong> <span class="tag ${CMP_TYPE_TAG[c.type] ?? ""}">${esc(c.type || "")}</span>
          ${registered.has(c.name) || registered.has(`${c.name}_유튜브`) ? `<span class="tag tag--green">등록됨</span>` : ""}</div>
        <p class="cmp-card__why">${esc(c.why || "")}</p>
        <dl>
          ${c.products ? `<dt>주력</dt><dd>${esc(c.products)}</dd>` : ""}
          ${c.positioning ? `<dt>강조점</dt><dd>${esc(c.positioning)}</dd>` : ""}
          ${c.website ? `<dt>사이트</dt><dd><a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(host(c.website))} ↗</a></dd>` : ""}
          ${c.evidence?.length ? `<dt>근거</dt><dd>${c.evidence.map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.title)}">${esc(host(e.url))}</a>`).join(" · ")}</dd>` : ""}
        </dl>
        <div class="cmp-card__find">
          <select data-term aria-label="검색어">${(c.ad_search_terms?.length ? c.ad_search_terms : [c.name]).map((t) => `<option>${esc(t)}</option>`).join("")}</select>
          <button class="btn btn--sm" type="button" data-find="meta">메타 광고주 찾기</button>
          <button class="btn btn--sm" type="button" data-find="youtube">유튜브 광고주 찾기</button>
        </div>
        <div class="cands" data-cands hidden></div>
      </article>`).join("")}</div>`;
}
$("#cmpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/competitors", { method: "POST", body: { query: $("#cmpQuery").value, note: $("#cmpNote").value, count: Number($("#cmpN").value) } });
    toast("경쟁사 찾는 중 (2~5분) — 끝나면 아래에 나타납니다");
  } catch (err) { toast(err.message, true); }
});
$("#cmpHistory").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmp]"); if (!b) return;
  state.cmpId = b.dataset.cmp; loadCompetitors();
});
$("#cmpResult").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del-cmp]");
  if (del && confirm("이 경쟁사 찾기 기록을 지울까요?")) { await api(`/api/competitors/${del.dataset.delCmp}`, { method: "DELETE" }); state.cmpId = null; return loadCompetitors(); }
  const card = e.target.closest(".cmp-card"); if (!card) return;
  const comp = state.cmps.find((c) => c.id === state.cmpId).competitors[Number(card.dataset.i)];
  const box = card.querySelector("[data-cands]");

  // 광고주 검색 (메타 광고 라이브러리 / 구글 광고 투명성 센터)
  const find = e.target.closest("[data-find]");
  if (find) {
    const platform = find.dataset.find, query = card.querySelector("[data-term]").value;
    card.querySelectorAll("[data-find]").forEach((b) => (b.disabled = true));
    box.hidden = false; box.innerHTML = `<p class="muted small" style="padding:8px 12px">${PLATFORM[platform]}에서 "${esc(query)}" 찾는 중…</p>`;
    try {
      const { candidates } = await api("/api/advertisers/search", { method: "POST", body: { query, platform } });
      box.innerHTML = candidates.length
        ? candidates.map((c) => `<button type="button" class="cand" data-platform="${platform}" data-query="${esc(query)}" data-index="${c.index}" data-text="${esc(c.text)}">${esc(c.text)}</button>`).join("")
        : `<p class="muted small" style="padding:8px 12px">${PLATFORM[platform]} 광고주 후보가 없습니다. 다른 검색어를 골라 보세요.</p>`;
    } catch (err) { box.innerHTML = ""; box.hidden = true; toast(err.message, true); }
    finally { card.querySelectorAll("[data-find]").forEach((b) => (b.disabled = false)); }
    return;
  }
  // 후보 선택 → ID 확인 → 브랜드 등록
  const cand = e.target.closest(".cand");
  if (cand) {
    const { platform, query } = cand.dataset;
    box.querySelectorAll(".cand").forEach((x) => (x.disabled = true));
    cand.innerHTML += " <span class='muted'>— ID 확인 중…</span>";
    try {
      const { pageId: id } = await api("/api/advertisers/resolve", { method: "POST", body: { query, index: Number(cand.dataset.index), platform } });
      const name = prompt("브랜드 이름 (폴더 이름)", platform === "youtube" ? `${comp.name}_유튜브` : comp.name);
      if (!name) return;
      const b = await api("/api/brands", { method: "POST", body: { name: name.trim(), id, platform } });
      await loadBrands();
      toast(`${b.name} 등록됨 — 광고 수집(공용)에서 수집할 수 있습니다`);
      box.hidden = true;
      renderCompetitors(state.cmps.find((c) => c.id === state.cmpId));
    } catch (err) { toast(err.message, true); }
    finally { box.querySelectorAll(".cand").forEach((x) => (x.disabled = false)); }
  }
});

// ── 카드뉴스 ──────────────────────────────────────────
// 템플릿의 design + 장(slide) 하나 → 1080×1350 같은 실제 크기의 HTML. 미리보기는 축소해서 보여주고, PNG 는 이걸 그대로 찍는다.
const cnSize = (t) => ({ W: t.format?.width || 1080, H: t.format?.height || 1350 });
const nl = (s) => esc(s || "").replace(/\\n|\n/g, "<br>");
function cnTitle(b, d) {
  let html = nl(b.text);
  if (b.highlight && (b.text || "").includes(b.highlight)) html = html.replace(esc(b.highlight), `<span style="color:${d.__hl}">${esc(b.highlight)}</span>`);
  return html;
}
function cnBlock(b, d, W) {
  const u = W / 1080; // 1080 기준 크기를 실제 폭에 맞춘다
  const px = (n) => `${Math.round(n * u)}px`;
  const box = (dark) => `border:${px(3)} solid ${dark ? d.text : d.text};padding:${px(28)} ${px(32)};background:${dark ? d.dark_bg : "transparent"};color:${dark ? d.dark_text : d.text}`;
  switch (b.type) {
    case "label": return `<div style="font-size:${px(26)};font-weight:800;letter-spacing:.02em;margin-bottom:${px(40)}">${esc(b.text || d.label || "")}</div>`;
    case "tag": return `<div style="display:inline-block;background:${d.accent};color:${d.accent_text};font-size:${px(30)};font-weight:800;padding:${px(4)} ${px(12)};margin-bottom:${px(16)}">${esc(b.text)}</div>`;
    case "title": return `<div style="font-size:${px(d.title_size === "아주 크게" ? 92 : 76)};font-weight:900;line-height:1.22;letter-spacing:-.02em;margin-bottom:${px(36)}">${cnTitle(b, d)}</div>`;
    case "subhead": return `<div style="font-size:${px(39)};font-weight:800;margin:${px(36)} 0 ${px(14)}">${esc(b.text)}</div>`;
    case "body": return `<div style="font-size:${px(37)};line-height:1.65;color:${d.__body}">${nl(b.text)}</div>`;
    case "list": return `<div style="display:grid;gap:${px(30)};margin-top:${px(20)}">${(b.items || []).map((it, i) => `
      <div style="display:grid;grid-template-columns:${px(56)} 1fr;gap:${px(24)};align-items:start">
        <div style="background:${d.accent};color:${d.accent_text};font-weight:900;font-size:${px(30)};height:${px(56)};display:flex;align-items:center;justify-content:center">${i + 1}</div>
        <div><div style="font-size:${px(38)};font-weight:800">${esc(it.title)}</div><div style="font-size:${px(33)};color:${d.__body};margin-top:${px(4)}">${esc(it.desc)}</div></div>
      </div>`).join("")}</div>`;
    case "stat": return `<div style="margin-top:${px(d.__top === false ? 20 : 120)}"><span style="background:${d.accent};color:${d.accent_text};font-size:${px(190)};font-weight:900;line-height:1;padding:0 ${px(10)}">${esc(b.value)}</span><span style="font-size:${px(60)};font-weight:800;margin-left:${px(10)}">${esc(b.unit || "")}</span>
      <div style="font-size:${px(30)};color:${d.muted};margin-top:${px(20)}">${esc(b.caption || "")}</div></div>`;
    case "compare": return `<div style="display:grid;gap:${px(24)};margin-top:${px(20)}">
      <div style="${box(false)}"><div style="font-size:${px(26)};font-weight:800;margin-bottom:${px(14)}">${esc(b.before?.title)}</div>${(b.before?.items || []).map((x) => `<div style="font-size:${px(30)};margin:${px(8)} 0">✕ &nbsp;${esc(x)}</div>`).join("")}</div>
      <div style="padding:${px(28)} ${px(32)};background:${d.accent};color:${d.accent_text}"><div style="font-size:${px(26)};font-weight:800;margin-bottom:${px(14)}">${esc(b.after?.title)}</div>${(b.after?.items || []).map((x) => `<div style="font-size:${px(30)};margin:${px(8)} 0">✓ &nbsp;${esc(x)}</div>`).join("")}</div></div>`;
    case "box": return `<div style="${box(b.dark)};margin-top:${px(24)}">${b.title ? `<div style="font-size:${px(26)};font-weight:800;margin-bottom:${px(12)};color:${b.dark ? d.accent : d.text}">${esc(b.title)}</div>` : ""}<div style="font-size:${px(30)};line-height:1.6">${nl(b.text)}</div></div>`;
    case "quote": return `<div style="font-size:${px(150)};font-weight:900;color:${d.accent};line-height:.8;margin-top:${px(d.__top === false ? 0 : 200)}">“</div>
      <div style="font-size:${px(56)};font-weight:800;line-height:1.4;margin-top:${px(20)}">${nl(b.text)}</div>
      <div style="font-size:${px(26)};opacity:.6;margin-top:${px(36)}">— ${esc((b.source || "").replace(/^[—–-]\s*/, ""))}</div>`;
    case "note": return `<div style="font-size:${px(25)};color:${d.muted};margin-top:${px(24)};line-height:1.5">${nl(b.text)}</div>`;
    default: return "";
  }
}
// 정렬: 디자인(전체 기본) → 장(slide.align/valign) → 블록(block.align) 순으로 덮어쓴다
const CN_AL = { 왼쪽: "left", 가운데: "center", 오른쪽: "right" };
const CN_VA = { 위: "flex-start", 가운데: "center", 아래: "flex-end" };
// opts.transparent: 배경(사진·영상·바탕색)을 빼고 글자 층만 — 영상 장 합성용
const isVideoUrl = (u) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u || "");
function renderSlideHTML(t, slide, imgUrl, last, opts = {}) {
  const { W, H } = cnSize(t);
  const u = W / 1080, px = (n) => `${Math.round(n * u)}px`;
  const base = { bg: "#ffffff", text: "#111111", muted: "#666666", accent: "#d7f25a", accent_text: "#111111", dark_bg: "#111111", dark_text: "#ffffff", ...t.design };
  const lay = slide.layout || "content";
  const theme = lay === "quote" ? { bg: base.dark_bg, text: base.dark_text } : lay === "cta" ? { bg: base.accent, text: base.accent_text } : { bg: base.bg, text: base.text };
  const align = CN_AL[slide.align] || (lay === "cover" ? "center" : CN_AL[base.align] || "left");
  const vkey = CN_VA[slide.valign] ? slide.valign : lay === "cover" ? "아래" : CN_VA[base.valign] ? base.valign : "위";
  const d = { ...base, ...theme, __body: lay === "content" ? "#333333" : theme.text, __hl: lay === "cover" ? base.accent : base.text, __top: vkey === "위" };
  const al = (b, html) => CN_AL[b.align] ? `<div style="text-align:${CN_AL[b.align]}">${html}</div>` : html;
  const blk = (b, dd = d) => al(b, cnBlock(b, dd, W));
  // {{design.label}} 같은 자리표시는 디자인 값으로, 계정 표시(handle)는 바닥글이 그리므로 블록에서 뺀다
  const fill = (v) => typeof v === "string" ? v.replace(/\{\{design\.(\w+)\}\}/g, (_, k) => base[k] || "") : v;
  const blocks = (slide.blocks || [])
    .filter((b) => !JSON.stringify(b).includes("{{design.handle}}"))
    .map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, fill(v)])));
  const label = blocks.find((b) => b.type === "label");
  const rest = blocks.filter((b) => b.type !== "label");
  const font = `'Pretendard Variable', Pretendard, -apple-system, sans-serif`; // style="…" 안에 들어가므로 작은따옴표
  if (lay === "cover") {
    const title = rest.find((b) => b.type === "title");
    const others = rest.filter((b) => b !== title);
    const media = opts.transparent || !imgUrl ? ""
      : isVideoUrl(imgUrl) ? `<video src="${imgUrl}" muted autoplay loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`
      : `<img src="${imgUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`;
    return `<div class="cn-slide" style="width:${W}px;height:${H}px;position:relative;overflow:hidden;font-family:${font};word-break:keep-all;overflow-wrap:anywhere;background:${opts.transparent ? "transparent" : imgUrl ? "#000" : base.dark_bg};color:#fff">
      ${media}
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%)"></div>
      <div style="position:absolute;left:${px(80)};right:${px(80)};${vkey === "위" ? `top:${px(170)}` : vkey === "가운데" ? "top:50%;transform:translateY(-50%)" : `bottom:${px(230)}`};text-align:${align};text-shadow:0 2px 12px rgba(0,0,0,.35)">
        ${others.map((b) => blk(b, { ...d, text: "#fff", __body: "#fff" })).join("")}
        ${title ? al(title, `<div style="font-size:${px(88)};font-weight:900;line-height:1.22;letter-spacing:-.02em">${cnTitle(title, d)}</div>`) : ""}
      </div>
      ${base.handle ? `<div style="position:absolute;left:0;right:0;bottom:${px(70)};text-align:center;font-size:${px(26)};font-weight:700;opacity:.85">${esc(base.handle)}</div>` : ""}
    </div>`;
  }
  const inset = slide.image && slide.image !== "none" && imgUrl
    ? isVideoUrl(imgUrl) ? `<video src="${imgUrl}" muted autoplay loop playsinline style="width:100%;max-height:${px(520)};object-fit:cover;margin-top:${px(28)};display:block"></video>`
      : `<img src="${imgUrl}" style="width:100%;max-height:${px(520)};object-fit:cover;margin-top:${px(28)}">` : "";
  const footer = lay === "cta"
    ? `<div style="position:absolute;left:${px(80)};right:${px(80)};bottom:${px(80)};display:flex;justify-content:space-between;align-items:center"><span style="font-size:${px(30)};font-weight:800">${esc(base.handle || "")}</span><span style="background:${base.dark_bg};color:${base.dark_text};font-size:${px(30)};font-weight:800;padding:${px(14)} ${px(26)}">${esc(base.cta_button || "팔로우 →")}</span></div>`
    : lay === "quote"
      ? `<div style="position:absolute;left:${px(80)};bottom:${px(80)};font-size:${px(28)};font-weight:800;color:${base.accent}">${esc(base.handle || "")}</div>`
      : last ? "" : `<div style="position:absolute;right:${px(80)};bottom:${px(80)};background:${base.accent};color:${base.accent_text};font-size:${px(28)};font-weight:800;padding:${px(12)} ${px(22)}">${esc(base.next_button || "다음 페이지 →")}</div>`;
  return `<div class="cn-slide" style="width:${W}px;height:${H}px;position:relative;overflow:hidden;font-family:${font};word-break:keep-all;overflow-wrap:anywhere;background:${d.bg};color:${d.text};padding:${px(90)} ${px(80)};box-sizing:border-box;display:flex;flex-direction:column;text-align:${align}">
    <div>${blk(label || { type: "label", text: base.label || "" })}</div>
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:${CN_VA[vkey]};padding-bottom:${px(vkey === "위" ? 0 : 110)}">
      ${lay === "cta" && !slide.valign ? `<div style="height:${px(220)};flex:none"></div>` : ""}
      <div>${rest.map((b) => blk(b)).join("")}${inset}</div>
    </div>
    ${footer}
  </div>`;
}
// 실제 크기 슬라이드를 축소해 보여주는 틀
function scaled(html, t, w) {
  const { W, H } = cnSize(t); const k = w / W;
  return `<div class="cn-thumb" style="width:${w}px;height:${Math.round(H * k)}px"><div style="transform:scale(${k});transform-origin:0 0">${html}</div></div>`;
}

// 편집(또는 복제)한 템플릿 — 목록 썸네일을 원본 사진 대신 편집이 반영된 그림으로 보여준다
const cnEdited = (t) => !!(t.updated_at || t.forked_from);
// 원본 그대로면 원본 표지, 편집했으면 앞 4장을 다시 그린 2×2 (표지는 원본 글자가 겹치지 않게 사진 없이)
function cnTplThumb(t, w = 104) {
  if (!cnEdited(t)) return `<img src="${tplUrl(t.id, "cover.jpg")}" alt="" loading="lazy" onerror="this.remove()">`;
  const n = t.slides?.length || 0;
  return `<div class="cn-mini">${(t.slides || []).slice(0, 4).map((s, i) => scaled(renderSlideHTML(t, exampleSlide(s), s.image !== "none" && s.layout !== "cover" ? slideRef(t, s, i) : null, i === n - 1), t, w)).join("")}</div>`;
}
const cnImgLabel = (t) => `이미지 (선택, 사진 들어가는 장 ${(t.slides || []).filter((s) => s.image && s.image !== "none").length}곳에 순서대로)`;

// 템플릿 보기 — 원본과 편집이 반영된 템플릿. 만들기는 '카드뉴스 만들기' 탭에서
async function openCardTemplate(t) {
  state.cnTpl = t;
  $("#cnName").textContent = t.name || t.id;
  $("#cnSummary").textContent = [t.summary, t.source?.url ? `출처: ${t.source.url}` : ""].filter(Boolean).join(" ");
  const d = t.design || {};
  $("#cnDesign").innerHTML = ["bg", "text", "accent", "dark_bg"].filter((k) => d[k]).map((k) => `<span class="swatch"><i style="background:${esc(d[k])}"></i>${{ bg: "바탕", text: "글자", accent: "강조", dark_bg: "어두운 바탕" }[k]} ${esc(d[k])}</span>`).join("")
    + `<span class="swatch">${esc(d.font || "")} · ${esc(d.label || "")} · ${esc(d.handle || "")}</span>`;
  $("#cnFlow").innerHTML = (t.flow || []).map((f) => `<li><b>${esc(f.section)}</b> <span class="muted">${(f.slides || []).join("·")}장</span> — ${esc(f.purpose)}</li>`).join("");
  $("#cnCopy").innerHTML = (t.copy_patterns || []).map((c) => `<li>${esc(c)}</li>`).join("");
  $("#cnEdited").textContent = `${t.slides?.length || 0}장 · ${cnEdited(t) ? `편집함${t.updated_at ? " " + new Date(t.updated_at).toLocaleString("ko-KR") : ""}` : "원본 그대로"}`;
  $("#cnRefs").innerHTML = (t.media?.refs || []).map((r, i) => `<a href="${tplUrl(t.id, r)}" target="_blank"><img src="${tplUrl(t.id, r)}" alt="${i + 1}장" loading="lazy"></a>`).join("");
  const n = t.slides?.length || 0;
  $("#cnPreview").innerHTML = (t.slides || []).map((s, i) => scaled(renderSlideHTML(t, exampleSlide(s), s.image !== "none" ? slideRef(t, s, i) : null, i === n - 1), t, 168)).join("");
  if (!$("#cnDialog").open) $("#cnDialog").showModal();
}
// 장에 붙은 원본 사진 (편집기에서 순서를 바꾸면 slide.ref 로 따라간다)
const slideRef = (t, s, i) => { const r = "ref" in s ? s.ref : t.media?.refs?.[i]; return r ? tplUrl(t.id, r) : null; }; // 새 장은 ref: null
// 템플릿 예시(원문 글)로 다시 그리기
const exampleSlide = (s) => ({ ...s, blocks: (s.blocks || []).map((b) => ({ ...b, ...(b.example && typeof b.example === "object" ? b.example : {}), text: b.text ?? (typeof b.example === "string" ? b.example : b.example?.text) })) });
$("#cnClose").addEventListener("click", () => $("#cnDialog").close());
$("#cnDelete").addEventListener("click", async () => {
  if (!confirm(`카드뉴스 템플릿 "${state.cnTpl.name}" 을 지울까요? 만든 카드뉴스도 같이 지워집니다.`)) return;
  await api(`/api/templates/${state.cnTpl.id}`, { method: "DELETE" });
  $("#cnDialog").close(); loadTemplates();
});
$("#cnMake").addEventListener("click", () => {
  state.mkTplId = state.cnTpl.id;
  $("#cnDialog").close();
  if (location.hash === "#card/make") setTab("card/make"); else location.hash = "#card/make";
});

// ── 카드뉴스 만들기 탭: 템플릿 고르기 → 주제·이미지 → 만든 결과 ──
async function loadMake() {
  [state.templates, state.kits, state.linkSets] = await Promise.all([api("/api/templates"), api("/api/kits"), api("/api/linksets")]);
  fillMakeAssets();
  mkSetMode(state.mk.mode);
  const list = state.templates.filter((t) => t.kind === "cardnews");
  if (!list.some((t) => t.id === state.mkTplId)) state.mkTplId = list.length === 1 ? list[0].id : null;
  $("#mkTpls").innerHTML = list.map((t) => `
    <button class="card" type="button" data-id="${t.id}">
      <div class="card__thumb">${cnTplThumb(t)}<span class="badge">${cnEdited(t) ? "편집함" : "원본"}</span><span class="card__dur">${t.slides?.length ?? 0}장 · ${esc(t.format?.aspect || "")}</span></div>
      <div class="card__body"><div class="card__meta">${esc(t.hook_type || "")}${t.tone ? " · " + esc(t.tone) : ""}</div><strong>${esc(t.name || t.id)}</strong></div>
    </button>`).join("");
  mkSelect(state.mkTplId);
}
function mkSelect(id) {
  state.mkTplId = id;
  const t = state.templates.find((x) => x.id === id);
  document.querySelectorAll("#mkTpls .card").forEach((c) => c.classList.toggle("is-picked", c.dataset.id === id));
  $("#mkBody").hidden = !t;
  if (!t) return;
  state.cnTpl = t;
  $("#mkTplName").textContent = `— ${t.name}`;
  $("#cnImgLabel").textContent = cnImgLabel(t);
  mkPreview(); mkImgNote(); mkSummary();
}
// ── 만들기 흐름: ② 방식(브랜드 에셋 / 자료 모아서) → ③ 주제(추천·직접) → ④ 이미지 → ⑤ 만들기 ──
state.mk = { mode: "brand", fromSug: false };
function mkSetMode(mode) {
  state.mk.mode = mode;
  document.querySelectorAll("#mkModes .mk-mode").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === mode));
  $("#mkLinkField").hidden = mode !== "research";
  $("#mkKitLabel").textContent = mode === "brand" ? "브랜드 에셋 — 소개·제품·말투로 주제를 잡습니다" : "브랜드 에셋 (선택) — 색·글자·말투만 씌웁니다";
  $("#mkKit").options[0].textContent = mode === "brand" ? "에셋을 고르세요" : "안 씀 — 템플릿 그대로";
  $("#mkSugs").innerHTML = ""; state.mk.sugs = null; state.mk.fromSug = false;
  mkSummary();
}
$("#mkModes").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) mkSetMode(b.dataset.mode); });
const mkLinkList = () => $("#mkLinks").value.split("\n").map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
$("#mkSuggest").addEventListener("click", async () => {
  const btn = $("#mkSuggest"), { mode } = state.mk;
  const links = mode === "research" ? mkLinkList() : [];
  const how = mode === "brand" ? "브랜드 소개로" : links.length ? `링크 ${links.length}개를 읽고` : "웹을 찾아";
  btn.disabled = true; btn.textContent = "추천받는 중…";
  $("#mkSuggestNote").textContent = `Claude 가 ${how} 주제를 고르는 중 (${mode === "brand" ? "1분" : "2~4분"} 안팎)`;
  try {
    const r = await api(`/api/templates/${state.mkTplId}/suggest`, { method: "POST", body: { mode, kitId: $("#mkKit").value, links, keyword: $("#mkKeyword").value }, busy: "Claude 가 주제를 추천받는 중" });
    state.mk.sugs = r.topics || []; state.mk.fromSug = false;
    $("#mkSuggestNote").innerHTML = `${state.mk.sugs.length}개 추천 (${r.took_s}초) — 고르면 아래 칸이 채워집니다${r.notes ? `<details class="mk-notes"><summary>자료를 찾으며 남긴 메모 (한계·주의)</summary><p style="white-space:pre-wrap">${esc(r.notes)}</p></details>` : ""}`;
    $("#mkSugs").innerHTML = state.mk.sugs.map((x, i) => `
      <button type="button" class="mk-sug" data-sug="${i}">
        <strong>${esc(x.title)}</strong>
        <span>${esc(x.angle || "")}</span>
        <span class="muted small">${esc(x.fit || "")} · 사실 ${x.facts?.length || 0}개</span>
      </button>`).join("");
  } catch (err) { toast(err.message, true); $("#mkSuggestNote").textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "주제 추천받기"; }
});
$("#mkSugs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sug]"); if (!b) return;
  const x = state.mk.sugs[Number(b.dataset.sug)];
  document.querySelectorAll("#mkSugs .mk-sug").forEach((y) => y.classList.toggle("is-on", y === b));
  $("#cnTopic").value = x.title;
  $("#cnDetails").value = [x.angle, ...(x.facts || []).map((f) => `- ${f.text}${f.source ? ` (출처: ${f.source})` : ""}`)].filter(Boolean).join("\n");
  state.mk.fromSug = true;
  mkSummary();
});
$("#cnTopic").addEventListener("input", mkSummary);
$("#cnDetails").addEventListener("input", mkSummary);
$("#mkLinks").addEventListener("input", mkSummary);
$("#cnImages").addEventListener("change", () => {
  $("#mkImgPrev").innerHTML = [...$("#cnImages").files].map((f) => `<div class="kit-img"><img src="${URL.createObjectURL(f)}" alt=""></div>`).join("");
  mkImgNote(); mkSummary();
});
function mkImgNote() {
  const t = state.templates?.find((x) => x.id === state.mkTplId); if (!t) return;
  const slots = (t.slides || []).filter((s) => s.image && s.image !== "none").length;
  const kit = state.kits?.find((k) => k.id === $("#mkKit").value);
  const up = $("#cnImages").files.length;
  $("#mkImgNote").textContent = up ? `올린 사진 ${up}장을 사진 들어가는 장 ${slots}곳에 순서대로 넣습니다.`
    : kit?.images?.length ? `사진을 안 올리면 브랜드 에셋 "${kit.name}" 사진 ${kit.images.length}장을 씁니다.`
    : `사진 들어가는 장이 ${slots}곳 있습니다. 안 올리면 그 장은 어두운 바탕으로 그립니다.`;
}
function mkSummary() {
  const t = state.templates?.find((x) => x.id === state.mkTplId); if (!t) return;
  const kit = state.kits?.find((k) => k.id === $("#mkKit").value);
  const links = state.mk.mode === "research" ? mkLinkList() : [];
  const up = $("#cnImages").files.length;
  $("#mkSummary").innerHTML = [
    `템플릿: ${esc(t.name)} (${t.slides?.length || 0}장)`,
    `방식: ${state.mk.mode === "brand" ? "브랜드 에셋으로" : "자료 모아서"}${kit ? ` · 에셋 ${esc(kit.name)}` : ""}`,
    `주제: ${esc($("#cnTopic").value) || "<span class='muted'>아직 없음</span>"}`,
    `자료: ${$("#cnDetails").value.trim() ? `참고 내용 ${$("#cnDetails").value.trim().length}자` : "참고 내용 없음"}${links.length && !state.mk.fromSug ? ` · 링크 ${links.length}개를 만들 때 읽음` : ""}`,
    `이미지: ${up ? `올린 사진 ${up}장` : kit?.images?.length ? `에셋 사진 ${kit.images.length}장` : "없음"}`,
  ].map((x) => `<li>${x}</li>`).join("");
}
// 고른 브랜드 에셋의 디자인을 씌운 미리보기
function mkPreview() {
  const t0 = state.templates.find((x) => x.id === state.mkTplId); if (!t0) return;
  const kit = state.kits?.find((k) => k.id === $("#mkKit").value);
  const t = kit?.design && Object.keys(kit.design).length ? { ...t0, design: { ...t0.design, ...kit.design } } : t0;
  const n = t.slides?.length || 0;
  $("#mkPreview").innerHTML = (t.slides || []).map((s, i) => scaled(renderSlideHTML(t, exampleSlide(s), s.image !== "none" ? slideRef(t, s, i) : null, i === n - 1), t, 90)).join("");
}
const kitImg = (k, f) => `/data/_brand_kits/${k.id}/${f}`;
function fillMakeAssets() {
  const kv = $("#mkKit").value, lv = $("#mkLinkSet").value;
  $("#mkKit").innerHTML = `<option value="">안 씀 — 템플릿 그대로</option>` + (state.kits || []).map((k) => `<option value="${k.id}" ${k.id === kv ? "selected" : ""}>${esc(k.name)}</option>`).join("");
  $("#mkLinkSet").innerHTML = `<option value="">저장한 링크 묶음 불러오기</option>` + (state.linkSets || []).map((x) => `<option value="${x.id}" ${x.id === lv ? "selected" : ""}>${esc(x.name)} (${x.urls.length})</option>`).join("");
  $("#mkLinkDel").disabled = !$("#mkLinkSet").value;
  mkKitInfo();
}
function mkKitInfo() {
  const k = state.kits?.find((x) => x.id === $("#mkKit").value);
  $("#mkKitInfo").innerHTML = !k ? "" : [
    Object.keys(k.design || {}).length ? `색·글자 ${["accent", "bg", "text"].filter((c) => k.design[c]).map((c) => `<i class="dot" style="background:${esc(k.design[c])}"></i>`).join("")}` : "디자인 없음",
    k.about ? `소개 ${k.about.length}자` : "소개 없음",
    k.images?.length ? `사진 ${k.images.length}장 (올린 사진이 없을 때 씀)` : "사진 없음",
  ].join(" · ");
}
$("#mkKit").addEventListener("change", () => { mkKitInfo(); mkPreview(); mkImgNote(); mkSummary(); });
$("#mkLinkSet").addEventListener("change", () => {
  const x = state.linkSets.find((v) => v.id === $("#mkLinkSet").value);
  $("#mkLinkDel").disabled = !x;
  if (x) $("#mkLinks").value = x.urls.join("\n");
});
$("#mkLinkSave").addEventListener("click", async () => {
  const cur = state.linkSets?.find((v) => v.id === $("#mkLinkSet").value);
  const name = prompt("링크 묶음 이름 (같은 이름이면 덮어씁니다)", cur?.name || $("#cnTopic").value || "");
  if (!name) return;
  try {
    const set = await api("/api/linksets", { method: "POST", body: { name, urls: $("#mkLinks").value } });
    state.linkSets = await api("/api/linksets"); $("#mkLinkSet").value = set.id; fillMakeAssets();
    toast(`"${set.name}" 묶음을 저장했습니다 (${set.urls.length}개)`);
  } catch (err) { toast(err.message, true); }
});
$("#mkLinkDel").addEventListener("click", async () => {
  const x = state.linkSets.find((v) => v.id === $("#mkLinkSet").value);
  if (!x || !confirm(`"${x.name}" 링크 묶음을 지울까요?`)) return;
  await api(`/api/linksets/${x.id}`, { method: "DELETE" });
  state.linkSets = await api("/api/linksets"); $("#mkLinkSet").value = ""; fillMakeAssets();
});

// ── 브랜드 에셋 관리 ──
let kitSel = null;
// 브랜드 기본 정보 칸 (서버 KIT_PROFILE) — 카드뉴스·포스터·인물 라디오가 같이 쓰는 맥락
const kitProfileHTML = (fields, prof = {}) => fields.map(([k, l]) => `<label class="field"><span>${esc(l)}</span><textarea data-kp="${k}" rows="${k === "offer" || k === "usp" || k === "target" ? 2 : 1}">${esc(prof?.[k] || "")}</textarea></label>`).join("");
const readKitProfile = (root) => Object.fromEntries([...root.querySelectorAll("[data-kp]")].map((x) => [x.dataset.kp, x.value]));
async function kitAutofill(url, name, root, btn) {
  if (!/^https?:\/\//.test(url)) return toast("https:// 로 시작하는 주소를 넣으세요", true);
  btn.disabled = true; const t = btn.textContent; btn.textContent = "읽는 중… (1~2분)";
  try {
    const j = await api("/api/kits/autofill", { method: "POST", body: { url, name } });
    root.querySelectorAll("[data-kp]").forEach((x) => { if (j[x.dataset.kp] && !x.value.trim()) x.value = j[x.dataset.kp]; }); // 비어 있는 칸만 채운다
    toast(`채웠습니다 — 읽은 곳 ${(j.sources || []).length}개. 확인하고 저장하세요`);
    return j;
  } catch (err) { toast(err.message, true); } finally { btn.disabled = false; btn.textContent = t; }
}
async function openKits(id) {
  state.kits = await api("/api/kits");
  state.kitProfile ||= await api("/api/kit-profile").catch(() => []);
  kitSel = id ?? kitSel;
  if (!state.kits.some((k) => k.id === kitSel)) kitSel = state.kits[0]?.id || null;
  renderKits();
  if (!$("#kitDialog").open) $("#kitDialog").showModal();
}
function renderKits() {
  $("#kitList").innerHTML = state.kits.map((k) => `<li><button type="button" class="kit-item ${k.id === kitSel ? "is-on" : ""}" data-kit="${k.id}">${esc(k.name)}<span class="muted small">${k.images?.length || 0}장</span></button></li>`).join("") || `<li class="muted small">아직 에셋이 없습니다</li>`;
  const k = state.kits.find((x) => x.id === kitSel);
  $("#kitForm").hidden = !k && kitSel !== "new";
  if (!k && kitSel !== "new") return;
  $("#kitName").value = k?.name || "";
  $("#kitAbout").value = k?.about || "";
  $("#kitProfile").innerHTML = kitProfileHTML(state.kitProfile || [], k?.profile);
  const d = k?.design || {};
  $("#kitDesign").innerHTML = Object.keys(d).length ? CE_COLORS.filter(([c]) => d[c]).map(([c, l]) => `<span class="swatch"><i style="background:${esc(d[c])}"></i>${l}</span>`).join("") + `<span class="swatch">${esc(d.label || "")} · ${esc(d.handle || "")}</span>` : `<span class="muted small">아직 없음</span>`;
  $("#kitImgs").innerHTML = (k?.images || []).map((f) => `<div class="kit-img"><img src="${kitImg(k, f)}" alt=""><button type="button" class="btn btn--ghost btn--sm" data-kimg="${f}" aria-label="사진 빼기">✕</button></div>`).join("");
  $("#kitDelete").hidden = !k;
}
$("#kitList").addEventListener("click", (e) => { const b = e.target.closest("[data-kit]"); if (b) { kitSel = b.dataset.kit; renderKits(); } });
$("#kitFill").addEventListener("click", async (e) => { const j = await kitAutofill($("#kitUrl").value.trim(), $("#kitName").value, $("#kitProfile"), e.currentTarget); if (j?.name && !$("#kitName").value.trim()) $("#kitName").value = j.name; });
$("#kitNew").addEventListener("click", () => { kitSel = "new"; renderKits(); $("#kitName").focus(); });
async function kitSave() {
  const body = { name: $("#kitName").value, about: $("#kitAbout").value, profile: readKitProfile($("#kitProfile")) };
  const k = kitSel === "new" ? await api("/api/kits", { method: "POST", body }) : await api(`/api/kits/${kitSel}`, { method: "PUT", body });
  kitSel = k.id;
  return k;
}
$("#kitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await kitSave(); toast("에셋을 저장했습니다"); await openKits(); } catch (err) { toast(err.message, true); }
});
$("#kitFiles").addEventListener("change", async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  try {
    if (kitSel === "new") { if (!$("#kitName").value.trim()) throw new Error("이름부터 적으세요"); await kitSave(); }
    const tokens = [];
    for (const f of files) {
      const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${f.name}: ${d.error || res.status}`);
      tokens.push(d.token);
    }
    await api(`/api/kits/${kitSel}/images`, { method: "POST", body: { tokens } });
    e.target.value = ""; await openKits();
  } catch (err) { toast(err.message, true); }
});
$("#kitImgs").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-kimg]"); if (!b) return;
  await api(`/api/kits/${kitSel}/images/${b.dataset.kimg}`, { method: "DELETE" }); await openKits();
});
$("#kitDelete").addEventListener("click", async () => {
  const k = state.kits.find((x) => x.id === kitSel);
  if (!k || !confirm(`"${k.name}" 에셋을 지울까요? 사진도 같이 지워집니다. 이미 만든 카드뉴스는 그대로입니다.`)) return;
  await api(`/api/kits/${k.id}`, { method: "DELETE" }); kitSel = null; await openKits();
});
$("#kitClose").addEventListener("click", () => $("#kitDialog").close());
$("#kitDialog").addEventListener("close", () => { if (state.tab === "make") { fillMakeAssets(); mkPreview(); } });
$("#mkKitManage").addEventListener("click", () => openKits($("#mkKit").value || undefined));
$("#mkTpls").addEventListener("click", (e) => {
  const c = e.target.closest(".card"); if (!c) return;
  mkSelect(c.dataset.id);
  $("#mkBody").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#cnForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.mk.mode === "brand" && !$("#mkKit").value) return toast("브랜드 에셋을 고르세요 (2단계)", true);
  const btn = $("#cnBtn"); btn.disabled = true;
  try {
    const tokens = [];
    for (const f of $("#cnImages").files) {
      const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${f.name}: ${d.error || res.status}`);
      tokens.push(d.token);
    }
    await api(`/api/templates/${state.cnTpl.id}/cards`, { method: "POST", body: {
      topic: $("#cnTopic").value, details: $("#cnDetails").value, tokens, kitId: $("#mkKit").value,
      // 추천 주제를 골랐으면 모은 사실이 참고 내용에 들어 있으니 링크는 다시 읽지 않는다
      links: state.mk.mode === "research" && !state.mk.fromSug ? mkLinkList() : [],
    } });
    toast("카드뉴스 쓰는 중 (1~2분) — 끝나면 만든 카드뉴스 탭으로 넘어갑니다");
  } catch (err) { toast(err.message, true); btn.disabled = false; }
});

// ── 만든 카드뉴스 ──
const cardUrl = (t, c, f) => tplUrl(t.id, `cards/${c.cid}/${f}`);
// 카드뉴스마다 덮어쓴 색·글자(c.design)를 템플릿 디자인 위에 얹는다
const cardTpl = (t, c) => (c.design && Object.keys(c.design).length ? { ...t, design: { ...t.design, ...c.design } } : t);
const cardMedia = (t, c, s) => (s.video_file ? cardUrl(t, c, s.video_file) : s.image_file ? cardUrl(t, c, s.image_file) : null);
const cardMap = new Map(); // "tpl_id/cid" → { t, c }
function cardHTML(t, c) {
  cardMap.set(`${t.id}/${c.cid}`, { t, c });
  const tt = cardTpl(t, c), out = c.pngs || [];
  const vids = out.filter((f) => f.endsWith(".mp4")).length;
  return `
    <div class="short" data-tpl="${t.id}" data-cid="${c.cid}" id="card-${c.cid}">
      <div class="short__head">
        <div><strong>${esc(c.title || c.topic)}</strong> <span class="muted small">${new Date(c.created_at).toLocaleString("ko-KR")}${c.updated_at ? " · 고침 " + new Date(c.updated_at).toLocaleString("ko-KR") : ""} · 템플릿 ${esc(t.name || t.id)}</span>
          <p class="small">${out.length ? `${out.length - vids ? `PNG ${out.length - vids}장` : ""}${vids ? `${out.length - vids ? " · " : ""}MP4 ${vids}장` : ""} 저장됨 — <code>_templates/${t.id}/cards/${c.cid}/</code>` : "아직 그림으로 저장하지 않음"}</p></div>
        <div class="row">
          <button class="btn btn--primary btn--sm" type="button" data-edit>편집</button>
          <button class="btn btn--sm" type="button" data-png>다시 저장</button>
          <button class="btn btn--sm" type="button" data-copy="${esc(c.caption || "")}">캡션 복사</button>
          <button class="btn btn--ghost btn--sm" type="button" data-del-card>지우기</button>
        </div>
      </div>
      <div class="cn-strip cn-strip--out">${(c.slides || []).map((s, i) => `<a ${out[i] ? `href="${cardUrl(t, c, out[i])}" target="_blank"` : ""}>${scaled(renderSlideHTML(tt, s, cardMedia(t, c, s), i === c.slides.length - 1), tt, 150)}</a>`).join("")}</div>
      ${c.caption ? `<details class="small"><summary>캡션</summary><p style="white-space:pre-wrap;margin-top:4px">${esc(c.caption)}</p></details>` : ""}
      ${c.sources?.length ? `<details class="small"><summary>읽은 자료 ${c.sources.length}개${c.kit ? ` · 브랜드 에셋 ${esc(c.kit.name)}` : ""}</summary><ul class="cn-flow" style="margin-top:4px">${c.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a> — ${esc(x.used || "")}</li>`).join("")}</ul></details>` : c.kit ? `<p class="muted small">브랜드 에셋 ${esc(c.kit.name)}</p>` : ""}
    </div>`;
}
async function loadMade() {
  const [tpls, cards] = await Promise.all([api("/api/templates"), api("/api/cards")]);
  state.templates = tpls;
  const byId = new Map(tpls.map((t) => [t.id, t]));
  const all = cards.filter((c) => byId.has(c.tpl_id));
  $("#madeCount").textContent = all.length ? `${all.length}개` : "";
  const used = [...new Set(all.map((c) => c.tpl_id))];
  const cur = used.includes($("#madeFilter").value) ? $("#madeFilter").value : "";
  $("#madeFilter").innerHTML = `<option value="">전체 (${all.length})</option>` + used.map((id) => `<option value="${id}" ${id === cur ? "selected" : ""}>${esc(byId.get(id).name || id)} (${all.filter((c) => c.tpl_id === id).length})</option>`).join("");
  $("#madeList").innerHTML = all.filter((c) => !cur || c.tpl_id === cur).map((c) => cardHTML(byId.get(c.tpl_id), c)).join("");
  // 방금 만든 카드뉴스는 바로 그림으로 저장
  const auto = state.madeAuto && all.find((c) => c.tpl_id === state.madeAuto.id && c.cid === state.madeAuto.cid);
  if (auto) { state.madeAuto = null; $(`#card-${auto.cid}`)?.scrollIntoView({ block: "start" }); exportPngs(byId.get(auto.tpl_id), auto); }
}
$("#madeFilter").addEventListener("change", loadMade);

// html-to-image 로 실제 크기 슬라이드를 PNG 로 찍어 서버에 저장. 영상 장은 글자 층만 찍어 서버가 영상 위에 얹는다(MP4)
let h2i;
async function exportPngs(t0, c) {
  if (!c) return;
  const t = cardTpl(t0, c);
  h2i ||= await import("https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm");
  const stage = document.createElement("div");
  stage.style.cssText = "position:fixed;left:-20000px;top:0;";
  document.body.append(stage);
  try {
    await document.fonts.ready;
    const { W, H } = cnSize(t);
    for (const [i, s] of (c.slides || []).entries()) {
      const vid = s.video_file && s.layout === "cover";
      setJob(`카드뉴스 ${vid ? "영상" : "PNG"} ${i + 1}/${c.slides.length}`, "run");
      stage.innerHTML = renderSlideHTML(t, s, vid ? null : cardMedia(t0, c, s), i === c.slides.length - 1, { transparent: vid });
      const node = stage.firstElementChild;
      await Promise.all([...node.querySelectorAll("img")].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      const data = await h2i.toPng(node, { width: W, height: H, pixelRatio: 1, cacheBust: true });
      if (vid) await api(`/api/templates/${t0.id}/cards/${c.cid}/video`, { method: "POST", body: { n: i + 1, video: s.video_file, data, width: W, height: H } });
      else await api(`/api/templates/${t0.id}/cards/${c.cid}/png`, { method: "POST", body: { n: i + 1, data } });
    }
    setJob(`카드뉴스 ${c.slides.length}장 저장`, "ok");
    toast(`${c.slides.length}장을 저장했습니다`);
  } catch (err) { toast(`저장 실패: ${err.message}`, true); setJob(`카드뉴스 저장 실패`, "err"); }
  finally { stage.remove(); if (state.tab === "made") loadMade(); }
}
async function onCardClick(e) {
  const box = e.target.closest("[data-cid]"); if (!box) return;
  const it = cardMap.get(`${box.dataset.tpl}/${box.dataset.cid}`); if (!it) return;
  if (e.target.closest("[data-copy]")) return; // 복사는 전체 공통 처리
  if (e.target.closest("[data-edit]")) return openMadeEditor(it.t, it.c);
  if (e.target.closest("[data-png]")) return exportPngs(it.t, it.c);
  if (e.target.closest("[data-del-card]") && confirm("이 카드뉴스를 지울까요?")) {
    await api(`/api/templates/${it.t.id}/cards/${it.c.cid}`, { method: "DELETE" }); loadMade();
  }
}
$("#madeList").addEventListener("click", onCardClick);

// ── 템플릿 JSON 내보내기: 다른 채팅에 붙여 쓰는 구조 템플릿 (내부 ID·파일 경로는 뺀다) ──
const CN_BLOCK_GUIDE = {
  label: "맨 위 작은 머리말 (계정·시리즈 이름). {{design.label}} 은 design.label 로 바꾼다",
  tag: "강조색 배경의 짧은 꼬리표", title: "큰 제목. \\n 으로 줄바꿈, highlight 는 강조색으로 칠할 제목 속 낱말",
  subhead: "굵은 소제목", body: "본문 문단", list: "번호 목록 items[{title, desc}]", stat: "큰 숫자 value + unit + caption",
  compare: "전·후 비교 before/after {title, items[]}", box: "테두리 상자 (dark: true 면 어두운 상자) title + text",
  quote: "인용 text + source", note: "작은 주석",
};
function portableTemplate(t, withExamples = true) {
  const strip = (b) => {
    if (withExamples) return b;
    const keep = { type: b.type, max_chars: b.max_chars, ...(b.align ? { align: b.align } : {}), ...(b.dark ? { dark: true } : {}) };
    if (b.type === "list") keep.items_count = b.items?.length;
    if (b.type === "compare") keep.items_count = { before: b.before?.items?.length, after: b.after?.items?.length };
    return keep;
  };
  const src = t.source ? { brand: t.source.brand, platform: t.source.platform, url: t.source.url || undefined } : undefined;
  if (t.kind === "cardnews") {
    return {
      schema: "cardnews-template/v1",
      how_to_use: "카드뉴스 구조 템플릿이다. 새 주제를 받으면 slides 의 장 수·순서·layout·블록 종류와 순서를 그대로 지키고, 블록마다 max_chars(글자 수 상한)를 넘기지 않게 글만 새로 쓴다. copy_patterns 의 문장 공식과 tone 을 따른다. 예시 글의 사실·이름은 가져오지 않고, 확인 안 된 수치는 [수치] 처럼 빈칸으로 둔다. 결과는 slides 와 같은 구조의 JSON 과 caption(caption_pattern 구조)으로 낸다.",
      name: t.name, summary: t.summary, hook_type: t.hook_type, tone: t.tone,
      format: { width: t.format?.width, height: t.format?.height, aspect: t.format?.aspect, slide_count: t.slides?.length },
      design: t.design, flow: t.flow,
      slides: (t.slides || []).map((s, i) => {
        const { ref, _k, image_file, ...rest } = exampleSlide(s);
        return { ...rest, n: i + 1, blocks: (rest.blocks || []).map(({ example, ...b }) => strip(b)) };
      }),
      copy_patterns: t.copy_patterns, caption_pattern: t.caption_pattern, notes: t.notes,
      reference: {
        layouts: { cover: "사진이 깔린 표지", content: "밝은 바탕 정보 카드", quote: "어두운 바탕 인용", cta: "강조색 바탕 마무리" },
        image: { full: "사진 전체 배경", inset: "본문 사이 사진", none: "사진 없음" },
        blocks: CN_BLOCK_GUIDE,
        align: "장 align(왼쪽|가운데|오른쪽)·valign(위|가운데|아래), 블록 align. 없으면 design.align/valign",
      },
      source: src,
    };
  }
  if (t.kind === "drama") {
    return {
      schema: "drama-template/v1",
      how_to_use: "숏폼 드라마·상황극 이야기 틀이다. 새 제품·주제를 받으면 beats 의 순서·시간 비율·반복 장치(running_gag)·반전(twist)·제품이 들어오는 방식(product_role)을 그대로 지키고, 인물 구성(characters)을 제품에 맞게 바꿔 장면별 대본(시간·화면·대사·자막·카메라)을 쓴다. 원본 대사(example_dialogue)·이름·사실은 가져오지 않는다.",
      name: t.name, summary: t.summary, logline_pattern: t.logline_pattern, genre: t.genre, hook_type: t.hook_type, tone: t.tone,
      format: t.format, characters: t.characters,
      beats: (t.beats || []).map((b) => (withExamples ? b : (({ example_dialogue, ...y }) => y)(b))),
      running_gag: t.running_gag, twist: t.twist, product_role: t.product_role, dialogue_style: t.dialogue_style,
      timing: t.timing, sound: t.sound, copy_patterns: t.copy_patterns, notes: t.notes, source: src,
    };
  }
  return {
    schema: "video-template/v1",
    how_to_use: "숏폼·광고 영상 구조 템플릿이다. 새 제품·주제를 받으면 structure 의 흐름과 slots(컷)의 순서·길이(dur 초)·역할·구도·카메라·자막 패턴을 따라 새 영상의 컷 구성, 화면 글자, 내레이션, 장면별 영상 생성 프롬프트를 쓴다. 예시(example)의 브랜드·사실은 가져오지 않는다.",
    name: t.name, summary: t.summary, hook_type: t.hook_type, tone: t.tone,
    format: t.format, structure: t.structure,
    slots: (t.slots || []).map(({ frame, ...x }) => (withExamples ? x : (({ example, ...y }) => y)(x))),
    copy_patterns: t.copy_patterns, music: t.music, brand_elements: t.brand_elements, notes: t.notes,
    source: src,
  };
}
let jsonTpl = null;
function openJson(t) {
  jsonTpl = t;
  renderJson();
  $("#jsonDialog").showModal();
}
function renderJson() {
  const text = JSON.stringify(portableTemplate(jsonTpl, $("#jsonExamples").checked), null, 2);
  $("#jsonText").value = text;
  $("#jsonInfo").textContent = `${jsonTpl.kind === "cardnews" ? "카드뉴스" : jsonTpl.kind === "drama" ? "드라마" : "영상"} · ${(new Blob([text]).size / 1024).toFixed(1)}KB`;
}
$("#jsonExamples").addEventListener("change", renderJson);
$("#jsonCopy").addEventListener("click", () => copyText($("#jsonText").value, "JSON 을 복사했습니다 — 다른 채팅에 붙여 넣으세요"));
$("#jsonDown").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([$("#jsonText").value], { type: "application/json" }));
  a.download = `${(jsonTpl.name || jsonTpl.id).replace(/[\\/:*?"<>|]/g, "").slice(0, 40).trim()}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#jsonClose").addEventListener("click", () => $("#jsonDialog").close());
$("#cnJson").addEventListener("click", () => openJson(state.cnTpl));
$("#tJson").addEventListener("click", () => openJson(state.tpl));

// ── 드라마 릴스: 템플릿 보기 · 대본 만들기 · 만든 대본 ─────────────
const fmtS = (n) => `${Number(n || 0).toFixed(1).replace(/\.0$/, "")}초`;
function beatTable(beats, chars) {
  return `<div class="table-wrap"><table class="shots dr-beats"><thead><tr><th>시간</th><th>비트</th><th>무슨 일</th><th>대사 형식</th></tr></thead><tbody>${(beats || []).map((b) => `
    <tr><td>${fmtS(b.start)}–${fmtS(b.end)}</td><td><span class="tag">${esc(b.beat)}</span></td>
    <td>${esc(b.what || "")}${b.camera ? `<div class="muted small">${esc(b.camera)}</div>` : ""}</td>
    <td>${esc(b.dialogue_pattern || "")}${b.example_dialogue ? `<div class="muted small">원래: ${esc(b.example_dialogue)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}
function openDramaTemplate(t) {
  state.drTpl = t;
  $("#drName").textContent = t.name || t.id;
  $("#drVideo").src = t.media?.video ? tplUrl(t.id, t.media.video) : "";
  $("#drVideo").poster = t.media?.cover ? tplUrl(t.id, t.media.cover) : "";
  $("#drSummary").textContent = [t.summary, t.logline_pattern ? `공식: ${t.logline_pattern}` : ""].filter(Boolean).join(" ");
  $("#drMeta").innerHTML = [["장르", t.genre], ["길이", t.format?.duration_s ? `${t.format.duration_s}초 · 컷 ${t.format.shot_count}` : ""], ["반복 장치", t.running_gag], ["반전", t.twist], ["제품 역할", t.product_role], ["대사 스타일", t.dialogue_style], ["타이밍", t.timing], ["소리", t.sound], ["출처", t.source?.url ? `<a href="${esc(t.source.url)}" target="_blank" rel="noopener">${esc(t.source.brand || "링크")} ↗</a>` : esc(t.source?.brand || "")]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${k === "출처" ? v : esc(v)}</dd>`).join("");
  $("#drChars").innerHTML = (t.characters || []).map((c) => `<div class="dr-char"><b>${esc(c.id)}</b> <strong>${esc(c.role || "")}</strong><div class="muted small">${esc([c.archetype, c.relation, c.look, c.voice].filter(Boolean).join(" · "))}</div></div>`).join("");
  $("#drBeats").innerHTML = beatTable(t.beats);
  $("#drDialog").showModal();
}
$("#drClose").addEventListener("click", () => { $("#drVideo").pause(); $("#drDialog").close(); });
$("#drJson").addEventListener("click", () => openJson(state.drTpl));
$("#drDelete").addEventListener("click", async () => {
  if (!confirm(`드라마 템플릿 "${state.drTpl.name}" 을 지울까요? 이 템플릿으로 쓴 대본도 같이 지워집니다.`)) return;
  await api(`/api/templates/${state.drTpl.id}`, { method: "DELETE" });
  $("#drDialog").close(); loadTemplates();
});
// 이 이야기 구조를 참고로 새 드라마를 시작한다
$("#drMake").addEventListener("click", async () => {
  const d = await api("/api/dramas", { method: "POST", body: { inputs: { length: Math.round(state.drTpl.format?.duration_s || 60), aspect: "9:16", genres: [], tpl_id: state.drTpl.id } } });
  state.st = d; state.stView = 0;
  $("#drVideo").pause(); $("#drDialog").close();
  if (location.hash === "#drama/studio") setTab("drama/studio"); else location.hash = "#drama/studio";
});

async function loadScriptMake() {
  [state.templates, state.kits] = await Promise.all([api("/api/templates"), api("/api/kits")]);
  const list = state.templates.filter((t) => t.kind === "drama");
  if (!list.some((t) => t.id === state.scTplId)) state.scTplId = list.length === 1 ? list[0].id : null;
  $("#scTpls").innerHTML = list.map((t) => `
    <button class="card" type="button" data-id="${t.id}">
      <div class="card__thumb"><img src="${tplUrl(t.id, "cover.jpg")}" alt="" loading="lazy" onerror="this.remove()"><span class="badge">${esc(t.genre || "드라마")}</span><span class="card__dur">${t.format?.duration_s ?? "?"}초 · 비트 ${t.beats?.length ?? 0}</span></div>
      <div class="card__body"><div class="card__meta">${esc(t.tone || "")}</div><strong>${esc(t.name || t.id)}</strong></div>
    </button>`).join("");
  const kv = $("#scKit").value;
  $("#scKit").innerHTML = `<option value="">안 씀</option>` + (state.kits || []).map((k) => `<option value="${k.id}" ${k.id === kv ? "selected" : ""}>${esc(k.name)}</option>`).join("");
  scSelect(state.scTplId);
}
function scSelect(id) {
  state.scTplId = id;
  const t = state.templates.find((x) => x.id === id);
  document.querySelectorAll("#scTpls .card").forEach((c) => c.classList.toggle("is-picked", c.dataset.id === id));
  $("#scBody").hidden = !t;
  if (!t) return;
  const d = Math.round(t.format?.duration_s || 30);
  $("#scLength").innerHTML = [...new Set([d, 15, 30, 45, 60])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === d ? "selected" : ""}>${n}초${n === d ? " (원본 길이)" : ""}</option>`).join("");
  $("#scPreview").innerHTML = `<p class="small" style="margin:0 0 var(--s2)"><b>${esc(t.name)}</b></p>
    <p class="muted small" style="margin:0 0 var(--s2)">${esc(t.logline_pattern || t.summary || "")}</p>
    <ol class="cn-flow">${(t.beats || []).map((b) => `<li><b>${esc(b.beat)}</b> <span class="muted">${fmtS(b.start)}–${fmtS(b.end)}</span> — ${esc(b.what || "")}</li>`).join("")}</ol>`;
}
$("#scTpls").addEventListener("click", (e) => {
  const c = e.target.closest(".card"); if (!c) return;
  scSelect(c.dataset.id);
  $("#scBody").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#scForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#scBtn"); btn.disabled = true;
  try {
    await api(`/api/templates/${state.scTplId}/scripts`, { method: "POST", body: {
      product: $("#scProduct").value, topic: $("#scTopic").value, details: $("#scDetails").value,
      cast: $("#scCast").value, length: Number($("#scLength").value), kitId: $("#scKit").value,
    } });
    toast("대본 쓰는 중 (1~2분) — 끝나면 만든 대본 탭으로 넘어갑니다");
  } catch (err) { toast(err.message, true); btn.disabled = false; }
});

// 대본 → 촬영용 텍스트
function scriptText(sc) {
  const who = Object.fromEntries((sc.characters || []).map((c) => [c.id, c.name || c.id]));
  return [`# ${sc.title || ""}`, sc.logline ? `로그라인: ${sc.logline}` : "", "",
    "## 인물", ...(sc.characters || []).map((c) => `- ${c.name || c.id}: ${c.desc || ""}${c.voice ? ` / 목소리: ${c.voice}` : ""}`), "",
    "## 장면", ...(sc.scenes || []).flatMap((x) => [
      `[${x.n}] ${fmtS(x.start)}–${fmtS(x.start + x.dur)} · ${x.beat || ""} · ${x.location || ""}`,
      `  화면: ${x.action || ""}`, ...(x.dialogue || []).map((d) => `  ${who[d.who] || d.who}: ${d.line}`),
      x.onscreen_text ? `  자막: ${x.onscreen_text}` : "", x.camera ? `  카메라: ${x.camera}` : "", x.sound ? `  소리: ${x.sound}` : "", x.product_moment ? `  제품: ${x.product_moment}` : "", ""].filter((l) => l !== "")),
    "", "## 캡션", sc.caption || "", sc.notes ? `\n## 촬영 메모\n${sc.notes}` : ""].join("\n");
}
async function loadScripts() {
  const [tpls, list] = await Promise.all([api("/api/templates"), api("/api/scripts")]);
  const byId = new Map(tpls.map((t) => [t.id, t]));
  state.scripts = list;
  $("#scriptCount").textContent = list.length ? `${list.length}개` : "";
  $("#scriptList").innerHTML = list.map((sc, i) => {
    const who = Object.fromEntries((sc.characters || []).map((c) => [c.id, c.name || c.id]));
    return `<details class="short dr-script" data-i="${i}" ${i === 0 ? "open" : ""}>
      <summary class="short__head">
        <div><strong>${esc(sc.title || sc.product)}</strong> <span class="muted small">${new Date(sc.created_at).toLocaleString("ko-KR")} · ${sc.length_s || "?"}초 · ${sc.took_s}초 걸림 · 템플릿 ${esc(byId.get(sc.tpl_id)?.name || sc.tpl_id)}</span>
          <p class="small">${esc(sc.logline || "")}</p></div>
        <div class="row">
          <button class="btn btn--sm" type="button" data-copy-script>텍스트 복사</button>
          <button class="btn btn--ghost btn--sm" type="button" data-del-script>지우기</button>
        </div>
      </summary>
      <div class="dr-chars">${(sc.characters || []).map((c) => `<div class="dr-char"><b>${esc(c.id)}</b> <strong>${esc(c.name || "")}</strong><div class="muted small">${esc(c.desc || "")}${c.voice ? ` · ${esc(c.voice)}` : ""}</div></div>`).join("")}</div>
      <div class="table-wrap"><table class="shots dr-scenes"><thead><tr><th>시간</th><th>비트</th><th>화면</th><th>대사</th><th>자막·카메라</th></tr></thead><tbody>${(sc.scenes || []).map((x) => `
        <tr><td>${fmtS(x.start)}<div class="muted small">${fmtS(x.dur)}</div></td><td><span class="tag">${esc(x.beat || "")}</span></td>
        <td>${esc(x.action || "")}${x.location ? `<div class="muted small">${esc(x.location)}</div>` : ""}${x.product_moment ? `<div class="small" style="color:var(--secondary100)">제품: ${esc(x.product_moment)}</div>` : ""}</td>
        <td>${(x.dialogue || []).map((d) => `<div><b>${esc(who[d.who] || d.who)}</b> ${esc(d.line)}</div>`).join("")}</td>
        <td>${esc(x.onscreen_text || "")}${x.camera ? `<div class="muted small">${esc(x.camera)}</div>` : ""}${x.sound ? `<div class="muted small">♪ ${esc(x.sound)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${sc.caption ? `<details class="small"><summary>캡션</summary><p style="white-space:pre-wrap;margin-top:4px">${esc(sc.caption)}</p></details>` : ""}
      ${sc.notes ? `<p class="small muted" style="margin-top:var(--s2)">촬영 메모: ${esc(sc.notes)}</p>` : ""}
    </details>`;
  }).join("");
}
$("#scriptList").addEventListener("click", async (e) => {
  const box = e.target.closest("[data-i]"); if (!box) return;
  const sc = state.scripts[Number(box.dataset.i)];
  if (e.target.closest("[data-copy-script]")) { e.preventDefault(); return copyText(scriptText(sc), "대본을 텍스트로 복사했습니다"); }
  if (e.target.closest("[data-del-script]")) {
    e.preventDefault();
    if (!confirm("이 대본을 지울까요?")) return;
    await api(`/api/templates/${sc.tpl_id}/scripts/${sc.sid}`, { method: "DELETE" }); loadScripts();
  }
});

// ── 드라마 스튜디오: 기획 → 디벨롭 → 샷리스트·소재 → 시트 → 장면 이미지 → 영상(힉스필드) → 편집 ─────────
const ST_STEPS_DRAMA = ["기획", "디벨롭", "샷리스트·소재", "시트", "장면 이미지", "영상", "편집"];
const ST_STEPS_AD = ["기획", "카피·전략", "콘티·소재", "시트", "장면 이미지", "영상", "편집"];
const AD_FORMATS = ["UGC 후기", "문제→해결", "비포·애프터", "제품 시연", "언박싱", "가격·혜택", "비교", "상황극", "감성 브랜딩", "쇼호스트"];
// 드라마 모드와 광고 모드가 같은 스튜디오를 쓴다
const stKind = () => (state.mode === "ad" ? "ad" : "drama");
const stIsAd = () => stKind() === "ad";
const stSteps = () => (stIsAd() ? ST_STEPS_AD : ST_STEPS_DRAMA);
const ST_GENRES = ["시트콤", "가족극", "직장물", "로맨스", "로맨스 판타지(회귀·빙의)", "조선 시대", "이종족 로맨스", "막장", "병맛 반전", "전래동화 패러디", "동물 빙의", "공포 패러디"];
const HIGGS = "https://higgsfield.ai";
const dUrl = (p, f) => `/data/_dramas/${p.id}/${f}`;
let stSaveTimer = null;
const stSave = (fields) => { clearTimeout(stSaveTimer); stSaveTimer = setTimeout(() => api(`/api/dramas/${state.st.id}`, { method: "PUT", body: fields() }).catch((err) => toast(err.message, true)), 600); };
const stRun = async (action, body = {}) => {
  try { await api(`/api/dramas/${state.st.id}/${action}`, { method: "POST", body }); state.stPending = state.st.id; }
  catch (err) { toast(err.message, true); }
};

async function loadStudio() {
  const ad = stIsAd();
  if (state.st && (state.st.kind || "drama") !== stKind()) { state.st = null; state.stOpened = null; }
  $("#stHead").textContent = ad ? "제품 광고영상 만들기" : "릴스 만들기";
  $("#stDesc").innerHTML = ad
    ? "제품 광고 한 편을 단계별로 만듭니다. Claude 가 콘셉트·카피·콘티·시트/장면/영상 프롬프트를 쓰고, 이미지·영상은 힉스필드에서 만들어 여기 올립니다. 효능·수치·가격은 <b>넣은 정보만</b> 씁니다."
    : "숏폼 릴스(숏드라마) 한 편을 단계별로 만듭니다. Claude 가 기획·대본·샷리스트·시트/장면/영상 프롬프트를 쓰고, 이미지·영상은 힉스필드에서 만들어 여기 올립니다. <b>영상을 돌리기 전에 이미지 단계에서 결정을 끝내는 것</b>이 크레딧을 아끼는 길입니다.";
  $("#stNew").textContent = ad ? "+ 새 광고영상" : "+ 새 릴스";
  $("#stDelete").textContent = ad ? "이 광고영상 지우기" : "이 릴스 지우기";
  $("#stList").dataset.empty = ad ? "아직 만든 광고영상이 없습니다. [+ 새 광고영상]으로 시작하세요." : "아직 만든 릴스가 없습니다. [+ 새 릴스]로 시작하세요.";
  await stRefreshList();
  if (state.st?.id) openDrama(state.st.id); else $("#stEditor").hidden = true;
}
async function stRefreshList() {
  const list = await api(`/api/dramas?kind=${stKind()}`);
  $("#studioCount").textContent = list.length ? `${list.length}개` : "";
  $("#stList").innerHTML = list.map((d) => `
    <button class="st-card ${state.st?.id === d.id ? "is-on" : ""}" type="button" data-did="${d.id}">
      <span class="st-card__img">${d.cover ? `<img src="/data/_dramas/${d.id}/${d.cover}" alt="">` : stIsAd() ? "📦" : "🎭"}</span>
      <span class="st-card__body"><strong>${esc(d.title)}</strong>
        <span class="muted small">${stSteps()[d.step] || ""} 단계 · ${d.length || "?"}초 · ${new Date(d.updated_at || d.created_at).toLocaleDateString("ko-KR")}</span></span>
    </button>`).join("");
}
$("#stList").addEventListener("click", (e) => { const b = e.target.closest("[data-did]"); if (b) openDrama(b.dataset.did); });
$("#stNew").addEventListener("click", async () => {
  const d = await api("/api/dramas", { method: "POST", body: { kind: stKind(), inputs: stIsAd() ? { length: 30, aspect: "9:16", formats: [], platform: "인스타 릴스" } : { length: 60, aspect: "9:16", genres: [] } } });
  state.st = d; state.stView = 0; await loadStudio();
});
async function openDrama(id, view) {
  state.st = await api(`/api/dramas/${id}`);
  state.stView = view ?? (state.stView != null && state.stOpened === id ? state.stView : Math.min(state.st.step + (state.st.step < 6 && stStepDone(state.st, state.st.step) ? 1 : 0), 6));
  if (state.stOpened !== id || view != null) stRefreshList().then(() => document.querySelectorAll("#stList .st-card").forEach((c) => c.classList.toggle("is-on", c.dataset.did === id)));
  state.stOpened = id;
  document.querySelectorAll("#stList .st-card").forEach((c) => c.classList.toggle("is-on", c.dataset.did === id));
  $("#stEditor").hidden = false;
  $("#stTitle").value = state.st.title || "";
  stRender();
}
// 단계가 끝났는지 (스텝 표시용)
function stStepDone(p, i) {
  const m = p.media || { shots: {}, assets: {} };
  return [!!p.idea, !!p.develop, p.shots?.length > 0,
    stAssets(p).length > 0 && stAssets(p).every((a) => m.assets[a.id]?.sheet_0 || (a.element_id === "product" && m.assets.PRODUCT?.sheet_0)),
    p.shots?.length > 0 && p.shots.every((s) => m.shots[s.n]?.image),
    p.shots?.length > 0 && p.shots.every((s) => m.shots[s.n]?.video), !!p.edit?.done][i];
}
const stAssets = (p) => [...(p.assets?.characters || []).map((x) => ({ ...x, kind: "인물" })), ...(p.assets?.locations || []).map((x) => ({ ...x, kind: "장소" })), ...(p.assets?.props || []).map((x) => ({ ...x, kind: "소품" }))];
function stRender() {
  const p = state.st, v = state.stView;
  $("#stSteps").innerHTML = stSteps().map((n, i) => `<li><button type="button" class="st-step ${i === v ? "is-on" : ""} ${stStepDone(p, i) ? "is-done" : ""}" data-step="${i}" ${i > p.step + 1 ? "disabled" : ""}><b>${stStepDone(p, i) ? "✓" : i + 1}</b>${n}</button></li>`).join("");
  $("#stPanel").innerHTML = [stIsAd() ? stPlanAd : stPlan, stDevelop, stShots, stSheets, stImages, stVideos, stEdit][v](p);
}
$("#stSteps").addEventListener("click", (e) => { const b = e.target.closest("[data-step]"); if (b && !b.disabled) { state.stView = Number(b.dataset.step); stRender(); } });
$("#stTitle").addEventListener("input", () => { state.st.title = $("#stTitle").value; stSave(() => ({ title: state.st.title })); });
$("#stDelete").addEventListener("click", async () => {
  if (!confirm(`"${state.st.title}" ${stIsAd() ? "광고영상" : "드라마"}을 지울까요? 올린 사진·시트·이미지·영상도 같이 지워집니다.`)) return;
  await api(`/api/dramas/${state.st.id}`, { method: "DELETE" }); state.st = null; loadStudio();
});
const stNext = (label, to) => `<div class="st-next"><button class="btn btn--primary" type="button" data-goto="${to}">${label} →</button></div>`;
const stSlot = (p, slot, file, kind, label) => {
  const url = file ? dUrl(p, file) : "";
  const prev = !file ? `<span class="muted small">${label}</span>` : kind === "video" ? `<video src="${url}" controls muted playsinline preload="metadata"></video>` : kind === "audio" ? `<audio src="${url}" controls></audio>` : `<a href="${url}" target="_blank"><img src="${url}" alt=""></a>`;
  return `<div class="st-slot ${file ? "is-set" : ""} st-slot--${kind}">
    <div class="st-slot__prev">${prev}</div>
    <div class="row"><label class="vslot__up" style="flex:1"><input type="file" accept="${kind === "video" ? "video/*" : kind === "audio" ? "audio/*,video/*" : "image/*"}" data-media="${slot}"><span>${file ? "바꾸기" : "올리기"}</span></label>
    ${file ? `<button class="btn btn--ghost btn--sm" type="button" data-media-del="${slot}">빼기</button>` : ""}</div></div>`;
};

// 1. 기획
// 참고 영상 — ① 템플릿에서 고르기 ② 내 영상 올리기 ③ 링크로 넣기. 하나만 쓴다 (새로 넣으면 앞의 것은 빠진다)
function stRefPicker(p) {
  const i = p.inputs || {}, tab = state.stRefTab || (i.ref_video?.dir ? "upload" : "tpl");
  const vids = (state.templates || []).filter((t) => t.kind !== "cardnews");
  const tcur = vids.find((t) => t.id === i.ref_tpl_id), vcur = i.ref_video?.dir ? i.ref_video : null;
  const cur = tcur ? `<div class="st-ref__cur"><video src="/data/_templates/${tcur.id}/source.mp4" poster="/data/_templates/${tcur.id}/cover.jpg" controls playsinline preload="metadata"></video>
      <div><strong>${esc(tcur.name)}</strong><span class="muted small">템플릿 · ${tcur.kind === "drama" ? "상황극형" : "광고형"}</span><button type="button" class="btn btn--ghost btn--sm" data-refclear>참고 영상 빼기</button></div></div>`
    : vcur ? `<div class="st-ref__cur"><video src="${dUrl(p, vcur.video)}" ${vcur.poster ? `poster="${dUrl(p, vcur.poster)}"` : ""} controls playsinline preload="metadata"></video>
      <div><strong>${esc(vcur.name)}</strong><span class="muted small">직접 넣은 영상 · 컷·글자·음성 분석됨</span><button type="button" class="btn btn--ghost btn--sm" data-refclear>참고 영상 빼기</button></div></div>` : "";
  const busy = state.stRefBusy === p.id;
  return `<div class="field"><span>참고 영상 (선택) — 넣으면 그 영상의 전개·리듬·컷 길이·구도를 따릅니다 (소재·대사는 베끼지 않음)</span>
    ${cur}
    <div class="seg seg--sm" role="tablist">${[["tpl", "템플릿에서 고르기"], ["upload", "내 영상 올리기"], ["link", "링크로 넣기"]].map(([k, l]) => `<button type="button" class="seg__btn ${tab === k ? "is-on" : ""}" data-reftab="${k}">${l}</button>`).join("")}</div>
    ${busy ? `<p class="small"><span class="log__dot is-run"></span> 참고 영상 받고 분석하는 중… (1~2분)</p>`
    : tab === "tpl" ? `<div class="st-ref">${vids.map((t) => `<button type="button" class="st-ref__item ${t.id === i.ref_tpl_id ? "is-on" : ""}" data-reftpl="${t.id}" title="${esc(t.name)}"><img src="/data/_templates/${t.id}/cover.jpg" alt="" loading="lazy"><em class="st-ref__kind">${t.kind === "drama" ? "상황극형" : "광고형"}</em><span>${esc(t.name)}</span></button>`).join("")
      || `<p class="muted small" style="margin:0">영상 템플릿이 없습니다. 광고 수집에서 영상을 열고 [템플릿으로 저장]을 누르세요.</p>`}</div>`
    : tab === "upload" ? `<label class="drop st-ref__drop"><input type="file" accept="video/*" data-refup><strong>영상 파일 고르기</strong><span class="muted small">mp4 · mov · webm — 올리면 컷·화면 글자·음성을 분석합니다</span></label>`
    : `<div class="ra-row"><input class="ra-grow" id="stRefUrl" placeholder="유튜브·인스타 릴스·틱톡·mp4 링크"><button class="btn btn--sm" type="button" data-refurl>링크로 넣기</button></div>`}
  </div>`;
}

function stPlan(p) {
  const i = p.inputs || {};
  const tpls = (state.templates || []).filter((t) => t.kind === "drama");
  return `<section class="panel mk-sec st-auto">
      <h3 class="mk-step"><b>0</b> 자연어로 적고 한 번에 구성하기 <span class="muted small">— 기획 → 디벨롭 → 샷리스트·시트 프롬프트까지 만들고, 시트 제작 앞에서 멈춥니다</span></h3>
      <label class="field"><span>만들고 싶은 릴스를 자유롭게 적으세요</span><textarea rows="5" data-in="brief" placeholder="예: 30대 직장인이 월요일 아침 지각할 뻔하다가, 로봇청소기가 대신 출근 준비를 다 해 놓은 걸 보고 놀라는 이야기. 마지막에 '퇴근하면 집이 깨끗해요' 한마디. 밝고 웃기게, 인물 2명, 60초.">${esc(i.brief || "")}</textarea></label>
      ${stRefPicker(p)}
      <div class="row" style="flex-wrap:wrap;align-items:center"><button class="btn btn--primary" type="button" data-run="auto">시트 제작 직전까지 구성하기</button>
      <span class="muted small">아래 길이·화면·장르 설정도 같이 반영합니다 · 3~6분</span></div>
    </section>
    <div class="st-grid">
    <section class="panel mk-sec">
      <h3 class="mk-step"><b>1</b> 무엇을 만들까요?</h3>
      <div class="row" style="flex-wrap:wrap">
        <label class="field"><span>길이</span><select data-in="length">${[15, 30, 45, 60, 90, 120, 180].map((n) => `<option value="${n}" ${+i.length === n ? "selected" : ""}>${n < 60 ? `${n}초` : `${n / 60}분`}</option>`).join("")}</select></label>
        <label class="field"><span>화면</span><select data-in="aspect">${["9:16", "16:9", "1:1"].map((a) => `<option ${i.aspect === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      </div>
      <div class="field"><span>섞을 장르·재료 (여러 개) — 검증된 재료를 섞되 접점은 하나</span>
        <div class="seg">${ST_GENRES.map((g) => `<button type="button" class="seg__btn ${i.genres?.includes(g) ? "is-on" : ""}" data-genre="${esc(g)}">${esc(g)}</button>`).join("")}</div></div>
      <label class="field"><span>키워드·방향 (선택)</span><input data-in="keyword" value="${esc(i.keyword || "")}" placeholder="예: 바람핀 남자친구, 등불 축제 / 직장인 공감 / 강아지 시점"></label>
      <label class="field"><span>광고할 제품·서비스 (선택) — 넣으면 이야기 안에 자연스럽게 녹입니다</span><input data-in="product" value="${esc(i.product || "")}" placeholder="예: 물걸레 로봇청소기"></label>
      <div class="row" style="flex-wrap:wrap">
        <label class="field" style="flex:1"><span>브랜드 에셋 (선택)</span><select data-in="kit_id"><option value="">안 씀</option>${(state.kits || []).map((k) => `<option value="${k.id}" ${i.kit_id === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label>
        <label class="field" style="flex:1"><span>참고 이야기 구조 (선택) — 수집한 릴스의 드라마 템플릿</span><select data-in="tpl_id"><option value="">안 씀</option>${tpls.map((t) => `<option value="${t.id}" ${i.tpl_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      </div>
      <button class="btn btn--primary" type="button" data-run="ideas">아이디어 10개 받기</button>
      <p class="muted small" style="margin:0">작가처럼 분석할 필요 없이, 보고 재밌는 것 하나만 고르면 됩니다.</p>
    </section>
    <section class="panel mk-sec">
      <h3 class="mk-step"><b>2</b> 아이디어 고르기</h3>
      ${p.ideas?.length ? `<div class="mk-sugs">${p.ideas.map((x, k) => `<button type="button" class="mk-sug ${p.idea?.title === x.title ? "is-on" : ""}" data-idea="${k}">
        <strong>${esc(x.title)}</strong><span>${esc(x.logline || "")}</span>
        <span class="muted small">첫 5초: ${esc(x.hook || "")} · 반전: ${esc(x.twist || "")}${x.link ? ` · 접점: ${esc(x.link)}` : ""} · ${esc(x.cast || "")}</span></button>`).join("")}</div>` : `<p class="muted small" style="margin:0">왼쪽에서 조건을 고르고 [아이디어 10개 받기]를 누르세요.</p>`}
      <label class="field"><span>또는 직접 적기</span><textarea rows="3" id="stOwnIdea" placeholder="예: 전래동화 속 악당들이 기자회견을 한다 — 놀부·호랑이·팥쥐 엄마가 해명한다">${p.idea?.own ? esc(p.idea.logline) : ""}</textarea></label>
      <button class="btn btn--sm" type="button" data-own-idea>이 아이디어로</button>
    </section></div>
    ${p.idea ? stNext("다음: 디벨롭", 1) : ""}`;
}
// 1. 기획 (광고): 제품 정보·사진 → 콘셉트
function stPlanAd(p) {
  const i = p.inputs || {};
  const photos = Object.entries(p.media?.assets?.PRODUCT || {}).filter(([k]) => k.startsWith("sheet_")).sort();
  const vtpls = (state.templates || []).filter((t) => !t.kind);
  return `<div class="st-grid">
    <section class="panel mk-sec">
      <h3 class="mk-step"><b>1</b> 어떤 제품인가요?</h3>
      <label class="field"><span>제품·서비스 이름</span><input data-in="product" value="${esc(i.product || "")}" placeholder="예: 물걸레 로봇청소기 R7"></label>
      <label class="field"><span>제품 설명</span><textarea rows="2" data-in="product_desc" placeholder="무엇이고 어떻게 쓰는지">${esc(i.product_desc || "")}</textarea></label>
      <label class="field"><span>핵심 장점 (쉼표로)</span><input data-in="usp" value="${esc(i.usp || "")}" placeholder="예: 물걸레 자동 세척, 문턱 2cm 넘기, 저소음"></label>
      <label class="field"><span>가격·혜택 — 넣은 것만 광고에 씁니다</span><input data-in="offer" value="${esc(i.offer || "")}" placeholder="예: 런칭 특가 29만 9천 원, 무료 배송"></label>
      <label class="field"><span>타깃</span><input data-in="target" value="${esc(i.target || "")}" placeholder="예: 반려동물 키우는 30대 맞벌이"></label>
      <div class="field"><span>실제 제품 사진 (여러 장) — 제품 생김새의 기준이 됩니다</span>
        <div class="kit-imgs">${photos.map(([k, f]) => `<div class="kit-img"><img src="${dUrl(p, f)}" alt=""><button type="button" class="btn btn--ghost btn--sm" data-media-del="asset:PRODUCT:${k.slice(6)}" aria-label="사진 빼기">✕</button></div>`).join("")}</div>
        <label class="vslot__up"><input type="file" accept="image/*" multiple data-product-photos><span>제품 사진 올리기</span></label></div>
    </section>
    <section class="panel mk-sec">
      <h3 class="mk-step"><b>2</b> 어떤 광고로?</h3>
      <div class="row" style="flex-wrap:wrap">
        <label class="field"><span>길이</span><select data-in="length">${[15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${+i.length === n ? "selected" : ""}>${n}초</option>`).join("")}</select></label>
        <label class="field"><span>화면</span><select data-in="aspect">${["9:16", "1:1", "4:5", "16:9"].map((a) => `<option ${i.aspect === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label class="field"><span>올릴 곳</span><select data-in="platform">${["인스타 릴스", "유튜브 쇼츠", "틱톡", "메타 피드 광고", "유튜브 광고"].map((a) => `<option ${i.platform === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      </div>
      <div class="field"><span>원하는 광고 형식 (여러 개, 비우면 골고루)</span>
        <div class="seg">${AD_FORMATS.map((g) => `<button type="button" class="seg__btn ${i.formats?.includes(g) ? "is-on" : ""}" data-format="${esc(g)}">${esc(g)}</button>`).join("")}</div></div>
      <label class="field"><span>방향·요청 (선택)</span><input data-in="keyword" value="${esc(i.keyword || "")}" placeholder="예: 털 날리는 집의 공감 상황으로 시작, 밝고 경쾌하게"></label>
      <div class="row" style="flex-wrap:wrap">
        <label class="field" style="flex:1"><span>브랜드 에셋 (선택)</span><select data-in="kit_id"><option value="">안 씀</option>${(state.kits || []).map((k) => `<option value="${k.id}" ${i.kit_id === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label>
        <label class="field" style="flex:1"><span>참고 광고 구조 (선택) — 수집한 광고의 영상 템플릿</span><select data-in="tpl_id"><option value="">안 씀</option>${vtpls.map((t) => `<option value="${t.id}" ${i.tpl_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      </div>
      <button class="btn btn--primary" type="button" data-run="ideas">광고 콘셉트 8개 받기</button>
    </section></div>
    <section class="panel mk-sec">
      <h3 class="mk-step"><b>3</b> 콘셉트 고르기</h3>
      ${p.ideas?.length ? `<div class="mk-sugs st-ideas">${p.ideas.map((x, k) => `<button type="button" class="mk-sug ${p.idea?.title === x.title ? "is-on" : ""}" data-idea="${k}">
        <strong>${esc(x.title)}</strong><span>${esc(x.logline || "")}</span>
        <span class="muted small">형식: ${esc(x.link || "")} · 첫 3초: ${esc(x.hook || "")} · 소구점: ${esc(x.twist || "")}</span></button>`).join("")}</div>` : `<p class="muted small" style="margin:0">제품 정보와 사진을 넣고 [광고 콘셉트 8개 받기]를 누르세요.</p>`}
      <label class="field"><span>또는 직접 적기</span><textarea rows="2" id="stOwnIdea" placeholder="예: 강아지 털이 날리는 거실 → 로봇청소기가 지나가면 깨끗 → 집사가 소파에 눕는다">${p.idea?.own ? esc(p.idea.logline) : ""}</textarea></label>
      <button class="btn btn--sm" type="button" data-own-idea>이 콘셉트로</button>
    </section>
    ${p.idea ? stNext("다음: 카피·전략", 1) : ""}`;
}
// 2. 디벨롭
function stDevelop(p) {
  const d = p.develop;
  const ad = stIsAd();
  if (!d) return `<section class="panel mk-sec"><h3 class="mk-step"><b>2</b> ${ad ? "카피·전략" : "디벨롭"}</h3>
    <p>고른 ${ad ? "콘셉트" : "아이디어"}: <b>${esc(p.idea?.title || "")}</b> — ${esc(p.idea?.logline || "")}</p>
    <p class="muted small" style="margin:0">${ad ? `${p.inputs?.length || 30}초 광고의 메시지·타깃 문제·소구점·혜택·CTA와 모델(고정 문장)·목소리·연출을 잡고` : `${p.inputs?.length || 60}초 분량으로 줄거리·인물(캐릭터 고정 문장)·목소리·연출을 잡고`}, 아직 정하지 않은 것을 보기로 묻습니다.</p>
    <button class="btn btn--primary" type="button" data-run="develop">${ad ? "카피·전략 만들기" : "디벨롭 시작"}</button></section>`;
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>2</b> ${esc(d.title || "")}</h3>
    <p class="small" style="margin:0"><b>로그라인</b> ${esc(d.logline || "")}</p>
    ${ad ? `<div class="st-copy">
      <label class="field"><span>타깃</span><input data-dev="target" value="${esc(d.target || "")}"></label>
      <label class="field"><span>타깃의 문제·상황</span><input data-dev="pain" value="${esc(d.pain || "")}"></label>
      <label class="field"><span>소구점</span><input data-dev-list="usp" value="${esc((d.usp || []).join(", "))}"></label>
      <label class="field"><span>혜택 문구</span><input data-dev="offer" value="${esc(d.offer || "")}"></label>
      <label class="field"><span>CTA</span><input data-dev="cta" value="${esc(d.cta || "")}"></label>
    </div>` : ""}
    <label class="field"><span>${ad ? "광고 흐름" : "줄거리"} (직접 고쳐도 됩니다)</span><textarea rows="6" data-dev="synopsis">${esc(d.synopsis || "")}</textarea></label>
    ${ad && d.notes ? `<p class="muted small" style="margin:0">메모: ${esc(d.notes)}</p>` : ""}
    <div class="field"><span>연출 — 색감·음악 흐름</span><textarea rows="2" data-dev="direction">${esc(d.direction || "")}</textarea></div>
    <h4 style="margin:0">${ad ? "모델·화자" : "인물"}</h4>
    <div class="st-chars">${(d.characters || []).map((c, k) => `<div class="dr-char" data-ci="${k}">
      <div><b>${esc(c.id)}</b> <strong>${esc(c.name || "")}</strong> <span class="muted small">${esc(c.role || "")}</span></div>
      <div class="muted small">${esc(c.desc || "")}</div>
      <label class="field"><span>캐릭터 고정 문장 (모든 장면에 붙는 신분증)</span><textarea rows="2" data-cf="fixed_en">${esc(c.fixed_en || "")}</textarea></label>
      <label class="field"><span>목소리</span><input data-cf="voice" value="${esc(c.voice || "")}"></label>
      ${c.looks?.length ? `<div class="muted small">의상: ${c.looks.map((l) => `${esc(l.when)} — ${esc(l.outfit_en)}`).join(" / ")}</div>` : ""}
    </div>`).join("")}</div>
    ${d.questions?.length ? `<h4 style="margin:var(--s2) 0 0">더 정할 것 — 고르기만 하면 됩니다</h4>
    <div class="st-qs">${d.questions.map((q, k) => `<div class="st-q" data-qi="${k}"><span class="small"><b>${esc(q.q)}</b></span>
      <div class="seg">${(q.options || []).map((o) => `<button type="button" class="seg__btn" data-ans="${esc(o)}">${esc(o)}</button>`).join("")}</div>
      <input data-ans-own placeholder="직접 적기"></div>`).join("")}</div>` : ""}
    <label class="field"><span>추가 요청 (선택)</span><input id="stDevNote" placeholder="예: 마지막이 약해, 더 황당하고 짧게 / 대사를 절반으로"></label>
    <button class="btn" type="button" data-run="develop" data-with-answers>고른 답 반영해서 다시 쓰기</button>
    ${d.answers?.length ? `<p class="muted small" style="margin:0">반영한 답: ${d.answers.map((a) => `${esc(a.q)} → ${esc(a.a)}`).join(" · ")}</p>` : ""}
  </section>${stNext(ad ? "다음: 콘티·소재" : "다음: 샷리스트·소재", 2)}`;
}
// 3. 샷리스트·소재
function stShots(p) {
  const o = p.shot_opts || { hardcut: true, emotionLong: true, slack: true };
  const names = Object.fromEntries((p.assets?.characters || []).map((c) => [c.id, c.name || c.id]));
  const total = (p.shots || []).reduce((a, s) => a + (+s.dur || 0), 0);
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>3</b> ${stIsAd() ? "콘티와 소재" : "샷리스트(콘티)와 소재"}</h3>
    <div class="row" style="flex-wrap:wrap;gap:var(--s4)">
      <label class="check"><input type="checkbox" id="stHard" ${o.hardcut ? "checked" : ""}> 2~3초 하드컷 · 멀티앵글</label>
      <label class="check"><input type="checkbox" id="stEmo" ${o.emotionLong ? "checked" : ""}> 감정 장면은 길게</label>
      <label class="check"><input type="checkbox" id="stSlack" ${o.slack ? "checked" : ""}> 대사보다 2초 여유</label>
    </div>
    <div class="row"><input id="stShotNote" style="flex:1" placeholder="추가 요청 (선택) — 예: 인트로 타이틀 컷 추가"><button class="btn btn--primary" type="button" data-run="shotlist">${p.shots?.length ? "샷리스트 다시 짜기" : "샷리스트 만들기"}</button></div>
    <p class="muted small" style="margin:0">완성도는 영상 전에 절반이 정해집니다. 컷마다 <b>앵글·인물 배치·대사</b>를 한 줄씩 검수하세요. 고칠 컷은 [이 컷만 고치기]로 — 다른 컷은 건드리지 않습니다.</p>
  </section>
  ${p.shots?.length ? `<section class="panel mk-sec">
    <div class="st-assets">${stAssets(p).map((a) => `<span class="st-asset"><b>${esc(a.id)}</b> ${esc(a.name || "")} <code>@${esc(a.element_id || "")}</code> <span class="tag">${a.kind}</span></span>`).join("")}</div>
    <p class="muted small" style="margin:0">컷 ${p.shots.length}개 · 합계 ${fmtS(total)}</p>
    ${p.shot_notes ? `<details class="mk-notes small"><summary>검수 포인트 (Claude 메모)</summary><p style="white-space:pre-wrap">${esc(p.shot_notes)}</p></details>` : ""}
    <div class="table-wrap"><table class="shots dr-scenes st-shots"><thead><tr><th>컷</th><th>앵글·카메라</th><th>등장</th><th>화면</th><th>대사</th>${p.shots.some((s) => s.caption) ? "<th>자막</th>" : ""}<th>소리</th><th></th></tr></thead><tbody>
    ${p.shots.map((s) => `<tr data-n="${s.n}"><td><b>${s.n}</b><div class="muted small">${fmtS(s.start)} · ${fmtS(s.dur)}${s.emotion ? " · 감정" : ""}</div></td>
      <td>${esc(s.angle || "")}<div class="muted small">${esc(s.camera || "")}</div></td>
      <td class="small">${[...(s.cast || []).map((c) => names[c] || c), s.location, ...(s.props || [])].filter(Boolean).map(esc).join(", ")}</td>
      <td>${esc(s.action || "")}${s.fix_request ? `<div class="small" style="color:var(--secondary100)">고침: ${esc(s.fix_request)}</div>` : ""}</td>
      <td>${(s.dialogue || []).map((d) => `<div><b>${esc(names[d.who] || d.who)}</b>${d.inner ? " (속마음)" : ""} ${esc(d.line)}</div>`).join("")}</td>
      ${p.shots.some((x) => x.caption) ? `<td><b>${esc(s.caption || "")}</b></td>` : ""}
      <td class="small">${esc([s.sfx, s.music].filter(Boolean).join(" · "))}</td>
      <td><button class="btn btn--ghost btn--sm" type="button" data-fix="${s.n}">이 컷만 고치기</button></td></tr>`).join("")}</tbody></table></div>
  </section>${stNext("다음: 시트 만들기", 3)}` : ""}`;
}
// 힉스필드 버튼용: 결과를 넣을 칸, 컷에 나오는 소재의 시트(제품은 실제 사진)를 참조로
const stTarget = (p, slot) => ({ type: "drama", id: p.id, slot });
const stProductPhotos = (p) => Object.entries(p.media?.assets?.PRODUCT || {}).filter(([k]) => k.startsWith("sheet_")).map(([, f]) => f);
function stShotRefs(p, s) {
  const ma = p.media?.assets || {}, out = [];
  for (const id of [...(s.cast || []), s.location, ...(s.props || [])].filter(Boolean)) {
    const a = stAssets(p).find((x) => x.id === id);
    if (a?.element_id === "product") out.push(...(stProductPhotos(p).length ? stProductPhotos(p) : ma[id]?.sheet_0 ? [ma[id].sheet_0] : []));
    else if (ma[id]?.sheet_0) out.push(ma[id].sheet_0);
  }
  return [...new Set(out)].slice(0, 16);
}
const stHasProduct = (p, s) => (s.props || []).some((id) => stAssets(p).find((x) => x.id === id)?.element_id === "product");
// 4. 시트
// 이미지 모델 (시트·장면 이미지) — p.inputs.image = { model, res, quality, skin }. 기본은 사실적인 Nano Banana Pro
let imageModels = null;
function stImgSet(p) {
  const v = p.inputs?.image || {}, m = imageModels?.find((x) => x.id === v.model) || imageModels?.find((x) => x.id === "nano_banana_pro") || imageModels?.[0];
  if (!m) return null;
  return { m, res: m.res?.options.includes(v.res) ? v.res : m.res?.def, quality: m.quality?.options.includes(v.quality) ? v.quality : m.quality?.def, skin: v.skin !== false };
}
// 사람이 나오는 이미지에 붙이는 피부·인물 디테일 — 지점토·밀랍 같은 매끈한 피부를 막는다
const ST_SKIN = " Skin and face detail (critical): raw, unretouched photograph of a real person, as if shot on a Sony A7 IV with an 85mm f/1.8 lens at ISO 400 with natural sensor grain. "
  + "Clearly visible skin pores across the nose, cheeks and forehead, fine vellus hair (peach fuzz) catching the light, natural uneven skin tone with slight redness around the nose and cheeks, faint under-eye shadows and fine lines, a few tiny moles or blemishes, a subtle natural sheen on the T-zone, "
  + "realistic lip texture with fine vertical lines, individual eyebrow hairs and eyelashes, moist eyes with natural catchlights and visible iris detail, natural hairline with flyaway hairs, slight asymmetry of a real face. "
  + "Avoid: smooth plastic skin, clay or wax-like skin, porcelain or doll skin, airbrushing, beauty filter, skin smoothing, over-sharpened HDR, CGI or 3D-render look.";
const stImgBody = (p, person) => { const c = imageModels && stImgSet(p); return c ? { imageModel: c.m.id, resolution: c.res, quality: c.quality, modelName: c.m.name, skin: person && c.skin } : {}; };
const stSkin = (p, person, prompt) => (person && (stImgSet(p)?.skin ?? true) ? prompt + ST_SKIN : prompt);
function stImgPanel(p) {
  if (!imageModels) { api("/api/hf/image-models").then((r) => { imageModels = r; if ([3, 4].includes(state.stView)) stRender(); }).catch((err) => toast(err.message, true)); return `<p class="muted small" style="margin:0">이미지 모델 목록을 불러오는 중…</p>`; }
  const c = stImgSet(p), m = c.m;
  return `<div class="row" style="flex-wrap:wrap;gap:10px;align-items:center">
      <label class="small">이미지 모델 <select data-iset="model">${imageModels.map((x) => `<option value="${esc(x.id)}" ${x.id === m.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      ${m.res ? `<label class="small">해상도 <select data-iset="res">${m.res.options.map((o) => `<option ${o === c.res ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>` : ""}
      ${m.quality ? `<label class="small">품질 <select data-iset="quality">${m.quality.options.map((o) => `<option ${o === c.quality ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>` : ""}
      <label class="check"><input type="checkbox" data-iset="skin" ${c.skin ? "checked" : ""}> 피부·인물 디테일 강화 (사람이 나오는 이미지)</label>
    </div>
    <p class="muted small" style="margin:0">${esc(m.note || "")} · 시트·장면 이미지에 같이 쓰입니다. 피부가 지점토처럼 매끈하면 Nano Banana Pro · 2k 이상 + 디테일 강화를 쓰세요.</p>`;
}

// 시트 참고 이미지 — 소재마다 3장까지 (asset:<id>:ref0~2 → sheet_ref0~2). 체크를 끄면 그 장은 시트를 만들 때 넣지 않는다 (a.ref_off)
const ST_REFS = ["ref0", "ref1", "ref2"];
const stSheetRefs = (p, a) => ST_REFS.map((k) => p.media?.assets?.[a.id]?.[`sheet_${k}`] && !a.ref_off?.[k] ? p.media.assets[a.id][`sheet_${k}`] : null).filter(Boolean);
function stRefBox(p, a) {
  const bag = p.media?.assets?.[a.id] || {};
  const set = ST_REFS.filter((k) => bag[`sheet_${k}`]), free = ST_REFS.find((k) => !bag[`sheet_${k}`]);
  const on = set.filter((k) => !a.ref_off?.[k]).length;
  return `<div class="st-refs">
    <p class="small" style="margin:0"><b>참고 이미지</b> <span class="muted">— 실제 사진·원하는 느낌의 이미지를 넣고, 체크한 것만 시트를 만들 때 참고합니다 (${on}/${set.length}장 참고)</span></p>
    <div class="st-grid">${set.map((k) => `<div>${stSlot(p, `asset:${a.id}:${k}`, bag[`sheet_${k}`], "image", "참고 이미지")}
      <label class="check" style="min-height:0"><input type="checkbox" data-refuse="${k}" ${a.ref_off?.[k] ? "" : "checked"}> 참고하기</label></div>`).join("")}
      ${free ? `<div>${stSlot(p, `asset:${a.id}:${free}`, null, "image", "+ 참고 이미지 올리기")}</div>` : ""}</div>
  </div>`;
}
function stSheets(p) {
  const m = p.media?.assets || {};
  const card = (a) => {
    const refs = stSheetRefs(p, a);
    const sheets = a.kind === "인물" ? (a.sheets?.length ? a.sheets : [{ label: "기본", prompt_en: "" }]) : [{ label: a.kind, prompt_en: a.sheet_prompt_en }];
    return `<div class="st-sheet ${m[a.id]?.sheet_0 ? "is-set" : ""}" data-aid="${a.id}">
      <div class="st-sheet__head"><span class="tag">${a.kind}</span> <strong>${esc(a.id)} · ${esc(a.name || "")}</strong> <code>@${esc(a.element_id || "")}</code>
        <label class="check" style="min-height:0;margin-left:auto"><input type="checkbox" data-reg ${a.registered ? "checked" : ""}> 힉스필드 등록함</label></div>
      ${a.fixed_en ? `<div class="prompt"><span class="prompt__label">캐릭터 고정 문장</span>${esc(a.fixed_en)}${copyBtn(a.fixed_en)}</div>` : a.desc ? `<p class="muted small" style="margin:0">${esc(a.desc)}</p>` : ""}
      ${a.element_id === "product" && m.PRODUCT ? `<div class="kit-imgs">${Object.entries(m.PRODUCT).filter(([k]) => k.startsWith("sheet_")).map(([, f]) => `<div class="kit-img"><img src="${dUrl(p, f)}" alt=""></div>`).join("")}</div>
        <p class="muted small" style="margin:0">올린 실제 제품 사진입니다. 힉스필드 요소(@product)에 이 사진을 그대로 등록하면 됩니다 — 부족한 각도만 아래 시트 프롬프트로 만드세요.</p>` : ""}
      ${stRefBox(p, a)}
      <div class="st-sheet__rows">${sheets.map((sh, k) => `<div class="st-sheet__row">
        <div class="prompt"><span class="prompt__label">시트 프롬프트 — ${esc(sh.label || "")}</span>${esc(sh.prompt_en || "")}${copyBtn(sh.prompt_en || "")}</div>
        ${stSlot(p, `asset:${a.id}:${k}`, m[a.id]?.[`sheet_${k}`], "image", "만든 시트 이미지 올리기")}
        ${sh.prompt_en ? hfBtn(`힉스필드로 시트 만들기${refs.length ? ` · 참고 ${refs.length}장` : ""}`, { target: stTarget(p, `asset:${a.id}:${k}`), kind: "image", purpose: a.element_id === "product" ? "product" : "sheet", prompt: stSkin(p, a.kind === "인물", refs.length ? `${sh.prompt_en} Use the attached reference image(s) as the visual reference for this ${a.kind === "인물" ? "person's face, hair, body and outfit" : a.kind === "장소" ? "place's layout, materials and mood" : "object's exact shape, colors, materials and details"}, while keeping the sheet layout described above.` : sh.prompt_en), refs: [...(a.element_id === "product" ? stProductPhotos(p) : []), ...refs].slice(0, 16), aspect: a.kind === "장소" ? p.inputs?.aspect || "9:16" : "16:9", ...stImgBody(p, a.kind === "인물") }) : ""}</div>`).join("")}</div>
      ${a.kind === "인물" ? `<div class="st-voice"><span class="small"><b>목소리</b> ${esc(a.voice || "")}</span>
        ${stSlot(p, `voice:${a.id}`, m[a.id]?.voice, "audio", "목소리 레퍼런스 (첫 영상에서 이 인물 음성만 뽑아 올리면 다음 컷부터 목소리가 같아집니다)")}</div>` : ""}
    </div>`;
  };
  return `<section class="panel mk-sec st-guide">
    <h3 class="mk-step"><b>4</b> 인물·장소·소품 시트</h3>
    ${stImgPanel(p)}
    <ol class="cn-flow">
      <li>시트 프롬프트를 복사해 <a href="${HIGGS}" target="_blank" rel="noopener">힉스필드</a> → 이미지에서 만듭니다 (배경은 9:16 세로).</li>
      <li><b>인물</b>: 캐릭터 → Soul ID 캐릭터 만들기 → 시트를 올리고 이름에 <code>@ID</code>를 적습니다.</li>
      <li><b>장소·소품</b>: Cinema Studio → 내 요소 → 요소 만들기 → 카테고리(장소/소품)를 고르고 요소 ID에 <code>@ID</code>를 적습니다.</li>
      <li>만든 시트를 여기에도 올려 두면 장면 단계에서 같이 봅니다.</li>
    </ol>
  </section>
  <div class="st-sheets">${stAssets(p).map(card).join("")}</div>
  ${stNext("다음: 장면 이미지", 4)}`;
}
// 5. 장면 이미지 — 영상 전에 이미지로 결정을 끝낸다
function stImages(p) {
  const m = p.media?.shots || {};
  const done = p.shots.filter((s) => m[s.n]?.image).length;
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>5</b> 장면 이미지 (첫 프레임)</h3>
    ${stImgPanel(p)}
    <p class="muted small" style="margin:0">첫 장면 이미지가 캐스팅입니다 — 마음에 들 때까지 고치고, 다음 장면은 그 이미지를 참고 이미지로 넣어 만드세요. 다 올리면 아래 보드에서 얼굴·머리·옷이 같은지 비교합니다. (${done}/${p.shots.length})</p>
    ${done ? `<div class="st-board">${p.shots.map((s) => `<figure>${m[s.n]?.image ? `<img src="${dUrl(p, m[s.n].image)}" alt="">` : `<span class="muted small">컷 ${s.n}</span>`}<figcaption>${s.n}</figcaption></figure>`).join("")}</div>` : ""}
  </section>
  <div class="st-shotcards">${p.shots.map((s) => `<div class="st-shotcard ${m[s.n]?.image ? "is-set" : ""}">
    <div class="st-shotcard__head"><b>컷 ${s.n}</b> <span class="muted small">${fmtS(s.dur)} · ${esc(s.angle || "")}</span></div>
    <p class="small" style="margin:0">${esc(s.action || "")}</p>
    <div class="prompt"><span class="prompt__label">이미지 프롬프트</span>${esc(s.image_prompt_en || "")}${copyBtn(s.image_prompt_en || "")}</div>
    ${stSlot(p, `shot:${s.n}:image`, m[s.n]?.image, "image", "고른 이미지 올리기")}
    ${hfBtn(`힉스필드로 이미지 만들기${stShotRefs(p, s).length ? ` · 시트 ${stShotRefs(p, s).length}장 참조` : ""}`, { target: stTarget(p, `shot:${s.n}:image`), kind: "image", purpose: stHasProduct(p, s) ? "product" : "shot", prompt: stSkin(p, !!s.cast?.length, s.image_prompt_en || ""), refs: stShotRefs(p, s), aspect: p.inputs?.aspect || "9:16", ...stImgBody(p, !!s.cast?.length) })}
  </div>`).join("")}</div>
  ${stNext("다음: 영상 만들기", 5)}`;
}
// 6. 영상 — 힉스필드 이미지→영상
// 영상 모델 목록 (힉스필드에서 확인한 값) — 영상 단계를 처음 열 때 한 번 받는다
let videoModels = null;
// 이 드라마의 영상 설정 (p.inputs.video = { model, res, audio, sheets }) — 안 고른 칸은 모델 기본값
function stVidSet(p) {
  const v = p.inputs?.video || {}, m = videoModels?.find((x) => x.id === v.model) || videoModels?.[0];
  if (!m) return null;
  return { m, res: m.res?.options.includes(v.res) ? v.res : m.res?.def, audio: !!m.audio && v.audio !== false, sheets: !!m.refs && v.sheets !== false };
}
const durText = (m) => m.dur.options ? `${m.dur.options.join("/")}초` : `${m.dur.min}~${m.dur.max}초`;
function stVidPanel(p) {
  if (!videoModels) { api("/api/hf/video-models").then((r) => { videoModels = r; if (state.stView === 5) stRender(); }).catch((err) => toast(err.message, true)); return `<p class="muted small" style="margin:0">영상 모델 목록을 불러오는 중…</p>`; }
  const c = stVidSet(p), m = c.m;
  return `<div class="row" style="flex-wrap:wrap;gap:10px;align-items:center">
      <label class="small">모델 <select data-vset="model">${videoModels.map((x) => `<option value="${esc(x.id)}" ${x.id === m.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      ${m.res ? `<label class="small">${esc(m.res.label || "해상도")} <select data-vset="res">${m.res.options.map((o) => `<option ${o === c.res ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>` : ""}
      ${m.audio ? `<label class="check"><input type="checkbox" data-vset="audio" ${c.audio ? "checked" : ""}> 소리·대사 생성</label>` : ""}
      ${m.refs ? `<label class="check"><input type="checkbox" data-vset="sheets" ${c.sheets ? "checked" : ""}> 인물·장소 시트도 참고로 넣기</label>` : ""}
    </div>
    <p class="muted small" style="margin:0">${esc(m.note)} · 길이 ${durText(m)} (컷 길이에 가장 가까운 값으로 맞춤)${m.refs ? "" : " · 시작 이미지 한 장만 씁니다"} · 모델 고르기는 MCP 연결에서만 됩니다</p>`;
}
function stVideos(p) {
  const m = p.media?.shots || {}, ma = p.media?.assets || {};
  const vs = videoModels && stVidSet(p);
  const vidBody = (s) => ({ target: stTarget(p, `shot:${s.n}:video`), kind: "video", purpose: "video", prompt: s.video_prompt_en, refs: [m[s.n].image, ...(vs?.sheets ? stShotRefs(p, s) : [])], aspect: p.inputs?.aspect || "9:16", duration: Math.ceil(+s.dur || 4),
    ...(vs ? { videoModel: vs.m.id, modelName: vs.m.name, resolution: vs.res, withAudio: vs.audio } : {}), ...(m[s.n]?.audio ? { audio: m[s.n].audio } : {}) });
  const done = p.shots.filter((s) => m[s.n]?.video).length;
  const voices = (p.assets?.characters || []).filter((c) => ma[c.id]?.voice);
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>6</b> 영상 (힉스필드)</h3>
    ${stVidPanel(p)}
    <ol class="cn-flow">
      <li><a href="${HIGGS}" target="_blank" rel="noopener">힉스필드</a> Cinema Studio → 비디오, 화면 비율 ${esc(p.inputs?.aspect || "9:16")}. 장면 이미지를 넣고 영상 프롬프트를 붙인 뒤 <code>@</code>로 그 컷의 인물·장소를 부릅니다.</li>
      <li>먼저 <b>480p 초안</b>으로 뽑아 확인하고, 마음에 드는 컷만 1080으로 올리세요. 생성 버튼을 누르고 기다리지 말고 다음 컷을 바로 넣으면 동시에 만들어집니다.</li>
      <li>대사가 빠르면 컷 길이를 2초 늘리거나 둘로 나누세요 (샷리스트 단계의 [이 컷만 고치기]).</li>
      <li>카메라 무빙은 <a href="https://aicameramovements.com/" target="_blank" rel="noopener">AI Camera Movements</a>의 이름을 씁니다 — 무빙이 이상하면 거기서 예시 영상을 보고 [이 컷만 고치기]로 바꾸세요.</li>
      ${voices.length ? `<li>목소리 레퍼런스: ${voices.map((c) => `<a href="${dUrl(p, ma[c.id].voice)}" target="_blank">${esc(c.name || c.id)}</a>`).join(", ")} — 그 인물이 나오는 컷에 오디오 레퍼런스로 넣으세요.</li>` : ""}
    </ol>
    <p class="muted small" style="margin:0">올린 영상 ${done}/${p.shots.length}</p>
  </section>
  <div class="st-shotcards">${p.shots.map((s) => `<div class="st-shotcard ${m[s.n]?.video ? "is-set" : ""}">
    <div class="st-shotcard__head"><b>컷 ${s.n}</b> <span class="muted small">${fmtS(s.dur)} · ${esc(s.camera || "")}</span>
      ${m[s.n]?.image ? `<img class="st-mini" src="${dUrl(p, m[s.n].image)}" alt="">` : ""}</div>
    <div class="prompt"><span class="prompt__label">영상 프롬프트</span>${esc(s.video_prompt_en || "")}${copyBtn(s.video_prompt_en || "")}</div>
    ${stSlot(p, `shot:${s.n}:audio`, m[s.n]?.audio, "audio", "이 컷 음성 (선택) — 올리면 입 모양을 이 음성에 맞춥니다")}
    ${m[s.n]?.audio && vs && !vs.m.audioRef ? `<p class="muted small" style="margin:0">${esc(vs.m.name)} 은 음성 참고를 못 받아 이 컷은 Seedance 2.5 로 만듭니다.</p>` : ""}
    ${stSlot(p, `shot:${s.n}:video`, m[s.n]?.video, "video", "고른 영상 올리기")}
    ${m[s.n]?.image ? hfBtn(`힉스필드로 영상 만들기${vs ? ` · ${vs.m.name}` : ""}${m[s.n]?.audio ? " · 음성 맞춤" : ""}`, vidBody(s)) : `<p class="muted small" style="margin:0">장면 이미지를 먼저 올리거나 만들면 영상 만들기가 켜집니다.</p>`}
  </div>`).join("")}</div>
  ${stNext("다음: 편집", 6)}`;
}
// 7. 편집
function stEdit(p) {
  const m = p.media?.shots || {};
  const vids = p.shots.filter((s) => m[s.n]?.video);
  const e = p.edit || {};
  const checks = [["tempo", "장면 사이 빈 공간은 자르고, 웃음 포인트에는 잠깐 정적"], ["sub", "자막 얹기 (아래 SRT)"], ["sound", "음악·효과음"], ["intro", "인트로 타이틀 컷"], ["order", "컷 순서·길이 최종 확인"]];
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>7</b> 편집</h3>
    <p class="muted small" style="margin:0">고른 영상 ${vids.length}/${p.shots.length}개를 순서대로 이어 붙입니다 (캡컷 등). 숏폼은 템포가 생명입니다.</p>
    ${vids.length ? `<div class="st-reel">${vids.map((s) => `<figure><video src="${dUrl(p, m[s.n].video)}" controls muted playsinline preload="metadata"></video><figcaption>${s.n} · ${fmtS(s.dur)}</figcaption></figure>`).join("")}</div>` : ""}
    <div class="row" style="flex-wrap:wrap"><a class="btn" href="/api/dramas/${p.id}/srt" download>자막 SRT 받기</a></div>
    <div class="st-checks">${checks.map(([k, l]) => `<label class="check" style="min-height:32px"><input type="checkbox" data-check="${k}" ${e[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
    <label class="check"><input type="checkbox" data-check="done" ${e.done ? "checked" : ""}> <b>완성</b></label>
  </section>
  ${stThumb(p)}`;
}
// 썸네일: 만든 영상의 한 장면 + 글자 스타일 참고 이미지 → 그 글자 스타일로 제목을 얹은 썸네일 (힉스필드 이미지 편집)
// 썸네일 글자 색 — colorMode "ref"(참고 이미지 색) | "custom"(직접 지정: 큰 글자·작은 글자·테두리·강조 박스)
const THUMB_PRESETS = [
  { name: "노랑 + 검정 테두리", c_title: "#FFD400", c_sub: "#FFFFFF", c_stroke: "#000000", c_box: "", box_on: false },
  { name: "흰 글자 + 빨강 박스", c_title: "#FFFFFF", c_sub: "#FFFFFF", c_stroke: "#000000", c_box: "#E53935", box_on: true },
  { name: "검정 글자 + 노랑 박스", c_title: "#111111", c_sub: "#111111", c_stroke: "#FFFFFF", c_box: "#FFD400", box_on: true },
  { name: "흰 + 파랑 테두리", c_title: "#FFFFFF", c_sub: "#BFE3FF", c_stroke: "#1565C0", c_box: "", box_on: false },
  { name: "빨강 + 흰 테두리", c_title: "#FF2D2D", c_sub: "#FFFFFF", c_stroke: "#FFFFFF", c_box: "", box_on: false },
];
const THUMB_DEF = { c_title: "#FFD400", c_sub: "#FFFFFF", c_stroke: "#000000", c_box: "#E53935" };
// 색 이름(대략) — 이미지 모델이 hex 만으로는 색을 잘못 잡을 때가 있어 이름을 같이 준다
function colorName(hex) {
  const n = parseInt(String(hex || "#000").slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, d = mx - mn;
  if (d < 25) return l > 0.85 ? "white" : l < 0.15 ? "black" : l > 0.55 ? "light gray" : "dark gray";
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  const base = h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 160 ? "green" : h < 195 ? "cyan" : h < 255 ? "blue" : h < 290 ? "purple" : "pink";
  return (l < 0.3 ? "dark " : l > 0.75 ? "light " : "bright ") + base;
}
const colorOf = (hex) => `${colorName(hex)} (${String(hex).toUpperCase()})`;
function stThumbPrompt(th) {
  const sub = (th.sub || "").trim();
  const custom = th.colorMode === "custom", c = { ...THUMB_DEF, ...th };
  const colors = custom ? `Use these exact colors instead of image 2's colors: headline letters filled ${colorOf(c.c_title)} with a thick ${colorOf(c.c_stroke)} outline${sub ? `, second line letters ${colorOf(c.c_sub)} with the same outline` : ""}${th.box_on ? `, and place the headline on a solid ${colorOf(c.c_box)} highlight box/banner` : ", with no background box or banner behind the text"}. Keep image 2's font shape, weight, shadow and layout, but not its colors. ` : "";
  return `Create a short-form video thumbnail by editing image 1. Image 1 is a frame from the video: keep its people, faces, expressions, outfits, background, lighting and composition exactly the same, photorealistic, only reframe slightly to fit the ${th.aspect || "9:16"} canvas if needed. `
    + `Image 2 is a typography style reference only: copy its lettering style — font weight and shape, ${custom ? "" : "letter colors, "}outlines and strokes, drop shadows, ${custom ? "" : "highlight boxes or banners, "}size hierarchy and placement on the canvas — but do NOT copy its words, people or background. `
    + colors
    + `Add this Korean headline text in that exact style, spelled exactly character for character: "${(th.title || "").trim()}"${sub ? `, and a smaller second line spelled exactly: "${sub}"` : ""}. `
    + `Keep every Korean character correct and fully legible, do not add any other text, logos or watermarks, and keep the text clear of the main person's face.`;
}
function stThumb(p) {
  const m = p.media?.shots || {}, ma = p.media?.assets?.THUMB || {}, th = p.edit?.thumb || {}, ideas = p.edit?.thumb_ideas || [];
  const vids = p.shots.filter((s) => m[s.n]?.video);
  const n = vids.some((s) => s.n === th.n) ? th.n : vids[0]?.n;
  const aspect = th.aspect || p.inputs?.aspect || "9:16";
  const ready = ma.sheet_frame && ma.sheet_ref && (th.title || "").trim();
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>✦</b> 썸네일 만들기</h3>
    <p class="muted small" style="margin:0">만든 영상에서 한 장면을 고르고, 글자 스타일 참고 이미지를 넣으면 그 글자 스타일로 제목을 얹은 썸네일을 만듭니다. 장면 이미지를 직접 올려도 됩니다.</p>
    ${vids.length ? `<div class="row" style="flex-wrap:wrap;gap:10px;align-items:center">
        <label class="small">컷 <select data-thumb="n">${vids.map((s) => `<option value="${s.n}" ${s.n === n ? "selected" : ""}>컷 ${s.n}</option>`).join("")}</select></label>
        <span class="muted small">영상을 원하는 순간에 멈추고 →</span>
        <button class="btn btn--sm" type="button" data-thumb-grab="${n}">이 장면 쓰기</button></div>
      <video id="stThumbVid" src="${dUrl(p, m[n].video)}" controls muted playsinline preload="metadata" style="max-width:280px;width:100%;border-radius:8px"></video>` : `<p class="muted small" style="margin:0">영상을 올리면 거기서 장면을 고를 수 있습니다.</p>`}
    <div class="st-grid">
      <div><p class="small" style="margin:0 0 4px"><b>장면</b></p>${stSlot(p, "asset:THUMB:frame", ma.sheet_frame, "image", "고른 장면 (또는 이미지 올리기)")}</div>
      <div><p class="small" style="margin:0 0 4px"><b>글자 스타일 참고</b></p>${stSlot(p, "asset:THUMB:ref", ma.sheet_ref, "image", "이런 글자로 만들고 싶은 썸네일·이미지")}</div>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center">
      <button class="btn btn--sm" type="button" data-thumb-suggest>✨ 후킹 제목 추천${ideas.length ? " 다시 받기" : ""}</button>
      <span class="muted small">궁금증을 유발하는 후킹 제목 6개를 추천합니다 (답은 숨기고 누르게 만드는 방식). 제목이 비어 있으면 첫 안을 바로 넣고, 고르면 아래 칸에 들어갑니다.</span></div>
    ${ideas.length ? `<div class="seg" style="flex-wrap:wrap">${ideas.map((x, i) => `<button type="button" class="seg__btn ${x.title === th.title && (x.sub || "") === (th.sub || "") ? "is-on" : ""}" data-thumb-pick="${i}" title="${esc(x.angle || "")}">
      <b>${esc(x.title)}</b>${x.sub ? ` <span class="muted">· ${esc(x.sub)}</span>` : ""}${x.angle ? ` <span class="muted small">(${esc(x.angle)})</span>` : ""}</button>`).join("")}</div>` : ""}
    <div class="row" style="flex-wrap:wrap;gap:10px">
      <label class="small" style="flex:2;min-width:220px">큰 글자 <input data-thumb="title" value="${esc(th.title || "")}" placeholder="예: 같은 정수기, 다른 혜택?" style="width:100%"></label>
      <label class="small" style="flex:2;min-width:220px">작은 글자 (선택) <input data-thumb="sub" value="${esc(th.sub || "")}" placeholder="예: 가입처만 바꿔도 100%" style="width:100%"></label>
      <label class="small">비율 <select data-thumb="aspect">${["9:16", "1:1", "4:5", "16:9"].map((a) => `<option ${a === aspect ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:10px;align-items:center">
      <label class="small">글자 색 <select data-thumb="colorMode"><option value="ref" ${th.colorMode !== "custom" ? "selected" : ""}>참고 이미지 색 따라가기</option><option value="custom" ${th.colorMode === "custom" ? "selected" : ""}>직접 지정</option></select></label>
      ${th.colorMode === "custom" ? (() => { const c = { ...THUMB_DEF, ...th }; return `
        <label class="small">큰 글자 <input type="color" data-thumb="c_title" value="${esc(c.c_title)}"></label>
        <label class="small">작은 글자 <input type="color" data-thumb="c_sub" value="${esc(c.c_sub)}"></label>
        <label class="small">테두리 <input type="color" data-thumb="c_stroke" value="${esc(c.c_stroke)}"></label>
        <label class="check" style="min-height:0"><input type="checkbox" data-thumb="box_on" ${th.box_on ? "checked" : ""}> 강조 박스</label>
        ${th.box_on ? `<label class="small">박스 <input type="color" data-thumb="c_box" value="${esc(c.c_box)}"></label>` : ""}`; })() : `<span class="muted small">참고 이미지의 글꼴·색을 그대로 따라갑니다</span>`}
    </div>
    ${th.colorMode === "custom" ? `<div class="seg" style="flex-wrap:wrap">${THUMB_PRESETS.map((x, i) => `<button type="button" class="seg__btn" data-thumb-preset="${i}">
      <span style="display:inline-block;padding:0 6px;border-radius:4px;font-weight:800;color:${x.c_title};background:${x.box_on ? x.c_box : "#777"};-webkit-text-stroke:1px ${x.c_stroke}">가</span> ${esc(x.name)}</button>`).join("")}</div>` : ""}
    ${ready ? hfBtn("힉스필드로 썸네일 만들기 · 장면 + 글자 참고", { target: stTarget(p, "asset:THUMB:out"), kind: "image", purpose: "edit", prompt: stThumbPrompt(th), thumb: true, refs: [ma.sheet_frame, ma.sheet_ref], aspect }, true)
      : `<p class="muted small" style="margin:0">장면 · 글자 스타일 참고 · 큰 글자를 채우면 만들기가 켜집니다.</p>`}
    ${ma.sheet_out ? `<div class="row" style="gap:12px;align-items:flex-end"><a href="${dUrl(p, ma.sheet_out)}" target="_blank"><img src="${dUrl(p, ma.sheet_out)}" alt="썸네일" style="max-width:280px;width:100%;border-radius:8px"></a>
      <a class="btn btn--sm" href="${dUrl(p, ma.sheet_out)}" download>썸네일 받기</a></div>` : ""}
    <p class="muted small" style="margin:0">한글 글자는 이미지 모델이 틀리게 그릴 때가 있습니다. 글자가 깨지면 다시 만들거나, 캡컷에서 글자만 얹으세요.</p>
  </section>`;
}

// 입력·클릭
$("#stPanel").addEventListener("input", (e) => {
  const p = state.st, el = e.target;
  if (el.dataset.in) { p.inputs[el.dataset.in] = el.dataset.in === "length" ? Number(el.value) : el.value; return stSave(() => ({ inputs: p.inputs })); }
  if (el.dataset.dev) { p.develop[el.dataset.dev] = el.value; return stSave(() => ({ develop: p.develop })); }
  if (el.dataset.devList) { p.develop[el.dataset.devList] = el.value.split(",").map((x) => x.trim()).filter(Boolean); return stSave(() => ({ develop: p.develop })); }
  if (el.dataset.cf) { p.develop.characters[Number(el.closest("[data-ci]").dataset.ci)][el.dataset.cf] = el.value; return stSave(() => ({ develop: p.develop })); }
  if (el.dataset.thumb && el.tagName === "INPUT" && el.type !== "checkbox") { p.edit = { ...(p.edit || {}), thumb: { ...(p.edit?.thumb || {}), [el.dataset.thumb]: el.value } }; return stSave(() => ({ edit: p.edit })); }
});
$("#stPanel").addEventListener("change", async (e) => {
  const p = state.st, el = e.target;
  if (el.matches("[data-refup]") && el.files?.[0]) { // 참고 영상 올리기 → 서버가 받고 분석 (끝나면 drama 작업 완료 이벤트로 다시 그린다)
    const f = el.files[0];
    try {
      state.stRefBusy = p.id; stRender();
      const res = await fetch(`/api/uploads?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || res.status);
      await api(`/api/dramas/${p.id}/ref`, { method: "POST", body: { token: d.token } }); state.stPending = p.id;
    } catch (err) { state.stRefBusy = null; stRender(); toast(err.message, true); }
    return;
  }
  if (el.dataset.in) { p.inputs[el.dataset.in] = el.dataset.in === "length" ? Number(el.value) : el.value; return stSave(() => ({ inputs: p.inputs })); }
  if (el.dataset.refuse) { // 참고 이미지 참고하기 체크
    const id = el.closest("[data-aid]").dataset.aid, k = el.dataset.refuse;
    for (const g of ["characters", "locations", "props"]) (p.assets[g] || []).forEach((a) => { if (a.id === id) a.ref_off = { ...(a.ref_off || {}), [k]: !el.checked }; });
    stSave(() => ({ assets: p.assets })); return stRender();
  }
  if (el.matches("[data-reg]")) {
    const id = el.closest("[data-aid]").dataset.aid;
    for (const k of ["characters", "locations", "props"]) p.assets[k].forEach((a) => { if (a.id === id) a.registered = el.checked; });
    return stSave(() => ({ assets: p.assets }));
  }
  if (el.dataset.thumb) { // 고르는 칸 · 글자 칸을 벗어날 때 — 버튼(켜짐·프롬프트)을 다시 그린다
    const k = el.dataset.thumb, v = k === "n" ? Number(el.value) : el.type === "checkbox" ? el.checked : el.value;
    p.edit = { ...(p.edit || {}), thumb: { ...(p.edit?.thumb || {}), [k]: v } };
    stSave(() => ({ edit: p.edit })); return stRender();
  }
  if (el.dataset.iset) {
    const k = el.dataset.iset, v = { ...(p.inputs.image || {}) };
    v[k] = el.type === "checkbox" ? el.checked : el.value;
    if (k === "model") { delete v.res; delete v.quality; }
    p.inputs.image = v; stSave(() => ({ inputs: p.inputs })); return stRender();
  }
  if (el.dataset.vset) {
    const k = el.dataset.vset, v = { ...(p.inputs.video || {}) };
    v[k] = el.type === "checkbox" ? el.checked : el.value;
    if (k === "model") delete v.res; // 모델마다 해상도 값이 달라 기본값으로 돌린다
    p.inputs.video = v; stSave(() => ({ inputs: p.inputs })); return stRender();
  }
  if (el.dataset.check) { p.edit = { ...(p.edit || {}), [el.dataset.check]: el.checked }; stSave(() => ({ edit: p.edit })); if (el.dataset.check === "done") setTimeout(stRender, 700); return; }
  if (el.matches("[data-product-photos]") && el.files.length) {
    const used = Object.keys(p.media?.assets?.PRODUCT || {}).map((k) => Number(k.slice(6))).filter(Number.isFinite);
    let k = used.length ? Math.max(...used) + 1 : 0;
    try {
      for (const f of el.files) {
        const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || res.status);
        state.st = await api(`/api/dramas/${p.id}/media`, { method: "POST", body: { slot: `asset:PRODUCT:${k++}`, token: d.token }, busy: "제품 사진 올리는 중" });
      }
    } catch (err) { toast(err.message, true); }
    return stRender();
  }
  if (el.dataset.media && el.files[0]) {
    const f = el.files[0];
    el.nextElementSibling.textContent = "올리는 중…";
    try {
      const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || res.status);
      state.st = await api(`/api/dramas/${p.id}/media`, { method: "POST", body: { slot: el.dataset.media, token: d.token }, busy: "파일 올리는 중" });
      stRender();
    } catch (err) { toast(err.message, true); stRender(); }
  }
});
$("#stPanel").addEventListener("click", async (e) => {
  const p = state.st, el = e.target;
  if (el.closest("[data-copy]")) return; // 복사는 전체 공통 처리
  if (el.closest("[data-thumb-suggest]")) return stRun("thumbtitles");
  const pre = el.closest("[data-thumb-preset]");
  if (pre) {
    const { name, ...c } = THUMB_PRESETS[Number(pre.dataset.thumbPreset)];
    p.edit = { ...(p.edit || {}), thumb: { ...(p.edit?.thumb || {}), ...c, colorMode: "custom" } };
    stSave(() => ({ edit: p.edit })); toast(`글자 색: ${name}`); return stRender();
  }
  const pick = el.closest("[data-thumb-pick]");
  if (pick) {
    const x = p.edit.thumb_ideas[Number(pick.dataset.thumbPick)];
    p.edit = { ...p.edit, thumb: { ...(p.edit.thumb || {}), title: x.title, sub: x.sub || "" } };
    stSave(() => ({ edit: p.edit })); return stRender();
  }
  const grab = el.closest("[data-thumb-grab]");
  if (grab) {
    const t = $("#stThumbVid")?.currentTime || 0;
    try { state.st = await api(`/api/dramas/${p.id}/thumb-frame`, { method: "POST", body: { n: Number(grab.dataset.thumbGrab), t }, busy: "장면 뽑는 중" }); stRender(); toast(`컷 ${grab.dataset.thumbGrab} · ${t.toFixed(1)}초 장면을 골랐습니다`); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const fm = el.closest("[data-format]");
  if (fm) { const v = fm.dataset.format; p.inputs.formats = p.inputs.formats?.includes(v) ? p.inputs.formats.filter((x) => x !== v) : [...(p.inputs.formats || []), v]; fm.classList.toggle("is-on"); return stSave(() => ({ inputs: p.inputs })); }
  const g = el.closest("[data-genre]");
  if (g) { const v = g.dataset.genre; p.inputs.genres = p.inputs.genres?.includes(v) ? p.inputs.genres.filter((x) => x !== v) : [...(p.inputs.genres || []), v]; g.classList.toggle("is-on"); return stSave(() => ({ inputs: p.inputs })); }
  const go = el.closest("[data-goto]");
  if (go) { state.stView = Number(go.dataset.goto); stRender(); return window.scrollTo({ top: 0, behavior: "smooth" }); }
  const idea = el.closest("[data-idea]");
  if (idea) {
    p.idea = p.ideas[Number(idea.dataset.idea)];
    state.st = await api(`/api/dramas/${p.id}`, { method: "PUT", body: { idea: p.idea, title: p.idea.title, step: Math.max(p.step, 1) } });
    $("#stTitle").value = state.st.title; return stRender();
  }
  const rt = el.closest("[data-reftpl]");
  if (rt) { p.inputs.ref_tpl_id = rt.dataset.reftpl; delete p.inputs.ref_video; stSave(() => ({ inputs: p.inputs })); return stRender(); }
  const rtab = el.closest("[data-reftab]");
  if (rtab) { state.stRefTab = rtab.dataset.reftab; return stRender(); }
  if (el.closest("[data-refclear]")) { p.inputs.ref_tpl_id = ""; delete p.inputs.ref_video; stSave(() => ({ inputs: p.inputs })); return stRender(); }
  if (el.closest("[data-refurl]")) {
    const u = $("#stRefUrl")?.value.trim(); if (!u) return toast("링크를 넣으세요", true);
    try { state.stRefBusy = p.id; stRender(); await api(`/api/dramas/${p.id}/ref`, { method: "POST", body: { url: u } }); state.stPending = p.id; }
    catch (err) { state.stRefBusy = null; stRender(); toast(err.message, true); }
    return;
  }
  if (el.closest("[data-own-idea]")) {
    const t = $("#stOwnIdea").value.trim(); if (!t) return toast("아이디어를 적으세요", true);
    state.st = await api(`/api/dramas/${p.id}`, { method: "PUT", body: { idea: { title: t.split(/[—\-\n]/)[0].trim().slice(0, 40), logline: t, own: true }, step: Math.max(p.step, 1) } });
    return stRender();
  }
  const ans = el.closest("[data-ans]");
  if (ans) { ans.parentElement.querySelectorAll(".seg__btn").forEach((b) => b.classList.toggle("is-on", b === ans)); return; }
  const md = el.closest("[data-media-del]");
  if (md) { state.st = await api(`/api/dramas/${p.id}/media`, { method: "POST", body: { slot: md.dataset.mediaDel, token: null } }); return stRender(); }
  const fx = el.closest("[data-fix]");
  if (fx) { const r = prompt(`컷 ${fx.dataset.fix} — 무엇을 어떻게 고칠까요? (앵글·길이·대사를 구체적으로)`, ""); if (r) stRun("fix", { n: Number(fx.dataset.fix), request: r }); return; }
  const run = el.closest("[data-run]");
  if (run) {
    const a = run.dataset.run;
    if (a === "ideas") { clearTimeout(stSaveTimer); await api(`/api/dramas/${p.id}`, { method: "PUT", body: { inputs: p.inputs } }); return stRun("ideas"); }
    if (a === "auto") {
      clearTimeout(stSaveTimer);
      if (!p.inputs?.brief?.trim() && !p.inputs?.ref_tpl_id && !p.inputs?.ref_video?.dir) return toast("자연어 요청을 적거나 참고 영상을 넣으세요", true);
      if (p.shots?.length && !confirm("이미 만든 줄거리·샷리스트를 새로 구성합니다. 계속할까요? (올린 시트·장면 파일은 같은 소재면 남습니다)")) return;
      await api(`/api/dramas/${p.id}`, { method: "PUT", body: { inputs: p.inputs } });
      toast("시트 제작 직전까지 구성하는 중 — 기획 → 디벨롭 → 샷리스트 (3~6분)");
      return stRun("auto");
    }
    if (a === "develop") {
      const answers = run.dataset.withAnswers !== undefined ? [...document.querySelectorAll("#stPanel [data-qi]")].map((q) => {
        const own = q.querySelector("[data-ans-own]").value.trim(), on = q.querySelector(".seg__btn.is-on")?.dataset.ans;
        return (own || on) ? { q: p.develop.questions[Number(q.dataset.qi)].q, a: own || on } : null;
      }).filter(Boolean) : [];
      clearTimeout(stSaveTimer);
      if (p.develop) await api(`/api/dramas/${p.id}`, { method: "PUT", body: { develop: p.develop } });
      return stRun("develop", { answers, note: $("#stDevNote")?.value || "" });
    }
    if (a === "shotlist") {
      if (p.shots?.length && !confirm("샷리스트를 다시 짜면 컷 번호가 바뀌어, 올린 장면 이미지·영상과 어긋날 수 있습니다. 다시 짤까요?")) return;
      return stRun("shotlist", { hardcut: $("#stHard").checked, emotionLong: $("#stEmo").checked, slack: $("#stSlack").checked, note: $("#stShotNote").value });
    }
  }
});

// ── 힉스필드: 오른쪽 위 MCP/API 토글 · 설정 · 생성 버튼 ──────────────
async function hfLoad() {
  state.hf = await api("/api/hf/settings").catch(() => ({ mode: "mcp" }));
  document.querySelectorAll("[data-hfmode]").forEach((b) => b.classList.toggle("is-on", b.dataset.hfmode === state.hf.mode));
  $("#hfInfo").textContent = state.hf.mode === "api"
    ? (state.hf.hasKey ? `API 키 저장됨 (…${state.hf.keyIdTail}). 생성은 힉스필드 API 로 바로 요청합니다.` : "API 키가 없습니다. 아래에 키 ID·시크릿을 넣고 저장하세요.")
    : "MCP: 이 PC 의 Claude Code 에 연결된 힉스필드 계정으로 Claude 가 대신 올리고·만들고·기다립니다 (API 키 불필요).";
  $("#hfImageRes").value = state.hf.imageRes || "2k";
  $("#hfVideoRes").value = state.hf.videoRes || "480p";
  $("#hfUnlim").checked = !!state.hf.unlim;
}
async function hfSetMode(mode) {
  if (mode === "api" && !state.hf?.hasKey) { await hfLoad(); toast("API 키를 먼저 넣으세요", true); state.hf.mode = "api"; document.querySelectorAll("[data-hfmode]").forEach((b) => b.classList.toggle("is-on", b.dataset.hfmode === "api")); return $("#hfDialog").showModal(); }
  state.hf = await api("/api/hf/settings", { method: "PUT", body: { mode } });
  await hfLoad();
  toast(`힉스필드 연결: ${mode.toUpperCase()}`);
}
document.querySelectorAll("[data-hfmode]").forEach((b) => b.addEventListener("click", () => hfSetMode(b.dataset.hfmode)));
$("#hfGear").addEventListener("click", async () => { await hfLoad(); $("#hfDialog").showModal(); });
$("#hfClose").addEventListener("click", () => $("#hfDialog").close());
$("#hfForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    state.hf = await api("/api/hf/settings", { method: "PUT", body: { keyId: $("#hfKeyId").value, keySecret: $("#hfKeySecret").value, unlim: $("#hfUnlim").checked, imageRes: $("#hfImageRes").value, videoRes: $("#hfVideoRes").value, ...(state.hf.mode === "api" && ($("#hfKeyId").value || state.hf.hasKey) ? { mode: "api" } : {}) } });
    $("#hfKeyId").value = ""; $("#hfKeySecret").value = "";
    await hfLoad(); toast("힉스필드 설정을 저장했습니다");
  } catch (err) { toast(err.message, true); }
});
$("#hfClearKey").addEventListener("click", async () => {
  if (!confirm("저장된 힉스필드 API 키를 지울까요? 연결 방식은 MCP 로 바뀝니다.")) return;
  state.hf = await api("/api/hf/settings", { method: "PUT", body: { clearKey: true, mode: "mcp" } }); await hfLoad();
});
hfLoad();

// 생성 버튼 — payload: { target, kind, purpose, prompt, refs, aspect, duration, label }
const hfBtn = (label, payload, primary) => `<button class="btn btn--sm ${primary ? "btn--primary" : ""} hf-btn" type="button" data-hf="${esc(JSON.stringify(payload))}">✦ ${label}</button>`;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-hf]"); if (!b) return;
  const pl = JSON.parse(b.dataset.hf);
  if (pl.thumb && state.st) { pl.prompt = stThumbPrompt(state.st.edit?.thumb || {}); delete pl.thumb; }
  if (!pl.prompt) return toast("프롬프트가 없습니다", true);
  const mode = (state.hf?.mode || "mcp").toUpperCase();
  const what = pl.kind === "image" && pl.modelName ? `이미지 (${pl.modelName} · ${pl.resolution || ""}${pl.skin ? " · 피부 디테일" : ""})` : pl.kind === "video" ? `영상 (${pl.audio ? "음성 맞춤 · " : ""}${pl.modelName ? `${pl.modelName} · ` : ""}${pl.resolution || state.hf?.videoRes || "480p"}, ${pl.modelName ? `약 ${Math.round(pl.duration || 5)}` : Math.max(4, Math.round(pl.duration || 5))}초${pl.withAudio ? " · 소리" : ""})` : `이미지 (${state.hf?.imageRes || "2k"})`;
  if (!confirm(`힉스필드 ${mode}로 ${what}을 만듭니다.\n참조 ${pl.refs?.length || 0}개 · 크레딧이 사용됩니다. 계속할까요?`)) return;
  try {
    await api("/api/hf/generate", { method: "POST", body: pl });
    toast(`힉스필드(${mode})에 요청했습니다 — 끝나면 이 칸에 자동으로 들어갑니다`);
  } catch (err) { toast(err.message, true); }
});

// ── 제품 합성 (A): 생성한 빈 배경 위에 실제 제품 사진을 얹는다 ──
const comp = { bg: "", srcs: [], box: { x: 35, y: 40, w: 30, h: 30 }, img: null };
async function openComposite(ad, v, bgUrl) {
  comp.ad = ad; comp.v = v;
  comp.srcs = (v.refs || []).filter((r) => ["product", "upload", "person"].includes(r.role)).map((r) => ({ label: `${r.n}. ${r.label}${r.name ? ` · ${r.name}` : ""}`, url: fileUrl(ad, r.file) }));
  $("#compSrc").innerHTML = comp.srcs.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join("") || `<option value="">제품 이미지를 올리세요</option>`;
  const pb = v.product_box || {};
  comp.box = pb.w > 0 && pb.h > 0 ? { x: +pb.x, y: +pb.y, w: +pb.w, h: +pb.h } : { x: 35, y: 40, w: 30, h: 30 };
  $("#compBg").src = bgUrl;
  await new Promise((r) => { if ($("#compBg").complete) r(); else $("#compBg").onload = r; });
  $("#compDialog").showModal();
  await compLoadSrc(comp.srcs[0]?.url);
}
async function compLoadSrc(url) {
  if (!url) return;
  comp.img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
  // 상자 비율을 제품 사진 비율에 맞춘다 (가로 기준)
  const bg = $("#compBg");
  const ar = comp.img.naturalHeight / comp.img.naturalWidth, bgAr = (bg.naturalWidth || 1) / (bg.naturalHeight || 1);
  comp.box.h = Math.min(95, comp.box.w * ar * bgAr);
  compDraw();
}
// 제품 이미지 → (흰 배경 지우기·반전) 처리한 캔버스
function compProcessed() {
  const im = comp.img; if (!im) return null;
  const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext("2d");
  if ($("#compFlip").checked) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(im, 0, 0);
  if ($("#compWhite").checked) {
    const thr = Number($("#compThr").value), d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const m = Math.min(px[i], px[i + 1], px[i + 2]);
      if (m >= thr) px[i + 3] = 0; else if (m > thr - 12) px[i + 3] = Math.round(px[i + 3] * (thr - m) / 12); // 가장자리는 부드럽게
    }
    g.putImageData(d, 0, 0);
  }
  return c;
}
function compDraw() {
  const b = comp.box, el = $("#compProd");
  Object.assign(el.style, { left: b.x + "%", top: b.y + "%", width: b.w + "%", height: b.h + "%" });
  Object.assign($("#compShadow").style, { left: b.x + b.w * 0.08 + "%", top: b.y + b.h * 0.93 + "%", width: b.w * 0.84 + "%", display: $("#compShadowOn").checked ? "block" : "none" });
  const pc = compProcessed(), cv = $("#compProdCv");
  if (!pc) return;
  cv.width = pc.width; cv.height = pc.height; cv.getContext("2d").drawImage(pc, 0, 0);
}
$("#compSrc").addEventListener("change", () => compLoadSrc(comp.srcs[Number($("#compSrc").value)]?.url));
$("#compUp").addEventListener("change", () => { const f = $("#compUp").files[0]; if (!f) return; const url = URL.createObjectURL(f); comp.srcs.push({ label: `올린 사진 · ${f.name}`, url }); $("#compSrc").innerHTML += `<option value="${comp.srcs.length - 1}">${esc(`올린 사진 · ${f.name}`)}</option>`; $("#compSrc").value = String(comp.srcs.length - 1); compLoadSrc(url); });
["compWhite", "compThr", "compShadowOn", "compFlip"].forEach((id) => $(`#${id}`).addEventListener("input", compDraw));
$("#compClose").addEventListener("click", () => $("#compDialog").close());
$("#compStage").addEventListener("pointerdown", (ev) => {
  const el = ev.target.closest("#compProd"); if (!el) return;
  ev.preventDefault();
  const st = $("#compStage").getBoundingClientRect(), resize = ev.target.classList.contains("txed__handle");
  const sx = ev.clientX, sy = ev.clientY, o = { ...comp.box }, ar = o.h / o.w;
  el.setPointerCapture(ev.pointerId);
  const move = (m) => {
    const dx = (m.clientX - sx) / st.width * 100, dy = (m.clientY - sy) / st.height * 100;
    if (resize) { comp.box.w = clamp(o.w + dx, 3, 100 - o.x); comp.box.h = comp.box.w * ar; } // 비율 유지
    else { comp.box.x = clamp(o.x + dx, -o.w / 2, 100 - o.w / 2); comp.box.y = clamp(o.y + dy, -o.h / 2, 100 - o.h / 2); }
    compDraw();
  };
  const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
  el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
});
$("#compSave").addEventListener("click", async () => {
  const bg = $("#compBg"), pc = compProcessed();
  if (!pc || !bg.naturalWidth) return toast("배경과 제품 이미지가 필요합니다", true);
  const W = bg.naturalWidth, H = bg.naturalHeight, b = comp.box;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.drawImage(bg, 0, 0, W, H);
  const x = b.x / 100 * W, y = b.y / 100 * H, w = b.w / 100 * W, h = b.h / 100 * H;
  if ($("#compShadowOn").checked) { // 바닥에 떨어지는 부드러운 그림자
    g.save(); g.filter = `blur(${Math.max(4, w * 0.04)}px)`; g.fillStyle = "rgba(0,0,0,.28)";
    g.beginPath(); g.ellipse(x + w / 2, y + h * 0.97, w * 0.42, Math.max(3, h * 0.035), 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  g.drawImage(pc, x, y, w, h);
  try {
    await api(`/api/brands/${state.current.id}/prompts/variants/composite`, { method: "POST", body: { dir: comp.ad.dir, vid: comp.v.vid, data: c.toDataURL("image/png") }, busy: "합성 이미지 저장 중" });
    $("#compDialog").close(); toast("합성 이미지를 저장했습니다");
    loadPrompts(comp.ad).then(() => setDetailTab("variants"));
  } catch (err) { toast(err.message, true); }
});

// ── 영상 만들기 흐름 ─────────────────────────────────────
// ① 템플릿 고르기 → ② 내 템플릿 만들기(복제 + 소재 시트) → ③ 주제·대본 → ④ 목소리 → ⑤ 소재 바꾸기 → ⑥ 장면 만들기(시작 프레임·영상) → ⑦ 모아 보기·자막
// ⑤⑥ 은 템플릿 창의 소재 시트 칸(#tCast)을 이 화면으로 옮겨 와 같이 쓴다
const VM_STEPS = ["템플릿 고르기", "내 템플릿 만들기", "주제·대본", "목소리", "소재 바꾸기", "장면 만들기", "모아 보기·자막"];
state.vm = { tplId: null, step: 0 };
const vmTpl = () => (state.templates || []).find((t) => t.id === state.vm.tplId);
function vmDone(i) {
  const t = vmTpl();
  const sc = t?.my_prompts?.scenes || [], mm = t?.my_media || {};
  return [!!t, !!(t?.my && t?.cast?.length), !!t?.my_script?.lines?.some((l) => l.voiceover || l.onscreen_text), !!t?.my_voice?.track, !!t?.cast?.some((c) => c.mine && (c.mine.image || c.mine.resource || c.mine.desc || Object.values(c.mine.fields || {}).some(Boolean))),
    sc.length > 0 && sc.every((x) => mm[x.shot]?.video), false][i];
}
async function loadVmake(keepStep) {
  state.templates = await api("/api/templates");
  if (state.vm.tplId && !vmTpl()) state.vm = { tplId: null, step: 0 };
  if (!keepStep && state.vm.tplId) { const t = vmTpl(); state.vm.step = !t.my || !t.cast?.length ? 1 : t.my_prompts?.method === "frame_edit" ? 5 : t.my_voice ? 4 : t.my_script ? 3 : 2; }
  vmRender();
}
function vmRender() {
  // 소재 칸에서 고친 내용(state.tpl)을 목록 쪽에도 반영해 둔다
  if (state.tpl?.id && state.tpl.id === state.vm.tplId) { const i = state.templates.findIndex((x) => x.id === state.tpl.id); if (i >= 0) state.templates[i] = state.tpl; }
  const t = vmTpl(), v = state.vm.step;
  $("#vmSteps").innerHTML = VM_STEPS.map((n, i) => `<li><button type="button" class="st-step ${i === v ? "is-on" : ""} ${vmDone(i) ? "is-done" : ""}" data-vmstep="${i}" ${i > 0 && !t ? "disabled" : i > 1 && !(t?.my && t?.cast?.length) ? "disabled" : ""}><b>${vmDone(i) ? "✓" : i + 1}</b>${n}</button></li>`).join("");
  const host = $("#vmCastHost");
  host.hidden = !(v === 4 || v === 5) || !t?.cast?.length;
  host.className = `vm-host vm-host--${v === 4 ? "cast" : "make"}`;
  if (!host.hidden) {
    state.tpl = structuredClone(t);
    if ($("#tCast").parentElement !== host) host.append($("#tCast"));
    renderCast();
    // 3단계 대본이 있으면 장면 프롬프트도 그 대본으로 쓴다
    if (t.my_script?.lines?.length) { $("#tMyTopic").value = t.my_script.topic || t.my_script.product || ""; $("#tMyTopic").placeholder = "3단계 대본을 그대로 씁니다"; }
  }
  $("#vmPanel").innerHTML = [vmPick, vmMy, vmScript, vmVoice, vmCast, vmMake, vmReel][v](t);
  if (v === 3) vmVoiceOptions(t);
  $("#vmNext").innerHTML = v === 4 ? `<div class="st-next"><button class="btn btn--primary" type="button" data-vmgo="5">다음: 장면 만들기 →</button></div>`
    : v === 5 ? `<div class="st-next"><button class="btn btn--primary" type="button" data-vmgo="6">다음: 모아 보기·자막 →</button></div>` : "";
}
function vmPick() {
  const list = (state.templates || []).filter((x) => !x.kind);
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>1</b> 어떤 영상을 따라 만들까요?</h3>
    <p class="muted small" style="margin:0">공용 광고 수집에서 영상을 분석한 뒤 상세 화면의 <b>템플릿으로 저장</b>을 누르면 여기에 생깁니다. <a href="#collect">📥 광고 수집 (공용)으로 →</a></p>
    <div class="grid mk-tpls">${list.map((x) => `<button class="card ${x.id === state.vm.tplId ? "is-picked" : ""}" type="button" data-vmtpl="${x.id}">
      <div class="card__thumb"><img src="${tplUrl(x.id, "cover.jpg")}" alt="" loading="lazy" onerror="this.remove()"><span class="badge">${x.my ? "내 템플릿" : "원본"}</span><span class="card__dur">${x.format?.duration_s ?? "?"}초 · ${x.slots?.length ?? 0}컷</span></div>
      <div class="card__body"><div class="card__meta">${esc(x.hook_type || "")}${x.tone ? " · " + esc(x.tone) : ""}</div><strong>${esc(x.name || x.id)}</strong>
        <div class="card__text">${x.my ? `소재 ${x.cast?.length || 0}개${x.my_prompts ? " · 장면 프롬프트 있음" : ""}` : esc(x.summary || "")}</div></div>
    </button>`).join("") || `<p class="muted">아직 영상 템플릿이 없습니다.</p>`}</div>
  </section>`;
}
function vmMy(t) {
  if (!t) return "";
  const ready = t.my && t.cast?.length;
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>2</b> 내 템플릿 만들기</h3>
    <div class="vm-info"><img src="${tplUrl(t.id, "cover.jpg")}" alt="" onerror="this.remove()">
      <div><strong>${esc(t.name)}</strong><p class="small" style="margin:4px 0">${esc(t.summary || "")}</p>
        <p class="muted small" style="margin:0">${t.format?.duration_s ?? "?"}초 · ${t.slots?.length ?? 0}컷 · ${esc(t.format?.aspect || "")}${t.source?.brand ? ` · 출처 ${esc(t.source.brand)}` : ""}</p></div></div>
    ${ready ? `<p class="small" style="margin:0">✓ 내 템플릿이 준비됐습니다 — 바꿀 수 있는 소재 ${t.cast.length}개.</p>`
      : `<p class="small" style="margin:0">${t.my ? "이 내 템플릿에 소재 시트를 만듭니다." : "원본은 그대로 두고 복제한 뒤, 분석값에서 바꿀 수 있는 소재(인물·배경·제품·소품·목소리…)를 시트로 뽑습니다. 1~2분 걸립니다."}</p>
         <button class="btn btn--primary" type="button" data-vmmy>${t.my ? "소재 시트 만들기" : "내 템플릿으로 만들기"}</button>`}
  </section>${ready ? `<div class="st-next"><button class="btn btn--primary" type="button" data-vmgo="2">다음: 주제·대본 →</button></div>` : ""}`;
}
// ③ 주제·대본: 주제(추천받기) → 컷별 대사·화면 글자 → 고쳐서 저장. 장면 프롬프트(⑤)가 이 대본을 그대로 쓴다
const VM_FIELDS = [["topic", "주제", "예: 물걸레 로봇청소기 첫 사용 후기"], ["product", "제품·서비스", "예: ○○ 로봇청소기 X5"], ["target", "누구에게", "예: 반려동물 키우는 30대 맞벌이"],
  ["message", "꼭 전할 말·혜택", "예: 털 엉킴 없음, 이번 주 20% 할인 (확인된 사실만)"], ["tone", "톤", "예: 친근한 반말, 빠른 템포"], ["notes", "참고·금지", "예: 경쟁사 이름 금지"]];
state.vmIdeas = null;
function vmScript(t) {
  const sc = t.my_script || {}, lines = sc.lines || [];
  const syl = (x) => String(x || "").replace(/[^가-힣a-zA-Z0-9]/g, "").length;
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>3</b> 주제·대본</h3>
    <p class="muted small" style="margin:0">원본의 컷 길이·말투 형식(${esc(t.hook_type || "훅")} · ${t.slots?.length || 0}컷 · ${t.format?.duration_s ?? "?"}초)은 그대로 두고, 내 주제로 컷마다 대사와 화면 글자를 새로 씁니다. 4단계에서 이 대사를 목소리로 읽히고, 6단계 장면 프롬프트도 이 대본을 그대로 씁니다.</p>
    <div class="vm-brief">${VM_FIELDS.map(([k, label, ph]) => `<label class="field ${k === "topic" ? "vm-brief__wide" : ""}"><span>${label}</span><input data-vmin="${k}" value="${esc(sc[k] || "")}" placeholder="${esc(ph)}"></label>`).join("")}</div>
    <div class="row"><button class="btn" type="button" data-vmideas>주제 추천받기</button>
      <button class="btn btn--primary" type="button" data-vmwrite>${lines.length ? "대본 다시 쓰기" : "대본 쓰기"}</button>
      <span class="muted small">Claude 가 씁니다 · 1~2분</span></div>
    ${state.vmIdeas?.tid === t.id ? `<div class="vm-ideas">${(state.vmIdeas.ideas || []).map((x, i) => `<button type="button" class="vc__chip" data-vmidea="${i}"><strong>${esc(x.topic)}</strong><span>훅: ${esc(x.hook || "")}</span><span>${esc(x.angle || "")}</span></button>`).join("")}</div>` : ""}
  </section>
  ${lines.length ? `<section class="panel mk-sec">
    <div class="vm-brief">
      <label class="field vm-brief__wide"><span>영상 제목</span><input data-vmmeta="title" value="${esc(sc.title || "")}"></label>
      <label class="field"><span>훅</span><input data-vmmeta="hook" value="${esc(sc.hook || "")}"></label>
      <label class="field"><span>행동 유도 (CTA)</span><input data-vmmeta="cta" value="${esc(sc.cta || "")}"></label>
    </div>
    ${sc.ai_notes ? `<p class="note small" style="margin:0">✍ Claude 메모: ${esc(sc.ai_notes)}</p>` : ""}
    <div class="vm-lines">${lines.map((l) => { const n = syl(l.voiceover), max = Math.round((+l.dur || 0) * 4.5); return `<div class="vm-line" data-vmline="${l.shot}">
      <div class="vm-line__head"><b>컷 ${l.shot}</b><span class="muted small">${(+l.start || 0).toFixed(1)}s · ${l.dur}s${l.section ? ` · ${esc(l.section)}` : ""}</span></div>
      ${l.orig_speech || l.orig_text ? `<p class="vm-line__orig small">원본: ${esc([l.orig_speech, l.orig_text && `[글자] ${l.orig_text}`].filter(Boolean).join(" "))}</p>` : ""}
      <label class="field"><span>대사 <em class="${n > max && max ? "vm-over" : "muted"}">${n}음절 / 권장 ${max}음절 이내</em></span><textarea rows="${Math.min(8, Math.max(2, Math.ceil(String(l.voiceover).length / 60)))}" data-vmf="voiceover">${esc(l.voiceover)}</textarea></label>
      <label class="field"><span>화면 글자 (줄바꿈 그대로)</span><textarea rows="${Math.max(1, String(l.onscreen_text).split("\n").length)}" data-vmf="onscreen_text">${esc(l.onscreen_text)}</textarea></label>
    </div>`; }).join("")}</div>
    <p class="muted small" style="margin:0">고친 내용은 바로 저장됩니다. 권장 음절은 한국어 1초에 4~5음절 기준입니다 (제 기준값).</p>
  </section>
  <div class="st-next"><button class="btn btn--primary" type="button" data-vmgo="3">다음: 목소리 →</button></div>`
  : `<div class="st-next"><button class="btn" type="button" data-vmgo="4">대본 없이 원본 형식으로 → 소재 바꾸기</button></div>`}`;
}
const vmBrief = () => Object.fromEntries([...document.querySelectorAll("[data-vmin]")].map((i) => [i.dataset.vmin, i.value.trim()]));
let vmSaveT = 0;
function vmSaveScript() {
  clearTimeout(vmSaveT);
  vmSaveT = setTimeout(async () => {
    const t = vmTpl(); if (!t?.my_script) return;
    const body = { ...vmBrief(), ...Object.fromEntries([...document.querySelectorAll("[data-vmmeta]")].map((i) => [i.dataset.vmmeta, i.value])),
      lines: [...document.querySelectorAll("[data-vmline]")].map((d) => ({ shot: Number(d.dataset.vmline), voiceover: d.querySelector('[data-vmf="voiceover"]').value, onscreen_text: d.querySelector('[data-vmf="onscreen_text"]').value })) };
    try { const r = await api(`/api/templates/${t.id}/my-script`, { method: "PUT", body }); t.my_script = r.my_script; } catch (err) { toast(err.message, true); }
  }, 600);
}
$("#vmakeView").addEventListener("input", (e) => {
  if (!e.target.closest("[data-vmf], [data-vmmeta], [data-vmin]")) return;
  const ta = e.target.closest('[data-vmf="voiceover"]');
  if (ta) { // 음절 수 바로 갱신
    const d = ta.closest("[data-vmline]"), l = vmTpl()?.my_script?.lines?.find((x) => x.shot === Number(d.dataset.vmline));
    const n = ta.value.replace(/[^가-힣a-zA-Z0-9]/g, "").length, max = Math.round((+l?.dur || 0) * 4.5), em = d.querySelector("em");
    em.textContent = `${n}음절 / 권장 ${max}음절 이내`; em.className = n > max && max ? "vm-over" : "muted";
  }
  vmSaveScript();
});
// ④ 목소리: 목소리 고르기(기본·복제·저장한 목소리) → 대사를 컷마다 읽히기 → 컷 시작 시각에 맞춘 내레이션 한 줄
function vmVoice(t) {
  const lines = (t.my_script?.lines || []).filter((l) => String(l.voiceover || "").trim()), mv = t.my_voice;
  if (!lines.length) return `<section class="panel mk-sec"><h3 class="mk-step"><b>4</b> 목소리</h3>
    <p class="muted small" style="margin:0">읽힐 대사가 없습니다. 3단계에서 대본을 먼저 쓰거나, 목소리 없이 넘어가세요.</p></section>
    <div class="st-next"><button class="btn" type="button" data-vmgo="2">← 주제·대본</button><button class="btn" type="button" data-vmgo="4">목소리 없이 → 소재 바꾸기</button></div>`;
  const by = Object.fromEntries((mv?.lines || []).map((x) => [x.shot, x]));
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>4</b> 목소리</h3>
    <p class="muted small" style="margin:0">대사 ${lines.length}컷을 고른 목소리로 읽혀, 컷 시작 시각에 맞춘 내레이션 한 줄을 만듭니다. 이 PC 의 Qwen3-TTS 로 무료로 만듭니다.</p>
    <div class="row"><label class="field" style="flex:1 1 260px;margin:0"><span>목소리</span><select id="vmVoiceSel"><option value="">불러오는 중…</option></select></label>
      <button class="btn btn--primary" type="button" data-vmvoice>${mv ? "전부 다시 읽히기" : "대본 읽히기"}</button>
      <a class="btn btn--ghost btn--sm" href="#res/resources/voice">🎙 새 목소리 만들기·복제 ↗</a></div>
  </section>
  ${mv ? `<section class="panel mk-sec">
    <div class="row"><strong>내레이션</strong><span class="muted small">${esc(mv.voice_name || "")}</span></div>
    <audio controls preload="metadata" src="${tplUrl(t.id, mv.track)}?v=${encodeURIComponent(mv.updated_at || "")}" style="width:100%"></audio>
    <div class="vm-lines">${lines.map((l) => { const x = by[l.shot], stale = x && x.text !== l.voiceover, over = x && x.dur > x.cut_dur + 0.2; return `<div class="vm-line">
      <div class="vm-line__head"><b>컷 ${l.shot}</b><span class="muted small">${(+l.start || 0).toFixed(1)}s · 컷 ${l.dur}s</span>
        ${x ? `<span class="small ${over ? "vm-over" : "muted"}">읽기 ${x.dur}s${over ? " — 컷보다 깁니다 (대사를 줄이거나 컷을 늘리세요)" : ""}</span>` : `<span class="small vm-over">아직 안 읽힘</span>`}
        ${stale ? `<span class="small vm-over">대본이 바뀌었습니다</span>` : ""}
        <button class="btn btn--sm" type="button" data-vmvoiceshot="${l.shot}">이 컷만 다시</button></div>
      <p class="small" style="margin:0">${esc(l.voiceover)}</p>
      ${x ? `<audio controls preload="none" src="${tplUrl(t.id, x.file)}" style="width:100%"></audio>` : ""}
    </div>`; }).join("")}</div>
  </section>
  <div class="st-next"><a class="btn" href="${tplUrl(t.id, mv.track)}" download="${esc((t.my_script?.title || t.name || "narration").replace(/[\\/:*?"<>|]/g, "").slice(0, 40))}_내레이션.wav">내레이션 받기 (wav)</a>
    <button class="btn btn--primary" type="button" data-vmgo="4">다음: 소재 바꾸기 →</button></div>`
  : `<div class="st-next"><button class="btn" type="button" data-vmgo="4">목소리 없이 → 소재 바꾸기</button></div>`}`;
}
async function vmVoiceOptions(t) {
  const list = await api("/api/voice/choices").catch(() => []), sel = $("#vmVoiceSel"); if (!sel) return;
  const groups = [...new Set(list.map((x) => x.group))];
  sel.innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">${list.filter((x) => x.group === g).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</optgroup>`).join("") || `<option value="">목소리가 없습니다 — 리소스 → 목소리에서 만드세요</option>`;
  sel.value = t.my_voice?.voice || state.vmVoice || "qwen3:speaker:Sohee";
}
const vmCast = () => `<section class="panel mk-sec"><h3 class="mk-step"><b>5</b> 소재 바꾸기</h3>
  <p class="muted small" style="margin:0">바꿀 소재에 내 이미지(캐릭터 시트·배경·제품 사진)를 올리거나 설정을 적으세요. 그대로 둘 소재는 비워 두거나 "원본 그대로 두기"를 체크합니다. 입력은 바로 저장됩니다.</p></section>`;
const vmMake = () => `<section class="panel mk-sec"><h3 class="mk-step"><b>6</b> 장면 만들기</h3>
  <p class="muted small" style="margin:0">[내 소재로 장면 프롬프트 만들기] → 컷마다 ① 시작 프레임(원본 프레임 편집) → ② 영상(시작 프레임을 움직이기). 힉스필드로 만들거나 직접 만든 걸 올리세요.</p></section>`;
function vmReel(t) {
  const sc = t?.my_prompts?.scenes || [], mm = t?.my_media || {};
  const done = sc.filter((x) => mm[x.shot]?.video).length;
  return `<section class="panel mk-sec">
    <h3 class="mk-step"><b>7</b> 모아 보기·자막</h3>
    <p class="muted small" style="margin:0">만든 컷 영상 ${done}/${sc.length}개를 순서대로 이어 붙입니다 (캡컷 등). 자막은 SRT 로 받아 얹으세요.</p>
    ${sc.length ? `<div class="st-reel">${sc.map((x) => `<figure>${mm[x.shot]?.video ? `<video src="${tplUrl(t.id, mm[x.shot].video)}" controls muted playsinline preload="metadata"></video>` : mm[x.shot]?.frame ? `<img src="${tplUrl(t.id, mm[x.shot].frame)}" alt="">` : `<span class="muted small">컷 ${x.shot}</span>`}<figcaption>${x.shot} · ${x.dur}s${mm[x.shot]?.video ? "" : " · 영상 없음"}</figcaption></figure>`).join("")}</div>` : `<p class="muted">아직 장면 프롬프트가 없습니다 — 6단계에서 만드세요.</p>`}
    ${t?.my_voice?.track ? `<div class="row"><strong class="small">내레이션</strong><audio controls preload="metadata" src="${tplUrl(t.id, t.my_voice.track)}?v=${encodeURIComponent(t.my_voice.updated_at || "")}" style="flex:1 1 260px;min-width:0"></audio><a class="btn btn--sm" href="${tplUrl(t.id, t.my_voice.track)}" download>받기</a></div>` : ""}
    <div class="row"><button class="btn" type="button" data-vmsrt ${sc.length || t?.my_script?.lines?.length ? "" : "disabled"}>자막 SRT 받기</button></div>
  </section>`;
}
// 대사·화면 글자로 SRT
function vmSrt(t) {
  const ts = (x) => { const ms = Math.round(x * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  let n = 0;
  // 3단계 대본이 있으면 그 대본, 4단계 목소리가 있으면 읽은 길이만큼만 자막을 띄운다
  const vd = Object.fromEntries((t.my_voice?.lines || []).map((x) => [x.shot, x.dur]));
  return (t.my_script?.lines?.length ? t.my_script.lines : t.my_prompts?.scenes || []).filter((x) => x.voiceover || x.onscreen_text)
    .map((x) => `${++n}\n${ts(+x.start || 0)} --> ${ts((+x.start || 0) + Math.min(+x.dur || 2, vd[x.shot] ? vd[x.shot] + 0.2 : Infinity) - 0.05)}\n${x.voiceover || x.onscreen_text}\n`).join("\n");
}
$("#vmakeView").addEventListener("click", async (e) => {
  const st = e.target.closest("[data-vmstep]");
  if (st && !st.disabled) { state.vm.step = Number(st.dataset.vmstep); return vmRender(); }
  const go = e.target.closest("[data-vmgo]");
  if (go) { state.vm.step = Number(go.dataset.vmgo); vmRender(); return window.scrollTo({ top: 0, behavior: "smooth" }); }
  const vb = e.target.closest("[data-vmvoice], [data-vmvoiceshot]");
  if (vb) {
    const t = vmTpl(), sel = $("#vmVoiceSel"), voice = sel?.value || t.my_voice?.voice;
    if (!voice) return toast("목소리를 고르세요", true);
    state.vmVoice = voice;
    const shot = vb.dataset.vmvoiceshot != null ? Number(vb.dataset.vmvoiceshot) : null;
    if (shot != null && t.my_voice && t.my_voice.voice !== voice && !confirm("목소리를 바꿨습니다. 이 컷만이 아니라 전부 새 목소리로 다시 읽힐까요?")) return;
    try { await api(`/api/templates/${t.id}/my-voice`, { method: "POST", body: { voice, voiceName: sel?.selectedOptions[0]?.textContent || "", ...(shot != null && (!t.my_voice || t.my_voice.voice === voice) ? { shot } : {}) } }); toast(shot != null ? `컷 ${shot} 다시 읽히는 중` : "대본 읽히는 중 — 컷마다 몇 초씩 걸립니다"); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (e.target.closest("[data-vmideas]")) {
    const t = vmTpl();
    try { const r = await api(`/api/templates/${t.id}/my-topics`, { method: "POST", body: vmBrief(), busy: "주제 추천받는 중 (1분 안팎)" }); state.vmIdeas = { tid: t.id, ...r }; vmRender(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const idea = e.target.closest("[data-vmidea]");
  if (idea) { const x = state.vmIdeas.ideas[Number(idea.dataset.vmidea)]; $('[data-vmin="topic"]').value = x.topic; vmSaveScript(); return toast("주제를 넣었습니다 — [대본 쓰기]를 누르세요"); }
  if (e.target.closest("[data-vmwrite]")) {
    const t = vmTpl(), b = vmBrief();
    if (!b.topic && !b.product) return toast("주제나 제품을 적으세요", true);
    if (t.my_script?.lines?.length && !confirm("지금 대본을 지우고 새로 쓸까요?")) return;
    try { await api(`/api/templates/${t.id}/my-script`, { method: "POST", body: b }); toast("대본 쓰는 중 (1~2분) — 끝나면 아래에 나옵니다"); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const pick = e.target.closest("[data-vmtpl]");
  if (pick) { state.vm.tplId = pick.dataset.vmtpl; return loadVmake(); }
  if (e.target.closest("[data-vmmy]")) {
    const t = vmTpl();
    try { const r = await api(`/api/templates/${t.id}/cast`, { method: "POST", body: { copy: !t.my } }); state.castPending = r.id; state.vm.tplId = r.id; toast(t.my ? "소재 시트 만드는 중 (1~2분)" : "내 템플릿으로 복제했습니다 — 소재 시트 만드는 중 (1~2분)"); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (e.target.closest("[data-vmsrt]")) {
    const t = vmTpl(), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([vmSrt(t)], { type: "application/x-subrip" }));
    a.download = `${(t.name || t.id).replace(/[\\/:*?"<>|]/g, "").slice(0, 40)}.srt`; a.click();
  }
});

// ── 카드뉴스 템플릿 편집기 ──────────────────────────────
// 디자인(전체 공통) · 구조(장 순서·추가·삭제) · 장 편집(배치·블록). 고칠 때마다 미리보기를 다시 그린다.
const CE_COLORS = [["bg", "바탕"], ["text", "글자"], ["muted", "흐린 글자"], ["accent", "강조"], ["accent_text", "강조 위 글자"], ["dark_bg", "어두운 바탕"], ["dark_text", "어두운 바탕 글자"]];
const CE_TEXTS = [["label", "머리말 (맨 위)"], ["handle", "계정명"], ["next_button", "다음 버튼"], ["cta_button", "마지막 장 버튼", "팔로우 →"]];
const CE_LAYOUTS = { cover: "표지 — 사진 배경", content: "본문 — 밝은 바탕", quote: "인용 — 어두운 바탕", cta: "마무리 — 강조색 바탕" };
const CE_IMAGES = { none: "사진 없음", full: "전체 배경", inset: "본문 사이" };
// 블록 종류 — 칸(경로, 이름, 입력 방식)과 새로 넣을 때 기본값
const CE_BLOCKS = {
  label: { name: "머리말", fields: [["text", "글", "text"]], def: { text: "{{design.label}}", max_chars: 14 } },
  tag: { name: "꼬리표", fields: [["text", "글", "text"]], def: { text: "꼬리표", max_chars: 10 } },
  title: { name: "제목", fields: [["text", "글 (엔터로 줄바꿈)", "area"], ["highlight", "강조 낱말 (제목 안에 있는 낱말)", "text"]], def: { text: "제목을 적으세요", highlight: "", max_chars: 24 } },
  subhead: { name: "소제목", fields: [["text", "글", "text"]], def: { text: "소제목", max_chars: 20 } },
  body: { name: "본문", fields: [["text", "글", "area"]], def: { text: "본문 문단을 적으세요.", max_chars: 100 } },
  list: { name: "번호 목록", fields: [["items", "항목 — 한 줄에 하나, 제목 | 설명", "items"]], def: { items: [{ title: "첫째", desc: "설명" }, { title: "둘째", desc: "설명" }, { title: "셋째", desc: "설명" }], max_chars: 60 } },
  stat: { name: "큰 숫자", fields: [["value", "숫자", "text"], ["unit", "단위", "text"], ["caption", "설명", "text"]], def: { value: "3배", unit: "", caption: "설명", max_chars: 20 } },
  compare: { name: "전·후 비교", fields: [["before.title", "전 — 제목", "text"], ["before.items", "전 — 항목 (한 줄에 하나)", "lines"], ["after.title", "후 — 제목", "text"], ["after.items", "후 — 항목 (한 줄에 하나)", "lines"]], def: { before: { title: "BEFORE", items: ["전 1", "전 2"] }, after: { title: "AFTER", items: ["후 1", "후 2"] }, max_chars: 60 } },
  box: { name: "상자", fields: [["title", "상자 제목", "text"], ["text", "글", "area"], ["dark", "어두운 상자", "check"]], def: { title: "", text: "상자 안 글", dark: false, max_chars: 80 } },
  quote: { name: "인용", fields: [["text", "인용문", "area"], ["source", "출처", "text"]], def: { text: "인용문", source: "이름", max_chars: 50 } },
  note: { name: "주석", fields: [["text", "글", "area"]], def: { text: "작은 주석", max_chars: 60 } },
};
const CE_H = [["왼쪽", "왼쪽"], ["가운데", "가운데"], ["오른쪽", "오른쪽"]];
const CE_V = [["위", "위"], ["가운데", "가운데"], ["아래", "아래"]];
// 정렬 버튼 묶음 — scope: d(디자인) · s(장) · b(블록). 빈 값 = 위 단계 설정을 따름
const ceSeg = (scope, key, opts, cur, def) => `<div class="seg ce-seg">${(def ? [["", `기본 (${def})`], ...opts] : opts)
  .map(([v, l]) => `<button type="button" class="seg__btn ${v === (cur || "") ? "is-on" : ""}" data-seg="${scope}" data-k="${key}" data-v="${v}">${l}</button>`).join("")}</div>`;
const CE_NEW_SLIDE = { cover: ["title"], content: ["label", "title", "body"], quote: ["quote"], cta: ["title", "body"] };
const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((x, k) => (x[k] ||= {}), o)[last] = v; };
const toField = (v, kind) => kind === "lines" ? (v || []).join("\n") : kind === "items" ? (v || []).map((it) => [it.title, it.desc].filter(Boolean).join(" | ")).join("\n") : v ?? "";
const fromField = (el, kind) => kind === "check" ? el.checked
  : kind === "lines" ? el.value.split("\n").map((x) => x.trim()).filter(Boolean)
  : kind === "items" ? el.value.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => { const [title, ...d] = x.split("|"); return { title: title.trim(), desc: d.join("|").trim() }; })
  : kind === "num" ? Number(el.value) || 0 : el.value;
const hex6 = (c) => /^#[0-9a-f]{6}$/i.test(c || "") ? c : /^#[0-9a-f]{3}$/i.test(c || "") ? "#" + [...c.slice(1)].map((x) => x + x).join("") : "#000000";

let ceSeq = 0;
function openCardEditor(t) {
  const tt = structuredClone(t);
  tt.design = { ...tt.design };
  // 예시 글이 example 안에 들어 있는 템플릿도 블록에 바로 펼친다. _k 는 흐름(flow)의 장 번호를 다시 맞추는 데 쓴다
  tt.slides = (tt.slides || []).map((s, i) => ({ ...exampleSlide(s), ref: "ref" in s ? s.ref : tt.media?.refs?.[i] ?? null, _k: s.n ?? i + 1 }))
    .map((s) => ({ ...s, blocks: s.blocks.map(({ example, ...b }) => b) }));
  ceOpen(tt);
}
// 만든 카드뉴스 편집 — 같은 편집기를 쓰고, 장마다 사진·영상을 바꿀 수 있다. 색·글자는 이 카드뉴스에만 덮어쓴다
function openMadeEditor(t, c) {
  const tt = {
    ...structuredClone(t), name: c.title || c.topic || "", caption: c.caption || "",
    design: { ...t.design, ...(c.design || {}) },
    slides: structuredClone(c.slides || []).map((s, i) => ({ ...s, _k: i + 1 })),
    __card: { cid: c.cid, tpl: t },
  };
  ceOpen(tt);
}
function ceOpen(tt) {
  ceSeq = 1000;
  const card = !!tt.__card;
  const prev = state.ce?.tab;
  state.ce = { t: tt, sel: 0, tab: prev === "ai" && card ? "design" : prev === "ai" ? "design" : prev || "design", dirty: false, ai: { text: "", busy: false, proposal: null } };
  document.querySelector('#ceTabs [data-tab="ai"]').hidden = card;
  $("#ceName").placeholder = card ? "카드뉴스 제목" : "템플릿 이름";
  api("/api/kits").then((k) => { state.kits = k; if (state.ce.tab === "design") cePanel(); }).catch(() => {});
  $("#ceName").value = tt.name || "";
  $("#ceDialog").showModal();
  $("#ceName").setSelectionRange(0, 0); $("#ceName").scrollLeft = 0; // 긴 이름이 뒤쪽만 보이지 않게
  ceRender();
}
const ceDirty = (on = true) => { state.ce.dirty = on; $("#ceDirty").textContent = on ? "저장 안 됨" : ""; };
function ceRender() { cePanel(); cePreview(); }
// 장에 깔 사진·영상: 템플릿은 원본 캐러셀 사진, 만든 카드뉴스는 그 카드뉴스에 넣은 사진·영상
const ceMedia = (t, s, i) => t.__card
  ? (s.video_file || s.image_file ? tplUrl(t.id, `cards/${t.__card.cid}/${s.video_file || s.image_file}`) : null)
  : s.image !== "none" ? slideRef(t, s, i) : null;
function cePreview() {
  const { t, sel } = state.ce, n = t.slides.length;
  const html = (s, i) => renderSlideHTML(t, s, ceMedia(t, s, i), i === n - 1);
  const s = t.slides[sel];
  // 큰 미리보기는 칸 폭에 맞춘다 (좁은 화면에서 넘치지 않게)
  const bw = Math.max(200, Math.min(380, ($(".ce-preview")?.clientWidth || 420) - 40));
  $("#ceBig").innerHTML = s ? scaled(html(s, sel), t, bw) : "<p class='muted'>장이 없습니다. 구조 탭에서 장을 추가하세요.</p>";
  $("#ceStrip").innerHTML = t.slides.map((x, i) => `<button type="button" class="ce-thumb ${i === sel ? "is-on" : ""}" data-sel="${i}">${scaled(html(x, i), t, 84)}<span>${i + 1}</span></button>`).join("");
}
function cePanel() {
  const { t, tab, sel } = state.ce, d = t.design;
  document.querySelectorAll("#ceTabs .dtabs__item").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
  const sel1 = (name, opts, cur, attrs) => `<select ${attrs}>${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  if (tab === "design") {
    const kits = state.kits || [];
    $("#cePanel").innerHTML = `
      <h4>브랜드 키트 <span class="muted small">— 색·글자·버튼·정렬 묶음을 저장해 두고 다른 템플릿에 씌운다</span></h4>
      <div class="row">
        <select id="ceKit" ${kits.length ? "" : "disabled"}>${kits.length ? kits.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("") : "<option>저장한 키트 없음</option>"}</select>
        <button class="btn btn--sm" type="button" data-act="kitapply" ${kits.length ? "" : "disabled"}>적용</button>
        <button class="btn btn--ghost btn--sm" type="button" data-act="kitdel" ${kits.length ? "" : "disabled"}>지우기</button>
      </div>
      <button class="btn btn--sm" type="button" data-act="kitsave" style="margin-top:var(--s2)">지금 디자인을 키트로 저장</button>
      <h4>색</h4>
      <div class="ce-colors">${CE_COLORS.map(([k, label]) => `<label class="ce-color"><input type="color" value="${hex6(d[k])}" data-d="${k}"><span>${label}<br><code>${esc(d[k] || "")}</code></span></label>`).join("")}</div>
      <h4>글자</h4>
      <div class="stack" style="margin-top:0">
        ${CE_TEXTS.map(([k, label, ph]) => `<label class="field"><span>${label}</span><input value="${esc(d[k] || "")}" placeholder="${esc(ph || "")}" data-d="${k}"></label>`).join("")}
        <label class="field"><span>제목 크기</span>${sel1("", { "크게": "크게", "아주 크게": "아주 크게" }, d.title_size || "크게", 'data-d="title_size"')}</label>
      </div>
      <h4>정렬 <span class="muted small">— 본문·인용·마무리 장의 기본값. 장마다 따로 바꿀 수 있다</span></h4>
      <div class="stack" style="margin-top:0">
        <div class="field"><span>가로</span>${ceSeg("d", "align", CE_H, d.align || "왼쪽")}</div>
        <div class="field"><span>세로 (글 묶음 위치)</span>${ceSeg("d", "valign", CE_V, d.valign || "위")}</div>
      </div>
      ${t.__card ? `
      <button class="btn btn--ghost btn--sm" type="button" data-act="dreset" style="margin-top:var(--s3)">템플릿 디자인으로 되돌리기</button>
      <h4>캡션 <span class="muted small">— 인스타 게시물 본문</span></h4>
      <textarea rows="8" data-t="caption">${esc(t.caption || "")}</textarea>` : `
      <h4>문장 공식 <span class="muted small">— 한 줄에 하나, Claude 가 글 쓸 때 따른다</span></h4>
      <textarea rows="4" data-t="copy_patterns">${esc((t.copy_patterns || []).join("\n"))}</textarea>`}`;
  } else if (tab === "structure") {
    $("#cePanel").innerHTML = `
      <p class="muted small">끌어서 순서를 바꿉니다. 장을 누르면 미리보기가 그 장으로 갑니다.</p>
      <ol class="ce-slides">${t.slides.map((s, i) => `
        <li class="ce-row ${i === sel ? "is-on" : ""}" draggable="true" data-i="${i}">
          <span class="ce-grip" aria-hidden="true">⋮⋮</span>
          <b>${i + 1}</b>
          <span class="ce-row__main"><strong>${esc(s.role || "장")}</strong> <span class="muted small">${esc(CE_LAYOUTS[s.layout] || s.layout || "")}${s.image && s.image !== "none" ? " · 사진 " + esc(CE_IMAGES[s.image] || s.image) : ""}</span></span>
          <span class="ce-row__btns">
            <button class="btn btn--ghost btn--sm" type="button" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="위로">↑</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="down" ${i === t.slides.length - 1 ? "disabled" : ""} aria-label="아래로">↓</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="edit">편집</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="dup">복제</button>
            <button class="btn btn--ghost btn--sm" type="button" data-act="del">삭제</button>
          </span>
        </li>`).join("")}</ol>
      <div class="row" style="margin-top:var(--s3)">
        ${sel1("", CE_LAYOUTS, "content", 'id="ceNewLayout"')}
        <button class="btn btn--sm" type="button" data-act="add">+ 장 추가 (선택한 장 뒤에)</button>
      </div>`;
  } else if (tab === "ai") {
    const { text, busy, proposal: pr } = state.ce.ai;
    $("#cePanel").innerHTML = `
      <p class="muted small">고치고 싶은 것을 말로 적으면 Claude 가 템플릿을 고친 안을 만듭니다. 바뀐 모습을 보고 <b>적용</b>하면 편집 중인 템플릿에 들어가고, 저장은 따로 누릅니다. 블록 11종·배치 4종 안에서만 고칩니다.</p>
      <textarea id="ceAiText" rows="4" ${busy ? "disabled" : ""} placeholder="예: 표지를 더 미니멀하게, 방법 3단계를 5단계로 늘리고, 마지막 장은 저장을 유도하는 CTA로">${esc(text)}</textarea>
      <button class="btn btn--primary" type="button" data-act="aigo" ${busy ? "disabled" : ""} style="margin-top:var(--s2)">${busy ? "Claude 가 고치는 중… (1~2분)" : "고친 안 만들기"}</button>
      ${pr ? `<div class="ce-ai">
        <h4>고친 안 <span class="muted small">${pr.slides.length}장 · ${pr.took_s}초</span></h4>
        <ul class="cn-flow">${(pr.changes || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <div class="ce-ai__grid">${pr.slides.map((x, i) => `<div>${scaled(renderSlideHTML({ ...t, design: { ...t.design, ...pr.design } }, x, x.image !== "none" ? slideRef(t, x, i) : null, i === pr.slides.length - 1), t, 128)}<span class="muted small">${i + 1}. ${esc(x.role || "")}${x.from ? "" : " · 새 장"}</span></div>`).join("")}</div>
        <div class="row" style="margin-top:var(--s3)">
          <button class="btn btn--primary btn--sm" type="button" data-act="aiapply">적용</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="aidrop">버리기</button>
        </div>
      </div>` : ""}`;
  } else {
    const s = t.slides[sel];
    if (!s) { $("#cePanel").innerHTML = "<p class='muted'>장이 없습니다.</p>"; return; }
    $("#cePanel").innerHTML = `
      <div class="row ce-slidenav">
        <button class="btn btn--ghost btn--sm" type="button" data-act="prev" ${sel === 0 ? "disabled" : ""}>← 이전 장</button>
        <strong>${sel + 1} / ${t.slides.length}장</strong>
        <button class="btn btn--ghost btn--sm" type="button" data-act="next" ${sel === t.slides.length - 1 ? "disabled" : ""}>다음 장 →</button>
      </div>
      ${t.__card ? ceMediaBox(t, s) : ""}
      <div class="stack" style="margin-top:var(--s3)">
        <div class="row">
          <label class="field" style="flex:1 1 100%"><span>역할</span><input value="${esc(s.role || "")}" data-s="role" placeholder="표지 · 문제 제기 · 방법 · CTA …"></label>
          <label class="field"><span>배치</span>${sel1("", CE_LAYOUTS, s.layout || "content", 'data-s="layout" data-re')}</label>
          <label class="field"><span>사진</span>${sel1("", CE_IMAGES, s.image || "none", 'data-s="image" data-re')}</label>
        </div>
        <div class="field"><span>그룹 정렬 — 가로</span>${ceSeg("s", "align", CE_H, s.align, s.layout === "cover" ? "가운데" : d.align || "왼쪽")}</div>
        <div class="field"><span>그룹 정렬 — 세로 (글 묶음 위치)</span>${ceSeg("s", "valign", CE_V, s.valign, s.layout === "cover" ? "아래" : d.valign || "위")}</div>
        <label class="field"><span>이 장이 하는 일 (Claude 에게 주는 설명)</span><textarea rows="2" data-s="purpose">${esc(s.purpose || "")}</textarea></label>
      </div>
      <h4>블록 <span class="muted small">— 위에서 아래로 쌓인다${s.layout === "cover" ? " · 표지는 제목이 맨 아래에 온다" : ""}</span></h4>
      <div class="ce-blocks">${(s.blocks || []).map((b, j) => {
        const def = CE_BLOCKS[b.type];
        return `<div class="ce-block" data-j="${j}">
          <div class="ce-block__head">
            <strong>${esc(def?.name || b.type)}</strong>
            <label class="ce-max">최대 <input type="number" min="0" value="${b.max_chars ?? ""}" data-b="max_chars" data-kind="num">자</label>
            <span class="ce-row__btns">
              <button class="btn btn--ghost btn--sm" type="button" data-act="bup" ${j === 0 ? "disabled" : ""} aria-label="위로">↑</button>
              <button class="btn btn--ghost btn--sm" type="button" data-act="bdown" ${j === s.blocks.length - 1 ? "disabled" : ""} aria-label="아래로">↓</button>
              <button class="btn btn--ghost btn--sm" type="button" data-act="bdel">삭제</button>
            </span>
          </div>
          <div class="field field--inline"><span>정렬</span>${ceSeg("b", "align", CE_H, b.align, "그룹")}</div>
          ${(def?.fields || []).map(([k, label, kind]) => kind === "check"
            ? `<label class="field field--inline"><input type="checkbox" ${getPath(b, k) ? "checked" : ""} data-b="${k}" data-kind="check"><span>${label}</span></label>`
            : `<label class="field"><span>${label}</span>${kind === "text" ? `<input value="${esc(toField(getPath(b, k), kind))}" data-b="${k}" data-kind="${kind}">` : `<textarea rows="${kind === "area" ? 2 : 3}" data-b="${k}" data-kind="${kind}">${esc(toField(getPath(b, k), kind))}</textarea>`}</label>`).join("")}
        </div>`;
      }).join("")}</div>
      <div class="row" style="margin-top:var(--s3)">
        ${sel1("", Object.fromEntries(Object.entries(CE_BLOCKS).map(([k, v]) => [k, v.name])), "body", 'id="ceNewBlock"')}
        <button class="btn btn--sm" type="button" data-act="badd">+ 블록 추가</button>
      </div>`;
  }
}

// 값 입력 — 미리보기만 다시 그린다 (입력칸은 그대로 두어 커서가 안 튄다)
$("#cePanel").addEventListener("input", (e) => {
  const el = e.target, { t, sel } = state.ce;
  if (el.id === "ceAiText") { state.ce.ai.text = el.value; return; }
  if (el.dataset.t === "caption") { t.caption = el.value; ceDirty(); return; }
  if (el.dataset.d) { t.design[el.dataset.d] = el.value; const c = el.closest(".ce-color")?.querySelector("code"); if (c) c.textContent = el.value; }
  else if (el.dataset.t === "copy_patterns") t.copy_patterns = el.value.split("\n").map((x) => x.trim()).filter(Boolean);
  else if (el.dataset.s) t.slides[sel][el.dataset.s] = el.value;
  else if (el.dataset.b) { const j = Number(el.closest("[data-j]").dataset.j); setPath(t.slides[sel].blocks[j], el.dataset.b, fromField(el, el.dataset.kind)); }
  else return;
  ceDirty();
  if (el.matches("[data-re]")) ceRender(); else cePreview();
});
$("#cePanel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  const row = e.target.closest(".ce-row");
  const { t } = state.ce;
  const move = (arr, i, k) => { const [x] = arr.splice(i, 1); arr.splice(k, 0, x); };
  const sg = e.target.closest("[data-seg]");
  if (sg) {
    const { seg, k, v } = sg.dataset;
    const target = seg === "d" ? t.design : seg === "s" ? t.slides[state.ce.sel] : t.slides[state.ce.sel].blocks[Number(sg.closest("[data-j]").dataset.j)];
    if (v) target[k] = v; else delete target[k];
    sg.parentElement.querySelectorAll(".seg__btn").forEach((x) => x.classList.toggle("is-on", x === sg));
    ceDirty(); cePreview(); return;
  }
  if (!b) { if (row) { state.ce.sel = Number(row.dataset.i); ceRender(); } return; }
  const act = b.dataset.act, i = row ? Number(row.dataset.i) : state.ce.sel;
  const s = t.slides[state.ce.sel];
  const j = Number(e.target.closest("[data-j]")?.dataset.j);
  switch (act) {
    case "up": move(t.slides, i, i - 1); state.ce.sel = i - 1; break;
    case "down": move(t.slides, i, i + 1); state.ce.sel = i + 1; break;
    case "edit": state.ce.sel = i; state.ce.tab = "slide"; break;
    case "dup": t.slides.splice(i + 1, 0, { ...structuredClone(t.slides[i]), _k: ++ceSeq }); state.ce.sel = i + 1; break;
    case "del":
      if (t.slides.length <= 1) return toast("장이 하나는 있어야 합니다", true);
      if (!confirm(`${i + 1}장 "${t.slides[i].role || ""}" 을 뺄까요?`)) return;
      t.slides.splice(i, 1); state.ce.sel = Math.min(i, t.slides.length - 1); break;
    case "add": {
      const layout = $("#ceNewLayout").value;
      const blocks = CE_NEW_SLIDE[layout].map((type) => ({ type, ...structuredClone(CE_BLOCKS[type].def) }));
      t.slides.splice(state.ce.sel + 1, 0, { role: "새 장", layout, image: layout === "cover" ? "full" : "none", purpose: "", blocks, ref: null, _k: ++ceSeq });
      state.ce.sel += 1; break;
    }
    case "prev": state.ce.sel -= 1; break;
    case "next": state.ce.sel += 1; break;
    case "bup": move(s.blocks, j, j - 1); break;
    case "bdown": move(s.blocks, j, j + 1); break;
    case "bdel": s.blocks.splice(j, 1); break;
    case "badd": { const type = $("#ceNewBlock").value; (s.blocks ||= []).push({ type, ...structuredClone(CE_BLOCKS[type].def) }); break; }
    case "kitapply": { const k = state.kits.find((x) => x.id === $("#ceKit").value); if (!k) return; t.design = { ...t.design, ...k.design }; toast(`"${k.name}" 키트를 씌웠습니다 — 저장해야 남습니다`); break; }
    case "kitsave": case "kitdel": ceKit(act); return;
    case "dreset": t.design = { ...t.__card.tpl.design }; toast("템플릿 디자인으로 되돌렸습니다"); break;
    case "mimg": case "mvid": { const f = $("#ceMediaFile"); f.accept = act === "mimg" ? "image/*" : "video/*"; f.click(); return; }
    case "mdel": delete s.image_file; delete s.video_file; if (s.layout !== "cover") s.image = "none"; break;
    case "aigo": ceAi(); return;
    case "aiapply": {
      const pr = state.ce.ai.proposal;
      t.design = { ...t.design, ...pr.design };
      t.slides = pr.slides.map(({ from, ...x }, k) => ({ ...x, n: k + 1, _k: k + 1 }));
      if (Array.isArray(pr.flow)) t.flow = pr.flow;
      if (Array.isArray(pr.copy_patterns)) t.copy_patterns = pr.copy_patterns;
      state.ce.ai.proposal = null; state.ce.sel = 0;
      toast("고친 안을 적용했습니다 — 저장해야 남습니다"); break;
    }
    case "aidrop": state.ce.ai.proposal = null; ceRender(); return;
    default: return;
  }
  if (!["edit", "prev", "next"].includes(act)) ceDirty();
  ceRender();
});
// 구조 탭 끌어서 옮기기
let ceDrag = null;
$("#cePanel").addEventListener("dragstart", (e) => { const r = e.target.closest(".ce-row"); if (r) { ceDrag = Number(r.dataset.i); e.dataTransfer.effectAllowed = "move"; } });
$("#cePanel").addEventListener("dragover", (e) => { const r = e.target.closest(".ce-row"); if (r && ceDrag !== null) { e.preventDefault(); document.querySelectorAll(".ce-row.is-over").forEach((x) => x.classList.remove("is-over")); r.classList.add("is-over"); } });
$("#cePanel").addEventListener("drop", (e) => {
  const r = e.target.closest(".ce-row"); if (!r || ceDrag === null) return;
  e.preventDefault();
  const to = Number(r.dataset.i), sl = state.ce.t.slides;
  if (to !== ceDrag) { const [x] = sl.splice(ceDrag, 1); sl.splice(to, 0, x); state.ce.sel = to; ceDirty(); }
  ceDrag = null; ceRender();
});
$("#cePanel").addEventListener("dragend", () => { ceDrag = null; document.querySelectorAll(".ce-row.is-over").forEach((x) => x.classList.remove("is-over")); });
$("#ceStrip").addEventListener("click", (e) => { const b = e.target.closest("[data-sel]"); if (b) { state.ce.sel = Number(b.dataset.sel); ceRender(); } });
$("#ceTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.ce.tab = b.dataset.tab; cePanel(); } });
$("#ceName").addEventListener("input", (e) => { state.ce.t.name = e.target.value; ceDirty(); });

// 만든 카드뉴스 장의 사진·영상 칸
function ceMediaBox(t, s) {
  const url = ceMedia(t, s);
  const kind = s.video_file ? "영상" : s.image_file ? "사진" : "없음";
  return `<div class="ce-media">
    <div class="ce-media__thumb">${!url ? "<span class='muted small'>없음</span>" : s.video_file ? `<video src="${url}" muted autoplay loop playsinline></video>` : `<img src="${url}" alt="">`}</div>
    <div class="stack" style="margin-top:0;gap:var(--s2)">
      <strong class="small">사진·영상 — 지금: ${kind}</strong>
      <div class="row">
        <button class="btn btn--sm" type="button" data-act="mimg">사진 ${s.image_file ? "바꾸기" : "넣기"}</button>
        <button class="btn btn--sm" type="button" data-act="mvid" ${s.layout === "cover" ? "" : "disabled"}>영상 ${s.video_file ? "바꾸기" : "넣기"}</button>
        ${url ? `<button class="btn btn--ghost btn--sm" type="button" data-act="mdel">빼기</button>` : ""}
      </div>
      <p class="muted small" style="margin:0">${s.layout === "cover" ? "영상을 넣으면 저장할 때 글자를 얹은 MP4(최대 60초)로 만듭니다." : "영상은 표지 배치(사진 배경) 장에만 넣을 수 있습니다. 배치를 '표지'로 바꾸면 켜집니다."}</p>
    </div>
    <input type="file" id="ceMediaFile" hidden>
  </div>`;
}
$("#cePanel").addEventListener("change", async (e) => {
  if (e.target.id !== "ceMediaFile" || !e.target.files[0]) return;
  const f = e.target.files[0], { t } = state.ce, s = t.slides[state.ce.sel];
  try {
    toast(`${f.name} 올리는 중…`);
    const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || res.status);
    const r = await api(`/api/templates/${t.id}/cards/${t.__card.cid}/media`, { method: "POST", body: { token: d.token } });
    if (r.kind === "video") { s.video_file = r.file; delete s.image_file; s.image = "full"; }
    else { s.image_file = r.file; delete s.video_file; if (!s.image || s.image === "none") s.image = s.layout === "cover" ? "full" : "inset"; }
    ceDirty(); ceRender();
  } catch (err) { toast(err.message, true); }
});
async function ceSaveCard() {
  const { t } = state.ce, { cid, tpl } = t.__card;
  const slides = t.slides.map(({ _k, ref, ...s }, i) => ({ ...s, n: i + 1 }));
  // 템플릿 디자인과 다른 값만 이 카드뉴스의 design 으로 남긴다
  const design = Object.fromEntries(Object.entries(t.design).filter(([k, v]) => tpl.design?.[k] !== v));
  const saved = await api(`/api/templates/${t.id}/cards/${cid}`, { method: "PUT", body: { title: t.name, caption: t.caption, slides, design } });
  ceDirty(false);
  toast("저장했습니다 — 그림을 다시 만듭니다");
  exportPngs(tpl, saved);
  return saved;
}
async function ceSave() {
  const { t } = state.ce;
  if (t.__card) return ceSaveCard();
  // 장 번호를 새로 매기고, 흐름의 장 번호도 옮긴 자리로 바꾼다 (뺀 장은 흐름에서 빠진다)
  const map = new Map(t.slides.map((s, i) => [s._k, i + 1]));
  const slides = t.slides.map(({ _k, ...s }, i) => ({ ...s, n: i + 1 }));
  const flow = (t.flow || []).map((f) => ({ ...f, slides: (f.slides || []).map((n) => map.get(n)).filter(Boolean).sort((a, b) => a - b) })).filter((f) => f.slides.length);
  const saved = await api(`/api/templates/${t.id}`, { method: "PUT", body: { name: t.name, design: t.design, slides, flow, copy_patterns: t.copy_patterns || [] } });
  // 다음 저장을 위해 _k 를 새 번호로 맞춘다
  t.slides.forEach((s, i) => (s._k = i + 1)); t.flow = flow;
  ceDirty(false);
  toast("템플릿을 저장했습니다");
  loadTemplates();
  if ($("#cnDialog").open && state.cnTpl?.id === saved.id) openCardTemplate(saved);
  return saved;
}
async function ceKit(act) {
  const { t } = state.ce;
  try {
    if (act === "kitsave") {
      const cur = state.kits?.find((x) => x.id === $("#ceKit")?.value);
      const name = prompt("키트 이름 (같은 이름이면 덮어씁니다)", cur?.name || t.design.label || "내 브랜드");
      if (!name) return;
      await api("/api/kits", { method: "POST", body: { name, design: t.design } });
      toast(`"${name.trim()}" 키트를 저장했습니다`);
    } else {
      const k = state.kits.find((x) => x.id === $("#ceKit").value);
      if (!k || !confirm(`"${k.name}" 키트를 지울까요? 이미 씌운 템플릿은 그대로입니다.`)) return;
      await api(`/api/kits/${k.id}`, { method: "DELETE" });
    }
    state.kits = await api("/api/kits"); cePanel();
  } catch (err) { toast(err.message, true); }
}
// 편집 중인 상태를 보내고 고친 안을 받는다. from(원래 장 번호)으로 원본 사진을 이어 붙인다
async function ceAi() {
  const ce = state.ce, text = ce.ai.text.trim();
  if (!text) return toast("무엇을 고칠지 적으세요", true);
  ce.ai.busy = true; cePanel();
  try {
    const pr = await api(`/api/templates/${ce.t.id}/ai-edit`, { method: "POST", body: { instruction: text, template: { name: ce.t.name, design: ce.t.design, slides: ce.t.slides, flow: ce.t.flow, copy_patterns: ce.t.copy_patterns } }, busy: "Claude 가 템플릿 고친 안을 만드는 중" });
    pr.slides = pr.slides.map((x) => { const o = ce.t.slides[Number(x.from) - 1]; return { ...x, ref: x.from && o ? o.ref ?? null : null }; });
    if (state.ce === ce) ce.ai.proposal = pr;
  } catch (err) { toast(err.message, true); }
  finally { ce.ai.busy = false; if (state.ce === ce && ce.tab === "ai") cePanel(); }
}
$("#ceSave").addEventListener("click", () => ceSave().catch((err) => toast(err.message, true)));
$("#ceClose").addEventListener("click", () => {
  if (state.ce.dirty && !confirm("저장하지 않은 수정이 있습니다. 버리고 닫을까요?")) return;
  $("#ceDialog").close();
});
$("#ceDialog").addEventListener("cancel", (e) => { if (state.ce.dirty && !confirm("저장하지 않은 수정이 있습니다. 버리고 닫을까요?")) e.preventDefault(); });
$("#cnEdit").addEventListener("click", () => openCardEditor(state.cnTpl));
$("#cnDup").addEventListener("click", async () => {
  try {
    const t = await api(`/api/templates/${state.cnTpl.id}/duplicate`, { method: "POST" });
    toast(`"${t.name}" 을 만들었습니다 — 원본은 그대로입니다`);
    loadTemplates();
    await openCardTemplate(t);
    openCardEditor(t);
  } catch (err) { toast(err.message, true); }
});

// ── 템플릿 ────────────────────────────────────────────
const SECTIONS = ["훅", "문제·상황", "제품 소개", "증명·기능", "혜택", "CTA", "브랜딩"];
const tplUrl = (id, f) => `/data/_templates/${id}/${f}`;

// 템플릿 관리(공용)에서 보는 종류 — 영상(영상 만들기·인물 라디오) · 카드뉴스(카드뉴스·포스터) · 드라마
const TPL_KINDS = [["", "전체"], ["video", "영상"], ["cardnews", "카드뉴스·포스터"], ["drama", "드라마"], ["my", "내 템플릿"]];
const tplKindOf = (t) => (t.kind === "cardnews" ? "cardnews" : t.kind === "drama" ? "drama" : "video");
state.tplKind = "";
async function loadTemplates() {
  state.templates = await api("/api/templates");
  // 영상 모드는 영상 템플릿만, 카드뉴스 모드는 카드뉴스 템플릿만 · 템플릿 관리(공용)는 전부 (종류로 거른다)
  const all = state.mode === "tpl", card = state.mode === "card", drama = state.mode === "drama";
  $("#tplKinds").hidden = !all;
  if (all) {
    $("#tplKinds").innerHTML = TPL_KINDS.map(([k, n]) => `<button class="seg__btn ${state.tplKind === k ? "is-on" : ""}" type="button" data-tplkind="${k}">${n} <span class="muted">${state.templates.filter((t) => !k || (k === "my" ? t.my : tplKindOf(t) === k)).length}</span></button>`).join("");
    const list = state.templates.filter((t) => !state.tplKind || (state.tplKind === "my" ? t.my : tplKindOf(t) === state.tplKind));
    $("#tplCount").textContent = state.templates.length ? `${state.templates.length}개` : "";
    $("#tplTitle").textContent = "템플릿 관리";
    $("#tplDesc").innerHTML = "광고 수집(공용)에서 분석한 광고의 상세 화면에서 <b>템플릿으로 저장</b>한 것이 모두 여기 모입니다. 열어서 고치고·복제하고·지웁니다. 영상 템플릿은 영상 만들기·인물 라디오에서, 카드뉴스 템플릿은 카드뉴스·포스터 만들기에서 씁니다.";
    $("#tplGrid").dataset.empty = "아직 템플릿이 없습니다. 광고 수집(공용)에서 광고를 분석한 뒤 상세 화면에서 템플릿으로 저장하세요.";
    return renderTplCards(list, true);
  }
  const list = state.templates.filter((t) => (card ? t.kind === "cardnews" : drama ? t.kind === "drama" : !t.kind || t.kind === "video"));
  $("#tplCount").textContent = list.length ? `${list.length}개` : "";
  $("#tplTitle").textContent = card ? "카드뉴스 템플릿" : drama ? "드라마 템플릿" : "영상 템플릿";
  $("#tplDesc").innerHTML = drama ? "릴스·광고 상세 화면에서 <b>드라마 템플릿으로 저장</b>을 누르면 Claude 가 인물·비트·반복 개그·반전·제품이 들어오는 방식을 뽑아 여기에 쌓습니다." : card
    ? "광고 수집(공용)에서 분석한 이미지 광고·캐러셀의 상세 화면에서 <b>카드뉴스 템플릿으로 저장</b>을 누르면 여기에 쌓입니다. 열어서 편집·복제하고 주제를 넣어 카드뉴스를 만듭니다."
    : "광고·링크 분석의 상세 화면에서 <b>템플릿으로 저장</b>을 누르면 Claude가 컷마다 역할·구도·자막 형식을 붙여 여기에 쌓습니다.";
  $("#tplGrid").dataset.empty = drama ? "아직 드라마 템플릿이 없습니다. 상황극형 릴스를 수집·분석한 뒤 상세 화면에서 '드라마 템플릿으로 저장'을 누르세요." : card ? "아직 카드뉴스 템플릿이 없습니다. 광고 수집(공용) → 링크·업로드에서 인스타 캐러셀 링크를 분석한 뒤 상세 화면에서 '카드뉴스 템플릿으로 저장'을 누르세요." : "아직 영상 템플릿이 없습니다. 분석한 영상의 상세 화면에서 '템플릿으로 저장'을 누르세요.";
  renderTplCards(list);
}
// 템플릿 카드 — manage 면 쓰는 곳·분석 상태·지우기까지
function renderTplCards(list, manage) {
  const uses = (t) => t.kind === "cardnews" ? ["카드뉴스", "포스터"] : t.kind === "drama" ? ["드라마 릴스"] : ["영상 만들기", "인물 라디오"];
  $("#tplGrid").innerHTML = list.map((t) => `
    <div class="card tpl-card" data-id="${t.id}" role="button" tabindex="0">
      <div class="card__thumb">${t.kind === "cardnews" ? cnTplThumb(t) : `<img src="${tplUrl(t.id, "cover.jpg")}" alt="" loading="lazy" onerror="this.remove()">`}
        <span class="badge">${t.my ? "내 템플릿" : t.kind === "cardnews" ? (cnEdited(t) ? "카드뉴스 · 편집함" : "카드뉴스") : t.kind === "drama" ? `상황극형${t.genre ? " · " + esc(t.genre) : ""}` : "광고형"}</span>
        <span class="card__dur">${t.kind === "drama" ? `${t.format?.duration_s ?? "?"}초 · 비트 ${t.beats?.length ?? 0}` : t.kind === "cardnews" ? `${t.slides?.length ?? 0}장 · ${esc(t.format?.aspect || "")}` : `${t.format?.duration_s ?? "?"}초 · ${t.slots?.length ?? 0}컷`}</span></div>
      <div class="card__body">
        <div class="card__meta">${esc(t.hook_type || "")}${t.tone ? " · " + esc(t.tone) : ""} · 출처 ${esc(t.source?.brand || "")}</div>
        <strong>${esc(t.name || t.id)}</strong>
        <div class="card__text">${esc(t.summary || "")}</div>
        ${manage ? `<div class="card__tags">${uses(t).map((u) => `<span>${u}</span>`).join("")}${t.poster_layout ? "<span>포스터 소재 분석됨</span>" : ""}${t.created_at ? `<span>${new Date(t.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</span>` : ""}</div>
          <div class="ex__row" style="margin-top:6px"><button class="btn btn--ghost btn--sm" type="button" data-tplopen>열기</button><button class="btn btn--ghost btn--sm" type="button" data-tpldel>지우기</button></div>` : ""}
      </div>
    </div>`).join("");
}
$("#tplKinds").addEventListener("click", (e) => { const b = e.target.closest("[data-tplkind]"); if (!b) return; state.tplKind = b.dataset.tplkind; loadTemplates(); });
$("#tplGrid").addEventListener("click", async (e) => {
  const c = e.target.closest(".card"); if (!c) return;
  if (e.target.closest("[data-tpldel]")) {
    const t = state.templates.find((x) => x.id === c.dataset.id);
    if (!confirm(`템플릿 "${t?.name || c.dataset.id}" 을 지울까요? 이 템플릿으로 만든 결과물(영상·카드뉴스·포스터·인물 라디오)은 남지만 다시 불러올 수 없습니다.`)) return;
    try { await api(`/api/templates/${c.dataset.id}`, { method: "DELETE" }); toast("템플릿을 지웠습니다"); loadTemplates(); } catch (err) { toast(err.message, true); }
    return;
  }
  const t = state.templates.find((x) => x.id === c.dataset.id);
  t.kind === "cardnews" ? openCardTemplate(t) : t.kind === "drama" ? openDramaTemplate(t) : openTemplate(t);
});

function openTemplate(t) {
  $("#tplDialog .detail__info").prepend($("#tCast")); // 영상 만들기 화면에 가 있던 소재 칸을 창으로 되돌린다
  state.tpl = structuredClone(t);
  $("#tName").value = t.name || "";
  const media = t.media || {};
  $("#tVideo").src = media.video ? tplUrl(t.id, media.video) : "";
  $("#tVideo").hidden = !media.video;
  if (media.cover !== null) $("#tCover").src = tplUrl(t.id, media.cover || "cover.jpg");
  $("#tCoverWrap").hidden = media.cover === null;
  $("#tSheet").src = tplUrl(t.id, "contact_sheet.jpg");
  $("#tSummary").value = t.summary || "";
  $("#tHook").value = t.hook_type || "";
  $("#tTone").value = t.tone || "";
  $("#tCopy").value = (t.copy_patterns || []).join("\n");
  $("#tMusic").value = [t.music?.mood, t.music?.tempo].filter(Boolean).join(" / ");
  $("#tNotes").value = t.notes || "";
  const f = t.format || {};
  $("#tMeta").innerHTML = [
    ["형식", `${f.width}×${f.height} (${f.aspect}) · ${f.duration_s}초 · ${f.shot_count}컷`],
    ["출처", `${esc(t.source?.brand)} / ${esc(t.source?.ad_dir)}`],
    ["만든 날", new Date(t.created_at).toLocaleString("ko-KR")],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const total = f.duration_s || 1;
  $("#tSections").innerHTML = (t.structure || []).map((x) =>
    `<div style="flex:${Math.max(0.3, (x.end - x.start) / total)}" title="${esc(x.section)} ${x.start}–${x.end}초 · ${esc(x.purpose)}">${esc(x.section)}</div>`).join("");
  // 여러 줄 값은 <br> 로 그려야 innerText 로 줄바꿈이 돌아온다
  const ed = (v, k) => `<div contenteditable="true" data-k="${k}">${String(v || "").split("\n").map(esc).join("<br>")}</div>`;
  $("#tSlots").innerHTML = `<thead><tr><th>#</th><th>프레임</th><th>시간</th><th>구간</th><th>역할</th><th>샷·주인공</th><th>구도</th><th>자막 형식 · 위치</th><th>오디오</th><th>필요한 리소스</th><th>원래 문구</th></tr></thead><tbody>
    ${(t.slots || []).map((sl, i) => `<tr data-i="${i}">
      <td>${sl.shot}</td>
      <td>${sl.frame ? `<img src="${tplUrl(t.id, "frames/" + sl.frame)}" alt="컷 ${sl.shot}" loading="lazy" data-seek="${sl.start}" title="이 장면 재생">` : ""}</td>
      <td>${fmtTime(sl.start)}<br><span class="muted">${sl.dur}s</span></td>
      <td><select data-k="section">${[...new Set([...SECTIONS, sl.section].filter(Boolean))].map((x) => `<option ${x === sl.section ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></td>
      <td>${ed(sl.role, "role")}</td>
      <td>${ed([sl.shot_type, sl.subject].filter(Boolean).join(" · "), "shot_subject")}</td>
      <td>${ed(sl.composition, "composition")}</td>
      <td>${ed([sl.text_overlay?.pattern, sl.text_overlay?.position].filter(Boolean).join(" · "), "text")}</td>
      <td>${ed([sl.audio?.type, sl.audio?.pattern].filter(Boolean).join(" · "), "audio")}</td>
      <td>${ed((sl.resource_needs || []).map((r) => `${r.kind}: ${r.desc}`).join("\n"), "needs")}</td>
      <td class="muted small">${esc([sl.example?.onscreen_text, sl.example?.speech].filter(Boolean).join(" / "))}</td>
    </tr>`).join("")}</tbody>`;
  renderCast();
  if (!$("#tplDialog").open) $("#tplDialog").showModal();
}

// ── 내 템플릿: 소재 시트 (인물·배경·제품… 마다 내 이미지·설정 등록) ──
async function renderCast() {
  const t = state.tpl;
  $("#tMy").textContent = t.my ? "소재 시트 만들기" : "내 템플릿으로 만들기";
  $("#tMy").hidden = !!(t.my && t.cast?.length);
  $("#tCast").hidden = !t.cast?.length;
  if (!t.cast?.length) return;
  state.resAll ||= await api("/api/resources").catch(() => []);
  const resOpts = (cur) => `<option value="">리소스에서 고르기</option>` + (state.resAll || []).filter((r) => r.files?.some((f) => f.kind === "image"))
    .map((r) => `<option value="${r.kind}:${r.id}" ${cur && cur.kind === r.kind && cur.id === r.id ? "selected" : ""}>${esc(KIND_LABEL[r.kind] || r.kind)} · ${esc(r.name)}</option>`).join("");
  $("#tCastGrid").innerHTML = t.cast.map((c) => {
    const m = c.mine || {};
    return `<div class="cast__item ${m.image || m.resource ? "is-set" : ""}" data-cid="${c.id}">
      <div class="cast__orig">${c.frame ? `<img src="${tplUrl(t.id, "frames/" + c.frame)}" alt="" loading="lazy">` : ""}<span class="tag">${esc(c.kind)}</span></div>
      <div class="cast__body">
        <div><strong>${esc(c.name)}</strong> <span class="muted small">컷 ${(c.shots || []).join("·")}</span></div>
        <p class="muted small" style="margin:0">원본: ${esc(c.original || "")}</p>
        ${(c.fields || []).map((f) => `<label class="field"><span>${esc(f.key)}</span><input data-field="${esc(f.key)}" value="${esc(m.fields?.[f.key] || "")}" placeholder="원본: ${esc(f.original || "")}"></label>`).join("")}
        <label class="field"><span>내 설정 (선택)</span><textarea rows="2" data-desc placeholder="예: 30대 남성 영업사원, 네이비 정장">${esc(m.desc || "")}</textarea></label>
        <label class="check" style="min-height:0"><input type="checkbox" data-keep ${m.keep ? "checked" : ""}> 원본 그대로 두기</label>
      </div>
      <div class="cast__mine">
        <div class="cast__img">${m.image ? `<img src="${tplUrl(t.id, m.image)}?v=${Date.now()}" alt="내 이미지">` : castResThumb(m.resource) || `<span class="muted small">여기로 끌어다 놓거나<br>아래에서 등록</span>`}</div>
        <label class="vslot__up"><input type="file" accept="image/*" data-cast-file><span>${m.image ? "이미지 바꾸기" : "이미지 등록"}</span></label>
        ${m.image ? `<button class="btn btn--ghost btn--sm" type="button" data-cast-del>이미지 빼기</button>` : ""}
        <select data-cast-res aria-label="리소스에서 고르기">${resOpts(m.resource)}</select>
        ${c.register ? `<p class="muted small" style="margin:0">추천: ${esc(c.register)}</p>` : ""}
      </div>
    </div>`;
  }).join("");
  renderMyPrompts();
}
// 리소스에서 고른 경우 그 리소스의 첫 이미지를 보여 준다
const castResThumb = (rf) => {
  const r = rf && (state.resAll || []).find((x) => x.kind === rf.kind && x.id === rf.id);
  const img = r?.files?.find((f) => f.kind === "image");
  return img ? `<img src="${resUrl(r, img.file)}" alt="리소스 이미지"><span class="cast__badge">리소스</span>` : "";
};
const KIND_LABEL = { product: "제품", person: "인물", voice: "목소리", background: "배경", topic: "주제" };
function renderMyPrompts() {
  const t = state.tpl, mp = t.my_prompts;
  if (!mp) { $("#tMyOut").innerHTML = ""; return; }
  $("#tMyOut").innerHTML = `<div class="short">
    <div class="short__head"><div><strong>내 소재 장면 프롬프트</strong> <span class="muted small">${new Date(mp.created_at).toLocaleString("ko-KR")} · ${mp.took_s}초${mp.topic ? ` · 주제: ${esc(mp.topic)}` : ""}</span></div></div>
    ${mp.refs?.length ? `<div class="refs"><span class="small muted">첨부 순서</span>${mp.refs.map((r) => `<a class="ref" href="${tplUrl(t.id, r.file)}" target="_blank"><img src="${tplUrl(t.id, r.file)}" alt=""><span>${r.n}. ${esc(r.name)}</span></a>`).join("")}</div>` : `<p class="muted small">등록한 이미지가 없어 설정 글로만 썼습니다.</p>`}
    ${mp.style ? `<p class="small">${esc(mp.style)}</p>` : ""}
    ${mp.method === "frame_edit" ? `<p class="small" style="margin:0">컷마다 <b>① 원본 프레임을 편집해 시작 프레임</b>을 만들고 <b>② 그 시작 프레임을 움직여 영상</b>을 만듭니다 — 원본의 조명·색감·구도가 그대로 남습니다.</p>` : `<p class="small" style="margin:0;color:var(--role-red)">예전 방식(장면을 새로 그림)으로 만든 프롬프트입니다. 원본 분위기를 지키려면 [내 소재로 장면 프롬프트 만들기]를 다시 누르세요.</p>`}
    ${(mp.scenes || []).map((x) => {
      const mm = t.my_media?.[x.shot] || {};
      const slot = t.slots?.find((s) => s.shot === x.shot);
      const tgt = (field) => ({ type: "template", id: t.id, shot: x.shot, field });
      return `<div class="scene my-shot" style="grid-template-columns:1fr">
      <div class="scene__time"><b>컷 ${x.shot}</b> ${fmtTime(x.start)} · ${x.dur}s${x.assets?.length ? ` · 바꿀 소재 ${x.assets.join(", ")}` : ""}</div>
      ${x.frame_edit_en ? `<div class="my-strip">
        <figure>${slot?.frame ? `<img src="${tplUrl(t.id, "frames/" + slot.frame)}" alt="">` : ""}<figcaption>원본 프레임</figcaption></figure>
        <span aria-hidden="true">→</span>
        <figure>${mm.frame ? `<a href="${tplUrl(t.id, mm.frame)}" target="_blank"><img src="${tplUrl(t.id, mm.frame)}" alt=""></a>` : `<span class="muted small">시작 프레임</span>`}<figcaption>① 시작 프레임</figcaption></figure>
        <span aria-hidden="true">→</span>
        <figure>${mm.video ? `<video src="${tplUrl(t.id, mm.video)}" controls muted playsinline preload="metadata"></video>` : `<span class="muted small">영상</span>`}<figcaption>② 영상</figcaption></figure>
      </div>
      ${promptBox(`① 시작 프레임 — 원본 프레임 편집 (첨부 순서: ${(x.edit_files || []).map((f, i) => `${i + 1}.${i ? f.split("/").pop() : "원본 프레임"}`).join(", ")})`, x.frame_edit_en)}
      <div class="row" style="flex-wrap:wrap">${hfBtn("시작 프레임 만들기", { target: tgt("frame"), kind: "image", purpose: "edit", prompt: x.frame_edit_en, refs: x.edit_files || [], aspect: t.format?.aspect || "9:16" }, true)}
        <label class="vslot__up"><input type="file" accept="image/*" data-my-media="${x.shot}:frame"><span>시작 프레임 직접 올리기</span></label></div>
      ${promptBox("② 영상 — 움직임만 (시작 프레임을 넣고 돌린다)", x.motion_en)}
      <div class="row" style="flex-wrap:wrap">${mm.frame ? hfBtn("영상 만들기", { target: tgt("video"), kind: "video", purpose: "video", prompt: x.motion_en, refs: [mm.frame], aspect: t.format?.aspect || "9:16", duration: Math.ceil(+x.dur || 4) }) : `<span class="muted small">시작 프레임이 생기면 영상 만들기가 켜집니다</span>`}
        <label class="vslot__up"><input type="file" accept="video/*" data-my-media="${x.shot}:video"><span>영상 직접 올리기</span></label></div>`
      : `${promptBox("영상 프롬프트", x.video_prompt_en)}${promptBox("첫 프레임 이미지", x.start_frame_prompt_en)}`}
        <dl>${x.prompt_ko || x.video_prompt_ko ? `<dt>요약</dt><dd>${esc(x.prompt_ko || x.video_prompt_ko)}</dd>` : ""}${x.onscreen_text ? `<dt>화면 글자</dt><dd>${esc(x.onscreen_text)}</dd>` : ""}${x.voiceover ? `<dt>대사·내레이션</dt><dd>${esc(x.voiceover)}</dd>` : ""}</dl>
    </div>`;
    }).join("")}
    ${mp.notes ? `<p class="muted small">${esc(mp.notes)}</p>` : ""}
  </div>`;
}
// 글자 칸은 잠깐 멈추면 저장한다
let castTimer = null;
const castSave = () => { clearTimeout(castTimer); castTimer = setTimeout(() => api(`/api/templates/${state.tpl.id}`, { method: "PUT", body: { cast: state.tpl.cast } }).catch((err) => toast(err.message, true)), 500); };
const castOf = (el) => state.tpl.cast.find((c) => c.id === el.closest("[data-cid]").dataset.cid);
$("#tCastGrid").addEventListener("input", (e) => {
  if (!e.target.closest("[data-cid]") || e.target.matches("[data-cast-file]")) return;
  const c = castOf(e.target); c.mine ||= {};
  if (e.target.dataset.field) (c.mine.fields ||= {})[e.target.dataset.field] = e.target.value;
  else if (e.target.matches("[data-desc]")) c.mine.desc = e.target.value;
  else if (e.target.matches("[data-keep]")) c.mine.keep = e.target.checked;
  else return;
  castSave();
});
$("#tCastGrid").addEventListener("change", async (e) => {
  const el = e.target; if (!el.closest("[data-cid]")) return;
  const c = castOf(el); c.mine ||= {};
  try {
    if (el.matches("[data-cast-res]")) {
      const [kind, id] = el.value.split(":");
      if (el.value) c.mine.resource = { kind, id }; else delete c.mine.resource;
      await api(`/api/templates/${state.tpl.id}`, { method: "PUT", body: { cast: state.tpl.cast } });
      renderCast();
    } else if (el.matches("[data-cast-file]") && el.files[0]) {
      el.nextElementSibling.textContent = "올리는 중…";
      await castUpload(c, el.files[0]);
    }
  } catch (err) { toast(err.message, true); renderCast(); }
});
// 소재 칸에 이미지 올리기 — jpg·png·webp·gif 가 아니면(HEIC·AVIF·BMP 등) 브라우저가 읽을 수 있는 한 PNG 로 바꿔 올린다
async function castUpload(c, file) {
  const f = await toWebImage(file);
  const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || res.status);
  clearTimeout(castTimer);
  await api(`/api/templates/${state.tpl.id}`, { method: "PUT", body: { cast: state.tpl.cast } });
  const saved = await api(`/api/templates/${state.tpl.id}/cast/${c.id}/image`, { method: "POST", body: { token: d.token }, busy: "소재 이미지 등록 중" });
  state.tpl.cast = saved.cast; renderCast();
  toast(`${c.name} — 이미지를 등록했습니다`);
}
async function toWebImage(file) {
  if (/\.(jpe?g|png|webp|gif)$/i.test(file.name)) return file;
  if (!file.type.startsWith("image/") && !/\.(heic|heif|avif|bmp|tiff?)$/i.test(file.name)) throw new Error(`이미지 파일이 아닙니다: ${file.name}`);
  try {
    const bmp = await createImageBitmap(file);
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
  } catch { throw new Error(`이 브라우저가 읽을 수 없는 형식입니다 (${file.name}) — JPG·PNG 로 바꿔 올려 주세요`); }
}
// 끌어다 놓기로도 등록
$("#tCastGrid").addEventListener("dragover", (e) => { const it = e.target.closest(".cast__item"); if (!it) return; e.preventDefault(); it.classList.add("is-over"); });
$("#tCastGrid").addEventListener("dragleave", (e) => { e.target.closest(".cast__item")?.classList.remove("is-over"); });
$("#tCastGrid").addEventListener("drop", async (e) => {
  const it = e.target.closest(".cast__item"); if (!it) return;
  e.preventDefault(); it.classList.remove("is-over");
  const f = [...(e.dataTransfer?.files || [])][0];
  if (!f) return toast("파일을 끌어 오세요 (웹페이지 이미지는 먼저 저장한 뒤)", true);
  try { await castUpload(castOf(it), f); } catch (err) { toast(err.message, true); renderCast(); }
});
$("#tCastGrid").addEventListener("click", async (e) => {
  if (!e.target.closest("[data-cast-del]")) return;
  const c = castOf(e.target);
  clearTimeout(castTimer);
  await api(`/api/templates/${state.tpl.id}`, { method: "PUT", body: { cast: state.tpl.cast } });
  const saved = await api(`/api/templates/${state.tpl.id}/cast/${c.id}/image`, { method: "POST", body: { token: null } });
  state.tpl.cast = saved.cast; renderCast();
});
$("#tMyOut").addEventListener("change", async (e) => {
  const el = e.target.closest("[data-my-media]"); if (!el?.files[0]) return;
  const [shot, field] = el.dataset.myMedia.split(":");
  try {
    const f = field === "frame" ? await toWebImage(el.files[0]) : el.files[0];
    const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || res.status);
    const t = await api(`/api/templates/${state.tpl.id}/my-media`, { method: "POST", body: { shot: Number(shot), field, token: d.token }, busy: "올리는 중" });
    state.tpl.my_media = t.my_media; renderMyPrompts();
  } catch (err) { toast(err.message, true); }
});
$("#tMy").addEventListener("click", async () => {
  const t = state.tpl;
  try {
    const r = await api(`/api/templates/${t.id}/cast`, { method: "POST", body: { copy: !t.my } });
    state.castPending = r.id; openLog();
    toast(t.my ? "소재 시트 만드는 중 (1~2분)" : "내 템플릿으로 복제했습니다 — 소재 시트 만드는 중 (1~2분), 끝나면 이 창에 열립니다");
    loadTemplates();
  } catch (err) { toast(err.message, true); }
});
$("#tCastRe").addEventListener("click", async () => {
  if (!confirm("소재를 다시 뽑을까요? 같은 소재에 등록한 내 이미지·설정은 남깁니다.")) return;
  try { const r = await api(`/api/templates/${state.tpl.id}/cast`, { method: "POST", body: { copy: false } }); state.castPending = r.id; toast("소재 다시 뽑는 중 (1~2분)"); }
  catch (err) { toast(err.message, true); }
});
$("#tMyPrompts").addEventListener("click", async () => {
  try {
    clearTimeout(castTimer);
    await api(`/api/templates/${state.tpl.id}`, { method: "PUT", body: { cast: state.tpl.cast } });
    await api(`/api/templates/${state.tpl.id}/my-prompts`, { method: "POST", body: { topic: $("#tMyTopic").value } });
    state.castPending = state.tpl.id;
    $("#tMyPrompts").disabled = true;
    toast("내 소재로 장면 프롬프트 쓰는 중 (1~3분) — 끝나면 아래에 나타납니다");
  } catch (err) { toast(err.message, true); }
});

// 편집한 칸을 템플릿 구조로 되돌린다 ("A · B" 칸은 앞뒤로 나눠 담는다)
function collectTemplate() {
  const t = state.tpl;
  const split = (v) => { const [a, ...b] = v.split(" · "); return [a?.trim() || "", b.join(" · ").trim()]; };
  document.querySelectorAll("#tSlots tbody tr").forEach((tr) => {
    const sl = t.slots[Number(tr.dataset.i)];
    const get = (k) => tr.querySelector(`[data-k="${k}"]`);
    sl.section = get("section").value;
    sl.role = get("role").innerText.trim();
    [sl.shot_type, sl.subject] = split(get("shot_subject").innerText);
    sl.composition = get("composition").innerText.trim();
    const [tp, pos] = split(get("text").innerText);
    sl.text_overlay = { ...(sl.text_overlay || {}), pattern: tp, position: pos };
    const [at, ap] = split(get("audio").innerText);
    sl.audio = { type: at, pattern: ap };
    sl.resource_needs = get("needs").innerText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [kind, ...rest] = l.split(":"); return rest.length ? { kind: kind.trim(), desc: rest.join(":").trim() } : { kind: "", desc: l };
    });
  });
  const [mood, tempo] = $("#tMusic").value.split("/").map((x) => x.trim());
  return {
    name: $("#tName").value.trim(), summary: $("#tSummary").value.trim(),
    hook_type: $("#tHook").value.trim(), tone: $("#tTone").value.trim(),
    copy_patterns: $("#tCopy").value.split("\n").map((x) => x.trim()).filter(Boolean),
    music: { mood: mood || "", tempo: tempo || "" }, notes: $("#tNotes").value.trim(),
    slots: t.slots,
  };
}
$("#tSave").addEventListener("click", async () => {
  try { await api(`/api/templates/${state.tpl.id}`, { method: "PUT", body: collectTemplate() }); toast("저장했습니다"); loadTemplates(); }
  catch (err) { toast(err.message, true); }
});
$("#tDelete").addEventListener("click", async () => {
  if (!confirm(`템플릿 "${state.tpl.name}" 을 지울까요?`)) return;
  await api(`/api/templates/${state.tpl.id}`, { method: "DELETE" });
  $("#tplDialog").close(); loadTemplates();
});
$("#tClose").addEventListener("click", () => $("#tplDialog").close());
$("#tplDialog").addEventListener("close", () => $("#tVideo").pause());
$("#tSlots").addEventListener("click", (e) => {
  const img = e.target.closest("[data-seek]"); if (!img) return;
  const v = $("#tVideo");
  v.currentTime = Number(img.dataset.seek) + 0.05; v.play();
  v.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

// ── 리소스 — 화면은 public/resources.js (window.resPage). 여기서는 탭 옆 개수와 목소리 만들기 칸만 잇는다 ──
state.resKind = "person";
async function loadResources() {
  const list = await (window.resPage ? window.resPage.load() : api("/api/resources"));
  $("#resCount").textContent = list.length ? `${list.length}개` : "";
  return list;
}
window.addEventListener("res-kind", (e) => { state.resKind = e.detail; vcLoad(); });
const resUrl = (r, f) => `/data/_resources/${r.kind}/${r.id}/${f}`;

// ── 목소리 만들기 (리소스 → 목소리) — 이 PC 의 Qwen3-TTS 로 만든다 ──
// 기본 목소리(9개 + 말투) 또는 녹음 복제 → 문장 만들어 듣기 → 리소스로 저장
const vc = { mode: "preset", speaker: "Sohee", profile: "", last: null, st: null };
async function vcLoad() {
  $("#vcPanel").hidden = state.resKind !== "voice";
  if ($("#vcPanel").hidden) return;
  $("#vcStatus").textContent = "엔진 확인 중…";
  const st = vc.st = await api("/api/voice/status").catch((e) => ({ up: false, error: e.message, speakers: [], styles: [], profiles: [] }));
  const mm = st.models || {};
  $("#vcStatus").className = `vc__status small ${st.up && st.ready ? "is-ok" : "muted"}`;
  $("#vcStatus").textContent = !st.up ? "목소리 엔진 꺼짐" : `${st.engine} · 이 PC 에서 무료${st.ready ? " · 준비됨" : " · 모델 없음"}`;
  $("#vcBody").hidden = !(st.up && st.ready);
  const miss = ["custom", "base"].filter((k) => mm[k] && !mm[k].downloaded);
  $("#vcSetup").innerHTML = !st.up ? `<div class="vc__setup small"><p style="margin:0">목소리 엔진(Qwen3-TTS)을 켜지 못했습니다.</p><ul><li>${esc(st.error || "")}</li></ul>
      <div class="row"><button class="btn btn--sm" type="button" data-vcrefresh>다시 확인</button></div></div>`
    : miss.length ? `<div class="vc__setup small"><p style="margin:0">목소리 모델이 아직 없습니다: ${miss.map((k) => `<b>${esc(mm[k].repo)}</b>`).join(", ")}</p>
      <ul><li>모델마다 약 2GB 를 한 번 내려받습니다 (이후 인터넷 없이 작동).</li><li>라이선스 Apache-2.0 — 상업용 사용 가능.</li></ul>
      <div class="row"><button class="btn btn--primary btn--sm" type="button" data-vcdl>모델 받기 (약 ${miss.length * 2}GB)</button></div></div>` : "";
  if (!vc.profile && st.profiles?.[0]) vc.profile = st.profiles[0].id;
  vcRender();
}
function vcRender() {
  const st = vc.st || {};
  $("#vcPreset").hidden = vc.mode !== "preset"; $("#vcCloneBox").hidden = vc.mode !== "clone";
  document.querySelectorAll("[data-vcmode]").forEach((b) => b.classList.toggle("is-on", b.dataset.vcmode === vc.mode));
  $("#vcSpeakers").innerHTML = (st.speakers || []).map((p) => `<button type="button" class="vc__chip ${vc.speaker === p.id ? "is-picked" : ""}" data-vcspk="${p.id}">
    <strong>${esc(p.name)} <em>${esc(p.native)}</em></strong><span>${esc(p.desc)}</span></button>`).join("");
  $("#vcStyles").innerHTML = (st.styles || []).map((x) => `<button type="button" class="chip" data-vcstyle="${esc(x)}">${esc(x)}</button>`).join("");
  const ps = st.profiles || [];
  $("#vcProfiles").innerHTML = ps.map((p) => `<div role="button" tabindex="0" class="vc__chip ${vc.profile === p.id ? "is-picked" : ""}" data-vcprof="${p.id}">
    <div class="vc__chip-row"><strong>${esc(p.name)}</strong><button type="button" class="vc__chip-del" data-vcpdel="${p.id}" aria-label="${esc(p.name)} 지우기">지우기</button></div>
    <span>녹음 ${p.duration}초${p.cut ? ` (원본 ${p.cut.from}초에서 자름)` : ""}${p.ref_text ? "" : " · 받아 적은 말 없음"}</span></div>`).join("") || `<p class="muted small" style="margin:0">아직 복제한 목소리가 없습니다. 아래에서 녹음으로 만드세요.</p>`;
  if (!ps.length) $("#vcNew").open = true;
  const sp = (st.speakers || []).find((x) => x.id === vc.speaker), pr = ps.find((x) => x.id === vc.profile);
  const who = vc.mode === "preset" ? (sp ? `기본 목소리: ${sp.name}${$("#vcInstruct").value ? ` · ${$("#vcInstruct").value}` : ""}` : "") : pr ? `복제 목소리: ${pr.name}` : "";
  $("#vcPick").textContent = who || (vc.mode === "preset" ? "위에서 목소리를 고르세요" : "먼저 녹음으로 복제하세요");
  $("#vcSpeak").disabled = !who;
}
$("#vcInstruct").addEventListener("input", vcRender);
$("#vcPanel").addEventListener("click", async (e) => {
  if (e.target.closest("[data-vcrefresh]")) return vcLoad();
  const m = e.target.closest("[data-vcmode]"); if (m) { vc.mode = m.dataset.vcmode; return vcRender(); }
  const sp = e.target.closest("[data-vcspk]"); if (sp) { vc.speaker = sp.dataset.vcspk; return vcRender(); }
  const sy = e.target.closest("[data-vcstyle]"); if (sy) { $("#vcInstruct").value = sy.dataset.vcstyle; return vcRender(); }
  const pd = e.target.closest("[data-vcpdel]");
  if (pd) {
    if (!confirm("이 복제 목소리를 지울까요? (리소스로 저장한 소리는 남습니다)")) return;
    await api(`/api/voice/profiles/${pd.dataset.vcpdel}`, { method: "DELETE" }).catch((err) => toast(err.message, true));
    if (vc.profile === pd.dataset.vcpdel) vc.profile = "";
    return vcLoad();
  }
  const pf = e.target.closest("[data-vcprof]"); if (pf) { vc.profile = pf.dataset.vcprof; return vcRender(); }
  if (e.target.closest("[data-vcdl]")) {
    if (!confirm("Qwen3-TTS 목소리 모델을 내려받습니다 (모델마다 약 2GB, Apache-2.0).\n계속할까요?")) return;
    try { await api("/api/voice/download", { method: "POST" }); toast("모델 받기를 시작했습니다 — 끝나면 화면이 바뀝니다"); } catch (err) { toast(err.message, true); }
    return;
  }
  const sv = e.target.closest("[data-vcsave]");
  if (sv && vc.last) {
    const name = prompt("리소스 이름", vc.last.label); if (!name) return;
    try {
      await api("/api/voice/save", { method: "POST", body: { name, file: vc.last.file, speaker: vc.last.speaker, instruct: vc.last.instruct, profileId: vc.last.profileId, language: vc.last.language }, busy: "리소스로 저장 중" });
      toast("목소리 리소스로 저장했습니다"); loadResources();
    } catch (err) { toast(err.message, true); }
  }
});
$("#vcSpeak").addEventListener("click", async () => {
  const b = $("#vcSpeak"); b.disabled = true; b.textContent = "만드는 중…";
  try {
    const body = { text: $("#vcText").value, language: $("#vcLang").value, ...(vc.mode === "preset" ? { speaker: vc.speaker, instruct: $("#vcInstruct").value.trim() } : { profileId: vc.profile }) };
    const label = $("#vcPick").textContent.replace(/^(기본|복제) 목소리: /, "");
    const r = await api("/api/voice/speak", { method: "POST", body, busy: "목소리 만드는 중 (처음엔 모델을 올리느라 오래 걸립니다)" });
    vc.last = { ...body, file: r.file, label };
    $("#vcOut").querySelectorAll("[data-vcsave]").forEach((x) => x.remove()); // 저장은 가장 최근 것만
    $("#vcOut").insertAdjacentHTML("afterbegin", `<div class="vc__out"><audio controls autoplay src="/data/_voices/${r.file}"></audio>
      <span class="small muted">${esc(label)} · “${esc(body.text.slice(0, 30))}” · ${r.duration}초 (${r.seconds}초 걸림)</span>
      <a class="btn btn--sm" href="/data/_voices/${r.file}" download>받기</a><button class="btn btn--sm" type="button" data-vcsave>리소스로 저장</button></div>`);
  } catch (err) { toast(err.message, true); }
  finally { b.textContent = "▶ 만들어 듣기"; vcRender(); }
});
$("#vcClone").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = $("#vcFile").files[0], btn = e.submitter;
  if (!$("#vcConsent").checked) return toast("본인 목소리이거나 허락받은 목소리인지 체크해 주세요", true);
  btn.disabled = true;
  try {
    const up = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
    const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.error || up.status);
    const prof = await api("/api/voice/clone", { method: "POST", body: { token: d.token, name: $("#vcName").value, refText: $("#vcRefText").value, language: $("#vcLang").value, consent: true }, busy: "녹음 정리 중" });
    vc.profile = prof.id; e.target.reset(); $("#vcNew").open = false;
    if (prof.cut) alert(`녹음이 ${prof.cut.from}초라 ${prof.cut.to}초(문장 사이 쉼)까지만 씁니다 (최대 15초).`
      + (prof.cut.dropped ? `\n\n받아 적은 말에서 잘린 뒤 문장은 뺐습니다:\n“${prof.cut.dropped}”\n(남겨 두면 그 말이 만든 소리 앞에 붙습니다)` : "\n\n받아 적은 말에 잘린 뒤 문장이 남아 있으면 지우고 다시 복제하세요 — 남으면 그 말이 만든 소리 앞에 붙습니다."));
    toast("복제 목소리를 만들었습니다 — 아래에서 문장을 만들어 들어 보세요"); vcLoad();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});
// 녹음 파일 끌어다 놓기
const vcDrop = $("#vcDrop");
["dragenter", "dragover"].forEach((t) => vcDrop.addEventListener(t, (e) => { e.preventDefault(); vcDrop.classList.add("is-over"); }));
["dragleave", "drop"].forEach((t) => vcDrop.addEventListener(t, () => vcDrop.classList.remove("is-over")));
vcDrop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; const dt = new DataTransfer(); dt.items.add(f); $("#vcFile").files = dt.files; if (!$("#vcName").value) $("#vcName").value = f.name.replace(/\.[^.]+$/, ""); });

// ── 시작 ──────────────────────────────────────────────
await loadStatus().catch((e) => toast(e.message, true));
await loadBrands();
await setTab(location.hash.slice(1)); // 주소가 없으면 처음 화면
if (state.tab !== "templates") loadTemplates().catch(() => {});   // 탭 옆 개수
if (state.tab !== "resources") loadResources().catch(() => {});
connect();
