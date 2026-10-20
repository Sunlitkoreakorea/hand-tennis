// node test/core.test.js
const T = require('../core.js');
const { C, Score, Judge, SwingDetector, LEVELS } = T;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

// mulberry32
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

/* 한 번의 타구를 끝까지 날려 판정을 돌려본다 */
function fly(ball, judge, maxT) {
  const ev = [], dt = 1 / 240; let t = 0, res = null;
  while (t < (maxT || 6) && !res) {
    ev.length = 0; T.stepBall(ball, dt, ev); t += dt;
    for (const e of ev) {
      if (e.type === 'net') judge.net();
      if (e.type === 'bounce') res = judge.bounce(e.x, e.z, false) || res;
      if (e.type === 'roll') res = judge.bounce(e.x, e.z, true) || res;
      if (res && res.kind !== 'in') break;
      if (res && res.kind === 'in') res = null;
    }
    if (ball.rolling && !res && ball.vx * ball.vx + ball.vz * ball.vz < 0.01) break;
  }
  return res;
}

// 1) 스코어
{
  const s = new Score(3);
  for (let i = 0; i < 4; i++) s.point(0);
  ok(s.games[0] === 1 && s.server === 1, '게임 하나 획득 후 서브 교대');
  const s2 = new Score(1);
  for (let i = 0; i < 3; i++) { s2.point(0); s2.point(1); }
  ok(s2.label(0) === '40' && s2.label(1) === '40', '40-40 = 듀스 표기');
  s2.point(0); ok(s2.label(0) === 'AD', '어드밴티지');
  s2.point(1); ok(s2.label(0) === '40' && s2.label(1) === '40', '다시 듀스');
  s2.point(1); const r = s2.point(1); ok(r.type === 'match' && s2.winner === 1, '듀스 후 2점 차로 승리');
  const s3 = new Score(5); ok(s3.need === 3, '5게임 → 3게임 선취');
}

// 2) 서브: 토스 타이밍이 좋으면 대부분 서비스 박스에 들어온다
{
  const rnd = rng(1); let inN = 0, N = 400;
  for (let i = 0; i < N; i++) {
    const power = 0.3 + 0.7 * rnd(), sign = rnd() < 0.5 ? 1 : -1;
    const from = { x: sign * -1.0 + (rnd() - 0.5) * 0.4, y: 2.55, z: C.HALF_L + 0.3 };
    const plan = T.planServe({ from, power, timing: (rnd() - 0.5) * 0.1, boxSign: -sign * -1, facing: -1, rnd });
    // 센터에서 대각선 반대편 박스로: 내가 x<0이면 상대 박스는 x>0
    const boxSign = from.x < 0 ? 1 : -1;
    const p2 = T.planServe({ from, power, timing: (rnd() - 0.5) * 0.1, boxSign, facing: -1, rnd });
    const b = T.makeBall(from.x, from.y, from.z); b.vx = p2.v.vx; b.vy = p2.v.vy; b.vz = p2.v.vz; b.spin = p2.spin;
    const j = new Judge(); j.serveHit(0, boxSign);
    const res = fly(b, j);
    if (j.bounces >= 1 && !(res && res.kind === 'fault')) inN++;
  }
  console.log('서브 성공률(좋은 타이밍)', (inN / N * 100).toFixed(0) + '%');
  ok(inN / N > 0.8, '좋은 타이밍의 서브는 80% 이상 들어간다');
}

// 3) 서브: 타이밍이 크게 어긋나면 폴트가 난다
{
  const rnd = rng(2); let fault = 0, N = 300;
  for (let i = 0; i < N; i++) {
    const from = { x: -1, y: 2.4, z: C.HALF_L + 0.3 };
    const p = T.planServe({ from, power: 0.9, timing: (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.2), boxSign: 1, facing: -1, rnd });
    const b = T.makeBall(from.x, from.y, from.z); b.vx = p.v.vx; b.vy = p.v.vy; b.vz = p.v.vz; b.spin = p.spin;
    const j = new Judge(); j.serveHit(0, 1);
    const res = fly(b, j);
    if (res && res.kind === 'fault') fault++;
  }
  console.log('서브 폴트율(타이밍 불량)', (fault / N * 100).toFixed(0) + '%');
  ok(fault / N > 0.6, '타이밍이 많이 어긋난 서브는 대부분 폴트');
}

