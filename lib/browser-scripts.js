// ego-browser 안에서 돌릴 스크립트 문자열을 만든다.
// 각 스크립트는 하나의 TaskSpace 를 열고, 끝나면 finish() 로 닫는다.

const SPACE = "meta-ad-collector";
const LIB = "https://www.facebook.com/ads/library/";

// 공통 머리말: 이벤트 출력, 작업 공간, 종료 처리
export const wrap = (params, body) => `
const P = ${JSON.stringify(params)};
const emit = (o) => console.log("__EVT__" + JSON.stringify(o));
const done = (o) => console.log("__RESULT__" + JSON.stringify(o));
const task = await taskSpace(${JSON.stringify(SPACE)});
const page = task.page("p1");
try {
${body}
} catch (e) {
  done({ error: String(e && e.message || e) });
} finally {
  await task.finish({ keep: [] }).catch(() => {});
}
`;

// 광고주 검색창에 브랜드명을 넣고 추천 광고주 목록을 띄운다
const OPEN_SUGGESTIONS = `
  await page.goto("${LIB}?active_status=active&ad_type=all&country=" + P.country + "&q=" + encodeURIComponent(P.query) + "&search_type=keyword_unordered&media_type=all");
  await page.waitForSelector("input[type=search]", { timeout: 30000 });
  await page.click("input[type=search]", { label: "focus advertiser search" });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(P.query);
  await page.waitForFunction(() => document.querySelectorAll("[role=option]").length > 1, undefined, { timeout: 15000 });
  await page.waitForTimeout(1200);
`;

/** 브랜드명 → 광고주 후보 목록 */
export function searchAdvertisersScript({ query, country = "KR" }) {
  return wrap({ query, country }, `
${OPEN_SUGGESTIONS}
  const options = await page.evaluate(() =>
    [...document.querySelectorAll("[role=option]")].map((o, i) => ({ index: i, text: o.innerText.replace(/\\s+/g, " ").trim() })));
  // 0번은 "정확한 구문 검색" 이라 뺀다
  done({ candidates: options.filter((o) => !/구문 검색|exact phrase/i.test(o.text)) });
`);
}

/** 후보 index 를 눌러 Page ID 를 얻는다 */
export function resolveAdvertiserScript({ query, index, country = "KR" }) {
  return wrap({ query, index, country }, `
${OPEN_SUGGESTIONS}
  const text = await page.evaluate((i) => document.querySelectorAll("[role=option]")[i]?.innerText.replace(/\\s+/g, " ").trim(), P.index);
  await page.click("[role=option] >> nth=" + P.index, { label: "pick advertiser" });
  await page.waitForURL(/view_all_page_id=\\d+/, { timeout: 20000 });
  const pageId = new URL(await page.url()).searchParams.get("view_all_page_id");
  done({ pageId, text });
`);
}

