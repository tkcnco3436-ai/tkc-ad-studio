// 인물 라디오 — AI 진행자가 라디오 스튜디오에서 말하는 세로 쇼츠. 템플릿 없이 고정 라디오 포맷 하나 (서버: lib/radio.js)
//   1 기획(브랜드·타깃·길이·참고 자료·주제) → 2 대본 → 3 출연·스튜디오(사진·목소리) → 4 목소리(읽히기) → 5 장면(화면 이미지 → 말하는 영상) → 6 완성(합치기)
// 주소: #radio(새로 시작) · #radio/list(만든 것) · #radio/ra_…(그 작업 열기)
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
const STEPS = ["기획", "대본", "출연·스튜디오", "목소리", "장면", "완성"];
const FORMAT = ["훅", "공감", "핵심", "정리", "질문"];
const RES_KINDS = [["person", "인물"], ["background", "배경"], ["product", "소품·제품"]];
const resImg = (x) => { // 결과 이미지 우선 (서버가 넣는 것과 같은 순서)
  const rank = (f) => (f.role === "ref" ? 10 : 0) + ({ sheet: 0, body: 1, face: 2 }[f.part] ?? 3);
  const f = (x.files || []).filter((y) => y.kind === "image").sort((a, b) => rank(a) - rank(b))[0];
  return f ? `/data/_resources/${x.kind}/${x.id}/${f.file}` : "";
};
const st = { r: null, list: [], sets: [], voices: [], res: [], kits: [], step: 0, bound: false, castN: 1, pickSet: "", ideas: null };
const fu = (f) => `/data/_radios/${st.r.id}/${f}`;
const status = (m) => { $("#raStatus").textContent = m || ""; $("#raStatus").hidden = !m; };

