// 경쟁사 찾기: 제품·서비스 키워드로 경쟁 브랜드·대리점·판매 채널을 웹에서 찾는다 (Claude Code 헤드리스 + 웹 검색)
//   <DATA_DIR>/_competitors/cmp_<시각>.json
// 찾은 곳은 화면에서 메타·유튜브 광고주로 검색해 바로 브랜드로 등록한다.
import fs from "node:fs/promises";
import path from "node:path";
import { askClaude, extractJson } from "./claude.js";
import { DATA_DIR, readJson, writeJson } from "./store.js";

export const COMPETITORS_DIR = path.join(DATA_DIR, "_competitors");
const TYPES = ["본사 브랜드", "대리점·판매점", "비교·중개 플랫폼", "신규·D2C"];

function buildPrompt({ query, note, count }) {
  return `너는 퍼포먼스 마케팅 리서처다. 아래 제품·서비스로 광고를 만들 때 참고할 경쟁사를 웹에서 찾는다.
WebSearch 로 여러 번 검색하고, 필요하면 WebFetch 로 페이지를 열어 확인한다.

[찾을 것] ${query}
[조건] ${note || "한국 시장"}

[찾는 범위]
- 본사 브랜드: 같은 제품을 파는 직접 경쟁 브랜드
- 대리점·판매점: 그 제품을 파는 렌탈 대리점, 공식 판매점, 지역 영업점 등 (광고를 많이 돌리는 곳 위주)
- 비교·중개 플랫폼: 여러 브랜드를 비교·중개하는 사이트·앱
- 신규·D2C: 최근 떠오른 브랜드, 온라인 직판 브랜드

[규칙]
1. ${count}곳 안팎. 광고(메타·유튜브·검색광고)를 실제로 돌릴 만한 곳을 우선한다.
2. 검색 결과로 확인한 사실만 쓴다. 확인 못 한 것은 빈 문자열. 수치(점유율·매출)는 출처가 있을 때만 쓰고 연도를 붙인다.
3. type 은 다음 중 하나: ${TYPES.join(", ")}
4. ad_search_terms: 메타 광고 라이브러리나 구글 광고 투명성 센터에서 광고주를 찾을 때 넣을 검색어 (브랜드 한글명, 영문명, 페이지 이름 등 1~3개).
5. evidence: 근거로 본 페이지 (제목·URL). 최소 1개.
6. 답은 아래 JSON 하나만. 설명 문장 금지.

{
  "summary": "이 시장의 경쟁 구도 2~3문장",
  "competitors": [{
    "name": "", "type": "", "products": "주력 제품·상품",
    "positioning": "강조하는 점 (가격·관리·디자인 등)",
    "why": "왜 경쟁사인지 한 줄",
    "website": "",
    "ad_search_terms": [""],
    "evidence": [{ "title": "", "url": "" }]
  }],
  "notes": "찾으면서 한계나 주의할 점"
}`;
}

export async function findCompetitors({ query, note = "", count = 12 }, emit = () => {}) {
  if (!query?.trim()) throw new Error("찾을 제품·서비스를 적으세요");
  count = Math.max(5, Math.min(25, Number(count) || 12));
  emit({ message: `Claude 가 "${query}" 경쟁사를 웹에서 찾는 중 (2~5분)` });
  const { text, durationMs } = await askClaude(buildPrompt({ query: query.trim(), note: note.trim(), count }), {
    cwd: DATA_DIR, allowedTools: ["WebSearch", "WebFetch"],
  });
  const out = extractJson(text);
  const id = `cmp_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const result = { id, query: query.trim(), note: note.trim(), created_at: new Date().toISOString(), took_s: Math.round(durationMs / 1000), ...out };
  await fs.mkdir(COMPETITORS_DIR, { recursive: true });
  await writeJson(path.join(COMPETITORS_DIR, `${id}.json`), result);
  emit({ message: `경쟁사 ${result.competitors?.length || 0}곳 찾음 (${result.took_s}초)` });
  return { id };
}

export async function listCompetitorSearches() {
  const names = (await fs.readdir(COMPETITORS_DIR).catch(() => [])).filter((n) => /^cmp_\d+\.json$/.test(n));
  const out = [];
  for (const n of names) { const r = await readJson(path.join(COMPETITORS_DIR, n), null); if (r) out.push(r); }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function deleteCompetitorSearch(id) {
  if (!/^cmp_\d+$/.test(id)) throw new Error("잘못된 ID");
  await fs.rm(path.join(COMPETITORS_DIR, `${id}.json`), { force: true });
}