/** 브랜드 Page 의 광고(keyword 가 있으면 키워드 검색 결과)를 스크롤로 불러와 카드별 데이터를 뽑는다 */
export function collectAdsScript({ pageId, keyword = "", country = "KR", mediaType = "all", activeStatus = "active", limit = 10, skipIds = [] }) {
  return wrap({ pageId, keyword, country, mediaType, activeStatus, limit, skipIds }, `
  // 페이지 안에서: "라이브러리 ID" 문구를 기준으로 광고 카드를 찾아 data-mac-id 를 붙인다
  const mark = () => {
    const re = /(?:라이브러리 ID|Library ID)\\s*[:：]\\s*(\\d+)/;
    const count = (el) => (el.textContent.match(/라이브러리 ID|Library ID/g) || []).length;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const ids = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/라이브러리 ID|Library ID/.test(n.nodeValue)) continue;
      const leaf = n.parentElement;
      const m = leaf.textContent.match(re) || leaf.parentElement?.textContent.match(re);
      if (!m || ids.includes(m[1])) continue;
      let card = leaf;
      while (card.parentElement && card.parentElement !== document.body && count(card.parentElement) === 1) card = card.parentElement;
      card.setAttribute("data-mac-id", m[1]);
      ids.push(m[1]);
    }
    // 카드마다 영상 여부를 같이 돌려준다 (Meta 의 media_type=image 필터는 결과가 비어 쓰지 않는다)
    return ids.map((id) => ({ id, video: !!document.querySelector('[data-mac-id="' + id + '"] video') }));
  };

  const extract = (id) => {
    const card = document.querySelector('[data-mac-id="' + id + '"]');
    if (!card) return null;
    const t = card.innerText;
    const preOf = (sel) => [...card.querySelectorAll(sel)]
      .filter((n) => getComputedStyle(n).whiteSpace === "pre-wrap" && n.innerText.trim())
      .sort((a, b) => b.innerText.length - a.innerText.length)[0];
    const pre = preOf("span") || preOf("div");
    const imgs = [...card.querySelectorAll("img")];
    const profile = imgs.find((i) => i.getBoundingClientRect().width <= 60);
    const images = [...new Set(imgs
      .filter((i) => i !== profile && i.getBoundingClientRect().width > 100 && !i.closest("video"))
      .map((i) => i.currentSrc || i.src))].filter(Boolean);
    const videos = [...card.querySelectorAll("video")].map((v) => ({ src: v.currentSrc || v.src || v.querySelector("source")?.src || "", poster: v.poster || "" }));
    const landing = [...card.querySelectorAll("a[href*='l.facebook.com/l.php']")]
      .map((a) => { try { return new URL(a.href).searchParams.get("u"); } catch { return null; } }).find(Boolean) || null;
    const date = t.match(/(\\d{4}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}\\.)에 게재 시작|Started running on ([A-Za-z]+ \\d{1,2}, \\d{4})/);
    return {
      libraryId: id,
      advertiser: profile?.alt || null,
      status: (t.match(/^(활성|비활성|Active|Inactive)$/m) || [])[1] || null,
      startDate: date ? (date[1] || date[2]).replace(/\\s+/g, " ") : null,
      bodyText: pre ? pre.innerText : "",
      landingUrl: landing,
      images, videos,
    };
  };

  const url = "${LIB}?active_status=" + P.activeStatus + "&ad_type=all&country=" + P.country
    + "&media_type=" + (P.mediaType === "video" ? "video" : "all")
    + (P.keyword ? "&q=" + encodeURIComponent(P.keyword) + "&search_type=keyword_unordered" : "&search_type=page&view_all_page_id=" + P.pageId);
  const wanted = (c) => !P.skipIds.includes(c.id) && (P.mediaType !== "image" || !c.video);
  emit({ stage: "open", message: "광고 라이브러리 여는 중" });
  await page.goto(url);
  await page.waitForFunction(() => /라이브러리 ID|Library ID|광고가 없습니다|No ads match/.test((document.body?.innerText || "")), undefined, { timeout: 40000 });

  // 새 광고가 limit 개 모일 때까지 스크롤
  let cards = [], prev = -1, stall = 0;
  while (true) {
    cards = await page.evaluate(mark);
    const fresh = cards.filter(wanted);
    emit({ stage: "scroll", message: "카드 " + cards.length + "개 발견 (조건에 맞는 새 광고 " + fresh.length + "개)" });
    if (fresh.length >= P.limit) break;
    if (!cards.length && await page.evaluate(() => /광고가 없습니다|No ads match/.test((document.body?.innerText || "")))) break;
    if (cards.length === prev) { if (++stall >= 3) break; } else stall = 0;
    prev = cards.length;
    await page.evaluate(() => window.scrollTo(0, (document.body?.scrollHeight || 0)));
    await page.waitForTimeout(1800);
  }

  const targets = cards.filter(wanted).slice(0, P.limit).map((c) => c.id);
  const ads = [];
  for (const [i, id] of targets.entries()) {
    emit({ stage: "extract", message: "광고 " + (i + 1) + "/" + targets.length + " 읽는 중 (" + id + ")" });
    await page.evaluate((id) => document.querySelector('[data-mac-id="' + id + '"]')?.scrollIntoView({ block: "center" }), id);
    await page.waitForTimeout(700);
    let ad = await page.evaluate(extract, id);
    // 영상 src 가 늦게 붙는 경우 한 번 더 기다린다
    if (ad && ad.videos.some((v) => !v.src)) { await page.waitForTimeout(2000); ad = await page.evaluate(extract, id); }
    if (ad) ads.push(ad);
  }
  done({ ads, totalOnPage: cards.length });
`);
}

