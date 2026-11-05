// 3D 설명 영상 · 팟캐스트 릴스가 같이 쓰는 것
// 1) 라이브러리: 저장한 캐릭터·내 템플릿 같은 작은 목록을 <폴더>/_lib_<종류>.json 에 둔다
// 2) 만든 콘텐츠 목록용 썸네일·길이 (out.mp4 → thumb.jpg)
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

export function makeLibrary(root, kinds) {
  const file = (kind) => path.join(root, `_lib_${kind}.json`);
  const list = async (kind) => {
    if (!kinds.includes(kind)) throw Object.assign(new Error("없는 종류"), { status: 404 });
    try { return JSON.parse(await fs.readFile(file(kind), "utf8")); } catch { return []; }
  };
  return {
    list,
    async save(kind, item) {
      const all = await list(kind);
      const x = { ...obj(item), id: String(item.id || `${kind[0]}_${Date.now()}`), name: String(item.name || "이름 없음").trim(), updatedAt: new Date().toISOString() };
      const i = all.findIndex((y) => y.id === x.id); i < 0 ? all.push(x) : (all[i] = x);
      await fs.mkdir(root, { recursive: true }); await fs.writeFile(file(kind), JSON.stringify(all, null, 2));
      return x;
    },
    async del(kind, id) {
      const all = (await list(kind)).filter((y) => y.id !== id);
      await fs.writeFile(file(kind), JSON.stringify(all, null, 2));
    },
  };
}

const capture = (cmd, args) => new Promise((ok, fail) => {
  const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", fail);
  c.on("close", (code) => (code === 0 ? ok(o) : fail(new Error(`${cmd} 종료 코드 ${code}`))));
});
export const videoDuration = async (file) => parseFloat(await capture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])) || 0;

/** dir/out.mp4 에서 thumb.jpg 를 만든다 (영상 길이의 15% 지점 — 첫 장면 제목이 보이도록 너무 앞은 피한다). 길이를 돌려준다 */
export async function makeThumb(dir) {
  const video = path.join(dir, "out.mp4");
  if (!existsSync(video)) return 0;
  const dur = await videoDuration(video);
  await capture("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, dur * 0.15)), "-i", video, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", path.join(dir, "thumb.jpg")]);
  return dur;
}

/** 목록 한 줄의 썸네일·길이. 예전에 구운 영상이라 썸네일이 없으면 이때 만든다 */
export async function mediaInfo(dir, p) {
  const has = existsSync(path.join(dir, "out.mp4"));
  if (has && (!existsSync(path.join(dir, "thumb.jpg")) || !p.duration)) {
    try { p.duration = await makeThumb(dir); await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(p, null, 2)); } catch {}
  }
  return { hasVideo: has, thumb: existsSync(path.join(dir, "thumb.jpg")), duration: p.duration || 0 };
}
