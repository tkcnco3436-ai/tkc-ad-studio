// 템플릿 화면 분석 (최초 1회 · template.json 에 저장해 두고 다시 쓴다)
//   poster_layout: 카드뉴스 템플릿 표지(cover.jpg)에서 바꿀 수 있는 소재(글·버튼·사진·로고)와 자리·글꼴·색 — 포스터 만들기
//   템플릿을 저장할 때 한 번 분석하고, 예전 템플릿은 처음 불러올 때 한 번 분석해 저장한다. "다시 뽑기"만 새로 분석한다.
import { askClaude, extractJson } from "./claude.js";
import { TEMPLATES_DIR, getTemplate, saveTemplate } from "./template.js";
import path from "node:path";

export const LAYER_RULES = `좌표는 캔버스 비율(0~1). text·button: x 는 정렬 기준점(left 면 왼쪽 끝, center 면 가운데, right 면 오른쪽 끝), y 는 글자 윗변, size 는 가로 1080px 기준 글자 크기(px), 줄바꿈은 \\n. image: x·y 왼쪽 위, w·h 크기. color·bg 는 #hex.`;

/** 이미지 한 장 → { bg_color, overlay, elements[], notes } */
export async function analyzeLayout({ cwd, image, W, H }) {
  const { text } = await askClaude(`포스터 템플릿 이미지 ${image} 를 Read 로 보고, 같은 배치를 ${W}x${H} 캔버스에 다시 그릴 수 있게 요소를 뽑는다. 사람에게 묻지 말 것.
요소 = 화면의 글 덩어리(제목·부제·라벨·정보 등 줄 단위가 아닌 덩어리 단위), 버튼(배경 있는 글), 사진·일러스트 칸(인물·제품·배경 사진), 로고.
${LAYER_RULES}
배경이 사진 한 장으로 꽉 차 있으면 그 사진을 kind "image" 요소 하나(x0 y0 w1 h1, 맨 앞)로 넣고, bg_color 는 사진의 주된 어두운 색. 단색·그라데이션 배경이면 bg_color 만.
사진 위 글이 읽히게 아래를 어둡게 깔았으면 overlay(0~0.8).
key 는 영어 소문자 짧게(title, sub, label, btn, photo, logo …). name 은 한국어 이름(예: "큰 제목", "가격 강조", "행동 버튼", "인물 사진").
답은 JSON 하나만:
{ "bg_color": "#ffffff", "overlay": 0, "elements": [{ "key": "title", "kind": "text|button|image|logo", "name": "", "text": "", "x": 0, "y": 0, "w": 0, "h": 0, "size": 40, "color": "#111111", "weight": 800, "align": "left", "bg": "", "desc": "사진이면 무엇이 찍혔는지" }], "notes": "" }`, { cwd, timeoutMs: 4 * 60_000 });
  return extractJson(text);
}

/** 카드뉴스 템플릿의 소재 분석 — 저장된 게 있으면 그대로, 없거나 force 면 분석해 template.json 에 저장 */
export async function templateLayout(tplId, { force = false, emit = () => {} } = {}) {
  const t = await getTemplate(tplId);
  if (!t || t.kind !== "cardnews") throw new Error("카드뉴스 템플릿을 찾지 못했습니다");
  if (t.poster_layout?.elements?.length && !force) return t.poster_layout;
  const W = 1080, H = Math.round((1080 * (t.format?.height || 1350)) / (t.format?.width || 1080));
  emit({ message: "Claude 가 템플릿 표지에서 바꿀 소재를 뽑는 중 (최초 1회 · 1분 안팎)" });
  const out = await analyzeLayout({ cwd: path.join(TEMPLATES_DIR, tplId), image: t.media?.cover || "cover.jpg", W, H });
  const poster_layout = { W, H, aspect: t.format?.aspect || "", bg_color: out.bg_color || "", overlay: Math.max(0, Math.min(0.85, +out.overlay || 0)),
    elements: out.elements || [], notes: out.notes || "", analyzed_at: new Date().toISOString() };
  await saveTemplate(tplId, { poster_layout });
  emit({ message: `템플릿 소재 ${poster_layout.elements.length}개 저장` });
  return poster_layout;
}
