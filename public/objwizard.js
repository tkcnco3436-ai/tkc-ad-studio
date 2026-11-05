// 배경·제품 만들기 위저드 — 인물 만들기 위저드(public/charwizard.js)와 같은 방식
//   배경: ① 기본 장면 → ② 앵글 시트 → ③ 시간·날씨 바꾸기 → ④ 이름·저장
//   제품: ① 제품컷 → ② 제품 시트 → ③ 연출컷 → ④ 이름·저장
// 세부 조정(칩·범위 막대·색)과 참고 이미지(무엇을 따를지)로 고르면 최종 프롬프트가 바로 만들어지고, 힉스필드로 만들거나 결과를 직접 넣는다.
// ① 에서 고른 대표 결과가 ②·③ 의 image 1 이 된다 (같은 장소·같은 제품으로 이어지게).
// 진행은 작성 중(draft) 리소스에 계속 저장되고, 저장할 때 최종 프롬프트 셋이 리소스와 기록에 같이 남는다.
// 쓰는 곳: public/resources.js (openObjWizard) · 서버: lib/resources.js (KINDS.background/product.parts · analyzeRefs · completePrompt)
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}
function toast(msg, isErr = false) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3500);
}

// ── 조정 칸 정의 (charwizard.js 와 같은 모양) ──────────────
// opts = [[값, 한국어, 영어 조각, ("없음"일 때 넣지 말 것)]] · scale.en = 1~5칸 영어 (null 은 빼기)
const chips = (k, label, opts, o = {}) => ({ k, label, type: "chips", opts, ...o });
const multi = (k, label, opts, o = {}) => ({ k, label, type: "multi", opts, ...o });
const scale = (k, label, lo, hi, en, o = {}) => ({ k, label, type: "scale", lo, hi, en, def: 3, ...o });
const swatch = (k, label, opts, o = {}) => ({ k, label, type: "swatch", opts, ...o }); // [[값, 한국어, hex, 영어]]
const text = (k, label, ph, en) => ({ k, label, type: "text", ph, en });
const g = (id, label, en, items, o = {}) => ({ id, label, en, items, ...o });

const GRID = (views, def) => g("grid", "시트 구성", null, [
  multi("views", "넣을 칸", views, { def }),
  chips("grid", "격자", [["auto", "자동", ""], ["2x2", "2×2", ""], ["3x2", "3×2", ""], ["3x3", "3×3", ""], ["4x3", "4×3", ""]], { def: "auto" }),
  chips("hero", "첫 칸", [["same", "같은 크기", ""], ["big", "크게 (두 칸)", ""]], { def: "same" }),
  chips("labels", "칸 이름", [["none", "없음", ""], ["small", "작게 표시", ""]], { def: "none" }),
], { open: true });

// ── 배경 ──
const BG_STYLE = chips("style", "그림 스타일", [["photo", "실사", "photorealistic"], ["film", "필름 사진", "35mm film photograph style"], ["render", "3D 렌더", "high-quality 3D render"], ["miniature", "미니어처", "tilt-shift miniature diorama style"], ["illust", "일러스트", "clean background illustration"], ["anime", "애니 배경", "anime background art"], ["watercolor", "수채화", "watercolor painting"]], { def: "photo" });
const PLACES = [["living", "거실", "a living room"], ["bedroom", "침실", "a bedroom"], ["kitchen", "주방", "a kitchen"], ["bathroom", "욕실", "a bathroom"], ["cafe", "카페", "a cafe"], ["office", "사무실", "an office"],
  ["store", "매장", "a retail store"], ["studio", "촬영 스튜디오", "a photo studio"], ["classroom", "교실", "a classroom"], ["clinic", "병원·클리닉", "a clinic"], ["gym", "체육관", "a gym"], ["street", "도시 거리", "a city street"],
  ["park", "공원", "a park"], ["beach", "해변", "a beach"], ["forest", "숲", "a forest"], ["rooftop", "옥상", "a rooftop terrace"], ["mountain", "산", "a mountain landscape"], ["countryside", "시골", "the countryside"]];
const TIMES = [["morning", "아침", "early morning"], ["noon", "한낮", "midday"], ["golden", "노을", "golden hour"], ["blue", "해 진 직후", "blue hour"], ["night", "밤", "night"]];
const WEATHER = [["clear", "맑음", "clear sky"], ["cloudy", "흐림", "overcast"], ["rain", "비", "rain"], ["snow", "눈", "snowfall"], ["fog", "안개", "fog"]];
const SEASONS = [["spring", "봄", "spring"], ["summer", "여름", "summer"], ["autumn", "가을", "autumn"], ["winter", "겨울", "winter"]];
const LIGHTS = [["window", "창가 자연광", "soft natural daylight from a window"], ["warm", "따뜻한 실내등", "warm practical lamps"], ["studio", "스튜디오 조명", "even softbox studio lighting"], ["sun", "강한 햇빛", "harsh direct sunlight with crisp shadows"],
  ["neon", "네온", "colorful neon lighting"], ["candle", "촛불", "dim candlelight"], ["moody", "어두운 무드", "low-key moody lighting"]];
const PALETTE = [["beige", "웜 베이지", "#e8dcc8", "a warm beige and cream palette"], ["white", "쿨 화이트", "#eef1f4", "a clean cool white palette"], ["pastel", "파스텔", "#f3d6e4", "a soft pastel palette"], ["green", "어스 그린", "#8aa37b", "an earthy green and wood palette"],
  ["dark", "다크", "#2b2b30", "a dark moody palette"], ["vivid", "비비드", "#ff5a3c", "a vivid saturated palette"], ["mono", "모노톤", "#9a9a9a", "a monochrome grey palette"], ["blue", "블루", "#6c8fc7", "a calm blue palette"]];

// 빠른 구도: [값, 이름, { 거리, 방향, 높이, 자리, 빈 자리 }] — 누르면 구도 칸을 한 번에 채운다 (프롬프트에는 각 칸 값으로 들어간다)
const PRESETS = [
  ["pod1", "🎙 팟캐스트 1인", { dist: "close", dir: "front", view: "seated", seat: "podcast" }],
  ["pod2", "🎙 팟캐스트 2인", { dist: "medium", dir: "front", view: "seated", seat: "podcast2" }],
  ["pod2f", "🎙 마주 보는 대담", { dist: "medium", dir: "tq", view: "seated", seat: "podcast2f" }],
  ["talk", "💬 책상 토크", { dist: "close", dir: "front", view: "eye", seat: "desk" }],
  ["sofa", "🛋 소파 브이로그", { dist: "medium", dir: "front", view: "seated", seat: "sofa" }],
  ["table", "📦 테이블 위 제품 자리", { dist: "detail", dir: "front", view: "seated", seat: "", empty: "table" }],
  ["room", "🏠 방 전체", { dist: "wide", dir: "corner", view: "eye", seat: "" }],
];
const BG_SCHEMA = {
  base: [
    g("basic", "장소", null, [
      chips("space", "실내·실외", [["in", "실내", "an interior"], ["out", "실외", "an exterior"]]),
      chips("place", "장소", PLACES),
      text("custom", "장소 직접 쓰기", "예: 한강이 보이는 원룸, 1980년대 동네 문방구", (v) => v),
      BG_STYLE,
    ], { open: true }),
    // 구도·거리 — 줌(얼마나 멀리·가까이) · 정면/비스듬히 · 카메라 높이 · 인물이 들어갈 자리
    g("frame", "구도·거리 (줌)", null, [
      chips("preset", "빠른 구도 — 누르면 아래 거리·방향·높이·자리를 한 번에 맞춥니다", PRESETS.map(([v, l]) => [v, l, ""])),
      chips("dist", "거리 (줌)", [["xwide", "아주 멀리", "extreme wide shot"], ["wide", "멀리 (전경)", "wide shot"], ["medium", "중간", "medium shot"], ["close", "가까이", "close shot"], ["detail", "아주 가까이", "close-up"]]),
      chips("dir", "방향", [["front", "정면", "straight-on frontal composition, the camera squarely facing the back wall, symmetrical one-point perspective"], ["tq", "비스듬히", "three-quarter angle composition"], ["side", "옆에서", "side-on composition"], ["corner", "구석에서 대각선", "diagonal view from a corner of the room"]]),
      chips("view", "카메라 높이", [["eye", "눈높이", "camera at standing eye level (about 160 cm)"], ["seated", "앉은 눈높이", "camera at seated eye level (about 115 cm)"],
        ["low", "로우 앵글", "camera close to the floor tilted upward"], ["high", "하이 앵글", "camera raised high and tilted down at about 30 degrees, looking down onto the scene"], ["top", "정수리 위", "camera directly overhead looking straight down"]]),
      chips("seat", "인물 자리", [["chair", "의자 정면 (앉은 모습)", "an empty chair in the center facing the camera straight-on, so a person sitting there would be clearly visible from the waist up"],
        ["sofa", "소파 정면", "an empty sofa in the center facing the camera straight-on, ready for a seated person"], ["desk", "책상·테이블 앞 (대화·인터뷰)", "an empty chair behind a desk facing the camera, like a talk-show or interview set"],
        ["stand", "서 있는 자리 (전신)", "an empty standing spot in the center at full-body distance"], ["counter", "카운터 뒤", "an empty spot behind a counter facing the camera"],
        ["podcast", "팟캐스트 1인", "an empty podcast seat: a chair behind a small desk with a broadcast microphone on a boom arm in front of it, facing the camera, so a person sitting there would be framed from the chest up"],
        ["podcast2", "팟캐스트 2인 (나란히)", "two empty podcast seats side by side behind one desk, each with a broadcast microphone on a boom arm, facing the camera"],
        ["podcast2f", "팟캐스트 2인 (마주 보기)", "two empty chairs facing each other across a small round table, a broadcast microphone in front of each chair, seen from the side so both seats are visible"]]),
    ], { open: true }),
    g("time", "시간·날씨", "Time", [chips("time", "시간대", TIMES), chips("weather", "날씨", WEATHER), chips("season", "계절", SEASONS)]),
    g("mood", "분위기", "Mood", [
      multi("mood", "분위기", [["cozy", "아늑", "cozy"], ["minimal", "미니멀", "minimal"], ["luxury", "고급", "luxurious"], ["vintage", "빈티지", "vintage"], ["modern", "모던", "modern"], ["natural", "내추럴", "natural"], ["futuristic", "미래적", "futuristic"], ["calm", "차분", "calm"], ["cheerful", "밝고 경쾌", "cheerful"], ["dramatic", "극적", "dramatic"]]),
      scale("tidy", "정돈", "어수선", "깔끔", ["cluttered and lived-in", "a bit lived-in", null, "tidy", "perfectly clean and uncluttered"]),
    ]),
    g("light", "조명·색", "Lighting and color", [
      chips("light", "조명", LIGHTS),
      scale("bright", "밝기", "어두움", "밝음", ["very dark", "dim", null, "bright", "very bright and airy"]),
      swatch("palette", "색감", PALETTE),
      text("color", "주조색 직접 쓰기", "예: 테라코타와 올리브", (v) => `dominant colors ${v}`),
    ]),
    g("detail", "재질·소품", "Details", [
      multi("material", "재질", [["wood", "나무", "wood"], ["concrete", "콘크리트", "concrete"], ["marble", "대리석", "marble"], ["brick", "벽돌", "brick"], ["plaster", "회벽", "white plaster"], ["metal", "금속", "metal"], ["glass", "유리", "glass"], ["fabric", "패브릭", "soft fabric"], ["tile", "타일", "tile"]]),
      chips("plants", "식물", [["none", "없음", "", "plants"], ["few", "조금", "a few potted plants"], ["many", "많이", "lots of lush plants"]]),
      text("props", "소품", "예: 원목 테이블, 책 몇 권, 커피잔", (v) => `props: ${v}`),
    ]),
    g("cam", "렌즈·빈 자리", "Camera", [
      chips("lens", "렌즈", [["24", "광각 24mm", "24mm wide-angle lens"], ["35", "35mm", "35mm lens"], ["50", "50mm", "50mm lens"], ["85", "85mm", "85mm lens"]]),
      scale("dof", "배경 흐림", "선명", "흐림", ["everything in sharp focus", "mostly in focus", null, "shallow depth of field", "very shallow depth of field with creamy bokeh"]),
      chips("empty", "빈 자리 (인물·제품 놓을 곳)", [["center", "가운데", "clear empty space in the center"], ["left", "왼쪽 1/3", "clear empty space on the left third"], ["right", "오른쪽 1/3", "clear empty space on the right third"], ["table", "앞쪽 테이블 위", "an empty tabletop surface in the foreground"], ["floor", "앞쪽 바닥", "empty floor space in the foreground"]]),
      chips("people", "사람", [["none", "없음", "", "people, person, crowd"], ["far", "멀리 흐릿하게", "a few distant blurred passers-by"]], { def: "none" }),
      text("memo", "메모 (영어 한 문장도 됨)", "예: 창밖으로 벚꽃이 보이게", (v) => v),
    ]),
  ],
  angles: [
    GRID([["wide", "넓은 전경", "wide establishing view of the whole space"], ["reverse", "반대편", "reverse angle from the opposite side"], ["left", "왼쪽 벽 쪽", "view toward the left side"], ["right", "오른쪽 벽 쪽", "view toward the right side"],
      ["entrance", "입구에서", "view from the entrance"], ["window", "창가 쪽", "view toward the window"], ["top", "위에서", "top-down overview"], ["detail1", "디테일 1", "close-up of a key furniture or material detail"], ["detail2", "디테일 2", "close-up of a decorative prop"], ["spot", "빈 자리 정면", "straight-on view of the empty spot where a person or product will be placed"]],
      ["wide", "reverse", "left", "right", "detail1", "spot"]),
    g("look", "보기", "Look", [BG_STYLE, chips("light", "조명", [["same", "기본 장면 그대로", "the same lighting as image 1"], ...LIGHTS], { def: "same" }), text("memo", "메모", "예: 모든 칸에 같은 소파가 보이게", (v) => v)]),
  ],
  variant: [
    g("change", "바꿀 것", null, [
      chips("time", "시간대", TIMES), chips("weather", "날씨", WEATHER), chips("season", "계절", SEASONS), chips("light", "조명", LIGHTS),
      text("memo", "그 밖에 바꿀 것", "예: 크리스마스 장식을 더하고 창밖에 눈", (v) => v),
    ], { open: true }),
  ],
};

