// 팟캐스트 릴스 — 낭독 대본을 캔버스 한 장으로 그린다. 화풍은 템플릿으로 고르고 템플릿마다 커스텀 칸이 있다.
//   전자책: 흰 종이 위 글 전체가 문서처럼 놓이고 읽는 위치를 따라 아래로 흘러간다
//   라디오 스튜디오: ON AIR · 진행자 동그라미 · 지금 대사 · 파형
// 매직 텍스트: 글자를 흐리게 깔고 읽는 만큼 짙게 채운다. 기본은 줄을 따라 부드럽게 쓸어 가는 채우기,
// 템플릿 칸에서 "단어마다"(MagicText 컴포넌트처럼 단어별로 0→1)로 바꿀 수 있다. 진행 기준은 스크롤 대신 음성 시각.
// 서버: lib/podcast.js · 주소: #podcast(만들기) · #podcast/list(만든 콘텐츠) · #podcast/pc_…(그 릴스 열기)
import { esc, defaults, fieldsHTML, readFields, contentGrid, bindGrid, loadVoiceChoices, voiceOptions } from "./fields.js";
import { mountThumb } from "./thumb.js";

const W = 720, H = 1280, FPS = 30, GAP = 0.32;
const SANS = "'Pretendard Variable', Pretendard, -apple-system, sans-serif";
const SERIF = "'AppleMyungjo', 'Nanum Myeongjo', 'Noto Serif KR', serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const VOICES = ["Yuna", "Eddy", "Reed", "Flo", "Sandy", "Shelley", "Rocko", "Grandma", "Grandpa"];

