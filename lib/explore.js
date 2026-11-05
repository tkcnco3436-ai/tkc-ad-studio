// 처음 화면(탐색)에 보여 줄 최근 항목 — 모은 광고 · 이미지 소재 · 영상 복제 · 드라마 릴스를 썸네일 주소와 함께 모은다.
// 주소는 /data/ 아래 상대 경로 (server.js 가 DATA_DIR 에서 내준다)
import path from "node:path";
import { DATA_DIR, listBrands, listAds, readJson, brandDir } from "./store.js";
import { listPosters } from "./poster.js";
import { listClones } from "./clone.js";
import { listDramas } from "./dramastudio.js";

const url = (...parts) => "/data/" + path.relative(DATA_DIR, path.join(DATA_DIR, ...parts)).split(path.sep).map(encodeURIComponent).join("/");

export async function explore({ ads: nAds = 18, each = 6 } = {}) {
  const ads = [];
  for (const b of await listBrands()) {
    if (!b.adCount) continue;
    for (const a of await listAds(b)) {
      const f = a.files || {}, thumb = f.poster || f.image || f.contact_sheet;
      if (!thumb) continue;
      ads.push({
        kind: a.type === "vd" ? "영상" : "이미지", brand: b.name, platform: b.platform, title: a.body_text || a.title || "", at: a.collected_at || "",
        thumb: url(b.folder, a.dir, thumb), video: f.video ? url(b.folder, a.dir, f.video) : "", href: "#collect",
      });
    }
  }
  ads.sort((x, y) => y.at.localeCompare(x.at));

  const posters = (await listPosters()).slice(0, each).map((p) => {
    const img = p.outputs?.at(-1) || p.bg || p.refs?.[0]?.file || "";
    return { kind: "이미지 소재", title: p.name || p.title || "이름 없는 소재", at: p.updated_at || "", thumb: img ? url("_posters", p.id, img) : "", href: `#poster/${p.id}` };
  });
  const clones = (await listClones()).slice(0, each).map((c) => ({
    kind: "영상 복제", title: c.title || "", at: c.updated_at || "", thumb: c.poster ? url("_clones", c.id, c.poster) : "", video: c.video ? url("_clones", c.id, c.video) : "", href: `#clone/${c.id}`,
  }));
  const dramas = (await listDramas("drama")).slice(0, each).map((d) => ({
    kind: "릴스", title: d.title || "제목 없음", at: d.updated_at || "", thumb: d.cover ? url("_dramas", d.id, d.cover) : "", href: `#drama/studio/${d.id}`,
  }));
  return { ads: ads.slice(0, nAds), adTotal: ads.length, posters, clones, dramas };
}

// 이미지 변형 메뉴의 에셋 — 광고 수집에서 [이미지 변형 에셋으로 저장]한 이미지 (prompts.json images[].asset_at) + 이미 변형을 만든 이미지
export async function variantAssets() {
  const out = [];
  for (const b of await listBrands()) {
    if (!b.adCount) continue;
    for (const a of await listAds(b)) {
      const pj = await readJson(path.join(brandDir(b), a.dir, "prompts.json"), null);
      for (const im of pj?.images || []) {
        if (!im.file || !im.image_prompt_en) continue;
        const vs = (pj.variants || []).filter((v) => v.image === im.file);
        if (!im.asset_at && !vs.length) continue; // [이미지 변형 에셋으로 저장]을 눌렀거나 이미 변형을 만든 이미지만
        out.push({
          brandId: b.id, brand: b.name, platform: b.platform, folder: b.folder, dir: a.dir, file: im.file,
          thumb: url(b.folder, a.dir, im.file), aspect: im.aspect || "",
          text: im.onscreen_text || a.body_text || a.title || "", prompt_ko: im.image_prompt_ko || "",
          subjects: (im.subjects || []).map((x) => x.label).filter(Boolean),
          variants: vs.length, last_variant: vs[0]?.title || "", at: vs[0]?.created_at || pj.created_at || a.collected_at || "",
        });
      }
    }
  }
  return out.sort((x, y) => y.at.localeCompare(x.at));
}