// 아무 페이지나 열어 공유용 메타 태그(og:video·og:image 등)를 읽는다.
// yt-dlp 가 로그인을 요구할 때(인스타그램 등) 쓰는 우회 경로 — 이고 라이트 브라우저로 연다.
export function pageMediaScript({ url }) {
  return wrap({ url }, `
  await page.goto(P.url);
  await new Promise((r) => setTimeout(r, 4000));
  const r = await page.evaluate(() => {
    const og = (k) => document.querySelector('meta[property="og:' + k + '"]')?.content || "";
    const video = og("video:secure_url") || og("video") || [...document.querySelectorAll("video")].map((v) => v.currentSrc || v.src).find((s) => /^https?:/.test(s)) || "";
    return { video, image: og("image"), title: og("title"), description: og("description"), url: og("url") || location.href, site: og("site_name") };
  });
  done(r);
`);
}

// 인스타그램 게시물·릴스: 로그인된 이고 라이트 프로필로 열어 미디어 API 에서 원본 주소를 받는다.
// (로그인 안 된 페이지의 영상은 blob 이라 저장이 안 된다)
export function instagramMediaScript({ url }) {
  return wrap({ url }, `
  await page.goto(P.url);
  await new Promise((r) => setTimeout(r, 3000));
  const r = await page.evaluate(async () => {
    const code = location.pathname.match(/\\/(?:p|reel|reels|tv)\\/([\\w-]+)/)?.[1];
    if (!code) return { error: "게시물 주소가 아닙니다" };
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = 0n; for (const ch of code) id = id * 64n + BigInt(A.indexOf(ch));
    const res = await fetch("/api/v1/media/" + id + "/info/", { headers: { "x-ig-app-id": "936619743392459" }, credentials: "include" });
    if (!res.ok) return { error: "인스타 미디어 정보 " + res.status + " (이고 라이트 기본 프로필에 인스타 로그인이 필요합니다)" };
    const it = (await res.json()).items?.[0];
    if (!it) return { error: "게시물을 찾지 못했습니다" };
    const pick = (m) => ({ video: m.video_versions?.[0]?.url || "", image: m.image_versions2?.candidates?.[0]?.url || "" });
    return { code, user: it.user?.username, full_name: it.user?.full_name, caption: it.caption?.text || "", media: it.carousel_media?.length ? it.carousel_media.map(pick) : [pick(it)] };
  });
  done(r);
`);
}

// ── 인스타그램 계정 ─────────────────────────────────
// 로그인된 이고 라이트 기본 프로필로 연다. 사용자 ID(pk)는 프로필 페이지 HTML 의 profile_id 에서 읽는다.
export function resolveInstagramScript({ username }) {
  return wrap({ username }, `
  await page.goto("https://www.instagram.com/" + encodeURIComponent(P.username) + "/");
  await new Promise((r) => setTimeout(r, 3000));
  const r = await page.evaluate(() => {
    const html = [...document.scripts].map((s) => s.textContent).join("");
    const pk = html.match(/"profile_id":"(\\d+)"/)?.[1];
    const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
    const name = title.match(/^(.+?)\\s*\\(@/)?.[1] || "";
    const desc = document.querySelector('meta[property="og:description"]')?.content || "";
    return { pk, name, desc, notFound: /페이지를 찾을 수 없|isn't available/.test((document.body?.innerText || "").slice(0, 500)) };
  });
  if (r.notFound || !r.pk) done({ error: "계정을 찾지 못했습니다 (아이디 확인, 또는 이고 라이트 기본 프로필의 인스타 로그인 확인)" });
  else done(r);
`);
}

