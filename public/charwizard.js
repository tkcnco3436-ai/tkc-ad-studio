// 인물 만들기 위저드 — ① 얼굴 → ② 전신 → ③ 시트 → ④ 페르소나 → ⑤ 이름·저장
// 얼굴·전신·시트는 세부 조정(칩·범위 막대·색)과 참고 이미지(부위별로 무엇을 따를지)로 고르면 최종 프롬프트가 바로 만들어지고,
// 그 프롬프트로 힉스필드에서 만들거나 결과를 직접 올린다. 각 단계에서 고른 대표 결과가 다음 단계의 "image 1·2" 가 된다.
// 진행은 작성 중(draft) 리소스에 계속 저장되어 나중에 이어 할 수 있고, 저장할 때 최종 프롬프트 셋이 리소스와 기록에 같이 남는다.
// 쓰는 곳: public/resources.js (openWizard) · 서버: lib/resources.js (wizard · status · makePersona keepParts · completePrompt)
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

// ── 조정 칸 정의 ──────────────────────────────────────
// chips: 하나 고르기 · multi: 여럿 · scale: 5칸 범위 막대 (가운데 "보통"은 프롬프트에서 뺀다) · num: 숫자 범위 · swatch: 색 · text: 직접 쓰기 · check
// opts = [[값, 한국어, 영어 조각]] · scale.en = 1~5칸의 영어 조각 (null 은 빼기)
const chips = (k, label, opts, o = {}) => ({ k, label, type: "chips", opts, ...o });
const multi = (k, label, opts, o = {}) => ({ k, label, type: "multi", opts, ...o });
const scale = (k, label, lo, hi, en, o = {}) => ({ k, label, type: "scale", lo, hi, en, def: 3, ...o });
const level = (k, label, hi, en, o = {}) => scale(k, label, "없음", hi, en, { def: 1, ...o }); // 없음 → 많음
const num = (k, label, min, max, step, def, unit, en) => ({ k, label, type: "num", min, max, step, def, unit, en });
const swatch = (k, label, opts, o = {}) => ({ k, label, type: "swatch", opts, ...o }); // [[값, 한국어, hex, 영어]]
const text = (k, label, ph, en) => ({ k, label, type: "text", ph, en });
const g = (id, label, en, items, o = {}) => ({ id, label, en, items, ...o });

const SKIN = [["porcelain", "아주 밝은", "#f6e1d3", "very fair porcelain"], ["fair", "밝은", "#efd0b8", "fair"], ["light", "밝은 중간", "#e6bc98", "light"], ["lightmed", "중간 밝은", "#d9a57f", "light-medium"],
  ["medium", "중간", "#c68e63", "medium"], ["olive", "올리브", "#b08a5c", "olive"], ["tan", "태닝", "#a06d45", "tan"], ["brown", "갈색", "#875533", "brown"], ["deepbrown", "짙은 갈색", "#5f3a22", "deep brown"], ["deep", "아주 짙은", "#432616", "very deep"]];
const HAIR = [["black", "흑발", "#16130f", "jet black"], ["darkbrown", "짙은 갈색", "#3b2a20", "dark brown"], ["brown", "갈색", "#6b4a32", "medium brown"], ["lightbrown", "밝은 갈색", "#9a6b45", "light brown"],
  ["auburn", "적갈색", "#7a3b2a", "auburn"], ["red", "빨강", "#a8331f", "copper red"], ["blonde", "금발", "#d8b46a", "golden blonde"], ["ash", "애쉬", "#b8b0a2", "ash blonde"], ["platinum", "백금", "#e4dccb", "platinum blonde"],
  ["grey", "회색", "#9a9a9a", "grey"], ["white", "흰색", "#ece9e3", "white"], ["pink", "핑크", "#e7a3b8", "pastel pink"], ["blue", "블루", "#4a6fb5", "blue"], ["purple", "보라", "#7a5aa8", "purple"]];
const EYES = [["darkbrown", "짙은 갈색", "#2b1b12", "dark brown"], ["brown", "갈색", "#5b3a24", "brown"], ["hazel", "헤이즐", "#8a6a3a", "hazel"], ["amber", "호박색", "#b07a2a", "amber"],
  ["green", "초록", "#5b7a4a", "green"], ["blue", "파랑", "#5a7fa8", "blue"], ["grey", "회색", "#8a9098", "grey"], ["black", "검정", "#121212", "near-black"]];
const LIPS = [["nude", "누드", "#c98f7a", "natural nude"], ["pink", "핑크", "#d97b8b", "soft pink"], ["rose", "로즈", "#b8576a", "rose"], ["coral", "코랄", "#e2725b", "coral"],
  ["red", "레드", "#a3202c", "red"], ["berry", "베리", "#7b2c46", "berry"], ["pale", "창백", "#d8a99a", "pale"]];
const STYLE = chips("style", "그림 스타일", [["photo", "실사", "photorealistic"], ["film", "필름 사진", "35mm film photograph style"], ["render", "3D 렌더", "high-quality 3D character render"], ["semi", "반실사", "semi-realistic digital painting"], ["anime", "애니", "anime style"], ["illust", "일러스트", "clean character illustration"]], { def: "photo" });
const ACC = [["earrings", "귀걸이", "small earrings"], ["necklace", "목걸이", "a thin necklace"], ["cap", "모자", "a cap"], ["headband", "머리띠", "a headband"], ["clip", "헤어핀", "a hair clip"], ["watch", "시계", "a wristwatch"], ["ring", "반지", "a ring"], ["bag", "가방", "a small shoulder bag"]];

// 포즈 목록 (한 장 · 시트 공용)
const POSES = [["standing", "서 있기", "standing naturally with the weight on one leg"], ["walking", "걷기", "walking toward the camera mid-stride"], ["sitting", "의자에 앉기", "sitting on a simple stool"],
  ["floor", "바닥에 앉기", "sitting on the floor with knees up"], ["crouch", "쪼그려 앉기", "crouching down"], ["lean", "벽에 기대기", "leaning against a wall"], ["crossarms", "팔짱", "standing with arms crossed"],
  ["hips", "허리에 손", "standing with hands on the hips"], ["pockets", "주머니에 손", "standing with hands in the pockets"], ["wave", "손 흔들기", "waving at the camera"], ["running", "달리기", "running"],
  ["jumping", "점프", "jumping mid-air"], ["dance", "춤", "dancing"], ["action", "액션", "a dynamic action pose"], ["lying", "누워 있기", "lying on the side propped on one elbow"],
  ["phone", "휴대폰 보기", "looking at a smartphone"], ["coffee", "커피 들기", "holding a coffee cup"], ["thinking", "생각", "a thinking pose with a hand on the chin"]];

