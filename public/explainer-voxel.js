// 3D 설명 영상 템플릿 「복셀 세상」 — 모든 장면을 정육면체 블록으로 짓는다.
// 하늘·구름·햇빛 그림자·틸트시프트 흐림이 공통 형식이고, 주인공은 캐릭터 만들기에서 바꾼다.
// 블록 하나하나가 InstancedMesh 한 칸이고 칸마다 색을 살짝 흔들어 픽셀 느낌을 낸다.
import { THREE, W, H, IMG, FONT, MONO, ease, defaults, wrapLines } from "./explainer-kit.js";

const INK = "rgba(24,28,44,.92)";
// 템플릿 커스텀 칸
const OPTIONS = [
  { k: "mood", label: "분위기", type: "select", def: "day", choices: [["day", "맑은 낮"], ["sunset", "노을"], ["overcast", "흐린 날"], ["night", "밤"]] },
  { k: "grass", label: "잔디 색", type: "color", def: "#6cc04a" },
  { k: "clouds", label: "블록 구름", type: "check", def: true },
  { k: "blur", label: "틸트시프트 흐림", type: "range", def: 7, min: 0, max: 14, step: 1 },
  { k: "accent", label: "강조 색", type: "color", def: "#3a7bd5" },
  { k: "alert", label: "경고 색", type: "color", def: "#f08a24" },
  { k: "highlight", label: "읽는 단어 색", type: "color", def: "#ffd84a" },
  { k: "caption", label: "자막 크기", type: "range", def: 48, min: 36, max: 60, step: 2 },
];
let S = defaults(OPTIONS), MAIN = {};
function setStyle(style) {
  S = { ...defaults(OPTIONS), ...(style || {}) };
  const g = new THREE.Color(S.grass); C.grass = g.getHex(); C.grass2 = g.clone().offsetHSL(0, 0, -0.06).getHex();
}

// 모든 장면을 정육면체 블록으로 짓는다. 하늘·구름·햇빛 그림자·틸트시프트 흐림이 공통 형식이다.
// 블록 하나하나가 InstancedMesh 한 칸이고 칸마다 색을 살짝 흔들어 픽셀 느낌을 낸다.
const cam = () => new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
const G = 0.5; // 땅 블록 한 칸 크기

// 같은 장면은 다시 지어도 같은 모양이 나오게 — 씨앗 있는 난수
let R = Math.random;
const seeded = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(R() * a.length)];

const C = {
  grass: 0x6cc04a, grass2: 0x5aae3e, dirt: 0x8a5a36, dirt2: 0x6e4628, asphalt: 0x55585e, yellow: 0xf2c12e, white: 0xf4f4f0,
  curb: 0xbdbab3, walk: 0xd9d4ca, walk2: 0xcbc5b9, gravel: 0x857c70, trunk: 0x7a4e2c, leaf: 0x4fae3c, leaf2: 0x3e9a33,
  skin: 0xf6d2b0, red: 0xe0402f, blue: 0x3a7bd5, orange: 0xf08a24, ice: 0xf2f7fb, sea: 0x2f7fd9, land: 0x5dbb4a, gold: 0xffc928,
};
const CAR_COLORS = [0xe94b3c, 0x3a7bd5, 0xf2c12e, 0xf4f4f4, 0x2fb36d, 0x8e5bd6, 0xff8a3d];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const VMAT = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });

class Vox {
  constructor(s) { this.s = s; this.c = new Map(); }
  set(x, y, z, col) { this.c.set(`${x},${y},${z}`, [x, y, z, col]); return this; }
  box(x0, y0, z0, x1, y1, z1, col) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, typeof col === "function" ? col(x, y, z) : col);
    return this;
  }
  // 칸 (x,y,z) 는 가로·깊이로는 가운데, 높이로는 바닥이 y*s 에 오게 놓인다. o 는 회전축을 옮길 때
  mesh({ jitter = 0.06, shadow = true, o = [0, 0, 0] } = {}) {
    const list = [...this.c.values()], m = new THREE.InstancedMesh(BOX, VMAT, list.length), mat = new THREE.Matrix4(), col = new THREE.Color(), s = this.s;
    list.forEach(([x, y, z, c], i) => {
      m.setMatrixAt(i, mat.makeScale(s, s, s).setPosition((x - o[0]) * s, (y - o[1]) * s + s / 2, (z - o[2]) * s));
      col.set(c); if (jitter) col.offsetHSL(0, 0, (R() - 0.5) * jitter); m.setColorAt(i, col);
    });
    m.castShadow = m.receiveShadow = shadow;
    return m;
  }
}

// 분위기별 하늘·햇빛
const MOODS = {
  day: { sky: ["#4f9be8", "#9fcdf5", "#e3f1fc"], fog: 0xd4e8fb, sun: 0xfff0d8, sunI: 2.6, hemi: [0xdcefff, 0x9a8a6a, 1.5] },
  sunset: { sky: ["#3b4f9a", "#f08a6a", "#ffd9a0"], fog: 0xf6c9a0, sun: 0xffb070, sunI: 2.4, hemi: [0xffd2b0, 0x6a4a5a, 1.2] },
  overcast: { sky: ["#8a9bb0", "#b9c6d4", "#dfe5ea"], fog: 0xd0d8e0, sun: 0xffffff, sunI: 1.4, hemi: [0xe0e8f0, 0x8a8a80, 1.7] },
  night: { sky: ["#0b1430", "#1d2d5c", "#3a4f86"], fog: 0x2a3a66, sun: 0x9fb8ff, sunI: 1.1, hemi: [0x8aa0d8, 0x202838, 0.9] },
};
const mood = () => MOODS[S.mood] || MOODS.day;
const skyTex = {};
function sky() {
  if (skyTex[S.mood]) return skyTex[S.mood];
  const c = document.createElement("canvas"); c.width = 2; c.height = 256;
  const g = c.getContext("2d"), r = g.createLinearGradient(0, 0, 0, 256), [a, b, d] = mood().sky;
  r.addColorStop(0, a); r.addColorStop(0.55, b); r.addColorStop(1, d);
  g.fillStyle = r; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return (skyTex[S.mood] = tex);
}

