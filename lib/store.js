// 브랜드 목록과 수집 결과를 디스크에 둔다.
//   <DATA_DIR>/brands.json
//   <DATA_DIR>/<브랜드 폴더>/vd_<광고ID>/ · ph_<광고ID>/
// 브랜드는 플랫폼마다 따로 등록한다: meta (Page ID, 숫자) · youtube (광고주 ID, AR…) · instagram (IG<사용자 ID>, handle 에 아이디)
import fs from "node:fs/promises";
import path from "node:path";
import { readConfig, DEFAULT_DATA_DIR } from "./config.js";

// 저장 폴더: 환경변수 DATA_DIR > 설정 화면에서 고른 폴더(~/.ad-studio/config.json) > 기본 폴더
// 서버를 켤 때 한 번 정한다 — 설정 화면에서 바꾸면 서버가 다시 켜진다 (start.js)
const CONFIGURED = process.env.DATA_DIR || readConfig().dataDir;
export const DATA_DIR = path.resolve(CONFIGURED || DEFAULT_DATA_DIR);
export const DATA_DIR_SET = !!CONFIGURED;
const BRANDS_FILE = path.join(DATA_DIR, "brands.json");
export const AD_DIR_RE = /^(vd|ph)_([\w-]+)$/;
export const PLATFORMS = { meta: "메타", youtube: "유튜브", instagram: "인스타", manual: "직접 분석" };
const ID_RE = { meta: /^\d+$/, youtube: /^AR\d+$/, instagram: /^IG\d+$/ };

export const safeName = (s) => s.replace(/[\/\\:*?"<>|]/g, "_").trim();

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 1));

// 예전 형식(pageId 만 있음)은 메타 브랜드로 읽는다
async function readBrands() {
  return (await readJson(BRANDS_FILE, [])).map((b) => ({ platform: "meta", id: b.pageId, ...b }));
}

// 링크·업로드로 직접 분석한 것을 담는 고정 항목
export const MANUAL = { name: "직접 분석", platform: "manual", id: "manual", country: "KR", handle: "", folder: "직접 분석" };

export async function listBrands() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const brands = [{ ...MANUAL }, ...(await readBrands())];
  for (const b of brands) {
    const names = (await fs.readdir(brandDir(b)).catch(() => [])).filter((n) => AD_DIR_RE.test(n));
    b.adCount = names.length;
    b.typeCount = { vd: names.filter((n) => n.startsWith("vd_")).length, ph: names.filter((n) => n.startsWith("ph_")).length };
  }
  return brands;
}

export async function addBrand({ name, id, platform = "meta", country = "KR", handle = "" }) {
  if (!ID_RE[platform]) throw new Error("알 수 없는 플랫폼");
  if (!name?.trim() || !ID_RE[platform].test(id || "")) {
    throw new Error({ meta: "브랜드 이름과 숫자 Page ID 가 필요합니다", youtube: "브랜드 이름과 광고주 ID(AR…) 가 필요합니다", instagram: "이름과 인스타 계정 확인이 필요합니다" }[platform]);
  }
  const brands = await readBrands();
  if (brands.some((b) => b.id === id)) throw new Error("이미 등록된 계정입니다");
  const folder = safeName(name);
  if (folder === MANUAL.folder || brands.some((b) => b.folder === folder)) throw new Error(`폴더 이름 "${folder}" 가 이미 있습니다. 다른 이름을 쓰세요`);
  const brand = { name: name.trim(), platform, id, country, handle, folder, addedAt: new Date().toISOString(), lastCollectedAt: null };
  brands.push(brand);
  await fs.mkdir(path.join(DATA_DIR, folder), { recursive: true });
  await writeJson(BRANDS_FILE, brands);
  return brand;
}

/** 등록만 지운다. 수집한 폴더는 남긴다 */
export async function removeBrand(id) {
  await writeJson(BRANDS_FILE, (await readBrands()).filter((b) => b.id !== id));
}

export async function getBrand(id) {
  if (id === MANUAL.id) return MANUAL;
  return (await readBrands()).find((b) => b.id === id);
}

export async function touchBrand(id) {
  const brands = await readBrands();
  const b = brands.find((x) => x.id === id);
  if (b) { b.lastCollectedAt = new Date().toISOString(); await writeJson(BRANDS_FILE, brands); }
}

export const brandDir = (brand) => path.join(DATA_DIR, brand.folder);

export async function listAdIds(brand) {
  const names = await fs.readdir(brandDir(brand)).catch(() => []);
  return names.map((n) => n.match(AD_DIR_RE)?.[2]).filter(Boolean);
}

export async function listAds(brand) {
  const names = (await fs.readdir(brandDir(brand)).catch(() => [])).filter((n) => AD_DIR_RE.test(n));
  const ads = [];
  for (const dir of names) {
    const ad = await readJson(path.join(brandDir(brand), dir, "ad.json"), null);
    if (!ad) continue;
    const analysis = await readJson(path.join(brandDir(brand), dir, "analysis.json"), null);
    ads.push({ ...ad, dir, analysis });
  }
  return ads.sort((a, b) => (b.collected_at || "").localeCompare(a.collected_at || ""));
}

export { writeJson };
