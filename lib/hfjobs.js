// 힉스필드 생성 결과를 어디에 붙일지 (변형 카드 · 드라마/광고 스튜디오 칸)
//   target = { type: "variant", brandId, dir, vid } | { type: "drama", id, slot } | { type: "template", id, shot, field } | { type: "poster", id } | { type: "radio", id, n, field }
//          | { type: "resource", kind, id, part }
// refs 는 그 대상 폴더 기준 상대 경로만 받는다 (폴더 밖은 거절)
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AD_DIR_RE, brandDir, getBrand, readJson, writeJson } from "./store.js";
import { DRAMAS_DIR, setDramaMedia } from "./dramastudio.js";
import { hfGenerate } from "./higgsfield.js";
import { TEMPLATES_DIR } from "./template.js";
import { setMyMedia } from "./mytemplate.js";
import { POSTERS_DIR, addPosterBg, addPosterOutput } from "./poster.js";
import { RADIOS_DIR, setRadioScene } from "./radio.js";
import { addResourceFiles, resourcePath } from "./resources.js";
import { CLONES_DIR } from "./clone.js";

function inside(base, rel) {
  const abs = path.resolve(base, String(rel));
  if (!abs.startsWith(path.resolve(base) + path.sep)) throw new Error(`잘못된 참조 경로: ${rel}`);
  return abs;
}

