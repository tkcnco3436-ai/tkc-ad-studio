// 이미지 속 글자 읽기 (tesseract.js — 윈도우·맥 공통, 한국어+영어)
// 광고 이미지는 글자가 작거나 영상 위 흰 자막이라 그대로 읽으면 잡음이 많다.
// 그래서 두 번 읽어 합친다: ① 키워서 흑백 ② 밝은 글자만 남긴 이진화(흰 자막용)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache", "tesseract");
const MIN_CONF = 70;

// 작은 이미지(영상 프레임 등)는 3배, 큰 이미지는 1.5배로 키운다
const SCALE = "scale=w='if(lt(iw\\,800)\\,iw*3\\,iw*1.5)':h=-1:flags=lanczos";
const PASSES = [
  `${SCALE},format=gray`,
  `${SCALE},format=gray,lut=y='if(gt(val\\,190)\\,0\\,255)'`,
];

let workerP = null;

export async function ocrAvailable() {
  return import("tesseract.js").then(() => true, () => false);
}

function getWorker() {
  workerP ||= (async () => {
    const { createWorker } = await import("tesseract.js");
    await fs.mkdir(CACHE, { recursive: true });
    // 첫 실행 때 한국어·영어 데이터를 내려받아 .cache/tesseract 에 둔다
    return createWorker(["kor", "eng"], 1, { cachePath: CACHE });
  })();
  return workerP;
}

/** 작업이 끝나면 워커를 닫아 메모리를 돌려준다 */
export async function closeOcr() {
  if (!workerP) return;
  const w = await workerP.catch(() => null);
  workerP = null;
  await w?.terminate().catch(() => {});
}

const norm = (s) => s.replace(/\s+/g, "");
// 두 번 읽은 결과가 한두 글자만 다르면 같은 줄로 본다 ("침대야" / "짐대야")
const similar = (a, b) => a.length === b.length && [...a].filter((c, i) => c !== b[i]).length <= Math.max(1, Math.floor(a.length * 0.15));

/** 이미지 한 장 → [{ text, conf }] (신뢰도 70 이상, 위에서 아래 순) */
export async function ocrImage(file) {
  const worker = await getWorker();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mac-ocr-"));
  const found = new Map();
  try {
    for (const [i, vf] of PASSES.entries()) {
      const pre = path.join(tmp, `p${i}.png`);
      await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", vf, pre]);
      const { data } = await worker.recognize(pre, {}, { blocks: true });
      for (const line of (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))) {
        // 앞뒤에 붙는 잡음 기호( | \ ` = : 등)를 떼어 낸다
        const text = line.text.replace(/\s+/g, " ").trim()
          .replace(/^[^\p{L}\p{N}"'“(\[]+/u, "").replace(/[^\p{L}\p{N}?!.~)"'”\]%]+$/u, "").trim();
        if (line.confidence < MIN_CONF || !/[가-힣A-Za-z0-9]{2,}/.test(text)) continue;
        const key = [...found.keys()].find((k) => similar(k, norm(text))) || norm(text);
        const prev = found.get(key);
        if (!prev || prev.conf < line.confidence) found.set(key, { text, conf: Math.round(line.confidence), y: line.bbox.y0 });
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return [...found.values()].sort((a, b) => a.y - b.y).map(({ text, conf }) => ({ text, conf }));
}
