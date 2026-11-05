// 3D 설명 영상 · 팟캐스트 릴스가 같이 쓰는 화면 조각
// 1) 필드 목록 → 입력 칸 (템플릿 커스텀 · 캐릭터 만들기)
//    필드 = { k, label, type: "color" | "range" | "select" | "check", def, min?, max?, step?, choices?: [[값, 이름]] }
// 2) 만든 콘텐츠 목록 (카드 그리드)
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const defaults = (fields) => Object.fromEntries(fields.map((f) => [f.k, f.def]));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function fieldsHTML(fields, vals = {}) {
  return fields.map((f) => {
    const v = vals[f.k] ?? f.def;
    const input = f.type === "select" ? `<select data-f="${f.k}">${f.choices.map(([k, n]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`
      : f.type === "check" ? `<input type="checkbox" data-f="${f.k}" ${v ? "checked" : ""}>`
      : f.type === "range" ? `<input type="range" data-f="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"><output>${v}</output>`
      : `<input type="color" data-f="${f.k}" value="${esc(v)}">`;
    return `<label class="ex-field ex-field--${f.type}"><span>${esc(f.label)}</span>${input}</label>`;
  }).join("");
}
export function readFields(root) {
  return Object.fromEntries([...root.querySelectorAll("[data-f]")].map((x) => [x.dataset.f, x.type === "checkbox" ? x.checked : x.type === "range" ? Number(x.value) : x.value]));
}

// 만든 콘텐츠 카드 그리드. item = 목록 API 한 줄 { id, title, topic, templateName, count, hasAudio, hasVideo, thumb, duration, updatedAt }
// opts = { base: "/data/_explainers", hash: "#explain", unit: "장면", icon: "🌐" }
export function contentGrid(items, { base, hash, unit, icon }) {
  if (!items.length) return `<p class="muted cl-empty">아직 만든 콘텐츠가 없습니다. "만들기" 탭에서 주제를 넣어 시작하세요.</p>`;
  return items.map((x) => {
    const v = encodeURIComponent(x.updatedAt || ""), dir = `${base}/${x.id}`;
    const media = x.thumb ? `<img src="${dir}/thumb.jpg?v=${v}" alt="" loading="lazy">` : `<span class="cl-card__ph" aria-hidden="true">${icon}</span>`;
    const video = x.hasVideo ? `<video muted loop playsinline preload="none" data-src="${dir}/out.mp4?v=${v}"></video>` : "";
    const date = x.updatedAt ? new Date(x.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "";
    return `<article class="cl-card" data-id="${x.id}">
      <a class="cl-card__media" href="${hash}/${x.id}" aria-label="${esc(x.title || x.topic)} 열기">${media}${video}
        ${x.duration ? `<span class="cl-card__dur">${fmt(x.duration)}</span>` : ""}
        <span class="cl-card__state">${x.hasVideo ? "mp4 완성" : x.hasAudio ? "음성까지" : x.count ? "대본만" : "새로 만듦"}</span>
      </a>
      <div class="cl-card__body">
        <strong class="cl-card__title">${esc(x.title || x.topic || x.id)}</strong>
        ${x.title && x.topic ? `<p class="muted small cl-card__topic">${esc(x.topic)}</p>` : ""}
        <p class="muted small">${esc(x.templateName || "")} · ${unit} ${x.count} · ${date}</p>
        <div class="ex__row">
          <a class="btn btn--ghost btn--sm" href="${hash}/${x.id}">열기</a>
          ${x.hasVideo ? `<a class="btn btn--ghost btn--sm" href="${dir}/out.mp4?v=${v}" download="${esc(x.title || x.id)}.mp4">mp4 받기</a>` : ""}
          <button class="btn btn--ghost btn--sm" type="button" data-del="${x.id}">지우기</button>
        </div>
      </div>
    </article>`;
  }).join("");
}
// 카드에 마우스를 올리면 영상이 소리 없이 돈다
export function bindGrid(grid, onDelete) {
  grid.addEventListener("mouseover", (e) => {
    const v = e.target.closest(".cl-card")?.querySelector("video"); if (!v || v.dataset.on) return;
    v.dataset.on = 1; if (!v.src) v.src = v.dataset.src; v.play().catch(() => {});
  });
  grid.addEventListener("mouseout", (e) => {
    const c = e.target.closest(".cl-card"); if (!c || c.contains(e.relatedTarget)) return;
    const v = c.querySelector("video"); if (v) { v.pause(); delete v.dataset.on; }
  });
  grid.addEventListener("click", (e) => { const b = e.target.closest("[data-del]"); if (b) onDelete(b.dataset.del); });
}

// 목소리 고르기 — 목소리 설정(리소스)에서 만든 목소리 · 복제 · 기본 목소리 + 맥 임시 음성(say)
let voiceCache = null;
export async function loadVoiceChoices(fresh = false) {
  if (!voiceCache || fresh) voiceCache = await fetch("/api/voice/choices").then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return voiceCache;
}
export function voiceOptions(choices, sayVoices, selected) {
  const opt = (id, name) => `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc(name)}</option>`;
  const groups = {};
  for (const c of choices || []) (groups[c.group] ||= []).push(opt(c.id, c.name));
  if (selected && !sayVoices.includes(selected) && !(choices || []).some((c) => c.id === selected)) (groups["저장한 목소리"] ||= []).unshift(opt(selected, "(지워진 목소리)"));
  return Object.entries(groups).map(([g, o]) => `<optgroup label="${esc(g)}">${o.join("")}</optgroup>`).join("")
    + `<optgroup label="맥 임시 음성 (say)">${sayVoices.map((v) => opt(v, v)).join("")}</optgroup>`;
}