function world({ fogNear = 30, fogFar = 90, shadow = 16 } = {}) {
  const m = mood(), scene = new THREE.Scene(); scene.background = sky(); scene.fog = new THREE.Fog(m.fog, fogNear, fogFar);
  scene.add(new THREE.HemisphereLight(...m.hemi));
  const sun = new THREE.DirectionalLight(m.sun, m.sunI); sun.position.set(-8, 14, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -shadow, right: shadow, top: shadow, bottom: -shadow, near: 1, far: 70 });
  scene.add(sun, sun.target);
  return { scene, camera: cam() };
}

function clouds(scene, n, spread = 30, y0 = 7) {
  if (!S.clouds) return;
  for (let i = 0; i < n; i++) {
    const v = new Vox(0.6), w = 3 + Math.floor(R() * 4);
    for (let x = 0; x < w; x++) for (let z = 0; z < 2; z++) { v.set(x, 0, z, 0xffffff); if (x > 0 && x < w - 1 && R() < 0.7) v.set(x, 1, z, 0xffffff); }
    const m = v.mesh({ jitter: 0.03, shadow: false });
    m.position.set((R() - 0.5) * spread, y0 + R() * 5, -8 - R() * spread * 0.8); scene.add(m);
  }
}

// 떠 있는 잔디 섬. fill(v) 로 그 위에 나무·집을 얹는다 (땅 위 칸은 y ≥ 0)
function island(r, fill, s = G) {
  const v = new Vox(s);
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    const d = Math.hypot(x, z);
    if (d <= r) v.set(x, -1, z, R() < 0.5 ? C.grass : C.grass2);
    [[r - 0.8, -2, C.dirt], [r - 2, -3, C.dirt2], [r - 3.5, -4, C.dirt2]].forEach(([rr, y, c]) => d <= rr && v.set(x, y, z, c));
  }
  fill?.(v);
  const g = new THREE.Group(); g.add(v.mesh({ jitter: 0.08 }));
  if (v.fine) g.add(v.fine.mesh({ jitter: 0.05 }));
  return g;
}

function tree(v, x, z, h = 3) {
  v.box(x, 0, z, x, h - 1, z, C.trunk);
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++)
    if (dx * dx + dy * dy * 1.5 + dz * dz <= 5 + R()) v.set(x + dx, h + dy, z + dz, R() < 0.5 ? C.leaf : C.leaf2);
}

function house(v, x, z, w, d, h, wall, roof) {
  v.box(x, 0, z, x + w - 1, h - 1, z + d - 1, wall);
  v.box(x + Math.floor(w / 2), 0, z + d - 1, x + Math.floor(w / 2), 1, z + d - 1, 0x7a4e2c); // 문
  for (let i = 0; i <= Math.ceil(d / 2); i++) v.box(x - 1, h + i, z - 1 + i, x + w, h + i, z + d - i, roof); // 계단 지붕
}

// 꽃은 땅 블록보다 잘게 — v.fine 에 줄기 + 꽃송이
function flowers(v, r, n) {
  const f = (v.fine ||= new Vox(0.08)), k = v.s / f.s;
  for (let i = 0; i < n; i++) {
    const a = R() * 6.28, d = 1.5 + R() * (r - 2), x = Math.round(Math.cos(a) * d * k), z = Math.round(Math.sin(a) * d * k), c = pick([0xffd23f, 0xff6b8a, 0xffffff, 0xb58cff]);
    f.box(x, 0, z, x, 1, z, C.leaf2); f.box(x - 1, 2, z - 1, x, 3, z, c);
  }
}

// 노랑·검정 말뚝 (앞쪽에 두면 흐림 속 소품이 된다)
function bollard(x, z, y = 0) {
  const v = new Vox(0.1); for (let y = 0; y < 7; y++) v.box(0, y, 0, 1, y, 1, y % 3 === 2 ? 0x222222 : C.yellow);
  const m = v.mesh({ jitter: 0.04 }); m.position.set(x, y, z); return m;
}

// 주인공 캐릭터 — 캐릭터 만들기 칸이 이 필드를 그대로 쓴다 (색은 "#rrggbb")
export const CHAR_FIELDS = [
  { k: "skin", label: "피부", type: "color", def: "#f6d2b0" },
  { k: "hairStyle", label: "머리 모양", type: "select", def: "short", choices: [["short", "짧은 머리"], ["long", "긴 머리"], ["bob", "단발"], ["spiky", "삐죽 머리"], ["bald", "민머리"]] },
  { k: "hair", label: "머리색", type: "color", def: "#2a2220" },
  { k: "hat", label: "모자", type: "select", def: "cap", choices: [["cap", "야구 모자"], ["beanie", "털모자"], ["none", "없음"]] },
  { k: "hatColor", label: "모자 색", type: "color", def: "#e0402f" },
  { k: "eyes", label: "눈", type: "color", def: "#2e4a8a" },
  { k: "glasses", label: "안경", type: "check", def: false },
  { k: "cheeks", label: "볼터치", type: "check", def: true },
  { k: "shirt", label: "윗옷", type: "color", def: "#f2f2ee" },
  { k: "pattern", label: "윗옷 무늬", type: "select", def: "chevron", choices: [["chevron", "꺾쇠"], ["stripe", "줄무늬"], ["dot", "네모 점"], ["none", "없음"]] },
  { k: "patColor", label: "무늬 색", type: "color", def: "#f08a24" },
  { k: "pants", label: "바지", type: "color", def: "#3a7bd5" },
  { k: "shoes", label: "신발", type: "color", def: "#553a2a" },
  { k: "bag", label: "가방", type: "check", def: true },
  { k: "bagColor", label: "가방 색", type: "color", def: "#3f9a4a" },
  { k: "scale", label: "크기", type: "range", def: 1, min: 0.8, max: 1.4, step: 0.05 },
];
const CHAR_DEF = defaults(CHAR_FIELDS);
const PATTERNS = {
  chevron: [[-1, 7], [0, 7], [-2, 6], [1, 6]], dot: [[-1, 6], [0, 6], [-1, 7], [0, 7]], none: [],
  stripe: [6, 8].flatMap((y) => [-3, -2, -1, 0, 1, 2].map((x) => [x, y])),
};

