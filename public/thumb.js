// 썸네일 (릴스 커버 9:16, 1080×1920) — 플레이어에 지금 보이는 장면을 배경으로 깔고 제목·부제를 얹어 PNG 로 받는다.
// 설명 영상(explainer.js)·팟캐스트(podcast.js)가 같이 쓴다. 모두 브라우저에서 그린다 (서버·비용 없음).
const TW = 1080, TH = 1920, PAD = 88;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif';

// 공백 기준으로 줄을 나누고, 한 단어가 너무 길면 글자 단위로 자른다. 직접 넣은 줄바꿈은 지킨다
function wrap(ctx, text, max) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (ctx.measureText(next.trimEnd()).width <= max) { line = next; continue; }
      if (line.trim()) out.push(line.trim());
      line = "";
      for (const ch of word.trimStart()) {
        if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ""; }
        line += ch;
      }
    }
    out.push(line.trim());
  }
  return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}

function draw(cv, bg, o) {
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, TW, TH);
  if (bg) {
    // 흐리게 할 때 가장자리가 비치지 않게 조금 크게 그린다
    const m = o.blur * 2;
    ctx.filter = o.blur ? `blur(${o.blur}px)` : "none";
    ctx.drawImage(bg, -m, -m, TW + m * 2, TH + m * 2);
    ctx.filter = "none";
  }
  // 글자 쪽을 어둡게 — 어떤 장면 위에서도 읽히게
  if (o.shade > 0) {
    const a = o.shade / 100, g = o.pos === "top" ? ctx.createLinearGradient(0, 0, 0, TH * 0.6)
      : o.pos === "bottom" ? ctx.createLinearGradient(0, TH, 0, TH * 0.4) : null;
    if (g) { g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; }
    else ctx.fillStyle = `rgba(0,0,0,${a * 0.6})`;
    ctx.fillRect(0, 0, TW, TH);
  }
  const size = o.size, lh = size * 1.18, sub = Math.round(size * 0.42), max = TW - PAD * 2;
  ctx.font = `800 ${size}px ${FONT}`;
  const lines = o.title.trim() ? wrap(ctx, o.title.trim(), o.style === "box" ? max - 48 : max) : [];
  const subH = o.sub.trim() ? sub * 1.6 : 0, blockH = subH + lines.length * lh;
  let y = o.pos === "top" ? PAD + 120 : o.pos === "bottom" ? TH - PAD - 160 - blockH : (TH - blockH) / 2;
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  if (subH) {
    ctx.font = `700 ${sub}px ${FONT}`;
    ctx.fillStyle = o.accent;
    ctx.fillText(o.sub.trim(), PAD, y);
    y += subH;
  }
  ctx.font = `800 ${size}px ${FONT}`;
  for (const l of lines) {
    if (o.style === "box" && l) {
      const w = ctx.measureText(l).width;
      ctx.fillStyle = o.accent; ctx.fillRect(PAD - 4, y - size * 0.06, w + 48, size * 1.14);
      ctx.fillStyle = o.color; ctx.fillText(l, PAD + 20, y);
    } else {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.04;
      ctx.fillStyle = o.color; ctx.fillText(l, PAD, y);
      ctx.restore();
    }
    y += lh;
  }
}

/**
 * 플레이어 아래에 "썸네일" 버튼과 편집 패널을 붙인다.
 * source: 플레이어 캔버스 · after: 패널을 넣을 자리(그 뒤) · get(): { key, title, sub, name } — key(프로젝트 id)가 바뀌면 제목을 다시 채운다
 */
export function mountThumb({ source, after, get }) {
  const id = `th${Math.random().toString(36).slice(2, 7)}`;
  after.insertAdjacentHTML("afterend", `
    <div class="ex__row"><button class="btn btn--ghost btn--sm" type="button" data-th-open>📸 지금 장면으로 썸네일</button>
      <span class="muted small">재생 위치를 원하는 장면에 두고 누르세요</span></div>
    <section class="panel stack th" id="${id}" hidden>
      <div class="ex__row"><h3 style="flex:1;margin:0">썸네일 · 릴스 커버 9:16</h3>
        <button class="btn btn--ghost btn--sm" type="button" data-th-close aria-label="닫기">✕</button></div>
      <canvas class="th__canvas" width="${TW}" height="${TH}"></canvas>
      <label class="field"><span>제목 (Enter 로 줄바꿈)</span><textarea data-th="title" rows="2"></textarea></label>
      <label class="field"><span>위 작은 글씨 (비우면 없음)</span><input data-th="sub"></label>
      <div class="ex-fields">
        <label class="ex-field"><span>위치</span><select data-th="pos"><option value="top">위</option><option value="center">가운데</option><option value="bottom" selected>아래</option></select></label>
        <label class="ex-field"><span>글자 모양</span><select data-th="style"><option value="shadow">그림자</option><option value="box">박스</option></select></label>
        <label class="ex-field"><span>글자색</span><input type="color" data-th="color" value="#ffffff"></label>
        <label class="ex-field"><span>강조색</span><input type="color" data-th="accent" value="#ff7a1a"></label>
        <label class="ex-field ex-field--range"><span>글자 크기</span><input type="range" data-th="size" min="64" max="160" value="108"><output></output></label>
        <label class="ex-field ex-field--range"><span>배경 흐리게</span><input type="range" data-th="blur" min="0" max="30" value="0"><output></output></label>
        <label class="ex-field ex-field--range"><span>배경 어둡게</span><input type="range" data-th="shade" min="0" max="90" value="60"><output></output></label>
      </div>
      <div class="ex__row">
        <button class="btn btn--ghost btn--sm" type="button" data-th-grab>지금 장면으로 배경 바꾸기</button>
        <button class="btn btn--primary btn--sm" type="button" data-th-save>PNG 받기</button>
      </div>
    </section>`);
  const box = document.getElementById(id), cv = box.querySelector("canvas");
  const f = (k) => box.querySelector(`[data-th="${k}"]`);
  let bg = null, key = null;
  const grab = () => { bg = document.createElement("canvas"); bg.width = source.width; bg.height = source.height; bg.getContext("2d").drawImage(source, 0, 0); };
  const opts = () => ({ title: f("title").value, sub: f("sub").value, pos: f("pos").value, style: f("style").value, color: f("color").value, accent: f("accent").value, size: Number(f("size").value), shade: Number(f("shade").value), blur: Number(f("blur").value) });
  const render = () => {
    box.querySelectorAll(".ex-field--range").forEach((r) => { r.querySelector("output").textContent = r.querySelector("input").value; });
    draw(cv, bg, opts());
  };
  const open = async () => {
    grab();
    const d = get();
    if (d.key !== key) { key = d.key; f("title").value = d.title || ""; f("sub").value = d.sub || ""; }
    box.hidden = false;
    await document.fonts?.load(`800 100px ${FONT}`).catch(() => {});
    render();
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  after.parentElement.querySelector("[data-th-open]").addEventListener("click", open);
  box.addEventListener("input", render);
  box.addEventListener("change", render);
  box.querySelector("[data-th-close]").addEventListener("click", () => { box.hidden = true; });
  box.querySelector("[data-th-grab]").addEventListener("click", () => { grab(); render(); });
  box.querySelector("[data-th-save]").addEventListener("click", () => {
    render();
    cv.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${(get().name || "thumbnail").replace(/[\\/:*?"<>|]/g, "_")}_썸네일.png`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  });
  return { open, close: () => { box.hidden = true; } };
}
