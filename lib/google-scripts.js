// 유튜브 광고: Google 광고 투명성 센터(adstransparency.google.com)에서 뽑는 스크립트
// 광고 본체는 교차 출처 iframe 안이라 DOM 으로 못 읽는다. 대신 페이지가 쓰는
// GetCreativeById RPC 를 같은 페이지 안에서 불러 소재(content.js) 주소를 얻는다.
import { wrap } from "./browser-scripts.js";

const ATC = "https://adstransparency.google.com";

// 투명성 센터 RPC 의 지역 코드 (Google 지역 기준 ID)
export const GOOGLE_REGION = { KR: 2410, US: 2840, JP: 2392 };

const OPEN_SUGGESTIONS = `
  await page.goto("${ATC}/?region=" + P.country);
  await page.waitForSelector("input", { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll("input")].find((i) => i.offsetParent)?.focus());
  await page.keyboard.type(P.query);
  await page.waitForFunction(() => document.querySelectorAll("[role=option]").length > 0, undefined, { timeout: 15000 });
  await page.waitForTimeout(1500);
`;

/** 브랜드명 → 광고주 후보 */
export function searchGoogleAdvertisersScript({ query, country = "KR" }) {
  return wrap({ query, country }, `
${OPEN_SUGGESTIONS}
  const options = await page.evaluate(() =>
    [...document.querySelectorAll("[role=option]")].map((o, i) => ({ index: i, text: o.innerText.replace(/\\s+/g, " ").trim() })));
  done({ candidates: options });
`);
}

/** 후보 index → 광고주 ID (AR…) */
export function resolveGoogleAdvertiserScript({ query, index, country = "KR" }) {
  return wrap({ query, index, country }, `
${OPEN_SUGGESTIONS}
  const text = await page.evaluate((i) => document.querySelectorAll("[role=option]")[i]?.innerText.replace(/\\s+/g, " ").trim(), P.index);
  await page.click("[role=option] >> nth=" + P.index, { label: "pick advertiser" });
  await page.waitForURL(/\\/advertiser\\/AR\\d+/, { timeout: 20000 });
  const pageId = (await page.url()).match(/\\/advertiser\\/(AR\\d+)/)[1];
  done({ pageId, text });
`);
}

/** 광고주의 영상 광고 목록 → 각 광고의 소재 주소 */
export function collectGoogleAdsScript({ advertiserId, country = "KR", limit = 10, skipIds = [] }) {
  return wrap({ advertiserId, country, region: GOOGLE_REGION[country] || GOOGLE_REGION.KR, limit, skipIds }, `
  emit({ message: "광고 투명성 센터 여는 중" });
  await page.goto("${ATC}/advertiser/" + P.advertiserId + "?region=" + P.country + "&format=VIDEO");
  await page.waitForFunction(() => document.querySelector("a[href*='/creative/CR']") || /광고 0개|광고가 없습니다|No ads/.test((document.body?.innerText || "")), undefined, { timeout: 40000 });

  const list = () => page.evaluate(() => [...new Set([...document.querySelectorAll("a[href*='/creative/CR']")]
    .map((a) => a.getAttribute("href").match(/creative\\/(CR\\d+)/)?.[1]).filter(Boolean))]);

  let ids = [], prev = -1, stall = 0;
  while (true) {
    ids = await list();
    const fresh = ids.filter((id) => !P.skipIds.includes(id));
    emit({ message: "광고 " + ids.length + "개 발견 (새 광고 " + fresh.length + "개)" });
    if (fresh.length >= P.limit) break;
    if (ids.length === prev) { if (++stall >= 3) break; } else stall = 0;
    prev = ids.length;
    // 스크롤로 더 불러오고, "검색 결과 더보기" 버튼이 있으면 누른다
    await page.evaluate(() => {
      window.scrollTo(0, (document.body?.scrollHeight || 0));
      [...document.querySelectorAll("material-button, button, [role=button]")].find((b) => /더보기|See more|Show more/.test(b.innerText))?.click();
    });
    await page.waitForTimeout(2000);
  }

  const targets = ids.filter((id) => !P.skipIds.includes(id)).slice(0, P.limit);
  const ads = [];
  for (const [i, id] of targets.entries()) {
    emit({ message: "광고 " + (i + 1) + "/" + targets.length + " 정보 가져오는 중 (" + id + ")" });
    const body = "f.req=" + encodeURIComponent(JSON.stringify({ "1": P.advertiserId, "2": id, "5": { "1": 1, "2": 0, "3": P.region } }));
    const r = await page.fetch("/anji/_/rpc/LookupService/GetCreativeById?authuser=", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, timeout: 20000,
    });
    if (!r.ok) { emit({ level: "warn", message: id + ": 정보 요청 실패 " + r.status }); continue; }
    const c = JSON.parse(r.body)["1"] || {};
    ads.push({
      creativeId: id,
      advertiser: c["22"]?.["1"] || null,
      format: c["8"] ?? null,                       // 3 = 동영상
      lastShown: c["4"]?.["1"] ? Number(c["4"]["1"]) * 1000 : null,
      variants: (c["5"] || []).map((v) => v["1"]?.["4"]).filter(Boolean),
    });
  }
  done({ ads, totalOnPage: ids.length });
`);
}