// 릴스 탭 그리드에서 조회수(대략값)를 모아 기준(중앙값)을 잡고, 고른 릴스만 미디어 API 로 정확한 숫자·영상 주소를 받는다
export function collectInstagramScript({ username, limit = 5, pick = "top", skipIds = [], sample = 36 }) {
  return wrap({ username, limit, pick, skipIds, sample }, `
  await page.goto("https://www.instagram.com/" + encodeURIComponent(P.username) + "/reels/");
  await new Promise((r) => setTimeout(r, 3500));
  const want = Math.max(P.sample, P.limit + P.skipIds.length);
  let grid = [], stale = 0;
  for (let round = 0; round < 25 && grid.length < want && stale < 3; round++) {
    const got = await page.evaluate(() => [...document.querySelectorAll('a[href*="/reel/"]')].map((a) => ({
      code: a.getAttribute("href").match(/\\/reel\\/([\\w-]+)/)?.[1], views: a.innerText.replace(/\\s+/g, " ").trim(),
    })).filter((x) => x.code));
    const before = grid.length;
    for (const g of got) if (!grid.some((x) => x.code === g.code)) grid.push(g);
    stale = grid.length === before ? stale + 1 : 0;
    emit({ message: "릴스 " + grid.length + "개 확인" });
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await new Promise((r) => setTimeout(r, 1500));
  }
  // "10만" "1.4만" "3,210" "12.5K" → 숫자
  const num = (s) => {
    const m = String(s).replace(/,/g, "").match(/([\\d.]+)\\s*(억|만|천|K|M|B)?/i);
    if (!m) return null;
    const mul = { "억": 1e8, "만": 1e4, "천": 1e3, k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
    return Math.round(parseFloat(m[1]) * mul);
  };
  grid = grid.map((g, i) => ({ ...g, order: i, approx: num(g.views) }));
  const vals = grid.map((g) => g.approx).filter((v) => v != null).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor(vals.length / 2)] : null;

  const fresh = grid.filter((g) => !P.skipIds.includes(g.code));
  const chosen = (P.pick === "top" ? [...fresh].sort((a, b) => (b.approx || 0) - (a.approx || 0)) : fresh).slice(0, P.limit);
  const items = [];
  for (const g of chosen) {
    emit({ message: "릴스 정보 받는 중 " + (items.length + 1) + "/" + chosen.length + ": " + g.code });
    const r = await page.evaluate(async (code) => {
      const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let id = 0n; for (const ch of code) id = id * 64n + BigInt(A.indexOf(ch));
      const res = await fetch("/api/v1/media/" + id + "/info/", { headers: { "x-ig-app-id": "936619743392459" }, credentials: "include" });
      if (!res.ok) return { error: "미디어 정보 " + res.status };
      const i = (await res.json()).items?.[0];
      if (!i) return { error: "게시물 없음" };
      return {
        code, taken_at: i.taken_at, plays: i.play_count ?? i.ig_play_count ?? null, likes: i.like_count ?? null, comments: i.comment_count ?? null,
        duration: i.video_duration ?? null, caption: i.caption?.text || "", user: i.user?.username, full_name: i.user?.full_name,
        video: i.video_versions?.[0]?.url || "", image: i.image_versions2?.candidates?.[0]?.url || "",
      };
    }, g.code);
    if (r.error) { emit({ level: "warn", message: g.code + ": " + r.error }); if (/429/.test(r.error)) break; continue; }
    items.push({ ...r, grid_views: g.views, order: g.order });
    await new Promise((r) => setTimeout(r, 1500));
  }
  done({ ads: items, baseline: { median, sample: vals.length, grid: grid.map(({ code, approx }) => ({ code, approx })) } });
`);
}
