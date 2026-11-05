// 이 PC 사용자별 설정 — ~/.ad-studio/config.json (저장 폴더 위치) · settings.json (힉스필드 키, lib/higgsfield.js)
// 저장 폴더와 따로 둬서 폴더를 옮기거나 공유해도 설정·키가 섞이지 않게 한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.resolve(process.env.AD_STUDIO_HOME || path.join(os.homedir(), ".ad-studio"));
const FILE = path.join(CONFIG_DIR, "config.json");
export const DEFAULT_DATA_DIR = path.join(os.homedir(), "Documents", "광고소재 스튜디오");

// 네 메뉴가 쓰는 폴더 — 저장 폴더를 고르면 미리 만들어 둔다 (각 기능도 쓸 때 스스로 만든다)
export const SUBFOLDERS = [
  { dir: "직접 분석", label: "링크·업로드로 수집한 광고" },
  { dir: "_posters", label: "이미지 소재" },
  { dir: "_clones", label: "영상 복제" },
  { dir: "_dramas", label: "드라마 릴스" },
  { dir: "_resources", label: "리소스 (인물·배경·제품)" },
  { dir: "_templates", label: "템플릿" },
];

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
export function writeConfig(patch) {
  const c = { ...readConfig(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(c, null, 1), { mode: 0o600 });
  return c;
}