function kid(o = {}) {
  const c = { ...CHAR_DEF, ...o }, s = 0.06 * (Number(c.scale) || 1), g = new THREE.Group(), parts = {};
  const part = (name, o, fill) => {
    const v = new Vox(s); fill(v);
    const p = new THREE.Group(); p.position.set(o[0] * s, o[1] * s, o[2] * s); p.add(v.mesh({ jitter: 0.04, o })); g.add(p); parts[name] = p;
  };
  part("legL", [0, 3, 0], (v) => { v.box(-3, 1, -1, -2, 2, 0, c.skin); v.box(-3, 0, -1, -2, 0, 1, c.shoes); });
  part("legR", [0, 3, 0], (v) => { v.box(1, 1, -1, 2, 2, 0, c.skin); v.box(1, 0, -1, 2, 0, 1, c.shoes); });
  part("body", [0, 0, 0], (v) => {
    v.box(-3, 3, -2, 2, 4, 1, c.pants); v.box(-3, 5, -2, 2, 8, 1, c.shirt);
    (PATTERNS[c.pattern] || []).forEach(([x, y]) => v.set(x, y, 1, c.patColor));
    if (c.bag) v.box(-2, 5, -3, 1, 8, -3, c.bagColor);
    if (c.hairStyle === "long") v.box(-3, 7, -3, 2, 8, -3, c.hair); // 등으로 내려온 머리
  });
  part("armL", [-4, 8, 0], (v) => { v.box(-4, 7, -1, -4, 8, 0, c.shirt); v.box(-4, 5, -1, -4, 6, 0, c.skin); });
  part("armR", [3, 8, 0], (v) => { v.box(3, 7, -1, 3, 8, 0, c.shirt); v.box(3, 5, -1, 3, 6, 0, c.skin); });
  part("head", [0, 9, 0], (v) => {
    v.box(-4, 9, -3, 3, 15, 3, c.skin);
    const hs = c.hairStyle, hr = c.hair;
    if (hs !== "bald") {
      v.box(-4, 9, -3, 3, 15, -3, hr); v.box(-4, 15, -3, 3, 15, 3, hr); v.box(-4, 14, 3, 3, 15, 3, hr);
      const low = hs === "long" ? 9 : hs === "bob" ? 10 : 12;
      v.box(-4, low, -3, -4, 15, hs === "long" ? 2 : 3, hr); v.box(3, low, -3, 3, 15, hs === "long" ? 2 : 3, hr);
      if (hs === "bob") [-4, -3, 2, 3].forEach((x) => v.set(x, 13, 3, hr));
      if (hs === "spiky") for (let x = -4; x <= 3; x += 2) for (let z = -3; z <= 2; z += 2) v.set(x, 16, z, hr);
    }
    [[-2, 11], [-2, 12], [1, 11], [1, 12]].forEach(([x, y]) => v.set(x, y, 3, c.eyes));
    if (c.cheeks) { v.set(-3, 10, 3, 0xf2a39a); v.set(2, 10, 3, 0xf2a39a); }
    if (c.glasses) [[-3, 11], [-3, 12], [-1, 11], [-1, 12], [-3, 13], [-2, 13], [-1, 13], [0, 11], [0, 12], [2, 11], [2, 12], [0, 13], [1, 13], [2, 13]].forEach(([x, y]) => v.set(x, y, 4, 0x1a1a1a));
    if (c.hat === "cap") { v.box(-4, 15, -3, 3, 16, 3, c.hatColor); v.box(-4, 15, 4, 3, 15, 5, c.hatColor); v.set(-1, 16, 3, 0xffffff); v.set(0, 16, 3, 0xffffff); }
    if (c.hat === "beanie") { v.box(-4, 14, -3, 3, 16, 3, c.hatColor); v.box(-1, 17, -1, 0, 17, 0, 0xffffff); }
  });
  const swing = (a) => { parts.legL.rotation.x = a; parts.legR.rotation.x = -a; parts.armL.rotation.x = -a; parts.armR.rotation.x = a; };
  return {
    g, parts,
    idle(t) { swing(0); parts.body.position.y = 0; parts.head.position.y = 9 * s + Math.sin(t * 3) * 0.008; parts.head.rotation.z = Math.sin(t * 1.3) * 0.06; },
    walk(t, k = 1) { const a = Math.sin(t * 9 * k) * 0.6; swing(a); parts.head.rotation.z = 0; g.children.forEach((c) => (c.position.y = c.userData.y0 ?? (c.userData.y0 = c.position.y), c.position.y = c.userData.y0 + Math.abs(Math.cos(t * 9 * k)) * 0.03)); },
    wave(t) { swing(0); parts.armR.rotation.z = 2.6 + Math.sin(t * 8) * 0.35; parts.head.rotation.z = Math.sin(t * 2) * 0.08; },
  };
}
// 지나가는 사람: 주인공과 같은 틀에 옷·머리만 무작위
const npc = () => kid({
  hat: R() < 0.25 ? pick(["cap", "beanie"]) : "none", hatColor: pick(["#3a7bd5", "#2fb36d", "#333333"]), hairStyle: pick(["short", "short", "long", "bob", "spiky"]),
  shirt: pick(["#f2f2ee", "#f2c12e", "#5aa0e6", "#e86a5a", "#8ad16b", "#b48ae0"]), pattern: pick(["none", "chevron", "stripe", "dot"]), patColor: pick(["#ffffff", "#333333", "#f08a24"]),
  pants: pick(["#3b4a6b", "#6b5a3b", "#2f2f2f", "#3a7bd5"]), hair: pick(["#2a2220", "#5a3a22", "#1a1a1a", "#8a5a2a"]), bag: R() < 0.4, bagColor: pick(["#3f9a4a", "#e0402f", "#333333"]),
  glasses: R() < 0.15, cheeks: R() < 0.5,
});

