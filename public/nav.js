// 화면 위 한 줄 길잡이 — [← 뒤로]  처음 › 메뉴 › 화면 › (그 화면 안에서 들어간 단계)
// 뒤로는 언제나 이 줄에서 한 칸 위로 간다 (브라우저 뒤로와 따로 놀지 않게 하나로).
//   window.nav.base([{ label, href }])  — 주소(#…)로 정해지는 칸. app.js 가 화면을 바꿀 때마다 부른다 (안쪽 칸은 지운다)
//   window.nav.sub([{ label, go }])     — 그 화면 안에서 들어간 칸 (리소스 → 인물 폴더 → 위저드 단계 …). go 는 그 칸으로 돌아가는 함수
const st = { base: [], sub: [] };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const bar = () => document.getElementById("crumbs");

function trail() { return [...st.base.map((x, i) => ({ ...x, kind: "base", i })), ...st.sub.map((x) => ({ ...x, kind: "sub" }))]; }
// 마지막 주소 칸과 첫 안쪽 칸은 같은 화면이다 (예: 리소스 관리 = 인물 목록) —
// 그래서 첫 안쪽 칸에서 뒤로는 한 칸 더 위로, 더 안쪽에서 그 주소 칸을 누르면 첫 안쪽 칸으로
function backIndex(t) { let i = t.length - 2; if (st.sub.length === 1 && i === st.base.length - 1) i -= 1; return i; }
function goTo(item) {
  if (!item) return;
  if (item.kind === "base" && st.sub.length && item.i === st.base.length - 1) return st.sub[0].go?.();
  if (item.kind === "sub") return item.go?.();
  if (item.href) { if (location.hash === item.href) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = item.href; }
}
function render() {
  const el = bar(); if (!el) return;
  const t = trail();
  el.hidden = t.length <= 1;
  if (el.hidden) return;
  const bi = backIndex(t);
  el.innerHTML = `<button class="crumbs__back" type="button" data-crumb="${bi}" title="${esc(t[bi]?.label)}(으)로">← 뒤로</button>
    <ol class="crumbs__list">${t.map((x, i) => `<li>${i < t.length - 1 ? `<button type="button" data-crumb="${i}">${esc(x.label)}</button>` : `<span aria-current="page">${esc(x.label)}</span>`}</li>`).join("")}</ol>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("#crumbs [data-crumb]"); if (!b) return;
  goTo(trail()[Number(b.dataset.crumb)]);
});

window.nav = {
  base(items) { st.base = items.filter((x) => x?.label); st.sub = []; render(); },
  sub(items) { st.sub = items.filter((x) => x?.label); render(); },
};