// 4) 랠리: 좋은 타이밍의 스윙은 대부분 인 (파워·스핀 무작위)
{
  const rnd = rng(3); let inN = 0, N = 600;
  for (let i = 0; i < N; i++) {
    const side = rnd() < 0.5 ? 1 : -1, power = rnd(), spin = [1, 0, -1][i % 3];
    const from = { x: (rnd() - 0.5) * 6, y: 1.0, z: 11.0 + rnd() };
    const p = T.planSwingShot({ from, power, spin, timing: (rnd() - 0.5) * 0.14, side, facing: -1, rnd });
    const b = T.makeBall(from.x, from.y, from.z); b.vx = p.v.vx; b.vy = p.v.vy; b.vz = p.v.vz; b.spin = p.spin;
    const j = new Judge(); j.hit(0);
    const res = fly(b, j);
    if (j.bounces >= 1 && !(res && res.kind === 'point' && res.winner === 1)) inN++;
  }
  console.log('랠리 타구 성공률(좋은 타이밍)', (inN / N * 100).toFixed(0) + '%');
  ok(inN / N > 0.85, '좋은 타이밍 타구는 85% 이상 코트 안');
}

// 5) 타이밍이 늦거나 빠르면 좌우가 갈린다 (Wii식)
{
  const from = { x: 0, y: 1, z: 11.2 }, rnd = () => 0.5;
  const early = T.planSwingShot({ from, power: 0.5, spin: 0, timing: -0.16, side: 1, facing: -1, rnd });
  const late = T.planSwingShot({ from, power: 0.5, spin: 0, timing: 0.16, side: 1, facing: -1, rnd });
  ok(early.tx < -1 && late.tx > 1 || early.tx > 1 && late.tx < -1, '빠르면/늦으면 서로 반대쪽으로 간다');
  ok(early.tx * 1 === -late.tx || Math.abs(early.tx + late.tx) < 0.5, '대칭');
  console.log('빠름 tx=%s 늦음 tx=%s', early.tx.toFixed(2), late.tx.toFixed(2));
}

// 6) 세게 칠수록 빠르다
{
  const from = { x: 0, y: 1, z: 11.2 }, rnd = () => 0.5;
  const lo = T.planSwingShot({ from, power: 0.05, spin: 0, timing: 0, side: 1, facing: -1, rnd });
  const hi = T.planSwingShot({ from, power: 1, spin: 0, timing: 0, side: 1, facing: -1, rnd });
  console.log('약:', lo.kmh, 'km/h  강:', hi.kmh, 'km/h');
  ok(hi.kmh > lo.kmh + 30, '강타가 확실히 빠르다');
  ok(hi.kmh < 180 && lo.kmh > 40, '속도가 비현실적이지 않다');
}

// 7) CPU 타구: 미스 없이는 대부분 인
for (const key of ['easy', 'normal', 'hard']) {
  const lvl = LEVELS[key], rnd = rng(10); let inN = 0, nm = 0, N = 600;
  for (let i = 0; i < N; i++) {
    const from = { x: (rnd() - 0.5) * 6, y: 0.9, z: -11 };
    const p = T.planAiShot({ lvl, oppX: (rnd() - 0.5) * 5, from, facing: 1, rnd });
    if (p.miss) continue; nm++;
    const b = T.makeBall(from.x, from.y, from.z); b.vx = p.v.vx; b.vy = p.v.vy; b.vz = p.v.vz; b.spin = p.spin;
    const j = new Judge(); j.hit(1);
    const res = fly(b, j);
    if (j.bounces >= 1 && !(res && res.kind === 'point' && res.winner === 0)) inN++;
  }
  console.log('CPU', key, '의도한 타구 성공률', (inN / nm * 100).toFixed(0) + '%');
  ok(inN / nm > 0.9, 'CPU ' + key + ' 정상 타구가 90% 이상 인');
}

// 8) findContact: CPU 쪽에서 날아오는 공의 타점을 찾는다
{
  const rnd = rng(4); let found = 0, N = 200;
  for (let i = 0; i < N; i++) {
    const from = { x: (rnd() - 0.5) * 4, y: 0.9, z: -11 };
    const p = T.planAiShot({ lvl: LEVELS.normal, oppX: 0, from, facing: 1, rnd });
    if (p.miss) continue;
    const b = T.makeBall(from.x, from.y, from.z); b.vx = p.v.vx; b.vy = p.v.vy; b.vz = p.v.vz; b.spin = p.spin;
    const c = T.findContact(b, 1);
    if (c && c.y <= 2.4 && !c.out) found++;
  }
  console.log('타점 발견', found);
  ok(found > 140, '날아오는 공의 타점을 대부분 찾는다');
}

