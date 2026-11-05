// 이미지 광고 자동화 — 정해 둔 시간에 경쟁사 이미지 광고를 모으고, 새 광고 한 장마다 고객사 소재로 1:1 변형을 만들어 힉스필드로 뽑는다.
//   <DATA_DIR>/_autoflows/af_<시각>.json = { id, name, enabled, brands, client, resources, persona, colors, docs, links, aspects, model, resolution, quality, perBrand, maxMake, schedule, lastScheduled, runs }
// 한 번 돌 때: ① 경쟁사마다 새 이미지 광고 수집(collectBrand) → ② 이미지 프롬프트(registerVaryAsset) → ③ 1:1 변형(createVariant — 고객사 리소스를 참조로,
//   페르소나를 변형 아이디어로) → ④ 힉스필드 이미지(runHf, 변형 카드에 붙는다). 결과는 이미지 변형 메뉴에도 그대로 보인다.
// 크레딧 상한: 한 번에 광고 maxMake 개까지만 변형하고, 광고마다 고른 비율 수만큼 만든다 (최대 maxMake × 비율 수 장). 화면(public/autoflow.js)에서 켜 둔 것만 일정에 돈다. 일정은 앱(server.js)이 켜져 있을 때만 확인한다.
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, brandDir, getBrand, readJson, writeJson } from "./store.js";
import { collectBrand } from "./collect.js";
import { createVariant, registerVaryAsset } from "./prompts.js";
import { runHf } from "./hfjobs.js";
import { listClients, listResources, resourcePath, resourceImage } from "./resources.js";
import { askClaude, extractJson } from "./claude.js";

export const AUTOFLOWS_DIR = path.join(DATA_DIR, "_autoflows");
const fileOf = (id) => {
  if (!/^af_\d+$/.test(id)) throw new Error("잘못된 자동화 ID");
  return path.join(AUTOFLOWS_DIR, `${id}.json`);
};
const RES_KINDS = ["product", "person", "background"];
const RUNS_KEPT = 30;

// 예전 저장본은 aspect 하나 — aspects 로 읽는다
export const aspectsOf = (af = {}) => {
  const a = (Array.isArray(af.aspects) ? af.aspects : af.aspect ? [af.aspect] : []).map(String).filter(Boolean);
  return a.length ? [...new Set(a)].slice(0, 6) : ["1:1"];
};

// 화면에서 받은 값을 정해진 칸만 남겨 정리한다
function clean(b = {}, prev = {}) {
  const num = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || d));
  const res = Object.fromEntries(RES_KINDS.map((k) => [k, typeof b.resources?.[k] === "string" ? b.resources[k] : prev.resources?.[k] ?? "auto"]));
  const days = (Array.isArray(b.schedule?.days) ? b.schedule.days : prev.schedule?.days || [1, 2, 3, 4, 5]).map(Number).filter((d) => d >= 0 && d <= 6);
  const time = /^\d{2}:\d{2}$/.test(b.schedule?.time || "") ? b.schedule.time : prev.schedule?.time || "09:00";
  return {
    name: String(b.name ?? prev.name ?? "").trim().slice(0, 60) || "이름 없는 자동화",
    enabled: typeof b.enabled === "boolean" ? b.enabled : !!prev.enabled,
    brands: (Array.isArray(b.brands) ? b.brands : prev.brands || []).map(String).filter(Boolean),
    client: typeof b.client === "string" ? b.client : prev.client || "",
    resources: res, // 종류마다 리소스 ID · "auto"(고객사 폴더의 첫 번째) · ""(안 씀)
    persona: typeof b.persona === "string" ? b.persona : prev.persona ?? "auto",
    colors: typeof b.colors === "string" ? b.colors : prev.colors ?? "auto", // 브랜드 컬러 리소스 ID · "auto"(폴더의 첫 컬러) · ""(안 씀)
    aspects: aspectsOf(Array.isArray(b.aspects) ? b : b.aspect ? { aspect: b.aspect } : prev), // 광고 하나를 비율마다 한 장씩
    model: String(b.model ?? prev.model ?? "gpt_image_2_5"),
    resolution: String(b.resolution ?? prev.resolution ?? ""),
    quality: String(b.quality ?? prev.quality ?? ""),
    perBrand: num(b.perBrand ?? prev.perBrand, 1, 20, 3),
    maxMake: num(b.maxMake ?? prev.maxMake, 1, 20, 3),
    note: String(b.note ?? prev.note ?? "").slice(0, 1000),
    approval: typeof b.approval === "boolean" ? b.approval : prev.approval ?? true,
    rules: (Array.isArray(b.rules) ? b.rules : prev.rules || []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 15), // 절대 규칙 — 기획·만들기 모두에 들어가고, 따옴표로 묶은 금지어는 기획안에서 검사한다
    callTarget: ["auto", "always", "never"].includes(b.callTarget) ? b.callTarget : prev.callTarget || "auto", // 카피에 타깃을 부르는 문구 — 기획이 정함 · 항상 · 안 함
    planMode: ["remix", "inspire", "follow"].includes(b.planMode) ? b.planMode : prev.planMode || "remix", // 기획 방식 — remix 요소별 바꾸기 · inspire 새 구성 · follow 구조 그대로
    targets: (Array.isArray(b.targets) ? b.targets : prev.targets || []).map((x) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 8), // 타깃 — 기획이 광고마다 하나를 고른다 (비면 페르소나의 타깃) // 만들기 전에 기획안을 사람이 승인 (기획 승인 화면)
    docs: (Array.isArray(b.docs) ? b.docs : prev.docs || []).map(String).filter((x) => /^res_\w+$/.test(x)).slice(0, 10), // 참고 문서 리소스 (md·txt)
    links: (Array.isArray(b.links) ? b.links : prev.links || []).map((x) => String(x).trim()).filter((x) => /^https?:\/\//i.test(x)).slice(0, 5), // 참고 링크 (구글 문서·시트·웹)
    schedule: { days: [...new Set(days)].sort(), time },
  };
}

export async function listAutoflows() {
  const names = (await fs.readdir(AUTOFLOWS_DIR).catch(() => [])).filter((n) => /^af_\d+\.json$/.test(n));
  const list = (await Promise.all(names.map((n) => readJson(path.join(AUTOFLOWS_DIR, n), null)))).filter(Boolean);
  return list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
export const getAutoflow = (id) => readJson(fileOf(id), null);
export async function createAutoflow(b) {
  await fs.mkdir(AUTOFLOWS_DIR, { recursive: true });
  const af = { id: `af_${Date.now()}`, ...clean(b), runs: [], created_at: new Date().toISOString(), since: new Date().toISOString() };
  await writeJson(fileOf(af.id), af);
  return af;
}
export async function updateAutoflow(id, b) {
  const af = await getAutoflow(id);
  if (!af) throw Object.assign(new Error("없음"), { status: 404 });
  const next = { ...af, ...clean(b, af) };
  // 켜거나 일정을 바꾸면 그때부터 센다 — 오늘 시각이 이미 지났다고 저장하자마자 돌지 않게
  if ((next.enabled && !af.enabled) || JSON.stringify(next.schedule) !== JSON.stringify(af.schedule)) next.since = new Date().toISOString();
  await writeJson(fileOf(id), next);
  // 비율을 바꾸면 아직 승인 안 한 기획안에도 맞춘다 (모델·해상도·품질은 만들 때 자동화 값을 읽는다)
  if (JSON.stringify(next.aspects) !== JSON.stringify(aspectsOf(af)))
    for (const p of await listPlans({ afId: id, status: "pending" })) { p.aspects = next.aspects; await savePlan(p); }
  return next;
}
export async function deleteAutoflow(id) { await fs.rm(fileOf(id), { force: true }); }

// ── 일정 — 요일 · 시각이 지났고 오늘 아직 안 돌았으면 돌 차례 (앱이 늦게 켜졌으면 그날 켜질 때 한 번)
//   단 그 시각이 since(만들기·켜기·일정 바꾸기) 보다 앞이면 건너뛴다 — 저장하자마자 크레딧을 쓰지 않게 ──
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export async function dueAutoflows(now = new Date()) {
  return (await listAutoflows()).filter((af) => af.enabled && af.brands?.length && af.schedule?.days?.includes(now.getDay()) && hhmm(now) >= af.schedule.time
    && af.lastScheduled !== dayKey(now) && !(af.since && slotOf(af, now) < new Date(af.since)));
}
const slotOf = (af, d) => { const x = new Date(d), [h, m] = af.schedule.time.split(":").map(Number); x.setHours(h, m, 0, 0); return x; };
export async function markScheduled(id, now = new Date()) {
  const af = await getAutoflow(id); if (!af) return;
  af.lastScheduled = dayKey(now); await writeJson(fileOf(id), af);
}
/** 다음에 돌 시각 (화면 표시용) */
export function nextRun(af, now = new Date()) {
  if (!af.enabled || !af.schedule?.days?.length) return null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    const [h, m] = af.schedule.time.split(":").map(Number); d.setHours(h, m, 0, 0);
    if (!af.schedule.days.includes(d.getDay())) continue;
    if (i === 0 && (af.lastScheduled === dayKey(now) || (af.since && d < new Date(af.since)))) continue;
    return (i === 0 && d < now ? now : d).toISOString();
  }
  return null;
}