// ── 제품 ──
const PR_STYLE = chips("style", "그림 스타일", [["photo", "제품 사진", "photorealistic commercial product photo"], ["render", "3D 렌더", "high-end 3D product render"], ["clay", "클레이", "soft clay-style 3D render"], ["illust", "일러스트", "clean product illustration"], ["flat", "플랫", "flat vector-style illustration"]], { def: "photo" });
const PR_COLORS = [["white", "흰색", "#ffffff", "white"], ["black", "검정", "#151515", "black"], ["silver", "실버", "#c0c4c8", "silver"], ["gold", "골드", "#c9a24b", "gold"], ["pink", "핑크", "#f2a7bd", "pink"], ["red", "빨강", "#d0262f", "red"],
  ["orange", "주황", "#f08a24", "orange"], ["yellow", "노랑", "#f4d03f", "yellow"], ["green", "초록", "#3e9a5a", "green"], ["mint", "민트", "#9fe0cf", "mint"], ["blue", "파랑", "#2f6fd6", "blue"], ["navy", "네이비", "#1f2b4d", "navy"],
  ["purple", "보라", "#7e57c2", "purple"], ["brown", "갈색", "#7a4e2d", "brown"], ["beige", "베이지", "#e3d3b8", "beige"], ["clear", "투명", "#e9f3f7", "transparent clear"]];
const PR_BG = [["white", "흰색", "a pure white seamless background"], ["grey", "밝은 회색", "a light grey seamless background"], ["color", "단색 배경", "a solid color backdrop that complements the product"], ["gradient", "그라데이션", "a soft gradient backdrop"]];
const PR_SCHEMA = {
  front: [
    g("basic", "제품", null, [
      chips("cat", "종류", [["bottle", "병·용기", "a cosmetic bottle"], ["tube", "튜브", "a squeeze tube"], ["jar", "단지·크림통", "a cosmetic jar"], ["pump", "펌프 용기", "a pump bottle"], ["can", "캔", "a beverage can"], ["drink", "음료병", "a beverage bottle"],
        ["pouch", "파우치·봉지", "a snack pouch"], ["box", "상자 패키지", "a boxed package"], ["device", "전자기기", "an electronic device"], ["appliance", "가전", "a home appliance"], ["apparel", "의류", "a clothing item"], ["shoe", "신발", "a shoe"],
        ["bag", "가방", "a bag"], ["acc", "액세서리", "an accessory"], ["kitchen", "주방용품", "a kitchenware item"], ["food", "음식", "a food item"]]),
      text("what", "제품 설명 (영어 권장)", "예: a 200ml water purifier pitcher with a blue filter", (v) => v),
      PR_STYLE,
    ], { open: true }),
    g("shape", "모양·소재", "Form", [
      chips("form", "형태", [["cyl", "원통형", "cylindrical"], ["rect", "각진 직육면체", "rectangular"], ["round", "둥근", "rounded soft-edged"], ["tall", "길쭉", "slim and tall"], ["flat", "납작", "flat and thin"], ["organic", "곡선형", "organic curved"]]),
      chips("size", "크기감", [["palm", "손바닥", "palm-sized"], ["hand", "한 손", "handheld"], ["table", "탁상", "tabletop-sized"], ["large", "큼", "large floor-standing"]]),
      multi("mat", "소재", [["gplastic", "광택 플라스틱", "glossy plastic"], ["mplastic", "무광 플라스틱", "matte plastic"], ["glass", "유리", "glass"], ["frosted", "반투명 유리", "frosted glass"], ["alu", "알루미늄", "brushed aluminum"], ["steel", "스테인리스", "stainless steel"],
        ["paper", "종이", "printed paper"], ["card", "골판지", "kraft cardboard"], ["fabric", "패브릭", "fabric"], ["leather", "가죽", "leather"], ["wood", "나무", "wood"], ["ceramic", "도자기", "ceramic"]]),
      chips("finish", "마감", [["gloss", "유광", "glossy finish"], ["matte", "무광", "matte finish"], ["satin", "새틴", "satin finish"], ["metal", "메탈릭", "metallic finish"], ["trans", "투명", "transparent finish"]]),
    ]),
    g("color", "색", "Colors", [swatch("body", "본체 색", PR_COLORS), swatch("accent", "포인트 색", PR_COLORS), text("colors", "색 직접 쓰기", "예: 연보라 몸통에 골드 뚜껑", (v) => v)]),
    g("label", "라벨·로고", "Label", [
      chips("label", "라벨", [["none", "없음 (민무늬)", "", "any label, logo or text"], ["ref", "참고 사진 그대로", "the label and logo exactly as in the reference photo"], ["simple", "간단한 라벨", "a simple minimal label"]]),
      text("text", "라벨 글자 (그대로 들어감)", "예: GINGER SUGAR LIP SERUM", (v) => `label text reads exactly "${v}"`),
      chips("pos", "라벨 위치", [["front", "앞면 가운데", "label centered on the front"], ["top", "위쪽", "label near the top"], ["bottom", "아래쪽", "label near the bottom"]]),
    ]),
    g("shot", "촬영", "Shot", [
      chips("angle", "각도", [["front", "정면", "straight-on front view"], ["tq", "3/4", "three-quarter view"], ["side", "옆면", "side view"], ["top", "위에서", "top-down view"], ["hero", "로우 히어로", "low hero angle"]], { def: "front" }),
      chips("bg", "배경", PR_BG, { def: "white" }),
      chips("shadow", "그림자", [["soft", "부드러운 그림자", "a soft natural contact shadow"], ["reflect", "바닥 반사", "a subtle mirror reflection below"], ["none", "없음", "no shadow"]]),
      chips("light", "조명", [["soft", "소프트박스", "soft even softbox lighting"], ["rim", "림 라이트", "dramatic rim lighting"], ["hard", "강한 직사광", "hard directional light"], ["natural", "자연광", "natural window light"]]),
      text("memo", "메모", "예: 뚜껑은 닫힌 상태로", (v) => v),
    ]),
  ],
  sheet: [
    GRID([["front", "정면", "front view"], ["back", "뒷면", "back view"], ["left", "왼쪽 옆", "left side view"], ["right", "오른쪽 옆", "right side view"], ["tq", "3/4", "three-quarter view"], ["top", "위", "top view"], ["bottom", "바닥", "bottom view"],
      ["label", "라벨 클로즈업", "close-up of the label and logo"], ["texture", "질감 클로즈업", "macro close-up of the material texture"], ["open", "연 상태·사용 중", "the product opened or in use"], ["hand", "손에 든 크기감", "the product held in a hand to show its scale"], ["pack", "패키지와 함께", "the product next to its packaging box"]],
      ["front", "back", "left", "tq", "top", "label"]),
    g("look", "보기", "Look", [PR_STYLE, chips("bg", "배경", PR_BG, { def: "white" }), text("memo", "메모", "예: 모든 칸에 같은 그림자", (v) => v)]),
  ],
  scene: [
    g("setup", "연출", null, [
      chips("setup", "놓는 방식", [["podium", "받침대 위", "standing on a minimal podium"], ["table", "테이블 위 일상", "on a tabletop in a lifestyle setting"], ["hand", "손에 들고", "held in a hand"], ["model", "모델이 사용", "being used by a model"],
        ["flatlay", "플랫레이", "in a flat lay arrangement seen from above"], ["float", "공중에 떠서", "floating in mid-air"], ["nature", "자연 속", "placed outdoors in nature"], ["splash", "물·과즙 튀김", "with a dynamic liquid splash"]]),
      text("place", "장소·배경 (배경 리소스를 안 넣을 때)", "예: 햇살 드는 욕실 선반", (v) => `setting: ${v}`),
      text("props", "곁들일 소품", "예: 레몬 조각, 얼음, 대리석 트레이", (v) => `surrounded by ${v}`),
      PR_STYLE,
    ], { open: true }),
    g("mood", "분위기·조명", "Mood", [
      multi("mood", "분위기", [["fresh", "상쾌", "fresh"], ["premium", "고급", "premium"], ["cozy", "아늑", "cozy"], ["playful", "발랄", "playful"], ["clean", "깨끗", "clean"], ["natural", "내추럴", "natural"], ["bold", "강렬", "bold"]]),
      chips("light", "조명", LIGHTS), swatch("palette", "색감", PALETTE),
    ]),
    g("cam", "카메라", "Camera", [
      chips("view", "시점", [["eye", "눈높이", "eye-level"], ["low", "로우 앵글", "low angle"], ["high", "하이 앵글", "high angle"], ["top", "위에서", "top-down"], ["macro", "접사", "macro close-up"]]),
      scale("dof", "배경 흐림", "선명", "흐림", ["everything in sharp focus", "mostly in focus", null, "shallow depth of field", "very shallow depth of field with creamy bokeh"]),
      chips("space", "글자 놓을 빈 자리", [["top", "위쪽", "empty space at the top for copy"], ["left", "왼쪽", "empty space on the left for copy"], ["right", "오른쪽", "empty space on the right for copy"]]),
      text("memo", "메모", "예: 제품이 화면의 1/3 크기", (v) => v),
    ]),
  ],
};

// ── 종류별 설정 ──
const PROFILES = {
  background: {
    noun: "배경", icon: "🏞", SCHEMA: BG_SCHEMA,
    STEPS: [["base", "기본 장면"], ["angles", "앵글 시트"], ["variant", "시간·날씨"], ["save", "이름·저장"]],
    PART_NAME: { base: "기본 장면", angles: "앵글 시트", variant: "시간·날씨 변형" },
    NEXT_NAME: { base: "앵글 시트·변형", angles: "저장", variant: "저장" },
    ASPECT: { base: "16:9", angles: "16:9", variant: "16:9" },
    PREV: { base: [], angles: ["base"], variant: ["base"] },
    PREV_EN: { base: "기본 장면" },
    MEMO: { base: "cam.memo", angles: "look.memo", variant: "change.memo" },
    ANALYZE: ["base"],
    REF_USE: [["place", "공간 전체"], ["layout", "구조·배치"], ["material", "재질"], ["light", "조명"], ["color", "색감"], ["mood", "분위기"], ["props", "소품"], ["view", "카메라 시점"]],
    REF_EN: { place: "the whole space", layout: "the room layout and architecture", material: "the materials", light: "the lighting", color: "the color palette", mood: "the overall mood", props: "the props and furniture", view: "the camera angle" },
    DEF_REF: { base: "the space, layout and mood (ignore any people)", angles: "the space (ignore any people)", variant: "the target mood and lighting" },
    NEG: {
      base: "people, person, text, watermark, logo, distorted perspective, warped lines, blurry, low quality",
      angles: "inconsistent architecture between panels, different furniture between panels, people, text, watermark, logo",
      variant: "changed layout, moved furniture, different camera angle, people, text, watermark, logo",
    },
    REF_HINT: "장소 사진·무드 이미지",
  },
  product: {
    noun: "제품", icon: "📦", SCHEMA: PR_SCHEMA,
    STEPS: [["front", "제품컷"], ["sheet", "제품 시트"], ["scene", "연출컷"], ["save", "이름·저장"]],
    PART_NAME: { front: "제품컷", sheet: "제품 시트", scene: "연출컷" },
    NEXT_NAME: { front: "제품 시트·연출컷", sheet: "저장", scene: "저장" },
    ASPECT: { front: "1:1", sheet: "16:9", scene: "4:5" },
    PREV: { front: [], sheet: ["front"], scene: ["front"] },
    MEMO: { front: "shot.memo", sheet: "look.memo", scene: "cam.memo" },
    ANALYZE: ["front"],
    REF_USE: [["product", "제품 전체"], ["shape", "모양"], ["color", "색"], ["label", "라벨·로고"], ["material", "소재"], ["place", "장소·배경"], ["light", "조명"], ["props", "소품"], ["comp", "구도"]],
    REF_EN: { product: "the exact product (shape, colors, label and logo)", shape: "the product shape", color: "the product colors", label: "the label and logo", material: "the materials and finish", place: "the location and background", light: "the lighting", props: "the props and styling", comp: "the composition" },
    DEF_REF: { front: "the exact product — match its shape, proportions, colors, materials, label and logo", sheet: "the exact product", scene: "general styling" },
    NEG: {
      front: "hands, people, extra objects, props, misspelled label, garbled text, deformed shape, watermark, blurry, low quality",
      sheet: "different product between panels, inconsistent label, garbled text, hands, people, watermark, cluttered background",
      scene: "different product, changed label, garbled text, deformed product, extra copies of the product, watermark, blurry",
    },
    REF_HINT: "실제 제품 사진 (여러 각도면 좋음)",
    IMPORT: { scene: "background" }, // 연출컷: 배경 리소스를 장소 참고로 가져온다
  },
};

