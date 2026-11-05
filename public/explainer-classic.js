// 3D 설명 영상 템플릿 「클래식」 — 어두운 바탕 위 매끈한 3D (지구본·광섬유·공유기·데이터센터·바닷속 관).
// 처음 만든 화풍. 인터넷·기술 주제에 맞춘 장면들이다.
import { THREE, W, H, IMG, FONT, MONO, ease, defaults, wrapLines } from "./explainer-kit.js";

const OPTIONS = [
  { k: "accent", label: "강조 색", type: "color", def: "#3567ff" },
  { k: "alert", label: "경고 색", type: "color", def: "#ff5a1f" },
  { k: "star", label: "마무리 별 색", type: "color", def: "#d6ff3a" },
  { k: "caption", label: "자막 크기", type: "range", def: 40, min: 30, max: 54, step: 2 },
];
let S = defaults(OPTIONS), ctx;

const cam = () => new THREE.PerspectiveCamera(38, W / H, 0.1, 200);
const rnd = (a, b) => a + Math.random() * (b - a);

function dust(scene, n, color, spread) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = rnd(-spread, spread);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(pts);
  return pts;
}

let glowTex;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.3, "rgba(160,200,255,.6)"); r.addColorStop(1, "rgba(160,200,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}

// 위도·경도 → 구 표면
const ll = (lat, lon, r) => {
  const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};
const CITIES = [[37.5, 126.9], [35.6, 139.7], [1.3, 103.8], [22.3, 114.2], [-33.9, 151.2], [34.0, -118.2], [37.8, -122.4], [40.7, -74], [51.5, -0.1], [43.3, 5.4], [30, 31.2], [-23.5, -46.6], [19.1, 72.9], [25.3, 55.3], [-33.9, 18.4], [21.3, -157.8], [64.1, -21.9], [6.5, 3.4]];
const LINKS = [[0, 1], [0, 3], [1, 6], [1, 15], [15, 5], [2, 12], [2, 3], [2, 4], [12, 13], [13, 10], [10, 9], [9, 8], [8, 7], [7, 16], [7, 11], [11, 17], [17, 14], [14, 12], [6, 4], [3, 4]];

const SCENES = {
  title() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x05070d);
    const pts = dust(scene, 500, 0x7aa2ff, 8), camera = cam();
    return { scene, camera, update(t) { pts.rotation.y = t * 0.05; camera.position.set(0, 0, 10 - t * 0.4); } };
  },
  stat() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x04060c);
    const pts = dust(scene, 700, 0x3567ff, 9), camera = cam();
    return { scene, camera, update(t) { pts.rotation.z = t * 0.04; camera.position.set(0, 0, 9 - t * 0.3); } };
  },
  ending() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
    return { scene, camera: cam(), update() {} };
  },
  globe() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x03050b);
    const camera = cam(), group = new THREE.Group(); scene.add(group);
    const water = new THREE.TextureLoader().load(`${IMG}/earth-water.png`);
    // 바다 파랑 · 땅 미색 · 해안선 주황 — 물 마스크 한 장으로 칠한다
    const mat = new THREE.ShaderMaterial({
      uniforms: { mask: { value: water } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D mask; varying vec2 vUv; varying vec3 vN;
        void main(){ float w=texture2D(mask,vUv).r; float edge=smoothstep(.05,.0,abs(w-.5)-.12);
          vec3 c=mix(vec3(.95,.93,.88),vec3(.16,.42,.84),step(.5,w)); c=mix(c,vec3(1.,.55,.25),edge*.8);
          float l=.45+.65*max(dot(vN,normalize(vec3(-.4,.5,1.))),0.); gl_FragColor=vec4(c*l,1.); }`,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(2, 96, 64), mat));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(2.12, 64, 32), new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    scene.add(halo);
    const cables = LINKS.map(([a, b]) => {
      const p0 = ll(...CITIES[a], 2.01), p1 = ll(...CITIES[b], 2.01);
      const mid = p0.clone().add(p1).multiplyScalar(0.5).normalize().multiplyScalar(2 + p0.distanceTo(p1) * 0.12);
      const geo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, mid, p1), 64, 0.012, 6);
      geo.setDrawRange(0, 0);
      group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff })));
      return geo;
    });
    CITIES.forEach((c) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a })); d.position.copy(ll(...c, 2.02)); group.add(d); });
    dust(scene, 300, 0x88aaff, 12);
    return {
      scene, camera, update(t, dur) {
        group.rotation.y = -2.2 + t * 0.18; group.rotation.x = 0.35;
        cables.forEach((g, i) => g.setDrawRange(0, Math.floor(g.index.count * ease((t - i * 0.12) / Math.max(1, dur * 0.5)) / 3) * 3));
        camera.position.set(0, 0, 8.4 - ease(t / dur) * 1.6);
      },
    };
  },
  fiber() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x10233f); scene.fog = new THREE.Fog(0x10233f, 4, 16);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(2, 4, 3); scene.add(dl);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xeef4ff, transparent: true, opacity: 0.22, roughness: 0.1, side: THREE.DoubleSide }));
    tube.rotation.z = Math.PI / 2; scene.add(tube);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 30, 16), new THREE.MeshBasicMaterial({ color: 0x9cc4ff }));
    core.rotation.z = Math.PI / 2; scene.add(core);
    const pulses = Array.from({ length: 18 }, (_, i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false }));
      s.scale.set(1.4, 0.5, 1); s.userData.off = i * 1.6; scene.add(s); return s;
    });
    const camera = cam();
    return {
      scene, camera, update(t, dur) {
        pulses.forEach((s) => (s.position.x = ((s.userData.off + t * 9) % 28) - 14));
        const k = ease(t / dur);
        camera.position.set(-3 + k * 2, 1.6 - k * 0.8, 4.2); camera.lookAt(2, 0, 0);
      },
    };
  },
  wifi() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2b4670);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 1.1)); const dl = new THREE.DirectionalLight(0xffffff, 1); dl.position.set(3, 6, 4); scene.add(dl);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.7 }));
    desk.position.y = -0.1; scene.add(desk);
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 1), white); box.position.y = 0.18; scene.add(box);
    for (let i = 0; i < 4; i++) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 12), white); a.position.set(-0.6 + i * 0.4, 0.95, -0.35); scene.add(a); }
    const rings = Array.from({ length: 5 }, (_, i) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 64, 1, Math.PI * 0.2, Math.PI * 0.6), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      r.position.set(0, 0.9, 0.6); r.userData.off = i * 0.6; scene.add(r); return r;
    });
    const camera = cam();
    return {
      scene, camera, update(t, dur) {
        rings.forEach((r) => { const k = ((t + r.userData.off) % 3) / 3; r.scale.setScalar(0.5 + k * 3.5); r.material.opacity = 0.9 * (1 - k); });
        const k = ease(t / dur);
        camera.position.set(1.5 - k * 1.2, 2.2 - k * 0.6, 6 - k * 1.5); camera.lookAt(0, 0.8, 0);
      },
    };
  },
  datacenter() {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x07090d); scene.fog = new THREE.Fog(0x07090d, 6, 26);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5)); const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(0, 6, 2); scene.add(dl);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3, 60), new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.position.z = -25; scene.add(floor);
    const grid = new THREE.GridHelper(60, 60, 0xc4cad4, 0xc4cad4); grid.scale.x = 0.05; grid.position.set(0, 0.002, -25); scene.add(grid);
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.6, metalness: 0.3 });
    const leds = [], ledGeo = new THREE.BoxGeometry(0.03, 0.03, 0.01);
    for (let z = 0; z > -50; z -= 1.1) for (const x of [-1.6, 1.6]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.6, 1), rackMat); r.position.set(x, 1.3, z); scene.add(r);
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: Math.random() < 0.7 ? 0x4ade80 : 0x60a5fa }));
        m.position.set(x - Math.sign(x) * 0.61, rnd(0.3, 2.4), z + rnd(-0.4, 0.4)); m.rotation.y = Math.PI / 2; m.userData.ph = rnd(0, 6); scene.add(m); leds.push(m);
      }
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 60), new THREE.MeshBasicMaterial({ color: 0xffffff })); strip.position.set(0, 3.2, -25); scene.add(strip);
    const camera = cam();
    return {
      scene, camera, update(t, dur) {
        leds.forEach((m) => (m.visible = Math.sin(t * 6 + m.userData.ph * 3) > -0.3));
        camera.position.set(0, 1.5, 2 - ease(t / dur) * 10); camera.lookAt(0, 1.3, camera.position.z - 10);
      },
    };
  },
  ocean() {
    const scene = new THREE.Scene(); const sea = 0x1a6cb3; scene.background = new THREE.Color(sea); scene.fog = new THREE.Fog(sea, 3, 22);
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x2a4a6a, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 1); dl.position.set(-2, 8, 2); scene.add(dl);
    const sg = new THREE.PlaneGeometry(40, 40, 80, 80); sg.rotateX(-Math.PI / 2);
    const pos = sg.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i) * 0.7) * Math.cos(pos.getZ(i) * 0.5) * 0.15 + rnd(0, 0.04));
    sg.computeVertexNormals();
    scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xd9c39a, roughness: 1 })));
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-14, 0.35, 6), new THREE.Vector3(-4, 0.35, 1), new THREE.Vector3(4, 0.35, -2), new THREE.Vector3(14, 0.35, -9)]);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(path, 120, 0.45, 24), new THREE.MeshStandardMaterial({ color: 0x1d2c45, roughness: 0.9 })));
    const bub = dust(scene, 260, 0xffffff, 10); bub.material.size = 0.07; bub.material.opacity = 0.5;
    const camera = cam();
    return {
      scene, camera, update(t, dur) {
        bub.position.y = (t * 0.6) % 4;
        const k = ease(t / dur), p = path.getPoint(0.25 + k * 0.3);
        camera.position.set(p.x - 2, 2.8 - k * 0.6, p.z + 5); camera.lookAt(p.x + 1.5, 0, p.z - 1.5);
      },
    };
  },
};

// ── 글자 ────────────────────────────────────────────
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawChip(text, color, k) {
  if (!text) return;
  ctx.save(); ctx.font = `800 30px ${FONT}`;
  const w = ctx.measureText(text).width + 36, x = (W - w) / 2, y = 130;
  ctx.globalAlpha = ease(k * 3); ctx.translate(W / 2, y + 26); ctx.scale(0.8 + 0.2 * ease(k * 3), 0.8 + 0.2 * ease(k * 3)); ctx.translate(-W / 2, -(y + 26));
  ctx.fillStyle = color === "orange" ? S.alert : S.accent; rrect(x, y, w, 52, 10); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 18, y + 27);
  ctx.restore();
}

function drawTag(text, lt) {
  if (!text) return;
  const n = Math.floor(lt * 28);
  ctx.save(); ctx.font = `600 20px ${MONO}`; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.textBaseline = "middle";
  ctx.fillRect(28, 700, 3, 26); ctx.fillText(text.slice(0, n).toUpperCase(), 42, 714);
  ctx.restore();
}

function drawCaption(s, t) {
  const ch = s.chunks.find((c) => t >= c[0].t0 - 0.05 && t < c[c.length - 1].t1 + 0.25);
  if (!ch) return;
  ctx.save(); ctx.font = `800 ${S.caption}px ${FONT}`; ctx.textBaseline = "middle";
  const ws = ch.map((x) => ctx.measureText(x.w).width + 24), gap = 10;
  let x = (W - ws.reduce((a, b) => a + b, 0) - gap * (ch.length - 1)) / 2;
  const y = 960;
  ch.forEach((wd, i) => {
    const on = t >= wd.t0 && t < wd.t1 + 0.1;
    ctx.fillStyle = on ? S.accent : "rgba(20,30,60,.55)"; rrect(x, y - 30, ws[i], 60, 10); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(wd.w, x + 12, y + 2); x += ws[i] + gap;
  });
  ctx.restore();
}

function drawTitle(text, lt) {
  ctx.save(); ctx.font = `900 64px ${FONT}`; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, text, W - 120); ctx.globalAlpha = ease(lt * 1.5);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 560 + (i - (lines.length - 1) / 2) * 80 + (1 - ease(lt * 1.5)) * 30));
  ctx.restore();
}

function drawStat(value, lt, dur) {
  const num = parseFloat(String(value).replace(/,/g, "")); if (!isFinite(num)) return;
  const dec = (String(value).split(".")[1] || "").length, v = num * ease(lt / Math.min(2, dur * 0.6));
  ctx.save(); ctx.font = `900 200px ${FONT}`; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = S.accent; ctx.shadowBlur = 40;
  ctx.fillText(v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }), W / 2, 560);
  ctx.restore();
}

function drawStar(lt) {
  const s = 180 * (0.85 + 0.15 * Math.sin(lt * 3)) * ease(lt * 2), cx = W / 2, cy = 600;
  ctx.save(); ctx.fillStyle = S.star; ctx.shadowColor = S.star; ctx.shadowBlur = 50;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2, b = a + Math.PI / 4;
    ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); ctx.lineTo(cx + Math.cos(b) * s * 0.18, cy + Math.sin(b) * s * 0.18);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.shadowColor = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 6 + 3 * Math.sin(lt * 7), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}


const TYPES = {
  title: { label: "제목" }, globe: { label: "지구본·연결선" }, fiber: { label: "광섬유 빛" }, wifi: { label: "공유기·전파" },
  datacenter: { label: "데이터센터 복도" }, ocean: { label: "바닷속 관" }, stat: { label: "큰 숫자", hint: "숫자 (예: 99, 1.4)" }, ending: { label: "마무리 별" },
};
// 복셀 장면 이름은 가까운 클래식 장면으로
const ALIAS = { road: "fiber", walk: "datacenter", rail: "fiber", town: "datacenter", compare: "globe" };

export default {
  id: "classic", name: "클래식", desc: "어두운 바탕 · 지구본·광섬유 같은 매끈한 3D", types: TYPES, options: OPTIONS,
  async prepare() {},
  build(s) { return (SCENES[s.type] || SCENES[ALIAS[s.type]] || SCENES.title)(s); },
  compose(env) {
    ({ ctx } = env); S = { ...defaults(OPTIONS), ...(env.style || {}) };
    const { src, s, t, lt, dur, idx, p } = env;
    ctx.drawImage(src, 0, 0);
    // 화면 위아래를 살짝 어둡게 — 글자가 묻히지 않게
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(0,0,0,.35)"); g.addColorStop(0.2, "rgba(0,0,0,0)"); g.addColorStop(0.7, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (s.type === "title") drawTitle(s.chip || p.title || p.topic, lt);
    else if (s.type === "ending") drawStar(lt);
    else { if (s.type === "stat") drawStat(s.value, lt, dur); drawChip(s.chip, s.chipColor, lt); drawTag(s.tag, lt); }
    drawCaption(s, t);
    if (lt < 0.25 && idx > 0) { ctx.fillStyle = `rgba(0,0,0,${1 - lt / 0.25})`; ctx.fillRect(0, 0, W, H); } // 장면 사이 짧게 어둡게
  },
};