const SCHEMA = {
  face: [
    g("basic", "기본", null, [
      chips("gender", "성별", [["female", "여성", "woman"], ["male", "남성", "man"], ["androgynous", "중성적", "androgynous person"]]),
      num("age", "나이", 12, 80, 1, 27, "세", (v) => `around ${v} years old`),
      chips("ethnicity", "외형 계열", [["eastasian", "동아시아", "East Asian"], ["sea", "동남아시아", "Southeast Asian"], ["southasian", "남아시아", "South Asian"], ["mideast", "중동", "Middle Eastern"], ["european", "유럽", "European"], ["african", "아프리카", "African"], ["latin", "라틴", "Latin American"], ["mixed", "혼혈", "mixed-heritage"]]),
      STYLE,
    ], { open: true }),
    g("shape", "얼굴형", "Face", [
      chips("shape", "얼굴형", [["oval", "계란형", "oval face"], ["round", "둥근형", "round face"], ["square", "각진형", "square face"], ["heart", "하트형", "heart-shaped face"], ["long", "긴형", "long face"], ["diamond", "다이아몬드형", "diamond-shaped face"]]),
      scale("jaw", "턱선", "부드러움", "각짐", ["very soft rounded jawline", "soft jawline", null, "defined jawline", "sharp angular jawline"]),
      chips("chin", "턱끝", [["pointed", "뾰족", "pointed chin"], ["rounded", "둥근", "rounded chin"], ["square", "각진", "square chin"], ["cleft", "갈라진", "cleft chin"], ["small", "작은", "small receding chin"]]),
      scale("cheekbones", "광대", "낮음", "높음", ["flat cheekbones", "low cheekbones", null, "high cheekbones", "very prominent high cheekbones"]),
      scale("cheeks", "볼살", "홀쭉", "통통", ["hollow cheeks", "slim cheeks", null, "full cheeks", "very full round cheeks"]),
      scale("forehead", "이마", "좁음", "넓음", ["very narrow forehead", "narrow forehead", null, "broad forehead", "very broad high forehead"]),
      scale("faceSize", "얼굴 크기", "작음", "큼", ["very small face", "small face", null, "large face", "very large face"]),
    ]),
    g("eyes", "눈", "Eyes", [
      scale("size", "크기", "작음", "큼", ["very small eyes", "small eyes", null, "large eyes", "very large eyes"]),
      chips("shape", "모양", [["almond", "아몬드", "almond-shaped eyes"], ["round", "둥근", "round eyes"], ["upturned", "올라간", "upturned cat-like eyes"], ["downturned", "처진", "gently downturned eyes"], ["hooded", "덮인", "hooded eyes"], ["narrow", "가는", "narrow eyes"]]),
      chips("lid", "쌍꺼풀", [["monolid", "무쌍", "monolid eyelids"], ["inner", "속쌍", "subtle inner double eyelids"], ["double", "쌍꺼풀", "visible double eyelids"]]),
      scale("spacing", "눈 사이", "좁음", "넓음", ["close-set eyes", "slightly close-set eyes", null, "slightly wide-set eyes", "wide-set eyes"]),
      swatch("color", "눈동자 색", EYES.map(([v, l, h, e]) => [v, l, h, `${e} irises`])),
      scale("lashes", "속눈썹", "짧음", "김", ["very short sparse lashes", "short lashes", null, "long lashes", "very long thick lashes"]),
      scale("aegyo", "애교살", "없음", "도톰", [null, "slight under-eye fullness", "visible aegyo-sal under-eye fat", "pronounced aegyo-sal", "very prominent aegyo-sal"], { def: 1 }),
    ]),
    g("brows", "눈썹", "Eyebrows", [
      scale("thick", "두께", "가늚", "진함", ["very thin brows", "thin brows", null, "thick brows", "very thick bushy brows"]),
      chips("shape", "모양", [["straight", "일자", "straight brows"], ["arched", "아치", "arched brows"], ["angled", "각진", "angled brows"], ["rounded", "둥근", "softly rounded brows"], ["downturned", "처진", "slightly downturned brows"]]),
      chips("color", "색", [["hair", "머리색과 같게", "matching the hair color"], ["darker", "더 진하게", "darker than the hair"], ["lighter", "더 연하게", "lighter than the hair"]]),
    ]),
    g("nose", "코", "Nose", [
      scale("size", "크기", "작음", "큼", ["very small nose", "small nose", null, "large nose", "very large nose"]),
      scale("bridge", "콧대", "낮음", "높음", ["very low flat nose bridge", "low nose bridge", null, "high nose bridge", "very high straight nose bridge"]),
      chips("tip", "코끝", [["rounded", "둥근", "rounded nose tip"], ["pointed", "뾰족", "pointed nose tip"], ["upturned", "들린", "slightly upturned nose tip"], ["bulbous", "뭉툭", "bulbous nose tip"], ["hooked", "매부리", "slightly hooked nose"]]),
      scale("width", "콧볼", "좁음", "넓음", ["very narrow nostrils", "narrow nose", null, "wide nose", "very wide nostrils"]),
    ]),
    g("mouth", "입", "Mouth", [
      scale("lips", "입술 두께", "얇음", "도톰", ["very thin lips", "thin lips", null, "full lips", "very full plump lips"]),
      scale("width", "입 크기", "작음", "큼", ["very small mouth", "small mouth", null, "wide mouth", "very wide mouth"]),
      chips("corners", "입꼬리", [["up", "올라감", "upturned mouth corners"], ["straight", "일자", "straight mouth line"], ["down", "처짐", "slightly downturned mouth corners"]]),
      chips("cupid", "윗입술 산", [["defined", "뚜렷", "well-defined cupid's bow"], ["soft", "흐림", "soft cupid's bow"]]),
      swatch("color", "입술 색", LIPS.map(([v, l, h, e]) => [v, l, h, `${e} lips`])),
      chips("teeth", "치아", [["hidden", "안 보임", "lips closed"], ["slight", "살짝", "teeth slightly visible"], ["smile", "보이게", "natural teeth showing"]]),
    ]),
    g("ears", "귀", "Ears", [
      scale("size", "크기", "작음", "큼", ["very small ears", "small ears", null, "large ears", "very large ears"]),
      chips("shape", "모양", [["flat", "붙은", "ears close to the head"], ["protruding", "돌출", "slightly protruding ears"], ["pointed", "뾰족", "slightly pointed ears"]]),
      multi("piercing", "피어싱·귀걸이", [["lobe", "귓불 피어싱", "earlobe piercings"], ["helix", "연골 피어싱", "a helix piercing"], ["multiple", "여러 개", "multiple ear piercings"], ["studs", "작은 귀걸이", "small stud earrings"], ["hoops", "링 귀걸이", "hoop earrings"], ["drops", "드롭 귀걸이", "drop earrings"]], { none: "any ear piercings or earrings" }),
    ]),
    g("skin", "피부", "Skin", [
      swatch("tone", "피부톤", SKIN.map(([v, l, h, e]) => [v, l, h, `${e} skin tone`])),
      chips("undertone", "언더톤", [["warm", "웜", "warm undertone"], ["neutral", "뉴트럴", "neutral undertone"], ["cool", "쿨", "cool undertone"]]),
      scale("texture", "피부결", "매끈", "거침", ["glass-smooth skin", "smooth skin", null, "slightly rough skin texture", "rough weathered skin"]),
      scale("glow", "윤기", "매트", "물광", ["very matte skin", "matte skin", null, "dewy skin", "very glowy glass skin"]),
      level("pores", "모공", "뚜렷", [null, "barely visible pores", "visible pores", "noticeable pores", "large visible pores"]),
      level("freckles", "주근깨·잡티", "많음", [null, "a few faint freckles", "light freckles across the nose", "many freckles", "heavy freckles"]),
      level("blemish", "트러블", "흉터까지", [null, "a couple of tiny blemishes", "some blemishes", "noticeable acne", "acne with acne scars"]),
      level("redness", "홍조", "강함", [null, "a slight natural flush", "rosy cheeks", "noticeable redness on the cheeks", "strong facial redness"]),
      level("circles", "다크서클", "짙음", [null, "faint under-eye shadows", "visible dark circles", "pronounced dark circles", "heavy dark circles"]),
      level("wrinkles", "주름", "깊음", [null, "faint fine lines", "fine lines around the eyes", "visible wrinkles", "deep wrinkles"]),
      multi("moles", "점·뷰티마크", [["undereye", "눈밑", "a small mole under the eye"], ["lip", "입가", "a beauty mark near the lips"], ["cheek", "볼", "a mole on the cheek"], ["nose", "코옆", "a mole beside the nose"], ["forehead", "이마", "a mole on the forehead"], ["neck", "목", "a mole on the neck"]], { none: "moles or beauty marks" }),
      chips("real", "피부 표현", [["natural", "피부결 그대로", "visible natural skin texture, no airbrushing"], ["retouched", "보정한 듯", "softly retouched skin"]], { def: "natural" }),
    ]),
    g("facialhair", "수염", "Facial hair", [
      chips("beard", "수염", [["none", "없음", "clean-shaven"], ["stubble", "면도 자국", "light stubble"], ["short", "짧은 수염", "short trimmed beard"], ["full", "풍성", "full beard"], ["mustache", "콧수염", "a mustache"], ["goatee", "염소수염", "a goatee"]]),
    ]),
    g("hair", "머리", "Hair", [
      chips("length", "길이", [["buzz", "삭발", "buzz-cut"], ["short", "숏컷", "short"], ["ear", "귀 길이", "ear-length"], ["bob", "단발", "chin-length bob"], ["shoulder", "어깨", "shoulder-length"], ["long", "긴", "long"], ["verylong", "아주 긴", "very long waist-length"]]),
      chips("texture", "결", [["straight", "생머리", "straight"], ["wavy", "웨이브", "wavy"], ["curly", "곱슬", "curly"], ["coily", "강한 곱슬", "tightly coiled"]]),
      swatch("color", "머리색", HAIR.map(([v, l, h, e]) => [v, l, h, `${e} hair`])),
      chips("style", "스타일", [["down", "풀은", "worn down"], ["ponytail", "포니테일", "in a ponytail"], ["bun", "번", "in a bun"], ["braids", "땋은", "in braids"], ["half", "반묶음", "half-up"], ["slick", "넘긴", "slicked back"], ["messy", "부스스", "messy and tousled"]]),
      chips("bangs", "앞머리", [["none", "없음", "no bangs"], ["full", "일자", "full blunt bangs"], ["side", "옆으로", "side-swept bangs"], ["curtain", "커튼", "curtain bangs"], ["wispy", "시스루", "wispy see-through bangs"]]),
      chips("part", "가르마", [["center", "가운데", "center part"], ["side", "옆", "side part"], ["none", "없음", "no visible part"]]),
      scale("volume", "숱", "적음", "풍성", ["very thin fine hair", "thin hair", null, "thick hair", "very thick voluminous hair"]),
    ]),
    g("wear", "배경·옷", "", [
      chips("bg", "배경", [["white", "흰색", "plain pure white background"], ["lightgrey", "밝은 회색", "plain light grey background"], ["studio", "스튜디오", "soft studio backdrop"]], { def: "white" }),
      chips("top", "옷", [["tank", "흰 나시", "wearing a plain white sleeveless tank top"], ["tee", "흰 티셔츠", "wearing a plain white crew-neck t-shirt"], ["none", "지정 안 함", ""]], { def: "tank" }),
    ]),
    g("look", "표정·꾸밈", "Styling", [
      chips("expr", "표정", [["neutral", "무표정", "neutral expression"], ["soft", "은은한 미소", "soft closed-mouth smile"], ["smile", "미소", "gentle smile"], ["laugh", "활짝", "big open smile"], ["serious", "진지", "serious expression"], ["confident", "자신감", "confident slight smirk"], ["surprised", "놀람", "surprised expression"]], { def: "soft" }),
      chips("gaze", "시선", [["camera", "정면 응시", "looking directly at the camera"], ["away", "살짝 옆", "looking slightly off-camera"]], { def: "camera" }),
      scale("makeup", "메이크업", "생얼", "풀메이크업", ["no makeup, bare face", "minimal natural makeup", null, "polished makeup", "full glam makeup"]),
      chips("glasses", "안경", [["none", "없음", "", "glasses"], ["round", "둥근테", "round glasses"], ["square", "사각테", "rectangular glasses"], ["rimless", "무테", "rimless glasses"], ["sun", "선글라스", "sunglasses"]]),
      multi("acc", "액세서리", ACC.filter(([k]) => k !== "earrings"), { none: "other jewelry or accessories" }),
      text("memo", "더 적을 것", "예: 왼쪽 눈썹에 작은 흉터, 웃을 때 보조개", (v) => `Additional details: ${v}.`),
    ]),
  ],
  body: [
    g("whole", "전체 체형", "Body", [
      STYLE,
      num("height", "키", 140, 200, 1, 165, "cm", (v) => `about ${v} cm tall`),
      scale("weight", "살집", "마름", "통통", ["very slim thin build", "slim build", null, "soft curvy build", "heavyset plus-size build"]),
      scale("muscle", "근육", "적음", "많음", ["no visible muscle tone", "light muscle tone", null, "athletic toned build", "very muscular build"]),
      chips("type", "체형 타입", [["rectangle", "일자형", "straight rectangular body shape"], ["hourglass", "모래시계", "hourglass figure"], ["invtriangle", "역삼각", "inverted-triangle build"], ["pear", "하체형", "pear-shaped figure"], ["apple", "상체형", "apple-shaped figure"]]),
      chips("proportion", "비율", [["model", "모델 비율", "long-legged model proportions"], ["average", "보통", "average proportions"], ["petite", "아담", "petite proportions"], ["sturdy", "다부진", "compact sturdy proportions"]]),
      scale("head", "머리 크기", "작음", "큼", ["very small head relative to body", "small head", null, "large head", "very large head"]),
    ], { open: true }),
    g("upper", "상체", "Upper body", [
      scale("shoulders", "어깨", "좁음", "넓음", ["very narrow shoulders", "narrow shoulders", null, "broad shoulders", "very broad shoulders"]),
      chips("shoulderShape", "어깨 모양", [["sloped", "처진", "sloping shoulders"], ["straight", "직각", "straight square shoulders"], ["round", "둥근", "rounded shoulders"]]),
      scale("neck", "목", "짧음", "김", ["very short neck", "short neck", null, "long neck", "very long slender neck"]),
      scale("chest", "가슴", "작음", "큼", ["very flat chest", "small chest", null, "full chest", "very large chest"]),
      scale("waist", "허리", "잘록", "일자", ["very narrow cinched waist", "narrow waist", null, "straight waist", "thick waist"]),
      chips("belly", "배", [["flat", "납작", "flat stomach"], ["soft", "부드러운", "soft stomach"], ["abs", "복근", "visible abs"], ["round", "둥근", "round belly"]]),
      scale("arms", "팔", "가늚", "굵음", ["very thin arms", "slender arms", null, "strong arms", "thick muscular arms"]),
      scale("armLen", "팔 길이", "짧음", "김", ["short arms", "slightly short arms", null, "long arms", "very long arms"]),
    ]),
    g("lower", "하체", "Lower body", [
      scale("hips", "골반", "좁음", "넓음", ["very narrow hips", "narrow hips", null, "wide hips", "very wide hips"]),
      scale("glutes", "엉덩이", "작음", "큼", ["very flat glutes", "small glutes", null, "full rounded glutes", "very large glutes"]),
      scale("legLen", "다리 길이", "짧음", "김", ["very short legs", "short legs", null, "long legs", "very long legs"]),
      scale("thighs", "허벅지", "가늚", "굵음", ["very thin thighs", "slim thighs", null, "thick thighs", "very thick muscular thighs"]),
      scale("calves", "종아리", "가늚", "굵음", ["very thin calves", "slim calves", null, "defined calves", "very muscular calves"]),
      chips("legShape", "다리 모양", [["straight", "일자", "straight legs"], ["o", "O자", "slightly bowed legs"], ["x", "X자", "slightly knock-kneed legs"]]),
    ]),
    g("hands", "손·발", "Hands and feet", [
      scale("hands", "손 크기", "작음", "큼", ["very small hands", "small hands", null, "large hands", "very large hands"]),
      chips("fingers", "손가락", [["slender", "가늘고 긴", "long slender fingers"], ["short", "짧은", "short fingers"], ["sturdy", "마디 굵은", "sturdy knuckled fingers"]]),
      chips("nails", "손톱", [["short", "짧은", "short clean nails"], ["natural", "자연", "natural nails"], ["long", "긴", "long nails"], ["art", "네일아트", "decorated nail art"]]),
      scale("feet", "발 크기", "작음", "큼", ["very small feet", "small feet", null, "large feet", "very large feet"]),
    ]),
    g("pose", "자세·분위기", "Pose", [
      chips("posture", "자세", [["upright", "곧은", "upright confident posture"], ["relaxed", "편안한", "relaxed posture"], ["slouched", "구부정", "slightly slouched posture"], ["dynamic", "역동", "dynamic stance"]], { def: "upright" }),
      chips("arms", "팔 위치", [["sides", "내림", "arms relaxed at the sides"], ["pockets", "주머니", "hands in pockets"], ["hips", "허리에 손", "hands on hips"], ["crossed", "팔짱", "arms crossed"]], { def: "sides" }),
      chips("energy", "분위기", [["calm", "차분", "calm presence"], ["energetic", "활기", "energetic presence"], ["elegant", "우아", "elegant presence"], ["tough", "강인", "tough presence"], ["cute", "귀여운", "cute playful presence"]]),
      text("memo", "더 적을 것", "예: 왼손에 반지, 셔츠 소매 걷음", (v) => `Additional details: ${v}.`),
    ]),
    g("base", "배경·기본 옷", "", [
      chips("bg", "배경", [["white", "흰색", "plain pure white background"], ["lightgrey", "밝은 회색", "plain light grey background"], ["studio", "스튜디오", "soft studio backdrop with floor shadow"]], { def: "white" }),
      chips("wear", "기본 옷 (의상 시트가 없을 때)", [["tankshorts", "흰 나시 + 흰 반바지", "wearing a plain white sleeveless tank top and plain white shorts"], ["tank", "흰 나시", "wearing a plain white sleeveless tank top"], ["tee", "흰 티 + 청바지", "wearing a plain white t-shirt and blue jeans"], ["none", "지정 안 함", ""]], { def: "tankshorts" }),
    ]),
    g("bodyskin", "몸 피부", "Body skin", [
      chips("tone", "피부톤", [["same", "얼굴과 같게", "skin tone matching the face"], ["tanned", "더 그을린", "slightly more tanned body skin"]], { def: "same" }),
      multi("tattoo", "타투", [["forearm", "팔뚝", "a tattoo on the forearm"], ["sleeve", "슬리브", "a full sleeve tattoo"], ["neck", "목", "a small neck tattoo"], ["hand", "손", "small hand tattoos"], ["back", "등", "a back tattoo"], ["ankle", "발목", "an ankle tattoo"]], { none: "tattoos" }),
      level("bodyhair", "체모", "많음", [null, "light body hair", "noticeable body hair", "hairy arms and legs", "very hairy body"]),
      multi("marks", "흉터·표식", [["armscar", "팔 흉터", "a faint scar on the arm"], ["knee", "무릎 흉터", "a scar on the knee"], ["birthmark", "반점", "a birthmark"], ["veins", "핏줄", "visible veins on the arms"]]),
    ]),
  ],
  // 의상 시트: 사람 없이 옷만 (플랫레이·마네킹). 전신 단계가 이 결과를 image 2 로 입는다
  outfit: [
    g("look", "스타일·상황", "Style", [
      chips("style", "스타일", [["casual", "캐주얼", "casual"], ["street", "스트릿", "streetwear"], ["office", "오피스", "smart office"], ["formal", "포멀", "formal"], ["sporty", "스포티", "sporty athleisure"], ["minimal", "미니멀", "minimalist"], ["vintage", "빈티지", "vintage"], ["lovely", "러블리", "lovely feminine"], ["hanbok", "한복", "modern hanbok"], ["uniform", "교복", "school uniform"], ["work", "작업복", "workwear"]]),
      chips("season", "계절", [["spring", "봄", "spring"], ["summer", "여름", "summer"], ["autumn", "가을", "autumn"], ["winter", "겨울", "winter"]]),
      chips("occasion", "상황", [["daily", "일상", "everyday"], ["office", "출근", "office"], ["date", "데이트", "date night"], ["party", "파티", "party"], ["travel", "여행", "travel"], ["sport", "운동", "workout"], ["home", "홈웨어", "loungewear at home"], ["ceremony", "예식", "ceremony"]]),
      chips("fit", "핏", [["slim", "슬림", "slim fit"], ["regular", "레귤러", "regular fit"], ["oversized", "오버사이즈", "oversized fit"]]),
    ], { open: true }),
    g("items", "아이템", "Items", [
      text("top", "상의", "예: 흰 옥스퍼드 셔츠", (v) => `top: ${v}`),
      text("outer", "아우터", "예: 베이지 트렌치코트", (v) => `outerwear: ${v}`),
      text("bottom", "하의", "예: 연청 와이드 데님", (v) => `bottom: ${v}`),
      text("dress", "원피스·세트", "예: 네이비 셔츠 원피스", (v) => `dress or set: ${v}`),
      text("shoes", "신발", "예: 흰 가죽 스니커즈", (v) => `shoes: ${v}`),
      text("bag", "가방", "예: 검정 미니 크로스백", (v) => `bag: ${v}`),
      text("hat", "모자", "예: 네이비 볼캡", (v) => `hat: ${v}`),
      text("socks", "양말·스타킹", "예: 흰 크루삭스", (v) => `socks: ${v}`),
      multi("acc", "액세서리", ACC),
    ], { open: true }),
    g("fabric", "소재·무늬", "Fabric", [
      multi("fabric", "소재", [["cotton", "면", "cotton"], ["denim", "데님", "denim"], ["knit", "니트", "knit"], ["leather", "가죽", "leather"], ["linen", "린넨", "linen"], ["silk", "실크", "silk"], ["wool", "울", "wool"], ["fleece", "플리스", "fleece"], ["nylon", "나일론", "nylon"], ["corduroy", "코듀로이", "corduroy"], ["tweed", "트위드", "tweed"]]),
      chips("pattern", "무늬", [["solid", "무지", "solid colors"], ["stripe", "스트라이프", "stripes"], ["check", "체크", "check pattern"], ["dot", "도트", "polka dots"], ["floral", "플로럴", "floral print"], ["graphic", "그래픽", "graphic print"], ["camo", "카모", "camouflage"]]),
    ]),
    g("color", "색", "Colors", [
      multi("colors", "색 조합", [["white", "흰", "white"], ["black", "검정", "black"], ["grey", "회색", "grey"], ["beige", "베이지", "beige"], ["ivory", "아이보리", "ivory"], ["navy", "네이비", "navy"], ["brown", "브라운", "brown"], ["khaki", "카키", "khaki"], ["red", "빨강", "red"], ["pink", "핑크", "pink"], ["yellow", "노랑", "yellow"], ["green", "초록", "green"], ["blue", "파랑", "blue"], ["skyblue", "하늘", "sky blue"], ["purple", "보라", "purple"]]),
      chips("tone", "색감", [["pastel", "파스텔", "pastel tones"], ["muted", "뮤트", "muted tones"], ["vivid", "비비드", "vivid tones"], ["mono", "모노톤", "monochrome"], ["earth", "어스톤", "earth tones"]]),
    ]),
    // 그리드 시트: 여러 각도 · 아이템 단독 · 디테일 클로즈업을 한 장의 격자에 (칸마다 무엇을 넣을지 Panel N 으로 적는다)
    g("disp", "시트 구성 (그리드)", "Sheet", [
      multi("panels", "들어갈 컷 (순서대로 칸에 들어감)", [
        ["front", "전체 정면", "the full outfit, front view"], ["back", "전체 뒷면", "the full outfit, back view"], ["side", "전체 측면", "the full outfit, side view"], ["tq", "3/4 각도", "the full outfit, three-quarter view"],
        ["items", "아이템별 단독컷", ""], ["fabric", "원단 질감", "a close-up of the fabric texture and weave"], ["closure", "단추·지퍼", "a close-up of the buttons, zippers and fastenings"],
        ["stitch", "스티치·마감", "a close-up of the stitching, seams and hems"], ["label", "라벨·로고", "a close-up of the labels, logos or embroidery"], ["pattern", "무늬", "a close-up of the print or pattern"],
        ["shoes", "신발 측면·밑창", "the shoes from the side and the sole"], ["fit", "착용 핏", "the outfit on an invisible ghost mannequin showing the fit and silhouette from the front"],
      ], { def: ["front", "back", "side", "items", "fabric", "closure"] }),
      chips("grid", "그리드", [["auto", "자동", ""], ["2x2", "2×2", ""], ["3x2", "3×2", ""], ["3x3", "3×3", ""], ["4x3", "4×3", ""], ["4x4", "4×4", ""]], { def: "auto" }),
      chips("hero", "첫 칸", [["big", "크게 (메인 전체컷)", ""], ["same", "다른 칸과 같게", ""]], { def: "same" }),
      chips("display", "전체컷 보여주는 방식", [["ghost", "고스트 마네킹", "on an invisible ghost mannequin"], ["flatlay", "플랫레이", "as a neat flat lay seen from above"], ["mannequin", "마네킹", "on a plain faceless mannequin"], ["hanger", "옷걸이", "on hangers"]], { def: "ghost" }),
      chips("labels", "칸 라벨", [["none", "없음", ""], ["small", "작은 라벨", ""]], { def: "none" }),
      chips("bg", "배경", [["white", "흰색", "pure white background"], ["lightgrey", "밝은 회색", "plain light grey background"]], { def: "white" }),
      STYLE,
      text("memo", "더 적을 것", "예: 셔츠 소매에 자수 로고", (v) => `Additional details: ${v}.`),
    ], { open: true }),
  ],
  sheet: [
    // 그리드 시트: 고른 컷이 순서대로 (전신 각도 → 얼굴 각도 → 표정 → 디테일) 한 장의 격자 칸에 들어간다
    g("grid", "시트 구성 (그리드)", "Sheet", [
      multi("body", "전신 각도", [["front", "정면", "full body, front view"], ["back", "뒷면", "full body, back view"], ["left", "좌측면", "full body, left side profile view"], ["right", "우측면", "full body, right side profile view"],
        ["tqf", "3/4 앞", "full body, three-quarter front view"], ["tqb", "3/4 뒤", "full body, three-quarter back view"]], { def: ["front", "left", "back"] }),
      multi("face", "얼굴 각도", [["front", "정면", "head-and-shoulders close-up, facing the camera"], ["tql", "3/4 왼쪽", "head-and-shoulders close-up, three-quarter view turned to the left"], ["tqr", "3/4 오른쪽", "head-and-shoulders close-up, three-quarter view turned to the right"],
        ["pl", "옆얼굴 왼쪽", "head close-up, left profile"], ["pr", "옆얼굴 오른쪽", "head close-up, right profile"], ["up", "올려다본 각도", "face close-up from a low angle looking up"], ["down", "내려다본 각도", "face close-up from a high angle looking down"], ["backhead", "뒤통수·헤어", "back of the head showing the hairstyle"]], { def: ["front", "tql", "pr"] }),
      multi("expr", "표정", [["neutral", "무표정", "a neutral expression"], ["smile", "미소", "a gentle smile"], ["laugh", "활짝 웃음", "laughing with an open smile"], ["surprised", "놀람", "a surprised expression"],
        ["angry", "화남", "an angry expression"], ["sad", "슬픔", "a sad expression"], ["serious", "진지", "a serious expression"], ["wink", "윙크", "a playful wink"]], { def: ["smile", "surprised", "serious"] }),
      multi("detail", "디테일", [["hands", "손", "a close-up of the hands"], ["outfit", "의상 디테일", "a close-up of the outfit details"], ["shoes", "신발", "a close-up of the shoes"], ["hair", "헤어 디테일", "a close-up of the hair texture and styling"]]),
      chips("grid", "그리드", [["auto", "자동", ""], ["3x2", "3×2", ""], ["3x3", "3×3", ""], ["4x3", "4×3", ""], ["4x4", "4×4", ""], ["5x4", "5×4", ""]], { def: "auto" }),
      chips("hero", "첫 칸", [["big", "크게 (메인 전신)", ""], ["same", "다른 칸과 같게", ""]], { def: "same" }),
      chips("labels", "칸 라벨", [["none", "없음", ""], ["small", "작은 라벨", ""]], { def: "none" }),
    ], { open: true }),
    g("wear", "의상", "Outfit", [
      chips("inherit", "의상", [["body", "전신 단계 의상 그대로", "wearing exactly the same outfit as in the full-body image"], ["new", "새로 정하기", ""]], { def: "body" }),
      text("outfit", "새 의상", "새로 정하기일 때: 예: 검정 트렌치코트, 흰 터틀넥", (v) => `outfit: ${v}`),
      multi("acc", "액세서리", ACC),
    ]),
    g("look", "배경·스타일", "Style", [
      STYLE,
      chips("bg", "배경", [["white", "흰색", "pure white background"], ["lightgrey", "밝은 회색", "plain light grey background"], ["studio", "스튜디오", "studio backdrop with soft floor shadow"]], { def: "white" }),
      chips("light", "조명", [["even", "균일", "even soft studio lighting"], ["soft", "부드러운", "soft diffused lighting"], ["dramatic", "드라마틱", "dramatic side lighting"]], { def: "even" }),
      text("memo", "더 적을 것", "예: 오른쪽 아래에 소품 컷 하나 추가", (v) => `Additional details: ${v}.`),
    ]),
  ],
  // ④ 포즈 (건너뛸 수 있음): 앞에서 만든 얼굴·전신(의상)을 image 1·2 로 이어 받아 같은 사람·같은 옷으로 자세만 바꾼다
  pose: [
    g("preset", "포즈", "Pose", [
      chips("mode", "만들 것", [["single", "포즈 한 장", ""], ["sheet", "포즈 시트 (여러 포즈 그리드)", ""]], { def: "single", noAnalyze: true }),
      chips("pose", "포즈 (한 장일 때)", POSES, { def: "standing" }),
      multi("poses", "포즈들 (시트일 때 — 순서대로 칸에)", POSES, { def: ["standing", "walking", "sitting", "lean", "crossarms", "wave"], noAnalyze: true }),
      chips("grid", "그리드 (시트일 때)", [["auto", "자동", ""], ["3x2", "3×2", ""], ["3x3", "3×3", ""], ["4x3", "4×3", ""], ["4x4", "4×4", ""]], { def: "auto", noAnalyze: true }),
      chips("labels", "칸 라벨 (시트일 때)", [["none", "없음", ""], ["small", "작은 라벨", ""]], { def: "none", noAnalyze: true }),
    ], { open: true }),
    g("move", "몸 동작", "Body", [
      chips("arms", "팔·손", [["sides", "내림", "arms relaxed at the sides"], ["wave", "손 흔들기", "one hand waving"], ["peace", "브이", "making a peace sign"], ["thumb", "엄지척", "giving a thumbs up"], ["heart", "손 하트", "making a finger heart"],
        ["hair", "머리 넘기기", "brushing the hair back with one hand"], ["chin", "턱 괴기", "resting the chin on one hand"], ["point", "가리키기", "pointing forward"], ["holding", "물건 들기", "holding an object with both hands"]]),
      chips("legs", "다리", [["straight", "곧게", "legs straight"], ["cross", "교차", "legs crossed at the ankles"], ["bent", "한쪽 굽힘", "one knee slightly bent"], ["wide", "벌림", "feet shoulder-width apart"], ["step", "한발 앞", "one foot stepping forward"]]),
      chips("head", "고개", [["front", "정면", "head facing forward"], ["tilt", "갸웃", "head tilted slightly"], ["up", "위를 봄", "looking up"], ["down", "아래를 봄", "looking down"], ["turn", "옆을 봄", "head turned to the side"]]),
    ]),
    g("camera", "카메라", "Camera", [
      chips("shot", "샷 크기", [["full", "전신", "full-body shot"], ["knee", "무릎 위", "knee-up shot"], ["waist", "허리 위", "waist-up shot"], ["bust", "상반신", "chest-up shot"]], { def: "full" }),
      chips("angle", "높이", [["eye", "눈높이", "eye-level camera"], ["low", "아래에서", "low-angle camera looking up"], ["high", "위에서", "high-angle camera looking down"], ["bird", "부감", "overhead bird's-eye view"], ["dutch", "기울임", "slightly tilted dutch angle"]], { def: "eye" }),
      chips("dir", "방향", [["front", "정면", "facing the camera"], ["tq", "3/4", "three-quarter view"], ["side", "측면", "side profile view"], ["back", "뒷모습", "seen from behind"], ["over", "뒤돌아봄", "looking back over the shoulder"]]),
    ]),
    g("mood", "표정·분위기", "Mood", [
      chips("expr", "표정", [["neutral", "무표정", "neutral expression"], ["smile", "미소", "gentle smile"], ["laugh", "활짝", "big open smile"], ["serious", "진지", "serious expression"], ["confident", "자신감", "confident look"], ["surprised", "놀람", "surprised expression"], ["playful", "장난스러움", "playful expression"]]),
      chips("energy", "분위기", [["calm", "차분", "calm mood"], ["energetic", "활기", "energetic mood"], ["elegant", "우아", "elegant mood"], ["cool", "시크", "cool chic mood"], ["cute", "귀여운", "cute playful mood"]]),
    ]),
    g("scene", "배경", "Background", [
      chips("bg", "배경", [["white", "흰색", "plain pure white background"], ["lightgrey", "밝은 회색", "plain light grey background"], ["studio", "스튜디오", "studio backdrop with soft floor shadow"], ["street", "도시 거리", "a city street"],
        ["night", "밤거리", "a city street at night with neon lights"], ["cafe", "카페", "a cozy cafe"], ["park", "공원", "a green park"], ["office", "사무실", "a modern office"], ["home", "거실", "a bright living room"], ["beach", "해변", "a sunny beach"]], { def: "white" }),
      text("place", "장소 직접 적기", "예: 비 오는 골목, 지하철 승강장", (v) => `setting: ${v}`),
      chips("light", "조명", [["even", "균일", "even soft lighting"], ["natural", "자연광", "natural daylight"], ["golden", "노을빛", "warm golden-hour light"], ["dramatic", "드라마틱", "dramatic contrast lighting"]], { def: "even" }),
    ]),
    g("look", "스타일", "Style", [
      STYLE,
      text("memo", "더 적을 것", "예: 오른손에 우산, 바람에 머리가 날림", (v) => `Additional details: ${v}.`),
    ]),
  ],
};
// 참고 이미지에서 따를 부위 (단계마다)
const REF_USE = {
  face: [["face", "얼굴 전체"], ["shape", "얼굴형"], ["eyes", "눈"], ["brows", "눈썹"], ["nose", "코"], ["mouth", "입"], ["skin", "피부"], ["hair", "헤어"], ["makeup", "메이크업"], ["mood", "분위기"]],
  body: [["body", "체형 전체"], ["proportion", "비율"], ["pose", "자세"], ["outfit", "의상"], ["shoes", "신발"], ["mood", "분위기"]],
  outfit: [["outfit", "옷 전체"], ["top", "상의"], ["bottom", "하의"], ["shoes", "신발"], ["accessory", "액세서리"], ["fabric", "소재·무늬"], ["color", "색"]],
  sheet: [["outfit", "의상"], ["accessory", "액세서리"], ["layout", "시트 배치"], ["style", "그림 스타일"]],
  pose: [["pose", "자세 전체"], ["hands", "손 모양"], ["angle", "카메라 각도"], ["expression", "표정"], ["background", "배경"], ["mood", "분위기"]],
};
const REF_EN = { face: "the face", shape: "the face shape", eyes: "the eyes", brows: "the eyebrows", nose: "the nose", mouth: "the lips and mouth", skin: "the skin tone and texture", hair: "the hairstyle and hair color", makeup: "the makeup", mood: "the overall mood",
  body: "the body shape", proportion: "the body proportions", pose: "the pose", outfit: "the outfit", shoes: "the shoes", accessory: "the accessories", layout: "the sheet layout", style: "the art style",
  top: "the top", bottom: "the bottom", fabric: "the fabric and pattern", color: "the colors",
  hands: "the hand gesture", angle: "the camera angle and framing", expression: "the facial expression", background: "the background setting" };