async function upload(f) {
  const r = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
  return d.token;
}
// 컷(영상 하나) 구성 — 서버가 짠 r.clips. 대사 줄 묶음 · 길이 · 말하는 사람
const clipLines = (r, c) => c.lines.map((n) => r.lines.find((l) => l.n === n)).filter(Boolean);
const clipText = (r, c) => clipLines(r, c).map((l) => l.text).join(" ");
function planBar(r) {
  const cs = r.clips || []; if (!cs.length) return "";
  const total = Math.round(cs.reduce((a, c) => a + c.dur, 0) + 0.25 * (cs.length - 1));
  const over = cs.filter((c) => c.dur > (r.clip_max || 8) + 0.5).length;
  return `<div class="ra-plan"><div class="ra-row"><b>영상 ${cs.length}개</b><span class="small muted">${r.estimated ? "어림 " : ""}약 ${total}초 · 목표 ${r.seconds}초 · 영상 하나 최대 ${r.clip_max}초</span></div>
    <div class="ra-plan__bar">${cs.map((c, i) => `<span style="flex:${c.dur};background:${esc(r.cast[c.speaker]?.color || "#999")}" title="영상 ${i + 1} · ${esc(r.cast[c.speaker]?.name || "")} · ${c.dur}초">${i + 1}</span>`).join("")}</div>
    ${over ? `<p class="small vm-over" style="margin:0">최대 길이보다 긴 대사가 ${over}개 있습니다 — 그 줄은 혼자 한 영상이 됩니다.</p>` : ""}</div>`;
}
function done(i) {
  const r = st.r; if (!r) return false;
  const sc = r.scenes || {}, ls = r.lines, cs = r.clips || [];
  return [!!r.topic, ls.length > 0, r.cast.every((c) => c.photo || c.desc), ls.length > 0 && ls.every((l) => l.dur),
    cs.length > 0 && cs.every((c) => sc[c.id]?.video), !!r.out][i] || (i === 3 && native(r) && ls.length > 0);
}
// 목소리 두 갈래: "tts" 내 목소리(이 PC 에서 읽혀 음성 파일 → 립싱크) · "model" 영상 모델 목소리(모델이 대사를 직접 말함)
const native = (r) => r?.voice_mode === "model";
const VMODES = [["tts", "내 목소리 (이 PC · 무료)"], ["model", "영상 모델 목소리"]];
// 단계 머리 · 아래 이동 줄
const head = (n, title, hint) => `<header class="ra-head">${n ? `<span class="ra-head__n">${n}</span>` : ""}<div><h3>${title}</h3>${hint ? `<p>${hint}</p>` : ""}</div></header>`;
const nav = (v, ok = true) => `<div class="ra-nav">${v > 0 ? `<button class="btn btn--ghost" type="button" data-rastep="${v - 1}">← 이전</button>` : "<span></span>"}
  ${v < STEPS.length - 1 ? `<button class="btn btn--primary" type="button" data-rastep="${v + 1}" ${ok ? "" : "disabled"}>다음 · ${STEPS[v + 1]} →</button>` : ""}</div>`;
const chips = (key, list, cur) => `<div class="ra-chips">${list.map(([v, n]) => `<button type="button" class="ra-chip ${String(v) === String(cur) ? "is-on" : ""}" data-rachip="${key}|${v}">${n}</button>`).join("")}</div>`;
const field = (label, control, cls = "") => `<label class="ra-f ${cls}"><span>${label}</span>${control}</label>`;

// 시작 — 저장한 출연 세트로 시작하거나, 진행자 수만 골라 빈 출연으로 시작
const setThumb = (x) => { const f = x.cast.find((c) => c.photo)?.photo; return f ? `<img src="/data/_radios/_sets/${x.id}/${f}" alt="">` : `<span>📻</span>`; };
function s0() {
  const pick = st.sets.find((x) => x.id === st.pickSet);
  return `${head("", "새 인물 라디오", "라디오 스튜디오에서 AI 진행자가 말하는 세로 쇼츠입니다. 모든 영상이 아래 라디오 포맷으로 짜입니다.")}
    <div class="ra-format">${FORMAT.map((x) => `<span>${x}</span>`).join("<i>→</i>")}</div>
    ${st.sets.length ? `<section class="ra-plain"><div class="ra-card__t">저장한 출연 세트 <span class="muted small">— 고르면 진행자·목소리·스튜디오가 채워진 채로 시작합니다</span></div>
      <div class="ra-sets">${st.sets.map((x) => `<div class="ra-set ${x.id === st.pickSet ? "is-on" : ""}">
        <button type="button" class="ra-set__pick" data-raset="${x.id}">${setThumb(x)}<span><b>${esc(x.name)}</b><small>${esc(x.cast.map((c) => c.name).join(" · "))} · ${esc((x.props || []).map((p) => p.name).join(", ") || "기본 스튜디오")}</small></span></button>
        <button type="button" class="ra-x" data-rasetdel="${x.id}" aria-label="${esc(x.name)} 지우기" title="세트 지우기">×</button></div>`).join("")}</div></section>` : ""}
    <section class="ra-plain"><div class="ra-row ra-start">${pick ? `<span class="small"><b>${esc(pick.name)}</b> 세트로 시작</span><button class="ra-link" type="button" data-raset="">선택 풀기</button>`
      : `<span class="small">진행자</span>${chips("castN", [[1, "1명 (혼자 말하기)"], [2, "2명 (대화)"]], st.castN)}`}
      <button class="btn btn--primary" type="button" data-racreate>시작 →</button></div></section>`;
}
// 3 출연·스튜디오 — 진행자 카드(사진 · 이름 · 설명)와 스튜디오 타일(배경·소품). 종류는 추가할 때 정해진다
const photo = (src, attr, label = "사진") => `<label class="ra-photo" title="사진 올리기">${src ? `<img src="${src}" alt="">` : `<span>+ ${label}</span>`}<input type="file" accept="image/*" ${attr} hidden></label>`;
function pCast() {
  const r = st.r;
  return `${head(3, "출연·스튜디오", "진행자 사진·목소리와 스튜디오를 정합니다. 사진이 없으면 설명대로 그립니다.")}
    <section class="ra-plain">
      <div class="ra-row"><div class="ra-card__t ra-grow">진행자</div>${chips("cast", [[1, "1명"], [2, "2명"]], r.cast.length)}</div>
      <div class="ra-row"><span class="small">목소리</span>${chips("vmode", VMODES, r.voice_mode || "tts")}</div>
      <p class="small muted" style="margin:0">${native(r) ? "영상을 만들 때 모델이 대사를 직접 말합니다 (음성 파일 없음). 사람마다 목소리를 말로 설명하세요. 한국어 발음·목소리는 모델에 따라 달라 결과를 꼭 들어 보세요." : "이 PC 에서 고른 목소리로 줄마다 읽힌 뒤, 그 음성에 입을 맞춰 영상을 만듭니다."}</p>
      <div class="ra-people">${r.cast.map((c, i) => `<div class="ra-person">
        ${photo(c.photo ? fu(c.photo) : "", `data-raphoto="${i}"`, "사진")}
        <div class="ra-person__body">
          <div class="ra-name"><input type="color" class="ra-dot" data-rac="color" data-i="${i}" value="${esc(c.color)}" aria-label="색" title="대본·자막 색"><input data-rac="name" data-i="${i}" value="${esc(c.name)}" aria-label="이름"></div>
          <textarea data-rac="desc" data-i="${i}" rows="2" placeholder="예: 30대 여성, 단발, 데님 셔츠">${esc(c.desc || "")}</textarea>
          ${native(r) ? `<div class="ra-name"><span class="ra-tag">목소리</span><input data-rac="voice_desc" data-i="${i}" class="ra-voicesel" value="${esc(c.voice_desc || "")}" placeholder="예: 차분하고 따뜻한 30대 여성, 또렷한 발음"></div>`
            : `<div class="ra-name"><span class="ra-tag">목소리</span><select data-rac="voice" data-i="${i}" aria-label="${esc(c.name)} 목소리" class="ra-voicesel">${voiceOpts(c.voice)}</select><button class="ra-play" type="button" data-ravoicetest="${i}" aria-label="목소리 들어 보기" title="들어 보기">▶</button></div>`}
          <button class="ra-link" type="button" data-rares="cast|${i}|person">${c.from ? `리소스: ${esc(c.from)} · 바꾸기` : "리소스에서 불러오기"}</button>
        </div></div>`).join("")}</div>
      <p class="small muted" style="margin:0">실제 인물은 초상권 동의를 받은 사진만 쓰세요.</p></section>
    <section class="ra-plain">
      <div class="ra-row"><div class="ra-card__t ra-grow">스튜디오</div>
        <button class="btn btn--ghost btn--sm" type="button" data-rapropadd="배경">+ 배경</button><button class="btn btn--ghost btn--sm" type="button" data-rapropadd="소품">+ 소품</button>
        <button class="btn btn--ghost btn--sm" type="button" data-rares="new||background">리소스에서</button></div>
      ${(r.props || []).length ? `<div class="ra-props">${r.props.map((x) => `<div class="ra-prop" data-rapid="${x.id}" data-kind="${x.kind}">
        ${photo(x.photo ? fu(x.photo) : "", `data-rapropphoto="${x.id}"`)}
        <div class="ra-prop__body">
          <div class="ra-name"><span class="ra-tag">${x.kind}</span><input data-rap="name" value="${esc(x.name)}" aria-label="이름"><button class="ra-x" type="button" data-rapropdel aria-label="빼기">×</button></div>
          <input data-rap="desc" value="${esc(x.desc || "")}" placeholder="어떻게 보이게 할지">
        </div></div>`).join("")}</div>` : `<p class="small muted" style="margin:0">비어 있으면 기본 라디오 스튜디오(흡음재 벽 · ON AIR 사인 · 마이크)로 그립니다.</p>`}
    </section>
    <section class="ra-plain"><div class="ra-card__t">출연 세트로 저장 <span class="muted small">— 다음 작업을 이 진행자·목소리·스튜디오로 바로 시작합니다</span></div>
      <div class="ra-row"><input id="raSetName" class="ra-grow" value="${esc(r.set?.name || "")}" placeholder="세트 이름 — 예: 박팀장 1인 라디오"><button class="btn btn--sm" type="button" data-rasetsave>저장</button></div>
      ${r.set ? `<p class="small muted" style="margin:0">"${esc(r.set.name)}" 세트에서 시작했거나 저장한 작업입니다. 같은 이름으로 저장하면 그 세트를 덮어씁니다.</p>` : ""}</section>
    ${nav(2)}`;
}
// 1 기획 — 브랜드 맥락 · 타깃·목적·길이 · 참고 자료(링크·글) · 라디오 포맷에 맞춘 주제 5개(구간별 뼈대·핏) → 고른 뼈대로 대본
const kitFields = (prof = {}) => (st.kitProfile || []).map(([k, l]) => `<label class="ra-f"><span>${esc(l)}</span><textarea data-kp="${k}" rows="${["offer", "usp", "target"].includes(k) ? 2 : 1}">${esc(prof?.[k] || "")}</textarea></label>`).join("");
const GOALS = [["views", "조회수"], ["save", "저장·공유"], ["comment", "댓글"], ["lead", "문의·구매"]];
const skel = (sk) => `<ol class="ra-skel">${(sk || []).map((x) => `<li><b>${esc(x.section)}</b> ${esc(x.content || x.needs || "")}</li>`).join("")}</ol>`;
function pPlan() {
  const r = st.r, got = st.ideas?.id === r.id ? st.ideas : null, pl = r.plan || {};
  const brief = r.brief?.skeleton?.length && r.brief.topic === r.topic ? r.brief : null;
  const kit = st.kits.find((k) => k.id === pl.kitId), newKit = st.kitNew;
  const fit = (n) => `<span class="ra-fit" title="핏 ${n}/5">${"●".repeat(n)}${"○".repeat(5 - n)}</span>`;
  const src = r.sources || {};
  return `${head(1, "기획", "누구에게·무엇을 위해 만드는지 정하고 참고 자료를 넣으면, 라디오 포맷에 맞춘 주제와 구간별 뼈대를 짭니다.")}
    <div class="ra-card"><div class="ra-card__t">브랜드 <span class="muted small">— 선택. 고르면 그 맥락·말투·금지어에 맞춥니다</span></div>
      <div class="ra-row"><select id="raKit" aria-label="브랜드" class="ra-grow"><option value="">브랜드 없이</option>${st.kits.map((k) => `<option value="${k.id}" ${k.id === pl.kitId ? "selected" : ""}>${esc(k.name)}</option>`).join("")}<option value="__new" ${newKit ? "selected" : ""}>+ 새 브랜드 정보</option></select></div>
      ${kit && !newKit ? `<p class="small">${esc([kit.profile?.category, kit.profile?.offer, kit.profile?.target && `고객: ${kit.profile.target}`, kit.profile?.tone && `톤: ${kit.profile.tone}`].filter(Boolean).join(" · ") || "기본 정보가 비어 있습니다")}</p>` : ""}
      ${newKit || kit ? `<details ${newKit ? "open" : ""} class="ra-more"><summary>${newKit ? "새 브랜드 정보" : "브랜드 정보 보기·고치기"}</summary>
        ${newKit ? field("브랜드 이름", `<input id="raKitName" placeholder="예: 코웨이">`) : ""}
        <div class="ra-row"><input id="raKitUrl" class="ra-grow" placeholder="홈페이지·스토어 주소 (https://…)" value="${esc(kit?.profile?.links?.match(/https?:\/\/\S+/)?.[0] || "")}"><button class="btn btn--ghost btn--sm" type="button" data-rakitfill>링크로 채우기</button></div>
        <div class="kit-profile" id="raKitProfile">${kitFields(kit?.profile)}</div>
        <div class="ra-row"><button class="btn btn--primary btn--sm" type="button" data-rakitsave>${newKit ? "브랜드 저장" : "고친 내용 저장"}</button><span class="small muted">카드뉴스·포스터에서도 같이 씁니다</span></div>
      </details>` : ""}</div>
    <div class="ra-card ra-grid2">
      ${field("누구에게", `<input data-rapl="target" value="${esc(pl.target || "")}" placeholder="예: 재택하는 20~30대 직장인">`)}
      ${field("제품·브랜드 (선택)", `<input data-rapl="product" value="${esc(pl.product || "")}" placeholder="예: 코웨이 아이콘 정수기">`)}
      <div class="ra-f"><span>목적</span>${chips("goal", GOALS, pl.goal)}</div>
      <div class="ra-f"><span>영상 길이</span>${chips("seconds", [15, 30, 45, 60, 90].map((x) => [x, `${x}초`]), r.seconds)}</div>
      <div class="ra-f"><span>영상 하나 최대 길이 <em class="muted">— 같은 사람이 이어 말하는 줄을 이 안에서 한 영상으로 묶습니다</em></span>${chips("clip_max", [5, 8, 10, 15].map((x) => [x, `${x}초`]), r.clip_max)}</div>
      <p class="small muted ra-span2">예상: 대사 약 ${Math.max(3, Math.round(r.seconds / 5))}줄 · 영상 ${Math.max(1, Math.ceil(r.seconds / r.clip_max))}~${Math.max(1, Math.round(r.seconds / 4))}개</p>
    </div>
    <div class="ra-card"><div class="ra-card__t">참고 자료 <span class="muted small">— 선택. 주제 찾기와 대본이 이 내용을 근거로 씁니다 (없는 사실은 지어내지 않게)</span></div>
      ${field("링크 <em class=\"muted\">— 줄마다 하나, 최대 10개 (기사·블로그·상품 페이지)</em>", `<textarea data-rasrc="links" rows="2" placeholder="https://…">${esc((src.links || []).join("\n"))}</textarea>`)}
      ${field("글 붙여 넣기 <em class=\"muted\">— 메모·기사 본문·후기·상품 설명</em>", `<textarea data-rasrc="text" rows="4" placeholder="참고할 내용을 붙여 넣으세요">${esc(src.text || "")}</textarea>`)}
    </div>
    <div class="ra-card"><div class="ra-row"><div class="ra-card__t ra-grow">주제</div><div class="ra-format ra-format--sm" title="라디오 포맷">${FORMAT.map((x) => `<span>${x}</span>`).join("<i>→</i>")}</div></div>
      <div class="ra-row"><input id="raTopicNote" class="ra-grow" placeholder="원하는 방향 (선택) — 예: 캐릭터 반전을 살려서, 숫자 리스트형"><button class="btn btn--primary" type="button" data-raideas>주제 찾기</button></div>
      ${got ? `<div class="ra-ideas">${got.list.map((x, i) => { const n = Math.max(0, Math.min(5, x.fit || 0)); return `<div class="ra-idea ${x.topic === r.topic ? "is-on" : ""}">
          <div class="ra-row">${fit(n)}<span class="small muted">${esc(x.angle || "")}</span></div>
          <strong>${esc(x.topic)}</strong>
          <span class="small">“${esc(x.hook || "")}”</span>
          <span class="small muted">${esc(x.target_pain || "")}</span>
          <details class="ra-more"><summary>구간별 뼈대</summary>${skel(x.skeleton)}<p class="small muted">${esc(x.why || "")}</p></details>
          <button class="btn btn--sm ${x.topic === r.topic ? "btn--primary" : "btn--ghost"}" type="button" data-raidea="${i}">${x.topic === r.topic ? "✓ 고름" : "이 기획으로"}</button></div>`; }).join("")}</div>` : ""}
      ${field("주제", `<textarea data-raf="topic" rows="2" placeholder="직접 적거나 위에서 기획을 고르세요">${esc(r.topic)}</textarea>`)}
      ${brief ? `<details class="ra-more"><summary>대본이 따를 기획 뼈대 · ${esc(brief.angle)}</summary>${skel(brief.skeleton)}<button class="ra-link" type="button" data-rabriefx>뼈대 빼기</button></details>` : ""}
    </div>
    ${nav(0, !!r.topic)}`;
}
// 2 대본 — 라디오 포맷·고른 뼈대·참고 자료로 대사를 쓰고 고친다. 줄마다 말하는 사람·화면·몸짓
function voiceOpts(cur) {
  const g = [...new Set(st.voices.map((v) => v.group))];
  return g.map((x) => `<optgroup label="${esc(x)}">${st.voices.filter((v) => v.group === x).map((v) => `<option value="${esc(v.id)}" ${v.id === cur ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</optgroup>`).join("");
}
function pScript() {
  const r = st.r, duo = r.cast.length === 2;
  return `${head(2, "대본", "라디오 포맷과 고른 뼈대·참고 자료로 대사를 씁니다. 줄마다 말하는 사람·화면·몸짓을 고칠 수 있습니다.")}
    <div class="ra-card">
      <div class="ra-row"><span class="small muted">진행자 이름 <em>— 대사에서 서로 부르는 이름</em></span>${r.cast.map((c, i) => `<input class="ra-castname" data-rac="name" data-i="${i}" value="${esc(c.name)}" aria-label="진행자 ${i + 1} 이름" style="--c:${esc(c.color)}">`).join("")}
        <span class="ra-grow"></span><button class="btn ${r.lines.length ? "" : "btn--primary"}" type="button" data-rajob="script" ${r.topic ? "" : "disabled"}>${r.lines.length ? "대본 다시 쓰기" : "대본 쓰기"}</button></div>
      <p class="small muted" style="margin:0">주제: ${esc(r.topic || "— ① 기획에서 정하세요")}${r.sources?.links?.length || r.sources?.text?.trim() ? " · 참고 자료 반영" : ""}</p>
      ${r.title ? field("제목", `<input data-raf="title" value="${esc(r.title)}">`) : ""}
      <ol class="ra-lines">${r.lines.map((l, i) => `<li class="ra-line" data-ran="${l.n}">
        <span class="ra-line__n" style="--c:${esc(r.cast[l.speaker]?.color || "#999")}">${i + 1}</span>
        <div class="ra-line__body">
          <textarea data-ral="text" rows="${Math.max(1, Math.ceil(l.text.length / 48))}">${esc(l.text)}</textarea>
          <div class="ra-row ra-line__meta">
            ${duo ? `<select data-ral="speaker" class="ra-sel-sm" aria-label="말하는 사람">${r.cast.map((c, k) => `<option value="${k}" ${k === l.speaker ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : `<input type="hidden" data-ral="speaker" value="0">`}
            <select data-ral="shot" class="ra-sel-sm" aria-label="화면">${(r.shots || []).filter((s) => s.who.includes(l.speaker)).map((s) => `<option value="${s.shot}" ${s.shot === l.shot ? "selected" : ""}>화면 · ${esc(s.name)}</option>`).join("")}</select>
            <input data-ral="gesture" class="ra-grow ra-gesture" value="${esc(l.gesture || "")}" placeholder="몸짓 (영어)">
            ${l.audio ? `<button class="ra-play" type="button" data-raplay="${fu(l.audio)}" aria-label="듣기">▶</button>` : ""}
            <button class="ra-x" type="button" data-raldel aria-label="줄 지우기">×</button>
          </div></div></li>`).join("")}</ol>
      ${r.lines.length ? `<button class="btn btn--sm" type="button" data-raladd style="align-self:flex-start">+ 줄 추가</button>` : `<p class="muted small">[대본 쓰기]를 누르면 1~2분 뒤 대사가 나옵니다.</p>`}
      ${planBar(r)}
    </div>
    ${nav(1, r.lines.length > 0)}`;
}
// 4 목소리 — 진행자 목소리로 줄마다 읽히고(이 PC · 무료) 이어 붙인다. 목소리 고르기는 ③ 에서
function pVoice() {
  const r = st.r, voiced = r.lines.length && r.lines.every((l) => l.dur);
  if (native(r)) return `${head(4, "목소리", "영상 모델 목소리 — 영상을 만들 때 모델이 대사를 직접 말합니다. 여기서는 읽힐 것이 없습니다.")}
    <div class="ra-card">
      <div class="ra-row">${r.cast.map((c) => `<span class="ra-voice"><i style="background:${esc(c.color)}"></i>${esc(c.name)} <span class="muted">${esc(c.voice_desc || "목소리 설명 없음 — 외모에 맞춰")}</span></span>`).join("")}
        <button class="ra-link" type="button" data-rastep="2">목소리 바꾸기</button></div>
      <p class="small muted" style="margin:0">영상 길이는 대사 글자 수로 어림합니다. 실제 말 빠르기는 모델마다 달라 영상 끝이 잘리거나 남을 수 있어, 영상마다 1초 여유를 둡니다.</p>
      ${planBar(r)}
    </div>
    ${nav(3, r.lines.length > 0)}`;
  return `${head(4, "목소리", "줄마다 진행자 목소리로 읽힙니다 (이 PC 에서 무료). 마음에 안 드는 줄만 다시 읽힐 수 있습니다.")}
    <div class="ra-card">
      <div class="ra-row">${r.cast.map((c) => `<span class="ra-voice"><i style="background:${esc(c.color)}"></i>${esc(c.name)} <span class="muted">${esc(st.voices.find((v) => v.id === c.voice)?.name || c.voice)}</span></span>`).join("")}
        <button class="ra-link" type="button" data-rastep="2">목소리 바꾸기</button><span class="ra-grow"></span>
        <button class="btn ${voiced ? "" : "btn--primary"}" type="button" data-rajob="voice" ${r.lines.length ? "" : "disabled"}>${r.track ? (voiced ? "목소리 다시 확인" : "빈 줄 목소리 만들기") : "목소리 만들기"}</button></div>
      ${r.track ? `<audio controls src="${fu(r.track)}?v=${encodeURIComponent(r.updated_at)}" class="ra-audio"></audio>` : ""}
      <ol class="ra-vlines">${r.lines.map((l, i) => `<li><span class="ra-line__n" style="--c:${esc(r.cast[l.speaker]?.color || "#999")}">${i + 1}</span>
        <p>${esc(l.text)}</p>
        ${l.audio ? `<button class="ra-play" type="button" data-raplay="${fu(l.audio)}" aria-label="듣기">▶</button><span class="small muted">${l.dur}초</span><button class="ra-link" type="button" data-rarevoice="${l.n}">다시</button>` : `<span class="small muted">음성 없음</span>`}</li>`).join("") || `<p class="muted small">② 에서 대본을 먼저 쓰세요.</p>`}</ol>
      ${planBar(r)}
    </div>
    ${nav(3, !!voiced)}`;
}
// 5 장면 — ① 화면 이미지(쓰이는 화면만, 기준 화면 먼저) → ② 영상(컷)마다 그 화면 + 목소리로 말하는 영상. 프롬프트·재료는 접어 둔다
const vidPrompt = (p, withSheet) => !withSheet || /character sheet/i.test(p || "") ? p : `${p} Keep the person's face, hair and outfit identical to the reference character sheet.`;
const hfBtn = (label, pl, primary) => `<button class="btn btn--sm ${primary ? "btn--primary" : ""} hf-btn" type="button" data-hf="${esc(JSON.stringify(pl))}">${label}</button>`;
const MODELS = [["seedance_2_5", "Seedance 2.5"], ["wan2_7", "Wan 2.7"], ["minimax_h3", "MiniMax H3"]];
const NATIVE_MODELS = [["seedance_2_5", "Seedance 2.5 (소리 생성)"], ["gemini_omni_flash_1_1", "Gemini Omni Flash 1.1 (최대 10초)"]];
const tile = (src, label, isVid) => `<figure class="ra-tile">${src ? (isVid ? `<video src="${src}" controls muted playsinline preload="metadata"></video>` : `<img src="${src}" alt="">`) : `<span>비어 있음</span>`}<figcaption>${label}</figcaption></figure>`;
const usedShots = (r) => (r.shots || []).filter((s) => (r.clips || []).some((c) => c.shot === s.shot));
function pScene() {
  const r = st.r, sc = r.scenes || {}, cs = r.clips || [], nat = native(r), models = nat ? NATIVE_MODELS : MODELS;
  const model = models.some(([v]) => v === st.model) ? st.model : models[0][0];
  const stale = r.prompts_mode && r.prompts_mode !== (nat ? "model" : "tts") && cs.some((c) => sc[c.id]?.motion_en);
  const used = usedShots(r), base = used[0], any = used.some((s) => s.frame_en) || cs.some((c) => sc[c.id]?.motion_en);
  const shotOf = (c) => r.shots.find((s) => s.shot === c.shot) || {};
  const shotCard = (s) => {
    const nUse = cs.filter((c) => c.shot === s.shot).length, wait = s.base && !base?.frame;
    const pl = { target: { type: "radio", id: r.id, n: `s${s.shot}`, field: "frame" }, kind: "image", purpose: "edit", prompt: s.frame_en, refs: [...(s.edit_files || []), ...(s.base && base?.frame ? [base.frame] : [])], aspect: "9:16" };
    return `<div class="ra-shot" data-rashot="${s.shot}">
      ${tile(s.frame ? fu(s.frame) : "", `${esc(s.name)}${s === base ? " · 기준" : ""} · 영상 ${nUse}개`)}
      ${s.frame_en ? (wait ? `<span class="small muted">기준 화면 먼저</span>` : hfBtn(s.frame ? "다시 만들기" : "이미지 만들기", pl, !s.frame)) : ""}
      <details class="ra-more"><summary>재료·프롬프트</summary>
        <ol class="ra-input__list">${(s.attach || []).map((a, k) => { const f = s.edit_files?.[k] ?? (s.base ? base?.frame : ""); return `<li>${f ? `<img src="${fu(f)}" alt="">` : `<span class="ra-input__ph">${k + 1}</span>`}<span>${esc(a)}</span></li>`; }).join("")}</ol>
        <textarea class="ra-prompt" data-rapr="frame_en" rows="6">${esc(s.frame_en || "")}</textarea>
        <div class="ra-row"><button class="ra-link" type="button" data-copy="${esc(s.frame_en || "")}">프롬프트 복사</button><label class="ra-link">직접 만든 이미지 올리기<input type="file" accept="image/*" data-rascene="s${s.shot}|frame" hidden></label></div>
      </details></div>`;
  };
  const clipCard = (c, i) => {
    const x = sc[c.id] || {}, sh = shotOf(c), sheet = !["wan2_7", "gemini_omni_flash_1_1"].includes(model) && r.cast[c.speaker]?.photo;
    const sec = Math.min(model === "gemini_omni_flash_1_1" ? 10 : 30, Math.max(4, Math.ceil((c.dur || 4) + (nat ? 1 : 0)))); // 모델 목소리는 말 빠르기를 몰라 1초 여유
    const start = sh.frame || x.frame; // 예전 작업은 영상마다 만든 이미지가 있을 수 있다
    const pl = { target: { type: "radio", id: r.id, n: c.id, field: "video" }, kind: "video", purpose: "video", prompt: vidPrompt(x.motion_en, sheet), refs: [start, ...(sheet ? [sheet] : [])], ...(nat ? { native: true } : { audio: c.audio }), model, duration: sec, aspect: "9:16" };
    return `<div class="ra-card ra-scene" data-rasn="${c.id}">
      <div class="ra-row"><span class="ra-badge" style="--c:${esc(r.cast[c.speaker]?.color || "#999")}">영상 ${i + 1}</span><b>${esc(r.cast[c.speaker]?.name || "")}</b><span class="small muted">${esc(sh.name || "")} · ${c.dur}초 · 대사 ${c.lines.length}줄</span>
        ${c.audio ? `<button class="ra-play" type="button" data-raplay="${fu(c.audio)}" aria-label="이 영상 목소리 듣기">▶</button>` : ""}</div>
      <p class="ra-quote">“${esc(clipText(r, c))}”</p>
      <div class="ra-flow ra-flow--2">
        ${tile(start ? fu(start) : "", `화면 · ${esc(sh.name || "")}`)}<span class="ra-arrow">→</span>
        <div class="ra-step-col">${tile(x.video ? fu(x.video) : "", "말하는 영상", true)}${start && (nat || c.audio) && x.motion_en && !stale ? hfBtn(x.video ? "다시 만들기" : `영상 만들기 · ${sec}초`, pl, !x.video) : `<span class="small muted">${!start ? "① 화면 이미지 먼저" : stale ? "프롬프트 다시 쓰기 필요" : !nat && !c.audio ? "목소리 필요" : "프롬프트 필요"}</span>`}</div>
      </div>
      <details class="ra-more"><summary>재료·프롬프트 (힉스필드에 들어가는 것)</summary>
        <div class="ra-input"><span class="small muted">${esc(models.find(([v]) => v === model)?.[1] || model)} · 9:16 · ${sec}초${nat ? " · 모델이 대사를 직접 말함" : ""}</span>
          <ol class="ra-input__list">
            <li>${start ? `<img src="${fu(start)}" alt="">` : `<span class="ra-input__ph">①</span>`}<span>시작 이미지 (화면 · ${esc(sh.name || "")})</span>${start ? `<a class="ra-link" href="${fu(start)}" download>받기</a>` : ""}</li>
            ${sheet ? `<li><img src="${fu(sheet)}" alt=""><span>인물 시트 (얼굴·옷 유지 참고)</span><a class="ra-link" href="${fu(sheet)}" download>받기</a></li>` : ""}
            ${nat ? `<li><span class="ra-input__ph">🗣</span><span>음성 파일 없음 — 프롬프트 속 대사를 모델이 말함</span></li>` : `<li><span class="ra-input__ph">♪</span><span>목소리 녹음본 ${c.dur}초 (음성 참조)</span>${c.audio ? `<a class="ra-link" href="${fu(c.audio)}" download>받기</a>` : ""}</li>`}</ol>
          <textarea class="ra-prompt" data-rapr="motion_en" rows="5">${esc(x.motion_en || "")}</textarea>
          <div class="ra-row"><button class="ra-link" type="button" data-copy="${esc(vidPrompt(x.motion_en || "", sheet))}">프롬프트 복사</button><label class="ra-link">직접 만든 영상 올리기<input type="file" accept="video/*" data-rascene="${c.id}|video" hidden></label></div></div>
      </details></div>`;
  };
  return `${head(5, "장면", "① 화면 이미지를 먼저 만들고(기준 화면 → 나머지) ② 영상마다 그 화면에 목소리를 넣어 말하는 영상을 만듭니다. 힉스필드는 크레딧이 들어 누를 때마다 확인합니다.")}
    <div class="ra-card">
      <div class="ra-row"><button class="btn ${any ? "" : "btn--primary"}" type="button" data-rajob="prompts" ${cs.length ? "" : "disabled"}>${any ? "프롬프트 다시 쓰기" : "프롬프트 쓰기"}</button>
        <span class="ra-grow"></span><label class="ra-voice">영상 모델<select id="raModel">${models.map(([v, n]) => `<option value="${v}" ${v === model ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
      ${any ? `<details class="ra-more"><summary>프롬프트 자연어로 다듬기</summary>
        <textarea id="raRefine" rows="2" placeholder="예: 조명을 더 밝게 · 손짓을 크게 · 카메라가 천천히 다가가게"></textarea>
        <div class="ra-row"><select id="raRefineTo" class="ra-sel-sm" aria-label="다듬을 것">
          <optgroup label="화면 이미지"><option value="frame_en|">화면 전체</option>${used.map((s) => `<option value="frame_en|${s.shot}">${esc(s.name)}</option>`).join("")}</optgroup>
          <optgroup label="말하는 영상"><option value="motion_en|">영상 전체</option>${cs.map((c, i) => `<option value="motion_en|${c.id}">${i + 1}번 영상</option>`).join("")}</optgroup></select>
          <button class="btn btn--ghost btn--sm" type="button" data-rarefine>다듬기</button>${r.refine_note ? `<span class="small muted">${esc(r.refine_note)}</span>` : ""}</div>
      </details>` : `<p class="muted small" style="margin:0">${cs.length ? "[프롬프트 쓰기]를 누르면 화면 이미지·영상 프롬프트가 생깁니다 (1~3분)." : "② 에서 대본을 먼저 쓰세요."}</p>`}
      ${stale ? `<p class="small vm-over" style="margin:0">목소리 방식(③)이 프롬프트를 쓸 때와 다릅니다 — [프롬프트 다시 쓰기]를 누르세요. 화면 이미지는 그대로 씁니다.</p>` : ""}
      ${r.prompt_notes ? `<details class="ra-more"><summary>Claude 메모</summary><p class="small">${esc(r.prompt_notes)}</p></details>` : ""}
    </div>
    ${any ? `<div class="ra-card"><div class="ra-card__t">① 화면 이미지 ${used.length}장 <span class="muted small">— 영상들이 나눠 씁니다. 기준 화면을 먼저 만들면 나머지가 같은 스튜디오·조명으로 맞춰집니다</span></div>
      <div class="ra-shots">${used.map(shotCard).join("")}</div></div>
    <div class="ra-sec">② 말하는 영상 ${cs.length}개</div>
    ${cs.map(clipCard).join("")}` : ""}
    ${nav(4)}`;
}
// 6 완성
function pDone() {
  const r = st.r, sc = r.scenes || {}, cs = r.clips || [], vids = cs.filter((c) => sc[c.id]?.video).length;
  return `${head(6, "완성", "영상을 길이에 맞춰 이어 붙이고 목소리를 얹습니다. 영상이 없는 컷은 화면 이미지(없으면 진행자 사진) 정지 화면으로 채웁니다.")}
    <div class="ra-card">
      ${planBar(r)}
      <div class="ra-row"><span class="small">말하는 영상 <b>${vids}/${cs.length}</b>개 준비됨</span><span class="ra-grow"></span>
        <button class="btn btn--primary" type="button" data-rajob="render" ${(native(r) ? cs.length : r.track) ? "" : "disabled"}>mp4 합치기</button></div>
      ${native(r) ? `<p class="small muted" style="margin:0">영상 모델 목소리 — 영상마다 그 영상의 소리를 그대로 이어 붙입니다. 자막 시간은 어림입니다.</p>` : ""}
      ${r.out ? `<div class="ra-final"><video class="ra-out" src="${fu(r.out)}?v=${encodeURIComponent(r.updated_at)}" controls playsinline></video>
        <div class="ra-col"><a class="btn btn--primary" href="${fu(r.out)}" download="${esc(r.title || r.id)}.mp4">mp4 받기</a><a class="btn btn--ghost" href="/api/radios/${r.id}/srt" download="${esc(r.title || r.id)}.srt">자막 SRT 받기</a></div></div>`
        : `<a class="ra-link" href="/api/radios/${r.id}/srt" download="${esc(r.title || r.id)}.srt">자막 SRT 받기</a>`}
    </div>${nav(5)}`;
}

// 리소스에서 불러오기 — target: cast|i · prop|pid · new(새 배경·소품으로 추가)
function openRes(target, kind) {
  st.resTarget = target; st.resKind = kind;
  $("#raResTitle").textContent = target.startsWith("cast") ? "등장인물 — 리소스에서 불러오기" : target.startsWith("new") ? "배경·소품 추가 — 리소스에서 불러오기" : "배경·소품 — 리소스에서 불러오기";
  renderRes(); $("#raResDialog").showModal();
}
function renderRes() {
  $("#raResKinds").innerHTML = RES_KINDS.map(([k, n]) => `<button type="button" class="seg__btn ${st.resKind === k ? "is-on" : ""}" data-raresk="${k}">${n} <span class="muted">${st.res.filter((x) => x.kind === k && resImg(x)).length}</span></button>`).join("");
  const list = st.res.filter((x) => x.kind === st.resKind && resImg(x));
  $("#raResGrid").innerHTML = list.map((x) => `<button type="button" class="po-pick__item" data-rarespick="${esc(x.kind)}|${esc(x.id)}"><img src="${resImg(x)}" alt="" loading="lazy">
    <span>${esc(x.name)}</span><small>${esc(x.description || Object.values(x.attrs || {}).filter(Boolean).join(" · "))}</small></button>`).join("")
    || `<p class="muted">사진이 있는 ${esc(RES_KINDS.find(([k]) => k === st.resKind)?.[1] || "")} 리소스가 없습니다. 오른쪽 위 [리소스 관리 ↗]에서 등록하세요.</p>`;
}
const resDesc = (x) => x.description || Object.values(x.attrs || {}).filter((v) => v && String(v).length < 60).join(", ");
async function pickRes(kind, rid) {
  const x = st.res.find((y) => y.kind === kind && y.id === rid); if (!x) return;
  await saveNow();
  const [what, key] = st.resTarget.split("|"), r = st.r;
  try {
    if (what === "cast") {
      const i = Number(key), c = r.cast[i];
      st.r = await api(`/api/radios/${r.id}`, { method: "PUT", body: { cast: r.cast.map((y, k) => (k === i ? { ...y, name: /^진행자 [AB]$/.test(y.name) ? x.name : y.name, desc: y.desc || resDesc(x) } : y)) } });
      st.r = await api(`/api/radios/${r.id}/cast-photo`, { method: "POST", body: { i, resource: { kind, id: rid } } });
      void c;
    } else {
      let pid = key;
      if (what === "new") { // 새 배경·소품 칸을 만들고 그 칸에 넣는다
        const before = new Set((r.props || []).map((y) => y.id));
        st.r = await api(`/api/radios/${r.id}`, { method: "PUT", body: { props: [...(r.props || []), { kind: kind === "background" ? "배경" : "소품", name: x.name, desc: resDesc(x) }] } });
        pid = st.r.props.find((y) => !before.has(y.id))?.id;
      } else {
        st.r = await api(`/api/radios/${r.id}`, { method: "PUT", body: { props: r.props.map((y) => (y.id === pid ? { ...y, name: /^새 (배경|소품)$/.test(y.name) ? x.name : y.name, desc: y.desc || resDesc(x) } : y)) } });
      }
      st.r = await api(`/api/radios/${r.id}/cast-photo`, { method: "POST", body: { pid, resource: { kind, id: rid } } });
    }
    $("#raResDialog").close(); render(); toast(`리소스 "${x.name}" 을 넣었습니다`);
  } catch (err) { toast(err.message, true); }
}

// 단계 줄은 위에 붙어 있는 머리(헤더·경로 줄) 바로 아래에 붙인다 — 머리 높이가 바뀌어도 겹치지 않게
// 머리가 스크롤에 따라 숨거나 나타나도 맞도록, 지금 화면에 보이는 머리의 아래 끝을 잰다
function stickSteps() {
  const h = [...document.querySelectorAll("body > header, #crumbs")].filter((e) => !e.hidden && ["sticky", "fixed"].includes(getComputedStyle(e).position))
    .reduce((m, e) => Math.max(m, Math.round(e.getBoundingClientRect().bottom)), 0);
  const el = $("#raSteps"); if (el.style.top !== `${Math.max(0, h)}px`) el.style.top = `${Math.max(0, h)}px`;
}
function render() {
  stickSteps();
  const r = st.r, v = r ? Math.min(st.step, STEPS.length - 1) : 0;
  $("#raPick").innerHTML = `<option value="">＋ 새로 만들기</option>` + st.list.map((x) => `<option value="${x.id}" ${x.id === r?.id ? "selected" : ""}>${esc(x.title || x.topic || "빈 작업")}</option>`).join("");
  $("#raSteps").innerHTML = STEPS.map((n, i) => `<li><button type="button" class="st-step ${r && i === v ? "is-on" : ""} ${done(i) && i !== v ? "is-done" : ""}" data-rastep="${i}" ${r ? "" : "disabled"}><b>${done(i) && i !== v ? "✓" : i + 1}</b>${n}</button></li>`).join("");
  $("#raPanel").innerHTML = r ? [pPlan, pScript, pCast, pVoice, pScene, pDone][v]() : s0();
}
async function load(id) {
  st.list = await api("/api/radios");
  $("#raCount").textContent = st.list.length ? `${st.list.length}` : "";
  st.r = id ? await api(`/api/radios/${id}`).catch(() => null) : null;
  render(); renderList();
}
function renderList() {
  // 카드: 제목(없으면 주제·"빈 작업") · 만든 시각 · 어디까지 했는지 · 영상 개수
  const stage = (x) => x.out ? "완성" : Object.values(x.scenes || {}).some((v) => v.video) ? "영상 만드는 중" : Object.values(x.scenes || {}).some((v) => v.frame_en) ? "장면 프롬프트까지" : x.track ? "목소리까지" : x.lines?.length ? "대본까지" : x.topic ? "기획까지" : "시작만 함";
  const when = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#raGrid").innerHTML = st.list.map((x) => `<article class="cl-card ${!x.topic && !x.lines?.length ? "is-empty" : ""}"><a class="cl-card__media" href="#radio/${x.id}">${x.cast?.[0]?.photo ? `<img src="/data/_radios/${x.id}/${x.cast[0].photo}" alt="" loading="lazy">` : `<span class="cl-card__ph">라디오</span>`}<span class="cl-card__state">${stage(x)}</span></a>
    <div class="cl-card__body"><strong class="cl-card__title">${esc(x.title || x.topic || "빈 작업 (주제 없음)")}</strong>
      <p class="muted small" style="margin:0">${when(x.updated_at || x.created_at)} 고침 · ${esc(x.cast?.map((c) => c.name).join(", ") || "")}</p>
      <p class="muted small" style="margin:0">진행자 ${x.cast?.length || 1}명 · 대사 ${x.lines?.length || 0}줄${x.clips?.length ? ` · 영상 ${x.clips.length}개` : ""}</p>
    <div class="ex__row"><a class="btn btn--ghost btn--sm" href="#radio/${x.id}">열기</a>${x.out ? `<a class="btn btn--ghost btn--sm" href="/data/_radios/${x.id}/${x.out}" download>mp4</a>` : ""}<button class="btn btn--ghost btn--sm" type="button" data-radel="${x.id}">지우기</button></div></div></article>`).join("") || `<p class="muted cl-empty">아직 만든 인물 라디오가 없습니다.</p>`;
}

// 고친 것 저장 — 지금 화면에 있는 칸만 보낸다
let saveT = 0;
function saveSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 600);
}
async function saveNow() {
  clearTimeout(saveT);
  const r = st.r; if (!r) return;
  const body = {};
  if ($('[data-raf="topic"]')) body.topic = $('[data-raf="topic"]').value;
  if ($('[data-raf="title"]')) body.title = $('[data-raf="title"]').value;
  if ($('[data-rapl="target"]')) body.plan = { ...Object.fromEntries([...document.querySelectorAll("[data-rapl]")].map((x) => [x.dataset.rapl, x.value])), kitId: st.r.plan?.kitId || "" };
  if (document.querySelector("[data-rac]")) body.cast = r.cast.map((c, i) => ({ name: $(`[data-rac="name"][data-i="${i}"]`)?.value ?? c.name, desc: $(`[data-rac="desc"][data-i="${i}"]`)?.value ?? c.desc, voice: $(`[data-rac="voice"][data-i="${i}"]`)?.value ?? c.voice, voice_desc: $(`[data-rac="voice_desc"][data-i="${i}"]`)?.value ?? c.voice_desc, color: $(`[data-rac="color"][data-i="${i}"]`)?.value ?? c.color }));
  if ($('[data-rasrc="text"]')) body.sources = { links: $('[data-rasrc="links"]').value.split(/\s+/).filter(Boolean), text: $('[data-rasrc="text"]').value };
  if (st.step === 2) body.props = [...document.querySelectorAll("[data-rapid]")].map((d) => ({ id: d.dataset.rapid, kind: d.dataset.kind, name: d.querySelector('[data-rap="name"]').value, desc: d.querySelector('[data-rap="desc"]').value }));
  if (st.step === 1 && (document.querySelector(".ra-line[data-ran]") || st.linesDirty)) body.lines = [...document.querySelectorAll(".ra-line[data-ran]")].map((li) => ({ n: Number(li.dataset.ran), speaker: Number(li.querySelector('[data-ral="speaker"]').value), shot: Number(li.querySelector('[data-ral="shot"]')?.value || 1), text: li.querySelector('[data-ral="text"]').value, gesture: li.querySelector('[data-ral="gesture"]').value }));
  if (st.step === 4) { // 프롬프트 직접 고친 것 — 화면 이미지(frame_en) · 영상(motion_en)
    body.shots = Object.fromEntries([...document.querySelectorAll("[data-rashot]")].map((d) => [d.dataset.rashot, { frame_en: d.querySelector('[data-rapr="frame_en"]')?.value }]).filter(([, x]) => x.frame_en !== undefined));
    body.scenes = Object.fromEntries([...document.querySelectorAll("[data-rasn]")].map((d) => [d.dataset.rasn, { motion_en: d.querySelector('[data-rapr="motion_en"]')?.value }]).filter(([, x]) => x.motion_en !== undefined));
  }
  st.linesDirty = false;
  try { st.r = await api(`/api/radios/${r.id}`, { method: "PUT", body }); } catch (e) { toast(e.message, true); }
}

function bind() {
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "log" && st.waiting) status(e.message);
    if (e.type !== "job" || e.state === "start") return;
    const mine = e.kind === "radio" || (e.kind === "hf" && e.result?.type === "radio");
    if (!mine) return;
    st.waiting = false; status("");
    if (e.state === "error") return toast(e.message, true);
    toast(e.kind === "hf" ? (e.result?.field === "video" ? "말하는 영상이 들어왔습니다" : "화면 이미지가 들어왔습니다") : e.message.replace(/^완료: /, "") + " 완료");
    if (st.r && e.result?.id === st.r.id) load(st.r.id);
  });
  let raf = 0;
  const restick = () => { if ($("#radioView").hidden || raf) return; raf = requestAnimationFrame(() => { raf = 0; stickSteps(); }); };
  window.addEventListener("resize", restick);
  window.addEventListener("scroll", restick, { passive: true });
  document.addEventListener("transitionend", (e) => { if (e.target.closest?.("body > header, #crumbs")) restick(); });
  $("#raPick").addEventListener("change", (e) => { location.hash = e.target.value ? `#radio/${e.target.value}` : "#radio"; });
  $("#raResClose").addEventListener("click", () => $("#raResDialog").close());
  $("#raResDialog").addEventListener("click", (e) => {
    const k = e.target.closest("[data-raresk]"); if (k) { st.resKind = k.dataset.raresk; return renderRes(); }
    const p = e.target.closest("[data-rarespick]"); if (p) { const [kind, id] = p.dataset.rarespick.split("|"); pickRes(kind, id); }
  });
  const view = $("#radioView");
  view.addEventListener("input", (e) => { if (e.target.closest("[data-raf], [data-rac], [data-ral], [data-rap], [data-rapr], [data-rapl], [data-rasrc]")) saveSoon(); });
  view.addEventListener("change", async (e) => {
    if (e.target.id === "raModel") { st.model = e.target.value; return render(); }
    if (e.target.id === "raKit") { // 브랜드 고르기 · 새로 만들기
      st.kitNew = e.target.value === "__new";
      if (!st.kitNew) { await saveNow(); st.r = await api(`/api/radios/${st.r.id}`, { method: "PUT", body: { plan: { ...(st.r.plan || {}), kitId: e.target.value } } }); }
      return render();
    }
    if (e.target.closest("[data-rac], [data-ral], [data-rap]")) return saveSoon();
    const ph = e.target.closest("[data-raphoto]"), pp = e.target.closest("[data-rapropphoto]"), rs = e.target.closest("[data-raphotores]"), scn = e.target.closest("[data-rascene]");
    try {
      if ((ph || pp) && e.target.files[0]) { await saveNow(); st.r = await api(`/api/radios/${st.r.id}/cast-photo`, { method: "POST", body: { ...(ph ? { i: Number(ph.dataset.raphoto) } : { pid: pp.dataset.rapropphoto }), token: await upload(e.target.files[0]) } }); render(); toast("사진을 넣었습니다"); }
      if (rs && rs.value) { await saveNow(); st.r = await api(`/api/radios/${st.r.id}/cast-photo`, { method: "POST", body: { i: Number(rs.dataset.raphotores), resource: { kind: "person", id: rs.value } } }); render(); toast("리소스 인물 사진을 넣었습니다"); }
      if (scn && scn.files[0]) { const [n, field] = scn.dataset.rascene.split("|"); st.r = await api(`/api/radios/${st.r.id}/scene`, { method: "POST", body: { n, field, token: await upload(scn.files[0]) } }); render(); toast("넣었습니다"); }
    } catch (err) { toast(err.message, true); }
  });
  view.addEventListener("click", async (e) => {
    const stp = e.target.closest("[data-rastep]");
    if (stp && !stp.disabled) { // 단계 이동: 단계 줄 바로 아래(새 단계 머리)로 올린다 — 페이지 맨 위까지 튀지 않게
      await saveNow(); st.step = Number(stp.dataset.rastep); render();
      const y = $("#raSteps").getBoundingClientRect().top + scrollY - (parseFloat($("#raSteps").style.top) || 0) - 8;
      return window.scrollTo({ top: Math.min(scrollY, y), behavior: "smooth" });
    }
    if (e.target.closest("[data-racreate]")) {
      try { const r = await api("/api/radios", { method: "POST", body: { cast: st.castN, set: st.pickSet } }); st.goStep = 0; st.pickSet = ""; location.hash = `#radio/${r.id}`; } catch (err) { toast(err.message, true); }
      return;
    }
    const sp = e.target.closest("[data-raset]"); if (sp) { st.pickSet = sp.dataset.raset === st.pickSet ? "" : sp.dataset.raset; return render(); }
    const sd = e.target.closest("[data-rasetdel]");
    if (sd) {
      const x = st.sets.find((y) => y.id === sd.dataset.rasetdel);
      if (!confirm(`출연 세트 "${x?.name}" 을(를) 지울까요? 이 세트로 만든 작업은 그대로 남습니다.`)) return;
      try { await api(`/api/radio-sets/${sd.dataset.rasetdel}`, { method: "DELETE" }); if (st.pickSet === sd.dataset.rasetdel) st.pickSet = ""; st.sets = await api("/api/radio-sets"); render(); toast("세트를 지웠습니다"); } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest("[data-rasetsave]")) {
      const name = $("#raSetName").value.trim(); if (!name) return toast("세트 이름을 적으세요", true);
      if (st.sets.some((x) => x.name === name) && st.r.set?.name !== name && !confirm(`"${name}" 세트가 이미 있습니다. 덮어쓸까요?`)) return;
      await saveNow();
      try { const o = await api(`/api/radios/${st.r.id}/save-set`, { method: "POST", body: { name } }); st.sets = await api("/api/radio-sets"); st.r = await api(`/api/radios/${st.r.id}`); render(); toast(o.overwritten ? `"${name}" 세트를 덮어썼습니다` : `"${name}" 세트로 저장했습니다`); } catch (err) { toast(err.message, true); }
      return;
    }
    const vt = e.target.closest("[data-ravoicetest]");
    if (vt) { // 고른 목소리 들어 보기 — 리소스 목소리 화면과 같은 미리듣기
      const v = $(`[data-rac="voice"][data-i="${vt.dataset.ravoicetest}"]`).value;
      vt.disabled = true; vt.textContent = "…";
      try { const o = await api("/api/radio-voice-preview", { method: "POST", body: { voice: v } }); st.audio?.pause(); st.audio = new Audio(o.url); st.audio.play(); }
      catch (err) { toast(err.message, true); }
      vt.disabled = false; vt.textContent = "▶"; return;
    }
    const ch = e.target.closest("[data-rachip]");
    if (ch) { // 고르기 칩: 시작 진행자 수 · 진행자 수 바꾸기 · 목적 · 길이 · 영상 하나 최대 길이
      const [k, v] = ch.dataset.rachip.split("|");
      if (k === "castN") { st.castN = Number(v); return render(); }
      if (k === "cast" && Number(v) === st.r.cast.length) return;
      if (k === "cast" && Number(v) === 1 && !confirm(`${st.r.cast[1].name} 을(를) 빼고 혼자 말하기로 바꿀까요? 그 사람 대사는 남은 진행자가 맡고 다시 읽혀야 합니다. 화면 이미지·영상 프롬프트도 새로 써야 합니다.`)) return;
      await saveNow();
      const body = k === "goal" ? { plan: { ...(st.r.plan || {}), goal: v } } : k === "cast" ? { castN: Number(v) } : k === "vmode" ? { voice_mode: v } : { [k]: Number(v) };
      try { st.r = await api(`/api/radios/${st.r.id}`, { method: "PUT", body }); } catch (err) { toast(err.message, true); }
      return render();
    }
    const pl = e.target.closest("[data-raplay]");
    if (pl) { // 짧은 음성 듣기 (다시 누르면 멈춤)
      if (st.audio && !st.audio.paused && st.audio.dataset.src === pl.dataset.raplay) { st.audio.pause(); pl.textContent = "▶"; return; }
      st.audio?.pause(); document.querySelectorAll("[data-raplay]").forEach((b) => (b.textContent = "▶"));
      st.audio = new Audio(pl.dataset.raplay); st.audio.dataset.src = pl.dataset.raplay; pl.textContent = "■";
      st.audio.onended = () => (pl.textContent = "▶"); st.audio.play().catch(() => (pl.textContent = "▶"));
      return;
    }
    const rb = e.target.closest("[data-rares]"); if (rb) { const [what, key, kind] = rb.dataset.rares.split("|"); await saveNow(); return openRes(`${what}|${key}`, kind); }
    const kf = e.target.closest("[data-rakitfill]");
    if (kf) {
      const url = $("#raKitUrl").value.trim(); if (!/^https?:\/\//.test(url)) return toast("https:// 로 시작하는 주소를 넣으세요", true);
      kf.disabled = true; kf.textContent = "읽는 중… (1~2분)";
      try {
        const j = await api("/api/kits/autofill", { method: "POST", body: { url, name: $("#raKitName")?.value || "" } });
        document.querySelectorAll("#raKitProfile [data-kp]").forEach((x) => { if (j[x.dataset.kp] && !x.value.trim()) x.value = j[x.dataset.kp]; });
        if ($("#raKitName") && !$("#raKitName").value.trim() && j.name) $("#raKitName").value = j.name;
        toast(`채웠습니다 — 읽은 곳 ${(j.sources || []).length}개. 확인하고 저장하세요`);
      } catch (err) { toast(err.message, true); }
      kf.disabled = false; kf.textContent = "링크로 채우기"; return;
    }
    if (e.target.closest("[data-rakitsave]")) {
      const profile = Object.fromEntries([...document.querySelectorAll("#raKitProfile [data-kp]")].map((x) => [x.dataset.kp, x.value]));
      try {
        const cur = st.kits.find((k) => k.id === st.r.plan?.kitId);
        const k = st.kitNew ? await api("/api/kits", { method: "POST", body: { name: $("#raKitName").value || "새 브랜드", profile } }) : await api(`/api/kits/${cur.id}`, { method: "PUT", body: { name: cur.name, profile } });
        st.kits = await api("/api/kits"); st.kitNew = false;
        await saveNow(); st.r = await api(`/api/radios/${st.r.id}`, { method: "PUT", body: { plan: { ...(st.r.plan || {}), kitId: k.id } } });
        render(); toast("브랜드 정보를 저장했습니다");
      } catch (err) { toast(err.message, true); }
      return;
    }
    const pa = e.target.closest("[data-rapropadd]");
    if (pa) { await saveNow(); st.r = await api(`/api/radios/${st.r.id}`, { method: "PUT", body: { props: [...(st.r.props || []), { kind: pa.dataset.rapropadd, name: pa.dataset.rapropadd === "배경" ? "새 배경" : "새 소품", desc: "" }] } }); return render(); }
    const pd = e.target.closest("[data-rapropdel]"); if (pd) { pd.closest("[data-rapid]").remove(); return saveNow().then(render); }
    if (e.target.closest("[data-raideas]")) {
      await saveNow();
      const b = e.target.closest("[data-raideas]"); b.disabled = true; b.textContent = "기획하는 중… (1분 안팎)";
      try { const r = await api(`/api/radios/${st.r.id}/topics`, { method: "POST", body: { note: $("#raTopicNote").value } }); st.ideas = { id: st.r.id, list: r.ideas || [], format: r.format || [] }; render(); }
      catch (err) { toast(err.message, true); b.disabled = false; b.textContent = "주제 기획하기"; }
      return;
    }
    const idea = e.target.closest("[data-raidea]");
    if (idea) { // 주제 + 구간별 뼈대를 함께 저장 — 대본이 그 뼈대를 따른다
      const x = st.ideas.list[Number(idea.dataset.raidea)];
      $('[data-raf="topic"]').value = x.topic; await saveNow();
      st.r = await api(`/api/radios/${st.r.id}`, { method: "PUT", body: { brief: { topic: x.topic, angle: x.angle, hook: x.hook, skeleton: x.skeleton || [] } } });
      render(); return toast("기획을 골랐습니다 — 대본이 이 뼈대를 따릅니다");
    }
    if (e.target.closest("[data-rabriefx]")) { st.r = await api(`/api/radios/${st.r.id}`, { method: "PUT", body: { brief: null } }); return render(); }
    if (e.target.closest("[data-rarefine]")) {
      const instruction = $("#raRefine").value.trim(); if (!instruction) return toast("어떻게 다듬을지 적으세요", true);
      await saveNow();
      const [field, n] = $("#raRefineTo").value.split("|");
      try { await api(`/api/radios/${st.r.id}/refine`, { method: "POST", body: { instruction, field, n: n || null } }); st.waiting = true; status("다듬는 중…"); }
      catch (err) { toast(err.message, true); }
      return;
    }
    const jb = e.target.closest("[data-rajob]");
    if (jb) {
      const k = jb.dataset.rajob;
      if (k === "script" && st.r.lines.length && !confirm("대본을 다시 쓰면 지금 대사·음성·프롬프트·장면이 지워집니다. 계속할까요?")) return;
      if (k === "prompts" && Object.keys(st.r.scenes || {}).length && !confirm("프롬프트를 다시 쓰면 고친 프롬프트가 바뀝니다 (만든 화면 이미지·영상은 남습니다). 계속할까요?")) return;
      await saveNow();
      try { await api(`/api/radios/${st.r.id}/${k}`, { method: "POST" }); st.waiting = true; status("작업 중…"); toast("시작했습니다"); } catch (err) { toast(err.message, true); }
      return;
    }
    const rv = e.target.closest("[data-rarevoice]");
    if (rv) { await saveNow(); try { await api(`/api/radios/${st.r.id}/revoice`, { method: "POST", body: { n: Number(rv.dataset.rarevoice) } }); st.waiting = true; status("다시 읽히는 중…"); } catch (err) { toast(err.message, true); } return; }
    if (e.target.closest("[data-raladd]")) { st.r.lines.push({ n: Date.now(), speaker: 0, text: "새 대사", shot: st.r.cast.length === 2 ? 2 : 1, gesture: "" }); render(); return saveSoon(); }
    const ld = e.target.closest("[data-raldel]"); if (ld) { ld.closest(".ra-line").remove(); st.linesDirty = true; return saveSoon(); }
    const del = e.target.closest("[data-radel]");
    if (del) { if (!confirm("이 인물 라디오를 지울까요? 만든 음성·영상도 같이 지워집니다.")) return; await api(`/api/radios/${del.dataset.radel}`, { method: "DELETE" }); if (st.r?.id === del.dataset.radel) st.r = null; return load(st.r?.id); }
  });
}

function setView(v) {
  $("#raMakeView").hidden = v !== "make"; $("#raListView").hidden = v !== "list";
  document.querySelectorAll("#raTabs .subtabs__item").forEach((a) => { const on = a.dataset.v === v; a.classList.toggle("is-on", on); a.setAttribute("aria-selected", on); });
}

window.radio = {
  async open(sub = "") {
    if (!st.bound) { bind(); st.bound = true; }
    setView(sub === "list" ? "list" : "make");
    [st.sets, st.voices, st.res, st.kits, st.kitProfile] = await Promise.all([
      api("/api/radio-sets").catch(() => []), api("/api/voice/choices").catch(() => []), api("/api/resources").catch(() => []),
      api("/api/kits").catch(() => []), api("/api/kit-profile").catch(() => []),
    ]);
    const id = /^ra_\d+$/.test(sub) ? sub : "", changed = id !== st.r?.id;
    if (!id) { st.r = null; st.step = 0; }
    await load(id).catch((e) => toast(e.message, true));
    if (id && changed) { // 다른 작업을 열면 아직 안 끝난 단계부터 (방금 만들었으면 ①)
      const i = st.goStep ?? [0, 1, 2, 3, 4, 5].find((k) => !done(k)); st.goStep = null; st.step = i ?? 5; render();
    }
  },
  close() {},
};
