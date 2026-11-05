// 이미지 형태 — "single"(한 장면 한 대상) | "sheet"(한 대상을 여러 각도·표정으로 모은 시트)
// 영상 복제·이미지 변형이 프롬프트에 "이건 시트다, 정면을 기준으로"를 확정값으로 넘기고, 인물이면 얼굴 클로즈업을 따로 받게 하는 데 쓴다.
// 짐작 규칙: 시트 단계에서 만든 결과(part sheet·angles·outfit)면 시트, 아니면 가로가 세로의 1.4배 이상일 때 시트 (사용자가 바꿀 수 있다)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const SHEET_PARTS = ["sheet", "angles", "outfit"];
export const FORMS = ["single", "sheet"];

export async function imageSize(file) {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
    const [w, h] = stdout.trim().split(",").map(Number);
    return w && h ? { w, h } : null;
  } catch { return null; }
}

export async function guessForm(file, part = "") {
  if (SHEET_PARTS.includes(part)) return "sheet";
  const s = await imageSize(file);
  return s && s.w / s.h >= 1.4 ? "sheet" : "single";
}

/** 그림의 한 부분 잘라 내기 — box 는 이미지 대비 퍼센트 { x, y, w, h } */
export async function cropImage(src, out, box) {
  const s = await imageSize(src);
  if (!s) throw new Error("이미지 크기를 읽지 못했습니다");
  const c = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const x = Math.round(s.w * c(box.x, 0, 99) / 100), y = Math.round(s.h * c(box.y, 0, 99) / 100);
  const w = Math.max(16, Math.min(s.w - x, Math.round(s.w * c(box.w, 1, 100) / 100))), h = Math.max(16, Math.min(s.h - y, Math.round(s.h * c(box.h, 1, 100) / 100)));
  await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `crop=${w}:${h}:${x}:${y}`, out]);
  return { w, h };
}