const NEG = {
  face: "distorted face, asymmetrical eyes, cross-eyed, extra teeth, plastic skin, heavy airbrushing, text, watermark, logo, blurry, cropped head",
  body: "distorted body, extra limbs, extra fingers, deformed hands, missing feet, cropped feet, different face, text, watermark, logo, blurry",
  sheet: "inconsistent face between views, different outfits between views, extra limbs, deformed hands, text, watermark, logo, cluttered background",
  outfit: "person, model, face, body, wrinkled messy fabric, missing items, text, watermark, logo, cluttered background",
  pose: "different face, different outfit, extra limbs, extra fingers, deformed hands, twisted joints, distorted body, text, watermark, logo",
};
const STEPS = [["face", "얼굴"], ["body", "전신·의상"], ["sheet", "시트"], ["pose", "포즈"], ["persona", "페르소나"], ["save", "이름·저장"]];
const ASPECT = { face: "1:1", body: "9:16", outfit: "3:2", sheet: "16:9", pose: "9:16" };
const PARTS = ["face", "outfit", "body", "sheet", "pose"];
const PART_NAME = { face: "얼굴", outfit: "의상 시트", body: "전신", sheet: "시트", pose: "포즈" };
const NEXT_NAME = { face: "전신·시트", outfit: "전신", body: "시트·포즈", sheet: "페르소나", pose: "페르소나" }; // 고른 이미지를 이어 받는 곳
const MEMO = { face: "look.memo", body: "pose.memo", outfit: "disp.memo", sheet: "look.memo", pose: "look.memo" };
const SRC = { manual: "직접 저장", analyze: "사진 분석", claude: "Claude 다듬기", "before-claude": "다듬기 전", generate: "힉스필드에 씀", apply: "의상 적용", save: "캐릭터 저장" };