// ── 참고 링크 읽기 — 구글 문서·시트·슬라이드는 글자 내보내기 주소로 바꿔 받는다 (공유가 "링크가 있는 모든 사용자"여야 한다) ──
function exportUrl(u) {
  const m = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
  if (!m) return u;
  const gid = u.match(/[#&?]gid=(\d+)/)?.[1];
  return m[1] === "document" ? `https://docs.google.com/document/d/${m[2]}/export?format=txt`
    : m[1] === "spreadsheets" ? `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid ? `&gid=${gid}` : ""}`
    : `https://docs.google.com/presentation/d/${m[2]}/export/txt`;
}
const strip = (html) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
export async function readLink(url, max = 3000) {
  const r = await fetch(exportUrl(url), { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36" }, signal: AbortSignal.timeout(15_000) });
  if (/accounts\.google\.com|ServiceLogin/.test(r.url) || r.status === 401 || r.status === 403) throw new Error("공개 링크가 아닙니다 — 공유를 \"링크가 있는 모든 사용자\"로 바꾸세요");
  if (!r.ok) throw new Error(`받지 못했습니다 (${r.status})`);
  const raw = await r.text(), html = /html/i.test(r.headers.get("content-type") || "");
  if (html && /accounts\.google\.com\/(ServiceLogin|v3\/signin)/.test(raw)) throw new Error("공개 링크가 아닙니다 — 공유를 \"링크가 있는 모든 사용자\"로 바꾸세요");
  const title = html ? strip(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") : "";
  const text = (html ? strip(raw) : raw.trim()).slice(0, max);
  if (!text) throw new Error("글자를 찾지 못했습니다");
  const g = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)/)?.[1];
  return { title: title || (g ? { document: "구글 문서", spreadsheets: "구글 시트", presentation: "구글 슬라이드" }[g] : url), text };
}

// 로고 후보 — 고객사 폴더의 고객사 에셋 중 이미지가 있는 것 (이름에 "로고"가 들어간 것을 앞에)
const logoPool = (all) => all.filter((x) => x.kind === "asset" && x.files?.some((f) => f.kind === "image"))
  .sort((a, b) => /로고|logo/i.test(b.name) - /로고|logo/i.test(a.name)).map((x) => ({ id: x.id, name: x.name, description: x.description || "" }));

// ── 고객사 재료 고르기 ──
async function clientMaterials(af) {
  const all = (await listResources()).filter((r) => (af.client ? r.client === af.client : !r.client));
  const hasImg = (r) => r.files?.some((f) => f.kind === "image");
  const resources = {}, pool = {};
  for (const k of RES_KINDS) { // 기획이 고를 수 있는 후보 — 자동이면 폴더의 그 종류 전부, 지정이면 그것 하나, 안 씀이면 없음
    const v = af.resources?.[k];
    pool[k] = !v ? [] : all.filter((x) => x.kind === k && hasImg(x) && x.status !== "draft" && (v === "auto" || x.id === v)).map((x) => ({ id: x.id, name: x.name, description: x.description || "" }));
  }
  pool.logo = logoPool(all);
  for (const k of RES_KINDS) {
    const v = af.resources?.[k];
    if (!v) continue;
    const r = v === "auto" ? all.find((x) => x.kind === k && hasImg(x) && x.status !== "draft") : all.find((x) => x.kind === k && x.id === v);
    if (r) resources[k] = r.id;
  }
  let persona = null;
  const pr = af.persona === "auto" ? all.find((x) => x.kind === "target") : af.persona ? all.find((x) => x.kind === "target" && x.id === af.persona) : null;
  const md = pr?.files?.find((f) => /\.(md|txt)$/i.test(f.file));
  if (md) persona = { name: pr.name, text: (await fs.readFile(resourcePath("target", pr.id, md.file), "utf8").catch(() => "")).slice(0, 4000) };
  const cr = (af.colors ?? "auto") === "auto" ? all.find((x) => x.kind === "color" && x.colors?.length) : af.colors ? all.find((x) => x.kind === "color" && x.id === af.colors) : null;
  const colors = cr?.colors?.length ? { name: cr.name, list: cr.colors } : null;
  // 참고 자료 — 고른 문서(md·txt)와 링크. 합쳐 8000자까지, 못 읽은 링크는 warns 로 돌려준다
  const refs = [], warns = [];
  for (const id of af.docs || []) {
    const r = all.find((x) => x.id === id) || (await listResources()).find((x) => x.id === id);
    const f = r?.files?.find((x) => /\.(md|txt)$/i.test(x.file));
    if (!f) { warns.push(`참고 문서 ${r?.name || id}: md·txt 파일이 없습니다`); continue; }
    refs.push({ name: r.name, text: (await fs.readFile(resourcePath(r.kind, r.id, f.file), "utf8").catch(() => "")).slice(0, 3000) });
  }
  for (const u of af.links || []) {
    try { const x = await readLink(u); refs.push({ name: x.title, text: x.text }); } catch (e) { warns.push(`참고 링크 ${u}: ${e.message}`); }
  }
  let left = 8000; for (const x of refs) { x.text = x.text.slice(0, Math.max(0, left)); left -= x.text.length; }
  const client = af.client ? (await listClients()).find((c) => c.id === af.client) : null;
  return { resources, pool, persona, colors, refs: refs.filter((x) => x.text), warns, clientName: client?.name || pr?.name || "" };
}

const ROLE_KO = { main: "주색", sub: "보조색", accent: "강조색", bg: "바탕색", text: "글자색" };
const ROLE_EN = { main: "primary", sub: "secondary", accent: "accent", bg: "background", text: "text" };
const colorText = (list) => list.map((c) => `${c.hex}${c.role ? ` ${ROLE_KO[c.role]}` : ""}${c.name ? ` (${c.name})` : ""}`).join(", ");
// 비율마다 생성 프롬프트 끝에 붙인다 — 원본 광고의 빈 여백·다른 비율을 따라 하지 말고 그 비율 캔버스를 꽉 채운다
export function formatTail(aspect, colors) {
  const [w, h] = aspect.split(":").map(Number), shape = w === h ? "square" : w > h ? "landscape" : "vertical";
  return [
    `FORMAT: The final canvas is ${aspect} (${shape}). Re-compose the whole ad natively for this ${aspect} frame and fill it edge to edge: background, headline, sub copy, product, person and CTA bar spread to use the full height and width.`,
    `Do NOT copy any blank white bands, letterboxing, padding, empty margins or unused space from the reference ad, even if the reference has a different ratio. No large empty areas anywhere in the frame. Keep every text and key element fully inside the frame with a small safe margin — nothing cropped at the edges (banner and bar backgrounds themselves run to the edges).`,
    `ANCHORING: If the reference ad has a bottom banner / CTA strip / caption band, place it flush against the very bottom edge of the canvas — full width, touching the bottom edge with zero gap below it, never floating in the middle with scenery underneath. Likewise a top header bar or logo band touches the top edge. When the new ratio is taller or wider than the reference, extend the main scene (background, product, person) to fill the extra space between the top elements and the bottom banner — do not add filler (cabinets, floor, empty wall) below the bottom banner.`,
    colors?.list?.length ? `BRAND COLORS: ${colors.list.map((c) => `${c.hex}${c.role ? ` (${ROLE_EN[c.role]})` : ""}`).join(", ")}. Use these for headline highlights, the CTA bar, badges and accents instead of the competitor's colors.` : "",
  ].filter(Boolean).join("\n");
}

// 형식·색 규칙 — 자동 변형과 승인한 기획 모두에 붙는다
function formatRules(m, aspects) {
  return [
    `원본 이미지에 위아래·좌우로 빈 여백(흰 띠·레터박스·안 쓴 공간)이 있거나 비율이 달라도 그 여백은 따라 하지 않는다. 결과는 정한 비율(${aspects.join("·")})의 화면 전체를 내용으로 채우도록 다시 배치하고, 글자·제품·인물이 잘리지 않게 한다. 원본에 하단 띠(행동 유도 버튼·문구 띠)가 있으면 늘 화면 맨 아래 끝에 붙이고(아래에 아무것도 없게), 상단 로고·머리 띠는 맨 위에 붙인다. 늘어난 공간은 띠 아래가 아니라 가운데 장면을 키워 채운다.`,
    m.colors ? `[브랜드 컬러 — ${m.colors.name}] ${colorText(m.colors.list)}. 헤드라인 강조·버튼(행동 유도 띠)·포인트 색은 이 색으로 바꾸고, 원본 경쟁사의 브랜드 색은 쓰지 않는다.` : "",
  ];
}
const refsText = (m) => m.refs?.length ? `[참고 자료 — 카피·소구점을 정할 때 참고만 한다. 자료에 적힌 사실·숫자만 쓰고, 자료끼리 다르면 페르소나를 따른다]\n${m.refs.map((x) => `### ${x.name}\n${x.text}`).join("\n\n")}` : "";

// 변형 아이디어 — 원본의 구조는 두고 광고주를 고객사로 바꾼다. 페르소나의 소구점·혜택·말투·금지어·행동 유도를 따른다
function ideaOf(m, af) {
  return [
    `이 경쟁사 광고를 ${m.clientName ? `"${m.clientName}"` : "우리 고객사"}의 광고로 1:1 변형한다. 원본의 구도·후킹 문구 구조·글자 배치·분위기는 그대로 두고, 광고주·제품·카피를 고객사 것으로 바꾼다.`,
    `원본 브랜드명·로고·경쟁사 제품은 남기지 않는다. 화면 글자는 아래 페르소나의 소구점·혜택·말투·행동 유도로 새로 쓰고, 금지어는 쓰지 않는다. 페르소나에 없는 숫자·가격·혜택은 지어내지 않는다.`,
    ...formatRules(m, aspectsOf(af)),
    af.note ? `[추가 지시]\n${af.note}` : "",
    refsText(m),
    m.persona ? `[고객사 페르소나 — ${m.persona.name}]\n${m.persona.text}` : "[고객사 페르소나 없음 — 원본 카피 구조만 살리고 혜택 숫자는 [혜택] 빈칸으로 둔다]",
  ].filter(Boolean).join("\n\n");
}

// ── 기획안 (승인 대기열) — <DATA_DIR>/_autoflows/plans/pl_*.json ──
//   status: pending(승인 대기) → approved(만들 차례) → making → made | error, 또는 dropped(버림)
//   plan: { mode(inspire 참고만 · follow 구조 따르기), concept, angle, why, borrow(원본에서 빌린 것), layout(새 배치), visual, copy:[{role,text,source}], resources:{product,person,background}, resource_reason }
export const PLANS_DIR = path.join(AUTOFLOWS_DIR, "plans");
const planFile = (id) => { if (!/^pl_\d+$/.test(id)) throw new Error("잘못된 기획 ID"); return path.join(PLANS_DIR, `${id}.json`); };
export async function listPlans({ status, afId } = {}) {
  const names = (await fs.readdir(PLANS_DIR).catch(() => [])).filter((n) => /^pl_\d+\.json$/.test(n));
  const all = (await Promise.all(names.map((n) => readJson(path.join(PLANS_DIR, n), null)))).filter(Boolean);
  const list = all.filter((p) => (!status || p.status === status) && (!afId || p.afId === afId)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  // 로고 칸이 생기기 전 기획안 — 고객사 폴더의 로고 후보를 채워 둔다 (저장은 고칠 때)
  if (list.some((p) => p.pool && !p.pool.logo)) {
    const res = await listResources();
    for (const p of list) if (p.pool && !p.pool.logo) p.pool.logo = logoPool(res.filter((r) => (p.client ? r.client === p.client : !r.client)));
  }
  return list;
}
export async function getPlan(id) {
  const p = await readJson(planFile(id), null);
  if (p?.pool && !p.pool.logo) p.pool.logo = logoPool((await listResources()).filter((r) => (p.client ? r.client === p.client : !r.client)));
  return p;
}
const savePlan = async (p) => { await fs.mkdir(PLANS_DIR, { recursive: true }); p.updated_at = new Date().toISOString(); await writeJson(planFile(p.id), p); return p; };
const CH_ACTIONS = ["유지", "바꾸기", "빼기", "더하기"];
// 레이아웃 변주 — 원본 배치를 이렇게 비틀어 같은 광고처럼 안 보이게. 기획이 1~3개 고르고 최근 기획과 다른 조합을 쓴다
export const LAYOUT_OPS = [
  ["좌우 반전", "원본 배치를 좌우로 뒤집는다 — 왼쪽에 있던 요소는 오른쪽으로 (글자는 정방향)"],
  ["위아래 바꾸기", "위쪽 덩어리와 아래쪽 덩어리의 자리를 바꾼다 (하단 행동 유도 띠는 맨 아래 유지)"],
  ["주인공 크게", "제품이나 인물을 화면의 절반 이상으로 크게 당겨 잡는다 (클로즈업)"],
  ["분할 구도", "화면을 2단 또는 2컷(전/후·비교)으로 나눈다"],
  ["박스 모양 바꾸기", "글자를 감싸는 박스·배지·띠의 모양을 원본과 다른 형태로 (티켓→라운드 카드, 알약→말풍선, 사각 띠→리본 배너, 원형 배지→별 스티커 등)"],
  ["배경 바꾸기", "원본과 다른 실제 공간·상황 배경으로 (거실·사무실·매장·차 안 등 타깃의 생활 장면)"],
  ["어두운 바탕", "밝은 원본이면 짙은 바탕에 밝은 글자로 (또는 그 반대) 톤을 뒤집는다"],
  ["대각선 구도", "요소를 대각선 흐름으로 배치해 움직임을 준다"],
];
// 규칙에서 금지어 뽑기 — 따옴표로 묶은 말, 또는 "○○라는 키워드/단어/표현"
export function bannedOf(rules = []) {
  const out = new Set();
  for (const r of rules) {
    if (!/(쓰지|금지|사용하지|넣지|말 것|않는다|안 ?한다|안 ?쓴다|빼)/.test(r)) continue;
    for (const m of r.matchAll(/["'“”‘’「」『』]([^"'“”‘’「」『』]{1,30})["'“”‘’「」『』]/g)) out.add(m[1].trim());
    for (const m of r.matchAll(/([가-힣A-Za-z0-9·]{2,20})(?:이)?라는 ?(?:키워드|단어|표현|말)/g)) out.add(m[1].trim());
  }
  return [...out].filter(Boolean);
}
export function ruleHits(plan, rules = []) {
  const text = [plan.concept, plan.visual, ...(plan.copy || []).map((c) => c.text), ...(plan.changes || []).map((c) => c.to)].join("\n");
  return bannedOf(rules).filter((w) => text.includes(w));
}
const COPY_ROLES = ["타깃 호명", "제목", "부제", "배지", "라벨", "가격·혜택", "행동 유도", "브랜드", "기타"];
function cleanPlan(x = {}, pool = {}) {
  const ok = (k, id) => (id && (pool[k] || []).some((r) => r.id === id) ? id : "");
  return {
    mode: ["remix", "inspire", "follow"].includes(x.mode) ? x.mode : "remix",
    // 요소별 바꾸기 — 원본 요소 하나마다 유지·바꾸기·빼기 (+ 더하기 = 새로 넣는 비주얼)
    changes: (Array.isArray(x.changes) ? x.changes : []).map((c) => ({ el: String(c?.el || "").slice(0, 120), action: CH_ACTIONS.includes(c?.action) ? c.action : "바꾸기", to: String(c?.to || "").slice(0, 300) })).filter((c) => c.el || c.to).slice(0, 18),
    concept: String(x.concept || "").slice(0, 200), angle: String(x.angle || "").slice(0, 120), why: String(x.why || "").slice(0, 600),
    borrow: String(x.borrow || "").slice(0, 400), layout: String(x.layout || "").slice(0, 1200),
    target: String(x.target || "").slice(0, 160),
    callTarget: !!x.callTarget, // 카피에 타깃 명시 (타깃 호명 문구)
    ops: (Array.isArray(x.ops) ? x.ops : []).map(String).filter((o) => LAYOUT_OPS.some(([k]) => k === o)).slice(0, 4), // 레이아웃 변주
    visual: String(x.visual || "").slice(0, 1200),
    copy: (Array.isArray(x.copy) ? x.copy : []).map((c) => ({ role: COPY_ROLES.includes(c?.role) ? c.role : "기타", text: String(c?.text || "").slice(0, 200), source: String(c?.source || "").slice(0, 200) })).filter((c) => c.text).slice(0, 10),
    resources: Object.fromEntries([...RES_KINDS, "logo"].map((k) => [k, ok(k, x.resources?.[k])])), // logo: 고객사 에셋 로고 · "" 이면 이름을 글자로
    resource_reason: String(x.resource_reason || "").slice(0, 600),
  };
}
/** 화면에서 고친 기획 — 고칠 수 있는 칸만 받는다 */
export async function updatePlan(id, b = {}) {
  const p = await getPlan(id); if (!p) throw Object.assign(new Error("없음"), { status: 404 });
  if (["making"].includes(p.status)) throw Object.assign(new Error("만드는 중에는 고칠 수 없습니다"), { status: 409 });
  if (b.plan) p.plan = cleanPlan({ ...p.plan, ...b.plan }, p.pool);
  if (Array.isArray(b.aspects) && b.aspects.length) p.aspects = aspectsOf({ aspects: b.aspects });
  if (b.note !== undefined) p.note = String(b.note).slice(0, 1000);
  if (b.status && ["pending", "approved", "dropped"].includes(b.status)) {
    if (b.status === "approved" && !["pending", "error", "made"].includes(p.status)) throw Object.assign(new Error("승인할 수 없는 상태입니다"), { status: 409 });
    p.status = b.status; if (b.status === "approved") { p.approved_at = new Date().toISOString(); delete p.error; }
  }
  return savePlan(p);
}

// 기획 한 건 — Claude 가 원본 분석 + 페르소나 + 후보 리소스 + 최근 기획(겹치지 않게)을 보고 JSON 으로 짠다
// 기획 방식마다 원칙 1번이 다르다 — remix 는 메타광고 수집기 이미지 변형에서 사람이 쓰던 방식 (요소마다 무엇을 무엇으로)
const MODE_RULES = {
  remix: `1. 원본의 구도·정보량·분위기는 살리고, 원본 요소를 하나씩 "유지 / 바꾸기 / 빼기"로 정한다 — changes 에 원본의 모든 요소(인물·제품·배경·소품·말풍선·배지·로고·색·글자 덩어리)를 빠짐없이 한 줄씩. 바꾸기는 "무엇으로"를 구체적으로 (예: "누워 있는 여성 → 책상에 앉아 고민하는 정장 차림 여성", "공유기 → 정수기", "원본 로고 → 고객사 로고, 왼쪽 위", "노랑 강조 → 브랜드 주색"). 빼기는 고객사 이야기에 안 맞을 때만 — 통째로 비우지 않는다.
1-0. 요소마다 모양·스타일도 바꾼다 — 감싸는 박스의 형태(티켓→라운드 카드, 알약→말풍선, 사각 띠→리본 배너, 원형 배지→별 스티커 등), 글자 스타일, 장식, 색 조합. 원본과 같은 박스 모양·같은 색 조합을 그대로 쓰는 건 "유지"로 정한 요소뿐이다. 바꾸기의 to 에는 "무엇으로 + 어떤 모양·스타일로"를 같이 적는다.
1-1. 더하기(action "더하기", el 은 "새 비주얼")로 이야기를 살리는 비주얼을 1~2개 제안한다 — 예: 체크리스트 메모(✓포장이사 ✓전입신고 ☐정수기), 카톡 말풍선("다른 데는 더 준대요"), 2컷 비교(전/후), 같은 제품 2대 + 50%/100% 게이지, 후기 카드 자리, 별표 강조. 원본에 이미 비슷한 게 있으면 그걸 바꾸기로.
1-2. copy 는 원본 글자 덩어리마다 하나씩 대응 (source 에 원본 글자). 빼기로 정한 글자 덩어리는 copy 에 넣지 않는다.
1-3. layout 은 "원본 배치 유지 — 바뀌는 점만" 한두 문장, borrow 는 원본의 광고 유형·훅 구조.`,
  inspire: `1. 원본은 참고다, 베끼지 않는다. 빌리는 것: 광고 유형(비교형·문제 해결형·혜택 강조형 등), 정보 순서(무엇을 먼저 말하나), 훅의 구조 — borrow 에 적는다. 빌리지 않는 것: 레이아웃, 글자 위치·크기·박스 모양, 요소 배치, 제품 연출(빛 효과·소품·각도), 색. layout 에 원본과 확실히 다른 새 배치를 적는다 (예: 원본이 제품 왼쪽·글자 오른쪽이면 제품 가운데 크게·글자 위아래 등). 나란히 놓아도 같은 광고로 보이면 안 된다.
1-1. copy 는 3~6개 — 원본 글자 개수를 맞추지 않는다. 고객사에 필요한 말만. source 에는 참고한 원본 문구가 있으면 적고 없으면 "". 고객사 이름은 브랜드 자리 하나로.
1-2. 제품은 원본의 연출을 따라 하지 말고 고객사 제품이 잘 보이게 둔다. 단, 흰 배경에 제품과 글자만 있는 단조로운 화면은 금지 — 타깃의 생활 장면 배경(거실·사무실·매장 등)이나 색면 배경, 소품, 그래픽 요소(말풍선·체크리스트·배지·도형·아이콘), 앞뒤 깊이감 중 3가지 이상으로 풍성하게 만든다. changes 는 [] 로 둔다.`,
  follow: `1. 구도와 글자 배치 구조(요소 수·역할·위치)는 원본을 그대로 따른다. copy 는 원본 글자 요소 하나에 하나씩, source 에 원본 글자를 적는다. changes 에 바뀌는 요소만 적는다.`,
};
async function draftPlan(af, m, brand, dir, im, recent, hint = "", mode = af.planMode || "remix", retried = false) {
  const cand = [...RES_KINDS, "logo"].map((k) => `- ${{ product: "제품", person: "인물", background: "배경", logo: "로고" }[k]}: ${(m.pool[k] || []).map((r) => `${r.id} "${r.name}"${r.description ? ` — ${r.description}` : ""}`).join(" / ") || "(쓸 수 없음)"}`).join("\n");
  const prompt = [
    `너는 퍼포먼스 광고 기획자다. 경쟁사 이미지 광고 한 장을 "${m.clientName || "고객사"}" 광고로 1:1 변형하기 전에 기획안을 짠다. 원본 이미지는 ${im.file} 이다 (Read 로 본다).`,
    `[원본 분석]\n화면 글자:\n${im.onscreen_text || "(없음)"}\n글자 배치: ${im.text_layout || ""}\n등장 요소: ${JSON.stringify(im.subjects || [])}\n글자 요소: ${JSON.stringify((im.text_elements || []).map((t) => ({ text: t.text, role: t.role })))}`,
    `[원칙]
${MODE_RULES[mode] || MODE_RULES.remix}
2. 기획 각도는 아래 [최근 기획]과 겹치지 않게 고른다 — 다른 소구점, 다른 헤드라인 문장. 원본 광고가 말하는 기능·상황(예: 원본이 비데면 위생·생활 편의)을 살려 고객사 이야기로 잇는 게 좋다. 같은 문장 재사용 금지.
3. 리소스는 원본 장면에 그 역할이 있을 때만 쓴다 (remix 에서 인물을 바꾸기로 정했으면 인물 리소스를 쓸 수 있다). 원본에 사람이 없으면 인물은 "" (안 씀). 원본 제품 자리에 가장 맞는 제품 하나. 배경은 원본 배경을 바꿔야 할 때만. 후보 목록에 있는 ID 만 쓴다.
4. 페르소나 금지어를 지키고, 페르소나·참고 자료에 없는 숫자·가격·혜택은 지어내지 않는다. 원본의 가격 배지 같은 숫자 자리는 확인된 혜택 문구(숫자 없이)로 바꾼다.
4-1. 고객사 로고가 후보에 있으면 브랜드 자리에 로고를 쓴다 (resources.logo 에 ID). 이때 copy 의 브랜드 문구는 로고와 같은 이름을 반복하지 말고 꼭 필요한 보조 문구(예: "공식대리점 상담")만 남기거나 뺀다. 로고 후보가 없으면 "" — 이름을 글자로 쓴다.
5. 카피는 짧게 — 제목 20자 안팎, 라벨·배지 8자 안팎. 한국어.
6. visual·why·resource_reason 에는 리소스 ID 대신 이름을 쓴다 (사람이 읽는다). ID 는 resources 칸에만.`,
    `[쓸 수 있는 리소스]\n${cand}`,
    m.colors ? `[브랜드 컬러 — 색은 이것만 쓴다. 원본 경쟁사 색은 쓰지 않는다]\n${colorText(m.colors.list)}` : "",
    af.targets?.length ? `[타깃 — 이 중 이 원본에 가장 맞는 하나를 target 에 그대로 적는다. 최근 기획이 쓴 타깃과 다른 것을 우선한다. 카피의 말투·상황·장면을 그 타깃에 맞춘다]\n${af.targets.map((t) => `- ${t}`).join("\n")}` : `[타깃] 페르소나의 타깃 고객 중 하나를 골라 target 에 적고, 카피·장면을 그 사람에 맞춘다.`,
    recent.length ? `[최근 기획 — 겹치지 말 것]\n${recent.map((r) => `- ${r.concept} / 제목 "${r.title}"${r.target ? ` / 타깃 ${r.target}` : ""}${r.ops ? ` / 변주 ${r.ops}` : ""}`).join("\n")}` : "",
    `[레이아웃 변주 — 이 중 1~3개를 골라 ops 에 적는다. 최근 기획과 다른 조합을 쓴다${mode === "follow" ? " (구조 따르기 방식이면 박스 모양 바꾸기·어두운 바탕 정도만)" : ""}]\n${LAYOUT_OPS.map(([k, d]) => `- ${k}: ${d}`).join("\n")}`,
    `[타깃 명시] ${{ always: `copy 에 타깃을 부르는 문구를 꼭 하나 넣는다 — role "타깃 호명" (예: "보험·상조 영업하는 분들께", "이사 앞둔 분이라면"). callTarget 은 true.`, never: `타깃을 글로 직접 부르지 않는다 — "타깃 호명" 문구 없이. callTarget 은 false.` }[af.callTarget] || `타깃을 직접 불러 주는 게 효과적이면 role "타깃 호명" 문구를 넣고 callTarget true, 아니면 false.`} 호명은 직업·상황으로만 부르고, 보는 사람의 재정 상태·약점을 단정하지 않는다.`,
    af.rules?.length ? `[절대 규칙 — 어기면 안 된다. 카피·장면·요소 모두에 적용]\n${af.rules.map((r) => `- ${r}`).join("\n")}` : "",
    hint ? `[사람이 요청한 수정 방향 — 꼭 반영]\n${hint}` : "",
    af.note ? `[자동화 추가 지시]\n${af.note}` : "",
    refsText(m),
    m.persona ? `[고객사 페르소나 — ${m.persona.name}]\n${m.persona.text}` : "[페르소나 없음]",
    `JSON 하나만 답한다:
{"mode":"${mode}","concept":"한 줄 기획","target":"고른 타깃","callTarget":true,"angle":"쓴 소구점 이름","why":"이 원본을 참고한 이유와 이 각도가 맞는 이유 한두 문장","borrow":"원본에서 빌린 것 (유형·정보 순서·훅 구조)","layout":"새 배치 — 헤드라인·제품·인물·행동 유도가 화면 어디에 어떤 크기로 (원본과 다르게)","visual":"장면 연출 — 배경·조명·제품 연출·분위기","changes":[{"el":"원본 요소 (예: 왼쪽 인물 — 누워 있는 20대 여성)","action":"유지|바꾸기|빼기|더하기","to":"무엇으로 (바꾸기·더하기일 때)"}],"ops":["레이아웃 변주 이름"],"copy":[{"role":"${COPY_ROLES.join("|")}","text":"새 문구","source":"원본 문구"}],"resources":{"product":"ID 또는 \"\"","person":"ID 또는 \"\"","background":"ID 또는 \"\"","logo":"ID 또는 \"\""},"resource_reason":"리소스를 이렇게 고른 이유"}`,
  ].filter(Boolean).join("\n\n");
  const { text } = await askClaude(prompt, { cwd: path.join(brandDir(brand), dir), timeoutMs: 5 * 60_000 });
  let plan = cleanPlan({ ...extractJson(text), mode }, m.pool); // 방식은 요청한 것으로 고정 (Claude 가 다른 값을 적어도)
  // 규칙의 금지어가 들어갔으면 한 번 더 짜게 하고, 그래도 남으면 경고를 단다 (화면에 빨간 표시)
  let hits = ruleHits(plan, af.rules);
  if (hits.length && !retried) return draftPlan(af, m, brand, dir, im, recent, `${hint ? `${hint}\n` : ""}앞 기획안이 절대 규칙을 어겼다 — 금지어 ${hits.map((w) => `"${w}"`).join(", ")} 를 카피·장면 어디에도 쓰지 말고 다시 짠다.`, mode, true);
  if (hits.length) plan.warn = `규칙 위반: ${hits.join(", ")}`;
  return plan;
}
const recentPlans = async (afId, exceptId) => (await listPlans({ afId })).filter((p) => p.id !== exceptId && p.status !== "dropped" && p.plan?.concept).slice(0, 12)
  .map((p) => ({ concept: p.plan.concept, target: p.plan.target || "", ops: (p.plan.ops || []).join("·"), title: p.plan.copy?.find((c) => c.role === "제목")?.text || p.plan.copy?.[0]?.text || "" }));

/** 수집한 광고 하나로 기획안을 만든다 (이미지 크레딧 없음 — Claude 만) */
export async function planAd(af, m, brand, dir, emit = () => {}) {
  emit({ message: `② ${brand.name} ${dir} 원본 분석` });
  await registerVaryAsset(brand, dir, emit);
  const pj = await readJson(path.join(brandDir(brand), dir, "prompts.json"), {});
  const im = (pj.images || []).find((x) => x.image_prompt_en);
  if (!im) throw new Error("이미지 프롬프트가 없습니다");
  emit({ message: `③ ${brand.name} ${dir} 기획안 짜는 중 (Claude, 1분 안팎)` });
  const plan = await draftPlan(af, m, brand, dir, im, await recentPlans(af.id));
  const p = { id: `pl_${Date.now()}`, afId: af.id, afName: af.name, client: af.client, clientName: m.clientName, brandId: brand.id, brandName: brand.name, folder: brand.folder, dir, image: im.file,
    status: "pending", plan, planned: { ...plan.resources }, pool: m.pool, aspects: aspectsOf(af), note: "", created_at: new Date().toISOString() };
  await savePlan(p);
  emit({ message: `기획안: ${plan.concept}` });
  return p;
}
/** 이 자동화의 경쟁사들이 모아 둔 이미지 광고 — 고른 광고로 기획안을 만들 때 (광고 자동화 [수집한 광고에서 고르기]) */
export async function collectedAds(id) {
  const af = await getAutoflow(id); if (!af) throw Object.assign(new Error("없음"), { status: 404 });
  const plans = await listPlans({ afId: id }), out = [];
  for (const bid of af.brands || []) {
    const brand = await getBrand(bid); if (!brand) continue;
    const dirs = (await fs.readdir(brandDir(brand)).catch(() => [])).filter((n) => /^ph_[\w-]+$/.test(n));
    for (const dir of dirs) {
      const ad = await readJson(path.join(brandDir(brand), dir, "ad.json"), {});
      const files = (await fs.readdir(path.join(brandDir(brand), dir)).catch(() => [])).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
      if (!files.length) continue;
      const pl = plans.find((p) => p.brandId === bid && p.dir === dir);
      out.push({ brandId: bid, brandName: brand.name, folder: brand.folder, dir, image: files[0], text: String(ad.body_text || "").slice(0, 120), start_date: ad.start_date || "", collected_at: ad.collected_at || "", plan: pl ? { id: pl.id, status: pl.status } : null });
    }
  }
  return out.sort((a, b) => (b.collected_at || "").localeCompare(a.collected_at || ""));
}
/** 고른 광고들로 기획안 만들기 (Claude 만 — 이미지 크레딧 없음) */
export async function planPicked(id, ads = [], emit = () => {}) {
  const af = await getAutoflow(id); if (!af) throw new Error("자동화를 찾지 못했습니다");
  const m = await clientMaterials(af);
  let n = 0; const errors = [];
  for (const { brandId, dir } of ads.slice(0, 10)) {
    if (!/^ph_[\w-]+$/.test(dir || "")) continue;
    const brand = await getBrand(brandId);
    if (!brand || !(af.brands || []).includes(brandId)) { errors.push(`${dir}: 이 자동화의 경쟁사가 아닙니다`); continue; }
    try { await planAd(af, m, brand, dir, emit); n++; } catch (e) { errors.push(`${brand.name} ${dir}: ${e.message}`); emit({ level: "error", message: `${brand.name} ${dir}: ${e.message}` }); }
  }
  emit({ message: `고른 광고 기획 끝 — 기획안 ${n}개${errors.length ? ` · 오류 ${errors.length}` : ""} (기획 승인에서 확인하세요)` });
  return { type: "autoflow", id, planned: n, errors: errors.length };
}

/** 다시 기획 — hint(사람이 적은 방향)를 꼭 반영 */
export async function replan(id, hint = "", emit = () => {}) {
  const p = await getPlan(id); if (!p) throw new Error("기획을 찾지 못했습니다");
  const af = await getAutoflow(p.afId); if (!af) throw new Error("자동화가 지워졌습니다");
  const brand = await getBrand(p.brandId); if (!brand) throw new Error("경쟁사 등록이 지워졌습니다");
  const m = await clientMaterials(af);
  const pj = await readJson(path.join(brandDir(brand), p.dir, "prompts.json"), {});
  const im = (pj.images || []).find((x) => x.file === p.image);
  emit({ message: `다시 기획 — ${brand.name} ${p.dir}${hint ? ` (요청: ${hint.slice(0, 40)})` : ""}` });
  p.history = [...(p.history || []), { at: new Date().toISOString(), plan: p.plan }].slice(-5);
  p.plan = await draftPlan(af, m, brand, p.dir, im, await recentPlans(af.id, p.id), hint, p.plan?.mode || af.planMode || "remix");
  p.planned = { ...p.plan.resources }; p.pool = m.pool; p.status = "pending"; delete p.error;
  return savePlan(p);
}

/** 참고 자료·페르소나로 자동화 설정 채우기 — 편집 중인 값(draft)을 받아 타깃·추가 지시를 제안한다 (저장은 화면에서) */
export async function suggestSetup(draft = {}) {
  const af = { ...clean(draft), client: typeof draft.client === "string" ? draft.client : "" };
  const m = await clientMaterials(af);
  if (!m.refs.length && !m.persona) throw new Error("참고 자료나 페르소나가 없습니다 — 참고 문서를 고르거나 링크를 넣으세요");
  const prompt = [
    `너는 퍼포먼스 광고 기획자다. "${m.clientName || "고객사"}"의 이미지 광고 자동화를 설정한다. 아래 참고 자료와 페르소나만 근거로, 광고마다 돌아가며 쓸 타깃과 추가 지시를 제안한다.`,
    `[규칙]
1. targets: 3~6개. 한 줄에 한 타깃 — "누구(직업·나이대) — 상황·고민 — 이 사람에게 할 말의 방향". 자료에 세분화·광고 세트가 있으면 그 구분을 따른다. 자료에 없는 사람을 지어내지 않는다.
2. note: 이미지 광고를 만들 때 꼭 지킬 것 2~4문장 (자료의 금지 표현·주의·말투·행동 유도). 자료에 있는 것만.
3. 보는 사람의 재정 상태를 단정하는 표현("수입이 부족하시죠?")은 쓰지 않는다. 확인 안 된 숫자는 넣지 않는다.
4. sources: 무엇을 근거로 했는지 자료 이름.`,
    refsText(m),
    m.persona ? `[고객사 페르소나 — ${m.persona.name}]\n${m.persona.text}` : "",
    `JSON 하나만: {"targets":["..."],"note":"...","sources":["..."]}`,
  ].filter(Boolean).join("\n\n");
  const { text } = await askClaude(prompt, { timeoutMs: 4 * 60_000 });
  const j = extractJson(text);
  return {
    targets: (Array.isArray(j.targets) ? j.targets : []).map((x) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 8),
    note: String(j.note || "").slice(0, 1000), sources: (Array.isArray(j.sources) ? j.sources : []).map(String).slice(0, 8), warns: m.warns,
  };
}

const resName = (p, k) => (p.pool?.[k] || []).find((r) => r.id === p.plan.resources[k])?.name || "";
// 사람이 기획 카드에서 리소스를 바꿨으면 — 기획 글(장면 연출·요소별 바꾸기)은 예전 리소스 기준이라 이 지시가 우선한다
function resOverride(p, KO) {
  if (!p.planned) return "";
  const out = [];
  for (const k of RES_KINDS) {
    const was = p.planned[k] || "", now = p.plan.resources[k] || "";
    if (was === now) continue;
    if (now && !was) out.push(`- ${KO[k]} "${resName(p, k)}" 을(를) 새로 넣는다 — 기획 글에 자리가 없어도 꼭 넣는다. ${k === "person" ? "주인공 인물로 화면 한쪽에 크게 (상반신 이상), 카피를 가리지 않게." : k === "product" ? "제품 자리(가장 눈에 띄는 곳)에." : "배경 전체로."}`);
    else if (!now && was) out.push(`- ${KO[k]}: 빼기 — 기획 글에 ${KO[k]}이(가) 나와도 그 자리는 ${k === "product" ? "제품 없이 다른 요소(인물·카피)로 채운다. 제품을 새로 그려 넣지 않는다" : "비우거나 다른 요소로 채운다"}.`);
    else out.push(`- ${KO[k]}: "${resName(p, k)}" (으)로 바꾼다 — 기획 글의 ${KO[k]} 자리에 이것을 쓴다.`);
  }
  return out.length ? `[사람이 바꾼 리소스 — 위 기획 글보다 이것이 우선]\n${out.join("\n")}` : "";
}

// 승인한 기획 → 변형 아이디어 (화면 글자는 기획의 카피 그대로)
function ideaFromPlan(p, m, af) {
  const mode = p.plan.mode || "remix", inspire = mode === "inspire", remix = mode === "remix";
  const ch = (p.plan.changes || []).filter((c) => c.el || c.to);
  const KO = { product: "제품", person: "인물", background: "배경" };
  const used = RES_KINDS.filter((k) => p.plan.resources[k]), unused = RES_KINDS.filter((k) => !p.plan.resources[k]);
  return [
    remix
      ? `이 경쟁사 광고를 ${m.clientName ? `"${m.clientName}"` : "우리 고객사"}의 광고로 변형한다. 원본의 구도·정보량·분위기는 살리고, 아래 [요소별 바꾸기]대로 원본 요소를 하나씩 유지하거나 바꾸거나 뺀다. "빼기"로 적힌 것만 빼고 원본을 통째로 비우지 않는다. "더하기"는 새로 넣는 비주얼이다. 사람이 승인한 기획이다.`
      : inspire
      ? `경쟁사 광고를 참고해 ${m.clientName ? `"${m.clientName}"` : "우리 고객사"}의 새 광고를 만든다. 원본은 참고만 한다 — [원본에서 빌린 것]만 살리고, 구도·글자 위치·요소 배치·제품 연출·색은 아래 [새 레이아웃]과 [장면 연출]대로 새로 만든다. 원본의 배치·소품·효과를 따라 하지 않는다. 사람이 승인한 기획이다.`
      : `이 경쟁사 광고를 ${m.clientName ? `"${m.clientName}"` : "우리 고객사"}의 광고로 1:1 변형한다. 원본의 구도·글자 배치 구조는 따르고, 아래 사람이 승인한 기획을 그대로 반영한다.`,
    p.plan.target ? `[타깃] ${p.plan.target} — 이 사람이 "내 얘기"라고 느끼게 말투·상황·장면 분위기를 맞춘다${p.plan.resources.person ? "" : " (인물을 새로 넣으라는 뜻은 아니다)"}.` : "",
    p.plan.callTarget ? `[타깃 명시] "타깃 호명" 문구를 눈에 잘 띄게 (제목 바로 위 배지·띠 등) 넣어, 누구에게 하는 광고인지 한눈에 보이게 한다.` : `[타깃 명시 안 함] 타깃을 글로 직접 부르지 않는다.`,
    `[기획] ${p.plan.concept}${p.plan.angle ? ` (소구점: ${p.plan.angle})` : ""}${inspire && p.plan.borrow ? `\n[원본에서 빌린 것] ${p.plan.borrow}` : ""}${inspire && p.plan.layout ? `\n[새 레이아웃] ${p.plan.layout}` : remix && p.plan.layout ? `\n[배치] ${p.plan.layout}` : ""}\n[장면 연출] ${p.plan.visual}`,
    p.plan.ops?.length ? `[레이아웃 변주 — 꼭 반영]\n${p.plan.ops.map((o) => `- ${o}: ${LAYOUT_OPS.find(([k]) => k === o)?.[1] || ""}`).join("\n")}` : "",
    af.rules?.length ? `[절대 규칙 — 화면 글자·장면 어디에도 어기지 않는다]\n${af.rules.map((r) => `- ${r}`).join("\n")}` : "",
    remix ? `[스타일] 원본과 같은 박스 모양·색 조합을 그대로 쓰지 않는다 — 요소별 바꾸기에 적힌 모양·스타일과 브랜드 컬러로 다시 디자인한다.` : inspire ? `[풍성하게] 흰 배경에 제품·글자만 있는 단조로운 화면으로 만들지 않는다 — 장면 연출의 배경·소품·그래픽 요소를 살린다.` : "",
    ch.length ? `[요소별 바꾸기]\n${ch.map((c) => `- ${c.el || "새 비주얼"}: ${c.action}${c.to ? ` → ${c.to}` : ""}`).join("\n")}` : "",
    `[화면 글자 — 아래 문구를 글자 그대로 쓴다. 목록에 없는 글자는 넣지 않는다${inspire ? ". 위치는 [새 레이아웃]대로" : ", 원본의 같은 자리에"}]\n${p.plan.copy.filter((c) => c.text).map((c) => `- ${c.role}: "${c.text}"${!inspire && c.source ? ` (원본 "${c.source}" 자리)` : ""}`).join("\n")}`,
    `원본 브랜드명·로고·경쟁사 제품은 남기지 않는다.`,
    p.plan.resources.logo ? `[로고] 첨부한 고객사 로고 이미지를 브랜드 자리(${inspire ? "새 레이아웃에서 정한 곳, 없으면 왼쪽 위" : "원본 로고 자리"})에 모양·글자·색 그대로 얹는다. 로고를 다시 그리거나 글자로 바꾸지 않고, 같은 이름을 글자로 한 번 더 쓰지 않는다.` : `[로고] 로고 이미지는 쓰지 않는다 — 브랜드 자리에는 카피의 브랜드 문구를 글자로 쓴다.`,
    `[리소스] ${used.length ? `쓰는 것: ${used.map((k) => `${KO[k]}(${resName(p, k)})`).join("·")} — 첨부한 참조 이미지 그대로, 빠짐없이 화면에 크게 잘 보이게 넣는다.` : ""} ${unused.map((k) => `${KO[k]}: 쓰지 않음${k === "person" ? " — 원본에 없는 사람을 새로 넣지 않는다" : k === "product" ? " — 고객사 제품 사진은 넣지 않는다" : " — 원본 것을 고객사 톤에 맞게 둔다"}`).join(" / ")}`,
    resOverride(p, KO),
    ...formatRules(m, p.aspects),
    p.note ? `[승인할 때 덧붙인 지시]\n${p.note}` : "",
    af.note ? `[자동화 추가 지시]\n${af.note}` : "",
  ].filter(Boolean).join("\n\n");
}

/** 승인한 기획으로 이미지 만들기 — 비율마다 한 장 (크레딧) */
export async function makePlan(id, emit = () => {}) {
  const p = await getPlan(id); if (!p) throw new Error("기획을 찾지 못했습니다");
  const af = await getAutoflow(p.afId) || {};
  const brand = await getBrand(p.brandId); if (!brand) throw new Error("경쟁사 등록이 지워졌습니다");
  p.status = "making"; await savePlan(p);
  const tag = `${brand.name} ${p.dir}`;
  try {
    const m = await clientMaterials({ ...af, client: p.client });
    const resources = Object.fromEntries(RES_KINDS.filter((k) => p.plan.resources[k]).map((k) => [k, p.plan.resources[k]]));
    emit({ message: `④ ${tag} 변형 — ${p.plan.concept}` });
    // 참고만(inspire): 원본 이미지를 생성 모델에 넣지 않는다 — 넣으면 배치를 그대로 베낀다. 구조 따르기(follow)만 원본을 편집 기준으로 넣는다
    const follow = p.plan.mode === "follow", inspireMode = p.plan.mode === "inspire";
    const lg = p.plan.resources.logo ? await resourceImage("asset", p.plan.resources.logo) : null;
    const { vid } = await createVariant(brand, p.dir, { image: p.image, resources, idea: ideaFromPlan(p, m, af), attachOriginal: follow, inspire: inspireMode, logo: lg ? { file: lg.file, name: lg.res.name } : null }, emit);
    const pjf = path.join(brandDir(brand), p.dir, "prompts.json");
    const v = (await readJson(pjf, {})).variants?.find((x) => x.vid === vid);
    if (!v?.ref_text_en) throw new Error("변형 프롬프트가 비었습니다");
    const refs = [...(v.refs || [])].sort((a, b) => a.n - b.n).map((r) => r.file);
    const files = [], made = [], errs = [];
    for (const aspect of p.aspects) {
      try {
        emit({ message: `⑤ ${tag} 힉스필드 ${af.model || "gpt_image_2_5"} · ${aspect}` });
        const before = (await readJson(pjf, {})).variants?.find((x) => x.vid === vid)?.generated?.length || 0;
        await runHf({ type: "variant", brandId: brand.id, dir: p.dir, vid }, {
          kind: "image", purpose: "edit", prompt: `${v.ref_text_en}\n\n${formatTail(aspect, m.colors)}`, refs, imageModel: af.model || "gpt_image_2_5", aspect, resolution: af.resolution || "2k", quality: af.quality || "high", count: 1,
        }, emit);
        const gen = (await readJson(pjf, {})).variants?.find((x) => x.vid === vid)?.generated || [];
        for (const g of gen.slice(before)) { files.push(g.file); made.push(aspect); }
      } catch (e) { errs.push(`${aspect}: ${e.message}`); emit({ level: "error", message: `${tag} ${aspect}: ${e.message}` }); }
    }
    const done = (await readJson(pjf, {})).variants?.find((x) => x.vid === vid);
    p.made = { vid, title: done?.title || "", files, aspects: made, at: new Date().toISOString() };
    p.status = files.length ? "made" : "error"; if (errs.length) p.error = errs.join(" · "); else delete p.error;
  } catch (e) { p.status = "error"; p.error = e.message; emit({ level: "error", message: `${tag}: ${e.message}` }); }
  await savePlan(p);
  return p;
}
/** 승인한 기획을 차례로 전부 만든다 (서버가 비어 있을 때 부른다) */
export async function makeApproved(emit = () => {}) {
  let n = 0, imgs = 0;
  for (;;) {
    const [p] = (await listPlans({ status: "approved" })).sort((a, b) => (a.approved_at || "").localeCompare(b.approved_at || ""));
    if (!p) break;
    const r = await makePlan(p.id, emit); n++; imgs += r.made?.files?.length || 0;
  }
  return { type: "autoflow", made: imgs, plans: n };
}

/** 한 번 돌기. trigger: "schedule" | "manual" — 승인 켜짐: 기획안까지만 / 꺼짐: 기획안을 바로 만든다 */
export async function runAutoflow(id, { trigger = "manual" } = {}, emit = () => {}) {
  const af = await getAutoflow(id);
  if (!af) throw new Error("자동화를 찾지 못했습니다");
  if (!af.brands?.length) throw new Error("경쟁사를 고르세요");
  const started = Date.now(), approval = af.approval !== false;
  const run = { at: new Date().toISOString(), trigger, collected: 0, planned: [], made: [], errors: [], skipped: 0, approval };
  const err = (where, e) => { run.errors.push(`${where}: ${e.message || e}`); emit({ level: "error", message: `${where}: ${e.message || e}` }); };
  const m = await clientMaterials(af);
  for (const w of m.warns || []) err("참고 자료", new Error(w));
  emit({ message: `고객사 재료 — 후보 ${RES_KINDS.map((k) => `${{ product: "제품", person: "인물", background: "배경" }[k]} ${m.pool[k].length}`).join("·")} · 페르소나 ${m.persona ? m.persona.name : "없음"} · 컬러 ${m.colors ? m.colors.list.map((c) => c.hex).join(" ") : "없음"} · 참고 자료 ${m.refs?.length || 0}개` });

  // ① 수집 — 이미 받은 광고는 건너뛰므로 새 광고만 남는다
  const fresh = [];
  for (const bid of af.brands) {
    const brand = await getBrand(bid);
    if (!brand) { err(bid, new Error("등록이 지워진 경쟁사")); continue; }
    try {
      emit({ message: `① ${brand.name} 새 이미지 광고 수집 (최대 ${af.perBrand}개)` });
      const { saved } = await collectBrand(brand, { limit: af.perBrand, mediaType: "image", activeStatus: "active", whisper: false }, emit);
      run.collected += saved.length;
      for (const dir of saved) if (dir.startsWith("ph_")) fresh.push({ brand, dir });
    } catch (e) { err(`${brand.name} 수집`, e); }
  }
  run.collectedAds = fresh.map(({ brand, dir }) => ({ brandId: brand.id, brandName: brand.name, folder: brand.folder, dir }));
  if (!fresh.length) emit({ message: "새 이미지 광고가 없습니다" });

  // ②~③ 광고마다 기획안 — maxMake 개까지. 승인이 꺼져 있으면 바로 ④~⑤ 만들기
  for (const { brand, dir } of fresh) {
    if (run.planned.length >= af.maxMake) { run.skipped++; continue; }
    try {
      const p = await planAd(af, m, brand, dir, emit);
      run.planned.push(p.id);
      if (!approval) {
        const r = await makePlan(p.id, emit);
        if (r.made?.files?.length) run.made.push({ brandId: brand.id, brandName: brand.name, folder: brand.folder, dir, image: r.image, vid: r.made.vid, title: r.made.title, files: r.made.files, aspects: r.made.aspects, plan: p.id });
        if (r.error) err(`${brand.name} ${dir}`, new Error(r.error));
      }
    } catch (e) { err(`${brand.name} ${dir}`, e); }
  }
  run.took_s = Math.round((Date.now() - started) / 1000);
  const cur = await getAutoflow(id) || af;
  cur.runs = [run, ...(cur.runs || [])].slice(0, RUNS_KEPT);
  await writeJson(fileOf(id), cur);
  const imgs = run.made.reduce((n, x) => n + x.files.length, 0);
  emit({ message: `자동화 끝 — 새 광고 ${run.collected}개 · 기획안 ${run.planned.length}개${approval ? " (기획 승인에서 확인하세요)" : ` · 이미지 ${imgs}장`}${run.skipped ? ` · 상한으로 건너뜀 ${run.skipped}` : ""}${run.errors.length ? ` · 오류 ${run.errors.length}` : ""}` });
  return { type: "autoflow", id, made: imgs, planned: run.planned.length, collected: run.collected, errors: run.errors.length };
}
export { clientMaterials, ideaOf, ideaFromPlan }; // 시험·미리보기용
