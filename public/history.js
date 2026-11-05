// 제작 기록 (#history) — 끝난 작업 목록. 날짜별로 묶고, 메뉴·실패만·이름으로 거른다 (서버: lib/history.js → /api/history)
// 작업이 끝나면(서버 이벤트) 열려 있는 동안 바로 새로 그린다
import { esc } from "./fields.js";

const $ = (s) => document.querySelector(s);
const MENU = { collect: "광고 수집", poster: "이미지 소재", clone: "영상 복제", drama: "릴스 제작하기", hf: "힉스필드 생성", tpl: "템플릿", res: "리소스", setup: "설정", etc: "기타" };
const st = { menu: "", bound: false, list: [] };
const dur = (ms) => (ms == null ? "" : ms < 60e3 ? `${Math.max(1, Math.round(ms / 1e3))}초` : `${Math.floor(ms / 60e3)}분 ${Math.round((ms % 60e3) / 1e3)}초`);
const day = (iso) => {
  const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.floor((t - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return diff <= 0 ? "오늘" : diff === 1 ? "어제" : d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
};
const time = (iso) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

function render() {
  const q = $("#hiQ").value.trim().toLowerCase(), errOnly = $("#hiErr").checked;
  const list = st.list.filter((r) => (!errOnly || r.state === "error") && (!q || `${r.label} ${r.error || ""}`.toLowerCase().includes(q)));
  const done = list.filter((r) => r.state === "done").length;
  $("#hiSum").textContent = list.length ? `${list.length}건 · 완료 ${done} · 실패 ${list.length - done}` : "";
  if (!list.length) {
    $("#hiList").innerHTML = `<p class="hi-empty">${st.list.length ? "조건에 맞는 기록이 없습니다." : "아직 기록이 없습니다. 수집하거나 소재를 만들면 여기에 쌓입니다. (이 기능을 넣은 뒤부터 기록됩니다)"}</p>`;
    return;
  }
  let cur = "", html = "";
  for (const r of list) {
    const d = day(r.at);
    if (d !== cur) { if (cur) html += "</ol>"; html += `<h3 class="hi-day">${esc(d)}</h3><ol class="hi-rows">`; cur = d; }
    const tag = r.link ? "a" : "div";
    html += `<li><${tag} class="hi-row ${r.state === "error" ? "is-err" : ""}" ${r.link ? `href="${esc(r.link)}"` : ""}>
      <time>${esc(time(r.at))}</time>
      <span class="hi-menu">${esc(MENU[r.menu] || r.menu)}</span>
      <span class="hi-label">${esc(r.label)}${r.error ? `<span class="hi-error">${esc(r.error)}</span>` : ""}</span>
      <span class="hi-state">${r.state === "done" ? "✓ 완료" : "✕ 실패"}</span>
      <span class="hi-dur">${esc(dur(r.ms))}</span>
      <span class="hi-go">${r.link ? "열기 ›" : ""}</span>
    </${tag}></li>`;
  }
  $("#hiList").innerHTML = html + "</ol>";
}

async function load() {
  try { st.list = await (await fetch(`/api/history${st.menu ? `?menu=${st.menu}` : ""}`)).json(); } catch { st.list = []; }
  render();
}

function bind() {
  $("#hiMenu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]"); if (!b) return;
    st.menu = b.dataset.menu;
    document.querySelectorAll("#hiMenu .seg__btn").forEach((x) => x.classList.toggle("is-on", x === b));
    load();
  });
  $("#hiErr").addEventListener("change", render);
  $("#hiQ").addEventListener("input", render);
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "job" && e.state !== "start" && !$("#historyView").hidden) setTimeout(load, 300);
  });
}

window.historyPage = {
  open() { if (!st.bound) { bind(); st.bound = true; } return load(); },
  close() {},
};