// ── 상태 ──────────────────────────────────────────────
const W = { r: null, data: null, step: 0, onClose: null, busy: "", saveT: 0 };
const url = (f) => `/data/_resources/${W.r.kind}/${W.r.id}/${f}`;
// ② 단계는 의상 시트 / 전신 두 칸으로 나뉜다 (W.data.sub)
const part = () => (STEPS[W.step][0] === "body" ? W.data.sub || "outfit" : STEPS[W.step][0]);
const sel = (p) => W.data[p].sel;
const outsOf = (p) => W.r.files.filter((f) => f.part === p && f.role !== "ref" && f.kind === "image");
const refsOf = (p) => W.r.files.filter((f) => f.part === p && f.role === "ref" && f.kind === "image");
const pickOf = (p) => { const o = outsOf(p); return o.find((f) => f.file === W.data[p]?.pick) || o[o.length - 1] || null; };
function initData(r) {
  const d = r.wizard || {};
  for (const p of PARTS) {
    d[p] ||= { sel: {}, refUse: {}, skip: [], prompt: r.parts?.[p]?.prompt || "", negative: r.parts?.[p]?.negative || NEG[p], manual: !!r.parts?.[p]?.prompt };
    d[p].refUse ||= {}; d[p].skip ||= [];
  }
  const fs = d.face?.sel, acc = fs?.["look.acc"];
  if (Array.isArray(acc) && acc.includes("earrings")) {
    fs["look.acc"] = acc.filter((x) => x !== "earrings");
    if (!fs["look.acc"].length) delete fs["look.acc"]; // 귀걸이만 있었으면 "자동"으로 (빈 배열은 "없음"이 된다)
    const pc = fs["ears.piercing"];
    if (!(Array.isArray(pc) && !pc.length)) fs["ears.piercing"] = [...new Set([...(pc || []), "studs"])];
  }
  d.sub ||= r.files.some((f) => f.part === "body" && f.role !== "ref") ? "body" : "outfit";
  d.apply ||= { extra: "" };
  return d;
}

// ── 최종 프롬프트 만들기 (고른 값 → 영어) ────────────────
const valOf = (c, v) => (v === undefined ? c.def : v);
function frag(c, v) {
  v = valOf(c, v);
  if (c.type === "chips") { const o = c.opts.find((x) => x[0] === v); return o ? o[2] : ""; }
  if (c.type === "swatch") { const o = c.opts.find((x) => x[0] === v); return o ? o[o.length - 1] : ""; }
  if (c.type === "multi") return (v || []).map((x) => c.opts.find((o) => o[0] === x)?.[2]).filter(Boolean).join(", ");
  if (c.type === "scale") return v ? c.en[v - 1] || "" : "";
  if (c.type === "num") return v == null ? "" : c.en(v);
  if (c.type === "text") return v?.trim() ? c.en(v.trim().replace(/[.。\s]+$/, "")) : "";
  return "";
}
// 보낼 이미지 순서: 이어 받는 대표 결과 → 이 단계에서 쓸 참고 이미지
//   의상 시트: 없음 · 전신: 얼굴(1) · 의상 시트(2) · 시트: 얼굴(1) · 전신(2) · 의상 시트(3)
const PREV = { outfit: [], body: ["face", "outfit"], sheet: ["face", "body", "outfit"], pose: ["face", "body", "outfit"], face: [] };
// 힉스필드에 보낼지 (W.data[p].send = { prev, refs }) — 끄면 보내지도, 프롬프트에 image N 으로 적지도 않는다.
// any = true 면 보내기 설정과 상관없이 고른 이미지 전부 (사진 분석·Claude 다듬기·화면 표시용)
const sendOf = (p) => ({ prev: W.data[p].send?.prev !== false, refs: W.data[p].send?.refs !== false });
function imagesFor(p, any = false) {
  const sd = any ? { prev: true, refs: true } : sendOf(p);
  const prev = sd.prev ? (PREV[p] || []).map((q) => ({ q, f: pickOf(q) })).filter((x) => x.f) : [];
  const refs = sd.refs ? refsOf(p).filter((f) => !W.data[p].skip.includes(f.file)) : [];
  return { prev, refs, all: [...prev.map((x) => x.f), ...refs].slice(0, 6) };
}
const imgNo = (prev, q) => prev.findIndex((x) => x.q === q) + 1; // 0 이면 없음