// ── 상태 ──────────────────────────────────────────────
const W = { r: null, P: null, data: null, step: 0, onClose: null, busy: "", saveT: 0 };
const url = (f) => `/data/_resources/${W.r.kind}/${W.r.id}/${f}`;
const PARTS = () => W.P.STEPS.map(([id]) => id).filter((id) => id !== "save");
const part = () => W.P.STEPS[W.step][0];
const sel = (p) => W.data[p].sel;
const outsOf = (p) => W.r.files.filter((f) => f.part === p && f.role !== "ref" && f.kind === "image");
// 구도 가이드·줌아웃 판은 위저드가 만들어 쓰는 것이라 참고 이미지 목록에 안 보인다
const isAux = (f) => /^(구도 가이드|줌아웃 판)/.test(f.note || "");
const refsOf = (p) => W.r.files.filter((f) => f.part === p && f.role === "ref" && f.kind === "image" && !isAux(f));
const pickOf = (p) => { const o = outsOf(p); return o.find((f) => f.file === W.data[p]?.pick) || o[o.length - 1] || null; };
function initData(r) {
  const d = r.wizard || {};
  for (const p of PARTS()) {
    d[p] ||= { sel: {}, refUse: {}, skip: [], prompt: r.parts?.[p]?.prompt || "", negative: r.parts?.[p]?.negative || W.P.NEG[p], manual: !!r.parts?.[p]?.prompt };
    d[p].refUse ||= {}; d[p].skip ||= [];
  }
  return d;
}

// ── 최종 프롬프트 (고른 값 → 영어) ─────────────────────
const valOf = (c, v) => (v === undefined ? c.def : v);
function frag(c, v) {
  v = valOf(c, v);
  if (c.type === "chips") { const o = c.opts.find((x) => x[0] === v); return o ? o[2] : ""; }
  if (c.type === "swatch") { const o = c.opts.find((x) => x[0] === v); return o ? o[o.length - 1] : ""; }
  if (c.type === "multi") return (v || []).map((x) => c.opts.find((o) => o[0] === x)?.[2]).filter(Boolean).join(", ");
  if (c.type === "scale") return v ? c.en[v - 1] || "" : "";
  if (c.type === "text") return v?.trim() ? c.en(v.trim().replace(/[.。\s]+$/, "")) : "";
  return "";
}
const findCtl = (p, key) => { const [gid, k] = key.split("."); return W.P.SCHEMA[p].find((x) => x.id === gid)?.items.find((x) => x.k === k); };
const F = (p, key) => { const c = findCtl(p, key); return c ? frag(c, sel(p)[key]) : ""; };
const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
// 보낼 이미지 순서: 이어 받는 대표 결과(① 결과) → 이 단계 참고 이미지
const sendOf = (p) => ({ prev: W.data[p].send?.prev !== false, refs: W.data[p].send?.refs !== false });
function imagesFor(p, any = false) {
  const sd = any ? { prev: true, refs: true } : sendOf(p);
  const prev = sd.prev ? (W.P.PREV[p] || []).map((q) => ({ q, f: pickOf(q) })).filter((x) => x.f) : [];
  const refs = sd.refs ? refsOf(p).filter((f) => !W.data[p].skip.includes(f.file)) : [];
  return { prev, refs, all: [...prev.map((x) => x.f), ...refs].slice(0, 6) };
}
// 시트 격자
const AUTO_GRID = (n) => (n <= 4 ? [2, 2] : n <= 6 ? [3, 2] : n <= 9 ? [3, 3] : n <= 12 ? [4, 3] : [4, 4]);
function gridOf(p) {
  const s = sel(p), vc = findCtl(p, "grid.views");
  const panels = (s["grid.views"] ?? vc.def).map((k) => vc.opts.find((o) => o[0] === k)?.[2]).filter(Boolean);
  const hero = s["grid.hero"] === "big", need = panels.length + (hero ? 1 : 0), choice = s["grid.grid"] || "auto";
  let [cols, rows] = choice === "auto" ? AUTO_GRID(need) : choice.split("x").map(Number);
  if (cols * rows < need) [cols, rows] = AUTO_GRID(need);
  return { panels, cols, rows, hero, labels: s["grid.labels"] === "small" };
}
function gridLines({ panels, cols, hero }, rows) {
  const out = []; let cell = 0;
  panels.forEach((t, i) => {
    const big = hero && i === 0;
    out.push(`Panel ${i + 1} (row ${Math.floor(cell / cols) + 1}, column ${(cell % cols) + 1}${big ? ", spanning two columns as the large hero panel" : ""}): ${t}.`);
    cell += big ? 2 : 1;
  });
  const left = cols * rows - cell;
  if (left > 0) out.push(`Leave the remaining ${left} panel${left > 1 ? "s" : ""} as clean empty background.`);
  return out;
}
const gridAspect = (p) => { const { cols, rows } = gridOf(p), r = cols / rows; return [["1:1", 1], ["4:3", 4 / 3], ["3:2", 1.5], ["16:9", 16 / 9]].reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0]; };
const isGrid = (p) => !!findCtl(p, "grid.views");
const groupLine = (p, gr, skip = []) => { const fs = gr.items.filter((c) => !skip.includes(c.k)).map((c) => frag(c, sel(p)[`${gr.id}.${c.k}`])).filter(Boolean); return fs.length ? `${gr.en}: ${fs.join(", ")}.` : ""; };
const gridHead = (p, what, keep) => {
  const gd = gridOf(p);
  return [`— a single image arranged as a clean ${gd.cols}×${gd.rows} grid of ${gd.hero ? "panels" : `${gd.cols * gd.rows} equally sized panels`} separated by thin white gutters. ${keep}`, ...gridLines(gd, gd.rows),
    `${gd.labels ? "A small clean caption under each panel naming the view" : "No text labels"}, no watermark.`].join(" ");
};

// 거리(줌)마다 화면에 얼마나 담는지
const DIST_MORE = { xwide: "the camera is far away and the frame shows the whole space plus its surroundings", wide: "the frame shows the whole room from wall to wall",
  medium: "the frame shows only one area of the space, about 3–4 meters across", close: "the frame shows only about 1.5–2 meters across, the distance of a seated person's waist-up shot",
  detail: "the frame shows less than 1 meter across, such as a tabletop or a wall detail" };
const SHORT = { dir: { front: "straight-on frontal", tq: "three-quarter angle", side: "side-on", corner: "diagonal from a corner" },
  view: { eye: "standing eye level", seated: "seated eye level", low: "low angle looking up", high: "high angle looking down", top: "top-down" } };
