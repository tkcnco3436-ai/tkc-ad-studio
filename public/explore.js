// 처음 화면(탐색) — 큰 카드 배경 · 최근 모은 광고 · 내가 만든 것 (서버: lib/explore.js → /api/explore)
// 영상이 있는 카드는 마우스를 올리면 소리 없이 재생한다 (움직임 줄이기 설정이면 재생하지 않는다)
import { esc } from "./fields.js";

const $ = (s) => document.querySelector(s);
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const when = (iso) => {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso)) / 864e5;
  return d < 1 ? "오늘" : d < 2 ? "어제" : d < 30 ? `${Math.floor(d)}일 전` : new Date(iso).toLocaleDateString("ko-KR");
};

const media = (x, cls) => `<span class="${cls}">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : `<span class="xp-ph">${esc(x.kind)}</span>`}${x.video && !still ? `<video muted loop playsinline preload="none" data-src="${esc(x.video)}"></video>` : ""}</span>`;

function card(x, meta) {
  return `<a class="xp-card" href="${esc(x.href)}">${media(x, "xp-card__media")}<span class="xp-card__tag">${esc(x.kind)}</span>
    <strong class="xp-card__t">${esc(x.title || "제목 없음")}</strong><span class="xp-card__m">${esc(meta)}</span></a>`;
}

// 준비 안 된 것 — 필요한 프로그램 · Claude 연결 · 힉스필드 연결 · 저장 폴더 (마지막 [연결 확인] 결과 기준)
async function readiness() {
  const s = await fetch("/api/setup").then((r) => r.json()).catch(() => null);
  if (!s) return;
  const miss = [];
  const tools = s.tools.filter((t) => t.required && !t.ok).map((t) => t.label);
  if (tools.length) miss.push(`프로그램 ${tools.join("·")}`);
  if (!s.claude.installed) miss.push("Claude Code 설치");
  else if (!s.checks?.claude?.ok) miss.push("Claude 연결 확인");
  if (s.hf.mode === "api" ? !s.hf.hasKey : !s.checks?.hf?.ok) miss.push(s.hf.mode === "api" ? "힉스필드 API 키" : "힉스필드 연결 확인");
  if (!s.data.set) miss.push("저장 폴더");
  const el = $("#xpReady");
  el.hidden = !miss.length;
  if (miss.length) el.innerHTML = `<strong>준비 안 된 항목 ${miss.length}개</strong><span>${esc(miss.join(" · "))}</span><em>설정하기 ›</em>`;
}

async function open() {
  readiness();
  let d;
  try { d = await (await fetch("/api/explore")).json(); } catch { return; }
  // 큰 카드 배경: 가장 최근에 모은 영상 광고
  const v = d.ads.find((x) => x.video) || d.ads[0];
  $("#exHeroMedia").innerHTML = v ? (v.video && !still ? `<video muted loop playsinline autoplay src="${esc(v.video)}" poster="${esc(v.thumb)}"></video>` : `<img src="${esc(v.thumb)}" alt="">`) : "";
  $("#exAdCount").textContent = d.adTotal ? `${d.adTotal}개 중 최근 ${d.ads.length}개` : "";
  $("#exAds").innerHTML = d.ads.map((x) => card(x, `${x.brand} · ${when(x.at)}`)).join("")
    || `<p class="xp-empty">아직 모은 광고가 없어요. <a href="#collect">광고 수집</a>에서 계정이나 링크로 모아 보세요.</p>`;
  // 이미지 소재(포스터)는 일단 메뉴에서 뺐다
  const made = [...d.clones, ...d.dramas].sort((a, b) => b.at.localeCompare(a.at));
  $("#exMade").innerHTML = made.map((x) => card(x, `${when(x.at)} 수정`)).join("")
    || `<p class="xp-empty">아직 만든 것이 없어요. 위 카드에서 하나 골라 시작해 보세요.</p>`;
}

function bind() {
  const play = (e, on) => {
    const v = e.target.closest?.(".xp-card")?.querySelector("video");
    if (!v) return;
    if (on) { if (!v.src) v.src = v.dataset.src; v.classList.add("is-on"); v.play().catch(() => {}); }
    else { v.pause(); v.classList.remove("is-on"); }
  };
  $("#homeView").addEventListener("mouseover", (e) => play(e, true));
  $("#homeView").addEventListener("mouseout", (e) => { if (!e.relatedTarget || !e.target.closest(".xp-card")?.contains(e.relatedTarget)) play(e, false); });
}

let bound = false;
window.explorePage = {
  open() { if (!bound) { bind(); bound = true; } return open(); },
};
