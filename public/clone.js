// 영상 복제하기 — 영상 링크·mp4 → 분석 + 바꿀 수 있는 것 → 바꿀 것에 이미지 넣기(안 넣으면 그대로) → Genjutsu 영상 프롬프트 (서버: lib/clone.js)
// 주소: #clone(올리기 + 복제한 영상 목록) · #clone/cl_…(그 영상 열기)
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
async function upload(f, purpose = "") {
  const r = await fetch(`/api/uploads?${purpose ? `purpose=${purpose}&` : ""}name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
  return d.token;
}
const RES_KINDS = [["person", "인물"], ["product", "소품·제품"], ["background", "배경"]];
const KIND_RES = { 인물: "person", 의상: "person", 제품: "product", 소품: "product", 배경: "background" };
const resImg = (x) => {
  const rank = (f) => (f.role === "ref" ? 10 : 0) + ({ sheet: 0, body: 1, face: 2 }[f.part] ?? 3);
  const f = (x.files || []).filter((y) => y.kind === "image").sort((a, b) => rank(a) - rank(b))[0];
  return f ? `/data/_resources/${x.kind}/${x.id}/${f.file}` : "";
};
const st = { list: [], c: null, res: [], resKind: "person", resEl: "", bound: false, waiting: false };
const fu = (id, f) => `/data/_clones/${id}/${f}`;
const tm = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const status = (m) => { $("#clStatus").textContent = m || ""; $("#clStatus").hidden = !m; const d = $("#clDetailStatus"); if (d) { d.textContent = m || ""; d.hidden = !m; } };
const changed = (c, e) => !!(c.swaps?.[e.id]?.image || c.swaps?.[e.id]?.note?.trim());
const ADD_KINDS = ["소품", "제품", "인물", "동물", "의상", "로고·글자", "기타"];

// ── 목록 ──
function stage(x) {
  if (x.status === "analyzing") return "분석 중";
  if (x.status === "error") return "실패";
  if (x.prompts) return "프롬프트까지";
  const n = (x.analysis?.elements || []).filter((e) => changed(x, e)).length;
  return n ? `바꿀 것 ${n}개` : "분석 완료";
}
function renderList() {
  $("#clCount").textContent = st.list.length ? `${st.list.length}` : "";
  $("#clGrid").innerHTML = st.list.map((x) => `<article class="cl-card"><a class="cl-card__media" href="#clone/${x.id}">${x.poster ? `<img src="${fu(x.id, x.poster)}" alt="" loading="lazy">` : `<span class="cl-card__ph">🪞</span>`}
      ${x.video ? `<video muted loop playsinline preload="none" data-src="${fu(x.id, x.video)}"></video>` : ""}
      ${x.spec ? `<span class="cl-card__dur">${Math.round(x.spec.duration_s)}초</span>` : ""}<span class="cl-card__state">${stage(x)}</span></a>
    <div class="cl-card__body"><strong class="cl-card__title">${esc(x.title)}</strong>
      <p class="muted small" style="margin:0">${when(x.updated_at)} · ${x.shots ? `컷 ${x.shots.length}개` : ""}${x.analysis ? ` · 바꿀 수 있는 것 ${x.analysis.elements.length}개` : ""}</p>
      ${x.error ? `<p class="small vm-over" style="margin:0">${esc(x.error)}</p>` : ""}
      <div class="ex__row"><a class="btn btn--ghost btn--sm" href="#clone/${x.id}">열기</a><button class="btn btn--ghost btn--sm" type="button" data-cldel="${x.id}">지우기</button></div></div></article>`).join("")
    || `<p class="muted cl-empty">아직 복제한 영상이 없습니다. 위에 링크를 넣거나 mp4 를 올리세요.</p>`;
}

// 바꿀 범위 — 서버 lib/clone.js 의 SCOPES 와 같은 표. 아무것도 안 고르면 전부 바꾼다
const SCOPES = {
  인물: [["face", "얼굴"], ["hair", "헤어"], ["body", "체형"], ["outfit", "의상"], ["accessory", "액세서리"]],
  동물: [["species", "종·생김새"], ["fur", "털색·무늬"], ["accessory", "소품"]],
  제품: [["shape", "형태 전체"], ["label", "라벨·로고"], ["color", "색"]],
  배경: [["place", "장소 전체"], ["color", "색감·조명"]],
  의상: [["design", "디자인"], ["color", "색·무늬"]],
};
const PRESETS = { 인물: [["전부", ["face", "hair", "body", "outfit", "accessory"]], ["얼굴만", ["face", "hair"]], ["의상만", ["outfit", "accessory"]]] };
function scopeHTML(e, sw) {
  const list = SCOPES[e.kind]; if (!list) return "";
  const on = sw.parts?.length ? sw.parts : list.map(([k]) => k);
  return `<div class="gj-scope" data-clscope="${e.id}"><span class="small muted">바꿀 범위</span>
    ${(PRESETS[e.kind] || []).map(([l, ks]) => `<button type="button" class="gj-scope__pre ${ks.length === on.length && ks.every((k) => on.includes(k)) ? "is-on" : ""}" data-clpre="${e.id}|${ks.join(",")}">${l}</button>`).join("")}
    ${list.map(([k, l]) => `<button type="button" class="seg__btn ${on.includes(k) ? "is-on" : ""}" data-clpart="${e.id}|${k}">${l}</button>`).join("")}</div>`;
}

// ── 상세 ──
function elCard(c, e) {
  const sw = c.swaps?.[e.id] || {}, on = changed(c, e);
  const box = e.box ? `<span class="gj-box" style="left:${e.box.x}%;top:${e.box.y}%;width:${e.box.w}%;height:${e.box.h}%"></span>` : "";
  const shot0 = c.shots.find((s) => s.shot === e.shots[0]);
  return `<article class="gj-el ${on ? "is-on" : ""}" data-clel="${e.id}">
    <button class="gj-el__orig" type="button" data-clseek="${shot0?.start ?? 0}" title="원본에서 이 장면 보기"><img src="${fu(c.id, e.frame)}" alt="">${box}<span>원본</span></button>
    <div class="gj-el__arrow" aria-hidden="true">→</div>
    <div class="gj-el__new">${sw.image
      ? `<img src="${fu(c.id, sw.image)}" alt=""><button class="gj-el__x" type="button" data-clclear="${e.id}" aria-label="이미지 빼기">×</button>${sw.from ? `<span>${esc(sw.from)}</span>` : ""}`
      : `<label class="gj-el__slot" title="바꿀 이미지 넣기"><input type="file" accept="image/*" data-clswap="${e.id}" hidden><b>＋</b><small>이미지 넣기</small></label>`}</div>
    <div class="gj-el__body">
      <div class="ra-row"><span class="gj-kind">${esc(e.kind)}</span><strong class="ra-grow">${esc(e.name)}</strong><span class="gj-state ${on ? "is-on" : ""}">${on ? "바꿈" : "그대로 유지"}</span></div>
      <p class="small" style="margin:0">${esc(e.desc_ko || "")}</p>
      <p class="small muted" style="margin:0">컷 ${e.shots.map((n) => `<button class="ra-link" type="button" data-clseek="${c.shots.find((s) => s.shot === n)?.start ?? 0}">${n}</button>`).join(" · ")}${e.difficulty ? ` · 바꾸기 ${esc(e.difficulty)}` : ""}${e.image_hint ? ` · 추천: ${esc(e.image_hint)}` : ""}</p>
      ${scopeHTML(e, sw)}
      ${sw.image ? `<div class="ra-row"><span class="small muted">넣은 이미지</span><span class="form-seg" data-clform="${e.id}">${[["single", "단일 이미지"], ["sheet", "여러 각도 시트"]].map(([k, l]) => `<button type="button" class="seg__btn ${(sw.form || "single") === k ? "is-on" : ""}" data-clformv="${e.id}|${k}">${l}</button>`).join("")}</span>
        ${sw.form === "sheet" && e.kind === "인물" && !sw.face_image ? `<span class="small gj-warn">시트는 얼굴이 작아 옷만 바뀌기 쉽습니다 — 아래에서 얼굴을 잘라 넣으세요</span>` : ""}</div>` : ""}
      ${e.kind === "인물" ? `<div class="gj-face">${sw.face_image
        ? `<img src="${fu(c.id, sw.face_image)}" alt=""><span class="small"><b>얼굴 사진</b>${sw.face_from ? ` · ${esc(sw.face_from)}` : ""} — 얼굴은 이 사진과 똑같이 바꿉니다</span><button class="btn btn--ghost btn--sm" type="button" data-clfaceclear="${e.id}">빼기</button>`
        : `${sw.image ? `<button class="btn btn--sm" type="button" data-clfacecrop="${e.id}">넣은 이미지에서 얼굴 잘라 넣기</button>` : ""}<label class="btn btn--sm gj-face__up"><input type="file" accept="image/*" data-clface="${e.id}" hidden>＋ 얼굴 사진 따로 넣기</label><span class="small muted">전신·시트 이미지만 넣으면 얼굴이 작아 옷만 바뀌기 쉽습니다. 정면 얼굴 클로즈업을 넣으면 얼굴까지 바뀝니다</span>`}</div>` : ""}
      <div class="ra-row"><input class="ra-grow" data-clnote="${e.id}" value="${esc(sw.note || "")}" placeholder="메모 (선택) — 예: 옷만 빨간색으로, 표정은 웃게">
        ${KIND_RES[e.kind] ? `<button class="ra-link" type="button" data-clres="${e.id}|${KIND_RES[e.kind]}">리소스에서 고르기</button>` : ""}</div>
    </div></article>`;
}
// 추가할 것 — 원본에 없는 요소: 이미지 + 종류·이름 + 의도(언제·어떻게 등장해 무엇을 하는지)
function addCard(c, x) {
  return `<article class="gj-el gj-add is-on" data-clel="${x.id}" data-cladd="${x.id}">
    <div class="gj-el__orig gj-add__none"><span>원본에 없음</span></div>
    <div class="gj-el__arrow" aria-hidden="true">＋</div>
    <div class="gj-el__new">${x.image
      ? `<img src="${fu(c.id, x.image)}" alt=""><button class="gj-el__x" type="button" data-clclear="${x.id}" aria-label="이미지 빼기">×</button>${x.from ? `<span>${esc(x.from)}</span>` : ""}`
      : `<label class="gj-el__slot" title="추가할 것 이미지 넣기"><input type="file" accept="image/*" data-clswap="${x.id}" hidden><b>＋</b><small>이미지 넣기</small></label>`}</div>
    <div class="gj-el__body">
      <div class="gj-addrow"><select data-claddk aria-label="종류" class="gj-addkind">${ADD_KINDS.map((k) => `<option ${k === x.kind ? "selected" : ""}>${k}</option>`).join("")}</select>
        <input data-claddn value="${esc(x.name || "")}" placeholder="이름 — 예: 육포" aria-label="이름">
        <button class="gj-el__del" type="button" data-cladddel aria-label="빼기" title="빼기">×</button></div>
      <textarea data-claddnote rows="2" placeholder="의도 — 언제·어떻게 등장해 무엇을 하는지. 예: 춤이 끝나면 오른손으로 육포를 들어 카메라 쪽으로 흔든다">${esc(x.note || "")}</textarea>
      ${KIND_RES[x.kind] ? `<div class="ra-row"><button class="ra-link" type="button" data-clres="${x.id}|${KIND_RES[x.kind]}">리소스에서 고르기</button></div>` : ""}
    </div></article>`;
}
const copyBox = (label, key, val, rows = 5, ko = "") => `<div class="gj-pr"><div class="ra-row"><strong class="ra-grow small">${label}</strong><button class="btn btn--ghost btn--sm" type="button" data-clcopy="${key}">복사</button></div>
  <textarea class="ra-prompt" rows="${rows}" data-clpr="${key}">${esc(val || "")}</textarea>${ko ? `<details class="small"><summary>한국어로 보기</summary><p class="ra-pre">${esc(ko)}</p></details>` : ""}</div>`;
function promptsHTML(c) {
  const p = c.prompts; if (!p) return "";
  const name = (id) => c.analysis.elements.find((e) => e.id === id)?.name || id;
  const added = (p.added || []).map((x) => x.name).filter(Boolean);
  const log = c.promptLog || [];
  return `<section class="ra-card" id="clPrompts">
    <div class="ra-row"><div class="ra-card__t ra-grow">영상 생성 프롬프트 <span class="muted small">${when(p.at)}${p.edited ? " · 직접 고침" : ""}</span></div>
      ${log.length > 1 ? `<select id="clLog" aria-label="이전 프롬프트">${log.map((x) => `<option value="${esc(x.at)}" ${x.at === p.at ? "selected" : ""}>${when(x.at)} · 바꾼 것 ${x.prompts.changed?.length || 0}개</option>`).join("")}</select>` : ""}</div>
    <div class="gj-refs"><div class="gj-ref"><span class="gj-ref__n">🎬</span><img src="${fu(c.id, c.poster)}" alt=""><small>원본 영상<br>video reference</small></div>
      ${(p.references || []).map((r) => `<div class="gj-ref"><span class="gj-ref__n">${r.image}</span><img src="${fu(c.id, r.file)}" alt=""><small>image ${r.image}<br>${r.added ? "추가: " : ""}${r.face ? "얼굴: " : ""}${esc(r.name)}</small></div>`).join("")}</div>
    <p class="small muted" style="margin:0">바꿈: ${(p.changed || []).map(name).map(esc).join(", ") || "없음"}${added.length ? ` · 추가: ${added.map(esc).join(", ")}` : ""} · 그대로: ${(p.kept || []).map(name).map(esc).join(", ") || "없음"}</p>
    <p class="small" style="margin:0">힉스필드 <b>Genjutsu</b> 에 원본 영상과 위 순서대로 이미지를 넣고 아래 프롬프트를 붙여 넣으세요.</p>
    ${copyBox("① Genjutsu 프롬프트 (원본 영상 + 이미지)", "genjutsu_prompt_en", p.genjutsu_prompt_en, 7, p.genjutsu_prompt_ko)}
    <details class="gj-more"><summary>② 다른 방법 — 첫 프레임 바꾸기 → 이미지로 영상 만들기</summary>
      <p class="small muted">이미지 편집 모델에 <b>원본 첫 프레임을 image 1</b>, 새 이미지를 image 2 부터 넣습니다. <a href="${fu(c.id, p.first_frame)}" download>첫 프레임 받기</a></p>
      ${copyBox("첫 프레임 편집 프롬프트", "first_frame_prompt_en", p.first_frame_prompt_en, 5)}
      ${copyBox("이미지 → 영상 프롬프트", "i2v_prompt_en", p.i2v_prompt_en, 5)}</details>
    ${copyBox("네거티브", "negative_en", p.negative_en, 2)}
    <details class="gj-more"><summary>컷별 프롬프트 ${p.shots?.length || 0}개 — 컷마다 따로 만들 때</summary>
      <ol class="gj-shotpr">${(p.shots || []).map((s) => `<li><div class="ra-row"><b>컷 ${s.shot}</b><span class="small muted ra-grow">${tm(s.start || 0)} · ${s.dur}초</span><button class="btn btn--ghost btn--sm" type="button" data-clcopyshot="${s.shot}">복사</button></div>
        <p class="ra-pre">${esc(s.prompt_en)}</p>${s.prompt_ko ? `<p class="small muted" style="margin:0">${esc(s.prompt_ko)}</p>` : ""}</li>`).join("")}</ol></details>
    ${p.checklist?.length ? `<div class="gj-check"><strong class="small">확인할 것</strong><ul>${p.checklist.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}
// ── 힉스필드로 만들기 — A Genjutsu(원본 영상 그대로 소재 바꾸기) · B 첫 프레임 이미지 → 이미지로 영상 (서버 /api/hf/generate, target clone) ──
// 설정은 st.g 에 둔다 (다시 그려도 유지). 크레딧이 드는 일이라 누를 때마다 확인을 받는다
const G = () => (st.g ||= { gj: { way: "replace", res: "720p", count: 1 }, ff: { model: "gpt_image_2_5", count: 1 }, iv: { model: "seedance_2_5", count: 1, audio: false } });
const optsOf = (list, val) => list.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("");
function fitImage(c) {
  const g = G().ff, m = st.imgModels?.find((x) => x.id === g.model) || st.imgModels?.[0]; if (!m) return null;
  if (!m.aspects.includes(g.aspect)) g.aspect = m.aspects.includes(c.spec.aspect) ? c.spec.aspect : m.aspects[0];
  if (m.res && !m.res.options.includes(g.res)) g.res = m.res.def;
  if (m.quality && !m.quality.options.includes(g.quality)) g.quality = m.quality.def;
  return m;
}
function fitVideo(c) {
  const g = G().iv, m = st.vidModels?.find((x) => x.id === g.model) || st.vidModels?.[0]; if (!m) return null;
  if (m.aspects?.length && !m.aspects.includes(g.aspect)) g.aspect = m.aspects.includes(c.spec.aspect) ? c.spec.aspect : m.aspects.find((a) => a !== "auto") || m.aspects[0];
  if (m.res && !m.res.options.includes(g.res)) g.res = m.res.def;
  const want = Math.round(g.duration || c.spec.duration_s || 5);
  g.duration = m.dur.options ? (m.dur.options.find((x) => x >= want) ?? m.dur.options.at(-1)) : Math.max(m.dur.min, Math.min(m.dur.max, want));
  return m;
}
function genHTML(c) {
  const p = c.prompts; if (!p || !st.imgModels) return "";
  const g = G(), busy = st.genBusy || {}, im = fitImage(c), vm = fitVideo(c);
  const gens = (c.generated || []).slice().reverse();
  const firsts = (c.generated || []).filter((x) => x.purpose === "first" && x.kind === "image");
  const starts = [[p.first_frame, "원본 첫 프레임 (안 바꾼 것)"], ...firsts.map((x, i) => [x.file, `만든 첫 프레임 ${i + 1}`])];
  if (!starts.some(([f]) => f === g.iv.start)) g.iv.start = firsts.at(-1)?.file || p.first_frame;
  const durs = vm.dur.options ? vm.dur.options : Array.from({ length: vm.dur.max - vm.dur.min + 1 }, (_, i) => vm.dur.min + i);
  const isApi = st.hf?.mode === "api";
  return `<section class="ra-card gj-gen" id="clGen">
    <div class="ra-card__t">힉스필드로 만들기 <span class="muted small">크레딧이 듭니다 · 누를 때마다 확인</span></div>
    <div class="gj-gen__way">
      <h4>A. Genjutsu — 원본 영상 그대로, 소재만 바꾸기 <span class="muted small">비율·길이는 원본을 따릅니다 (${esc(c.spec.aspect)} · ${c.spec.duration_s}초)</span></h4>
      <div class="gj-gen__row" data-g="gj">
        <label class="field"><span>방식</span><select data-k="way">${optsOf([["replace", "소재 바꾸기 (원본 영상 속 물건·사람을 이미지로)"], ["motion", "움직임 옮기기 (이미지 속 대상이 원본처럼 움직임)"]], g.gj.way)}</select></label>
        <label class="field"><span>화질</span><select data-k="res">${optsOf([["480p", "480p"], ["720p", "720p"], ["1080p", "1080p"]], g.gj.res)}</select></label>
        <label class="field"><span>개수</span><select data-k="count">${optsOf([[1, "1개"], [2, "2개"]], g.gj.count)}</select></label>
        <button class="btn btn--primary" type="button" data-clgen="gj" ${busy.gj || isApi ? "disabled" : ""}>${busy.gj ? "만드는 중… (3~10분)" : "Genjutsu 로 만들기"}</button>
      </div>
      ${isApi ? `<p class="small su__err">Genjutsu 는 MCP 연결에서만 됩니다 — 오른쪽 위 힉스필드를 MCP 로 바꾸세요.</p>` : `<p class="small muted">원본 영상 + 위 이미지 ${(p.references || []).length}장 + ① Genjutsu 프롬프트를 그대로 보냅니다.</p>`}
    </div>
    <div class="gj-gen__way">
      <h4>B. 첫 프레임 바꾸기 → 이미지로 영상 만들기 <span class="muted small">비율·길이·모델을 고를 수 있습니다</span></h4>
      <p class="small muted" style="margin:0">B-1 첫 프레임 이미지 — 원본 첫 프레임 + 바꿀 이미지 + 첫 프레임 편집 프롬프트</p>
      <div class="gj-gen__row" data-g="ff">
        <label class="field"><span>모델</span><select data-k="model">${optsOf(st.imgModels.map((m) => [m.id, `${m.name} — ${m.note}`]), g.ff.model)}</select></label>
        <label class="field"><span>비율</span><select data-k="aspect">${optsOf(im.aspects.map((a) => [a, a]), g.ff.aspect)}</select></label>
        ${im.res ? `<label class="field"><span>해상도</span><select data-k="res">${optsOf(im.res.options.map((o) => [o, o]), g.ff.res)}</select></label>` : ""}
        ${im.quality ? `<label class="field"><span>화질</span><select data-k="quality">${optsOf(im.quality.options.map((o) => [o, o]), g.ff.quality)}</select></label>` : ""}
        <label class="field"><span>개수</span><select data-k="count">${optsOf([1, 2, 3, 4].map((n) => [n, `${n}장`]), g.ff.count)}</select></label>
        <button class="btn" type="button" data-clgen="ff" ${busy.ff ? "disabled" : ""}>${busy.ff ? "만드는 중…" : "첫 프레임 만들기"}</button>
      </div>
      <p class="small muted" style="margin:0">B-2 이미지 → 영상 — 고른 시작 이미지 + 이미지→영상 프롬프트</p>
      <div class="gj-gen__row" data-g="iv">
        <label class="field"><span>시작 이미지</span><select data-k="start">${optsOf(starts, g.iv.start)}</select></label>
        <label class="field"><span>모델</span><select data-k="model">${optsOf(st.vidModels.map((m) => [m.id, `${m.name} — ${m.note}`]), g.iv.model)}</select></label>
        ${vm.aspects?.length ? `<label class="field"><span>비율</span><select data-k="aspect">${optsOf(vm.aspects.map((a) => [a, a]), g.iv.aspect)}</select></label>` : ""}
        <label class="field"><span>길이</span><select data-k="duration">${optsOf(durs.map((d) => [d, `${d}초`]), g.iv.duration)}</select></label>
        ${vm.res ? `<label class="field"><span>${esc(vm.res.label || "화질")}</span><select data-k="res">${optsOf(vm.res.options.map((o) => [o, o]), g.iv.res)}</select></label>` : ""}
        ${vm.audio ? `<label class="check"><input type="checkbox" data-k="audio" ${g.iv.audio ? "checked" : ""}> 소리 만들기</label>` : ""}
        <label class="field"><span>개수</span><select data-k="count">${optsOf([1, 2].map((n) => [n, `${n}개`]), g.iv.count)}</select></label>
        <button class="btn btn--primary" type="button" data-clgen="iv" ${busy.iv ? "disabled" : ""}>${busy.iv ? "만드는 중… (2~10분)" : "영상 만들기"}</button>
      </div>
    </div>
    <div class="gj-gen__outs">${gens.map((x) => `<figure>${x.kind === "video" ? `<video src="${fu(c.id, x.file)}" controls playsinline preload="metadata"></video>` : `<img src="${fu(c.id, x.file)}" alt="" loading="lazy">`}
      <figcaption>${esc({ genjutsu: "Genjutsu", first: "첫 프레임", i2v: "이미지→영상" }[x.purpose] || x.purpose)} · ${esc(x.model || "")}${x.settings?.resolution ? ` · ${esc(x.settings.resolution)}` : ""} · <a href="${fu(c.id, x.file)}" download>받기</a></figcaption></figure>`).join("") || `<p class="small muted">아직 만든 결과가 없습니다.</p>`}</div>
  </section>`;
}
async function runGen(kind) {
  const c = st.c, p = c.prompts, g = G(), refs = (p.references || []).map((r) => r.file);
  let body, what;
  if (kind === "gj") {
    body = { kind: "video", purpose: "genjutsu", genjutsu: g.gj.way, prompt: p.genjutsu_prompt_en, video: c.video, refs, resolution: g.gj.res, count: g.gj.count };
    what = `Genjutsu ${g.gj.count}개 (${g.gj.res})`;
  } else if (kind === "ff") {
    const m = fitImage(c);
    body = { kind: "image", purpose: "first", prompt: p.first_frame_prompt_en, refs: [p.first_frame, ...refs], imageModel: g.ff.model, aspect: g.ff.aspect, resolution: g.ff.res, quality: g.ff.quality, count: g.ff.count };
    what = `첫 프레임 ${g.ff.count}장 (${m.name} · ${g.ff.aspect})`;
  } else {
    const m = fitVideo(c);
    body = { kind: "video", purpose: "i2v", prompt: p.i2v_prompt_en, refs: [g.iv.start], videoModel: g.iv.model, aspect: g.iv.aspect, duration: g.iv.duration, resolution: g.iv.res, withAudio: !!g.iv.audio, count: g.iv.count };
    what = `영상 ${g.iv.count}개 (${m.name} · ${g.iv.aspect || "자동"} · ${g.iv.duration}초${g.iv.res ? ` · ${g.iv.res}` : ""})`;
  }
  if (!confirm(`힉스필드로 ${what}를 만들까요? 크레딧이 듭니다.`)) return;
  try {
    (st.genBusy ||= {})[kind] = true; renderDetail();
    const promptKey = { gj: "genjutsu_prompt_en", ff: "first_frame_prompt_en", iv: "i2v_prompt_en" }[kind];
    await api("/api/hf/generate", { method: "POST", body: { target: { type: "clone", id: c.id }, ...body, promptAt: p.at, promptKey } });
    toast("힉스필드에 보냈습니다 — 끝나면 아래 결과에 붙습니다");
  } catch (e) { st.genBusy[kind] = false; renderDetail(); toast(e.message, true); }
}

// ── 기록 탭 — 프롬프트 버전마다 카드 하나: 그때 바꾼 것 · 프롬프트 · 그 버전으로 만든 영상·이미지 ──
// 예전 결과(버전 표시가 없던 것)는 만든 시각으로 그때의 버전에 넣는다
const PURPOSE = { genjutsu: "Genjutsu", first: "첫 프레임", i2v: "이미지→영상" };
const KEY_LABEL = { genjutsu_prompt_en: "① Genjutsu", first_frame_prompt_en: "② 첫 프레임 편집", i2v_prompt_en: "② 이미지→영상" };
function versionsOf(c) {
  const log = [...(c.promptLog || [])].sort((a, b) => a.at.localeCompare(b.at)); // 오래된 것부터 v1
  if (c.prompts?.at && !log.some((x) => x.at === c.prompts.at)) log.push({ at: c.prompts.at, prompts: c.prompts, swaps: c.swaps, adds: c.adds });
  const vs = log.map((v, i) => ({ ...v, n: i + 1, gens: [] })), loose = [];
  for (const g of c.generated || []) {
    let v = g.prompt_at && vs.find((x) => x.at === g.prompt_at);
    if (!v) v = [...vs].reverse().find((x) => x.at <= (g.created_at || ""));
    (v ? v.gens : loose).push(g);
  }
  return { vs: vs.reverse(), loose };
}
function recordsHTML(c) {
  const { vs, loose } = versionsOf(c);
  const name = (id) => c.analysis?.elements?.find((e) => e.id === id)?.name || id;
  const partsTxt = (sw, id) => { const kind = c.analysis?.elements?.find((e) => e.id === id)?.kind, list = SCOPES[kind]; if (!list || !sw?.parts?.length || sw.parts.length === list.length) return ""; return ` (${list.filter(([k]) => sw.parts.includes(k)).map(([, l]) => l).join("·")})`; };
  const gen = (g) => `<figure class="cl-rec__out">${g.kind === "video" ? `<video src="${fu(c.id, g.file)}" controls playsinline preload="metadata"></video>` : `<img src="${fu(c.id, g.file)}" alt="" loading="lazy">`}
    <figcaption><b>${esc(PURPOSE[g.purpose] || g.purpose || "")}</b> · ${esc(g.model || "")}${g.settings?.resolution ? ` · ${esc(g.settings.resolution)}` : ""}${g.settings?.aspect ? ` · ${esc(g.settings.aspect)}` : ""}${g.settings?.duration ? ` · ${esc(g.settings.duration)}초` : ""}
      <br><span class="muted">${esc(when(g.created_at))}</span> · <a href="${fu(c.id, g.file)}" download>받기</a>
      ${g.prompt ? `<details><summary>이때 쓴 프롬프트${g.prompt_key ? ` — ${esc(KEY_LABEL[g.prompt_key] || g.prompt_key)}` : ""}</summary><p class="ra-pre">${esc(g.prompt)}</p></details>` : ""}</figcaption></figure>`;
  const cur = c.prompts?.at;
  return `<div class="cl-rec">
    ${vs.map((v) => { const pr = v.prompts || {}; return `<section class="ra-card cl-rec__v ${v.at === cur ? "is-cur" : ""}">
      <div class="ra-row"><div class="ra-card__t ra-grow">버전 ${v.n} <span class="muted small">${esc(when(v.at))}${v.at === cur ? " · 지금 쓰는 프롬프트" : ""} · 만든 것 ${v.gens.length}개</span></div>
        ${v.at === cur ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-clrestore="${esc(v.at)}">이 버전으로 되돌리기</button>`}</div>
      <p class="small" style="margin:0">바꿈: ${(pr.changed || []).map((id) => esc(name(id)) + esc(partsTxt(v.swaps?.[id], id))).join(", ") || "없음"}${pr.added?.length ? ` · 추가: ${pr.added.map((x) => esc(x.name)).join(", ")}` : ""}</p>
      ${pr.references?.length ? `<div class="gj-refs">${pr.references.map((r) => `<div class="gj-ref"><span class="gj-ref__n">${r.image}</span><img src="${fu(c.id, r.file)}" alt=""><small>${esc(r.name)}</small></div>`).join("")}</div>` : ""}
      <details class="gj-more"><summary>이 버전의 프롬프트</summary>
        ${pr.genjutsu_prompt_en ? `<p class="small"><b>① Genjutsu</b></p><p class="ra-pre">${esc(pr.genjutsu_prompt_en)}</p>${pr.genjutsu_prompt_ko ? `<p class="small muted">${esc(pr.genjutsu_prompt_ko)}</p>` : ""}` : ""}
        ${pr.first_frame_prompt_en ? `<p class="small"><b>② 첫 프레임 편집</b></p><p class="ra-pre">${esc(pr.first_frame_prompt_en)}</p>` : ""}
        ${pr.i2v_prompt_en ? `<p class="small"><b>② 이미지→영상</b></p><p class="ra-pre">${esc(pr.i2v_prompt_en)}</p>` : ""}</details>
      <div class="cl-rec__outs">${v.gens.slice().reverse().map(gen).join("") || `<p class="small muted">이 버전으로 만든 영상·이미지가 없습니다.</p>`}</div>
    </section>`; }).join("") || `<p class="muted">아직 프롬프트를 만들지 않았습니다. [만들기] 탭에서 바꿀 것을 넣고 프롬프트를 만드세요.</p>`}
    ${loose.length ? `<section class="ra-card cl-rec__v"><div class="ra-card__t">버전 정보 없는 결과 <span class="muted small">${loose.length}개</span></div><div class="cl-rec__outs">${loose.slice().reverse().map(gen).join("")}</div></section>` : ""}
  </div>`;
}

function renderDetail() {
  const c = st.c, el = $("#clDetail");
  if (c.shots && c.status !== "analyzing") {
    const n = versionsOf(c).vs.reduce((k, v) => k + v.gens.length, 0) + versionsOf(c).loose.length;
    const tabs = `<nav class="subtabs cl-tabs" role="tablist"><a class="subtabs__item ${st.clTab !== "rec" ? "is-on" : ""}" href="#clone/${c.id}" role="tab">만들기</a><a class="subtabs__item ${st.clTab === "rec" ? "is-on" : ""}" href="#clone/${c.id}/rec" role="tab">기록 <span class="muted">${(c.promptLog || []).length || (c.prompts ? 1 : 0)}버전 · ${n}개</span></a></nav>`;
    if (st.clTab === "rec") { el.innerHTML = tabs + recordsHTML(c); return; }
    renderMake();
    el.insertAdjacentHTML("afterbegin", tabs);
    return;
  }
  renderMake();
}
function renderMake() {
  const c = st.c, el = $("#clDetail");
  if (c.status === "analyzing" || !c.shots) {
    el.innerHTML = `<div class="ra-card"><div class="ra-card__t">${esc(c.title)}</div>
      ${c.status === "error" ? `<p class="vm-over">분석 실패: ${esc(c.error || "")}</p><p class="small muted">목록에서 지우고 다시 넣어 보세요.</p>` : `<p>분석 중입니다 — 영상 받기 → 컷·글자·음성 분석 → 바꿀 수 있는 것 찾기 순서로 진행됩니다.</p>`}
      <p class="ex__status" id="clDetailStatus" role="status" hidden></p></div>`;
    return;
  }
  const a = c.analysis, els = a?.elements || [], n = els.filter((e) => changed(c, e)).length, adds = c.adds || [];
  el.innerHTML = `<div class="gj-detail">
    <aside class="gj-side">
      <video id="clVideo" src="${fu(c.id, c.video)}" poster="${fu(c.id, c.poster)}" controls playsinline></video>
      <input class="gj-title" id="clTitle" value="${esc(c.title)}" aria-label="제목">
      <p class="small muted" style="margin:0">${c.spec.duration_s}초 · ${c.spec.width}×${c.spec.height} ${c.spec.aspect} · ${c.spec.fps}fps · 컷 ${c.shots.length}개 (평균 ${c.cuts.avg_s}초) · 오디오 ${esc(c.spec.audio)}</p>
      ${c.source?.url ? `<a class="small ra-link" href="${esc(c.source.url)}" target="_blank" rel="noopener">원본 링크 ↗</a>` : ""}
      ${a ? `<p class="small" style="margin:0">${esc(a.summary || "")}</p>
        ${a.keep?.length ? `<div class="gj-keep"><strong class="small">그대로 지킬 것</strong><ul>${a.keep.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}` : ""}
    </aside>
    <div class="gj-main">
      <p class="ex__status" id="clDetailStatus" role="status" hidden></p>
      ${c.error ? `<p class="small vm-over">마지막 작업 실패: ${esc(c.error)}</p>` : ""}
      <section class="ra-card">
        <div class="ra-row"><div class="ra-card__t ra-grow">바꿀 수 있는 것 ${els.length}개 <span class="muted small">— 바꿀 것에만 이미지(또는 메모)를 넣으세요. 비워 둔 것은 원본 그대로입니다</span></div>
          <button class="btn btn--ghost btn--sm" type="button" data-clreanalyze>다시 찾기</button></div>
        ${els.map((e) => elCard(c, e)).join("") || `<p class="small muted">찾은 것이 없습니다. "다시 찾기"를 눌러 보세요.</p>`}
        <div class="ra-row gj-addhead"><div class="ra-card__t ra-grow">추가할 것 ${adds.length ? `${adds.length}개 ` : ""}<span class="muted small">— 원본에 없는 요소. 이미지와 의도(언제·어떻게)를 넣으면 그대로 등장시킵니다</span></div>
          <button class="btn btn--ghost btn--sm" type="button" data-claddnew>＋ 요소 추가하기</button></div>
        ${adds.map((x) => addCard(c, x)).join("")}
        <label class="ra-f"><span>전체 메모 <em class="muted">— 선택. 소재 말고 전체에 바랄 것 (예: 밤 장면으로, 한국인 모델로)</em></span><textarea id="clExtra" rows="2">${esc(c.extra || "")}</textarea></label>
        <div class="ra-row"><button class="btn btn--primary" type="button" data-clmake ${n || adds.length || c.extra?.trim() ? "" : "disabled"}>✦ 프롬프트 만들기</button>
          <span class="small muted">바꿈 ${n}개 · 추가 ${adds.length}개 · 그대로 ${els.length - n}개</span></div>
      </section>
      ${promptsHTML(c)}
      ${genHTML(c)}
      <details class="ra-card gj-more"><summary class="ra-card__t">컷 분석 ${c.shots.length}개 — 프레임·화면 글자·음성</summary>
        <ol class="gj-shots">${c.shots.map((s) => { const sc = a?.scenes?.find((x) => Number(x.shot) === s.shot); return `<li><button type="button" data-clseek="${s.start}"><img src="${fu(c.id, s.frame)}" alt="" loading="lazy"></button>
          <div><b>컷 ${s.shot}</b> <span class="small muted">${tm(s.start)} · ${s.dur}초${sc?.camera ? ` · ${esc(sc.camera)}` : ""}</span>
          ${sc?.desc_ko ? `<p class="small" style="margin:2px 0">${esc(sc.desc_ko)}</p>` : ""}
          ${s.onscreen_text ? `<p class="small muted" style="margin:0">글자: ${esc(s.onscreen_text)}</p>` : ""}${s.speech ? `<p class="small muted" style="margin:0">음성: ${esc(s.speech)}</p>` : ""}</div></li>`; }).join("")}</ol>
        <p class="small"><a href="${fu(c.id, c.contact_sheet)}" target="_blank" rel="noopener">한 장 요약 보기</a>${c.transcript ? ` · <a href="${fu(c.id, c.transcript)}" download>음성 자막(SRT)</a>` : ""}</p></details>
    </div></div>`;
}

async function load(id) {
  if (!st.imgModels) [st.imgModels, st.vidModels, st.hf] = await Promise.all([api("/api/hf/image-models"), api("/api/hf/video-models"), api("/api/hf/settings").catch(() => null)]).catch(() => [null, null, null]);
  st.list = await api("/api/clones");
  renderList();
  st.c = id ? await api(`/api/clones/${id}`).catch(() => null) : null;
  $("#clHome").hidden = !!st.c; $("#clDetail").hidden = !st.c;
  if (st.c) {
    renderDetail();
    // 상세는 목록과 다른 화면이라 "복제한 영상" 칸을 하나 더 둔다 (뒤로 → 목록)
    window.nav?.sub([{ label: "복제한 영상", go: () => { location.hash = "#clone"; } }, { label: st.c.title, go: () => {} }]);
  } else window.nav?.sub([]);
}

// 메모·제목·고친 프롬프트 저장
let saveT = 0;
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 600); };
async function saveNow() {
  clearTimeout(saveT);
  const c = st.c; if (!c?.shots) return;
  const partsOf = (id) => [...document.querySelectorAll(`[data-clscope="${id}"] [data-clpart].is-on`)].map((x) => x.dataset.clpart.split("|")[1]);
  const b = { swaps: Object.fromEntries([...document.querySelectorAll("[data-clnote]")].map((x) => [x.dataset.clnote, { note: x.value, ...(document.querySelector(`[data-clscope="${x.dataset.clnote}"]`) ? { parts: partsOf(x.dataset.clnote) } : {}), ...(document.querySelector(`[data-clform="${x.dataset.clnote}"] .is-on`) ? { form: document.querySelector(`[data-clform="${x.dataset.clnote}"] .is-on`).dataset.clformv.split("|")[1] } : {}) }])) };
  if ($("#clTitle")) b.title = $("#clTitle").value;
  if ($("#clExtra")) b.extra = $("#clExtra").value;
  if (st.addsDirty || document.querySelector("[data-cladd]")) b.adds = [...document.querySelectorAll("[data-cladd]")].map((d) => ({ id: d.dataset.cladd, kind: d.querySelector("[data-claddk]").value, name: d.querySelector("[data-claddn]").value, note: d.querySelector("[data-claddnote]").value }));
  st.addsDirty = false;
  if (document.querySelector("[data-clpr]") && st.prDirty) b.prompts = Object.fromEntries([...document.querySelectorAll("[data-clpr]")].map((x) => [x.dataset.clpr, x.value]));
  st.prDirty = false;
  try { st.c = await api(`/api/clones/${c.id}`, { method: "PUT", body: b }); } catch (e) { toast(e.message, true); }
}
// 바꿈/그대로 표시와 버튼만 고친다 (입력 중에 화면 전체를 다시 그리면 커서가 날아간다)
function refreshMarks() {
  const c = st.c; let n = 0;
  for (const e of c.analysis?.elements || []) {
    const sw = c.swaps?.[e.id] || {}, note = document.querySelector(`[data-clnote="${e.id}"]`)?.value || "";
    const on = !!(sw.image || note.trim()); n += on;
    const card = document.querySelector(`[data-clel="${e.id}"]`); if (!card) continue;
    card.classList.toggle("is-on", on);
    const s = card.querySelector(".gj-state"); s.classList.toggle("is-on", on); s.textContent = on ? "바꿈" : "그대로 유지";
  }
  const go = document.querySelector("[data-clmake]");
  const na = document.querySelectorAll("[data-cladd]").length;
  if (go) { go.disabled = !(n || na || $("#clExtra")?.value.trim()); go.nextElementSibling.textContent = `바꿈 ${n}개 · 추가 ${na}개 · 그대로 ${(c.analysis?.elements.length || 0) - n}개`; }
}

async function start(body) {
  try {
    const { id } = await api("/api/clones", { method: "POST", body: { ...body, whisper: $("#clWhisper").checked, ocr: $("#clOcr").checked } });
    st.waiting = true; status("분석 시작");
    location.hash = `#clone/${id}`;
  } catch (e) { toast(e.message, true); }
}
async function runJob(path, label) {
  await saveNow();
  try { await api(`/api/clones/${st.c.id}/${path}`, { method: "POST" }); st.waiting = true; status(`${label} — 시작`); }
  catch (e) { toast(e.message, true); }
}
function renderRes() {
  $("#clResKinds").innerHTML = RES_KINDS.map(([k, n]) => `<button type="button" class="seg__btn ${st.resKind === k ? "is-on" : ""}" data-clresk="${k}">${n}</button>`).join("");
  const list = st.res.filter((x) => x.kind === st.resKind && resImg(x));
  $("#clResGrid").innerHTML = list.map((x) => `<button type="button" class="po-pick__item" data-clrespick="${esc(x.kind)}|${esc(x.id)}"><img src="${resImg(x)}" alt="" loading="lazy"><span>${esc(x.name)}</span><small>${esc(x.description || "")}</small></button>`).join("")
    || `<p class="muted">사진이 있는 리소스가 없습니다. 오른쪽 위 [리소스 관리 ↗]에서 등록하세요.</p>`;
}
async function setSwap(body) {
  await saveNow();
  try { st.c = await api(`/api/clones/${st.c.id}/swap`, { method: "POST", body }); renderDetail(); }
  catch (e) { toast(e.message, true); }
}

function bind() {
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "job" && e.kind === "hf" && e.state !== "start" && st.genBusy && !$("#cloneView").hidden) {
      if (e.result?.type === "clone" || e.state === "error") { st.genBusy = {}; load(st.c?.id || "").then(() => $("#clGen")?.scrollIntoView({ block: "start" })); }
      return;
    }
    if (e.type === "log" && st.waiting) status(e.message);
    if (e.type !== "job" || e.kind !== "clone" || e.state === "start") return;
    st.waiting = false; status("");
    if (e.state === "error") toast(e.message, true); else toast(e.message.replace(/^완료: /, "") + " 완료");
    if (!$("#cloneView").hidden) load(st.c?.id || "").then(() => { if (e.state === "done" && /프롬프트/.test(e.message)) $("#clPrompts")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  });
  $("#clDetail").addEventListener("change", (e) => {
    const row = e.target.closest("[data-g]"), k = e.target.dataset.k; if (!row || !k) return;
    const cfg = G()[row.dataset.g];
    cfg[k] = e.target.type === "checkbox" ? e.target.checked : ["count", "duration"].includes(k) ? Number(e.target.value) : e.target.value;
    if (k === "model") renderDetail(); // 모델마다 비율·해상도·길이 칸이 다르다
  });
  $("#clDetail").addEventListener("click", async (e) => {
    const rs = e.target.closest("[data-clrestore]");
    if (rs) {
      if (!confirm("이 버전의 프롬프트로 되돌릴까요? (지금 프롬프트는 기록에 남아 있습니다)")) return;
      try { await saveNow(); st.c = await api(`/api/clones/${st.c.id}/restore`, { method: "POST", body: { at: rs.dataset.clrestore } }); toast("그 버전 프롬프트로 바꿨습니다 — 만들기 탭에서 바로 생성할 수 있습니다"); location.hash = `#clone/${st.c.id}`; } catch (err) { toast(err.message, true); }
      return;
    }
    const b = e.target.closest("[data-clgen]"); if (b) return runGen(b.dataset.clgen);
    const part = e.target.closest("[data-clpart]"), pre = e.target.closest("[data-clpre]");
    if (!part && !pre) return;
    const box = (part || pre).closest("[data-clscope]");
    if (pre) { const ks = pre.dataset.clpre.split("|")[1].split(","); box.querySelectorAll("[data-clpart]").forEach((x) => x.classList.toggle("is-on", ks.includes(x.dataset.clpart.split("|")[1]))); }
    else { part.classList.toggle("is-on"); if (!box.querySelector("[data-clpart].is-on")) { part.classList.add("is-on"); return toast("바꿀 범위를 하나 이상 고르세요", true); } }
    const on = [...box.querySelectorAll("[data-clpart].is-on")].map((x) => x.dataset.clpart.split("|")[1]);
    box.querySelectorAll("[data-clpre]").forEach((x) => { const ks = x.dataset.clpre.split("|")[1].split(","); x.classList.toggle("is-on", ks.length === on.length && ks.every((k) => on.includes(k))); });
    saveSoon();
  });
  $("#clGoUrl").addEventListener("click", () => { const u = $("#clUrl").value.trim(); if (!u) return toast("링크를 넣으세요", true); start({ url: u }); });
  $("#clUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#clGoUrl").click(); });
  const drop = $("#clDrop");
  const take = async (f) => { if (!f) return; status(`올리는 중: ${f.name}`); try { await start({ token: await upload(f) }); } catch (e) { status(""); toast(e.message, true); } };
  $("#clFile").addEventListener("change", (e) => take(e.target.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); take(e.dataTransfer.files[0]); });
  $("#clGrid").addEventListener("mouseover", (e) => { const v = e.target.closest(".cl-card")?.querySelector("video"); if (!v || v.dataset.on) return; v.dataset.on = 1; if (!v.src) v.src = v.dataset.src; v.play().catch(() => {}); });
  $("#clGrid").addEventListener("mouseout", (e) => { const c = e.target.closest(".cl-card"); if (!c || c.contains(e.relatedTarget)) return; const v = c.querySelector("video"); if (v) { v.pause(); delete v.dataset.on; } });
  $("#clGrid").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-cldel]"); if (!d || !confirm("이 영상과 넣은 이미지·프롬프트를 지울까요? (되돌릴 수 없습니다)")) return;
    try { await api(`/api/clones/${d.dataset.cldel}`, { method: "DELETE" }); load(""); } catch (err) { toast(err.message, true); }
  });
  $("#clResClose").addEventListener("click", () => $("#clResDialog").close());
  $("#clResDialog").addEventListener("click", async (e) => {
    const k = e.target.closest("[data-clresk]"); if (k) { st.resKind = k.dataset.clresk; return renderRes(); }
    const p = e.target.closest("[data-clrespick]"); if (!p) return;
    const [kind, id] = p.dataset.clrespick.split("|");
    $("#clResDialog").close(); await setSwap({ el: st.resEl, resource: { kind, id } });
  });
  const view = $("#clDetail");
  view.addEventListener("input", (e) => {
    if (e.target.closest("[data-clpr]")) st.prDirty = true;
    if (e.target.closest("[data-clnote], #clExtra")) refreshMarks();
    if (e.target.closest("[data-clnote], #clExtra, #clTitle, [data-clpr], [data-cladd]")) saveSoon();
  });
  view.addEventListener("change", async (e) => {
    const fc = e.target.closest("[data-clface]");
    if (fc?.files[0]) { try { await setSwap({ el: fc.dataset.clface, slot: "face", token: await upload(fc.files[0], "resource") }); toast("얼굴 사진을 넣었습니다 — 프롬프트를 다시 만들어야 반영됩니다"); } catch (err) { toast(err.message, true); } return; }
    const f = e.target.closest("[data-clswap]");
    if (f?.files[0]) { try { await setSwap({ el: f.dataset.clswap, token: await upload(f.files[0], "resource") }); } catch (err) { toast(err.message, true); } }
    if (e.target.closest("[data-claddk]")) { await saveNow(); renderDetail(); } // 종류가 바뀌면 리소스 버튼도 바뀐다
    if (e.target.id === "clLog") { await saveNow(); try { st.c = await api(`/api/clones/${st.c.id}/restore`, { method: "POST", body: { at: e.target.value } }); renderDetail(); toast("그때 프롬프트로 바꿨습니다"); } catch (err) { toast(err.message, true); } }
  });
  // 바꿀 칸에 이미지를 끌어다 놓기
  view.addEventListener("dragover", (e) => { if (e.target.closest(".gj-el")) e.preventDefault(); });
  view.addEventListener("drop", async (e) => {
    const card = e.target.closest(".gj-el"); if (!card) return;
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
    try { await setSwap({ el: card.dataset.clel, token: await upload(f, "resource") }); } catch (err) { toast(err.message, true); }
  });
  view.addEventListener("click", async (e) => {
    const sk = e.target.closest("[data-clseek]");
    if (sk) { const v = $("#clVideo"); v.currentTime = Number(sk.dataset.clseek) + 0.05; v.play().catch(() => {}); v.scrollIntoView({ block: "nearest" }); return; }
    const cl = e.target.closest("[data-clclear]"); if (cl) return setSwap({ el: cl.dataset.clclear, clear: true });
    const fcl = e.target.closest("[data-clfaceclear]"); if (fcl) return setSwap({ el: fcl.dataset.clfaceclear, slot: "face", clear: true });
    const fv = e.target.closest("[data-clformv]");
    if (fv) { const [id, form] = fv.dataset.clformv.split("|"); fv.parentElement.querySelectorAll("[data-clformv]").forEach((x) => x.classList.toggle("is-on", x === fv)); st.c.swaps[id] = { ...(st.c.swaps[id] || {}), form }; await saveNow(); return renderDetail(); }
    const fcrop = e.target.closest("[data-clfacecrop]");
    if (fcrop) {
      const id = fcrop.dataset.clfacecrop, sw = st.c.swaps[id];
      const box = await window.pickCrop?.(fu(st.c.id, sw.image), { title: "얼굴 부분을 네모로 고르세요 — 정면 얼굴을 이마부터 턱까지" });
      if (!box) return;
      await setSwap({ el: id, slot: "face", crop: box }); toast("얼굴을 잘라 넣었습니다 — 프롬프트를 다시 만들어야 반영됩니다");
      return;
    }
    const rs = e.target.closest("[data-clres]");
    if (rs) { const [el, kind] = rs.dataset.clres.split("|"); st.resEl = el; st.resKind = kind; st.res = await api("/api/resources").catch(() => []); renderRes(); return $("#clResDialog").showModal(); }
    if (e.target.closest("[data-claddnew]")) { await saveNow(); try { st.c = await api(`/api/clones/${st.c.id}`, { method: "PUT", body: { adds: [...(st.c.adds || []), { kind: "소품", name: "", note: "" }] } }); renderDetail(); document.querySelector("[data-cladd]:last-of-type [data-claddn]")?.focus(); } catch (err) { toast(err.message, true); } return; }
    const ad = e.target.closest("[data-cladddel]");
    if (ad) { const card = ad.closest("[data-cladd]"); if ((card.querySelector("[data-claddn]").value || card.querySelector("img")) && !confirm("이 추가할 것을 뺄까요?")) return; card.remove(); st.addsDirty = true; await saveNow(); return renderDetail(); }
    if (e.target.closest("[data-clmake]")) return runJob("prompts", "프롬프트 만들기");
    if (e.target.closest("[data-clreanalyze]")) { if (st.c.prompts && !confirm("바꿀 수 있는 것을 다시 찾을까요? 이름이 같은 소재에 넣은 이미지만 이어집니다.")) return; return runJob("elements", "바꿀 수 있는 것 다시 찾기"); }
    const cp = e.target.closest("[data-clcopy]"), cs = e.target.closest("[data-clcopyshot]");
    if (cp || cs) {
      const text = cp ? document.querySelector(`[data-clpr="${cp.dataset.clcopy}"]`).value : st.c.prompts.shots.find((s) => String(s.shot) === cs.dataset.clcopyshot)?.prompt_en || "";
      navigator.clipboard.writeText(text).then(() => toast("복사했습니다"), () => toast("복사하지 못했습니다", true));
    }
  });
}

window.cloner = {
  async open(sub = "") {
    if (!st.bound) { bind(); st.bound = true; }
    st.clTab = location.hash.split("/")[2] === "rec" ? "rec" : "make"; // #clone/cl_…/rec = 기록 탭
    await load(/^cl_\d+$/.test(sub) ? sub : "").catch((e) => toast(e.message, true));
  },
  close() { saveNow(); },
};