// 가까운 샷: 고른 소품을 다 넣으려고 카메라를 뒤로 빼지 않게
const TIGHT = ["medium", "close", "detail"];
// ── 구도 가이드 스케치 (배경 기본 장면) ──
// 이미지 모델이 "가까이·하이 앵글" 같은 말을 잘 못 따라서, 고른 거리·방향·높이·인물 자리를 회색 방 그림으로 그려 참고 이미지로 같이 보낸다.
// 글자는 그리지 않는다 (모델이 따라 쓴다). 방 높이 2.8m 기준으로 카메라 높이·의자 크기를 맞춘다
// 실제 3D 로 계산한다: 피사체(인물 자리)를 원점에 두고, 고른 거리만큼 떨어진 카메라가 고른 높이·방향에서 피사체를 겨눈다.
// 방(벽·바닥·천장)과 가구는 상자로 두고 핀홀 투영으로 그린다 — 거리·높이·렌즈가 바뀌면 화면 속 크기·원근이 실제처럼 바뀐다
const ROOM_H = 2.8;
const CAM_H = { eye: 1.6, seated: 1.15, low: 0.35, high: 2.6, top: 2.7 };
const SUBJ_D = { xwide: 8, wide: 5, medium: 3, close: 1.7, detail: 0.9 }; // 카메라 ↔ 피사체 (m)
const YAW = { front: 0, tq: 30, corner: 45, side: 90 };
const HFOV = { 24: 74, 35: 54, 50: 40, 85: 24 };
const hasGuide = (p) => W.r.kind === "background" && p === "base" && ["dist", "dir", "view", "seat"].some((k) => sel(p)[`frame.${k}`]);
const guideOn = (p) => hasGuide(p) && W.data[p].guide !== false;
function drawGuide(cv, s, aspect) {
  const [aw, ah] = String(aspect || "16:9").split(":").map(Number), Wd = 960, Ht = Math.round(Wd * (ah || 9) / (aw || 16));
  cv.width = Wd; cv.height = Ht;
  const c = cv.getContext("2d"), view = s["frame.view"] || "eye", seat = s["frame.seat"], empty = s["cam.empty"];
  const d = SUBJ_D[s["frame.dist"] || "wide"], yaw = (YAW[s["frame.dir"] || "front"] * Math.PI) / 180, camH = CAM_H[view];
  // 카메라: 피사체(0, 0.6, 0)를 겨눈다. 위에서 내려다보기만 수직
  const C = [-Math.sin(yaw) * d, camH, -Math.cos(yaw) * d];
  const aim = ["podcast", "podcast2", "desk", "chair", "sofa"].includes(seat) ? 0.85 : 0.6; // 앉는 자리면 앉은 사람 가슴 높이를 겨눈다
  const pitch = view === "top" ? -Math.PI / 2 + 0.001 : Math.atan2(aim - camH, d);
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)], r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const fpx = (Wd / 2) / Math.tan(((HFOV[s["cam.lens"]] || 60) * Math.PI) / 360);
  const toCam = (P) => { const q = [P[0] - C[0], P[1] - C[1], P[2] - C[2]]; return [q[0] * r[0] + q[1] * r[1] + q[2] * r[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * f[0] + q[1] * f[1] + q[2] * f[2]]; };
  const NEAR = 0.05;
  const clip = (pts) => { // 카메라 뒤로 넘어간 부분을 자른다 (Sutherland–Hodgman, z = NEAR 평면)
    const out = [];
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length], ia = a[2] >= NEAR, ib = b[2] >= NEAR;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); } });
    return out;
  };
  const proj = (q) => [Wd / 2 + (fpx * q[0]) / q[2], Ht / 2 - (fpx * q[1]) / q[2]];
  const face = (pts, fill, stroke = "#5a5a5a") => {
    const cp = clip(pts.map(toCam)); if (cp.length < 3) return;
    c.beginPath(); cp.map(proj).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
    c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 2; c.stroke();
  };
  // 방: 피사체 뒤 1.2m 에 벽. 비스듬히·구석이면 오른쪽 벽도 가깝게(구석이 보이게), 옆에서면 오른쪽 벽이 뒷벽 노릇
  const far = Math.max(2.5, d * 0.7), deg = YAW[s["frame.dir"] || "front"];
  const xR = deg >= 40 ? 1.2 : far, zB = deg >= 80 ? far : 1.2, xL = Math.min(-far, C[0] - 1.5), zF = Math.min(-1, C[2] - 1.5), H = ROOM_H;
  c.fillStyle = "#cfcfcf"; c.fillRect(0, 0, Wd, Ht);
  face([[xL, 0, zF], [xR, 0, zF], [xR, 0, zB], [xL, 0, zB]], "#9d9d9d"); // 바닥
  face([[xL, H, zF], [xR, H, zF], [xR, H, zB], [xL, H, zB]], "#e8e8e8"); // 천장
  face([[xL, 0, zB], [xR, 0, zB], [xR, H, zB], [xL, H, zB]], "#d6d6d6"); // 뒷벽
  face([[xL, 0, zF], [xL, 0, zB], [xL, H, zB], [xL, H, zF]], "#c4c4c4"); // 왼쪽 벽
  face([[xR, 0, zF], [xR, 0, zB], [xR, H, zB], [xR, H, zF]], "#bcbcbc"); // 오른쪽 벽
  // 가구 상자 (사람은 그리지 않는다). 상자 = [x0,x1,y0,y1,z0,z1], 피사체 기준 (+z 가 뒤쪽)
  const boxFaces = ([x0, x1, y0, y1, z0, z1], fill) => {
    const P = (x, y, z) => [x, y, z];
    const fs = [[P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
      [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)],
      [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)]];
    // 먼 면부터 그린다
    fs.map((q) => ({ q, z: q.reduce((a, v) => a + toCam(v)[2], 0) / 4 })).sort((a, b) => b.z - a.z).forEach(({ q }) => face(q, fill, "#222"));
  };
  const chair = (dz = 0) => [[-0.25, -0.21, 0, 0.45, -0.25 + dz, -0.21 + dz], [0.21, 0.25, 0, 0.45, -0.25 + dz, -0.21 + dz], [-0.25, -0.21, 0, 0.45, 0.21 + dz, 0.25 + dz], [0.21, 0.25, 0, 0.45, 0.21 + dz, 0.25 + dz],
    [-0.27, 0.27, 0.45, 0.52, -0.27 + dz, 0.27 + dz], [-0.27, 0.27, 0.52, 1.0, 0.2 + dz, 0.27 + dz]].forEach((b) => boxFaces(b, "#454545"));
  if (seat === "chair") chair();
  if (seat === "sofa") [[-1, 1, 0, 0.45, -0.45, 0.45], [-1, 1, 0.45, 0.9, 0.3, 0.45], [-1.1, -0.95, 0, 0.65, -0.45, 0.45], [0.95, 1.1, 0, 0.65, -0.45, 0.45]].forEach((b) => boxFaces(b, "#454545"));
  if (seat === "counter") boxFaces([-1.2, 1.2, 0, 1.0, -0.35, 0.35], "#3a3a3a");
  // 팟캐스트: 책상 + 붐 암 마이크 (x = 자리 가운데)
  // 책상은 상판 + 가는 다리 (앞판을 막으면 의자가 가려진다). 마이크는 책상 뒤쪽에서 올라와 앉은 사람 입 높이로
  const mic = (x) => [[x - 0.015, x + 0.015, 0.77, 1.18, 0.08, 0.11], [x - 0.015, x + 0.015, 1.16, 1.19, -0.08, 0.11], [x - 0.035, x + 0.035, 1.05, 1.2, -0.12, -0.06]].forEach((b) => boxFaces(b, "#111"));
  const desk = (x0, x1) => [[x0 + 0.03, x0 + 0.07, 0, 0.72, 0.09, 0.13], [x1 - 0.07, x1 - 0.03, 0, 0.72, 0.09, 0.13], [x0 + 0.03, x0 + 0.07, 0, 0.72, -0.27, -0.23], [x1 - 0.07, x1 - 0.03, 0, 0.72, -0.27, -0.23], [x0, x1, 0.72, 0.76, -0.3, 0.15]].forEach((b) => boxFaces(b, "#6a6a6a")); // 뒤 다리 → 앞 다리 → 상판 순서로 (먼 것부터)
  const chairAt = (x, dz) => [[-0.25, -0.21, 0, 0.45, -0.25, -0.21], [0.21, 0.25, 0, 0.45, -0.25, -0.21], [-0.25, -0.21, 0, 0.45, 0.21, 0.25], [0.21, 0.25, 0, 0.45, 0.21, 0.25],
    [-0.27, 0.27, 0.45, 0.52, -0.27, 0.27], [-0.27, 0.27, 0.52, 1.0, 0.2, 0.27]].forEach(([a, b, y0, y1, z0, z1]) => boxFaces([a + x, b + x, y0, y1, z0 + dz, z1 + dz], "#454545"));
  // 옆을 보는 의자 (마주 보기): 등받이가 바깥쪽
  const chairSide = (x, out) => [[-0.27, 0.27, 0.45, 0.52, -0.27, 0.27], [out > 0 ? 0.2 : -0.27, out > 0 ? 0.27 : -0.2, 0.52, 1.0, -0.27, 0.27], [-0.25, -0.21, 0, 0.45, -0.25, -0.21], [0.21, 0.25, 0, 0.45, 0.21, 0.25]]
    .forEach(([a, b, y0, y1, z0, z1]) => boxFaces([a + x, b + x, y0, y1, z0, z1], "#454545"));
  if (seat === "desk") { chairAt(0, 0.5); desk(-0.8, 0.8); }
  if (seat === "podcast") { chairAt(0, 0.5); desk(-0.6, 0.6); mic(0); }
  if (seat === "podcast2") { chairAt(-0.55, 0.5); chairAt(0.55, 0.5); desk(-1.1, 1.1); mic(-0.55); mic(0.55); }
  if (seat === "podcast2f") { chairSide(-0.75, -1); chairSide(0.75, 1); boxFaces([-0.35, 0.35, 0.7, 0.74, -0.35, 0.35], "#2e2e2e"); boxFaces([-0.04, 0.04, 0, 0.7, -0.04, 0.04], "#2e2e2e");
    [[-0.3, -1], [0.3, 1]].forEach(([x, o]) => [[x - 0.02, x + 0.02, 0.74, 1.05, -0.02, 0.02], [x - 0.04 + o * 0.02, x + 0.04 + o * 0.02, 1.0, 1.12, -0.04, 0.04]].forEach((b) => boxFaces(b, "#1c1c1c"))); }
  if (seat === "stand") { const ring = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * 2 * Math.PI) * 0.35, 0.01, Math.sin((i / 24) * 2 * Math.PI) * 0.35]); face(ring, "#5f5f5f", "#222"); }
  // 비워 둘 곳 (화면 기준 흰 점선)
  const spot = { center: [0.35, 0.45, 0.3, 0.4], left: [0.03, 0.4, 0.3, 0.5], right: [0.67, 0.4, 0.3, 0.5], table: [0.25, 0.72, 0.5, 0.25], floor: [0.2, 0.75, 0.6, 0.23] }[empty];
  if (spot) { c.setLineDash([12, 8]); c.strokeStyle = "#ffffff"; c.lineWidth = 3; c.strokeRect(spot[0] * Wd, spot[1] * Ht, spot[2] * Wd, spot[3] * Ht); c.setLineDash([]); }
  return cv;
}
const guideSig = (p) => JSON.stringify([genOf(p).aspect, ...["dist", "dir", "view", "seat"].map((k) => sel(p)[`frame.${k}`]), sel(p)["cam.empty"], sel(p)["cam.lens"]]);
// 보내기 직전: 지금 고른 값의 가이드 그림을 참고 이미지(note "구도 가이드")로 올려 두고 파일 이름을 돌려준다 (값이 같으면 다시 안 올린다)
async function ensureGuide(p) {
  const d = W.data[p], sig = guideSig(p), cur = W.r.files.find((f) => f.file === d.guideFile);
  if (cur && d.guideSig === sig) return cur.file;
  const blob = await new Promise((ok) => drawGuide(document.createElement("canvas"), sel(p), genOf(p).aspect).toBlob(ok, "image/png"));
  const res = await fetch(`/api/uploads?purpose=resource&name=guide.png`, { method: "POST", body: blob });
  const up = await res.json(); if (!res.ok) throw new Error(up.error || "구도 가이드를 올리지 못했습니다");
  if (cur) await api(`${apiBase()}/files/${encodeURIComponent(cur.file)}`, { method: "DELETE" }).catch(() => {});
  W.r = await api(`${apiBase()}/files`, { method: "POST", body: { tokens: [up.token], role: "ref", part: p, note: "구도 가이드" } });
  d.guideFile = W.r.files.filter((f) => f.note === "구도 가이드" && f.part === p).slice(-1)[0]?.file; d.guideSig = sig;
  return d.guideFile;
}
function composeBg(p, prev) {
  const lines = [], b = "base", place = F(b, "basic.custom") || F(b, "basic.place") || "a place";
  const space = F(b, "basic.space"), n1 = prev.length ? 1 : 0;
  if (p === "base") {
    // 모델은 앞쪽 문장을 더 따른다 — 구도(거리·방향·높이)와 장소를 맨 앞에 못 박고, 끝에서 구도를 한 번 더 확인한다
    const dist = F(p, "frame.dist"), dk = sel(p)["frame.dist"], dir = F(p, "frame.dir"), view = F(p, "frame.view"), seat = F(p, "frame.seat");
    const shot = dist || "wide establishing shot";
    lines.push(`${cap(F(p, "basic.style") || "photorealistic")} ${shot} of ${place}${space ? ` (${space})` : ""}.`);
    const fr = [DIST_MORE[dk], dir, view].filter(Boolean);
    if (fr.length) lines.push(`Camera framing (most important — follow exactly): ${fr.join("; ")}.`);
    if (F(p, "basic.place") || F(p, "basic.custom")) lines.push(`Location: ${place} — it must clearly read as ${place}; furniture and props below belong in ${place}.`);
    if (seat) lines.push(`Focal point: ${seat}. Keep that spot clear and well lit.`);
    if (TIGHT.includes(dk)) lines.push(`Only what falls inside this ${shot} is visible — other furniture and props mentioned below appear only partly or stay out of frame. Do not pull the camera back to fit them in.`);
    for (const gr of W.P.SCHEMA.base.filter((x) => !["basic", "frame", "cam"].includes(x.id))) { const l = groupLine(p, gr); if (l) lines.push(l); }
    const cam = [F(p, "cam.lens"), F(p, "cam.dof")].filter(Boolean); if (cam.length) lines.push(`Lens: ${cam.join(", ")}.`);
    const empty = F(p, "cam.empty"); if (empty) lines.push(`Leave ${empty} so a person or product can be placed there later.`);
    const people = F(p, "cam.people"); if (people) lines.push(`Include ${people}.`);
    lines.push("No text, no signage lettering, no watermark.");
  } else if (p === "angles") {
    const light = F(p, "look.light");
    lines.push(`${cap(F(p, "look.style") || F(b, "basic.style") || "photorealistic")} location reference sheet of ${n1 ? "the exact same place as image 1" : place} ${gridHead(p, place, `Keep the architecture, layout, furniture, materials, colors${light && !light.startsWith("the same") ? "" : ", lighting"} and props identical in every panel.`)}`);
    if (light && (n1 || !light.startsWith("the same"))) lines.push(`Lighting: ${light}.`);
    lines.push("No people in any panel.");
  } else {
    const ch = ["time", "weather", "season", "light"].map((k) => [k, F(p, `change.${k}`)]).filter(([, v]) => v);
    const what = ch.map(([k, v]) => `${{ time: "time of day", weather: "weather", season: "season", light: "lighting" }[k]} to ${v}`);
    if (n1) lines.push(`Edit image 1: keep exactly the same place — the same layout, architecture, furniture, props, materials, camera angle and framing.${what.length ? ` Change only the ${what.join(", the ")}.` : ""} Adjust shadows, sky and light naturally to match.`);
    else lines.push(`${cap(F(b, "basic.style") || "photorealistic")} image of ${place}${ch.length ? `: ${ch.map(([, v]) => v).join(", ")}` : ""}.`);
    lines.push("No people, no text, no watermark.");
  }
  return lines;
}
function composeProduct(p, prev, refs) {
  const lines = [], f = "front", n1 = prev.length ? 1 : 0;
  const what = F(f, "basic.what") || F(f, "basic.cat") || "a product";
  if (p === "front") {
    lines.push(`${cap(F(p, "basic.style") || "photorealistic commercial product photo")}, ${F(p, "shot.angle") || "front view"}, of ${what}.`);
    if (refs.length) lines.push("Reproduce the exact product from the reference image(s): same shape, proportions, colors, materials, label and logo — do not redesign it.");
    for (const gr of W.P.SCHEMA.front.filter((x) => !["basic", "shot"].includes(x.id))) { const l = groupLine(p, gr); if (l) lines.push(l); }
    const set = [F(p, "shot.bg"), F(p, "shot.shadow"), F(p, "shot.light")].filter(Boolean); if (set.length) lines.push(`Set on ${set.join(", ")}.`);
    lines.push("A single product only, centered and fully in frame, no hands, no people, no extra props, no watermark.");
  } else if (p === "sheet") {
    lines.push(`Product reference sheet (${F(p, "look.style") || F(f, "basic.style") || "photorealistic commercial product photo"}) of ${n1 ? "the exact same product as image 1" : what} ${gridHead(p, what, `${F(p, "look.bg") ? `Every panel on ${F(p, "look.bg")}` : "The same clean background in every panel"} with even soft studio lighting. Keep the product's shape, colors, materials, label and logo identical in every panel.`)}`);
  } else {
    lines.push(`Advertising image (${F(p, "setup.style") || F(f, "basic.style") || "photorealistic commercial product photo"}) of ${n1 ? "the exact product from image 1 (keep its shape, colors, materials, label and logo exactly the same)" : what}${F(p, "setup.setup") ? `, ${F(p, "setup.setup")}` : ""}.`);
    const more = [F(p, "setup.place"), F(p, "setup.props")].filter(Boolean); if (more.length) lines.push(`${cap(more.join("; "))}.`);
    for (const gr of W.P.SCHEMA.scene.filter((x) => !["setup", "cam"].includes(x.id))) { const l = groupLine(p, gr); if (l) lines.push(l); }
    const cam = [F(p, "cam.view"), F(p, "cam.dof"), F(p, "cam.space")].filter(Boolean); if (cam.length) lines.push(`Camera: ${cam.join(", ")}.`);
    lines.push("Only one instance of the product, no garbled text, no watermark.");
  }
  return lines;
}
function compose(p) {
  const { prev, refs } = imagesFor(p), s = sel(p);
  const lines = W.r.kind === "background" ? composeBg(p, prev) : composeProduct(p, prev, refs);
  refs.forEach((f, i) => {
    const n = prev.length + i + 1, use = W.data[p].refUse[f.file] || [];
    const own = p === "base" && W.r.kind === "background" && ["dist", "dir", "view"].some((k) => s[`frame.${k}`]) && !use.includes("view");
    lines.push((use.length ? `Image ${n}: use only ${use.map((u) => W.P.REF_EN[u]).join(", ")} as reference.` : `Image ${n}: reference for ${W.P.DEF_REF[p] || "general styling"}.`)
      + (own ? " Do not copy its camera position, distance or framing — use the framing described above." : ""));
  });
  if (guideOn(p)) lines.push(`Image ${prev.length + refs.length + 1}: a rough grey layout sketch of the camera framing only — match its camera distance, viewing angle, horizon height and perspective, and put the focal furniture where the dark shapes are and keep the dashed area empty. Ignore its flat grey colors, plain shapes and lines; render a fully detailed real scene.`);
  const memo = F(p, W.P.MEMO[p]);
  if (memo) lines.push((W.r.kind === "background" && p === "base" && TIGHT.includes(s["frame.dist"]) ? "Room details (show only the parts that fall inside this framing): " : "") + cap(memo.replace(/[.\s]+$/, "")) + ".");
  // "없음"으로 고른 칸 — 메모·참고 이미지에 있어도 넣지 않게 맨 끝에
  const nots = W.P.SCHEMA[p].flatMap((gr) => gr.items.map((c) => {
    const v = s[`${gr.id}.${c.k}`] ?? c.def;
    return c.type === "chips" && v ? c.opts.find((o) => o[0] === v)?.[3] || "" : "";
  })).filter(Boolean);
  if (nots.length) lines.push(`Do not include: ${nots.join(", ")} — even if shown in the reference images.`);
  // 배경 기본 장면: 구도를 맨 끝에 한 번 더 (메모·소품에 밀리지 않게)
  if (W.r.kind === "background" && p === "base" && ["dist", "dir", "view"].some((k) => s[`frame.${k}`]))
    lines.push(`Final check — framing: ${[F(p, "frame.dist") || "wide establishing shot", SHORT.dir[s["frame.dir"]], SHORT.view[s["frame.view"]]].filter(Boolean).join(", ")}.`);
  return lines.join(" ");
}
const promptOf = (p) => (W.data[p].manual ? W.data[p].prompt : compose(p));

// 만들기 설정 (모델·비율·해상도·품질) — 목록은 서버 lib/hfmodels.js
const modelOf = (id) => W.models?.find((m) => m.id === id) || W.models?.[0];
function genOf(p) {
  const g0 = W.data[p].gen || {}, m = modelOf(g0.model), base = W.P.ASPECT[p];
  if (!m) return { model: "gpt_image_2_5", aspect: base, res: "2k", quality: "high" };
  const want = isGrid(p) && !g0.aspectSet ? gridAspect(p) : g0.aspect || base;
  return { model: m.id, aspect: m.aspects.includes(want) ? want : m.aspects.includes(base) ? base : m.aspects[0], aspectSet: !!g0.aspectSet,
    res: m.res?.options.includes(g0.res) ? g0.res : m.res?.def, quality: m.quality?.options.includes(g0.quality) ? g0.quality : m.quality?.def };
}
const genBody = (p) => { const g0 = genOf(p); return { imageModel: g0.model, aspect: g0.aspect, resolution: g0.res, quality: g0.quality }; };
function genHTML(p) {
  const g0 = genOf(p), m = modelOf(g0.model); if (!m) return "";
  const sel_ = (k, label, opts, v) => `<label class="field"><span>${label}</span><select data-gen="${k}">${opts.map(([x, l]) => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  return `<div class="wz-gen">
    ${sel_("model", "모델", W.models.map((x) => [x.id, `${x.name} — ${x.note}`]), g0.model)}
    ${sel_("aspect", isGrid(p) && !g0.aspectSet ? "비율 (격자에 맞춤)" : "비율", m.aspects.map((a) => [a, a]), g0.aspect)}
    ${m.res ? sel_("res", "해상도", m.res.options.map((a) => [a, a]), g0.res) : ""}
    ${m.quality ? sel_("quality", "품질", m.quality.options.map((a) => [a, a]), g0.quality) : ""}
  </div>${m.max === 1 ? `<p class="muted small" style="margin:0">이 모델은 참고 이미지를 1장만 받습니다 (첫 장만 씀).</p>` : ""}`;
}

// ── 그리기 ────────────────────────────────────────────
function ctlHTML(gid, c) {
  const p = part(), key = `${gid}.${c.k}`, v = valOf(c, sel(p)[key]), auto = W.data[p].auto?.includes(key);
  let body = "";
  if (c.type === "chips" || c.type === "multi") {
    const on = (x) => (c.type === "multi" ? (v || []).includes(x) : v === x);
    const pre = c.type === "chips" && c.def === undefined ? `<button type="button" class="wz-chip ${v === undefined || v === "" ? "is-on" : ""}" data-v="">자동</button>` : "";
    body = `<div class="wz-chips">${pre}${c.opts.map(([x, l]) => `<button type="button" class="wz-chip ${on(x) ? "is-on" : ""}" data-v="${esc(x)}">${esc(l)}</button>`).join("")}</div>`;
  } else if (c.type === "swatch") {
    body = `<div class="wz-swatches"><button type="button" class="wz-sw wz-sw--auto ${v ? "" : "is-on"}" data-v="" title="자동">자동</button>${c.opts.map(([x, l, h]) => `<button type="button" class="wz-sw ${v === x ? "is-on" : ""}" data-v="${esc(x)}" title="${esc(l)}" style="--c:${h}"><span>${esc(l)}</span></button>`).join("")}</div>`;
  } else if (c.type === "scale") {
    const names = [c.lo, `약간 ${c.lo}`, "보통", `약간 ${c.hi}`, c.hi];
    body = `<div class="wz-range"><span class="muted small">${esc(c.lo)}</span><input type="range" min="1" max="5" step="1" value="${v}" data-range><span class="muted small">${esc(c.hi)}</span><output>${esc(names[v - 1])}</output></div>`;
  } else if (c.type === "text") {
    body = `<input data-text value="${esc(v || "")}" placeholder="${esc(c.ph)}">`;
  }
  return `<div class="wz-ctl ${auto ? "is-auto" : ""}" data-ctl="${esc(key)}" data-type="${c.type}"><span class="wz-ctl__label">${esc(c.label)}${auto ? ` <em title="참고 이미지 분석으로 채움">🔍</em>` : ""}</span>${body}</div>`;
}
const setCount = (p, gr) => gr.items.filter((c) => { const v = sel(p)[`${gr.id}.${c.k}`]; return v !== undefined && v !== "" && !(Array.isArray(v) && !v.length) && v !== c.def; }).length;
const SRC = { manual: "직접 저장", analyze: "사진 분석", claude: "Claude 다듬기", "before-claude": "다듬기 전", generate: "힉스필드에 씀", save: "저장" };
const draft = () => W.r.status === "draft";

function render() {
  const root = $("#resWizard"), p = part(), P = W.P;
  window.nav?.sub([...(W.crumbs || []), { label: `${draft() ? `새 ${P.noun}` : "다듬기"} · ${W.step + 1}. ${P.STEPS[W.step][1]}` }]);
  root.innerHTML = `
    <div class="wz-head">
      <strong>${draft() ? `${P.icon} 새 ${P.noun} 만들기` : `${esc(W.r.name)} 다듬기`}</strong>
      <span class="muted small" data-wz-saved>${W.busy ? esc(W.busy) : "자동 저장됨"}</span>
    </div>
    <ol class="wz-steps">${P.STEPS.map(([id, label], i) => {
      const done = id === "save" ? !draft() : !!pickOf(id);
      return `<li><button type="button" class="wz-step ${i === W.step ? "is-on" : ""} ${done ? "is-done" : ""}" data-step="${i}"><span>${done ? "✓" : i + 1}</span>${esc(label)}</button></li>`;
    }).join("")}</ol>
    <div class="wz-body">${p === "save" ? saveStep() : imageStep(p)}</div>
    <div class="wz-foot">
      <button class="btn btn--ghost" type="button" data-wz="prev" ${W.step ? "" : "disabled"}>← 이전</button>
      <span class="muted small">${W.step + 1} / ${P.STEPS.length} · ${esc(P.STEPS[W.step][1])}</span>
      ${W.step < P.STEPS.length - 1 ? `<button class="btn btn--primary" type="button" data-wz="next">다음: ${esc(P.STEPS[W.step + 1][1])} →</button>` : ""}
    </div>`;
  paintGuide();
}

function imageStep(p) {
  const P = W.P, d = W.data[p], { prev, refs } = imagesFor(p), shown = imagesFor(p, true), sd = sendOf(p);
  const prompt = d.manual ? d.prompt : (d.prompt = compose(p));
  const canAnalyze = P.ANALYZE.includes(p), first = P.PREV[p]?.[0];
  const hist = (W.r.promptLog || []).filter((x) => x.part === p).slice().reverse();
  return `<div class="wz-grid">
    <div class="wz-controls">
      ${d.analysis ? `<p class="note small" style="margin:0">🔍 참고 이미지 분석: ${esc(d.analysis)} — 🔍 표시 칸을 채웠습니다. 바꿔도 됩니다.</p>` : ""}
      <p class="muted small" style="margin:0">고를수록 오른쪽 최종 프롬프트가 바로 바뀝니다. "자동"·"보통"은 프롬프트에서 빠집니다 (모델이 알아서 정함).${first ? ` ${esc(P.PART_NAME[first])} 결과를 image 1 로 이어 받아 같은 ${P.noun}로 만듭니다.` : ""}</p>
      ${P.SCHEMA[p].map((gr) => `<details class="wz-group" data-group="${gr.id}" ${gr.open || W.openGroups?.has(`${p}.${gr.id}`) ? "open" : ""}>
        <summary>${esc(gr.label)} <span class="muted small" data-gcount="${gr.id}">${setCount(p, gr) ? `${setCount(p, gr)}개 고름` : ""}</span></summary>
        <div class="wz-group__body">${gr.items.map((c) => ctlHTML(gr.id, c)).join("")}</div>
        ${gr.id === "frame" && W.r.kind === "background" ? guideHTML(p) : ""}
      </details>`).join("")}
    </div>
    <aside class="wz-side">
      ${shown.prev.length ? `<section class="wz-card"><h4>이어 받는 이미지 ${sd.prev ? "" : `<span class="muted small">— 힉스필드에 보내지 않음</span>`}</h4><div class="wz-refs">${shown.prev.map(({ q, f }, i) => `<figure class="wz-ref ${sd.prev ? "" : "is-off"}"><img src="${url(f.file)}" alt=""><figcaption>${sd.prev ? `image ${i + 1}` : "안 보냄"} · ${esc(P.PART_NAME[q])} 결과</figcaption></figure>`).join("")}</div></section>`
        : first ? `<p class="note small">${esc(P.PART_NAME[first])} 결과가 없어 같은 ${P.noun}로 이어지지 않습니다. ① 에서 결과를 만들거나 올려 두세요.</p>` : ""}
      <section class="wz-card">
        <h4>참고 이미지 <span class="muted small">${refsOf(p).length}장${canAnalyze ? " · 넣으면 분석해 왼쪽 칸을 채웁니다" : ""}</span></h4>
        <div class="wz-refs">${refsOf(p).map((f) => {
          const on = !d.skip.includes(f.file), n = on && sd.refs ? prev.length + refs.indexOf(f) + 1 : 0, use = d.refUse[f.file] || [];
          return `<figure class="wz-ref ${on ? "" : "is-off"}" data-ref="${esc(f.file)}">
            <img src="${url(f.file)}" alt="">
            <label class="small"><input type="checkbox" data-refon ${on ? "checked" : ""}> ${!on ? "안 씀" : n ? `image ${n}` : "분석에만 씀"}</label>
            <div class="wz-chips wz-chips--sm">${P.REF_USE.map(([u, l]) => `<button type="button" class="wz-chip ${use.includes(u) ? "is-on" : ""}" data-refuse="${u}">${esc(l)}</button>`).join("")}</div>
            <button type="button" class="btn btn--ghost btn--sm" data-refdel>빼기</button>
          </figure>`;
        }).join("")}</div>
        <label class="res-drop" data-wzdrop="ref">＋ 참고 이미지 넣기 <span class="muted small">— ${esc(P.REF_HINT)}을 끌어다 놓거나 눌러서 고르기</span><input type="file" accept="image/*" multiple data-wzup="ref" hidden></label>
        <div class="ex__row">
          ${canAnalyze ? `<button class="btn btn--ghost btn--sm" type="button" data-wz="analyze" ${shown.refs.length && !W.busy ? "" : "disabled"}>🔍 ${d.analysis ? "다시 분석" : "참고 이미지 분석해서 채우기"}</button>` : ""}
          ${P.IMPORT?.[p] ? `<button class="btn btn--ghost btn--sm" type="button" data-wz="importOpen">🏞 배경 리소스에서 장소 가져오기</button>` : ""}
        </div>
        ${P.IMPORT?.[p] && W.importOpen ? importPanel() : ""}
      </section>
      <section class="wz-card">
        <div class="wz-card__head"><h4>최종 프롬프트 <span class="muted small">${d.manual ? "직접 고침 — 고른 값이 바뀌어도 그대로 둡니다" : "고른 값에서 자동"}</span></h4>
          <button class="wz-icon" type="button" data-wz="history" title="프롬프트 기록 ${hist.length}개" aria-label="프롬프트 기록">🕘<span>${hist.length || ""}</span></button></div>
        ${W.histOpen ? `<div class="wz-hist">${hist.length ? hist.map((h, i) => `<div class="wz-hist__item">
            <div class="wz-hist__meta"><span class="muted small">${new Date(h.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="wz-hist__src">${esc(SRC[h.source] || h.source)}</span>
              <span style="flex:1"></span><button class="btn btn--ghost btn--sm" type="button" data-histuse="${i}">되돌리기</button><button class="btn btn--ghost btn--sm" type="button" data-histcopy="${i}">복사</button></div>
            <p class="small">${esc(h.prompt)}</p></div>`).join("") : `<p class="muted small" style="margin:0">아직 기록이 없습니다. 📌 버튼으로 지금 프롬프트를 남기거나, 다듬기·생성할 때 자동으로 남습니다.</p>`}</div>` : ""}
        <textarea data-prompt rows="8">${esc(prompt)}</textarea>
        <label class="field"><span>네거티브 (피할 것)</span><textarea data-negative rows="2">${esc(d.negative)}</textarea></label>
        <div class="ex__row">
          ${d.manual ? `<button class="btn btn--ghost btn--sm" type="button" data-wz="recompose">고른 값으로 다시 만들기</button>` : ""}
          <button class="btn btn--ghost btn--sm" type="button" data-wz="pin">📌 이 버전 저장</button>
          <button class="btn btn--ghost btn--sm" type="button" data-wz="polish" ${W.busy ? "disabled" : ""}>✍️ Claude로 다듬기</button>
          <button class="btn btn--ghost btn--sm" type="button" data-wz="copy">📋 복사</button>
        </div>
      </section>
      <section class="wz-card wz-make">
        <h4>✨ ${esc(P.PART_NAME[p])} 이미지 만들기</h4>
        ${genHTML(p)}
        ${shown.prev.length || shown.refs.length ? `<div class="wz-send"><span class="small"><b>힉스필드에 보낼 이미지</b></span>
          ${shown.prev.length ? `<label class="small"><input type="checkbox" data-send="prev" ${sd.prev ? "checked" : ""}> 이어 받는 결과 ${shown.prev.length}장 — 같은 ${P.noun} 유지</label>` : ""}
          ${shown.refs.length ? `<label class="small"><input type="checkbox" data-send="refs" ${sd.refs ? "checked" : ""}> 참고 이미지 ${shown.refs.length}장</label>` : ""}
        </div>` : ""}
        <button class="btn btn--primary" type="button" data-wz="generate" ${W.busy ? "disabled" : ""}>${W.busy && W.jobKind === "hf" ? "만드는 중…" : `✨ 힉스필드로 ${esc(P.PART_NAME[p])} 만들기 (${esc(genOf(p).aspect)})`}</button>
        <p class="muted small" style="margin:0">힉스필드는 크레딧이 듭니다. 만든 이미지는 아래 "생성된 이미지"에 쌓이고, 거기서 넘길 이미지를 고릅니다.</p>
      </section>
    </aside>
  </div>
  ${gallery(p)}`;
}

function guideHTML(p) {
  if (!hasGuide(p)) return `<p class="muted small" style="margin:0">거리·방향·높이·인물 자리 중 하나를 고르면 구도 가이드 그림이 여기 그려집니다.</p>`;
  return `<div class="wz-guide"><canvas data-guide aria-label="구도 가이드 그림"></canvas>
    <label class="small"><input type="checkbox" data-guideon ${guideOn(p) ? "checked" : ""}> 이 구도 그림을 힉스필드에 같이 보내기 <span class="muted">— 모델이 거리·각도를 말보다 그림으로 더 잘 따릅니다. 짙은 모양 = 의자·책상 자리, 흰 점선 = 비워 둘 곳</span></label></div>`;
}
const paintGuide = () => { const cv = $("#resWizard [data-guide]"); if (cv) drawGuide(cv, sel(part()), genOf(part()).aspect); };
const when = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const srcOf = (f) => (f.note?.startsWith("가져옴") ? "가져옴" : f.source === "generated" ? "힉스필드" : "올림");
function gallery(p) {
  const P = W.P, all = W.data.galleryAll, list = W.r.files.filter((f) => f.role !== "ref" && f.kind === "image" && (all ? PARTS().includes(f.part) : f.part === p))
    .slice().sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)));
  const picks = new Set(PARTS().map((q) => pickOf(q)?.file).filter(Boolean)), pick = pickOf(p);
  return `<section class="wz-gallery">
    <div class="wz-gallery__head">
      <h4>생성된 이미지 <span class="muted small">${list.length}장</span></h4>
      <div class="wz-next">${pick ? `<img src="${url(pick.file)}" alt=""><span class="small">➡ <b>${esc(P.NEXT_NAME[p])}</b>(으)로 넘길 ${esc(P.PART_NAME[p])}<br><span class="muted">${when(pick.added_at)} · ${srcOf(pick)}</span></span>` : `<span class="small muted">➡ ${esc(P.NEXT_NAME[p])}(으)로 넘길 이미지를 아래에서 고르세요</span>`}</div>
      <div class="seg">${[[false, P.PART_NAME[p]], [true, "전체 단계"]].map(([v, l]) => `<button type="button" class="seg__btn ${!!all === v ? "is-on" : ""}" data-galall="${v}">${esc(l)}</button>`).join("")}</div>
    </div>
    <div class="wz-zoomset small"><b>줌</b> <span class="muted">— 모델이 거리를 잘 못 맞추면 만든 이미지에서 직접 당기거나 넓힙니다. 줌인은 잘라서 키우기(크레딧 없음), 줌아웃은 둘레를 넓혀 힉스필드가 채웁니다.</span>
      <label>배율 <select data-zoom="scale">${[1.25, 1.5, 2, 3].map((x) => `<option value="${x}" ${zoomOf().scale === x ? "selected" : ""}>${x}배</option>`).join("")}</select></label>
      <label>기준 <select data-zoom="anchor">${[["center", "가운데"], ["left", "왼쪽"], ["right", "오른쪽"], ["top", "위"], ["bottom", "아래"]].map(([v, l]) => `<option value="${v}" ${zoomOf().anchor === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <div class="wz-gallery__grid">
      <label class="wz-gcard wz-gadd" data-wzdrop="output">
        <span class="wz-gadd__plus">＋</span><b>이미지 추가하기</b>
        <span class="muted small">다른 곳(미드저니·GPT·촬영 등)에서 만든 ${esc(P.PART_NAME[p])} 이미지를 끌어다 놓거나 눌러서 고르기 — 넣은 이미지는 바로 넘길 이미지가 됩니다</span>
        <input type="file" accept="image/*" multiple data-wzup="output" hidden></label>
      ${W.busy && W.jobKind === "hf" ? `<div class="wz-gcard wz-gcard--wait"><div class="wz-gcard__img"><span>✨ 만드는 중…<br><span class="muted small">1~3분</span></span></div></div>` : ""}
      ${list.map((f) => `<article class="wz-gcard ${picks.has(f.file) ? "is-pick" : ""}">
        <a class="wz-gcard__img" href="${url(f.file)}" target="_blank" rel="noopener" title="크게 보기"><img src="${url(f.file)}" alt="" loading="lazy"></a>
        <div class="wz-gcard__body">
          <div class="wz-gcard__meta"><b>${esc(P.PART_NAME[f.part] || "")}</b><span class="wz-hist__src">${srcOf(f)}</span>${picks.has(f.file) ? `<span class="wz-gcard__pick">➡ 넘김</span>` : ""}</div>
          <span class="muted small">${when(f.added_at)}</span>
          ${f.prompt ? `<details><summary class="muted small">쓴 프롬프트</summary><p class="small">${esc(f.prompt)}</p><button type="button" class="btn btn--ghost btn--sm" data-gcopy="${esc(f.file)}">복사</button></details>` : ""}
          <div class="ex__row">
            ${picks.has(f.file) ? "" : `<button type="button" class="btn btn--primary btn--sm" data-gpick="${esc(f.file)}">➡ 이걸로 넘기기</button>`}
            <button type="button" class="btn btn--ghost btn--sm" data-gzoom="in|${esc(f.file)}" title="기준 쪽으로 잘라 키웁니다 — 크레딧 없음">🔍＋ 줌인</button>
            <button type="button" class="btn btn--ghost btn--sm" data-gzoom="out|${esc(f.file)}" ${W.busy ? "disabled" : ""} title="둘레를 넓혀 힉스필드가 바깥을 채웁니다 — 크레딧 사용">🔍－ 줌아웃</button>
            ${P.ANALYZE.includes(f.part) ? `<button type="button" class="btn btn--ghost btn--sm" data-ganalyze="${esc(f.file)}" ${W.busy ? "disabled" : ""}>🔍 칸 채우기</button>` : ""}
            <a class="btn btn--ghost btn--sm" href="${url(f.file)}" download>받기</a>
            <button type="button" class="btn btn--ghost btn--sm" data-gremove="${esc(f.file)}" title="빼도 기록에는 남습니다">빼기</button>
          </div>
        </div>
      </article>`).join("")}
    </div>
  </section>`;
}
const zoomOf = () => ({ scale: 1.5, anchor: "center", ...(W.data.zoom || {}) });
const OUTPAINT = "Image 1 is a photo placed inside a flat mid-grey border. Replace all of the grey border by extending the scene outward naturally, as if the same photo had been taken from further back with a wider view: continue the walls, floor, ceiling, surfaces, furniture, materials, lighting and shadows seamlessly. Keep the original area exactly unchanged — same content, colors and perspective. No grey border left, no people, no text, no watermark.";
async function zoom(mode, file) {
  const f = W.r.files.find((x) => x.file === file); if (!f) return;
  const z = zoomOf();
  if (mode === "in") {
    try { W.r = await api(`${apiBase()}/zoom`, { method: "POST", body: { file, mode, ...z } }); W.data[f.part].pick = outsOf(f.part).slice(-1)[0]?.file; render(); queueSave(); toast(`${z.scale}배 줌인한 이미지를 넣었습니다 — 넘길 이미지로 골라 두었습니다`); }
    catch (e) { toast(e.message, true); }
    return;
  }
  const g0 = genOf(f.part);
  if (!confirm(`둘레를 ${z.scale}배로 넓혀 힉스필드가 바깥을 채웁니다 (${modelOf(g0.model)?.name || g0.model} · ${g0.aspect}).\n크레딧이 듭니다. 계속할까요?`)) return;
  runJob("hf", async () => {
    await saveNow();
    W.r = await api(`${apiBase()}/zoom`, { method: "POST", body: { file, mode, ...z } });
    const plate = W.r.files.filter((x) => x.part === f.part && /^줌아웃 판/.test(x.note || "")).slice(-1)[0];
    if (!plate) throw new Error("줌아웃 판을 만들지 못했습니다");
    await api("/api/hf/generate", { method: "POST", body: { target: { type: "resource", kind: W.r.kind, id: W.r.id, part: f.part }, kind: "image", purpose: "edit", prompt: OUTPAINT, refs: [plate.file], ...genBody(f.part) } });
  }, "힉스필드가 바깥을 채우는 중… (1~3분)");
}
// 다른 리소스에서 가져오기 (제품 연출컷 ← 배경 리소스의 결과 이미지)
function importPanel() {
  const list = W.importList;
  if (!list) return `<p class="muted small">불러오는 중…</p>`;
  return `<div class="wz-import">${list.length ? list.map((x, i) => `<button type="button" class="wz-import__item" data-importi="${i}" title="${esc(x.label)}"><img src="/data/_resources/${x.kind}/${x.id}/${x.file}" alt=""><span class="small">${esc(x.label)}</span></button>`).join("")
    : `<p class="muted small" style="margin:0">가져올 배경 이미지가 없습니다 — 처음 화면의 "배경 이미지 만들기"에서 만들어 두세요.</p>`}</div>`;
}
async function loadImportList(kind) {
  const all = await api(`/api/resources?kind=${kind}`);
  W.importList = all.flatMap((r) => r.files.filter((f) => f.kind === "image" && f.role !== "ref").map((f) => ({ kind: r.kind, id: r.id, file: f.file, label: r.name })));
}

function saveStep() {
  const P = W.P, r = W.r, fields = W.kinds?.[r.kind]?.fields || [];
  return `<div class="wz-narrow">
    <section class="wz-card">
      <h4>${P.noun} 이름</h4>
      <input class="title-input" data-basic="name" value="${esc(draft() && /^이름 없는/.test(r.name) ? "" : r.name)}" placeholder="${r.kind === "background" ? "예: 햇살 드는 원룸" : "예: 진저슈가 립 세럼"}">
      <div class="res-fields">${fields.map(([k, l]) => `<label class="field"><span>${esc(l)}</span><input data-attr="${k}" value="${esc(r.attrs?.[k] || "")}"></label>`).join("")}</div>
      <label class="field"><span>태그 (쉼표로)</span><input data-basic="tags" value="${esc(r.tags.join(", "))}"></label>
      <label class="field"><span>설명</span><textarea data-basic="description" rows="2">${esc(r.description || "")}</textarea></label>
    </section>
    <section class="wz-card">
      <h4>함께 저장되는 최종 프롬프트 <span class="muted small">버전 기록은 각 단계의 🕘 에 남아 있습니다</span></h4>
      ${PARTS().map((p) => { const pick = pickOf(p), pr = promptOf(p); return `<div class="wz-final">
        ${pick ? `<img src="${url(pick.file)}" alt="">` : `<span class="wz-final__ph">—</span>`}
        <div><b>${esc(P.PART_NAME[p])}</b> <button type="button" class="btn btn--ghost btn--sm" data-copyp="${p}">📋 복사</button><p class="small">${esc(pr)}</p></div></div>`; }).join("")}
    </section>
    <div class="ex__row"><span style="flex:1"></span><button class="btn btn--primary" type="button" data-wz="save">${draft() ? `💾 ${P.noun} 저장 (리소스로)` : "💾 바뀐 내용 저장"}</button></div>
  </div>`;
}

// ── 저장 ──
const apiBase = () => `/api/resources/${W.r.kind}/${W.r.id}`;
function queueSave() {
  clearTimeout(W.saveT); setSavedText("저장 중…");
  W.saveT = setTimeout(() => saveNow().then(() => setSavedText("자동 저장됨")).catch((e) => toast(e.message, true)), 700);
}
function setSavedText(t) { const el = $("[data-wz-saved]"); if (el && !W.busy) el.textContent = t; }
async function saveNow(extra = {}) {
  clearTimeout(W.saveT);
  if (!W.r) return;
  const parts = Object.fromEntries(PARTS().map((p) => [p, { ...(W.r.parts?.[p] || {}), prompt: promptOf(p), negative: W.data[p].negative }]));
  W.data.step = W.step;
  W.r = await api(apiBase(), { method: "PUT", body: { wizard: W.data, parts, ...extra } });
}
async function reload() { W.r = await api(apiBase()); }
async function pinPrompt(p, prompt, source) {
  W.r = await api(`${apiBase()}/prompts`, { method: "POST", body: { part: p, prompt, negative: W.data[p].negative, source } });
}
async function upload(files, role) {
  const tokens = [], p = part();
  for (const [i, f] of [...files].entries()) {
    setSavedText(`올리는 중 ${i + 1}/${files.length}`);
    const res = await fetch(`/api/uploads?purpose=resource&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${f.name}: ${d.error || res.status}`);
    tokens.push(d.token);
  }
  await saveNow();
  W.r = await api(`${apiBase()}/files`, { method: "POST", body: { tokens, role, part: p } });
  if (role === "output") W.data[p].pick = outsOf(p).slice(-1)[0]?.file;
  render(); queueSave();
  // 참고 사진을 넣으면 바로 분석 (완성 이미지는 아직 고른 칸이 하나도 없을 때만)
  if (W.P.ANALYZE.includes(p) && !W.busy && (role === "ref" || !Object.keys(sel(p)).length)) analyze(p, role === "output" ? [W.data[p].pick] : undefined);
}
function analyze(p, files) {
  const refs = files ? files.map((file) => ({ file })) : imagesFor(p, true).refs; if (!refs.length) return;
  // 구도(거리·방향·높이·자리)와 렌즈·빈 자리·사람은 사용자가 정한다 — 넓은 방 사진을 넣어도 "가까이"가 덮이지 않게 분석에서 뺀다
  const NO_ANALYZE = ["frame.", "cam.lens", "cam.dof", "cam.empty", "cam.people"];
  const schema = W.P.SCHEMA[p].flatMap((gr) => gr.items.filter((c) => c.k !== "memo" && !NO_ANALYZE.some((x) => `${gr.id}.${c.k}`.startsWith(x))).map((c) => ({
    key: `${gr.id}.${c.k}`, label: `${gr.label} ${c.label}`, type: c.type, options: c.opts?.map((o) => [o[0], o[1]]), lo: c.lo, hi: c.hi })));
  runJob("analyze", () => api(`${apiBase()}/analyze`, { method: "POST", body: { part: p, files: refs.map((f) => f.file), refUse: W.data[p].refUse, schema, memoKey: W.P.MEMO[p] } }), "Claude 가 참고 이미지를 분석하는 중… (30초~1분)");
}
function applyAnalysis(res) {
  const p = res.part, d = W.data[p]; if (!d) return;
  Object.assign(d.sel, res.sel);
  if (res.memo) d.sel[res.memoKey] = res.memo;
  d.auto = [...Object.keys(res.sel), ...(res.memo ? [res.memoKey] : [])];
  d.analysis = res.summary; d.manual = false;
  for (const gr of W.P.SCHEMA[p]) if (gr.items.some((c) => d.auto.includes(`${gr.id}.${c.k}`))) W.openGroups.add(`${p}.${gr.id}`);
}

// ── 이벤트 ────────────────────────────────────────────
function copy(s) { navigator.clipboard.writeText(s).then(() => toast("복사했습니다"), () => toast("복사하지 못했습니다 — 칸을 직접 선택해 복사하세요", true)); }
function onClick(e) {
  const t = e.target, root = $("#resWizard"), p = part(), P = W.P;
  const go = (i) => { saveNow().catch(() => {}); W.step = Math.max(0, Math.min(P.STEPS.length - 1, i)); W.histOpen = false; W.importOpen = false; render(); root.scrollIntoView({ block: "start" }); };
  const step = t.closest("[data-step]"); if (step) return go(Number(step.dataset.step));
  const act = t.closest("[data-wz]")?.dataset.wz;
  if (act === "prev") return go(W.step - 1);
  if (act === "next") {
    if (W.step === 0 && !pickOf(p) && !confirm(`${P.PART_NAME[p]} 결과 이미지가 없습니다. 다음 단계는 같은 ${P.noun}를 이어 받지 못합니다.\n그래도 넘어갈까요?`)) return;
    return go(W.step + 1);
  }
  const ctl = t.closest("[data-ctl]");
  if (ctl && t.closest("[data-v]")) {
    const key = ctl.dataset.ctl, v = t.closest("[data-v]").dataset.v, s = sel(p);
    if (ctl.dataset.type === "multi") { const c = findCtl(p, key), cur = new Set(valOf(c, s[key]) || []); cur.has(v) ? cur.delete(v) : cur.add(v); s[key] = [...cur]; }
    else s[key] = v;
    if (key === "frame.preset") { // 빠른 구도: 구도 칸을 한 번에 — 칸 묶음을 다시 그린다
      const pr = PRESETS.find(([x]) => x === v)?.[2];
      if (pr) { for (const k of ["dist", "dir", "view", "seat"]) { if (pr[k]) s[`frame.${k}`] = pr[k]; else delete s[`frame.${k}`]; } if (pr.empty) s["cam.empty"] = pr.empty; }
      W.data[p].auto = (W.data[p].auto || []).filter((k) => !/^frame\./.test(k));
      render(); return queueSave();
    }
    if (/^frame\.(dist|dir|view|seat)$/.test(key)) delete s["frame.preset"]; // 손으로 바꾸면 빠른 구도 표시를 뗀다
    return changed(p, key);
  }
  const ref = t.closest("[data-ref]");
  if (ref) {
    const f = ref.dataset.ref, d = W.data[p];
    if (t.closest("[data-refuse]")) { const u = t.closest("[data-refuse]").dataset.refuse, cur = new Set(d.refUse[f] || []); cur.has(u) ? cur.delete(u) : cur.add(u); d.refUse[f] = [...cur]; render(); return queueSave(); }
    if (t.closest("[data-refdel]")) return api(`${apiBase()}/files/${encodeURIComponent(f)}`, { method: "DELETE" }).then((r) => { W.r = r; delete d.refUse[f]; render(); queueSave(); toast("뺐습니다 — 기록에는 남아 있습니다"); }).catch((err) => toast(err.message, true));
  }
  if (act === "recompose") { W.data[p].manual = false; render(); return queueSave(); }
  if (act === "copy") return copy(`${$("[data-prompt]", root).value}\n\nNegative prompt: ${$("[data-negative]", root).value}`);
  if (act === "history") { W.histOpen = !W.histOpen; return render(); }
  if (act === "pin") return pinPrompt(p, promptOf(p), "manual").then(() => { toast("지금 프롬프트를 기록에 남겼습니다 (🕘)"); render(); }).catch((err) => toast(err.message, true));
  const hu = t.closest("[data-histuse]"), hc = t.closest("[data-histcopy]");
  if (hu || hc) {
    const h = (W.r.promptLog || []).filter((x) => x.part === p).slice().reverse()[Number((hu || hc).dataset[hu ? "histuse" : "histcopy"])];
    if (!h) return;
    if (hc) return copy(h.negative ? `${h.prompt}\n\nNegative prompt: ${h.negative}` : h.prompt);
    pinPrompt(p, promptOf(p), "manual").catch(() => {});
    Object.assign(W.data[p], { prompt: h.prompt, negative: h.negative || W.data[p].negative, manual: true }); W.histOpen = false;
    render(); toast("그 버전으로 되돌렸습니다"); return queueSave();
  }
  const cp = t.closest("[data-copyp]"); if (cp) return copy(promptOf(cp.dataset.copyp));
  const ga = t.closest("[data-galall]"); if (ga) { W.data.galleryAll = ga.dataset.galall === "true"; render(); return queueSave(); }
  const gp = t.closest("[data-gpick]");
  if (gp) { const f = W.r.files.find((x) => x.file === gp.dataset.gpick); if (f) { W.data[f.part].pick = f.file; render(); toast(`이 이미지를 ${P.NEXT_NAME[f.part]}(으)로 넘깁니다`); return queueSave(); } }
  const gz = t.closest("[data-ganalyze]"); if (gz) { const f = W.r.files.find((x) => x.file === gz.dataset.ganalyze); if (f) return analyze(f.part, [f.file]); }
  const gc = t.closest("[data-gcopy]"); if (gc) return copy(W.r.files.find((x) => x.file === gc.dataset.gcopy)?.prompt || "");
  const gr = t.closest("[data-gremove]");
  if (gr) {
    if (!confirm("이 이미지를 뺄까요? 지우지 않고 기록(_history)에 남깁니다.")) return;
    return api(`${apiBase()}/files/${encodeURIComponent(gr.dataset.gremove)}`, { method: "DELETE" }).then((r) => { W.r = r; render(); queueSave(); toast("뺐습니다 — 기록에는 남아 있습니다"); }).catch((err) => toast(err.message, true));
  }
  const gzm = t.closest("[data-gzoom]"); if (gzm) { const [mode, file] = gzm.dataset.gzoom.split("|"); return zoom(mode, file); }
  if (act === "analyze") return analyze(p);
  if (act === "importOpen") { W.importOpen = !W.importOpen; render(); if (W.importOpen && !W.importList) loadImportList(P.IMPORT[p]).then(render).catch((err) => toast(err.message, true)); return; }
  const imp = t.closest("[data-importi]");
  if (imp) {
    const x = W.importList[Number(imp.dataset.importi)];
    return api(`${apiBase()}/import`, { method: "POST", body: { fromKind: x.kind, fromId: x.id, file: x.file, role: "ref", part: p } }).then((r) => {
      W.r = r; const f = refsOf(p).slice(-1)[0]?.file;
      if (f) W.data[p].refUse[f] = ["place"]; // 장소·배경으로만 따른다
      W.importOpen = false; render(); queueSave(); toast("배경을 장소 참고로 가져왔습니다");
    }).catch((err) => toast(err.message, true));
  }
  if (act === "polish") return runJob("prompt", async () => {
    W.data[p].prompt = $("[data-prompt]", root).value; W.data[p].manual = true; await saveNow();
    await api(`${apiBase()}/prompt`, { method: "POST", body: { part: p, files: imagesFor(p, true).all.map((f) => f.file) } });
  }, "Claude 가 프롬프트를 다듬는 중…");
  if (act === "generate") {
    const imgs = imagesFor(p).all, d = W.data[p], pr = promptOf(p).trim(), g0 = genOf(p);
    if (!confirm(`힉스필드로 ${P.PART_NAME[p]}을 만듭니다\n모델 ${modelOf(g0.model)?.name || g0.model} · ${g0.aspect}${g0.res ? ` · ${g0.res}` : ""}${g0.quality ? ` · 품질 ${g0.quality}` : ""} · 참고 ${imgs.length}장${guideOn(p) ? " + 구도 가이드" : ""}\n크레딧이 듭니다. 계속할까요?`)) return;
    return runJob("hf", async () => {
      await saveNow(); await pinPrompt(p, pr, "generate");
      const edit = p === "variant" && imagesFor(p).prev.length;
      const refs = imgs.map((f) => f.file);
      if (guideOn(p)) refs.push(await ensureGuide(p)); // 프롬프트의 마지막 image N 줄과 순서가 맞는다
      await api("/api/hf/generate", { method: "POST", body: { target: { type: "resource", kind: W.r.kind, id: W.r.id, part: p }, kind: "image", purpose: edit ? "edit" : "sheet", prompt: d.negative ? `${pr} Avoid: ${d.negative}.` : pr, refs, ...genBody(p) } });
    }, "힉스필드에서 만드는 중… (1~3분)");
  }
  if (act === "save") return saveObj();
}
function changed(p, key) {
  const root = $("#resWizard"), [gid] = key.split("."), c = findCtl(p, key), gr = W.P.SCHEMA[p].find((x) => x.id === gid);
  W.data[p].auto = (W.data[p].auto || []).filter((k) => k !== key);
  root.querySelector(`[data-ctl="${CSS.escape(key)}"]`).outerHTML = ctlHTML(gid, c);
  root.querySelector(`[data-gcount="${gid}"]`).textContent = setCount(p, gr) ? `${setCount(p, gr)}개 고름` : "";
  if (!W.data[p].manual) root.querySelector("[data-prompt]").value = compose(p);
  if (/^(frame|cam)\./.test(key) && W.r.kind === "background") {
    const body = root.querySelector('[data-group="frame"] .wz-guide, [data-group="frame"] .wz-group__body + p');
    if (body) body.outerHTML = guideHTML(p);
    paintGuide();
  }
  if (isGrid(p) && !genOf(p).aspectSet) {
    const a = root.querySelector('[data-gen="aspect"]'); if (a) a.value = genOf(p).aspect;
    const b = root.querySelector('[data-wz="generate"]'); if (b && !W.busy) b.textContent = `✨ 힉스필드로 ${W.P.PART_NAME[p]} 만들기 (${genOf(p).aspect})`;
  }
  queueSave();
}
function onInput(e) {
  const t = e.target, p = part(), ctl = t.closest("[data-ctl]");
  if (ctl && t.matches("[data-range]")) {
    const c = findCtl(p, ctl.dataset.ctl); sel(p)[ctl.dataset.ctl] = Number(t.value);
    ctl.querySelector("output").textContent = [c.lo, `약간 ${c.lo}`, "보통", `약간 ${c.hi}`, c.hi][t.value - 1];
    const gr = W.P.SCHEMA[p].find((x) => x.id === ctl.dataset.ctl.split(".")[0]);
    $("#resWizard").querySelector(`[data-gcount="${gr.id}"]`).textContent = setCount(p, gr) ? `${setCount(p, gr)}개 고름` : "";
    if (!W.data[p].manual) $("#resWizard [data-prompt]").value = compose(p);
    return queueSave();
  }
  if (ctl && t.matches("[data-text]")) { sel(p)[ctl.dataset.ctl] = t.value; if (!W.data[p].manual) $("#resWizard [data-prompt]").value = compose(p); return queueSave(); }
  if (t.matches("[data-prompt]")) { W.data[p].prompt = t.value; W.data[p].manual = true; return queueSave(); }
  if (t.matches("[data-negative]")) { W.data[p].negative = t.value; return queueSave(); }
  if (t.matches("[data-attr], [data-basic]")) return queueSaveBasics();
}
let basicT;
const readBasics = () => {
  const root = $("#resWizard"), val = (a) => Object.fromEntries([...root.querySelectorAll(`[data-${a}]`)].map((x) => [x.dataset[a], x.value]));
  const b = val("basic"), body = { attrs: { ...W.r.attrs, ...val("attr") }, tags: b.tags, description: b.description };
  if (b.name?.trim()) body.name = b.name.trim();
  return body;
};
function queueSaveBasics() {
  clearTimeout(basicT); setSavedText("저장 중…");
  basicT = setTimeout(async () => { try { W.r = await api(apiBase(), { method: "PUT", body: readBasics() }); setSavedText("자동 저장됨"); } catch (e) { toast(e.message, true); } }, 600);
}
async function saveObj() {
  const b = readBasics();
  if (!b.name) return toast(`${W.P.noun} 이름을 적으세요`, true);
  clearTimeout(basicT);
  try {
    await saveNow(b);
    if (draft()) W.r = await api(apiBase(), { method: "PUT", body: { status: "saved" } });
    else for (const p of PARTS()) await pinPrompt(p, promptOf(p), "save").catch(() => {});
    toast(`"${b.name}" ${W.P.noun}를 저장했습니다 — 최종 프롬프트도 같이 저장됐습니다`);
    W.onClose?.(W.r.id, true);
  } catch (e) { toast(e.message, true); }
}

// 서버 작업(힉스필드·Claude)을 걸고, 끝나면 다시 읽는다
function runJob(kind, start, msg) {
  W.busy = msg; W.jobKind = kind; render();
  Promise.resolve().then(start).catch((e) => { W.busy = ""; render(); toast(e.message, true); });
}
window.addEventListener("srv-event", async ({ detail: e }) => {
  if (!W.busy || !active() || e.type !== "job" || e.state === "start") return;
  if (!(W.jobKind === "hf" ? e.kind === "hf" : e.kind === "persona")) return;
  if (e.result?.type === "drama" || e.shared) return; // 같이 도는 드라마 힉스필드 작업은 이 창 것이 아니다
  W.busy = "";
  if (e.state === "error") { toast(e.message, true); return render(); }
  await reload();
  const p = part();
  if (W.jobKind === "hf") { const q = e.result?.part || p; if (W.data[q]) W.data[q].pick = outsOf(q).slice(-1)[0]?.file; toast("결과가 들어왔습니다 — 아래 생성된 이미지에서 넘길 것을 고르세요"); }
  if (W.jobKind === "prompt") { W.data[p].prompt = W.r.parts?.[p]?.prompt || W.data[p].prompt; W.data[p].manual = true; toast("Claude 가 프롬프트를 다듬었습니다 (이전 버전은 🕘 에)"); }
  if (W.jobKind === "analyze" && e.result?.sel) {
    applyAnalysis(e.result); toast(`참고 이미지에서 ${Object.keys(e.result.sel).length}칸을 채웠습니다 — 1차 프롬프트를 만들었습니다`);
    render(); await saveNow().catch(() => {}); await pinPrompt(e.result.part, promptOf(e.result.part), "analyze").catch(() => {}); return render();
  }
  render(); queueSave();
});

// #resWizard 칸은 인물 위저드와 같이 쓴다 — 지금 이 위저드가 열려 있을 때만 반응한다 (data-wz-kind)
const active = () => $("#resWizard")?.dataset.wzKind === "obj" && !!W.r;
let bound = false;
function bind() {
  const root = $("#resWizard");
  root.addEventListener("click", (e) => { if (active()) onClick(e); });
  root.addEventListener("input", (e) => { if (active()) onInput(e); });
  root.addEventListener("change", async (e) => {
    if (!active()) return;
    const t = e.target;
    if (t.matches("[data-wzup]") && t.files.length) { try { await upload(t.files, t.dataset.wzup); } catch (err) { toast(err.message, true); } return; }
    if (t.matches("[data-send]")) { const p = part(); W.data[p].send = { ...sendOf(p), [t.dataset.send]: t.checked }; render(); return queueSave(); }
    if (t.matches("[data-gen]")) {
      const p = part(), k = t.dataset.gen; W.data[p].gen = { ...genOf(p), [k]: t.value, ...(k === "aspect" ? { aspectSet: true } : {}) };
      if (k === "model") { const m = modelOf(t.value), g1 = genOf(p); W.data[p].gen = { model: t.value, aspect: g1.aspect, aspectSet: g1.aspectSet, res: m?.res?.def, quality: m?.quality?.def }; }
      render(); return queueSave();
    }
    if (t.matches("[data-zoom]")) { W.data.zoom = { ...zoomOf(), [t.dataset.zoom]: t.dataset.zoom === "scale" ? Number(t.value) : t.value }; return queueSave(); }
    if (t.matches("[data-guideon]")) { const p = part(); W.data[p].guide = t.checked; if (!W.data[p].manual) $("#resWizard [data-prompt]").value = compose(p); return queueSave(); }
    if (t.matches("[data-refon]")) { const f = t.closest("[data-ref]").dataset.ref, d = W.data[part()]; d.skip = t.checked ? d.skip.filter((x) => x !== f) : [...d.skip, f]; render(); return queueSave(); }
  });
  root.addEventListener("toggle", (e) => { if (!active()) return; const gid = e.target.dataset?.group; if (!gid) return; const key = `${part()}.${gid}`; e.target.open ? W.openGroups.add(key) : W.openGroups.delete(key); }, true);
  ["dragenter", "dragover"].forEach((ty) => root.addEventListener(ty, (e) => { if (!active()) return; const z = e.target.closest("[data-wzdrop]"); if (z) { e.preventDefault(); z.classList.add("is-over"); } }));
  ["dragleave", "drop"].forEach((ty) => root.addEventListener(ty, (e) => { if (active()) e.target.closest("[data-wzdrop]")?.classList.remove("is-over"); }));
  root.addEventListener("drop", async (e) => { if (!active()) return; const z = e.target.closest("[data-wzdrop]"); if (!z) return; e.preventDefault(); if (e.dataTransfer.files.length) try { await upload(e.dataTransfer.files, z.dataset.wzdrop); } catch (err) { toast(err.message, true); } });
}

export const objWizardKinds = Object.keys(PROFILES);
export const objWizardSteps = (kind) => PROFILES[kind]?.STEPS.length || 0;
/** 나가기 전 저장 (길잡이로 다른 칸에 갈 때) */
export async function closeObjWizard() { clearTimeout(W.saveT); if (active()) await saveNow().catch(() => {}); }
/** 위저드 열기. r = 배경·제품 리소스(작성 중이거나 저장된 것) · onClose(id, saved) */
export async function openObjWizard(r, onClose, crumbs = []) {
  if (!bound) { bind(); bound = true; }
  $("#resWizard").dataset.wzKind = "obj";
  if (!W.models) W.models = await api("/api/hf/image-models").catch(() => null);
  if (!W.kinds) W.kinds = window.resKinds || (await api("/api/resource-kinds").catch(() => ({})));
  W.P = PROFILES[r.kind]; W.r = r; W.crumbs = crumbs; W.data = initData(r);
  W.step = Math.min(W.P.STEPS.length - 1, Number(r.wizard?.step) || 0); W.onClose = onClose; W.busy = ""; W.openGroups = new Set();
  W.histOpen = false; W.importOpen = false; W.importList = null;
  render();
}