// ── 그리드 시트 (의상 시트 · 캐릭터 시트) ──
const AUTO_GRID = (n) => (n <= 4 ? [2, 2] : n <= 6 ? [3, 2] : n <= 9 ? [3, 3] : n <= 12 ? [4, 3] : n <= 16 ? [4, 4] : [5, 4]);
const ITEM_EN = { top: "the top", outer: "the outerwear", bottom: "the bottom", dress: "the dress or set", shoes: "the shoes", bag: "the bag", hat: "the hat", socks: "the socks or stockings" };
const ctlOf = (p, gid, k) => SCHEMA[p].find((x) => x.id === gid).items.find((x) => x.k === k);
const optsEn = (c, v) => (v ?? c.def ?? []).map((x) => c.opts.find((o) => o[0] === x)?.[2]).filter(Boolean);
/** 칸 목록과 격자 크기 — { panels: [영어], cols, rows, hero } */
function gridOf(p) {
  const s = sel(p), gid = p === "outfit" ? "disp" : p === "pose" ? "preset" : "grid";
  let panels = [];
  if (p === "pose") {
    panels = optsEn(ctlOf("pose", "preset", "poses"), s["preset.poses"]).map((x) => `full body, ${x}`);
  } else if (p === "outfit") {
    const pc = ctlOf("outfit", "disp", "panels"), disp = frag(ctlOf("outfit", "disp", "display"), s["disp.display"]);
    panels = (s["disp.panels"] ?? pc.def).flatMap((k) => {
      if (k === "items") {
        const filled = Object.keys(ITEM_EN).filter((it) => String(s[`items.${it}`] || "").trim());
        return filled.length ? filled.map((it) => `${ITEM_EN[it]} alone (${String(s[`items.${it}`]).trim().replace(/[.\s]+$/, "")}), laid flat`) : ["each clothing item shown separately, laid flat"];
      }
      const t = pc.opts.find((o) => o[0] === k)?.[2] || "";
      return t ? [["front", "back", "side", "tq"].includes(k) && disp ? `${t} ${disp}` : t] : [];
    });
  } else {
    panels = [...optsEn(ctlOf("sheet", "grid", "body"), s["grid.body"]), ...optsEn(ctlOf("sheet", "grid", "face"), s["grid.face"]),
      ...optsEn(ctlOf("sheet", "grid", "expr"), s["grid.expr"]).map((x) => `face close-up with ${x}`), ...optsEn(ctlOf("sheet", "grid", "detail"), s["grid.detail"])];
  }
  const hero = s[`${gid}.hero`] === "big", need = panels.length + (hero ? 1 : 0), choice = s[`${gid}.grid`] || "auto";
  let [cols, rows] = choice === "auto" ? AUTO_GRID(need) : choice.split("x").map(Number);
  if (cols * rows < need) [cols, rows] = AUTO_GRID(need); // 고른 격자가 작으면 키운다
  return { panels, cols, rows, hero, labels: s[`${gid}.labels`] === "small" };
}
function gridLines({ panels, cols, rows, hero }) {
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
// 격자 모양에 맞는 화면 비율 (사용자가 비율을 직접 고르기 전까지 이것을 쓴다)
function gridAspect(p) {
  const { cols, rows } = gridOf(p), r = cols / rows;
  return [["1:1", 1], ["4:3", 4 / 3], ["3:2", 1.5], ["16:9", 16 / 9], ["21:9", 21 / 9]].reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0];
}
function compose(p) {
  const s = sel(p), groups = SCHEMA[p], F = (gid, k) => { const c = groups.find((x) => x.id === gid).items.find((x) => x.k === k); return frag(c, s[`${gid}.${k}`]); };
  const lines = [];
  const groupLine = (gr, skip = [], src = s) => { const fs = gr.items.filter((c) => !skip.includes(c.k)).map((c) => frag(c, src[`${gr.id}.${c.k}`])).filter(Boolean); return fs.length ? `${gr.en}: ${fs.join(", ")}.` : ""; };
  const { prev, refs } = imagesFor(p);
  const fs = sel("face"), who = frag(SCHEMA.face[0].items[0], fs["basic.gender"]) || "person", age = frag(SCHEMA.face[0].items[1], fs["basic.age"]);
  if (p === "face") {
    const eth = frag(SCHEMA.face[0].items[2], fs["basic.ethnicity"]);
    lines.push(`${cap(F("basic", "style") || "photorealistic")} head-and-shoulders portrait of a fictional ${who}${age ? `, ${age}` : ""}${eth ? `, with ${eth} features` : ""}.`);
    for (const gr of groups.slice(1)) { if (gr.id === "wear") continue; const l = groupLine(gr, gr.id === "look" ? ["memo"] : []); if (l) lines.push(l); }
    lines.push("Front view, soft even studio lighting, 85mm lens, sharp focus on the eyes, no text, no watermark.");
  } else if (p === "outfit") {
    const gd = gridOf("outfit");
    lines.push(`${cap(F("disp", "style") || "photorealistic")} outfit reference sheet for a fictional ${who}'s look — a single image arranged as a clean ${gd.cols}×${gd.rows} grid of ${gd.hero ? "panels" : `${gd.cols * gd.rows} equally sized panels`} separated by thin white gutters, the same ${F("disp", "bg") || "pure white background"} and even soft lighting in every panel. Every panel shows the exact same outfit.`);
    for (const gr of groups.filter((x) => x.id !== "disp")) { const l = groupLine(gr); if (l) lines.push(l); }
    lines.push(...gridLines(gd));
    lines.push(`No person, no face, no body parts, ${gd.labels ? "a small clean caption under each panel naming the view" : "no text labels"}, no watermark.`);
  } else if (p === "pose") {
    const st = F("look", "style") || "photorealistic", nf = imgNo(prev, "face"), nb = imgNo(prev, "body"), no = imgNo(prev, "outfit");
    const whoLine = nf ? `the same fictional ${who} as image ${nf} (keep the face, hairstyle and skin tone exactly the same)` : `a fictional ${who}${age ? `, ${age}` : ""}`;
    const wear = nb ? `wearing exactly the same outfit as in image ${nb}` : no ? `wearing exactly the outfit shown in image ${no}` : frag(ctlOf("body", "base", "wear"), sel("body")["base.wear"]);
    if ((s["preset.mode"] || "single") === "sheet") {
      const gd = gridOf("pose");
      lines.push(`${cap(st)} pose reference sheet of ${whoLine}${wear ? `, ${wear}` : ""} — a single image arranged as a clean ${gd.cols}×${gd.rows} grid of ${gd.cols * gd.rows} equally sized panels separated by thin white gutters, the same background and lighting in every panel. The same person and outfit in every panel.`);
      lines.push(...gridLines(gd));
    } else {
      lines.push(`${cap(st)} photo of ${whoLine}${wear ? `, ${wear}` : ""}, ${F("preset", "pose")}.`);
    }
    for (const gid of ["move", "camera", "mood"]) { const l = groupLine(groups.find((x) => x.id === gid)); if (l) lines.push(l); }
    const bg = [F("scene", "bg"), F("scene", "place"), F("scene", "light")].filter(Boolean);
    if (bg.length) lines.push(`Background: ${bg.join(", ")}, regardless of the reference images.`);
    lines.push(`Natural anatomy and hands, ${(s["preset.mode"] === "sheet" && s["preset.labels"] === "small") ? "a small clean caption under each panel naming the pose" : "no text"}, no watermark.`);
  } else if (p === "body") {
    const st = F("whole", "style") || "photorealistic", nf = imgNo(prev, "face"), no = imgNo(prev, "outfit");
    lines.push(nf ? `${cap(st)} full-body photo of the same fictional ${who} as image ${nf} (keep the face, hairstyle and skin tone exactly the same).` : `${cap(st)} full-body photo of a fictional ${who}${age ? `, ${age}` : ""}.`);
    for (const gr of groups) { if (gr.id === "base") continue; const l = groupLine(gr, ["style", "memo"]); if (l) lines.push(l); }
    // 의상: 의상 시트 결과가 있으면 그것을 입히고, 없으면 의상 시트 칸에 적은 값, 그것도 없으면 기본 옷(흰 나시)
    if (no) lines.push(`Wearing exactly the outfit shown in image ${no} (an outfit reference sheet): match every item, color, fabric, pattern and detail.`);
    else { const o = SCHEMA.outfit.filter((x) => x.id !== "disp").map((gr) => groupLine(gr, [], sel("outfit"))).filter(Boolean); if (o.length) lines.push(`Outfit — ${o.join(" ")}`); }
    lines.push("Standing, front view, entire body from head to toe in frame, even studio lighting, 50mm lens, no text, no watermark.");
  } else {
    const st = F("look", "style") || "photorealistic", nf = imgNo(prev, "face"), nb = imgNo(prev, "body"), no = imgNo(prev, "outfit");
    const same = [nf && `image ${nf}`, nb && `image ${nb}`].filter(Boolean).join(" and ");
    const gd = gridOf("sheet");
    lines.push(`${cap(st)} character reference sheet of ${same ? `the same fictional person as ${same}` : `a fictional ${who}`} — a single image arranged as a clean ${gd.cols}×${gd.rows} grid of ${gd.hero ? "panels" : `${gd.cols * gd.rows} equally sized panels`} separated by thin white gutters, the same ${F("look", "bg") || "pure white background"} and ${F("look", "light") || "even soft studio lighting"} in every panel.`);
    const inherit = s["wear.inherit"] ?? "body";
    const outfit = inherit === "body" && (nb || no) ? `wearing exactly the same outfit as ${[nb && `image ${nb}`, no && `the outfit sheet in image ${no}`].filter(Boolean).join(" and ")}` : F("wear", "outfit");
    const acc = F("wear", "acc"); if (outfit || acc) lines.push(`Outfit: ${[outfit, acc && `accessories: ${acc}`].filter(Boolean).join(", ")}.`);
    lines.push(...gridLines(gd));
    lines.push(`Keep the face, hair, skin tone, body proportions and outfit identical in every panel; ${gd.labels ? "a small clean caption under each panel naming the view" : "no text labels"}, no watermark.`);
  }
  // 참고 이미지: 부위를 고르면 그 부위만 따르게
  refs.forEach((f, i) => {
    const n = prev.length + i + 1, use = W.data[p].refUse[f.file] || [];
    const dflt = p === "face" ? "the face and hair only (ignore its clothing and background)" : p === "body" ? "the body shape and pose only (ignore its clothing and background)"
      : p === "pose" ? "the pose and body position only (ignore its face, clothing and background)" : "";
    lines.push(use.length ? `Image ${n}: use only ${use.map((u) => REF_EN[u]).join(", ")} as reference.` : dflt ? `Image ${n}: reference for ${dflt}.` : `Image ${n}: general visual reference.`);
  });
  const [mg, mk] = MEMO[p].split("."), memo = F(mg, mk);
  if (memo) lines.push(memo);
  // "없음"으로 고른 칸 (피어싱·귀걸이·점·타투·안경 등) — 메모·참고 이미지에 있어도 넣지 않게 맨 끝에 못 박는다
  const nots = groups.flatMap((gr) => gr.items.map((c) => {
    const v = s[`${gr.id}.${c.k}`];
    if (c.type === "multi" && c.none && Array.isArray(v) && !v.length) return c.none;
    if (c.type === "chips" && v) return c.opts.find((o) => o[0] === v)?.[3] || "";
    return "";
  })).filter(Boolean);
  if (nots.length) lines.push(`Do not include: ${nots.join(", ")} — even if mentioned above or shown in the reference images.`);
  // 옷·배경은 맨 끝에 — 메모·참고 이미지에 다른 옷·배경이 있어도 이것을 따르게
  if (p === "face") {
    const top = F("wear", "top"), bg = F("wear", "bg");
    if (top) lines.push(`Wardrobe: ${top} — use this instead of any other clothing mentioned above or shown in the reference images.`);
    if (bg) lines.push(`Background: ${bg}, regardless of the reference images.`);
  }
  if (p === "body") {
    const no = imgNo(prev, "outfit"), hasOutfitSel = SCHEMA.outfit.filter((x) => x.id !== "disp").some((gr) => groupLine(gr, [], sel("outfit")));
    const w = F("base", "wear"), bg = F("base", "bg");
    if (!no && !hasOutfitSel && w) lines.push(`Wardrobe: ${w} — use this instead of any other clothing mentioned above or shown in the reference images.`);
    if (bg) lines.push(`Background: ${bg}, regardless of the reference images.`);
  }
  return lines.join(" ");
}
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
// 만들기 설정 (모델·비율·해상도·품질) — 단계마다 저장. 목록은 서버 lib/hfmodels.js
const modelOf = (id) => W.models?.find((m) => m.id === id) || W.models?.[0];
function genOf(p) {
  const g0 = W.data[p].gen || {}, m = modelOf(g0.model);
  if (!m) return { model: "gpt_image_2_5", aspect: ASPECT[p], res: "2k", quality: "high" };
  const gridish = p === "sheet" || p === "outfit" || (p === "pose" && sel("pose")["preset.mode"] === "sheet");
  const want = gridish && !g0.aspectSet ? gridAspect(p) : g0.aspect;
  return { model: m.id, aspect: m.aspects.includes(want) ? want : m.aspects.includes(ASPECT[p]) ? ASPECT[p] : m.aspects[0], aspectSet: !!g0.aspectSet,
    res: m.res?.options.includes(g0.res) ? g0.res : m.res?.def, quality: m.quality?.options.includes(g0.quality) ? g0.quality : m.quality?.def };
}
const aspectOf = (p) => genOf(p).aspect;
const genBody = (p) => { const g0 = genOf(p); return { imageModel: g0.model, aspect: g0.aspect, resolution: g0.res, quality: g0.quality }; };
function genHTML(p) {
  const g0 = genOf(p), m = modelOf(g0.model); if (!m) return "";
  const sel_ = (k, label, opts, v) => `<label class="field"><span>${label}</span><select data-gen="${k}">${opts.map(([x, l]) => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  return `<div class="wz-gen">
    ${sel_("model", "모델", W.models.map((x) => [x.id, `${x.name} — ${x.note}`]), g0.model)}
    ${sel_("aspect", (p === "sheet" || p === "outfit") && !g0.aspectSet ? "비율 (그리드에 맞춤)" : "비율", m.aspects.map((a) => [a, a]), g0.aspect)}
    ${m.res ? sel_("res", "해상도", m.res.options.map((a) => [a, a]), g0.res) : ""}
    ${m.quality ? sel_("quality", "품질", m.quality.options.map((a) => [a, a]), g0.quality) : ""}
  </div>${m.max === 1 ? `<p class="muted small" style="margin:0">이 모델은 참고 이미지를 1장만 받습니다 (첫 장만 씀).</p>` : ""}`;
}
const promptOf = (p) => (W.data[p].manual ? W.data[p].prompt : compose(p));

// 의상 적용: 고른 전신 결과(image 1)에 고른 의상 시트(image 2)를 입힌다 — 얼굴·체형·자세·구도는 그대로
function applyPrompt() {
  const extra = W.data.apply.extra?.trim();
  return `Edit image 1: keep exactly the same person — face, hairstyle, skin tone and body shape — and the same pose, camera angle, framing, lighting and background. Change only the clothing: dress the person in the outfit shown in image 2 (an outfit reference sheet), matching every item, color, fabric, pattern and detail, fitted naturally to the body.${extra ? ` ${extra}.` : ""} Full body visible from head to toe, photorealistic, no text, no watermark.`;
}

// ── 그리기 ────────────────────────────────────────────
function ctlHTML(gid, c) {
  const key = `${gid}.${c.k}`, v = valOf(c, sel(part())[key]), auto = W.data[part()].auto?.includes(key);
  let body = "";
  if (c.type === "chips" || c.type === "multi") {
    const on = (x) => (c.type === "multi" ? (v || []).includes(x) : v === x);
    const pre = c.type === "chips" && c.def === undefined ? `<button type="button" class="wz-chip ${v === undefined || v === "" ? "is-on" : ""}" data-v="">자동</button>`
      : c.type === "multi" && c.none ? `<button type="button" class="wz-chip ${v === undefined ? "is-on" : ""}" data-v="" title="모델이 알아서">자동</button><button type="button" class="wz-chip wz-chip--none ${Array.isArray(v) && !v.length ? "is-on" : ""}" data-v="__none" title="없게 만들기 — 프롬프트에 '넣지 말 것'으로 들어갑니다">없음</button>` : "";
    body = `<div class="wz-chips">${pre}${c.opts.map(([x, l]) => `<button type="button" class="wz-chip ${on(x) ? "is-on" : ""}" data-v="${esc(x)}">${esc(l)}</button>`).join("")}</div>`;
  } else if (c.type === "swatch") {
    body = `<div class="wz-swatches"><button type="button" class="wz-sw wz-sw--auto ${v ? "" : "is-on"}" data-v="" title="자동">자동</button>${c.opts.map(([x, l, h]) => `<button type="button" class="wz-sw ${v === x ? "is-on" : ""}" data-v="${esc(x)}" title="${esc(l)}" style="--c:${h}"><span>${esc(l)}</span></button>`).join("")}</div>`;
  } else if (c.type === "scale") {
    const names = c.def === 1 ? [c.lo, "조금", "보통", "많이", c.hi] : [c.lo, `약간 ${c.lo}`, "보통", `약간 ${c.hi}`, c.hi];
    body = `<div class="wz-range"><span class="muted small">${esc(c.lo)}</span><input type="range" min="1" max="5" step="1" value="${v}" data-range><span class="muted small">${esc(c.hi)}</span><output>${esc(names[v - 1])}</output></div>`;
  } else if (c.type === "num") {
    body = `<div class="wz-range"><span class="muted small">${c.min}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}" data-range><span class="muted small">${c.max}</span><output>${v}${esc(c.unit)}</output></div>`;
  } else if (c.type === "text") {
    body = `<input data-text value="${esc(v || "")}" placeholder="${esc(c.ph)}">`;
  }
  return `<div class="wz-ctl ${auto ? "is-auto" : ""}" data-ctl="${esc(key)}" data-type="${c.type}"><span class="wz-ctl__label">${esc(c.label)}${auto ? ` <em title="참고 이미지 분석으로 채움">🔍</em>` : ""}</span>${body}</div>`;
}
const setCount = (p, gr) => gr.items.filter((c) => { const v = sel(p)[`${gr.id}.${c.k}`]; return v !== undefined && v !== "" && !(Array.isArray(v) && !v.length) && v !== c.def; }).length;

function render() {
  const root = $("#resWizard"), p = part(), saved = W.r.status !== "draft";
  // 길잡이: … › 인물 › (저장된 인물이면 이름) › 새 캐릭터 · 2. 전신·의상 · 의상 시트
  window.nav?.sub([...(W.crumbs || []), { label: `${saved ? "다듬기" : "새 캐릭터"} · ${W.step + 1}. ${STEPS[W.step][1]}${STEPS[W.step][0] === "body" ? ` · ${PART_NAME[p]}` : ""}` }]);
  root.innerHTML = `
    <div class="wz-head">
      <strong>${saved ? `${esc(W.r.name)} 다듬기` : "새 캐릭터 만들기"}</strong>
      <span class="muted small" data-wz-saved>${W.busy ? esc(W.busy) : "자동 저장됨"}</span>
    </div>
    <ol class="wz-steps">${STEPS.map(([id, label], i) => {
      const skipped = id === "pose" && !pickOf("pose") && W.data.poseSkipped;
      const done = id === "persona" ? Object.keys(W.r.persona || {}).length : id === "save" ? saved : !!pickOf(id) || skipped;
      return `<li><button type="button" class="wz-step ${i === W.step ? "is-on" : ""} ${done ? "is-done" : ""}" data-step="${i}"><span>${skipped ? "–" : done ? "✓" : i + 1}</span>${esc(label)}${skipped ? ` <em class="muted small">건너뜀</em>` : id === "pose" ? ` <em class="muted small">선택</em>` : ""}</button></li>`;
    }).join("")}</ol>
    ${STEPS[W.step][0] === "body" ? `<div class="seg wz-sub">${[["outfit", "👕 ① 의상 시트"], ["body", "🧍 ② 전신 · 의상 적용"]].map(([k, l]) => `<button type="button" class="seg__btn ${p === k ? "is-on" : ""}" data-sub="${k}">${l}${pickOf(k) ? " ✓" : ""}</button>`).join("")}</div>` : ""}
    <div class="wz-body">${PARTS.includes(p) ? imageStep(p) : p === "persona" ? personaStep() : saveStep()}</div>
    <div class="wz-foot">
      <button class="btn btn--ghost" type="button" data-wz="prev" ${W.step || p === "body" ? "" : "disabled"}>← 이전</button>
      <span class="muted small">${W.step + 1} / ${STEPS.length} · ${esc(STEPS[W.step][1])}${STEPS[W.step][0] === "body" ? ` · ${PART_NAME[p]}` : ""}</span>
      ${p === "pose" && !pickOf("pose") ? `<button class="btn btn--ghost" type="button" data-wz="skip">포즈 건너뛰기 →</button>` : ""}
      ${p === "outfit" ? `<button class="btn btn--primary" type="button" data-wz="next">다음: 전신 →</button>`
        : W.step < STEPS.length - 1 ? `<button class="btn btn--primary" type="button" data-wz="next">다음: ${esc(STEPS[W.step + 1][1])} →</button>` : ""}
    </div>`;
}

