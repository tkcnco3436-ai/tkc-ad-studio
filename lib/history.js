// 제작 기록 — 끝난 작업(수집 · 이미지 소재 · 영상 복제 · 드라마 · 힉스필드 생성 …)을 한 줄씩 남긴다.
// 저장: <DATA_DIR>/_history.jsonl (한 줄에 하나, 뒤에 덧붙이기만 한다). 화면: public/history.js (#history)
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./store.js";

const FILE = path.join(DATA_DIR, "_history.jsonl");
const MAX_READ = 2000;

// 작업 종류 → 메뉴 (화면의 거르기 칸과 같다)
const MENU = { collect: "collect", search: "collect", resolve: "collect", template: "tpl", poster: "poster", clone: "clone", drama: "drama", script: "drama", hf: "hf", auto: "auto", persona: "res", voice: "res", setup: "setup" };

// 어디서 열면 되는지 — 요청 주소나 결과에서 대상 ID 를 읽는다
function linkOf(reqPath = "", result) {
  let m;
  if ((m = reqPath.match(/^\/api\/posters\/(po_\d+)/))) return `#poster/${m[1]}`;
  if ((m = reqPath.match(/^\/api\/clones\/(cl_\d+)/))) return `#clone/${m[1]}`;
  if ((m = reqPath.match(/^\/api\/dramas\/(d_\d+)/))) return `#drama/studio/${m[1]}`;
  if (/^\/api\/(brands|analyze|uploads|advertisers|instagram)/.test(reqPath)) return "#collect";
  if (/^\/api\/resources/.test(reqPath)) return "#res";
  if (result?.type === "poster" && result.id) return `#poster/${result.id}`;
  if (result?.type === "drama" && result.id) return `#drama/studio/${result.id}`;
  if (result?.type === "resource") return "#res";
  if (result?.type === "autoflow") return "#auto";
  if (result?.type === "clone" && result.id) return `#clone/${result.id}/rec`;
  if (result?.type === "template" || result?.type === "variant") return "#collect";
  return "";
}

export async function addHistory({ kind, label, state, startedAt, error, reqPath, result }) {
  const rec = {
    at: new Date().toISOString(), kind, menu: MENU[kind] || "etc", label, state,
    ms: startedAt ? Date.now() - startedAt : null, link: linkOf(reqPath, result),
    ...(error ? { error: String(error).slice(0, 300) } : {}),
    ...(kind === "hf" && result?.mode ? { hf: result.mode } : {}),
  };
  await fs.appendFile(FILE, JSON.stringify(rec) + "\n").catch(() => {});
}

export async function listHistory({ menu = "", state = "", q = "" } = {}) {
  const text = await fs.readFile(FILE, "utf8").catch(() => "");
  const lines = text.trim() ? text.trim().split("\n").slice(-MAX_READ) : [];
  const out = [];
  for (const l of lines.reverse()) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (menu && r.menu !== menu) continue;
    if (state && r.state !== state) continue;
    if (q && !`${r.label} ${r.error || ""}`.toLowerCase().includes(q.toLowerCase())) continue;
    out.push(r);
  }
  return out;
}