// 8-2) 볼 머신 초고속 단계: 공이 코트에 들어오고, 단계가 오를수록 확실히 빠르다
{
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1], speeds = {};
  for (const key of ['hard', 'fast', 'insane']) {
    const L = T.machineLevel(key), rnd = rng(7), kmhs = []; let inN = 0, N = 300;
    for (let i = 0; i < N; i++) {
      const from = { x: (rnd() - 0.5) * 5, y: L.fromY || 1.0, z: -12.4 };
      const p = T.planAiShot({ lvl: L, oppX: 0, from, facing: 1, rnd });
      const b = T.makeBall(from.x, from.y, from.z); b.vx = p.v.vx; b.vy = p.v.vy; b.vz = p.v.vz; b.spin = p.spin;
      const j = new Judge(); j.hit(1);
      const res = fly(b, j);
      if (j.bounces >= 1 && !(res && res.kind === 'point' && res.winner === 0)) inN++;
      kmhs.push(p.kmh);
    }
    speeds[key] = med(kmhs);
    ok(inN / N > 0.9, key + ' 머신 공이 90% 이상 코트 안 (' + (inN / N * 100).toFixed(0) + '%)');
  }
  console.log('머신 공 속도(중앙값 km/h):', speeds);
  ok(speeds.fast > speeds.hard + 25 && speeds.insane > speeds.fast + 40, '매우 빠름 < 말도 안 되게 빠름 속도 순서');
  ok(speeds.insane > 170, '말도 안 되게 빠름은 170km/h 이상');
}

// 8-3) CPU 대전 초고속 난이도: 사람 타구를 받아쳐서 코트 안에 넣고, 내가 닿을 수 있고, 단계가 오를수록 빠르다
{
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1], speeds = {};
  for (const key of ['hard', 'fast', 'insane']) {
    const L = LEVELS[key], rnd = rng(11), kmhs = []; let inN = 0, reach = 0, N = 0;
    for (let i = 0; i < 900; i++) {
      const from = { x: (rnd() - 0.5) * 6, y: 1.0, z: 11.5 };
      const hp = T.planSwingShot({ from, power: 0.2 + 0.7 * rnd(), spin: [1, 0, -1][i % 3], timing: (rnd() - 0.5) * 0.14, side: rnd() < 0.5 ? 1 : -1, facing: -1, rnd });
      const b = T.makeBall(from.x, from.y, from.z); b.vx = hp.v.vx; b.vy = hp.v.vy; b.vz = hp.v.vz; b.spin = hp.spin;
      const c = T.findContact(b, -1, L.cy ? { idealY: L.cy } : undefined);
      if (!c || c.out || c.y > 2.3) continue;
      const f2 = { x: c.x, y: Math.max(0.45, Math.min(2.2, c.y)), z: c.z };
      const p = T.planAiShot({ lvl: L, oppX: (rnd() - 0.5) * 5, from: f2, facing: 1, rnd });
      if (p.miss) continue; N++;
      const b2 = T.makeBall(f2.x, f2.y, f2.z); b2.vx = p.v.vx; b2.vy = p.v.vy; b2.vz = p.v.vz; b2.spin = p.spin;
      const c2 = T.findContact(T.copyBall(b2), 1);
      const j = new Judge(); j.hit(1);
      const res = fly(b2, j);
      if (j.bounces >= 1 && !(res && res.kind === 'point' && res.winner === 0)) { inN++; kmhs.push(p.kmh); if (c2 && !c2.out && c2.y <= 2.4) reach++; }
    }
    speeds[key] = med(kmhs);
    ok(inN / N > 0.9, 'CPU ' + key + ' 정상 타구가 90% 이상 코트 안 (' + (inN / N * 100).toFixed(0) + '%)');
    ok(reach / inN > 0.9, 'CPU ' + key + ' 타구에 내가 닿을 수 있다 (' + (reach / inN * 100).toFixed(0) + '%)');
  }
  console.log('CPU 난이도 공 속도(중앙값 km/h):', speeds);
  ok(speeds.fast > speeds.hard + 25 && speeds.insane > speeds.fast + 30, 'CPU 어려움 < 매우 빠름 < 말도 안 되게 빠름');
}

