/* 손 테니스 — 화면과 무관한 게임 로직: 공 물리, 타구 계산, 규칙·점수, 스윙 판정.
   index.html과 Node 테스트(test/core.test.js)가 함께 쓴다.
   좌표(미터): x 오른쪽(+), y 위, z 카메라 쪽(+). 네트는 z=0, 내 코트는 z>0, CPU 코트는 z<0. */
(function (root) {
'use strict';

const C = {
  HALF_L: 11.885,      // 네트 ~ 베이스라인
  SERVICE: 6.40,       // 네트 ~ 서비스 라인
  SINGLES_HW: 4.115,   // 단식 코트 반폭
  DOUBLES_HW: 5.485,
  NET_H: 0.914, NET_POST_H: 1.07, NET_HW: 6.4,
  BALL_R: 0.08,
  G: 9.8,
  SPIN_ACC: 4.0,       // 탑스핀(+1)은 더 빨리 떨어지고, 슬라이스(-1)는 더 뜬다
  TOSS_VY: 6.0,        // 서브 토스 초속 (손 높이 1.3m에서 던져 올림)
  TOSS_IDEAL: 0.94,    // 토스 후 이 시간에 치면 딱 좋다 (공이 내려오는 높이 약 2.6m)
};

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// 평균 0, 표준편차 약 1
const gauss = rnd => (rnd() + rnd() + rnd() - 1.5) * 2;

function netHeight(x) {
  const u = Math.min(1, Math.abs(x) / C.NET_HW);
  return C.NET_H + (C.NET_POST_H - C.NET_H) * u * u;
}
function accelY(spin) { return -(C.G + C.SPIN_ACC * spin); }

function makeBall(x, y, z) { return { x, y, z, vx: 0, vy: 0, vz: 0, spin: 0, netHit: false, rolling: false }; }
function copyBall(b) { return Object.assign({}, b); }

/* 공을 dt만큼 움직인다. 일어난 일은 ev에 {type:'bounce'|'roll'|'net'|'cord', x, z, vy}로 담는다. */
function stepBall(b, dt, ev) {
  const r = C.BALL_R, x0 = b.x, y0 = b.y, z0 = b.z;
  if (b.rolling) {
    const k = Math.max(0, 1 - 1.5 * dt);
    b.vx *= k; b.vz *= k; b.vy = 0; b.y = r;
    b.x += b.vx * dt; b.z += b.vz * dt;
  } else {
    b.vy += accelY(b.spin) * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  }
  // 네트
  if (!b.netHit && z0 !== 0 && (z0 > 0) !== (b.z > 0)) {
    const f = z0 / (z0 - b.z), xa = x0 + (b.x - x0) * f, ya = y0 + (b.y - y0) * f;
    if (Math.abs(xa) < C.NET_HW + 0.05) {
      const h = netHeight(xa);
      if (ya < h) {
        // 네트에 걸림: 친 사람 쪽으로 떨어진다
        b.netHit = true;
        b.x = xa; b.z = Math.sign(z0) * (r + 0.02);
        b.vz = -b.vz * 0.12; b.vx *= 0.3; b.vy = Math.min(b.vy, 0) * 0.3; b.spin = 0;
        if (ev) ev.push({ type: 'net', x: xa, z: 0 });
      } else if (ya < h + r) {
        // 네트 테이프를 스치고 넘어감
        b.vz *= 0.55; b.vx *= 0.7; b.vy = Math.abs(b.vy) * 0.3 + 1.2;
        if (ev) ev.push({ type: 'cord', x: xa, z: 0 });
      }
    }
  }
  // 바닥
  if (!b.rolling && b.y < r && b.vy < 0) {
    const s = clamp(b.spin, -1, 1), e = 0.64 + 0.05 * s, k = 0.80 + 0.08 * s;
    if (ev) ev.push({ type: 'bounce', x: b.x, z: b.z, vy: b.vy });
    b.y = r; b.vy = -b.vy * e; b.vx *= k; b.vz *= k; b.spin *= 0.4;
    if (b.vy < 0.8) {
      b.rolling = true; b.vy = 0;
      if (ev) ev.push({ type: 'roll', x: b.x, z: b.z, vy: 0 });
    }
  }
}

/* side(+1 내 코트 / -1 CPU 코트)에서 받는 사람이 칠 지점을 미리 계산한다.
   한 번 튄 뒤 공이 허리 높이(idealY)로 내려올 때, 너무 낮게 튀면 꼭대기에서, 너무 깊으면 deep 선에서 친다. */
function findContact(ball, side, o) {
  o = o || {};
  const dt = 1 / 120, maxT = o.maxT || 4, deep = o.deep || 14.8, ideal = o.idealY || 1.1;
  const s = copyBall(ball), ev = [];
  let t = 0, bounced = false, prevVy = s.vy, out = false, bx = 0, bz = 0;
  const mk = kind => ({ t, x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, bounceX: bx, bounceZ: bz, out, kind });
  while (t < maxT) {
    ev.length = 0; stepBall(s, dt, ev); t += dt;
    for (const e of ev) {
      if (e.type === 'net') return null;
      if (e.type === 'bounce') {
        if (bounced) return null;
        if ((e.z > 0 ? 1 : -1) !== side) return null;
        bounced = true; bx = e.x; bz = e.z;
        out = Math.abs(e.x) > C.SINGLES_HW + C.BALL_R || Math.abs(e.z) > C.HALF_L + C.BALL_R;
      }
      if (e.type === 'roll') return bounced ? mk('roll') : null;
    }
    if (bounced) {
      if (s.z * side >= deep) return mk('deep');
      if (s.vy <= 0 && s.y <= ideal) return mk('drop');
      if (prevVy > 0 && s.vy <= 0 && s.y < ideal) return mk('apex');
    }
    prevVy = s.vy;
  }
  return null;
}

/* p에서 T초 뒤 (tx, tz)에 떨어지는 초속도 (공기저항 없음, 스핀은 중력 보정으로만) */
function solveShot(p, tx, tz, T, spin) {
  const ay = accelY(spin);
  return { vx: (tx - p.x) / T, vz: (tz - p.z) / T, vy: (C.BALL_R - p.y - 0.5 * ay * T * T) / T };
}
/* 네트를 지날 때 네트 위로 얼마나 높이 지나가는지 (음수면 네트에 걸림) */
function netClear(p, v, spin) {
  if (!v.vz) return Infinity;
  const tn = -p.z / v.vz;
  if (tn <= 0) return Infinity;
  const y = p.y + v.vy * tn + 0.5 * accelY(spin) * tn * tn;
  return y - netHeight(p.x + v.vx * tn);
}
/* 목표 지점을 향해 대략 speed(수평 m/s)로 친다. minClear가 있으면 네트를 넘을 때까지 공을 띄운다. */
function aim(p, tx, tz, speed, spin, minClear) {
  const d = Math.hypot(tx - p.x, tz - p.z);
  let T = d / Math.max(4, speed), v = solveShot(p, tx, tz, T, spin);
  if (minClear > -5) {
    for (let i = 0; i < 40 && netClear(p, v, spin) < minClear; i++) { T *= 1.05; v = solveShot(p, tx, tz, T, spin); }
  }
  return v;
}
const kmh = v => Math.round(Math.hypot(v.vx, v.vy, v.vz) * 3.6);

function timingLabel(tau) { return Math.abs(tau) <= 0.06 ? 'perfect' : tau < 0 ? 'early' : 'late'; }

/* 사람이 휘둘러 친 공 (Wii 방식).
   timing: 이상적인 순간보다 몇 초 늦었는지 (음수 = 빨랐음). 일찍 치면 당겨 치고(크로스), 늦으면 밀려 나간다.
   side: 몸 기준 공이 있던 쪽의 월드 x 부호. power 0~1, spin +1 탑스핀 / 0 플랫 / -1 슬라이스.
   facing: 상대 코트 방향 z 부호 (나는 -1). */
function planSwingShot(o) {
  const rnd = o.rnd || Math.random, p = clamp(o.power, 0, 1), spin = o.spin | 0;
  const u = clamp(o.timing / 0.2, -1.8, 1.8), au = Math.abs(u);
  const label = timingLabel(o.timing);
  const tx = o.side * u * 3.3 + gauss(rnd) * 0.35 * (0.4 + au);
  let depth = spin > 0 ? 8.4 + 2.4 * p : spin < 0 ? 6.4 + 3.2 * p : 7.4 + 3.2 * p;
  depth += gauss(rnd) * 0.4 * (0.4 + au);
  if (p > 0.8 && au > 0.6) depth += 1.6 * (au - 0.4);   // 타이밍이 어긋났는데 세게 치면 길게 나간다
  let speed = spin > 0 ? 12 + 11 * p : spin < 0 ? 10 + 7 * p : 13 + 15 * p;
  if (label === 'perfect') speed *= 1.06;
  const good = au < 1 && p > 0.03;
  const minClear = good ? (spin > 0 ? 0.45 : spin < 0 ? 0.12 : 0.18) : -9;
  const tz = o.facing * depth;
  const v = aim(o.from, tx, tz, speed, spin, minClear);
  return { v, spin, tx, tz, label, power: p, kmh: kmh(v) };
}

/* 서브. boxSign: 넣어야 할 서비스 박스의 월드 x 부호. */
function planServe(o) {
  const rnd = o.rnd || Math.random, p = clamp(o.power, 0, 1);
  const u = clamp(o.timing / 0.2, -2, 2), au = Math.abs(u);
  const tx = o.boxSign * (2.05 - 0.35 * p) + u * 1.8 + gauss(rnd) * 0.3;
  const depth = 4.9 + 1.0 * p + Math.max(0, au - 0.6) * 1.6 + gauss(rnd) * 0.25;
  const tz = o.facing * depth;
  const v = aim(o.from, tx, tz, (15 + 15 * p) * (o.mul || 1), 0, au < 0.9 ? 0.1 : -9);
  return { v, spin: 0, tx, tz, label: timingLabel(o.timing), power: p, kmh: kmh(v) };
}

const LEVELS = {
  easy:   { id: 'easy',   name: '쉬움',   speed: 5.3, react: 0.32, reach: 0.95, spd: [15, 20], err: 1.1,  miss: 0.17, aimOpen: 0.15, tErr: 0.05,  serveP: 0.3,  fault: 0.14 },
  normal: { id: 'normal', name: '보통',   speed: 6.2, react: 0.22, reach: 1.1,  spd: [16, 22], err: 0.8,  miss: 0.10, aimOpen: 0.45, tErr: 0.03,  serveP: 0.55, fault: 0.09 },
  hard:   { id: 'hard',   name: '어려움', speed: 7.0, react: 0.14, reach: 1.25, spd: [18, 26], err: 0.55, miss: 0.05, aimOpen: 0.75, tErr: 0.015, serveP: 0.8,  fault: 0.06 },
  // 초고속 단계. 낮은 곳(1m)에서 치면 네트를 넘기느라 속도가 안 나오니, CPU는 공을 더 높은 곳(cy)에서 치고
  // 강한 탑스핀(spin)으로 내리꽂는다. pspd: 내 선수 이동 속도, serveMul: 서브 속도 배수.
  // machine: 연습 모드 볼 머신일 때 덮어쓰는 값 (높은 곳(fromY)에서 평평하게 쏜다)
  fast:   { id: 'fast',   name: '매우 빠름', speed: 7.8, react: 0.10, reach: 1.4, spd: [30, 36], err: 0.5,  miss: 0.06, aimOpen: 0.7, tErr: 0.012, serveP: 0.95, serveMul: 1.15, fault: 0.07, spin: 2, clear: 0.3, cy: 1.5, pspd: 8.6,
            machine: { spd: [30, 38], flat: true, fromY: 1.9, pspd: 9 } },
  insane: { id: 'insane', name: '말도 안 되게 빠름', speed: 8.6, react: 0.06, reach: 1.6, spd: [46, 56], err: 0.4, miss: 0.07, aimOpen: 0.8, tErr: 0.01, serveP: 1, serveMul: 1.5, fault: 0.08, spin: 5, clear: 0.1, cy: 1.9, pspd: 10,
            machine: { spd: [50, 58], flat: true, fromY: 2.9, pspd: 12 } },
};

/* CPU의 타구. oppX: 상대의 현재 x (빈 곳을 노린다). */
function planAiShot(o) {
  const L = o.lvl, rnd = o.rnd || Math.random, r = rnd();
  const spin = L.flat ? 0 : L.spin != null ? L.spin : r < 0.4 ? 1 : r < 0.82 ? 0 : -1;
  let tx = rnd() < L.aimOpen && Math.abs(o.oppX) > 0.3
    ? -Math.sign(o.oppX) * (2.2 + rnd() * 1.4)
    : (rnd() * 2 - 1) * 3.0;
  let depth = 7.8 + rnd() * 2.8;
  tx = clamp(tx + gauss(rnd) * L.err * 0.6, -3.7, 3.7);
  depth = clamp(depth + gauss(rnd) * L.err * 0.5, 5.5, 11.2);
  let speed = L.spd[0] + rnd() * (L.spd[1] - L.spd[0]);
  if (!L.flat && L.spin == null) { if (spin < 0) speed *= 0.75; else if (spin > 0) speed *= 0.9; }
  let minClear = L.clear != null ? L.clear : spin > 0 ? 0.45 : 0.18, miss = null;
  if (rnd() < L.miss) {
    const k = rnd();
    if (k < 0.4) { miss = 'long'; depth = 12.2 + rnd() * 1.2; }
    else if (k < 0.75) { miss = 'wide'; tx = (rnd() < 0.5 ? -1 : 1) * (4.35 + rnd() * 0.8); }
    else { miss = 'net'; depth = 1 + rnd(); minClear = -9; speed *= 1.25; }
  }
  const tz = o.facing * depth;
  const v = aim(o.from, tx, tz, speed, spin, minClear);
  return { v, spin, tx, tz, miss, label: 'cpu', power: 0.5, kmh: kmh(v) };
}

/* 테니스 점수 (세트 없이 N게임 중 먼저 과반을 따면 승리) */
class Score {
  constructor(bestOf) {
    this.bestOf = bestOf; this.need = Math.floor(bestOf / 2) + 1;
    this.games = [0, 0]; this.pts = [0, 0]; this.server = 0; this.winner = -1;
  }
  courtSign() { return (this.pts[0] + this.pts[1]) % 2 === 0 ? 1 : -1; }   // 1 = 듀스 코트(오른쪽)
  point(w) {
    const l = 1 - w;
    this.pts[w]++;
    if (this.pts[w] >= 4 && this.pts[w] - this.pts[l] >= 2) {
      this.games[w]++; this.pts = [0, 0]; this.server = 1 - this.server;
      if (this.games[w] >= this.need) { this.winner = w; return { type: 'match', w }; }
      return { type: 'game', w };
    }
    return { type: 'point', w };
  }
  label(i) {
    const a = this.pts[i], b = this.pts[1 - i];
    if (a >= 3 && b >= 3) return a > b ? 'AD' : '40';
    return ['0', '15', '30', '40'][Math.min(a, 3)];
  }
  call(names) {
    const s = this.server, a = this.pts[s], b = this.pts[1 - s];
    if (a + b === 0) return null;
    if (a >= 3 && b >= 3) return a === b ? '듀스' : '어드밴티지 · ' + names[a > b ? s : 1 - s];
    const n = ['0', '15', '30', '40'];
    return n[a] + ' - ' + n[b];
  }
}

/* 한 포인트의 규칙 판정. 선수 0 = 내 코트(z>0), 1 = CPU 코트(z<0). */
class Judge {
  constructor() { this.reset(); }
  reset() { this.hitter = -1; this.bounces = 0; this.serve = false; this.box = 0; this.over = false; this.netted = false; this.ace = false; }
  serveHit(by, boxSign) { this.reset(); this.hitter = by; this.serve = true; this.box = boxSign; }
  hit(by) { this.hitter = by; this.bounces = 0; this.serve = false; this.netted = false; this.ace = false; }
  net() { this.netted = true; }
  end(kind, winner, reason) { this.over = true; return { kind, winner, reason }; }
  // 공이 (x, z)에 튀었다 (roll = 굴러서 멈춤 → 한 번 더 튄 것으로 친다)
  bounce(x, z, roll) {
    if (this.over || this.hitter < 0) return null;
    const side = z > 0 ? 0 : 1, r = C.BALL_R, other = 1 - this.hitter;
    this.bounces++;
    if (side === this.hitter) return this.end(this.serve ? 'fault' : 'point', other, 'net');
    if (this.bounces === 1 && !roll) {
      if (this.serve) {
        const inBox = Math.abs(z) <= C.SERVICE + r && x * this.box >= -r && Math.abs(x) <= C.SINGLES_HW + r;
        if (!inBox) return this.end('fault', other, 'out');
        this.serve = false; this.ace = true;
        return { kind: 'in', side };
      }
      const inCourt = Math.abs(x) <= C.SINGLES_HW + r && Math.abs(z) <= C.HALF_L + r;
      if (!inCourt) return this.end('point', other, 'out');
      return { kind: 'in', side };
    }
    if (this.serve) return this.end('fault', other, 'out');
    return this.end('point', this.hitter, this.ace ? 'ace' : 'winner');
  }
}

/* 손(또는 마우스) 위치로 스윙을 찾는다.
   위치는 화면 높이 단위, 속도는 '손 크기/초' 단위라 카메라와의 거리에 덜 민감하다.
   빠르게 움직이기 시작하면 최고 속도를 지날 때까지 지켜본 뒤, 최고 속도 순간을 스윙 시각으로 낸다. */
class SwingDetector {
  constructor(o) {
    o = o || {};
    this.thr = o.thr || 15; this.range = o.range || 27; this.cool = o.cool || 0.38; this.minDisp = o.minDisp || 1.4;
    this.hs = 0; this.h = []; this.st = 0; this.pk = null; this.lastFire = -9; this.lastT = -9; this.since = -9;
    this.sp = 0; this.vx = 0; this.vy = 0; this.dx = 0; this.dy = 0;
  }
  reset() { this.h.length = 0; this.st = 0; this.pk = null; this.sp = this.vx = this.vy = this.dx = this.dy = 0; }
  _at(t) {
    const h = this.h;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i];
    return h[0];
  }
  feed(t, x, y, size) {
    if (size > 0) this.hs = this.hs ? this.hs + (size - this.hs) * 0.12 : size;
    const hs = Math.max(this.hs, 0.02), h = this.h;
    if (!h.length) this.since = t;
    h.push({ t, x, y });
    while (h.length > 2 && t - h[0].t > 0.35) h.shift();
    this.lastT = t;
    const a = this._at(t - 0.06), dt = t - a.t;
    if (dt < 0.015) return null;
    this.vx = (x - a.x) / dt / hs; this.vy = (y - a.y) / dt / hs; this.sp = Math.hypot(this.vx, this.vy);
    const b = this._at(t - 0.18);
    this.dx = (x - b.x) / hs; this.dy = (y - b.y) / hs;
    if (t - this.since < 0.1) { this.sp = 0; return null; }   // 손을 막 다시 찾았을 땐 위치가 튈 수 있다
    if (this.st === 0) {
      if (t - this.lastFire >= this.cool && this.sp > this.thr && Math.hypot(this.dx, this.dy) > this.minDisp) {
        this.st = 1; this.pk = { t, sp: this.sp, dx: this.dx, dy: this.dy, t0: t };
      }
      return null;
    }
    const pk = this.pk;
    if (this.sp > pk.sp) { pk.t = t; pk.sp = this.sp; pk.dx = this.dx; pk.dy = this.dy; }
    if (this.sp < pk.sp * 0.7 || t - pk.t0 > 0.12) return this._fire(t);
    return null;
  }
  // 손을 놓쳤다: 빠르게 휘두르는 중이었다면 (흔들려서 놓친 것) 스윙으로 친다
  lost(t) {
    let ev = null;
    if (this.st === 1) ev = this._fire(t);
    else if (t - this.lastT < 0.12 && this.sp > this.thr * 0.6 && t - this.lastFire >= this.cool) {
      this.pk = { t: this.lastT, sp: Math.max(this.sp, this.thr * 1.05), dx: this.dx, dy: this.dy };
      ev = this._fire(t);
    }
    this.reset();
    return ev;
  }
  // 손을 빠르게 들어 올리는 중 (서브 토스)
  rising() { return this.h.length > 2 && this.lastT - this.since >= 0.1 && this.vy < -this.thr * 0.45 && this.dy < -1.2; }
  _fire(now) {
    const pk = this.pk;
    this.st = 0; this.pk = null; this.lastFire = now;
    const d = Math.hypot(pk.dx, pk.dy) || 1, up = -pk.dy / d;
    return {
      t: pk.t, speed: pk.sp,
      power: clamp((pk.sp - this.thr) / this.range, 0, 1),
      spin: up > 0.55 ? 1 : up < -0.55 ? -1 : 0,
      dir: Math.sign(pk.dx),
    };
  }
}

/* 연습 모드 볼 머신용: 기본 값에 machine 덮어쓰기를 얹고 실수는 없앤다 */
function machineLevel(key) { const L = LEVELS[key] || LEVELS.normal; return Object.assign({}, L, L.machine || {}, { miss: 0 }); }

const API = {
  C, LEVELS, machineLevel, clamp, gauss, netHeight, accelY, makeBall, copyBall, stepBall, findContact,
  solveShot, netClear, aim, timingLabel, planSwingShot, planServe, planAiShot, Score, Judge, SwingDetector,
};
root.TennisCore = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
