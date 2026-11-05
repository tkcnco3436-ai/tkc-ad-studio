// 3D 설명 영상 템플릿들이 같이 쓰는 것 — 크기·글꼴·시간 곡선·글 줄바꿈
// 템플릿 모듈 (explainer-voxel.js · explainer-classic.js) 이 내보내는 모양:
//   { id, name, desc, types: { 장면: { label, hint? } }, options: [필드], character?: { fields, preview(spec) },
//     toneMapping?, prepare(env), build(scene, env), compose(env) }
//   env = { ctx, src(WebGL 캔버스), s(시간표 장면), b(지은 장면), t, lt, dur, idx, p(프로젝트), style, character }
//   필드 = { k, label, type: "color" | "range" | "select" | "check", def, min?, max?, step?, choices?: [[값, 이름]] }
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export { THREE };
export const W = 720, H = 1280, FPS = 30;
export const IMG = "https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img";
export const FONT = "'Pretendard Variable', Pretendard, -apple-system, sans-serif";
export const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
export const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
export const defaults = (fields) => Object.fromEntries(fields.map((f) => [f.k, f.def]));

export function wrapLines(ctx, text, maxW) {
  const lines = []; let cur = "";
  for (const w of String(text).split(/\s+/)) { const tryL = cur ? `${cur} ${w}` : w; if (ctx.measureText(tryL).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tryL; }
  if (cur) lines.push(cur);
  return lines;
}