// 8-4) 파워 게이지: 0 → 1(0.9초) → 0(1.8초)을 반복하는 삼각파
{
  const g = T.gaugeAt;
  ok(g(0) === 0 && Math.abs(g(0.45) - 0.5) < 1e-9 && Math.abs(g(0.9) - 1) < 1e-9, '게이지가 0.9초에 가득 찬다');
  ok(Math.abs(g(1.35) - 0.5) < 1e-9 && Math.abs(g(1.8)) < 1e-9, '가득 찬 뒤 다시 줄어든다');
  ok(Math.abs(g(2.25) - 0.5) < 1e-9 && g(-1) === 0, '반복되고 음수 시간은 0');
  let bad = 0; for (let i = 0; i < 2000; i++) { const v = g(i * 0.013); if (v < 0 || v > 1) bad++; }
  ok(bad === 0, '게이지 값은 항상 0~1');
}

// 9) 스윙 판정: 속도 단위(손 크기/초) — 손 크기 0.1, 0.3초에 화면 폭의 0.6만큼 휘두름
{
  const sd = new SwingDetector(); const got = [];
  let t = 0, x = 0.2; const y = 0.5;
  for (let i = 0; i < 30; i++) { t += 1 / 30; const r = sd.feed(t, x, y, 0.1); if (r) got.push(r); }  // 정지
  ok(got.length === 0, '가만히 있으면 스윙 없음');
  const t0 = t;
  for (let i = 0; i < 10; i++) { t += 1 / 30; x += 0.06 * Math.sin(Math.PI * i / 9) + 0.01; const r = sd.feed(t, x, y, 0.1); if (r) got.push(r); }
  for (let i = 0; i < 20; i++) { t += 1 / 30; const r = sd.feed(t, x, y, 0.1); if (r) got.push(r); }
  ok(got.length === 1, '휘두르면 정확히 한 번 스윙: ' + got.length);
  if (got[0]) {
    ok(got[0].dir === 1, '오른쪽으로 휘두름');
    ok(got[0].t > t0 && got[0].t < t0 + 0.34, '최고 속도 시각이 휘두르는 도중');
    console.log('스윙: 속도', got[0].speed.toFixed(1), '파워', got[0].power.toFixed(2), '스핀', got[0].spin);
  }
  // 손을 천천히 움직이면 스윙이 아니다
  const sd2 = new SwingDetector(); let n2 = 0, tt = 0, xx = 0.1;
  for (let i = 0; i < 90; i++) { tt += 1 / 30; xx += 0.004; if (sd2.feed(tt, xx, 0.5, 0.1)) n2++; }
  ok(n2 === 0, '천천히 움직이면 스윙 아님');
}

// 10) 위로 쳐올리면 탑스핀, 아래로 깎으면 슬라이스
{
  const run = dy => {
    const sd = new SwingDetector(); let t = 0, y = 0.5, out = null;
    for (let i = 0; i < 20; i++) { t += 1 / 30; sd.feed(t, 0.5, y, 0.1); }
    for (let i = 0; i < 8; i++) { t += 1 / 30; y += dy * Math.sin(Math.PI * i / 7) + dy * 0.2; const r = sd.feed(t, 0.5 + 0.03 * i, y, 0.1); if (r) out = r; }
    for (let i = 0; i < 10; i++) { t += 1 / 30; const r = sd.feed(t, 0.7, y, 0.1); if (r) out = r; }
    return out;
  };
  const up = run(-0.06), down = run(0.06);
  ok(up && up.spin === 1, '쳐올리기 = 탑스핀'); ok(down && down.spin === -1, '깎아치기 = 슬라이스');
}

// 11) 손을 놓치는 경우: 빠르게 휘두르다 사라지면 스윙으로 친다
{
  const sd = new SwingDetector(); let t = 0, x = 0.1, got = null;
  for (let i = 0; i < 20; i++) { t += 1 / 30; sd.feed(t, x, 0.5, 0.1); }
  for (let i = 0; i < 4; i++) { t += 1 / 30; x += 0.07; const r = sd.feed(t, x, 0.5, 0.1); if (r) got = r; }
  const r2 = sd.lost(t + 0.04); if (r2) got = r2;
  ok(got, '휘두르다 손을 놓쳐도 스윙으로 인정');
}

// 12) 서브 코트 순서
{
  const s = new Score(3);
  ok(s.courtSign() === 1, '첫 서브는 듀스 코트');
  s.point(0); ok(s.courtSign() === -1, '다음은 애드 코트');
}

console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
process.exit(fails ? 1 : 0);