// 자동차 — 앞이 +z
function car(color) {
  const v = new Vox(0.13), glass = 0x9fd3f2, dark = 0x262626;
  v.box(-3, 1, -7, 3, 2, 7, color); v.box(-3, 3, -3, 3, 4, 3, glass); v.box(-3, 5, -3, 3, 5, 3, color);
  [-3, 3].forEach((x) => { v.box(x, 3, 0, x, 4, 0, color); v.box(x, 3, -3, x, 4, -3, color); v.box(x, 3, 3, x, 4, 3, color); });
  [[-3, -6], [-3, 4], [3, -6], [3, 4]].forEach(([x, z]) => v.box(x, 0, z, x, 1, z + 2, dark));
  [-3, -2, 2, 3].forEach((x) => v.set(x, 2, 7, 0xfff2a8)); [-3, 3].forEach((x) => v.set(x, 2, -7, 0xd8332a));
  return v.mesh({ jitter: 0.03 });
}

// 노란 전차 한 칸 (참고 이미지의 그 전차) — 앞이 +z
function tram() {
  const v = new Vox(0.14), Y = 0xf2c12e, glass = 0xbfe4f7;
  v.box(-4, 1, -13, 3, 9, 13, Y); v.box(-4, 3, -13, 3, 3, 13, 0xc8382c); v.box(-4, 10, -12, 3, 10, 12, 0x9a9a9a);
  [-4, 3].forEach((x) => { for (let z = -11; z <= 11; z += 4) v.box(x, 5, z, x, 7, z + 2, glass); });
  v.box(-3, 5, 13, 2, 8, 13, glass); v.box(-3, 5, -13, 2, 8, -13, glass);
  v.set(-3, 2, 13, 0xfff2a8); v.set(2, 2, 13, 0xfff2a8);
  v.box(-1, 11, -2, 0, 12, 2, 0x555555); v.box(-1, 13, -1, 0, 13, 1, 0x333333);
  [-10, -7, 7, 10].forEach((z) => [-4, 3].forEach((x) => v.box(x, 0, z, x, 0, z + 1, 0x222222)));
  return v.mesh({ jitter: 0.04 });
}

const side = (s) => (String(s.value).trim().toLowerCase() === "left" ? -1 : 1);
const loopZ = (z, lo, hi) => ((((z - lo) % (hi - lo)) + (hi - lo)) % (hi - lo)) + lo;

// 지구본 물 마스크 — 블록 지구를 칠할 때 쓴다 (열 때 한 번 받는다)
let MASK;
async function loadMask() {
  if (MASK) return;
  const img = new Image(); img.crossOrigin = "anonymous"; img.src = `${IMG}/earth-water.png`;
  await img.decode().catch(() => {});
  if (!img.naturalWidth) return;
  const c = document.createElement("canvas"), w = (c.width = 720), h = (c.height = 360), g = c.getContext("2d");
  g.drawImage(img, 0, 0, w, h); MASK = { w, h, d: g.getImageData(0, 0, w, h).data };
}
const isLand = (lat, lon) => {
  if (!MASK) return false;
  const x = Math.min(MASK.w - 1, Math.floor(((lon + 180) / 360) * MASK.w)), y = Math.min(MASK.h - 1, Math.floor(((90 - lat) / 180) * MASK.h));
  return MASK.d[(y * MASK.w + x) * 4] < 128;
};

// 위도·경도 → 구 표면
const ll = (lat, lon, r) => {
  const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};

// 3×5 블록 숫자
const DIGITS = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
  5: "111100111001111", 6: "111100111101111", 7: "111001010010010", 8: "111101111101111", 9: "111101111001111",
  ".": "000000000000010", ",": "000000000010100", "%": "101001010100101", "-": "000000111000000", "+": "000010111010000",
};