function imageStep(p) {
  const d = W.data[p], { prev, refs } = imagesFor(p), shown = imagesFor(p, true), sd = sendOf(p), outs = outsOf(p), pick = pickOf(p);
  const prompt = d.manual ? d.prompt : (d.prompt = compose(p));
  const canAnalyze = ["face", "body", "outfit", "pose"].includes(p);
  const hist = (W.r.promptLog || []).filter((x) => x.part === p).slice().reverse();
  return `<div class="wz-grid">
    <div class="wz-controls">
      ${d.analysis ? `<p class="note small" style="margin:0">🔍 참고 이미지 분석: ${esc(d.analysis)} — 🔍 표시 칸을 채웠습니다. 바꿔도 됩니다.</p>` : ""}
      <p class="muted small" style="margin:0">고를수록 오른쪽 최종 프롬프트가 바로 바뀝니다. "자동"·"보통"은 프롬프트에서 빠집니다 (모델이 알아서 정함).${p === "outfit" ? " 의상 시트는 사람 없이 옷만 보여 줍니다 — 전신 단계가 이 결과를 입습니다." : ""}</p>
      ${SCHEMA[p].map((gr) => `<details class="wz-group" data-group="${gr.id}" ${gr.open || W.openGroups?.has(`${p}.${gr.id}`) ? "open" : ""}>
        <summary>${esc(gr.label)} <span class="muted small" data-gcount="${gr.id}">${setCount(p, gr) ? `${setCount(p, gr)}개 고름` : ""}</span></summary>
        <div class="wz-group__body">${gr.items.map((c) => ctlHTML(gr.id, c)).join("")}</div>
      </details>`).join("")}
    </div>
    <aside class="wz-side">
      ${shown.prev.length ? `<section class="wz-card"><h4>이어 받는 이미지 ${sd.prev ? "" : `<span class="muted small">— 힉스필드에 보내지 않음</span>`}</h4><div class="wz-refs">${shown.prev.map(({ q, f }, i) => `<figure class="wz-ref ${sd.prev ? "" : "is-off"}"><img src="${url(f.file)}" alt=""><figcaption>${sd.prev ? `image ${i + 1}` : "안 보냄"} · ${PART_NAME[q]} 결과</figcaption></figure>`).join("")}</div></section>`
        : p === "body" || p === "sheet" ? `<p class="note small">앞 단계 결과가 없어 같은 얼굴로 이어지지 않습니다. 얼굴 단계에서 결과를 만들거나 올려 두세요.</p>` : ""}
      ${p === "body" ? applyCard() : ""}
      <section class="wz-card">
        <h4>참고 이미지 <span class="muted small">${refsOf(p).length}장${canAnalyze ? " · 넣으면 외모를 분석해 왼쪽 칸을 채웁니다" : ""}</span></h4>
        <div class="wz-refs">${refsOf(p).map((f) => {
          const on = !d.skip.includes(f.file), n = on && sd.refs ? prev.length + refs.indexOf(f) + 1 : 0, use = d.refUse[f.file] || [];
          return `<figure class="wz-ref ${on ? "" : "is-off"}" data-ref="${esc(f.file)}">
            <img src="${url(f.file)}" alt="">
            <label class="small"><input type="checkbox" data-refon ${on ? "checked" : ""}> ${!on ? "안 씀" : n ? `image ${n}` : "분석에만 씀"}</label>
            <div class="wz-chips wz-chips--sm">${REF_USE[p].map(([u, l]) => `<button type="button" class="wz-chip ${use.includes(u) ? "is-on" : ""}" data-refuse="${u}">${esc(l)}</button>`).join("")}</div>
            <button type="button" class="btn btn--ghost btn--sm" data-refdel>빼기</button>
          </figure>`;
        }).join("")}</div>
        <label class="res-drop" data-wzdrop="ref">＋ 참고 이미지 넣기 <span class="muted small">— ${p === "face" ? "얼굴 사진" : p === "body" ? "체형·자세 사진" : p === "outfit" ? "옷·코디 사진" : "참고 사진"}을 끌어다 놓거나 눌러서 고르기</span><input type="file" accept="image/*" multiple data-wzup="ref" hidden></label>
        <div class="ex__row">
          ${canAnalyze ? `<button class="btn btn--ghost btn--sm" type="button" data-wz="analyze" ${shown.refs.length && !W.busy ? "" : "disabled"}>🔍 ${d.analysis ? "다시 분석" : "참고 이미지 분석해서 채우기"}</button>` : ""}
          ${p === "outfit" ? `<button class="btn btn--ghost btn--sm" type="button" data-wz="importOpen">다른 리소스에서 가져오기</button>` : ""}
        </div>
        ${p === "outfit" && W.importOpen ? importPanel("ref") : ""}
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
          <button class="btn btn--ghost btn--sm" type="button" data-wz="pin" title="지금 프롬프트를 기록에 남깁니다">📌 이 버전 저장</button>
          <button class="btn btn--ghost btn--sm" type="button" data-wz="polish" ${W.busy ? "disabled" : ""}>✍️ Claude로 다듬기</button>
          <button class="btn btn--ghost btn--sm" type="button" data-wz="copy">📋 복사</button>
        </div>
      </section>
      <section class="wz-card wz-make">
        <h4>✨ ${esc(PART_NAME[p])} 이미지 만들기</h4>
        ${genHTML(p)}
        ${shown.prev.length || shown.refs.length ? `<div class="wz-send"><span class="small"><b>힉스필드에 보낼 이미지</b></span>
          ${shown.prev.length ? `<label class="small"><input type="checkbox" data-send="prev" ${sd.prev ? "checked" : ""}> 이어 받는 결과 ${shown.prev.length}장 (${shown.prev.map(({ q }) => PART_NAME[q]).join("·")}) — 같은 얼굴·옷 유지</label>` : ""}
          ${shown.refs.length ? `<label class="small"><input type="checkbox" data-send="refs" ${sd.refs ? "checked" : ""}> 참고 이미지 ${shown.refs.length}장</label>` : ""}
          ${!sd.refs && shown.refs.length ? `<span class="muted small">참고 이미지는 프롬프트 만들기(분석·다듬기)에만 쓰고, 힉스필드에는 글(프롬프트)만 보냅니다.</span>` : ""}
          ${!sd.prev && shown.prev.length ? `<span class="muted small">이어 받는 결과를 보내지 않으면 앞 단계와 얼굴·옷이 달라질 수 있습니다.</span>` : ""}
        </div>` : ""}
        <button class="btn btn--primary" type="button" data-wz="generate" ${W.busy ? "disabled" : ""}>${W.busy && W.jobKind === "hf" ? "만드는 중…" : `✨ 힉스필드로 ${esc(PART_NAME[p])} 만들기 (${esc(aspectOf(p))})`}</button>
        <p class="muted small" style="margin:0">힉스필드는 크레딧이 듭니다. 만든 이미지는 화면 아래 "생성된 이미지"에 쌓이고, 거기서 다음 단계로 넘길 이미지를 고릅니다.</p>
      </section>
    </aside>
  </div>
  ${gallery(p)}`;
}

// 화면 아래: 생성·올린 결과 이미지 목록 (최신 순, 날짜·출처·쓴 프롬프트) — 대표 고르기 · 크게 보기 · 받기 · 빼기
const when = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const srcOf = (f) => (f.note?.startsWith("가져옴") ? "가져옴" : f.source === "generated" ? "힉스필드" : "올림");
function gallery(p) {
  const all = W.data.galleryAll, list = W.r.files.filter((f) => f.role !== "ref" && f.kind === "image" && (all ? PARTS.includes(f.part) : f.part === p))
    .slice().sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)));
  const picks = new Set(PARTS.map((q) => pickOf(q)?.file).filter(Boolean));
  const making = W.busy && W.jobKind === "hf", pick = pickOf(p);
  return `<section class="wz-gallery">
    <div class="wz-gallery__head">
      <h4>생성된 이미지 <span class="muted small">${list.length}장</span></h4>
      <div class="wz-next">${pick ? `<img src="${url(pick.file)}" alt=""><span class="small">➡ <b>${esc(NEXT_NAME[p])}</b>(으)로 넘길 ${esc(PART_NAME[p])}<br><span class="muted">${when(pick.added_at)} · ${srcOf(pick)}</span></span>` : `<span class="small muted">➡ ${esc(NEXT_NAME[p])}(으)로 넘길 ${esc(PART_NAME[p])} 이미지를 아래에서 고르세요</span>`}</div>
      <div class="seg">${[[false, `${PART_NAME[p]}`], [true, "전체 단계"]].map(([v, l]) => `<button type="button" class="seg__btn ${!!all === v ? "is-on" : ""}" data-galall="${v}">${esc(l)}</button>`).join("")}</div>
    </div>
    <div class="wz-gallery__grid">
      <label class="wz-gcard wz-gadd" data-wzdrop="output">
        <span class="wz-gadd__plus">＋</span><b>이미지 추가하기</b>
        <span class="muted small">다른 곳(미드저니·GPT·촬영 등)에서 만든 ${esc(PART_NAME[p])} 이미지를 끌어다 놓거나 눌러서 고르기 — 넣은 이미지는 바로 넘길 이미지가 됩니다</span>
        <input type="file" accept="image/*" multiple data-wzup="output" hidden></label>
      ${making ? `<div class="wz-gcard wz-gcard--wait"><div class="wz-gcard__img"><span>✨ 만드는 중…<br><span class="muted small">1~3분</span></span></div></div>` : ""}
      ${list.map((f) => `<article class="wz-gcard ${picks.has(f.file) ? "is-pick" : ""}">
        <a class="wz-gcard__img" href="${url(f.file)}" target="_blank" rel="noopener" title="크게 보기"><img src="${url(f.file)}" alt="" loading="lazy"></a>
        <div class="wz-gcard__body">
          <div class="wz-gcard__meta"><b>${esc(PART_NAME[f.part] || "")}</b><span class="wz-hist__src">${srcOf(f)}</span>${picks.has(f.file) ? `<span class="wz-gcard__pick">➡ 넘김</span>` : ""}</div>
          <span class="muted small">${when(f.added_at)}</span>
          ${f.prompt ? `<details><summary class="muted small">쓴 프롬프트</summary><p class="small">${esc(f.prompt)}</p><button type="button" class="btn btn--ghost btn--sm" data-gcopy="${esc(f.file)}">복사</button></details>` : ""}
          <div class="ex__row">
            ${picks.has(f.file) ? "" : `<button type="button" class="btn btn--primary btn--sm" data-gpick="${esc(f.file)}">➡ 이걸로 넘기기</button>`}
            ${["face", "body", "outfit"].includes(f.part) ? `<button type="button" class="btn btn--ghost btn--sm" data-ganalyze="${esc(f.file)}" ${W.busy ? "disabled" : ""} title="이 이미지의 외모를 읽어 ${esc(PART_NAME[f.part])} 칸을 채웁니다">🔍 칸 채우기</button>` : ""}
            <a class="btn btn--ghost btn--sm" href="${url(f.file)}" download>받기</a>
            <button type="button" class="btn btn--ghost btn--sm" data-gremove="${esc(f.file)}" title="빼도 기록에는 남습니다">빼기</button>
          </div>
        </div>
      </article>`).join("") }
    </div>
  </section>`;
}

// 전신 칸의 "의상 적용" — 전신 결과 하나 + 의상 시트 하나를 골라 옷만 바꾼다
function applyCard() {
  const bodies = outsOf("body"), outfits = outsOf("outfit"), a = W.data.apply;
  const base = bodies.find((f) => f.file === a.base) || pickOf("body"), fit = outfits.find((f) => f.file === a.outfit) || pickOf("outfit");
  return `<section class="wz-card wz-apply">
    <h4>👕 의상 적용 <span class="muted small">전신 결과에 의상 시트를 입힙니다 (얼굴·체형·자세 그대로)</span></h4>
    <span class="muted small">입힐 사람 (image 1)</span>
    <div class="wz-outs">${bodies.map((f) => `<label class="wz-out ${base?.file === f.file ? "is-on" : ""}"><input type="radio" name="wzbase" data-applybase="${esc(f.file)}" ${base?.file === f.file ? "checked" : ""}><img src="${url(f.file)}" alt=""></label>`).join("") || `<span class="muted small">전신 결과가 아직 없습니다 — 아래에서 먼저 만들거나 올리세요.</span>`}</div>
    <span class="muted small">입힐 의상 (image 2)</span>
    <div class="wz-outs">${outfits.map((f) => `<label class="wz-out ${fit?.file === f.file ? "is-on" : ""}"><input type="radio" name="wzfit" data-applyfit="${esc(f.file)}" ${fit?.file === f.file ? "checked" : ""}><img src="${url(f.file)}" alt=""><span class="muted small">${f.note?.startsWith("가져옴") ? esc(f.note.replace(/^가져옴: /, "")) : "이 캐릭터"}</span></label>`).join("") || `<span class="muted small">의상 시트가 없습니다 — ① 의상 시트에서 만들거나 가져오세요.</span>`}</div>
    <div class="ex__row"><button class="btn btn--ghost btn--sm" type="button" data-wz="importOpen">다른 리소스의 의상·소품 가져오기</button></div>
    ${W.importOpen ? importPanel("output") : ""}
    <label class="field"><span>더 바꿀 것 (선택)</span><input data-applyextra value="${esc(a.extra || "")}" placeholder="예: 셔츠 소매를 걷고, 코트는 열어 둔 채로"></label>
    <details><summary class="muted small">의상 적용 프롬프트 보기</summary><p class="small">${esc(applyPrompt())}</p></details>
    <div class="ex__row"><button class="btn btn--ghost btn--sm" type="button" data-wz="applyCopy">📋 복사</button><span style="flex:1"></span>
      <button class="btn btn--primary btn--sm" type="button" data-wz="apply" ${base && fit && !W.busy ? "" : "disabled"}>👕 이 의상 입혀 만들기 (${esc(aspectOf("body"))})</button></div>
    <p class="muted small" style="margin:0">모델·비율·해상도는 아래 "이미지 만들기" 칸의 설정을 씁니다.</p>
  </section>`;
}
// 다른 리소스에서 가져오기: 다른 인물의 의상 시트 결과 · 소품·제품 사진
function importPanel(role) {
  const list = W.importList;
  if (!list) return `<p class="muted small">불러오는 중…</p>`;
  return `<div class="wz-import">${list.length ? list.map((x, i) => `<button type="button" class="wz-import__item" data-importi="${i}" data-role="${role}" title="${esc(x.label)}"><img src="/data/_resources/${x.kind}/${x.id}/${x.file}" alt=""><span class="small">${esc(x.label)}</span></button>`).join("")
    : `<p class="muted small" style="margin:0">가져올 의상 시트·소품 사진이 없습니다.</p>`}</div>`;
}
async function loadImportList() {
  const all = await api("/api/resources");
  W.importList = all.flatMap((r) => r.id === W.r.id ? [] : r.kind === "person"
    ? r.files.filter((f) => f.part === "outfit" && f.role !== "ref" && f.kind === "image").map((f) => ({ kind: r.kind, id: r.id, file: f.file, label: `${r.name} · 의상 시트` }))
    : r.kind === "product" ? r.files.filter((f) => f.kind === "image").map((f) => ({ kind: r.kind, id: r.id, file: f.file, label: `${r.name} · 소품·제품` })) : []);
}