const $ = (s) => document.querySelector(s);
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: opts.raw ? {} : { "content-type": "application/json" }, body: opts.raw || (opts.body ? JSON.stringify(opts.body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}
function toast(msg, isErr = false) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

const st = { list: [], p: null, tl: null, prep: null, playing: false, clock: 0, t0: 0, ready: false, rendering: false, lib: [], view: "make" };

// ── 매직 텍스트 채우기 ────────────────────────────────
// 줄(row) = 같은 높이에 놓인 단어들 { y, h, words: [{ w, x, ww, t0, t1 }] }. 단어 시각은 뒤 띄어쓰기까지 포함한 구간이라
// 채움 위치를 단어 왼쪽 끝 → 다음 단어 왼쪽 끝으로 이으면 줄 전체가 끊김 없이 흐른다
function fillX(row, t, gap) {
  const ws = row.words;
  if (t <= ws[0].t0) return -Infinity;
  if (t >= ws[ws.length - 1].t1) return Infinity;
  for (const w of ws) if (t < w.t1) return w.x + (w.ww + gap) * clamp01((t - w.t0) / Math.max(0.01, w.t1 - w.t0));
  return Infinity;
}
// 한 줄 그리기. mode "slide": 부드러운 가장자리가 왼→오로 쓸고 지나감 · "word": 단어마다 0→1
function drawRow(ctx, row, t, x0, ink, dim, mode, gap, marker) {
  if (mode === "word") {
    for (const w of row.words) {
      const o = clamp01((t - w.t0) / Math.max(0.05, w.t1 - w.t0));
      if (marker && t >= w.t0 && t < w.t1 + 0.05) { ctx.fillStyle = marker; ctx.beginPath(); ctx.roundRect(x0 + w.x - 6, row.y - 4, w.ww + 12, row.h + 8, 8); ctx.fill(); }
      ctx.fillStyle = rgba(ink, dim); ctx.fillText(w.w, x0 + w.x, row.y);
      if (o > 0) { ctx.fillStyle = rgba(ink, o); ctx.fillText(w.w, x0 + w.x, row.y); }
    }
    return;
  }
  const fx = fillX(row, t, gap), soft = 36;
  let fill;
  if (fx === -Infinity) fill = rgba(ink, dim);
  else if (fx === Infinity) fill = rgba(ink, 1);
  else {
    if (marker) { const last = row.words[row.words.length - 1]; ctx.fillStyle = marker; ctx.beginPath(); ctx.roundRect(x0 - 8, row.y - 4, Math.min(fx, last.x + last.ww) + 16, row.h + 8, 8); ctx.fill(); }
    fill = ctx.createLinearGradient(x0 + fx - soft, 0, x0 + fx + soft, 0);
    fill.addColorStop(0, rgba(ink, 1)); fill.addColorStop(1, rgba(ink, dim));
  }
  ctx.fillStyle = fill;
  for (const w of row.words) ctx.fillText(w.w, x0 + w.x, row.y);
}
// 단어들을 폭에 맞춰 줄로 나눈다 (ctx.font 를 먼저 맞춰 둘 것)
function wrapWords(ctx, words, maxW, y0, lh, h) {
  const gap = ctx.measureText(" ").width, rows = [];
  let row = null, x = 0;
  for (const w of words) {
    const ww = ctx.measureText(w.w).width;
    if (!row || (x && x + ww > maxW)) { row = { y: y0 + rows.length * lh, h, words: [] }; rows.push(row); x = 0; }
    row.words.push({ ...w, x, ww }); x += ww + gap;
  }
  return { rows, gap };
}

// ── 템플릿 ────────────────────────────────────────────
// 템플릿 = { id, name, desc, options: [필드], prepare(ctx, p, tl, S) → 배치, draw(ctx, t, { p, tl, S, prep, level }) }
const FILL = { k: "fill", label: "채우기 방식", type: "select", def: "slide", choices: [["slide", "부드럽게 쓸기"], ["word", "단어마다"]] };

const ebook = {
  id: "ebook", name: "전자책", desc: "종이 위 글이 아래로 흐르며 읽어 줌",
  options: [
    { k: "paper", label: "종이 색", type: "color", def: "#ffffff" },
    { k: "ink", label: "글자 색", type: "color", def: "#111111" },
    { k: "font", label: "글꼴", type: "select", def: "sans", choices: [["sans", "고딕"], ["serif", "명조"]] },
    FILL,
    { k: "size", label: "글자 크기", type: "range", def: 44, min: 32, max: 60, step: 2 },
    { k: "leading", label: "줄 간격", type: "range", def: 1.62, min: 1.3, max: 2, step: 0.04 },
    { k: "dim", label: "안 읽은 글자 진하기", type: "range", def: 0.2, min: 0.05, max: 0.45, step: 0.01 },
    { k: "anchor", label: "읽는 줄 높이 (화면 비율)", type: "range", def: 0.44, min: 0.3, max: 0.6, step: 0.02 },
    { k: "marker", label: "형광펜", type: "check", def: true },
    { k: "titleOn", label: "제목", type: "check", def: true },
    { k: "header", label: "머리줄 (프로그램·진행 막대)", type: "check", def: true },
    { k: "wave", label: "바닥 파형", type: "check", def: true },
  ],
  // 문서 배치: 제목 → 문단(대사)들. 줄마다 문서 안 높이를 한 번 정해 둔다
  prepare(ctx, p, tl, S) {
    const X = 64, TW = W - 128, font = S.font === "serif" ? SERIF : SANS, lh = S.size * S.leading;
    const doc = { X, font, title: [], labels: [], rows: [], gap: 0, height: 0 }; let y = 190;
    if (S.titleOn) {
      ctx.font = `800 58px ${font}`;
      const tw = wrapWords(ctx, (p.title || p.topic || "").split(/\s+/).filter(Boolean).map((w) => ({ w })), TW, y, 76, 58);
      tw.rows.forEach((r) => doc.title.push({ text: r.words.map((w) => w.w).join(" "), y: r.y })); y += tw.rows.length * 76 + 40;
    }
    ctx.font = `600 ${S.size}px ${font}`;
    tl.lines.forEach((l, i) => {
      if (p.cast === 2 && (i === 0 || tl.lines[i - 1].speaker !== l.speaker)) { doc.labels.push({ text: p.hosts[l.speaker].name, color: p.hosts[l.speaker].color, y }); y += 44; }
      const { rows, gap } = wrapWords(ctx, l.words, TW, y, lh, S.size); doc.gap = gap;
      rows.forEach((r) => { r.line = i; doc.rows.push(r); }); y += rows.length * lh + 26;
    });
    doc.height = y;
    return doc;
  },
  draw(ctx, t, { p, tl, S, prep: doc, level }) {
    const accent = p.hosts[0].color, X = doc.X, anchor = S.anchor * H;
    ctx.fillStyle = S.paper; ctx.fillRect(0, 0, W, H);
    // 읽는 줄 높이 — 지난 0.9초를 평균해 부드럽게 (시각만으로 정해지므로 굽기에서도 같다)
    const rowAt = (tt) => { const rs = doc.rows; if (!rs.length || tt < rs[0].words[0].t0) return 0; let lo = 0, hi = rs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rs[m].words[0].t0 <= tt) lo = m; else hi = m - 1; } return rs[lo].y; };
    let s = 0; for (let k = 0; k < 12; k++) s += rowAt(t - k * 0.08);
    const oy = s ? Math.max(0, Math.min(s / 12 - anchor, doc.height - H * 0.62)) : 0;
    ctx.save(); ctx.translate(0, -oy); ctx.textBaseline = "top";
    ctx.font = `800 58px ${doc.font}`; ctx.fillStyle = S.ink; doc.title.forEach((r) => ctx.fillText(r.text, X, r.y));
    ctx.font = `700 22px ${SANS}`; doc.labels.forEach((l) => { ctx.fillStyle = l.color; ctx.fillText(l.text, X, l.y); });
    ctx.font = `600 ${S.size}px ${doc.font}`;
    for (const r of doc.rows) {
      if (r.y - oy < -r.h * 2 || r.y - oy > H) continue;
      const c = p.cast === 2 ? p.hosts[p.lines[r.line].speaker].color : accent;
      drawRow(ctx, r, t, X, S.ink, S.dim, S.fill, doc.gap, S.marker ? rgba(c, 0.16) : null);
    }
    ctx.restore();
    // 위·아래를 종이색으로 흐려 글이 스며들고 빠지게
    const fade = (y0, y1, a0, a1) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, rgba(S.paper, a0)); g.addColorStop(1, rgba(S.paper, a1)); ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0); };
    const top = S.header ? 128 : 0, bottom = S.wave ? 140 : 0;
    ctx.fillStyle = S.paper; ctx.fillRect(0, 0, W, top); ctx.fillRect(0, H - bottom, W, bottom);
    fade(top, top + 160, 1, 0); fade(H - bottom - 180, H - bottom, 0, 1);
    ctx.textBaseline = "middle"; const sub = rgba(S.ink, 0.45), tot = tl.total || 1;
    if (S.header) {
      ctx.font = `700 24px ${SANS}`; ctx.fillStyle = rgba(S.ink, 0.85); ctx.fillText(p.show || "", X, 66);
      ctx.textAlign = "right"; ctx.font = `600 20px ${MONO}`; ctx.fillStyle = sub; ctx.fillText(p.episode || "", W - X, 66); ctx.textAlign = "left";
      ctx.fillStyle = rgba(S.ink, 0.08); ctx.beginPath(); ctx.roundRect(X, 98, W - 2 * X, 4, 2); ctx.fill();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(X, 98, (W - 2 * X) * clamp01(t / tot), 4, 2); ctx.fill();
    }
    if (S.wave) {
      const n = 40, bw = 5, wx = X + 70, span = W - 2 * X - 140, step = (span - bw) / (n - 1), cy = H - 84;
      for (let j = 0; j < n; j++) { const tt = t + (j - 28) * (2 / FPS), bh = 4 + (tt < 0 ? 0 : level(tt)) * 40; ctx.fillStyle = j <= 28 ? accent : rgba(S.ink, 0.15); ctx.beginPath(); ctx.roundRect(wx + j * step, cy - bh / 2, bw, bh, 2.5); ctx.fill(); }
      ctx.font = `600 18px ${MONO}`; ctx.fillStyle = sub; ctx.fillText(fmt(t), X, cy); ctx.textAlign = "right"; ctx.fillText(fmt(tot), W - X, cy); ctx.textAlign = "left";
    }
  },
};