const SCENES = {
  title() {
    R = seeded(1);
    const { scene, camera } = world(), k = kid(MAIN);
    scene.add(island(7, (v) => { tree(v, -4, -3, 3); tree(v, 4, -2, 4); house(v, 0, -6, 4, 3, 3, 0xf3e6c8, C.blue); flowers(v, 7, 10); }));
    scene.add(k.g); clouds(scene, 9);
    return { scene, camera, focus: 0.6, update(t) { k.idle(t); const a = -0.3 + t * 0.05; camera.position.set(Math.sin(a) * 7.5, 3.4, Math.cos(a) * 7.5); camera.lookAt(0, 1.3, 0); } };
  },

  globe(s) {
    R = seeded(3);
    const { scene, camera } = world({ shadow: 4 }), group = new THREE.Group(); scene.add(group);
    const r = 26, v = new Vox(1.6 / r);
    for (let x = -r - 1; x <= r + 1; x++) for (let y = -r - 1; y <= r + 1; y++) for (let z = -r - 1; z <= r + 1; z++) {
      const d = Math.hypot(x, y, z); if (d > r + 1 || d <= r - 1.6) continue;
      const lat = 90 - (Math.acos(y / d) * 180) / Math.PI; let lon = (Math.atan2(z, -x) * 180) / Math.PI - 180; if (lon < -180) lon += 360;
      const land = isLand(lat, lon); if (d > r && !land) continue;
      v.set(x, y, z, Math.abs(lat) > 72 ? C.ice : land ? (d > r ? C.land : 0x4a9e3a) : C.sea);
    }
    const ball = v.mesh({ jitter: 0.07, o: [0, 0.5, 0] }); ball.castShadow = false; group.add(ball);
    // 핀: "위도,경도[,orange]" 를 | 로 잇는다. 첫 핀이 화면 가운데로 온다
    const pins = String(s.value || "").split("|").map((x) => x.split(",").map((y) => y.trim())).filter((a) => isFinite(parseFloat(a[0])) && isFinite(parseFloat(a[1])));
    const UP = new THREE.Vector3(0, 1, 0), aim = new THREE.Vector3();
    const flags = pins.map(([la, lo, c], i) => {
      const pv = new Vox(0.075); pv.box(0, 0, 0, 0, 9, 0, 0xeeeeee); pv.box(1, 6, 0, 5, 9, 0, c === "orange" ? C.orange : C.blue);
      const m = pv.mesh({ jitter: 0.03 }), p = ll(+la, +lo, 1);
      if (!i) aim.copy(p); m.position.copy(p.clone().multiplyScalar(1.62)); m.quaternion.setFromUnitVectors(UP, p); group.add(m); m.userData.i = i; return m;
    });
    let ya = 0, xb = 0;
    if (flags.length) { aim.normalize(); ya = Math.atan2(-aim.x, aim.z); const z1 = -aim.x * Math.sin(ya) + aim.z * Math.cos(ya); xb = Math.atan2(aim.y, z1); }
    clouds(scene, 6, 24, 4);
    return {
      scene, camera, focus: 0.47, update(t, dur) {
        if (flags.length) { group.rotation.set(xb * ease(t / 1.6), ya - 1.2 * (1 - ease(t / 1.6)) + Math.sin(t * 0.5) * 0.04, 0); }
        else group.rotation.set(0.35, -2 + t * 0.2, 0);
        flags.forEach((f) => f.scale.setScalar(ease((t - 1.2 - f.userData.i * 0.35) * 3) || 0.0001));
        camera.position.set(0, 0.2, 9 - ease(t / dur) * 1.2); camera.lookAt(0, 0.1, 0);
      },
    };
  },

  road(s) {
    R = seeded(4);
    const sd = side(s), { scene, camera } = world({ fogNear: 16, fogFar: 50 }), v = new Vox(G);
    for (let z = -80; z <= 16; z++) for (let x = -14; x <= 14; x++) {
      const a = Math.abs(x);
      v.set(x, -1, z, x === 0 ? C.yellow : a <= 3 ? C.asphalt : a === 4 ? C.curb : a <= 6 ? ((x + z) & 1 ? C.walk : C.walk2) : R() < 0.5 ? C.grass : C.grass2);
    }
    // 차로 화살표: 내 쪽(sd) 차로는 멀어지는 쪽, 반대 차로는 다가오는 쪽
    for (const sg of [-1, 1]) {
      const dz = sg === sd ? -1 : 1;
      for (let z0 = 8; z0 > -76; z0 -= 18) { [0, 1, 2].forEach((k) => v.set(sg * 2, -1, z0 + dz * k, C.white)); [1, 2, 3].forEach((x) => v.set(sg * x, -1, z0 + dz * 3, C.white)); v.set(sg * 2, -1, z0 + dz * 4, C.white); }
    }
    for (let z = 10; z > -70; z -= 7) [-1, 1].forEach((sg) => tree(v, sg * (9 + Math.floor(R() * 3)), z + Math.floor(R() * 3), 3 + Math.floor(R() * 2)));
    for (let z = 4; z > -70; z -= 13) [-1, 1].forEach((sg) => house(v, sg > 0 ? 13 : -17, z, 5, 4, 3 + Math.floor(R() * 2), pick([0xf3e6c8, 0xffffff, 0xe8d3b0]), pick([C.red, C.blue, 0x2fb36d])));
    scene.add(v.mesh({ jitter: 0.07 }));
    const cars = [];
    for (const sg of [-1, 1]) for (let i = 0; i < 5; i++) {
      const m = car(pick(CAR_COLORS)), away = sg === sd; m.rotation.y = away ? Math.PI : 0;
      m.position.x = sg * 2 * G; m.userData = { z0: -i * 11 - R() * 4, v: away ? -5.5 : 5 }; scene.add(m); cars.push(m);
    }
    const k = kid(MAIN); k.g.position.set(sd * 2.8, 0, 3.2); k.g.rotation.y = -sd * Math.PI / 2; scene.add(k.g);
    [1.5, 4, 6.5].forEach((z) => scene.add(bollard(-sd * 2.15, z + 2)));
    clouds(scene, 8, 40, 9);
    return {
      scene, camera, focus: 0.5, update(t, dur) {
        cars.forEach((m) => (m.position.z = loopZ(m.userData.z0 + m.userData.v * t, -45, 14)));
        k.idle(t);
        const e = ease(t / dur); camera.position.set(sd * 1.3, 3.6 - e * 0.5, 10.5 - e * 1.5); camera.lookAt(sd * 0.3, 0.4, -6);
      },
    };
  },

  walk(s) {
    R = seeded(5);
    const sd = side(s), { scene, camera } = world({ fogNear: 14, fogFar: 45 }), v = new Vox(G);
    for (let z = -60; z <= 16; z++) for (let x = -12; x <= 12; x++) {
      const a = Math.abs(x);
      v.set(x, -1, z, a <= 6 ? ((x + z) & 1 ? C.walk : C.walk2) : a === 7 ? C.curb : R() < 0.5 ? C.grass : C.grass2);
    }
    // 바닥 화살표 (파랑) — 반으로 나눈 보도 양쪽
    for (const sg of [-1, 1]) {
      const dz = sg === sd ? -1 : 1;
      for (let z0 = 10; z0 > -56; z0 -= 14) { [0, 1, 2].forEach((k) => v.set(sg * 3, -1, z0 + dz * k, C.blue)); [1, 2, 3, 4, 5].forEach((x) => v.set(sg * x, -1, z0 + dz * 3, C.blue)); [2, 3, 4].forEach((x) => v.set(sg * x, -1, z0 + dz * 4, C.blue)); v.set(sg * 3, -1, z0 + dz * 5, C.blue); }
    }
    for (let z = 8; z > -56; z -= 6) [-1, 1].forEach((sg) => tree(v, sg * 10, z, 3));
    scene.add(v.mesh({ jitter: 0.07 }));
    const people = [];
    for (const sg of [-1, 1]) for (let i = 0; i < 7; i++) {
      const p = npc(), away = sg === sd; p.g.rotation.y = away ? Math.PI : 0;
      p.g.position.x = sg * (0.9 + R() * 1.6); p.u = { z0: 6 - i * 4.5 - R() * 2, v: away ? -1.3 : 1.3, ph: R() * 3 }; scene.add(p.g); people.push(p);
    }
    const k = kid(MAIN); k.g.rotation.y = Math.PI; k.g.position.x = sd * 1.6; scene.add(k.g);
    clouds(scene, 7, 36, 9);
    return {
      scene, camera, focus: 0.55, update(t) {
        people.forEach((p) => { p.g.position.z = loopZ(p.u.z0 + p.u.v * t, -30, 12); p.walk(t + p.u.ph); });
        const kz = 4 - t * 1.3; k.g.position.z = kz; k.walk(t);
        camera.position.set(sd * 0.6, 3.4, kz + 6.5); camera.lookAt(sd * 0.4, 0.6, kz - 5);
      },
    };
  },

  rail(s) {
    R = seeded(6);
    const sd = side(s), { scene, camera } = world({ fogNear: 18, fogFar: 55 }), v = new Vox(G);
    for (let z = -70; z <= 16; z++) for (let x = -12; x <= 12; x++) {
      const a = Math.abs(x);
      if (a <= 3) v.set(x, -1, z, C.gravel);
      else if (a <= 7) { v.set(x, -1, z, C.curb); v.set(x, 0, z, a === 4 ? C.yellow : (x + z) & 1 ? 0xcfcac2 : 0xc4bfb6); }
      else v.set(x, -1, z, R() < 0.5 ? C.grass : C.grass2);
    }
    for (let z = 6; z > -40; z -= 6) [-1, 1].forEach((sg) => v.box(sg * 7, 1, z, sg * 7, 6, z, 0x6a6f78));
    [-1, 1].forEach((sg) => v.box(sg > 0 ? 4 : -8, 7, -40, sg > 0 ? 8 : -4, 7, 7, 0x3d4350));
    for (let z = 8; z > -60; z -= 7) [-1, 1].forEach((sg) => tree(v, sg * 10, z, 4));
    scene.add(v.mesh({ jitter: 0.07 }));
    // 침목·레일 (잔 블록)
    const rv = new Vox(0.125);
    for (const sg of [-1, 1]) {
      const cx = sg * 8;
      for (let z = -560; z <= 128; z++) { [-4, 4].forEach((d) => rv.set(cx + d, 1, z, 0x8f8f8f)); if (z % 4 === 0) rv.box(cx - 6, 0, z, cx + 6, 0, z, 0x5b4230); }
    }
    scene.add(rv.mesh({ jitter: 0.05 }));
    const train = new THREE.Group(), c1 = tram(), c2 = tram(); c2.position.z = -3.9; train.add(c1, c2);
    train.position.set(sd * 1.0, 0.13, 0); train.rotation.y = Math.PI; scene.add(train);
    const k = kid(MAIN); k.g.position.set(sd * 2.6, 0.5, 4.5); k.g.rotation.y = -sd * Math.PI / 2 * 0.6; scene.add(k.g);
    [3, 5].forEach((z) => scene.add(bollard(sd * 3.5, z + 3, 0.5)));
    clouds(scene, 7, 36, 9);
    return {
      scene, camera, focus: 0.5, update(t, dur) {
        train.position.z = -2 - Math.max(0, t - 0.6) ** 2 * 0.45; k.idle(t);
        const e = ease(t / dur); camera.position.set(sd * 3.4, 2.4, 10 - e); camera.lookAt(sd * 0.6, 1, -4);
      },
    };
  },

  town(s) {
    R = seeded(7);
    const old = String(s.value).trim() === "old", { scene, camera } = world();
    const walls = old ? [0xe8dcc0, 0xd9c7a5, 0xcdb894] : [0xf3e6c8, 0xffffff, 0xe8d3b0, 0xf6c9b0];
    const roofs = old ? [0x4a4a52, 0x5a4636, 0x3f3f46] : [C.red, C.blue, 0x2fb36d, 0xf08a24];
    const carsAt = [];
    scene.add(island(11, (v) => {
      for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) if ((x === 0 || z === 1) && Math.hypot(x, z) <= 11) v.set(x, -1, z, old ? 0xb89a6e : C.asphalt);
      [[-8, -8], [3, -8], [-8, 4], [3, 4], [-4, -5], [6, -3]].forEach(([x, z]) => house(v, x, z, 4, 3, 2 + Math.floor(R() * 2), pick(walls), pick(roofs)));
      [[-3, 8], [8, 7], [-9, -1], [8, -8], [-2, -9]].forEach(([x, z]) => tree(v, x, z, 3));
      flowers(v, 10, 14);
      if (!old) carsAt.push([0, -5], [0, 6]);
    }));
    carsAt.forEach(([x, z], i) => { const m = car(pick(CAR_COLORS)); m.position.set((i ? -1 : 1) * 0.35, 0, z * G); m.rotation.y = i ? 0 : Math.PI; scene.add(m); });
    const k = kid(MAIN); k.g.position.set(0.5, 0, 2.2); k.g.scale.setScalar(1.4); scene.add(k.g);
    clouds(scene, 9);
    return { scene, camera, focus: 0.55, sepia: old, update(t) { k.idle(t); const a = 0.5 + t * 0.06; camera.position.set(Math.sin(a) * 18, 14, Math.cos(a) * 18); camera.lookAt(0, -1, 0.5); } };
  },

  compare(s) {
    R = seeded(8);
    const { scene, camera } = world(), labels = String(s.value || "").split("|");
    const kids = [-1, 1].map((sg, i) => {
      const m = island(5, (v) => { tree(v, sg * 2, -3, 3); flowers(v, 5, 5); }, 0.27); m.position.set(sg * 1.55, 0, 0); scene.add(m);
      // 라벨에 '차'가 들어가면 아이 대신 자동차를 세운다
      if (/차|car/i.test(labels[i] || "")) { const c = car(i ? S.alert : S.accent); c.scale.setScalar(0.6); c.position.set(sg * 1.55, 0, 0.3); c.rotation.y = 0.5 * -sg; scene.add(c); return null; }
      const k = kid({ ...MAIN, hatColor: i ? S.alert : S.accent }); k.g.position.set(sg * 1.55, 0, 0.3); k.g.rotation.y = -sg * 0.3; scene.add(k.g); return k;
    });
    clouds(scene, 8);
    return { scene, camera, focus: 0.55, update(t) { kids.forEach((k, i) => k?.idle(t + i)); camera.position.set(Math.sin(t * 0.08) * 0.6, 3.6, 12.5 - t * 0.1); camera.lookAt(0, 0.6, 0); } };
  },

  stat(s) {
    R = seeded(9);
    const { scene, camera } = world(), chars = String(s.value || "").replace(/\s/g, "").split("").filter((c) => DIGITS[c]);
    scene.add(island(7, (v) => { tree(v, -5, -1, 3); tree(v, 5, -2, 3); flowers(v, 7, 8); }));
    const cells = []; chars.forEach((c, ci) => [...DIGITS[c]].forEach((b, j) => b === "1" && cells.push([ci * 4 + (j % 3), 4 - Math.floor(j / 3), ci])));
    const wCells = chars.length * 4 - 1, bs = Math.min(0.32, 3.6 / Math.max(1, wCells));
    const v = new Vox(bs); cells.forEach(([x, y]) => v.set(x, y, 0, C.gold));
    const m = cells.length ? v.mesh({ jitter: 0.1 }) : null, mat = new THREE.Matrix4(), home = [];
    if (m) { for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mat); home.push(new THREE.Vector3().setFromMatrixPosition(mat)); } m.position.set(-(wCells - 1) * bs / 2, 0.3, -1.2); m.frustumCulled = false; scene.add(m); }
    const k = kid(MAIN); k.g.position.set(1.3, 0, 1.2); k.g.rotation.y = -0.5; scene.add(k.g);
    clouds(scene, 8);
    return {
      scene, camera, focus: 0.5, update(t, dur) {
        k.idle(t); k.parts.head.rotation.x = -0.25;
        if (m) { home.forEach((h, i) => { const d = ease((t - 0.1 - cells[i][0] * 0.025 - cells[i][2] * 0.15) * 2.2); mat.makeScale(bs, bs, bs).setPosition(h.x, h.y + (1 - d) * 6, h.z); m.setMatrixAt(i, mat); }); m.instanceMatrix.needsUpdate = true; }
        const e = ease(t / dur); camera.position.set(-0.6 + e * 0.6, 2.9, 9.6 - e * 0.8); camera.lookAt(0, 1.3, -0.5);
      },
    };
  },

  ending() {
    R = seeded(10);
    const { scene, camera } = world(), k = kid(MAIN);
    scene.add(island(6, (v) => { tree(v, -4, -2, 3); tree(v, 4, -3, 4); flowers(v, 6, 12); })); scene.add(k.g);
    const sv = new Vox(0.14);
    for (let x = -5; x <= 5; x++) for (let y = -5; y <= 5; y++) if (Math.abs(x) + Math.abs(y) * 2.2 <= 5.5 || Math.abs(y) + Math.abs(x) * 2.2 <= 5.5) sv.box(x, y, 0, x, y, 1, C.gold);
    const star = sv.mesh({ jitter: 0.12, o: [0, 0, 0.5] }); star.position.set(0, 2.1, 0); scene.add(star);
    clouds(scene, 9);
    return { scene, camera, focus: 0.55, update(t) { k.wave(t); star.rotation.y = t * 1.8; star.position.y = 2.1 + Math.sin(t * 2) * 0.08; star.scale.setScalar(ease(t * 1.5) || 0.0001); camera.position.set(0, 2.2, 7.4 - t * 0.05); camera.lookAt(0, 1.6, 0); } };
  },
};
// 예전 프로젝트의 장면 이름 (광섬유·공유기 등) 은 가까운 복셀 장면으로 보여 준다
const ALIAS = { fiber: "rail", wifi: "town", datacenter: "town", ocean: "globe" };
const pickScene = (type) => SCENES[type] || SCENES[ALIAS[type]] || SCENES.title;

