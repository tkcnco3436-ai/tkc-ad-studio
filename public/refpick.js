// 레퍼런스 고르기 창 — 이미지 소재(poster.js) · 이미지 변형(vary.js) 이 같이 쓴다
//   const picked = await window.pickReferences({ max: 4 })  → [{ id, file, name }] (취소하면 [])
import { esc } from "./fields.js";

const $ = (s) => document.querySelector(s);
const TAGS = ["스타일", "구도", "색감", "레이아웃", "타이포", "인물 연출", "제품 연출"];
let resolveFn = null, list = [], sel = new Map(), tag = "", max = 4;

function ensure() {
  if ($("#refPick")) return;
  document.body.insertAdjacentHTML("beforeend", `<dialog id="refPick" class="detail refpick">
    <div class="detail__bar"><strong>레퍼런스에서 고르기 <span class="muted small" id="refPickN"></span></strong>
      <div class="row"><a class="btn btn--ghost btn--sm" href="#ref" id="refPickGo">레퍼런스 관리 ↗</a><button class="btn btn--ghost btn--sm" type="button" id="refPickCancel" autofocus>취소</button><button class="btn btn--primary btn--sm" type="button" id="refPickOk">넣기</button></div></div>
    <div class="refpick__bar"><div class="seg seg--sm" id="refPickTags"></div></div>
    <div class="refpick__grid" id="refPickGrid"></div>
  </dialog>`);
  const d = $("#refPick");
  const done = (out) => { const f = resolveFn; resolveFn = null; if (d.open) d.close(); f?.(out); };
  $("#refPickCancel").addEventListener("click", () => done([]));
  $("#refPickGo").addEventListener("click", () => done([]));
  d.addEventListener("close", () => resolveFn && done([]));
  $("#refPickOk").addEventListener("click", () => done([...sel.values()]));
  $("#refPickTags").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { tag = b.dataset.t; render(); } });
  $("#refPickGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    const r = list.find((x) => x.id === b.dataset.r), file = (r.files || []).find((f) => f.kind === "image")?.file;
    if (sel.has(r.id)) sel.delete(r.id);
    else if (sel.size >= max) return;
    else sel.set(r.id, { id: r.id, file, name: r.name });
    render();
  });
}
function render() {
  $("#refPickTags").innerHTML = [["", "전체"], ...TAGS.map((t) => [t, t])].map(([k, l]) => `<button type="button" class="seg__btn ${tag === k ? "is-on" : ""}" data-t="${esc(k)}">${esc(l)}</button>`).join("");
  const shown = list.filter((r) => !tag || (r.tags || []).includes(tag));
  $("#refPickN").textContent = `${sel.size}/${max} 고름`;
  $("#refPickOk").disabled = !sel.size;
  $("#refPickGrid").innerHTML = shown.map((r) => {
    const f = (r.files || []).find((x) => x.kind === "image")?.file;
    return `<button type="button" class="refpick__item ${sel.has(r.id) ? "is-on" : ""}" data-r="${r.id}">${f ? `<img src="/data/_resources/reference/${r.id}/${encodeURIComponent(f)}" alt="" loading="lazy">` : ""}<span>${esc(r.name)}</span>${(r.tags || []).length ? `<em>${esc(r.tags.join(" · "))}</em>` : ""}</button>`;
  }).join("") || `<p class="muted" style="padding:24px">${list.length ? "이 태그의 레퍼런스가 없습니다." : "아직 레퍼런스가 없습니다. 위의 [레퍼런스 관리]에서 올리세요."}</p>`;
}
window.pickReferences = async ({ max: m = 4 } = {}) => {
  ensure();
  max = m; sel = new Map(); tag = "";
  list = (await (await fetch("/api/resources?kind=reference")).json()).filter((r) => (r.files || []).some((f) => f.kind === "image"));
  render();
  $("#refPick").showModal();
  return new Promise((ok) => (resolveFn = ok));
};