function personaStep() {
  const r = W.r, picks = ["face", "body", "sheet"].map(pickOf).filter(Boolean), P = window.resKinds?.person?.persona || [];
  return `<div class="wz-narrow">
    <section class="wz-card">
      <h4>🪄 캐릭터 페르소나</h4>
      <p class="muted small" style="margin:0">앞에서 만든 결과와 최종 프롬프트를 보고 Claude 가 성격·말투·이야기를 짓습니다. 생김새(프롬프트)는 바꾸지 않습니다. 이름 후보도 같이 받습니다.</p>
      <div class="wz-refs">${picks.map((f) => `<figure class="wz-ref"><img src="${url(f.file)}" alt=""></figure>`).join("") || `<span class="muted small">결과 이미지가 없습니다 — 앞 단계에서 만들거나 올려 주세요.</span>`}</div>
      <div class="ex__row"><span style="flex:1"></span><button class="btn btn--primary btn--sm" type="button" data-wz="persona" ${picks.length && !W.busy ? "" : "disabled"}>${W.busy ? esc(W.busy) : Object.keys(r.persona || {}).length ? "🪄 다시 만들기" : "🪄 페르소나 만들기"}</button></div>
    </section>
    <section class="wz-card">
      <h4>기본 정보</h4>
      <div class="res-fields">${[["gender", "성별"], ["age_range", "나이대"], ["look", "외모·스타일"]].map(([k, l]) => `<label class="field"><span>${l}</span><input data-attr="${k}" value="${esc(r.attrs?.[k] || "")}"></label>`).join("")}</div>
      <div class="res-fields res-fields--wide">${P.map(([k, l]) => `<label class="field"><span>${esc(l)}</span><textarea data-pf="${k}" rows="2">${esc(r.persona?.[k] || "")}</textarea></label>`).join("")}</div>
    </section>
  </div>`;
}