// ── 글자·마감 ────────────────────────────────────────
let ctx, blur, bctx;
function drawChip(text, color, k) {
  if (!text) return;
  ctx.save(); ctx.font = `800 30px ${FONT}`;
  const w = ctx.measureText(text).width + 36, x = (W - w) / 2, y = 130;
  ctx.globalAlpha = ease(k * 3); ctx.translate(W / 2, y + 26); ctx.scale(0.8 + 0.2 * ease(k * 3), 0.8 + 0.2 * ease(k * 3)); ctx.translate(-W / 2, -(y + 26));
  block(x, y, w, 52, color === "orange" ? S.alert : S.accent);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 18, y + 25);
  ctx.restore();
}

// 픽셀 블록 판: 각진 모서리 + 아래쪽 어두운 두께
function block(x, y, w, h, color) {
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(x, y + 8, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x, y + h - 6, w, 6);
  ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x, y, w, 4);
}

// 흰 글자 + 굵은 짙은 테두리 (밝은 하늘 위에서도 읽히게)
function inked(text, x, y, fill = "#fff", lw = 10) {
  ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function drawLabel(text, cx, y, color) {
  if (!text) return;
  ctx.save(); ctx.font = `800 30px ${FONT}`; ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 32; block(cx - w / 2, y, w, 50, color);
  ctx.fillStyle = "#fff"; ctx.fillText(text, cx - w / 2 + 16, y + 24); ctx.restore();
}

function drawTag(text, lt) {
  if (!text) return;
  const n = Math.floor(lt * 28);
  ctx.save(); ctx.font = `700 20px ${MONO}`; ctx.textBaseline = "middle";
  ctx.fillStyle = INK; ctx.fillRect(26, 698, 7, 30); ctx.fillStyle = S.highlight; ctx.fillRect(28, 700, 3, 26);
  inked(text.slice(0, n).toUpperCase(), 42, 714, "#fff", 6);
  ctx.restore();
}

function drawCaption(s, t) {
  const ch = s.chunks.find((c) => t >= c[0].t0 - 0.05 && t < c[c.length - 1].t1 + 0.25);
  if (!ch) return;
  ctx.save(); ctx.font = `900 ${S.caption}px ${FONT}`; ctx.textBaseline = "middle";
  const ws = ch.map((x) => ctx.measureText(x.w).width), gap = 16;
  let x = (W - ws.reduce((a, b) => a + b, 0) - gap * (ch.length - 1)) / 2;
  const y = 980;
  ch.forEach((wd, i) => { // 지금 읽는 단어만 노랗게 살짝 튀어 오른다
    const on = t >= wd.t0 && t < wd.t1 + 0.1;
    inked(wd.w, x, y - (on ? 6 : 0), on ? S.highlight : "#fff", 12); x += ws[i] + gap;
  });
  ctx.restore();
}

function drawTitle(text, lt) {
  ctx.save(); ctx.font = `900 68px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, text, W - 100); ctx.globalAlpha = ease(lt * 1.5);
  lines.forEach((l, i) => inked(l, W / 2, 250 + (i - (lines.length - 1) / 2) * 84 + (1 - ease(lt * 1.5)) * 30, i === lines.length - 1 ? S.highlight : "#fff", 16));
  ctx.restore();
}

// 틸트시프트: 화면 위아래를 흐리게 해 미니어처처럼. focus 는 또렷한 띠의 세로 위치 (0~1)
function tiltShift(src, focus, filter) {
  bctx.globalCompositeOperation = "source-over"; bctx.clearRect(0, 0, W, H);
  bctx.filter = `blur(${S.blur}px) ${filter}`; bctx.drawImage(src, 0, 0); bctx.filter = "none";
  const g = bctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#000"); g.addColorStop(Math.max(0.01, focus - 0.24), "rgba(0,0,0,0)"); g.addColorStop(Math.min(0.99, focus + 0.16), "rgba(0,0,0,0)"); g.addColorStop(1, "#000");
  bctx.globalCompositeOperation = "destination-in"; bctx.fillStyle = g; bctx.fillRect(0, 0, W, H);
  ctx.drawImage(blur, 0, 0);
}


const TYPES = {
  title: { label: "제목 (섬·주인공)" },
  globe: { label: "블록 지구본·핀", hint: "핀: 위도,경도[,orange] | … (예: 37.5,127|35.7,139.7,orange)" },
  road: { label: "도로·자동차", hint: "left 또는 right (차가 다니는 쪽)" },
  walk: { label: "보도·사람들", hint: "left 또는 right (사람이 걷는 쪽)" },
  rail: { label: "역·전차", hint: "left 또는 right (전차가 서는 쪽)" },
  town: { label: "마을 전경", hint: "old 면 옛날 마을(빛바랜 색)" },
  compare: { label: "두 섬 비교", hint: "왼쪽 라벨|오른쪽 라벨 (‘차’가 들어가면 자동차)" },
  stat: { label: "블록 숫자", hint: "숫자 (예: 88, 1.4)" },
  ending: { label: "마무리 (손 흔들기)" },
};

export default {
  id: "voxel", name: "복셀 세상", desc: "3D 픽셀 블록 미니어처 · 빨간 모자 주인공", toneMapping: THREE.ACESFilmicToneMapping,
  types: TYPES, options: OPTIONS,
  character: {
    fields: CHAR_FIELDS,
    // 캐릭터 만들기 미리보기 — 작은 섬 위에서 빙글 돈다 (정사각 화면)
    preview(spec, style) {
      setStyle(style); R = seeded(11);
      const { scene } = world(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100), k = kid(spec);
      scene.add(island(3, (v) => flowers(v, 3, 5))); scene.add(k.g);
      return { scene, camera, update(t) { k.idle(t); k.g.rotation.y = t * 0.7; camera.position.set(0, 1.4, 5); camera.lookAt(0, 0.55, 0); } };
    },
  },
  async prepare() { await loadMask(); },
  build(s, env) { setStyle(env.style); MAIN = { ...CHAR_DEF, ...(env.character || {}) }; return pickScene(s.type)(s); },
  compose(env) {
    ({ ctx } = env); setStyle(env.style);
    if (!blur) { blur = document.createElement("canvas"); blur.width = W; blur.height = H; bctx = blur.getContext("2d"); }
    const { src, s, b, t, lt, idx, p } = env;
    const filter = b.sepia ? "sepia(.6) saturate(.8)" : "saturate(1.08)";
    ctx.filter = filter; ctx.drawImage(src, 0, 0); ctx.filter = "none";
    if (S.blur > 0) tiltShift(src, b.focus ?? 0.55, filter);
    // 가장자리를 살짝 어둡게 — 시선을 가운데로
    const g = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.3, W / 2, H * 0.52, H * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(10,20,40,.35)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (s.type === "title") drawTitle(s.chip || p.title || p.topic, lt);
    else {
      if (s.type === "compare") { const [a, c] = String(s.value || "").split("|"); drawLabel(a?.trim(), W * 0.27, 400, S.accent); drawLabel(c?.trim(), W * 0.73, 400, S.alert); }
      drawChip(s.chip, s.chipColor, lt); drawTag(s.tag, lt);
    }
    drawCaption(s, t);
    if (lt < 0.3 && idx > 0) { ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - lt / 0.3)})`; ctx.fillRect(0, 0, W, H); } // 장면 사이 짧게 하얗게
  },
};