// 진행자 사진 (없으면 null — 색 동그라미·이니셜로 대신 그린다)
const photos = {};
function hostPhoto(p, h) {
  if (!h?.photo) return null;
  const u = `/data/_podcasts/${p.id}/${h.photo}`;
  if (!photos[u]) { const im = new Image(); im.src = u; photos[u] = im; }
  return photos[u].complete && photos[u].naturalWidth ? photos[u] : null;
}
// 사진을 칸에 꽉 채워(가운데 위쪽 기준 — 얼굴이 잘리지 않게) 그린다
function coverPhoto(ctx, im, x, y, w, h) {
  const s = Math.max(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * s, ih = im.naturalHeight * s;
  ctx.drawImage(im, x + (w - iw) / 2, y + Math.min(0, (h - ih) * 0.25), iw, ih);
}

const radio = {
  id: "radio", name: "라디오 스튜디오", desc: "ON AIR · 진행자 동그라미 · 지금 대사 · 파형",
  options: [
    { k: "bgTop", label: "배경 위", type: "color", def: "#16121f" },
    { k: "bgBottom", label: "배경 아래", type: "color", def: "#2b1f3f" },
    { k: "ink", label: "글자 색", type: "color", def: "#ffffff" },
    FILL,
    { k: "size", label: "대사 글자 크기 (최대)", type: "range", def: 54, min: 36, max: 64, step: 2 },
    { k: "dim", label: "안 읽은 글자 진하기", type: "range", def: 0.18, min: 0.05, max: 0.45, step: 0.01 },
    { k: "onair", label: "ON AIR 표시", type: "check", def: true },
    { k: "wave", label: "파형", type: "check", def: true },
  ],
  // 대사마다 글자 크기를 칸에 맞추고 줄을 나눠 둔다
  prepare(ctx, p, tl, S) {
    return tl.lines.map((l) => {
      let size = S.size, out;
      for (; size >= 32; size -= 2) { ctx.font = `800 ${size}px ${SANS}`; out = wrapWords(ctx, l.words, W - 112, 540, size * 1.34, size); if (out.rows.length * size * 1.34 <= 420) break; }
      return { size: Math.max(32, size), ...out };
    });
  },
  draw(ctx, t, { p, tl, S, prep, level }) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, S.bgTop); g.addColorStop(1, S.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const L = tl.lines, i0 = L.findIndex((l) => t < l.s1), i = i0 < 0 ? L.length - 1 : i0, l = L[i], host = p.hosts[l.speaker];
    const talking = t >= l.t0 && t < l.t1, lv = talking ? level(t) : 0, duo = p.cast === 2;
    const cx = (k) => (duo ? (k ? 500 : 220) : W / 2);
    const rg = ctx.createRadialGradient(cx(l.speaker), 330, 20, cx(l.speaker), 330, 520);
    rg.addColorStop(0, rgba(host.color, 0.25)); rg.addColorStop(1, rgba(host.color, 0)); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "middle";
    if (S.onair) {
      ctx.fillStyle = "#ff3b3b"; ctx.beginPath(); ctx.roundRect(48, 60, 150, 48, 24); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * Math.abs(Math.sin(t * 3))})`; ctx.beginPath(); ctx.arc(74, 84, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `800 22px ${MONO}`; ctx.fillText("ON AIR", 92, 85);
    }
    ctx.textAlign = "right"; ctx.fillStyle = S.ink; ctx.font = `800 30px ${SANS}`; ctx.fillText(p.show || "", W - 48, 76);
    ctx.fillStyle = rgba(S.ink, 0.6); ctx.font = `600 20px ${MONO}`; ctx.fillText(p.episode || "", W - 48, 110);
    ctx.textAlign = "center"; ctx.fillStyle = S.ink; ctx.font = `700 30px ${SANS}`; ctx.fillText(p.title || p.topic || "", W / 2, 172, W - 96);
    p.hosts.slice(0, duo ? 2 : 1).forEach((h, k) => {
      const on = l.speaker === k, x = cx(k), y = 330, r = 70 * (on ? 1.06 : 1), v = on ? lv : 0;
      ctx.save(); ctx.globalAlpha = on ? 1 : 0.45;
      if (on) { ctx.fillStyle = h.color; ctx.globalAlpha = 0.18 + v * 0.25; ctx.beginPath(); ctx.arc(x, y, r + 26 + v * 22, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = h.color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      const im = hostPhoto(p, h); // 진행자 사진이 있으면 동그라미 안에
      if (im) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip(); coverPhoto(ctx, im, x - r, y - r, r * 2, r * 2); ctx.restore(); }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = 5 + v * 10; ctx.strokeStyle = on ? S.ink : rgba(S.ink, 0.2); ctx.stroke();
      if (!im) { ctx.fillStyle = "#fff"; ctx.font = `900 62px ${SANS}`; ctx.fillText([...h.name][0] || "?", x, y + 3); }
      ctx.fillStyle = S.ink; ctx.font = `700 26px ${SANS}`; ctx.fillText(h.name, x, y + r + 36);
      ctx.restore();
    });
    ctx.textAlign = "left";
    // 지금 대사: 새 대사가 아래에서 살짝 떠오르며 들어온다
    const blk = prep[i], k = ease((t - l.s0) / 0.3);
    ctx.save(); ctx.globalAlpha = k; ctx.translate(0, (1 - k) * 26); ctx.textBaseline = "top"; ctx.font = `800 ${blk.size}px ${SANS}`;
    blk.rows.forEach((r) => drawRow(ctx, r, t, 56, S.ink, S.dim, S.fill, blk.gap, null));
    ctx.restore();
    if (S.wave) {
      ctx.fillStyle = rgba(S.ink, 0.07); ctx.beginPath(); ctx.roundRect(36, 990, W - 72, 250, 28); ctx.fill();
      const n = 56, bw = 7, step = (W - 112 - bw) / (n - 1), now = 40, cy = 1062;
      for (let j = 0; j < n; j++) { const tt = t + (j - now) * (2 / FPS), bh = 6 + (tt < 0 ? 0 : level(tt)) * 104; ctx.fillStyle = j <= now ? host.color : rgba(S.ink, 0.18); ctx.beginPath(); ctx.roundRect(56 + j * step, cy - bh / 2, bw, bh, 3.5); ctx.fill(); }
      const tot = tl.total || 1;
      ctx.fillStyle = rgba(S.ink, 0.18); ctx.beginPath(); ctx.roundRect(56, 1160, W - 112, 6, 3); ctx.fill();
      ctx.fillStyle = host.color; ctx.beginPath(); ctx.roundRect(56, 1160, (W - 112) * clamp01(t / tot), 6, 3); ctx.fill();
      ctx.fillStyle = rgba(S.ink, 0.6); ctx.font = `600 20px ${MONO}`; ctx.textBaseline = "middle";
      ctx.fillText(fmt(t), 56, 1200); ctx.textAlign = "right"; ctx.fillText(fmt(tot), W - 56, 1200); ctx.textAlign = "left";
    }
  },
};

const TEMPLATES = { ebook, radio };
const tpl = () => TEMPLATES[st.p?.template] || ebook;
const styleOf = () => ({ ...defaults(tpl().options), ...(st.p?.style || {}) });

// ── 시간표: 줄 경계와 단어 시각 ──────────────────────
function buildTimeline(p, audioDur) {
  const L = p.lines.map((l) => ({ ...l, ws: l.text.split(/\s+/).filter(Boolean) }));
  if (p.timing?.length === L.length) L.forEach((l, i) => { l.t0 = p.timing[i].t0; l.t1 = p.timing[i].t1; });
  else if (p.words?.length) { // 올린 녹음: whisper 단어 수에 대본 단어 수를 비례로 맞춘다
    const N = L.reduce((a, l) => a + l.ws.length, 0) || 1, Wd = p.words; let cum = 0;
    L.forEach((l) => {
      const i0 = Math.min(Wd.length - 1, Math.round((cum / N) * Wd.length)); cum += l.ws.length;
      const i1 = Math.max(i0, Math.min(Wd.length - 1, Math.round((cum / N) * Wd.length) - 1));
      l.t0 = Wd[i0].t0; l.t1 = Wd[i1].t1;
    });
  } else { let t = 0.3; L.forEach((l) => { l.t0 = t; t += Math.max(1, l.text.length / 6.5); l.t1 = t; t += GAP; }); }
  const total = L.length ? Math.max(audioDur || 0, L[L.length - 1].t1 + 1.6) : 0;
  L.forEach((l, i) => { l.s0 = i ? L[i - 1].t1 : 0; });
  L.forEach((l, i) => { l.s1 = i < L.length - 1 ? L[i + 1].s0 : total; });
  // 줄 안 단어 시각은 글자 수 비례 (뒤 띄어쓰기 몫까지)
  L.forEach((l) => {
    const tot = l.ws.reduce((a, w) => a + w.length + 1, 0) || 1; let acc = 0;
    l.words = l.ws.map((w) => { const a = l.t0 + ((l.t1 - l.t0) * acc) / tot; acc += w.length + 1; return { w, t0: a, t1: l.t0 + ((l.t1 - l.t0) * acc) / tot }; });
  });
  return { lines: L, total };
}

// ── 그리기 ────────────────────────────────────────────
let out, ctx;
const level = (t) => st.p?.levels?.[Math.floor(t * FPS)] ?? 0;
function drawFrame(t) {
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; // 앞 프레임의 정렬이 남지 않게
  if (!st.p || !st.prep) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); return; }
  tpl().draw(ctx, t, { p: st.p, tl: st.tl, S: styleOf(), prep: st.prep, level });
}

// ── 재생 ─────────────────────────────────────────────
const audio = () => $("#pcAudio");
const hasAudio = () => !!st.p?.audio;
const audioDur = () => (hasAudio() ? audio().duration || 0 : 0);
const now = () => (!st.playing ? st.clock : st.audioLive ? audio().currentTime : st.clock + (performance.now() - st.t0) / 1000);

function loop() {
  if (!$("#podcastView").hidden && st.view === "make" && !st.rendering) {
    const t = now();
    if (st.playing && t >= (st.tl?.total || 0)) { pause(); seek(st.tl?.total || 0); }
    drawFrame(Math.min(t, st.tl?.total || 0));
    $("#pcTime").textContent = `${fmt(t)} / ${fmt(st.tl?.total || 0)}`;
    if (!st.seeking) $("#pcSeek").value = st.tl?.total ? (t / st.tl.total) * 1000 : 0;
  }
  requestAnimationFrame(loop);
}
function play() {
  if (!st.tl?.total) return;
  if (now() >= st.tl.total - 0.05) seek(0);
  st.playing = true; st.t0 = performance.now();
  st.audioLive = st.clock < audioDur() - 0.05;
  if (st.audioLive) audio().play();
  $("#pcPlay").textContent = "⏸";
}
function pause() {
  if (!st.playing) return;
  st.clock = now(); st.playing = false;
  if (hasAudio()) audio().pause();
  $("#pcPlay").textContent = "▶";
}
function seek(t) {
  st.clock = t; st.t0 = performance.now();
  if (!hasAudio()) return;
  audio().currentTime = Math.min(t, audioDur());
  if (st.playing) { st.audioLive = t < audioDur() - 0.05; st.audioLive ? audio().play() : audio().pause(); }
}

// 굽기: 프레임을 한 장씩 그려 서버로 보낸다 (실시간 녹화가 아니라 탭이 뒤에 있어도 된다)
async function render() {
  if (!st.tl?.total) return toast("대사가 없습니다", true);
  pause(); st.rendering = true; $("#pcRender").disabled = true;
  const id = st.p.id, N = Math.ceil(st.tl.total * FPS), q = $("#pcQuality").value;
  // 고화질은 캔버스를 1080×1920 으로 키우고 좌표는 720 기준 그대로 1.5배로 그린다
  const k = q === "high" ? 1080 / W : 1;
  if (k !== 1) { out.width = W * k; out.height = H * k; ctx.setTransform(k, 0, 0, k, 0, 0); }
  try {
    await api(`/api/podcasts/${id}/render/start`, { method: "POST", body: {} });
    for (let i = 0; i < N; i++) {
      drawFrame(i / FPS);
      const blob = await new Promise((ok) => out.toBlob(ok, "image/jpeg", { small: 0.85, std: 0.92, high: 0.95 }[q] || 0.92));
      await api(`/api/podcasts/${id}/render/frame?i=${i}`, { method: "POST", raw: blob });
      if (i % 15 === 0) status(`굽는 중 ${i} / ${N} 프레임`);
    }
    status("mp4 로 묶는 중");
    st.p = await api(`/api/podcasts/${id}/render/finish`, { method: "POST", body: { quality: q } });
    renderResult(); toast("mp4 를 만들었습니다");
    await loadList(id);
  } catch (e) { toast(e.message, true); }
  finally {
    if (k !== 1) { out.width = W; out.height = H; ctx.setTransform(1, 0, 0, 1, 0, 0); drawFrame(st.clock); }
    st.rendering = false; $("#pcRender").disabled = false; status("");
  }
}

// ── 만든 콘텐츠 탭 ───────────────────────────────────
function setView(v) {
  st.view = v;
  $("#pcMakeView").hidden = v !== "make"; $("#pcListView").hidden = v !== "list";
  document.querySelectorAll("#pcTabs [data-v]").forEach((a) => a.classList.toggle("is-on", a.dataset.v === v));
  if (v === "list") pause();
}
function renderGrid() {
  const q = $("#pcSearch").value.trim().toLowerCase();
  const items = st.list.filter((x) => !q || `${x.title} ${x.topic}`.toLowerCase().includes(q));
  $("#pcGrid").innerHTML = contentGrid(items, { base: "/data/_podcasts", hash: "#podcast", unit: "대사", icon: "🎙️" });
  $("#pcCount").textContent = st.list.length;
}

// ── 화면 ─────────────────────────────────────────────
function status(msg) { $("#pcStatus").textContent = msg; $("#pcStatus").hidden = !msg; }

async function loadList(selectId) {
  st.list = await api("/api/podcasts");
  $("#pcPick").innerHTML = `<option value="">— 만든 릴스 ${st.list.length}개 —</option>` + st.list.map((x) => `<option value="${x.id}">${esc(x.title || x.topic || x.id)} · 대사 ${x.count}</option>`).join("");
  renderGrid();
  const id = selectId || st.p?.id || st.list[0]?.id;
  if (!id) { st.p = null; renderProject(); return; }
  $("#pcPick").value = id;
  if (st.p?.id !== id || selectId) await loadProject(id);
}
async function loadProject(id) { pause(); st.p = await api(`/api/podcasts/${id}`); renderProject(); await rebuild(); }

async function rebuild() {
  st.tl = null; st.prep = null;
  if (!st.p?.lines.length) return;
  const a = audio();
  if (hasAudio()) { a.src = `/data/_podcasts/${st.p.id}/${st.p.audio}?v=${encodeURIComponent(st.p.updatedAt)}`; await new Promise((ok) => { a.onloadedmetadata = ok; a.onerror = ok; }); }
  else a.removeAttribute("src");
  st.tl = buildTimeline(st.p, hasAudio() ? a.duration || 0 : 0);
  st.prep = tpl().prepare(ctx, st.p, st.tl, styleOf());
  seek(0);
}

// 템플릿 고르기 값: "tpl:<id>" 기본 템플릿 · "my:<id>" 내가 저장한 템플릿(기본 템플릿 + 스타일)
function tplOptions(cur) {
  const base = Object.values(TEMPLATES).map((t) => `<option value="tpl:${t.id}" ${cur === `tpl:${t.id}` ? "selected" : ""}>${esc(t.name)} — ${esc(t.desc)}</option>`).join("");
  const mine = st.lib.map((x) => `<option value="my:${x.id}" ${cur === `my:${x.id}` ? "selected" : ""}>${esc(x.name)} (${esc(TEMPLATES[x.base]?.name || x.base)})</option>`).join("");
  return `<optgroup label="기본 템플릿">${base}</optgroup>${mine ? `<optgroup label="내 템플릿">${mine}</optgroup>` : ""}`;
}
function presetOf(v) {
  const [kind, id] = String(v || "tpl:ebook").split(":");
  if (kind === "my") { const x = st.lib.find((y) => y.id === id); if (x) return { template: x.base, style: x.style || {} }; }
  return { template: TEMPLATES[id] ? id : "ebook", style: {} };
}
async function loadLib() {
  st.lib = await api("/api/podcast-lib/styles");
  $("#pcTpl").innerHTML = tplOptions($("#pcTpl").value || "tpl:ebook");
  if (st.p) $("#pcTplCur").innerHTML = tplOptions(`tpl:${tpl().id}`);
}

function lineCard(l, i, hosts) {
  return `<li class="ex-scene" data-i="${i}">
    <div class="ex-scene__head">
      <strong>${i + 1}</strong>
      <select data-k="speaker" aria-label="말하는 사람" ${st.p.cast === 2 ? "" : "hidden"}>${hosts.map((h, k) => `<option value="${k}" ${k === l.speaker ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select>
      <span style="flex:1"></span>
      <button class="btn btn--ghost btn--sm" type="button" data-act="up" aria-label="위로">↑</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="down" aria-label="아래로">↓</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="go" title="이 대사부터 재생">▶</button>
      <button class="btn btn--ghost btn--sm" type="button" data-act="del" aria-label="지우기">✕</button>
    </div>
    <textarea data-k="text" rows="2" placeholder="대사">${esc(l.text)}</textarea>
  </li>`;
}
function hostRow(h, i) {
  const ph = h.photo ? `/data/_podcasts/${st.p.id}/${h.photo}` : "";
  return `<div class="ex__row pc-host">
    <label class="pc-photo" title="진행자 사진 (인물 라디오·라디오 동그라미에 나옵니다)">${ph ? `<img src="${ph}" alt="">` : "📷"}<input type="file" accept="image/*" data-pcphoto="${i}" hidden></label>
    ${st.people?.length ? `<select data-pcphotores="${i}" aria-label="리소스 인물에서 사진"><option value="">리소스 인물…</option>${st.people.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>` : ""}
    <input type="color" data-k="color" value="${esc(h.color)}" aria-label="색">
    <input data-k="name" value="${esc(h.name)}" placeholder="이름" aria-label="낭독자 이름">
    <select data-k="voice" aria-label="목소리">${voiceOptions(st.voices, VOICES, h.voice)}</select>
  </div>`;
}

function renderProject() {
  const p = st.p, on = !!p;
  $("#pcEditor").hidden = !on; $("#pcPlayer").hidden = !on;
  if (!on) return;
  $("#pcTitle").value = p.title || ""; $("#pcShow").value = p.show || ""; $("#pcEpisode").value = p.episode || "";
  $("#pcCast").value = String(p.cast || 1);
  $("#pcTplCur").innerHTML = tplOptions(`tpl:${tpl().id}`);
  $("#pcStyle").innerHTML = fieldsHTML(tpl().options, p.style || {});
  $("#pcHosts").innerHTML = p.hosts.slice(0, p.cast === 2 ? 2 : 1).map((h, i) => hostRow(h, i)).join("");
  $("#pcLines").innerHTML = p.lines.map((l, i) => lineCard(l, i, p.hosts)).join("") || `<li class="muted small">대본이 아직 없습니다. "대본 다시 쓰기"를 누르세요.</li>`;
  renderAudioInfo(p.hosts);
  renderResult();
}
// 목소리를 바꿨는데 음성은 예전 목소리면 알리고 "음성 만들기" 버튼을 띄운다 (목소리 고르기는 설정만 바꾼다)
function renderAudioInfo(hosts) {
  const p = st.p;
  const used = [...new Set(p.lines.map((l) => l.speaker))];
  const now = (i) => hosts[i]?.voice;
  // voiced 가 없는 예전 음성은 맥 say 로 만든 것
  const changed = p.audio && p.timing && used.some((i) => (p.voiced ? p.voiced[i] !== now(i) : !VOICES.includes(now(i))));
  $("#pcAudioInfo").textContent = !p.audio ? "음성 없음 — 1초 6.5글자로 어림해 미리보기합니다"
    : changed ? "⚠ 목소리를 바꿨습니다 — 아래 \"진행자별 목소리로 음성 만들기\"를 눌러야 새 목소리로 바뀝니다"
    : p.timing ? "음성 있음 · 대사마다 만든 음성이라 경계가 정확합니다" : p.words ? `올린 음성 · whisper 단어 ${p.words.length}개로 경계를 맞춤` : "음성 있음 · 대사를 고쳤으니 음성을 다시 만드세요";
  $("#pcSay").classList.toggle("btn--primary", !p.audio || changed || !p.timing);
  $("#pcSay").classList.toggle("btn--ghost", !(!p.audio || changed || !p.timing));
}
function renderResult() {
  const v = st.p?.video;
  $("#pcResult").innerHTML = v ? `<a class="btn btn--ghost btn--sm" href="/data/_podcasts/${st.p.id}/${v}?v=${encodeURIComponent(st.p.updatedAt)}" download="${esc(st.p.title || st.p.id)}.mp4">mp4 받기</a>` : "";
}

function readForm() {
  return {
    title: $("#pcTitle").value, show: $("#pcShow").value, episode: $("#pcEpisode").value, cast: Number($("#pcCast").value),
    // 1명일 때 화면엔 첫 낭독자만 보이니 둘째는 그대로 둔다
    hosts: Object.assign([...st.p.hosts], [...document.querySelectorAll("#pcHosts .pc-host")].map((r, i) => ({ ...st.p.hosts[i], ...Object.fromEntries([...r.querySelectorAll("[data-k]")].map((x) => [x.dataset.k, x.value])) }))), // 사진(photo)은 그대로
    lines: [...document.querySelectorAll("#pcLines .ex-scene")].map((li) => ({ speaker: Number(li.querySelector('[data-k="speaker"]').value), text: li.querySelector('[data-k="text"]').value })),
  };
}
let saveT, styleT;
async function saveProject(patch) { st.p = await api(`/api/podcasts/${st.p.id}`, { method: "PUT", body: patch }); await rebuild(); }
const saveNow = () => saveProject(readForm());
const onEdit = () => { clearTimeout(saveT); saveT = setTimeout(() => saveNow().catch((e) => toast(e.message, true)), 600); };

function bind() {
  // 고른 화질은 이 브라우저에 기억한다
  try { $("#pcQuality").value = localStorage.getItem("mp4Quality") || "std"; } catch {}
  $("#pcQuality").addEventListener("change", (e) => { try { localStorage.setItem("mp4Quality", e.target.value); } catch {} });
  mountThumb({ source: $("#pcCanvas"), after: $("#pcRender").parentElement, get: () => ({ key: st.p?.id, title: st.p?.title || st.p?.topic || "", sub: [st.p?.show, st.p?.episode].filter(Boolean).join(" · "), name: st.p?.title || st.p?.id }) });
  $("#pcNew").addEventListener("submit", async (e) => {
    e.preventDefault();
    const topic = $("#pcTopic").value.trim(); if (!topic) return;
    const p = await api("/api/podcasts", { method: "POST", body: { topic, seconds: $("#pcSec").value, show: $("#pcNewShow").value, cast: Number($("#pcNewCast").value), ...presetOf($("#pcTpl").value) } });
    await loadList(p.id); $("#pcTopic").value = "";
    runJob(`/api/podcasts/${p.id}/script`);
  });
  $("#pcPick").addEventListener("change", (e) => e.target.value && loadProject(e.target.value));
  const del = async (id) => {
    const x = st.list.find((y) => y.id === id) || st.p; if (!x || !confirm(`"${x.title || x.topic}" 을 지울까요? 음성·mp4 도 같이 지워집니다.`)) return;
    await api(`/api/podcasts/${id}`, { method: "DELETE" }); if (st.p?.id === id) st.p = null; await loadList();
  };
  $("#pcDel").addEventListener("click", () => st.p && del(st.p.id));
  bindGrid($("#pcGrid"), del);
  $("#pcSearch").addEventListener("input", renderGrid);
  $("#pcRescript").addEventListener("click", () => st.p && (!st.p.lines.length || confirm("지금 대본을 버리고 새로 쓸까요?")) && runJob(`/api/podcasts/${st.p.id}/script`));
  ["#pcTitle", "#pcShow", "#pcEpisode", "#pcHosts", "#pcLines"].forEach((s) => $(s).addEventListener("input", onEdit));
  $("#pcHosts").addEventListener("change", async (e) => {
    const up = e.target.closest("[data-pcphoto]"), rs = e.target.closest("[data-pcphotores]");
    if (!up && !rs) return;
    e.stopImmediatePropagation();
    try {
      clearTimeout(saveT); await saveNow();
      let body = { i: Number((up || rs).dataset[up ? "pcphoto" : "pcphotores"]) };
      if (up) {
        const f = up.files[0]; if (!f) return;
        const r = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
        body.token = d.token;
      } else { if (!rs.value) return; body.resource = { kind: "person", id: rs.value }; }
      st.p = await api(`/api/podcasts/${st.p.id}/host-photo`, { method: "POST", body }); renderProject(); toast("진행자 사진을 넣었습니다");
    } catch (err) { toast(err.message, true); }
  }, true);
  $("#pcHosts").addEventListener("change", () => { onEdit(); if (st.p) renderAudioInfo(readForm().hosts); });
  $("#pcCast").addEventListener("change", async () => { clearTimeout(saveT); await saveNow(); renderProject(); });
  // 템플릿 · 스타일
  $("#pcTplCur").addEventListener("change", async (e) => { await saveProject(presetOf(e.target.value)); renderProject(); });
  $("#pcStyle").addEventListener("input", (e) => {
    if (e.target.type === "range") e.target.nextElementSibling.textContent = e.target.value;
    clearTimeout(styleT); styleT = setTimeout(() => saveProject({ style: readFields($("#pcStyle")) }).catch((err) => toast(err.message, true)), 300);
  });
  $("#pcStyleReset").addEventListener("click", async () => { await saveProject({ style: {} }); renderProject(); });
  $("#pcStyleSave").addEventListener("click", async () => {
    const name = prompt("템플릿 이름", `${tpl().name} · ${st.p.title || "내 스타일"}`); if (!name) return;
    const x = await api("/api/podcast-lib/styles", { method: "POST", body: { name, base: tpl().id, style: st.p.style || {} } });
    await loadLib(); $("#pcTplCur").value = `my:${x.id}`; toast(`"${name}" 템플릿을 저장했습니다. 새로 만들 때 고를 수 있습니다`);
  });
  $("#pcStyleDel").addEventListener("click", async () => {
    const v = $("#pcTplCur").value; if (!v.startsWith("my:")) return toast("내 템플릿을 고른 뒤 지우세요", true);
    const x = st.lib.find((y) => `my:${y.id}` === v); if (!x || !confirm(`"${x.name}" 템플릿을 지울까요? 이미 만든 릴스는 그대로입니다.`)) return;
    await api(`/api/podcast-lib/styles/${x.id}`, { method: "DELETE" }); await loadLib();
  });
  $("#pcLines").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const i = Number(b.closest(".ex-scene").dataset.i), f = readForm(), ls = f.lines;
    if (b.dataset.act === "go") { if (st.tl?.lines[i]) { seek(st.tl.lines[i].s0); play(); } return; }
    if (b.dataset.act === "del") ls.splice(i, 1);
    if (b.dataset.act === "up" && i > 0) [ls[i - 1], ls[i]] = [ls[i], ls[i - 1]];
    if (b.dataset.act === "down" && i < ls.length - 1) [ls[i + 1], ls[i]] = [ls[i], ls[i + 1]];
    st.p.lines = ls; renderProject(); onEdit();
  });
  $("#pcAdd").addEventListener("click", () => { const f = readForm(); st.p.lines = [...f.lines, { speaker: st.p.cast === 2 && f.lines.length ? 1 - f.lines[f.lines.length - 1].speaker : 0, text: "" }]; renderProject(); });
  $("#pcSay").addEventListener("click", async () => { if (!st.p) return; clearTimeout(saveT); await saveNow(); runJob(`/api/podcasts/${st.p.id}/voice`); });
  $("#pcAudioFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !st.p) return;
    status("음성 올리는 중");
    try { await api(`/api/podcasts/${st.p.id}/audio?name=${encodeURIComponent(f.name)}`, { method: "POST", raw: f }); st.waiting = true; }
    catch (err) { status(""); toast(err.message, true); }
  });
  $("#pcPlay").addEventListener("click", () => (st.playing ? pause() : play()));
  audio().addEventListener("ended", () => { if (st.playing) { st.clock = audioDur(); st.t0 = performance.now(); st.audioLive = false; } });
  const sk = $("#pcSeek");
  sk.addEventListener("input", () => { st.seeking = true; seek((sk.value / 1000) * (st.tl?.total || 0)); });
  sk.addEventListener("change", () => (st.seeking = false));
  $("#pcRender").addEventListener("click", () => render());
  // 서버 작업(대본·음성) 진행은 app.js 의 공용 이벤트 줄(srv-event)에서 받는다
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (e.type === "log" && st.waiting) status(e.message);
    if (e.type === "job" && e.kind === "podcast" && e.state !== "start") {
      st.waiting = false; status("");
      if (e.state === "error") toast(e.message, true); else { toast(e.message); if (st.p) loadList(st.p.id); }
    }
  });
}
async function runJob(url, body = {}) {
  try { await api(url, { method: "POST", body }); st.waiting = true; status("시작했습니다"); }
  catch (e) { toast(e.message, true); }
}

window.podcaster = {
  // sub: "" 만들기 · "list" 만든 콘텐츠 · "pc_…" 그 릴스를 만들기 화면에 연다
  async open(sub = "") {
    if (!st.ready) { out = $("#pcCanvas"); out.width = W; out.height = H; ctx = out.getContext("2d"); bind(); st.ready = true; requestAnimationFrame(loop); }
    setView(sub === "list" ? "list" : "make");
    st.voices = await loadVoiceChoices(true);
    st.people = await api("/api/resources?kind=person").then((l) => l.filter((r) => r.files?.some((f) => f.kind === "image"))).catch(() => []);
    await loadLib().catch((e) => toast(e.message, true));
    await loadList(/^pc_\d+$/.test(sub) ? sub : undefined).catch((e) => toast(e.message, true));
  },
  close() { if (st.ready) pause(); },
  // 지정 시각 한 장을 바로 그린다 (미리보기 캡처용)
  frame(t) { pause(); seek(t); drawFrame(Math.min(t, st.tl?.total || 0)); return st.tl?.total || 0; },
};