export async function runHf(target, req, emit = () => {}) {
  const stamp = Date.now();
  if (target.type === "drama") {
    if (!/^d_\d+$/.test(target.id)) throw new Error("잘못된 드라마 ID");
    const base = path.join(DRAMAS_DIR, target.id);
    const refs = (req.refs || []).map((r) => inside(base, r)), audio = req.audio ? inside(base, req.audio) : "";
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-"));
    try {
      const out = await hfGenerate({ ...req, refs, audio }, tmp, `hf_${stamp}`, emit);
      const f = out.files[0];
      await setDramaMedia(target.id, target.slot, { tmp: path.join(tmp, f), name: f });
      return { type: "drama", id: target.id, slot: target.slot, mode: out.mode };
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }
  if (target.type === "variant") {
    const brand = await getBrand(target.brandId);
    if (!brand || !AD_DIR_RE.test(target.dir) || !/^v_\d+$/.test(target.vid)) throw new Error("잘못된 변형");
    const adDir = path.join(brandDir(brand), target.dir);
    const refs = (req.refs || []).map((r) => inside(adDir, r));
    // 동시 생성 개수(req.count, 1~4) — 같은 요청을 나란히 보내고, 하나라도 되면 된 것만 남긴다
    const n = Math.max(1, Math.min(4, Math.round(Number(req.count) || 1)));
    const outDir = path.join(adDir, "variants", target.vid);
    const runs = await Promise.allSettled(Array.from({ length: n }, (_, i) => hfGenerate({ ...req, refs: [...refs] }, outDir, `gen_${stamp}${n > 1 ? `_${i + 1}` : ""}`, emit)));
    const ok = runs.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!ok.length) throw runs[0].reason;
    if (ok.length < n) emit({ level: "warn", message: `${n}개 중 ${n - ok.length}개는 실패: ${runs.find((r) => r.status === "rejected").reason.message}` });
    const out = { files: ok.flatMap((r) => r.files), mode: ok[0].mode };
    const file = path.join(adDir, "prompts.json");
    const pj = await readJson(file, {});
    const v = (pj.variants || []).find((x) => x.vid === target.vid);
    if (v) {
      v.generated = [...(v.generated || []), ...out.files.map((f) => ({ file: `variants/${target.vid}/${f}`, purpose: req.purpose, mode: out.mode, model: req.imageModel || "", created_at: new Date().toISOString() }))];
      await writeJson(file, pj);
    }
    return { type: "variant", dir: target.dir, vid: target.vid, mode: out.mode };
  }
  if (target.type === "template") {
    if (!/^tpl_\w+$/.test(target.id)) throw new Error("잘못된 템플릿 ID");
    const base = path.join(TEMPLATES_DIR, target.id);
    const refs = (req.refs || []).map((r) => inside(base, r));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-"));
    try {
      const out = await hfGenerate({ ...req, refs }, tmp, `hf_${stamp}`, emit);
      await setMyMedia(target.id, Number(target.shot), target.field, path.join(tmp, out.files[0]), out.files[0]);
      return { type: "template", id: target.id, shot: target.shot, mode: out.mode };
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }
  if (target.type === "radio") { // 인물 라디오 장면: field "frame"(시작 프레임) | "video"(말하는 영상 — req.audio 로 그 줄 음성을 넣는다)
    if (!/^ra_\d+$/.test(target.id)) throw new Error("잘못된 인물 라디오 ID");
    const base = path.join(RADIOS_DIR, target.id);
    const refs = (req.refs || []).map((r) => inside(base, r)), audio = req.audio ? inside(base, req.audio) : "";
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-"));
    try {
      const out = await hfGenerate({ ...req, refs, audio }, tmp, `hf_${stamp}`, emit);
      await setRadioScene(target.id, target.n, target.field, path.join(tmp, out.files[0]), out.files[0]);
      return { type: "radio", id: target.id, n: target.n, field: target.field, mode: out.mode };
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }
  if (target.type === "poster") {
    if (!/^po_\d+$/.test(target.id)) throw new Error("잘못된 포스터 ID");
    const base = path.join(POSTERS_DIR, target.id);
    const refs = (req.refs || []).map((r) => inside(base, r));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-"));
    try {
      const out = await hfGenerate({ ...req, refs }, tmp, `hf_${stamp}`, emit);
      await (target.as === "output" ? addPosterOutput : addPosterBg)(target.id, path.join(tmp, out.files[0]), out.files[0]); // 완성 포스터 | 배경
      return { type: "poster", id: target.id, as: target.as || "bg", mode: out.mode };
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }
  if (target.type === "clone") { // 영상 복제 — Genjutsu 영상 · 첫 프레임 편집 이미지 · 이미지→영상. refs·video 는 그 복제 폴더 기준
    if (!/^cl_\d+$/.test(target.id)) throw new Error("잘못된 영상 복제 ID");
    const base = path.join(CLONES_DIR, target.id);
    const refs = (req.refs || []).map((r) => inside(base, r)), video = req.video ? inside(base, req.video) : "";
    const n = Math.max(1, Math.min(4, Math.round(Number(req.count) || 1)));
    const outDir = path.join(base, "gen");
    const runs = await Promise.allSettled(Array.from({ length: n }, (_, i) => hfGenerate({ ...req, refs: [...refs], video }, outDir, `${req.purpose || "gen"}_${stamp}${n > 1 ? `_${i + 1}` : ""}`, emit)));
    const ok = runs.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!ok.length) throw runs[0].reason;
    if (ok.length < n) emit({ level: "warn", message: `${n}개 중 ${n - ok.length}개는 실패: ${runs.find((r) => r.status === "rejected").reason.message}` });
    const file = path.join(base, "clone.json"), c = await readJson(file, {});
    const now = new Date().toISOString();
    // 기록 탭(버전 + 프롬프트 단위)에서 묶어 보이게 — 만들 때 쓴 프롬프트 버전(prompt_at)·칸·글·참조를 같이 남긴다
    c.generated = [...(c.generated || []), ...ok.flatMap((r) => r.files.map((f) => ({ file: `gen/${f}`, kind: req.kind, purpose: req.purpose || "", model: r.model || req.imageModel || req.videoModel || "",
      settings: { resolution: req.resolution || "", aspect: req.aspect || "", duration: req.duration || "", way: req.genjutsu || "" }, prompt_at: req.promptAt || c.prompts?.at || "", prompt_key: req.promptKey || "", prompt: req.prompt, refs: req.refs || [], created_at: now })))];
    await writeJson(file, c);
    return { type: "clone", id: target.id, purpose: req.purpose, mode: ok[0].mode };
  }
  if (target.type === "resource") { // 리소스(인물 부분 등) 결과 이미지 — refs 는 그 리소스 폴더 기준
    const base = path.dirname(resourcePath(target.kind, target.id, "x"));
    const refs = (req.refs || []).map((r) => inside(base, r));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hf-"));
    try {
      const out = await hfGenerate({ ...req, refs }, tmp, `hf_${stamp}`, emit);
      await addResourceFiles(target.kind, target.id, out.files.map((f) => ({ tmp: path.join(tmp, f), name: f })), { role: "output", part: target.part, source: "generated", prompt: req.prompt, refs: req.refs || [] });
      return { type: "resource", kind: target.kind, id: target.id, part: target.part, mode: out.mode };
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }
  throw new Error("알 수 없는 대상");
}

/** 합성 결과 저장 (화면 캔버스에서 만든 PNG) */
export async function saveComposite(brandId, dir, vid, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  const brand = await getBrand(brandId);
  if (!m || !brand || !AD_DIR_RE.test(dir) || !/^v_\d+$/.test(vid)) throw new Error("잘못된 요청");
  const adDir = path.join(brandDir(brand), dir);
  const name = `variants/${vid}/composite_${Date.now()}.png`;
  await fs.mkdir(path.join(adDir, "variants", vid), { recursive: true });
  await fs.writeFile(path.join(adDir, name), Buffer.from(m[1], "base64"));
  const file = path.join(adDir, "prompts.json");
  const pj = await readJson(file, {});
  const v = (pj.variants || []).find((x) => x.vid === vid);
  if (v) { v.composites = [...(v.composites || []), { file: name, created_at: new Date().toISOString() }]; await writeJson(file, pj); }
  return { file: name };
}
