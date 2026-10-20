/* 손 테니스 — 화면(Three.js), 선수, 경기 진행, 메뉴, 입력(손·마우스·키보드).
   규칙·물리·스윙 판정은 core.js, 소리는 audio.js, 손 인식은 hands.js. */
(function () {
'use strict';

const TC = window.TennisCore, C = TC.C, LEVELS = TC.LEVELS, SFX = window.SFX, Hands = window.Hands;
const $ = id => document.getElementById(id);
const clamp = TC.clamp;
const lerp = (a, b, t) => a + (b - a) * t;
const sgn = v => v < 0 ? -1 : 1;
const rnd = Math.random;
const STEP = 1 / 120;
const QS = new URLSearchParams(location.search);
const LAT = QS.has('lat') ? +QS.get('lat') : 0.07;   // 카메라가 손을 보고 알려 주기까지 걸리는 시간(초)

/* ================================================================ 설정 */
const SET = { hs: 1, sens: 5, bestOf: 3, level: 'normal', machine: 'normal', sound: true, mode: 'match', calA: 0 };
try { Object.assign(SET, JSON.parse(localStorage.getItem('hand-tennis') || '{}')); } catch (_) { /* 저장 못 해도 괜찮다 */ }
function save() { try { localStorage.setItem('hand-tennis', JSON.stringify(SET)); } catch (_) { /* 무시 */ } }

/* ================================================================ Three.js */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
} catch (e) { $('nogl').hidden = false; return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe9f6, 58, 125);
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 240);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
}
const softTex = rgb => canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.4, `rgba(${rgb},.5)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

scene.background = canvasTex(2, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#46a5e6'); gr.addColorStop(0.5, '#9fd5f2'); gr.addColorStop(1, '#e6f5fb');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
scene.add(new THREE.HemisphereLight(0xffffff, 0x9bb59a, 0.88));
const sun = new THREE.DirectionalLight(0xffffff, 0.5); sun.position.set(-8, 18, 10); scene.add(sun);

/* ---- 코트 ---- */
function courtTexture() {
  const PPM = 30, W = 44 * PPM, H = 60 * PPM, X = x => (x + 22) * PPM, Z = z => (z + 30) * PPM;
  const t = canvasTex(W, H, g => {
    g.fillStyle = '#4d9a63'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.035)'; g.fillRect(0, i * H / 40, W, H / 40); }
    g.fillStyle = '#2d6db4'; g.fillRect(X(-9.2), Z(-18.4), 18.4 * PPM, 36.8 * PPM);
    g.fillStyle = '#3b84d2'; g.fillRect(X(-5.485), Z(-11.885), 10.97 * PPM, 23.77 * PPM);
    g.strokeStyle = '#fff'; g.lineWidth = 0.1 * PPM;
    const L = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); };
    for (const s of [-1, 1]) {
      L(-5.485, s * 11.885, 5.485, s * 11.885);           // 베이스라인
      L(s * 5.485, -11.885, s * 5.485, 11.885);           // 복식 사이드라인
      L(s * 4.115, -11.885, s * 4.115, 11.885);           // 단식 사이드라인
      L(-4.115, s * 6.4, 4.115, s * 6.4);                 // 서비스라인
      L(0, s * 11.885, 0, s * 11.5);                      // 센터 마크
    }
    L(0, -6.4, 0, 6.4);                                   // 센터 서비스라인
  });
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 60), new THREE.MeshLambertMaterial({ map: courtTexture() }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x4d9a63 }));
far.rotation.x = -Math.PI / 2; far.position.y = -0.02; scene.add(far);

/* ---- 네트 ---- */
{
  const meshTex = canvasTex(16, 16, g => {
    g.clearRect(0, 0, 16, 16); g.strokeStyle = 'rgba(14,24,36,.8)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, 0.5); g.lineTo(16, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, 16); g.stroke();
  });
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping; meshTex.repeat.set(64, 5); meshTex.magFilter = THREE.NearestFilter;
  const net = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 0.98), new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, 0.5, 0); scene.add(net);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const tape = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.08, 0.03), mat); tape.position.set(0, 0.99, 0); scene.add(tape);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.08, 10), new THREE.MeshLambertMaterial({ color: 0x1b2433 }));
    post.position.set(s * 6.4, 0.54, 0); scene.add(post);
  }
}

/* ---- 관중석·벽 ---- */
{
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x1f6d68 }), standMat = new THREE.MeshLambertMaterial({ color: 0x41546a });
  const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); scene.add(o); return o; };
  box(34, 1.5, 0.4, 0, 0.75, -23.5, wallMat);
  for (const s of [-1, 1]) box(0.4, 1.5, 47, s * 17, 0.75, 0, wallMat);
  const pos = [];
  for (let i = 0; i < 5; i++) {
    box(36, 1.1 + i * 0.85, 1.2, 0, (1.1 + i * 0.85) / 2, -25.4 - i * 1.2, standMat);
    for (let x = -17; x <= 17; x += 0.85) pos.push([x + (rnd() - 0.5) * 0.25, 1.35 + i * 0.85 + 0.55, -25.4 - i * 1.2 + (rnd() - 0.5) * 0.2]);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    box(1.2, 1.1 + i * 0.85, 46, s * (18.2 + i * 1.2), (1.1 + i * 0.85) / 2, 0, standMat);
    for (let z = -22; z <= 22; z += 1.0) pos.push([s * (18.2 + i * 1.2) + (rnd() - 0.5) * 0.2, 1.35 + i * 0.85 + 0.55, z + (rnd() - 0.5) * 0.3]);
  }
  const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 7, 5), new THREE.MeshLambertMaterial({ color: 0xffffff }), pos.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const pal = [0xff6a3d, 0xffc93c, 0x27b5f2, 0xffffff, 0x2fbf86, 0xf08bb5, 0x8e7cf0, 0xf5e3c8];
  pos.forEach((p, i) => { m4.setPosition(p[0], p[1], p[2]); crowd.setMatrixAt(i, m4); crowd.setColorAt(i, col.setHex(pal[(rnd() * pal.length) | 0])); });
  crowd.instanceColor.needsUpdate = true;
  scene.add(crowd);
  window.__crowd = crowd;
  // 심판 의자
  const chair = new THREE.Group();
  const legM = new THREE.MeshLambertMaterial({ color: 0xdfe6ee });
  for (const [x, z] of [[-.3, -.3], [.3, -.3], [-.3, .3], [.3, .3]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(.08, 2.1, .08), legM); l.position.set(x, 1.05, z); chair.add(l); }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(.8, .1, .8), legM); seat.position.y = 2.1; chair.add(seat);
  const ump = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, .6, 12), new THREE.MeshLambertMaterial({ color: 0xffffff })); ump.position.y = 2.5; chair.add(ump);
  const uh = new THREE.Mesh(new THREE.SphereGeometry(.17, 12, 10), new THREE.MeshLambertMaterial({ color: 0xf2c9a2 })); uh.position.y = 2.95; chair.add(uh);
  chair.position.set(-7.4, 0, 0); scene.add(chair);
}

/* ================================================================ 선수 */
function makeAvatar(o) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const M = c => new THREE.MeshLambertMaterial({ color: c });
  const skin = M(o.skin), shirt = M(o.shirt), shorts = M(o.shorts), white = M(0xffffff), hair = M(o.hair), dark = M(0x1b2433), band = M(o.band);
  const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (parent || body).add(m); return m; };
  const legs = [];
  for (const sx of [0.1, -0.1]) {
    const leg = new THREE.Group(); leg.position.set(sx, 0.92, 0); body.add(leg);
    add(new THREE.CylinderGeometry(0.06, 0.05, 0.64, 10), skin, 0, -0.5, 0, leg);
    add(new THREE.CylinderGeometry(0.088, 0.08, 0.36, 12), shorts, 0, -0.16, 0, leg);
    const shoe = add(new THREE.SphereGeometry(0.08, 12, 8), white, 0, -0.84, 0.05, leg); shoe.scale.set(1, 0.6, 1.7);
    legs.push(leg);
  }
  add(new THREE.CylinderGeometry(0.17, 0.2, 0.56, 16), shirt, 0, 1.2, 0);
  add(new THREE.CylinderGeometry(0.205, 0.205, 0.1, 16), shorts, 0, 0.93, 0);
  const head = new THREE.Group(); head.position.y = 1.72; body.add(head);
  add(new THREE.SphereGeometry(0.2, 20, 16), skin, 0, 0, 0, head);
  add(new THREE.SphereGeometry(0.212, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, 0, 0.012, -0.012, head);
  for (const sx of [0.07, -0.07]) add(new THREE.SphereGeometry(0.022, 8, 6), dark, sx, 0.015, 0.185, head);
  add(new THREE.CylinderGeometry(0.214, 0.214, 0.05, 20), band, 0, 0.09, 0, head);
  if (o.visor) add(new THREE.BoxGeometry(0.24, 0.016, 0.15), band, 0, 0.1, 0.22, head);
  const arm = x => {
    const g = new THREE.Group(); g.position.set(x, 1.43, 0); body.add(g);
    add(new THREE.CylinderGeometry(0.05, 0.045, 0.26, 10), shirt, 0, -0.13, 0, g);
    add(new THREE.CylinderGeometry(0.042, 0.038, 0.32, 10), skin, 0, -0.42, 0, g);
    add(new THREE.SphereGeometry(0.052, 10, 8), skin, 0, -0.6, 0, g);
    return g;
  };
  const armL = arm(0.23), armR = arm(-0.23);
  const racket = new THREE.Group(); racket.position.set(0, -0.6, 0); armR.add(racket);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), dark, 0, -0.1, 0, racket);
  const frame = add(new THREE.TorusGeometry(0.155, 0.015, 6, 28), M(o.racket), 0, -0.5, 0, racket); frame.scale.set(0.82, 1.18, 1); frame.rotation.y = Math.PI / 2;
  const strings = add(new THREE.CircleGeometry(0.15, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }), 0, -0.5, 0, racket);
  strings.scale.set(0.82, 1.18, 1); strings.rotation.y = Math.PI / 2;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ map: softTex('10,24,40'), transparent: true, opacity: 0.55, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015; root.add(shadow);
  scene.add(root);
  return {
    root, body, legs, armL, armR, racket, head, x: 0, z: 0, tx: 0, tz: 0, speed: 6, moveAt: 0, vel: 0, cycle: 0, racketSide: 1,
    anim: { swing: -1, kind: 'fh', pow: 0.5, spin: 0, toss: -1, cele: 0, sad: 0 },
  };
}
const P = makeAvatar({ skin: 0xf2c9a2, shirt: 0x27b5f2, shorts: 0x1d3a5c, hair: 0x3a2a1e, band: 0xffffff, racket: 0xff6a3d, visor: true });
const Q = makeAvatar({ skin: 0xe8b98f, shirt: 0xff6a3d, shorts: 0x2a2f3a, hair: 0x1b1b1f, band: 0xffc93c, racket: 0x27b5f2, visor: false });
P.root.rotation.y = Math.PI; Q.racketSide = -1;
const HOME = { P: [0, 12.9], Q: [0, -12.9] };
P.x = P.tx = HOME.P[0]; P.z = P.tz = HOME.P[1]; Q.x = Q.tx = HOME.Q[0]; Q.z = Q.tz = HOME.Q[1];

/* 키프레임(선형 보간) */
function keyf(u, pts) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i], k = (u - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; }
  }
  return pts[pts.length - 1][1];
}
const FH_RY = [[0, -1.5], [0.3, -0.55], [0.5, 0.1], [1, 1.0]];
const FH_RX = [[0, -1.0], [0.3, -1.45], [1, -1.15]];
const SV_RX = [[0, 0.9], [0.22, -2.4], [0.32, -2.95], [1, -0.4]];

function startSwing(av, kind, power, spin) { const a = av.anim; a.swing = 0; a.kind = kind; a.pow = power; a.spin = spin || 0; }

function poseAvatar(av, dt) {
  const a = av.anim, run = clamp(av.vel / 5.5, 0, 1);
  av.cycle += dt * (2 + av.vel * 1.4);
  const sw = Math.sin(av.cycle * 2.0) * 0.85 * run;
  av.legs[0].rotation.x = sw; av.legs[1].rotation.x = -sw;
  let by = Math.abs(Math.cos(av.cycle * 2.0)) * 0.06 * run;
  av.body.rotation.x = 0.1 * run;
  let ry = 0, rx = -0.85 + Math.sin(av.cycle * 0.9) * 0.03, rrx = -0.55, lx = -0.25, lz = 0, hx = 0;
  if (a.swing >= 0) {
    a.swing += dt;
    const t = a.swing, rec = clamp((t - 0.62) / 0.35, 0, 1);
    let sry, srx;
    if (a.kind === 'serve') {
      const u = clamp(0.14 + 0.86 * t / 0.45, 0, 1);
      srx = keyf(u, SV_RX); sry = -0.25 * Math.sin(Math.PI * u); rrx = -0.2;
    } else {
      const u = clamp(0.22 + 0.78 * t / 0.4, 0, 1), s = a.kind === 'fh' ? 1 : -1;
      sry = s * keyf(u, FH_RY);
      srx = keyf(u, FH_RX) - a.spin * 0.45 * Math.sin(Math.PI * u) * (a.kind === 'fh' ? 1 : 0.8);
      rrx = -0.25; lz = -0.9 * (1 - u) * (a.kind === 'bh' ? -1 : 1) * 0.5;
    }
    ry = lerp(sry, ry, rec); rx = lerp(srx, rx, rec); rrx = lerp(rrx, -0.55, rec);
    if (t > 1.0) a.swing = -1;
  }
  if (a.toss >= 0) {
    a.toss += dt;
    lx = lerp(-2.95, -0.25, clamp((a.toss - 0.95) / 0.3, 0, 1));
    if (a.toss > 1.3) a.toss = -1;
  }
  if (a.cele > 0) {
    a.cele -= dt;
    const j = Math.abs(Math.sin((1.4 - a.cele) * 7)); by += j * 0.28;
    rx = -2.7; lx = -2.7; ry = 0; lz = 0.35;
  }
  if (a.sad > 0) { a.sad -= dt; hx = 0.45; rx = -0.1; lx = -0.05; }
  av.armR.rotation.set(rx, ry, 0, 'YXZ');
  av.armL.rotation.set(lx, 0, lz, 'YXZ');
  av.racket.rotation.x = rrx;
  av.head.rotation.x = hx;
  av.body.rotation.y = 0.26 * ry;
  av.body.position.y = by;
}

function moveAv(av, dt) {
  let step = 0;
  if (S.simT >= av.moveAt) {
    const dx = av.tx - av.x, dz = av.tz - av.z, d = Math.hypot(dx, dz);
    if (d > 0.005) { step = Math.min(d, av.speed * dt); av.x += dx / d * step; av.z += dz / d * step; }
  }
  av.vel = lerp(av.vel, step / dt, 0.1);
}

/* ================================================================ 공·그림자·꼬리·알갱이 */
const ballTex = canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = '#d8f23a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.arc(w * 0.25, h * 0.5, h * 0.62, -1.0, 1.0); g.stroke();
  g.beginPath(); g.arc(w * 0.75, h * 0.5, h * 0.62, Math.PI - 1.0, Math.PI + 1.0); g.stroke();
});
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R, 18, 14), new THREE.MeshLambertMaterial({ map: ballTex, emissive: 0x33430a }));
ballMesh.visible = false; scene.add(ballMesh);
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex('232,255,90'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55, fog: false }));
halo.visible = false; scene.add(halo);
const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ map: softTex('10,24,40'), transparent: true, opacity: 0.7, depthWrite: false }));
ballShadow.rotation.x = -Math.PI / 2; ballShadow.visible = false; scene.add(ballShadow);

const TRAIL_N = 16, trailPos = new Float32Array(TRAIL_N * 3), trailCol = new Float32Array(TRAIL_N * 3), trailPts = [];
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 0.3, map: softTex('255,255,255'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
trail.frustumCulled = false; scene.add(trail);

const PN = 220, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pTint = new Float32Array(PN * 3);
for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -50;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.16, map: softTex('255,255,255'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
parts.frustumCulled = false; scene.add(parts);
let pCursor = 0;
function emit(x, y, z, n, spd, tint, life, up) {
  for (let k = 0; k < n; k++) {
    const i = pCursor; pCursor = (pCursor + 1) % PN;
    const a = rnd() * 6.283, s = spd * (0.4 + rnd() * 0.8);
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = Math.cos(a) * s; pVel[i * 3 + 1] = (up || 1) * (0.3 + rnd()) * spd * 0.8; pVel[i * 3 + 2] = Math.sin(a) * s;
    pLife[i] = life * (0.6 + rnd() * 0.6);
    pTint[i * 3] = tint[0]; pTint[i * 3 + 1] = tint[1]; pTint[i * 3 + 2] = tint[2];
  }
}
function updateParts(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
    pLife[i] -= dt;
    pVel[i * 3 + 1] -= 7 * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.02) { pPos[i * 3 + 1] = 0.02; pVel[i * 3 + 1] *= -0.3; }
    const f = clamp(pLife[i] * 2.2, 0, 1);
    pCol[i * 3] = pTint[i * 3] * f; pCol[i * 3 + 1] = pTint[i * 3 + 1] * f; pCol[i * 3 + 2] = pTint[i * 3 + 2] * f;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
const dust = (x, z) => emit(x, 0.04, z, 7, 1.2, [0.9, 0.88, 0.8], 0.5, 0.6);
const sparks = (x, y, z, k) => emit(x, y, z, 6 + Math.round(10 * k), 3 + 3 * k, [1, 0.9, 0.35], 0.45, 1);

/* ================================================================ 상태 */
const S = {
  phase: 'title', mode: 'match', paused: false, simT: 0, acc: 0,
  ball: TC.makeBall(0, 1, 0), ballVis: false, held: false, visOff: new THREE.Vector3(),
  score: null, judge: new TC.Judge(), server: 0, faults: 0, boxSign: 1, lvl: LEVELS.normal,
  plan: [null, null], rally: 0, next: '', nextAt: 0, tossT: 0, waitT: 0, cpuTossAt: 0, cpuServeAt: 0, machineAt: 0,
  stats: { maxKmh: 0, longest: 0, aces: 0 }, streak: 0, best: 0, pointLog: [],
  cam: { on: false }, sd: new TC.SwingDetector(), msd: new TC.SwingDetector({ thr: 14 }), hand: null,
  shake: 0, cheer: 0, camT: 0, said: 0,
  now() { return this.simT + this.acc; },
};

/* ================================================================ HUD */
let bannerTimer = 0, speedTimer = 0, timingTimer = 0;
function say(big, sub, kind, ms) {
  const b = $('banner');
  $('bnBig').textContent = big; $('bnSub').textContent = sub || '';
  b.className = ''; void b.offsetWidth; b.className = 'show ' + (kind || '');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.className = ''; }, ms || 1800);
}
function setHint(t) { $('hint').textContent = t || ''; }
function showSpeed(kmh) {
  $('spdVal').textContent = kmh; $('speed').classList.add('on');
  clearTimeout(speedTimer); speedTimer = setTimeout(() => $('speed').classList.remove('on'), 2200);
}
function showTiming(label) {
  const el = $('timing'), t = { perfect: '완벽!', early: '빨랐어요', late: '늦었어요' }[label];
  if (!t) return;
  el.textContent = t; el.className = 'on ' + label;
  clearTimeout(timingTimer); timingTimer = setTimeout(() => { el.className = ''; }, 900);
}
function hudScore() {
  const sc = S.score; if (!sc) return;
  $('gY').textContent = sc.games[0]; $('gC').textContent = sc.games[1];
  $('pY').textContent = sc.label(0); $('pC').textContent = sc.label(1);
  $('srvY').style.visibility = sc.server === 0 ? 'visible' : 'hidden'; $('srvC').style.visibility = sc.server === 1 ? 'visible' : 'hidden';
  $('bdSet').textContent = sc.need + '게임 선취';
}
function hudPractice() { $('pbStreak').textContent = S.streak; $('pbBest').textContent = S.best; }

/* ================================================================ 경기 진행 */
const EV = [];

function beginPoint() { S.faults = 0; beginServe(); }

function beginServe() {
  const sc = S.score, srv = sc.server, cs = sc.courtSign();
  S.server = srv;
  const sx = (srv === 0 ? 1 : -1) * cs * 1.6;
  S.boxSign = -sgn(sx);
  const sv = srv === 0 ? P : Q, rc = srv === 0 ? Q : P;
  sv.tx = sx; sv.tz = (srv === 0 ? 1 : -1) * (C.HALF_L + 0.8); sv.speed = 6; sv.moveAt = S.simT;
  rc.tx = S.boxSign * 1.8; rc.tz = (srv === 0 ? -1 : 1) * (C.HALF_L + 1.3); rc.speed = 6; rc.moveAt = S.simT;
  S.judge.reset(); S.plan = [null, null]; S.rally = 0;
  S.phase = 'serveWait'; S.waitT = S.simT; S.held = true; S.ballVis = true;
  Object.assign(S.ball, { vx: 0, vy: 0, vz: 0, spin: 0, netHit: false, rolling: false });
  S.visOff.set(0, 0, 0);
  if (srv === 1) { S.cpuTossAt = S.simT + 1.3 + rnd() * 0.7; setHint('상대 서브예요. 받을 준비!'); }
  else setHint(S.cam.on ? (S.faults ? '두 번째 서브! 손을 위로 휙 → 내려치기' : '손을 위로 휙 들어 토스 → 공이 내려올 때 내려치기') : '스페이스: 토스 → 한 번 더: 서브');
}

function heldPos(by) {
  const av = by === 0 ? P : Q;
  return [av.x - av.racketSide * 0.3, 1.0, av.z + (by === 0 ? -0.3 : 0.3)];
}

function toss(by) {
  if (S.phase !== 'serveWait' || S.server !== by) return;
  const av = by === 0 ? P : Q, b = S.ball, hp = heldPos(by);
  b.x = hp[0]; b.y = 1.3; b.z = hp[2]; b.vx = 0; b.vy = C.TOSS_VY; b.vz = 0; b.spin = 0; b.netHit = false; b.rolling = false;
  S.held = false; S.phase = 'toss'; S.tossT = S.simT; av.anim.toss = 0;
  SFX.whoosh(0.2); setHint('');
  if (by === 1) S.cpuServeAt = S.simT + C.TOSS_IDEAL + TC.gauss(rnd) * S.lvl.tErr + (rnd() < S.lvl.fault ? (rnd() < 0.5 ? -1 : 1) * 0.3 : 0);
  else setHint(S.cam.on ? '공이 내려올 때 휘둘러요!' : '지금 스페이스!');
}

function serveFire(by, tau, power) {
  const b = S.ball, p = clamp(power * (S.faults > 0 ? 0.72 : 1), 0, 1);
  const from = { x: b.x, y: clamp(b.y, 1.7, 3.0), z: b.z };
  const plan = TC.planServe({ from, power: p, timing: tau, boxSign: S.boxSign, facing: by === 0 ? -1 : 1, rnd });
  S.judge.serveHit(by, S.boxSign);
  S.phase = 'rally';
  if (by === 1) startSwing(Q, 'serve', p, 0);
  launch(by, plan, from, true);
  if (by === 0) showTiming(plan.label);
  setHint('');
}

/* 공을 친다: 공의 속도·스핀을 정하고 효과를 내고, 받는 사람의 타점을 계산한다 */
function launch(by, plan, from, isServe) {
  const b = S.ball;
  S.visOff.set(b.x - from.x, b.y - from.y, b.z - from.z);
  b.x = from.x; b.y = from.y; b.z = from.z;
  b.vx = plan.v.vx; b.vy = plan.v.vy; b.vz = plan.v.vz; b.spin = plan.spin; b.netHit = false; b.rolling = false;
  S.held = false; S.ballVis = true;
  if (!isServe) S.judge.hit(by);
  S.rally++;
  SFX.hit(plan.power != null ? plan.power : 0.5);
  sparks(from.x, from.y, from.z, plan.power || 0.4);
  if (plan.power > 0.7) S.shake = Math.max(S.shake, 0.06);
  if (by === 0) { S.stats.maxKmh = Math.max(S.stats.maxKmh, plan.kmh); showSpeed(plan.kmh); }
  else if (S.mode === 'match') showSpeed(plan.kmh);
  planContact(1 - by);
}

/* 받는 쪽이 공을 칠 자리와 시각을 미리 계산해서 그쪽으로 뛰게 한다 */
function planContact(recv) {
  S.plan[recv] = null;
  const av = recv === 0 ? P : Q, side = recv === 0 ? 1 : -1;
  const c = TC.findContact(S.ball, side);
  if (!c || c.out) return;
  const ballSide = sgn(c.x - av.x);
  const standX = clamp(c.x - ballSide * 0.75, -7.2, 7.2);
  const standZ = side * clamp(side * c.z + 0.9, 9.4, 15.2);
  S.plan[recv] = { c, absT: S.simT + c.t, ballSide, standX, standZ };
  av.tx = standX; av.tz = standZ;
  av.moveAt = recv === 0 ? S.simT : S.simT + S.lvl.react;
  av.speed = recv === 0 ? (S.mode === 'practice' && LEVELS[SET.machine].pspd) || 7.6 : S.lvl.speed;
}

function cpuSwing() {
  const pl = S.plan[1]; S.plan[1] = null;
  const b = S.ball, L = S.lvl;
  startSwing(Q, pl.ballSide === Q.racketSide ? 'fh' : 'bh', 0.6, 0);
  if (Math.abs(Q.x - pl.standX) > L.reach || pl.c.y > 2.3) { SFX.whoosh(0.5); return; }
  const from = { x: b.x, y: clamp(b.y, 0.45, 2.2), z: b.z };
  const plan = TC.planAiShot({ lvl: L, oppX: P.x, from, facing: 1, rnd });
  S.visOff.set(0, 0, 0);
  launch(1, plan, from);
}

function humanSwing(ev, tClock) {
  const pl = S.plan[0], power = clamp(ev.power, 0, 1);
  const live = S.phase === 'rally' && pl && S.judge.hitter === 1;
  startSwing(P, pl ? (pl.ballSide === P.racketSide ? 'fh' : 'bh') : 'fh', power, ev.spin);
  SFX.whoosh(power);
  if (!live) return;
  const tau = tClock - pl.absT;
  S.lastTau = tau;
  if (tau < -0.30) return;                                // 너무 일러서 헛스윙 — 공은 아직 기회가 있다
  if (tau > 0.26) { showTiming('late'); return; }
  if (Math.abs(P.x - pl.standX) > 1.7 || pl.c.y > 2.4) { say('닿지 않았어요', '', 'bad', 900); return; }
  S.plan[0] = null;
  const cp = new THREE.Vector3(pl.c.x, clamp(pl.c.y, 0.5, 2.1), pl.c.z), bp = new THREE.Vector3(S.ball.x, S.ball.y, S.ball.z);
  const d = bp.distanceTo(cp);
  const f = d <= 1.3 ? bp : cp.clone().lerp(bp, 1.3 / d);
  const from = { x: f.x, y: clamp(f.y, 0.4, 2.3), z: Math.min(f.z, 14.6) };
  const plan = TC.planSwingShot({ from, power, spin: ev.spin, timing: tau, side: pl.ballSide, facing: -1, rnd });
  launch(0, plan, from);
  showTiming(plan.label);
  if (plan.label === 'perfect') SFX.ding();
}

function humanServeSwing(ev, tClock) {
  const tau = tClock - (S.tossT + C.TOSS_IDEAL), power = 0.25 + 0.75 * clamp(ev.power, 0, 1);
  startSwing(P, 'serve', power, 0); SFX.whoosh(power);
  if (tau < -0.34 || tau > 0.30 || S.ball.y < 1.2) return;
  serveFire(0, tau, power);
  if (tau > -0.06 && tau < 0.06) SFX.ding();
}

function serveFault(why) {
  if (S.phase === 'pointEnd') return;
  S.faults++; S.plan = [null, null];
  if (S.faults >= 2) { endPoint(1 - S.server, 'double'); return; }
  S.phase = 'pointEnd'; S.next = 'reserve'; S.nextAt = S.simT + 1.6;
  say('폴트', why === 'miss' ? '토스한 공을 놓쳤어요' : why === 'net' ? '네트에 걸렸어요' : '서비스 박스 밖이에요', 'bad', 1500); SFX.fault(); setHint('');
}

function onJudge(res) {
  if (!res) return;
  if (res.kind === 'in') {
    if (S.mode === 'practice' && S.judge.hitter === 0 && res.side === 1) practiceDone(true, '');
    return;
  }
  if (res.kind === 'fault') { serveFault(res.reason); return; }
  if (res.kind === 'point') {
    if (S.mode === 'practice') { if (res.winner === 1) practiceDone(false, res.reason); return; }
    endPoint(res.winner, res.reason);
  }
}

function stepBallWorld() {
  EV.length = 0;
  TC.stepBall(S.ball, STEP, EV);
  for (const e of EV) {
    if (e.type === 'bounce') { SFX.bounce(e.vy); dust(e.x, e.z); }
    else if (e.type === 'net') SFX.net();
    else if (e.type === 'cord') SFX.cord();
    if (S.phase !== 'rally') continue;
    if (e.type === 'net') S.judge.net();
    else if (e.type === 'bounce') onJudge(S.judge.bounce(e.x, e.z, false));
    else if (e.type === 'roll') onJudge(S.judge.bounce(e.x, e.z, true));
  }
}

const REASON = { out: '아웃!', net: '네트!', ace: '에이스!', double: '더블 폴트', short: '아웃!' };
function endPoint(winner, reason) {
  if (S.phase === 'pointEnd') return;
  S.phase = 'pointEnd'; S.plan = [null, null]; S.faults = 0; setHint('');
  S.stats.longest = Math.max(S.stats.longest, S.rally);
  if (reason === 'ace' && winner === 0) S.stats.aces++;
  S.pointLog.push({ winner, reason, rally: S.rally });
  const sc = S.score, r = sc.point(winner);
  hudScore();
  const text = reason === 'winner' ? (winner === 0 ? '포인트!' : '놓쳤어요') : (REASON[reason] || '포인트');
  const call = sc.call(['나', 'CPU']);
  const who = winner === 0 ? '내 포인트' : 'CPU 포인트';
  const av = winner === 0 ? P : Q, lo = winner === 0 ? Q : P;
  av.anim.cele = 1.3; lo.anim.sad = 1.6;
  SFX.cheer(winner === 0 ? 0.9 : 0.4); S.cheer = 1;
  if (winner === 1) SFX.groan();
  if (r.type === 'match') {
    S.next = 'result'; S.nextAt = S.simT + 2.4;
    say(winner === 0 ? '경기 승리!' : '경기 종료', sc.games[0] + ' : ' + sc.games[1], winner === 0 ? 'good' : 'bad', 2400);
  } else if (r.type === 'game') {
    S.next = 'point'; S.nextAt = S.simT + 3;
    say('게임!', (winner === 0 ? '내가' : 'CPU가') + ' 따냈어요 · ' + sc.games[0] + ' : ' + sc.games[1], winner === 0 ? 'good' : 'bad', 2800);
  } else {
    S.next = 'point'; S.nextAt = S.simT + 2.3;
    say(text, who + (call ? ' · ' + call : ''), winner === 0 ? 'good' : 'bad', 2200);
  }
}

function afterPoint() {
  if (S.next === 'reserve') beginServe();
  else if (S.next === 'point') beginPoint();
  else if (S.next === 'feed') { S.phase = 'machineWait'; S.machineAt = S.simT + 0.2; S.ballVis = false; P.tx = HOME.P[0]; P.tz = HOME.P[1]; P.moveAt = S.simT; P.speed = 4; setHint('다음 공이 와요'); }
  else if (S.next === 'result') showResult();
}

/* ---- 연습 ---- */
function startPractice() {
  S.mode = 'practice'; S.streak = 0; S.best = 0; S.rally = 0;
  S.phase = 'machineWait'; S.machineAt = S.simT + 1.2; S.ballVis = false; S.plan = [null, null];
  $('board').hidden = true; $('pboard').hidden = false; hudPractice();
  setHint(S.cam.on ? '공이 오면 팔을 휘둘러요. 위로 쳐올리면 탑스핀!' : '공이 오면 스페이스! (↑ 누르고 치면 탑스핀)');
}
function feedBall() {
  const L = Object.assign({}, LEVELS[SET.machine], { miss: 0 });
  let plan = null, from = null;
  for (let i = 0; i < 12; i++) {
    from = { x: (rnd() - 0.5) * 5, y: L.fromY || 1.0, z: -12.4 };
    plan = TC.planAiShot({ lvl: L, oppX: P.x, from, facing: 1, rnd });
    const b = TC.makeBall(from.x, from.y, from.z); b.vx = plan.v.vx; b.vy = plan.v.vy; b.vz = plan.v.vz; b.spin = plan.spin;
    const c = TC.findContact(b, 1);
    if (c && !c.out && c.y < 2.0) break;
  }
  Q.x = Q.tx = from.x; Q.z = Q.tz = HOME.Q[1];
  startSwing(Q, L.fromY > 1.5 ? 'serve' : 'fh', 0.6, 0);
  Object.assign(S.ball, { x: from.x, y: from.y, z: from.z, vx: 0, vy: 0, vz: 0 });
  S.visOff.set(0, 0, 0); S.rally = 0;
  S.judge.reset(); S.phase = 'rally';
  launch(1, plan, from);
  setHint('');
}
function practiceDone(ok, reason) {
  if (S.phase === 'pointEnd') return;
  S.phase = 'pointEnd'; S.plan = [null, null]; S.next = 'feed'; S.nextAt = S.simT + 1.5;
  if (ok) {
    S.streak++; S.best = Math.max(S.best, S.streak); hudPractice();
    say(S.streak >= 2 ? S.streak + '연속!' : '좋아요!', '', 'good', 1100); SFX.cheer(0.5);
  } else {
    const t = reason === 'net' ? '네트!' : reason === 'out' ? '아웃!' : '놓쳤어요';
    if (S.streak >= 3) SFX.groan();
    S.streak = 0; hudPractice(); say(t, '', 'bad', 1100);
  }
}

/* ================================================================ 시간 진행 */
function stepWorld() {
  S.simT += STEP;
  moveAv(P, STEP); moveAv(Q, STEP);
  const ph = S.phase;
  if (ph === 'serveWait') {
    const hp = heldPos(S.server), b = S.ball;
    b.x = hp[0]; b.y = hp[1]; b.z = hp[2];
    if (S.server === 1 && S.simT >= S.cpuTossAt && Math.hypot(Q.tx - Q.x, Q.tz - Q.z) < 0.15) toss(1);
  } else if (ph === 'toss') {
    stepBallWorld();
    if (S.server === 1 && S.simT >= S.cpuServeAt) serveFire(1, S.simT - (S.tossT + C.TOSS_IDEAL), clamp(S.lvl.serveP * (0.75 + 0.25 * rnd()), 0.1, 1));
    else if (S.ball.y < 0.9 && S.ball.vy < 0) serveFault('miss');
  } else if (ph === 'rally') {
    stepBallWorld();
    if (S.phase === 'rally' && S.plan[1] && S.simT >= S.plan[1].absT) cpuSwing();
    if (S.plan[0] && S.simT > S.plan[0].absT + 0.45) S.plan[0] = null;
  } else if (ph === 'pointEnd') {
    if (S.ballVis) stepBallWorld();
    if (S.simT >= S.nextAt) afterPoint();
  } else if (ph === 'machineWait') {
    if (S.simT >= S.machineAt) feedBall();
  }
  if (S.cheer > 0) S.cheer = Math.max(0, S.cheer - STEP * 0.5);
}

/* ================================================================ 입력 */
function onSwing(ev, src) {
  if (S.paused) return;
  const nowSec = performance.now() / 1000;
  const age = src === 'key' ? 0 : Math.max(0, nowSec - ev.t);
  const tClock = S.now() - age - (src === 'hand' ? LAT : 0);
  if (src === 'hand') flashMeter(ev.power);
  switch (S.phase) {
    case 'calib': calibSwing(ev); break;
    case 'serveWait':
      if (S.server === 0 && S.simT - S.waitT > 0.8) toss(0);
      else startSwing(P, 'fh', ev.power, 0);
      break;
    case 'toss':
      if (S.server === 0) { if (S.simT - S.tossT > 0.3) humanServeSwing(ev, tClock); }
      break;
    case 'rally': humanSwing(ev, tClock); break;
    case 'pointEnd': case 'machineWait': startSwing(P, 'fh', ev.power, ev.spin); SFX.whoosh(ev.power); break;
    default: break;
  }
}

function inGame() { return ['serveWait', 'toss', 'rally', 'pointEnd', 'machineWait'].includes(S.phase); }

function applySens() {
  const f = Math.pow(1.4, (5 - SET.sens) / 2);
  const A = SET.calA || 0;
  const thr = A ? clamp(0.5 * A, 9, 24) : 15, range = A ? Math.max(10, 0.9 * A) : 27;
  S.sd.thr = thr * f; S.sd.range = range * f;
  S.msd.thr = 14 * f; S.msd.range = 26 * f;
}

const keys = { up: false, down: false };
addEventListener('keydown', e => {
  if (e.code === 'ArrowUp') keys.up = true;
  if (e.code === 'ArrowDown') keys.down = true;
  if (e.repeat) return;
  if (e.code === 'Escape') { if (inGame() || S.paused) setPaused(!S.paused); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if ((e.code === 'Space' || e.code === 'Enter') && inGame() && !S.paused) {
    e.preventDefault();
    onSwing({ t: performance.now() / 1000, speed: 30, power: 0.7, spin: keys.up ? 1 : keys.down ? -1 : 0, dir: 1 }, 'key');
  }
});
addEventListener('keyup', e => { if (e.code === 'ArrowUp') keys.up = false; if (e.code === 'ArrowDown') keys.down = false; });
addEventListener('pointermove', e => {
  if (S.cam.on || !inGame() || e.pointerType === 'touch') return;
  const ev = S.msd.feed(performance.now() / 1000, e.clientX / innerHeight, e.clientY / innerHeight, 0.08);
  if (ev) onSwing(ev, 'mouse');
});

/* ---- 손 ---- */
const camMark = $('camMark'), cmx = camMark.getContext('2d');
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
let flashUntil = 0, meterT = 0;
function drawMark(s) {
  const w = camMark.width, h = camMark.height, hot = performance.now() < flashUntil;
  cmx.clearRect(0, 0, w, h);
  if (!s) return;
  const lm = s.lm;
  cmx.strokeStyle = hot ? '#ffc93c' : '#ffffff'; cmx.lineWidth = 3; cmx.beginPath();
  for (const [a, b] of BONES) { cmx.moveTo(lm[a].x * w, lm[a].y * h); cmx.lineTo(lm[b].x * w, lm[b].y * h); }
  cmx.stroke();
  cmx.fillStyle = hot ? '#ffc93c' : '#27b5f2';
  for (const q of lm) { cmx.beginPath(); cmx.arc(q.x * w, q.y * h, 3.4, 0, 7); cmx.fill(); }
}
function flashMeter(p) { flashUntil = performance.now() + 260; $('camPow').style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; meterT = performance.now() + 450; }
function camSay(t) { $('camMsg').textContent = t; }

function onHand(s, t) {
  S.hand = s;
  if (s) {
    drawMark(s);
    const ev = S.sd.feed(t, s.x, s.y, s.size);
    if (ev) onSwing(ev, 'hand');
    if (S.phase === 'serveWait' && S.server === 0 && S.simT - S.waitT > 0.8 && S.sd.rising()) toss(0);
    if (performance.now() > meterT) $('camPow').style.width = Math.round(clamp(S.sd.sp / (S.sd.thr + S.sd.range), 0, 1) * 100) + '%';
    camSay(S.phase === 'calib' ? '' : '손 인식 중 ' + Math.round(Hands.fps) + 'fps');
    uiCursor(s, t);
  } else {
    const ev = S.sd.lost(t); if (ev) onSwing(ev, 'hand');
    drawMark(null); $('camPow').style.width = '0%';
    camSay('손이 안 보여요 ✋');
    hideCursor();
  }
  if (S.phase === 'calib') calibHand(!!s);
}

/* ---- 손 커서: 버튼 위에 0.9초 머물면 눌린다 ---- */
const cur = { x: innerWidth / 2, y: innerHeight / 2, el: null, t0: 0, fired: false, hov: null };
function uiOpen() { return !!document.querySelector('.screen:not([hidden])'); }
function hideCursor() { $('cursor').style.display = 'none'; if (cur.hov) { cur.hov.classList.remove('hover'); cur.hov = null; } cur.el = null; }
function uiCursor(s, t) {
  const c = $('cursor');
  if (!uiOpen()) { hideCursor(); return; }
  const tx = clamp((s.nx - 0.12) / 0.76, 0, 1) * innerWidth, ty = clamp((s.ny - 0.10) / 0.8, 0, 1) * innerHeight;
  cur.x = lerp(cur.x, tx, 0.35); cur.y = lerp(cur.y, ty, 0.35);
  c.style.display = 'block'; c.style.left = cur.x + 'px'; c.style.top = cur.y + 'px';
  const el = document.elementFromPoint(cur.x, cur.y), b = el && el.closest ? el.closest('button') : null;
  if (cur.hov && cur.hov !== b) { cur.hov.classList.remove('hover'); cur.hov = null; }
  if (b && !b.disabled) {
    if (cur.hov !== b) { b.classList.add('hover'); cur.hov = b; }
    if (b !== cur.el) { cur.el = b; cur.t0 = t; cur.fired = false; }
    const p = clamp((t - cur.t0) / 0.9, 0, 1);
    c.style.setProperty('--p', p);
    if (p >= 1 && !cur.fired) { cur.fired = true; SFX.unlock(); b.click(); }
  } else { cur.el = null; c.style.setProperty('--p', 0); }
}

/* ================================================================ 화면 전환 */
const SCREENS = ['title', 'calib', 'menu', 'pause', 'result'];
function showScreen(name) { for (const n of SCREENS) $('scr-' + n).hidden = n !== name; if (!name) hideCursor(); }

function placeCamBox(inSlot) {
  const box = $('camBox');
  if (inSlot) { $('camSlot').appendChild(box); box.classList.add('in-slot'); }
  else { document.body.appendChild(box); box.classList.remove('in-slot'); }
  if (S.cam.on) { box.hidden = false; $('camVideo').play().catch(() => {}); }
}

/* picked: 카메라 고르기 버튼에서 넘어온 deviceId. 없으면 지난번에 쓴 카메라, 그것도 없으면 기본 카메라 */
async function startCamera(picked) {
  const btn = $('btnCam'), err = $('titleErr'), explicit = typeof picked === 'string';
  const saved = explicit ? picked : (SET.camId || '');
  err.hidden = true; btn.disabled = true; btn.textContent = '카메라 연결 중… 처음엔 몇 초 걸려요';
  SFX.unlock();
  try {
    $('camBox').hidden = false;
    try { await Hands.start($('camVideo'), onHand, saved || undefined); }
    catch (e) {
      // 지난번 카메라가 없어졌거나 안 열리면 기본 카메라로 한 번 더
      if (saved && !explicit && e.name !== 'NotAllowedError' && e.name !== 'SecurityError') { SET.camId = ''; await Hands.start($('camVideo'), onHand); }
      else throw e;
    }
    SET.camId = Hands.deviceId || ''; save();
    S.cam.on = true;
    applySens();
    goCalib();
  } catch (e) {
    $('camBox').hidden = true; S.cam.on = false;
    await showCamError(e);
  }
  btn.disabled = false; btn.textContent = '📷 카메라 켜고 시작';
}
async function showCamError(e) {
  const err = $('titleErr'), n = (e && e.name) || '';
  const busy = n === 'NotReadableError' || n === 'AbortError' || n === 'OverconstrainedError';
  err.textContent = !window.isSecureContext ? '카메라는 https 주소나 localhost에서만 쓸 수 있어요. 시작.bat으로 열거나 GitHub Pages 주소로 들어와 주세요.'
    : (n === 'NotAllowedError' || n === 'SecurityError') ? '카메라 권한이 막혀 있어요. 주소창 왼쪽 자물쇠 → 카메라를 "허용"으로 바꾸고 다시 눌러 주세요.'
    : n === 'NotFoundError' ? '카메라를 찾지 못했어요. 연결을 확인해 주세요.'
    : busy ? '카메라가 열리지 않아요. 줌·팀즈·카메라 앱이나 카메라를 쓰는 다른 탭을 닫고 다시 눌러 보세요. 그래도 안 되면 아래에서 카메라를 직접 골라 보세요.'
    : '손 인식을 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (마우스·키보드로는 바로 해볼 수 있어요)';
  if (n) { const s = document.createElement('small'); s.className = 'tech'; s.textContent = ' (' + n + ')'; err.appendChild(s); }
  if (busy) {
    const cams = await Hands.cameras();
    if (cams.length) {
      const box = document.createElement('div'); box.className = 'cams';
      for (const c of cams) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = '📷 ' + c.label;
        b.addEventListener('click', () => startCamera(c.id));
        box.appendChild(b);
      }
      err.appendChild(box);
    }
  }
  err.hidden = false;
}

/* ---- 손 맞추기 ---- */
const calib = { n: 0, speeds: [], seen: false, lastSwing: 0 };
function goCalib() {
  S.phase = 'calib'; calib.n = 0; calib.speeds = []; calib.lastSwing = performance.now();
  S.sd.thr = 15; S.sd.range = 27; S.sd.reset();
  showScreen('calib'); placeCamBox(true);
  [...$('calDots').children].forEach(d => d.classList.remove('on'));
  $('btnCalNext').disabled = true; $('calMsg').textContent = '손바닥을 카메라에 보여 주세요';
}
function calibHand(seen) {
  if (!seen) { $('calMsg').textContent = '손바닥을 카메라에 보여 주세요'; return; }
  if (calib.n < 3) {
    $('calMsg').textContent = calib.n ? '좋아요! 한 번 더' : '좋아요! 이제 팔을 크게 휘둘러 보세요';
    // 한참 못 잡으면 기준을 낮춰 준다
    if (performance.now() - calib.lastSwing > 6000 && S.sd.thr > 7) { S.sd.thr = Math.max(7, S.sd.thr * 0.8); calib.lastSwing = performance.now(); }
  }
}
function calibSwing(ev) {
  if (calib.n >= 3) return;
  calib.speeds.push(ev.speed); calib.n++; calib.lastSwing = performance.now();
  [...$('calDots').children].forEach((d, i) => d.classList.toggle('on', i < calib.n));
  SFX.hit(0.6);
  if (calib.n >= 3) {
    const A = calib.speeds.reduce((a, b) => a + b, 0) / 3;
    SET.calA = clamp(A, 16, 90); save(); applySens();
    $('calMsg').textContent = '완료! 이제 시작해 볼까요?'; $('btnCalNext').disabled = false;
    SFX.cheer(0.4);
  }
}
function leaveCalib() { placeCamBox(false); goMenu(); }

/* ---- 메뉴 ---- */
function goMenu() {
  S.phase = 'menu'; S.paused = false; S.ballVis = false; S.held = false;
  $('hud').hidden = true; setHint('');
  if (S.cam.on) $('camBox').hidden = false;
  P.x = P.tx = HOME.P[0]; P.z = P.tz = HOME.P[1]; Q.x = Q.tx = HOME.Q[0]; Q.z = Q.tz = HOME.Q[1];
  refreshMenu(); showScreen('menu');
}
function refreshMenu() {
  document.querySelectorAll('.pills').forEach(g => {
    const k = g.dataset.key;
    g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(String(SET[k]) === b.dataset.val)));
  });
  $('itMatch').setAttribute('aria-pressed', String(SET.mode === 'match'));
  $('itPractice').setAttribute('aria-pressed', String(SET.mode === 'practice'));
  $('dMatch').hidden = SET.mode !== 'match'; $('dPractice').hidden = SET.mode !== 'practice';
  $('sensVal').textContent = SET.sens;
  $('swSound').setAttribute('aria-checked', String(SET.sound));
  $('btnRecal').hidden = !S.cam.on;
  $('menuHowto').textContent = S.cam.on
    ? '공이 오면 팔을 휘둘러요. 일찍 치면 한쪽, 늦게 치면 반대쪽으로 가요. 세게 휘두를수록 빠르고, 위로 쳐올리면 탑스핀, 아래로 깎으면 슬라이스예요. 버튼은 손을 0.9초 올려 두면 눌려요.'
    : '스페이스(또는 마우스를 휙 휘두르기)로 쳐요. ↑를 누르고 치면 탑스핀, ↓는 슬라이스. 서브는 스페이스로 토스 → 한 번 더 스페이스.';
  save();
}
document.querySelectorAll('.pills').forEach(g => g.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = g.dataset.key, v = b.dataset.val;
  SET[k] = (k === 'bestOf' || k === 'hs') ? +v : v;
  SFX.blip(); refreshMenu();
}));
$('itMatch').addEventListener('click', () => { SET.mode = 'match'; SFX.blip(); refreshMenu(); });
$('itPractice').addEventListener('click', () => { SET.mode = 'practice'; SFX.blip(); refreshMenu(); });
$('sensDown').addEventListener('click', () => { SET.sens = clamp(SET.sens - 1, 1, 9); applySens(); SFX.blip(); refreshMenu(); });
$('sensUp').addEventListener('click', () => { SET.sens = clamp(SET.sens + 1, 1, 9); applySens(); SFX.blip(); refreshMenu(); });
$('swSound').addEventListener('click', () => { SET.sound = !SET.sound; SFX.setMuted(!SET.sound); syncMute(); refreshMenu(); SFX.blip(); });
$('btnRecal').addEventListener('click', () => { SFX.unlock(); goCalib(); });
function toggleMute() { SET.sound = !SET.sound; SFX.setMuted(!SET.sound); syncMute(); save(); }
function syncMute() { $('btnMute').setAttribute('aria-pressed', String(!SET.sound)); $('btnMute').textContent = SET.sound ? '♪' : '✕'; $('btnMute').setAttribute('aria-label', SET.sound ? '소리 끄기' : '소리 켜기'); }
$('btnMute').addEventListener('click', toggleMute);

$('btnCam').addEventListener('click', startCamera);
$('btnNoCam').addEventListener('click', () => { SFX.unlock(); S.cam.on = false; applySens(); goMenu(); });
$('btnCalSkip').addEventListener('click', () => { SFX.unlock(); leaveCalib(); });
$('btnCalNext').addEventListener('click', () => { SFX.unlock(); leaveCalib(); });
$('btnStart').addEventListener('click', () => { SFX.unlock(); startGame(); });

/* ---- 경기 시작·일시정지·결과 ---- */
function startGame() {
  P.racketSide = SET.hs; P.root.scale.x = SET.hs;
  applySens();
  showScreen(null); $('hud').hidden = false; $('banner').className = '';
  S.mode = SET.mode; S.lvl = LEVELS[SET.level] || LEVELS.normal;
  S.stats = { maxKmh: 0, longest: 0, aces: 0 };
  P.x = P.tx = HOME.P[0]; P.z = P.tz = HOME.P[1]; Q.x = Q.tx = HOME.Q[0]; Q.z = Q.tz = HOME.Q[1];
  P.anim.cele = P.anim.sad = Q.anim.cele = Q.anim.sad = 0; P.anim.swing = Q.anim.swing = -1;
  if (S.cam.on) $('camBox').hidden = false;
  if (S.mode === 'match') {
    $('board').hidden = false; $('pboard').hidden = true;
    S.score = new TC.Score(SET.bestOf); hudScore(); beginPoint();
  } else startPractice();
}
function setPaused(p) {
  S.paused = p;
  showScreen(p ? 'pause' : null);
  if (!p) { S.acc = 0; }
}
$('btnPause').addEventListener('click', () => setPaused(true));
$('btnResume').addEventListener('click', () => setPaused(false));
$('btnQuit').addEventListener('click', () => { S.paused = false; goMenu(); });
$('btnAgain').addEventListener('click', () => { SFX.unlock(); startGame(); });
$('btnToMenu').addEventListener('click', () => goMenu());

function showResult() {
  S.phase = 'result'; S.ballVis = false;
  const sc = S.score, won = sc.winner === 0;
  $('resTitle').textContent = won ? '🏆 승리!' : '아쉬워요';
  $('resScore').textContent = '나 ' + sc.games[0] + ' : ' + sc.games[1] + ' CPU';
  $('resStats').innerHTML = `<div><b>${S.stats.maxKmh || '-'}</b>최고 속도 km/h</div><div><b>${S.stats.longest}</b>가장 긴 랠리</div><div><b>${S.stats.aces}</b>에이스</div>`;
  setHint(''); $('hud').hidden = true;
  showScreen('result');
  if (won) SFX.win(); else SFX.lose();
}

/* ================================================================ 그리기 */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w / h < 1.3 ? 58 : 46; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const camPos = new THREE.Vector3(0, 6.0, 21), camLook = new THREE.Vector3(0, -2.5, -6);
const tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3();

function syncVisuals(dt) {
  P.root.position.set(P.x, 0, P.z); Q.root.position.set(Q.x, 0, Q.z);
  poseAvatar(P, dt); poseAvatar(Q, dt);
  S.camT += dt;

  // 공
  const b = S.ball, show = S.ballVis;
  ballMesh.visible = halo.visible = ballShadow.visible = show;
  if (show) {
    const k = S.held ? 0 : S.acc;
    S.visOff.multiplyScalar(Math.exp(-dt * 16));
    const x = b.x + (b.rolling ? b.vx : b.vx) * k + S.visOff.x, y = Math.max(C.BALL_R, b.y + (b.rolling ? 0 : b.vy * k) + S.visOff.y), z = b.z + b.vz * k + S.visOff.z;
    ballMesh.position.set(x, y, z); halo.position.set(x, y, z);
    const dist = camera.position.distanceTo(ballMesh.position), sc = clamp(0.9 + dist * 0.05, 1, 3.2);
    ballMesh.scale.setScalar(sc); halo.scale.setScalar(clamp(0.26 + dist * 0.03, 0.35, 1.0));
    ballMesh.rotation.x += b.vz * dt * 0.8; ballMesh.rotation.z -= b.vx * dt * 0.8;
    const h = clamp(y / 6, 0, 1);
    ballShadow.position.set(x, 0.025, z); ballShadow.scale.setScalar((1 - 0.5 * h) * (0.8 + 0.2 * sc)); ballShadow.material.opacity = 0.75 * (1 - 0.6 * h);
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (!S.held && sp > 4) { trailPts.unshift([x, y, z]); if (trailPts.length > TRAIL_N) trailPts.pop(); } else if (trailPts.length) trailPts.pop();
  } else trailPts.length = 0;
  for (let i = 0; i < TRAIL_N; i++) {
    const p = trailPts[i];
    if (p) { trailPos[i * 3] = p[0]; trailPos[i * 3 + 1] = p[1]; trailPos[i * 3 + 2] = p[2]; const f = (1 - i / TRAIL_N) * 0.55; trailCol[i * 3] = f; trailCol[i * 3 + 1] = f; trailCol[i * 3 + 2] = f * 0.7; }
    else { trailPos[i * 3 + 1] = -50; trailCol[i * 3] = trailCol[i * 3 + 1] = trailCol[i * 3 + 2] = 0; }
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
  updateParts(dt);

  // 관중
  if (window.__crowd) window.__crowd.position.y = Math.abs(Math.sin(S.camT * 12)) * 0.18 * S.cheer;

  // 카메라
  const menu = !inGame() && S.phase !== 'result';
  if (menu) {
    tmpP.set(Math.sin(S.camT * 0.18) * 7, 5.8 + Math.sin(S.camT * 0.11) * 0.3, 21); tmpL.set(0, -1.5, -4);
  } else {
    tmpP.set(P.x * 0.55, 6.0, 21 + clamp(P.z - 12.9, -1, 3) * 0.8); tmpL.set(P.x * 0.25, -2.5, -6);
  }
  const k = 1 - Math.exp(-dt * 4);
  camPos.lerp(tmpP, k); camLook.lerp(tmpL, k);
  camera.position.copy(camPos);
  if (S.shake > 0) { camera.position.x += (rnd() - 0.5) * S.shake; camera.position.y += (rnd() - 0.5) * S.shake; S.shake = Math.max(0, S.shake - dt * 0.4); }
  camera.lookAt(camLook);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!S.paused) {
    S.acc += dt;
    while (S.acc >= STEP) { S.acc -= STEP; stepWorld(); }
  }
  syncVisuals(S.paused ? 0 : dt);
  renderer.render(scene, camera);
}

/* ================================================================ 시작 */
SFX.setMuted(!SET.sound); syncMute(); applySens();
document.addEventListener('visibilitychange', () => { if (document.hidden && inGame() && !S.paused) setPaused(true); });
window.HT = { S, P, Q, TC, SET, onSwing, startGame, goMenu, onHand, planContact, Hands, step: stepWorld, goCalib };
requestAnimationFrame(frame);
})();