function saveStep() {
  const r = W.r, ideas = W.data.nameIdeas || r.wizard?.nameIdeas || [], saved = r.status !== "draft";
  return `<div class="wz-narrow">
    <section class="wz-card">
      <h4>캐릭터 이름</h4>
      <input class="title-input" data-basic="name" value="${esc(r.name === "이름 없는 캐릭터" ? "" : r.name)}" placeholder="예: 한유나">
      ${ideas.length ? `<div class="wz-chips">${ideas.map((n) => `<button type="button" class="wz-chip" data-nameidea="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
      <label class="field"><span>태그 (쉼표로)</span><input data-basic="tags" value="${esc(r.tags.join(", "))}"></label>
      <label class="field"><span>설명</span><textarea data-basic="description" rows="2">${esc(r.description || "")}</textarea></label>
    </section>
    <section class="wz-card">
      <h4>함께 저장되는 최종 프롬프트 <span class="muted small">버전 기록은 각 단계의 🕘 에 남아 있습니다</span></h4>
      ${PARTS.map((p) => { const pick = pickOf(p), pr = promptOf(p); return `<div class="wz-final">
        ${pick ? `<img src="${url(pick.file)}" alt="">` : `<span class="wz-final__ph">—</span>`}
        <div><b>${PART_NAME[p]}</b> <button type="button" class="btn btn--ghost btn--sm" data-copyp="${p}">📋 복사</button><p class="small">${esc(pr)}</p></div></div>`; }).join("")}
    </section>
    <div class="ex__row"><span style="flex:1"></span><button class="btn btn--primary" type="button" data-wz="save">${saved ? "💾 바뀐 내용 저장" : "💾 캐릭터 저장 (리소스로)"}</button></div>
  </div>`;
}

// ── 저장 (진행 상태는 조용히, 최종 프롬프트는 리소스 parts 에) ──
function queueSave() {
  clearTimeout(W.saveT); setSavedText("저장 중…");
  W.saveT = setTimeout(() => saveNow().then(() => setSavedText("자동 저장됨")).catch((e) => toast(e.message, true)), 700);
}
function setSavedText(t) { const el = $("[data-wz-saved]"); if (el && !W.busy) el.textContent = t; }
async function saveNow(extra = {}) {
  clearTimeout(W.saveT);
  const parts = Object.fromEntries(PARTS.map((p) => [p, { ...(W.r.parts?.[p] || {}), prompt: promptOf(p), negative: W.data[p].negative }]));
  W.data.step = W.step;
  W.r = await api(`/api/resources/person/${W.r.id}`, { method: "PUT", body: { wizard: W.data, parts, ...extra } });
}
async function reload() { W.r = await api(`/api/resources/person/${W.r.id}`); W.data.nameIdeas = W.r.wizard?.nameIdeas || W.data.nameIdeas; }
// 프롬프트 버전 남기기 (같은 내용이 바로 앞에 있으면 서버가 건너뛴다)
async function pinPrompt(p, prompt, source) {
  W.r = await api(`/api/resources/person/${W.r.id}/prompts`, { method: "POST", body: { part: p, prompt, negative: W.data[p].negative, source } });
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
  W.r = await api(`/api/resources/person/${W.r.id}/files`, { method: "POST", body: { tokens, role, part: p } });
  if (role === "output") W.data[p].pick = W.r.files.filter((f) => f.part === p && f.role !== "ref").slice(-1)[0]?.file;
  render(); queueSave();
  // 얼굴·체형·옷 사진을 넣으면 바로 분석해 왼쪽 칸을 채운다.
  // 완성된 이미지를 넣었을 때는 아직 고른 칸이 하나도 없을 때만 (다른 곳에서 만들어 온 경우 — 뒤 단계가 성별·외모를 이어 받게)
  const empty = !Object.keys(sel(p)).length;
  if (["face", "body", "outfit", "pose"].includes(p) && !W.busy && (role === "ref" || empty)) analyze(p, role === "output" ? [W.data[p].pick] : undefined);
}
// 참고 이미지 분석 → 조정 칸 채우기 (결과는 작업 완료 이벤트로 받는다)
function analyze(p, files) {
  const refs = files ? files.map((file) => ({ file })) : imagesFor(p, true).refs; if (!refs.length) return;
  const schema = SCHEMA[p].filter((gr) => !["wear", "base", "disp"].includes(gr.id)).flatMap((gr) => gr.items.filter((c) => c.k !== "memo" && !c.noAnalyze).map((c) => ({
    key: `${gr.id}.${c.k}`, label: `${gr.label} ${c.label}`, type: c.type, options: c.opts?.map((o) => [o[0], o[1]]), lo: c.lo, hi: c.hi, min: c.min, max: c.max })));
  runJob("analyze", () => api(`/api/resources/person/${W.r.id}/analyze`, { method: "POST", body: { part: p, files: refs.map((f) => f.file), refUse: W.data[p].refUse, schema, memoKey: MEMO[p] } }), "Claude 가 참고 이미지를 분석하는 중… (30초~1분)");
}
function applyAnalysis(res) {
  const p = res.part, d = W.data[p]; if (!d) return;
  Object.assign(d.sel, res.sel);
  if (res.memo) d.sel[res.memoKey] = res.memo;
  d.auto = [...Object.keys(res.sel), ...(res.memo ? [res.memoKey] : [])];
  d.analysis = res.summary; d.manual = false; // 1차 프롬프트는 채운 칸에서 다시 만든다
  for (const gr of SCHEMA[p]) if (gr.items.some((c) => d.auto.includes(`${gr.id}.${c.k}`))) W.openGroups.add(`${p}.${gr.id}`);
}

// ── 이벤트 ────────────────────────────────────────────
function onClick(e) {
  const t = e.target, root = $("#resWizard"), p = part();
  const go = (i) => { saveNow().catch(() => {}); W.step = Math.max(0, Math.min(STEPS.length - 1, i)); W.histOpen = false; W.importOpen = false; render(); root.scrollIntoView({ block: "start" }); };
  const step = t.closest("[data-step]"); if (step) return go(Number(step.dataset.step));
  const sub = t.closest("[data-sub]"); if (sub) { W.data.sub = sub.dataset.sub; W.histOpen = false; W.importOpen = false; render(); return queueSave(); }
  const act = t.closest("[data-wz]")?.dataset.wz;
  if (act === "close") return saveNow().finally(() => W.onClose?.(W.r.id));
  if (act === "skip") { W.data.poseSkipped = true; toast("포즈 단계를 건너뜁니다 — 나중에 언제든 돌아와 만들 수 있습니다"); return go(W.step + 1); }
  if (act === "prev") { if (p === "body") { W.data.sub = "outfit"; render(); return queueSave(); } if (STEPS[W.step - 1]?.[0] === "body") W.data.sub = "body"; return go(W.step - 1); }
  if (act === "next") {
    if (p === "outfit") { W.data.sub = "body"; render(); return queueSave(); }
    if (["face", "body"].includes(p) && !pickOf(p) && !confirm(`${PART_NAME[p]} 결과 이미지가 없습니다. 다음 단계는 같은 ${p === "face" ? "얼굴" : "모습"}을 이어 받지 못합니다.\n그래도 넘어갈까요?`)) return;
    if (STEPS[W.step + 1]?.[0] === "body") W.data.sub = pickOf("outfit") || !outsOf("body").length ? "outfit" : "body";
    return go(W.step + 1);
  }
  // 조정 칸
  const ctl = t.closest("[data-ctl]");
  if (ctl && t.closest("[data-v]")) {
    const key = ctl.dataset.ctl, v = t.closest("[data-v]").dataset.v, s = sel(p);
    if (ctl.dataset.type === "multi") {
      const c = findCtl(p, key);
      if (v === "" && c.none) delete s[key];           // 자동
      else if (v === "__none") s[key] = [];             // 없음
      else { const cur = new Set(valOf(c, s[key]) || []); cur.has(v) ? cur.delete(v) : cur.add(v); s[key] = c.none && !cur.size ? undefined : [...cur]; if (s[key] === undefined) delete s[key]; }
    }
    else s[key] = v;
    return changed(p, key);
  }
  const ref = t.closest("[data-ref]");
  if (ref) {
    const f = ref.dataset.ref, d = W.data[p];
    if (t.closest("[data-refuse]")) { const u = t.closest("[data-refuse]").dataset.refuse, cur = new Set(d.refUse[f] || []); cur.has(u) ? cur.delete(u) : cur.add(u); d.refUse[f] = [...cur]; render(); return queueSave(); }
    if (t.closest("[data-refdel]")) {
      return api(`/api/resources/person/${W.r.id}/files/${encodeURIComponent(f)}`, { method: "DELETE" }).then((r) => { W.r = r; delete d.refUse[f]; render(); queueSave(); toast("뺐습니다 — 기록에는 남아 있습니다"); }).catch((err) => toast(err.message, true));
    }
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
    pinPrompt(p, promptOf(p), "manual").catch(() => {}); // 되돌리기 전 지금 것도 남긴다
    W.data[p].prompt = h.prompt; W.data[p].negative = h.negative || W.data[p].negative; W.data[p].manual = true; W.histOpen = false;
    render(); toast("그 버전으로 되돌렸습니다"); return queueSave();
  }
  const cp = t.closest("[data-copyp]"); if (cp) return copy(promptOf(cp.dataset.copyp));
  const ni = t.closest("[data-nameidea]"); if (ni) { $("[data-basic=name]", root).value = ni.dataset.nameidea; return queueSaveBasics(); }
  const ga = t.closest("[data-galall]"); if (ga) { W.data.galleryAll = ga.dataset.galall === "true"; render(); return queueSave(); }
  const gp = t.closest("[data-gpick]");
  if (gp) { const f = W.r.files.find((x) => x.file === gp.dataset.gpick); if (f) { W.data[f.part].pick = f.file; render(); toast(`이 ${PART_NAME[f.part]} 이미지를 ${NEXT_NAME[f.part]}(으)로 넘깁니다`); return queueSave(); } }
  const gz = t.closest("[data-ganalyze]");
  if (gz) { const f = W.r.files.find((x) => x.file === gz.dataset.ganalyze); if (f) return analyze(f.part, [f.file]); }
  const gc = t.closest("[data-gcopy]"); if (gc) return copy(W.r.files.find((x) => x.file === gc.dataset.gcopy)?.prompt || "");
  const gr = t.closest("[data-gremove]");
  if (gr) {
    if (!confirm("이 이미지를 뺄까요? 지우지 않고 기록(_history)에 남깁니다.")) return;
    return api(`/api/resources/person/${W.r.id}/files/${encodeURIComponent(gr.dataset.gremove)}`, { method: "DELETE" }).then((r) => { W.r = r; render(); queueSave(); toast("뺐습니다 — 기록에는 남아 있습니다"); }).catch((err) => toast(err.message, true));
  }
  if (act === "analyze") return analyze(p);
  if (act === "importOpen") { W.importOpen = !W.importOpen; render(); if (W.importOpen && !W.importList) loadImportList().then(render).catch((err) => toast(err.message, true)); return; }
  const imp = t.closest("[data-importi]");
  if (imp) {
    const x = W.importList[Number(imp.dataset.importi)], role = imp.dataset.role;
    return api(`/api/resources/person/${W.r.id}/import`, { method: "POST", body: { fromKind: x.kind, fromId: x.id, file: x.file, role, part: "outfit" } }).then((r) => {
      W.r = r; const f = r.files.filter((y) => y.part === "outfit").slice(-1)[0]?.file;
      if (role === "output") { W.data.outfit.pick = f; W.data.apply.outfit = f; }
      W.importOpen = false; render(); queueSave(); toast(role === "ref" ? "참고 이미지로 가져왔습니다" : "의상 시트로 가져왔습니다 — 입힐 의상으로 골라 두었습니다");
      if (role === "ref" && !W.busy) analyze("outfit");
    }).catch((err) => toast(err.message, true));
  }
  if (act === "polish") return runJob("prompt", async () => {
    W.data[p].prompt = $("[data-prompt]", root).value; W.data[p].manual = true; await saveNow();
    await api(`/api/resources/person/${W.r.id}/prompt`, { method: "POST", body: { part: p, files: imagesFor(p, true).all.map((f) => f.file) } });
  }, "Claude 가 프롬프트를 다듬는 중…");
  if (act === "generate") {
    const imgs = imagesFor(p).all, d = W.data[p], pr = promptOf(p).trim();
    const g0 = genOf(p);
    if (!confirm(`힉스필드로 ${PART_NAME[p]}을 만듭니다\n모델 ${modelOf(g0.model)?.name || g0.model} · ${g0.aspect}${g0.res ? ` · ${g0.res}` : ""}${g0.quality ? ` · 품질 ${g0.quality}` : ""} · 참고 ${imgs.length}장\n크레딧이 듭니다. 계속할까요?`)) return;
    return runJob("hf", async () => {
      await saveNow(); await pinPrompt(p, pr, "generate");
      await api("/api/hf/generate", { method: "POST", body: { target: { type: "resource", kind: "person", id: W.r.id, part: p }, kind: "image", purpose: "sheet", prompt: d.negative ? `${pr} Avoid: ${d.negative}.` : pr, refs: imgs.map((f) => f.file), ...genBody(p) } });
    }, "힉스필드에서 만드는 중… (1~3분)");
  }
  if (act === "applyCopy") return copy(applyPrompt());
  if (act === "apply") {
    const base = outsOf("body").find((f) => f.file === W.data.apply.base) || pickOf("body"), fit = outsOf("outfit").find((f) => f.file === W.data.apply.outfit) || pickOf("outfit");
    if (!base || !fit) return toast("입힐 사람과 의상을 고르세요", true);
    if (!confirm(`힉스필드로 고른 전신 결과에 의상 시트를 입힙니다 (${modelOf(genOf("body").model)?.name} · ${aspectOf("body")}).\n크레딧이 듭니다. 계속할까요?`)) return;
    const pr = applyPrompt();
    return runJob("hf", async () => {
      await saveNow(); await pinPrompt("body", pr, "apply");
      await api("/api/hf/generate", { method: "POST", body: { target: { type: "resource", kind: "person", id: W.r.id, part: "body" }, kind: "image", purpose: "edit", prompt: `${pr} Avoid: ${NEG.body}.`, refs: [base.file, fit.file], ...genBody("body") } });
    }, "힉스필드에서 의상을 입히는 중… (1~3분)");
  }
  if (act === "persona") return runJob("persona", async () => {
    await saveNow();
    await api(`/api/resources/person/${W.r.id}/persona`, { method: "POST", body: { files: ["face", "body", "sheet"].map(pickOf).filter(Boolean).map((f) => f.file), keepParts: true } });
  }, "Claude 가 페르소나를 짓는 중… (1~2분)");
  if (act === "save") return saveCharacter();
}
const findCtl = (p, key) => { const [gid, k] = key.split("."); return SCHEMA[p].find((x) => x.id === gid).items.find((x) => x.k === k); };
function copy(s) { navigator.clipboard.writeText(s).then(() => toast("복사했습니다"), () => toast("복사하지 못했습니다 — 칸을 직접 선택해 복사하세요", true)); }

// 값 하나가 바뀌면: 그 칸·묶음 개수·프롬프트만 다시 그린다 (전체를 다시 그리면 열린 묶음·스크롤이 흔들린다)
function changed(p, key) {
  const root = $("#resWizard"), [gid] = key.split("."), c = findCtl(p, key), gr = SCHEMA[p].find((x) => x.id === gid);
  W.data[p].auto = (W.data[p].auto || []).filter((k) => k !== key); // 손으로 바꾼 칸은 🔍 표시를 뗀다
  root.querySelector(`[data-ctl="${CSS.escape(key)}"]`).outerHTML = ctlHTML(gid, c);
  root.querySelector(`[data-gcount="${gid}"]`).textContent = setCount(p, gr) ? `${setCount(p, gr)}개 고름` : "";
  if (!W.data[p].manual) root.querySelector("[data-prompt]").value = compose(p);
  // 그리드가 바뀌면 비율·만들기 버튼도 따라간다 (비율을 직접 고르기 전까지)
  if ((p === "sheet" || p === "outfit" || p === "pose") && !genOf(p).aspectSet) {
    const a = root.querySelector('[data-gen="aspect"]'); if (a) a.value = aspectOf(p);
    const b = root.querySelector('[data-wz="generate"]'); if (b && !W.busy) b.textContent = `✨ 힉스필드로 ${PART_NAME[p]} 만들기 (${aspectOf(p)})`;
  }
  queueSave();
}
function onInput(e) {
  const t = e.target, p = part(), ctl = t.closest("[data-ctl]");
  if (ctl && t.matches("[data-range]")) {
    const c = findCtl(p, ctl.dataset.ctl); sel(p)[ctl.dataset.ctl] = Number(t.value);
    const out = ctl.querySelector("output");
    if (c.type === "num") out.textContent = `${t.value}${c.unit}`;
    else { const names = c.def === 1 ? [c.lo, "조금", "보통", "많이", c.hi] : [c.lo, `약간 ${c.lo}`, "보통", `약간 ${c.hi}`, c.hi]; out.textContent = names[t.value - 1]; }
    const gr = SCHEMA[p].find((x) => x.id === ctl.dataset.ctl.split(".")[0]);
    $("#resWizard").querySelector(`[data-gcount="${gr.id}"]`).textContent = setCount(p, gr) ? `${setCount(p, gr)}개 고름` : "";
    if (!W.data[p].manual) $("#resWizard [data-prompt]").value = compose(p);
    return queueSave();
  }
  if (ctl && t.matches("[data-text]")) { sel(p)[ctl.dataset.ctl] = t.value; if (!W.data[p].manual) $("#resWizard [data-prompt]").value = compose(p); return queueSave(); }
  if (t.matches("[data-prompt]")) { W.data[p].prompt = t.value; W.data[p].manual = true; return queueSave(); }
  if (t.matches("[data-negative]")) { W.data[p].negative = t.value; return queueSave(); }
  if (t.matches("[data-applyextra]")) { W.data.apply.extra = t.value; return queueSave(); }
  if (t.matches("[data-attr], [data-pf]")) return queueSaveBasics();
  if (t.matches("[data-basic]")) return queueSaveBasics();
}
// 페르소나·이름 단계의 칸은 리소스 본문(attrs·persona·name)에 저장
let basicT;
function queueSaveBasics() {
  clearTimeout(basicT); setSavedText("저장 중…");
  basicT = setTimeout(async () => {
    const root = $("#resWizard"), val = (a) => Object.fromEntries([...root.querySelectorAll(`[data-${a}]`)].map((x) => [x.dataset[a], x.value]));
    const body = {};
    if (root.querySelector("[data-attr]")) body.attrs = { ...W.r.attrs, ...val("attr") };
    if (root.querySelector("[data-pf]")) body.persona = val("pf");
    const b = val("basic"); if (b.name?.trim()) body.name = b.name.trim(); if (b.tags !== undefined) body.tags = b.tags; if (b.description !== undefined) body.description = b.description;
    try { W.r = await api(`/api/resources/person/${W.r.id}`, { method: "PUT", body }); setSavedText("자동 저장됨"); } catch (e) { toast(e.message, true); }
  }, 600);
}
async function saveCharacter() {
  const root = $("#resWizard"), name = $("[data-basic=name]", root).value.trim();
  if (!name) return toast("캐릭터 이름을 적으세요", true);
  clearTimeout(basicT);
  try {
    await saveNow({ name, tags: $("[data-basic=tags]", root).value, description: $("[data-basic=description]", root).value, attrs: { ...W.r.attrs, origin: "AI 인물", consent: W.r.attrs?.consent || "AI 가상 인물 — 참고 사진이 실제 인물이면 본인 동의를 확인할 것" } });
    if (W.r.status === "draft") W.r = await api(`/api/resources/person/${W.r.id}`, { method: "PUT", body: { status: "saved" } });
    else for (const p of PARTS) await pinPrompt(p, promptOf(p), "save").catch(() => {});
    toast(`"${name}" 캐릭터를 저장했습니다 — 최종 프롬프트도 같이 저장됐습니다`);
    W.onClose?.(W.r.id, true);
  } catch (e) { toast(e.message, true); }
}

// 서버 작업(힉스필드·Claude)을 걸고, 끝나면 다시 읽는다
function runJob(kind, start, msg) {
  W.busy = msg; W.jobKind = kind; render();
  Promise.resolve().then(start).catch((e) => { W.busy = ""; render(); toast(e.message, true); });
}
window.addEventListener("srv-event", async ({ detail: e }) => {
  if (!W.busy || !mine() || e.type !== "job" || e.state === "start") return;
  if (!(W.jobKind === "hf" ? e.kind === "hf" : e.kind === "persona")) return;
  if (e.result?.type === "drama" || e.shared) return; // 같이 도는 드라마 힉스필드 작업은 이 창 것이 아니다
  W.busy = "";
  if (e.state === "error") { toast(e.message, true); return render(); }
  await reload();
  const p = part();
  if (W.jobKind === "hf") { const q = W.r.files.filter((f) => f.role !== "ref" && f.source === "generated").slice(-1)[0]?.part || p; W.data[q].pick = outsOf(q).slice(-1)[0]?.file; toast("결과가 들어왔습니다 — 아래 생성된 이미지에서 넘길 것을 고르세요"); }
  if (W.jobKind === "prompt") { W.data[p].prompt = W.r.parts?.[p]?.prompt || W.data[p].prompt; W.data[p].manual = true; toast("Claude 가 프롬프트를 다듬었습니다 (이전 버전은 🕘 에)"); }
  if (W.jobKind === "analyze" && e.result?.sel) {
    applyAnalysis(e.result); toast(`참고 이미지에서 ${Object.keys(e.result.sel).length}칸을 채웠습니다 — 1차 프롬프트를 만들었습니다`);
    render(); await saveNow().catch(() => {}); await pinPrompt(e.result.part, promptOf(e.result.part), "analyze").catch(() => {}); return render();
  }
  if (W.jobKind === "persona") toast("페르소나를 채웠습니다 — 이름 후보는 마지막 단계에 있습니다");
  render(); queueSave();
});

let bound = false;
// #resWizard 칸은 배경·제품 위저드(public/objwizard.js)와 같이 쓴다 — 인물 위저드가 열려 있을 때만 반응한다
const mine = () => $("#resWizard")?.dataset.wzKind !== "obj";
function bind() {
  const root = $("#resWizard");
  root.addEventListener("click", (e) => { if (mine()) onClick(e); });
  root.addEventListener("input", (e) => { if (mine()) onInput(e); });
  root.addEventListener("change", async (e) => {
    if (!mine()) return;
    const t = e.target;
    if (t.matches("[data-wzup]") && t.files.length) { try { await upload(t.files, t.dataset.wzup); } catch (err) { toast(err.message, true); } return; }
    if (t.matches("[data-pick]")) { W.data[part()].pick = t.dataset.pick; render(); return queueSave(); }
    if (t.matches("[data-send]")) { const p = part(); W.data[p].send = { ...sendOf(p), [t.dataset.send]: t.checked }; render(); return queueSave(); }
    if (t.matches("[data-gen]")) {
      const p = part(), k = t.dataset.gen; W.data[p].gen = { ...genOf(p), [k]: t.value, ...(k === "aspect" ? { aspectSet: true } : {}) };
      if (k === "model") { const m = modelOf(t.value), g1 = genOf(p); W.data[p].gen = { model: t.value, aspect: g1.aspect, aspectSet: g1.aspectSet, res: m?.res?.def, quality: m?.quality?.def }; }
      render(); return queueSave();
    }
    if (t.matches("[data-applybase]")) { W.data.apply.base = t.dataset.applybase; render(); return queueSave(); }
    if (t.matches("[data-applyfit]")) { W.data.apply.outfit = t.dataset.applyfit; render(); return queueSave(); }
    if (t.matches("[data-refon]")) { const f = t.closest("[data-ref]").dataset.ref, d = W.data[part()]; d.skip = t.checked ? d.skip.filter((x) => x !== f) : [...d.skip, f]; render(); return queueSave(); }
  });
  root.addEventListener("toggle", (e) => { if (!mine()) return; const gid = e.target.dataset?.group; if (!gid) return; W.openGroups ||= new Set(); const key = `${part()}.${gid}`; e.target.open ? W.openGroups.add(key) : W.openGroups.delete(key); }, true);
  ["dragenter", "dragover"].forEach((ty) => root.addEventListener(ty, (e) => { if (!mine()) return; const z = e.target.closest("[data-wzdrop]"); if (z) { e.preventDefault(); z.classList.add("is-over"); } }));
  ["dragleave", "drop"].forEach((ty) => root.addEventListener(ty, (e) => e.target.closest("[data-wzdrop]")?.classList.remove("is-over")));
  root.addEventListener("drop", async (e) => { if (!mine()) return; const z = e.target.closest("[data-wzdrop]"); if (!z) return; e.preventDefault(); if (e.dataTransfer.files.length) try { await upload(e.dataTransfer.files, z.dataset.wzdrop); } catch (err) { toast(err.message, true); } });
}

/** 위저드 열기. r = 인물 리소스(작성 중이거나 저장된 것) · onClose(id, saved) */
/** 위저드에서 나가기 전 저장 (길잡이로 다른 칸에 갈 때) */
export async function closeWizard() { clearTimeout(W.saveT); if (mine() && W.r) await saveNow().catch(() => {}); }
export async function openWizard(r, onClose, crumbs = []) {
  W.crumbs = crumbs;
  $("#resWizard").dataset.wzKind = "person";
  if (!bound) { bind(); bound = true; }
  if (!W.models) W.models = await api("/api/hf/image-models").catch(() => null);
  W.r = r; W.data = initData(r); W.step = Math.min(STEPS.length - 1, Number(r.wizard?.step) || 0); W.onClose = onClose; W.busy = ""; W.openGroups = new Set();
  W.histOpen = false; W.importOpen = false; W.importList = null;
  render();
}
export const wizardSteps = STEPS.length;
