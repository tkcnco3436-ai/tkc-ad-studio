// 이미지 한 부분 고르기 창 — 영상 복제(시트에서 얼굴 잘라 넣기) · 리소스(시트에서 얼굴 잘라 저장)가 같이 쓴다
//   const box = await window.pickCrop(src, { title, square: true })  → { x, y, w, h } (이미지 대비 %) · 취소하면 null
const $ = (s) => document.querySelector(s);
let done = null, start = null, box = null, square = false;

function ensure() {
  if ($("#cropDlg")) return;
  document.body.insertAdjacentHTML("beforeend", `<dialog id="cropDlg" class="detail cropdlg">
    <div class="detail__bar"><strong id="cropTitle">잘라 낼 부분 고르기</strong>
      <div class="row"><button class="btn btn--ghost btn--sm" type="button" id="cropCancel" autofocus>취소</button><button class="btn btn--primary btn--sm" type="button" id="cropOk" disabled>이 부분 쓰기</button></div></div>
    <p class="small muted cropdlg__hint">이미지 위에서 끌어서 네모를 그리세요. 얼굴은 이마부터 턱까지 넉넉하게 잡으면 좋습니다.</p>
    <div class="cropdlg__stage" id="cropStage"><img id="cropImg" alt="" draggable="false"><span class="cropdlg__box" id="cropBox" hidden></span></div>
  </dialog>`);
  const stage = $("#cropStage"), dlg = $("#cropDlg");
  const pt = (e) => { const r = $("#cropImg").getBoundingClientRect(); const t = e.touches?.[0] || e; return { x: Math.max(0, Math.min(100, ((t.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((t.clientY - r.top) / r.height) * 100)), r }; };
  const draw = () => { const b = $("#cropBox"); if (!box) { b.hidden = true; return; } b.hidden = false; Object.assign(b.style, { left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }); $("#cropOk").disabled = box.w < 2 || box.h < 2; };
  const down = (e) => { e.preventDefault(); start = pt(e); box = { x: start.x, y: start.y, w: 0, h: 0 }; draw(); };
  const move = (e) => {
    if (!start) return; e.preventDefault();
    const p = pt(e); let w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    if (square) { const ratio = p.r.width / p.r.height; const side = Math.max(w, h * (1 / ratio)); w = side; h = side * ratio; } // 화면상 정사각
    box = { x: Math.min(start.x, p.x < start.x ? start.x - w : start.x), y: Math.min(start.y, p.y < start.y ? start.y - h : start.y), w, h };
    box.w = Math.min(box.w, 100 - box.x); box.h = Math.min(box.h, 100 - box.y); draw();
  };
  const up = () => { start = null; };
  stage.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  stage.addEventListener("touchstart", down, { passive: false }); window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
  const finish = (v) => { const f = done; done = null; if (dlg.open) dlg.close(); f?.(v); };
  $("#cropCancel").addEventListener("click", () => finish(null));
  $("#cropOk").addEventListener("click", () => finish(box && { x: +box.x.toFixed(2), y: +box.y.toFixed(2), w: +box.w.toFixed(2), h: +box.h.toFixed(2) }));
  dlg.addEventListener("close", () => done && finish(null));
}

window.pickCrop = (src, { title = "잘라 낼 부분 고르기", square: sq = true } = {}) => {
  ensure();
  square = sq; box = null; start = null;
  $("#cropTitle").textContent = title; $("#cropImg").src = src; $("#cropBox").hidden = true; $("#cropOk").disabled = true;
  $("#cropDlg").showModal();
  return new Promise((ok) => (done = ok));
};
