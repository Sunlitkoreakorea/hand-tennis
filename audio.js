/* 소리: 파일 없이 WebAudio로 만든다. 브라우저 정책상 첫 클릭 뒤에 unlock()을 불러야 한다. */
(function (root) {
'use strict';

let ac = null, master = null, noiseBuf = null, muted = false;

function ctx() {
  if (ac) return ac;
  const AC = root.AudioContext || root.webkitAudioContext;
  if (!AC) return null;
  try { ac = new AC(); } catch (_) { return null; }
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}

/* 필터를 거친 잡음 한 번 */
function burst(o) {
  const a = ctx(); if (!a || muted) return;
  const t0 = a.currentTime + (o.delay || 0), dur = o.dur || 0.1;
  const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = a.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
  f.frequency.setValueAtTime(o.f0 || 1000, t0);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.3), t0 + (o.att || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}

/* 음 하나 */
function tone(o) {
  const a = ctx(); if (!a || muted) return;
  const t0 = a.currentTime + (o.delay || 0), dur = o.dur || 0.1;
  const osc = a.createOscillator(); osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.3), t0 + (o.att || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

const SFX = {
  unlock() { const a = ctx(); if (a && a.state === 'suspended') a.resume(); },
  setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.8; },
  isMuted() { return muted; },

  hit(p) {       // 라켓에 공이 맞는 소리, p: 0~1
    p = Math.max(0, Math.min(1, p));
    burst({ type: 'bandpass', f0: 2400, f1: 1300, q: 1.3, dur: 0.075, vol: 0.35 + 0.5 * p });
    burst({ type: 'highpass', f0: 4200, dur: 0.03, vol: 0.12 + 0.2 * p });
    tone({ f0: 300, f1: 120, dur: 0.09, vol: 0.3 + 0.3 * p, type: 'triangle' });
  },
  bounce(v) {    // 공이 바닥에 튀는 소리, v: 떨어지던 속도
    const k = Math.max(0.2, Math.min(1, Math.abs(v || 6) / 14));
    tone({ f0: 180, f1: 85, dur: 0.09, vol: 0.28 * k + 0.05 });
    burst({ type: 'lowpass', f0: 900, f1: 300, q: 0.7, dur: 0.06, vol: 0.2 * k + 0.03 });
  },
  net() {
    burst({ type: 'lowpass', f0: 1100, f1: 250, q: 0.6, dur: 0.22, vol: 0.5 });
    tone({ f0: 110, f1: 55, dur: 0.18, vol: 0.3 });
  },
  cord() { tone({ f0: 900, f1: 700, dur: 0.1, vol: 0.14, type: 'triangle' }); burst({ f0: 3000, dur: 0.04, vol: 0.1 }); },
  whoosh(p) {    // 헛스윙·스윙 바람 소리
    p = Math.max(0.1, Math.min(1, p == null ? 0.5 : p));
    burst({ type: 'bandpass', f0: 300 + 300 * p, f1: 1500 + 1200 * p, q: 0.9, dur: 0.2, vol: 0.12 + 0.2 * p, att: 0.06 });
  },
  blip() { tone({ f0: 660, f1: 880, dur: 0.06, vol: 0.12, type: 'triangle' }); },
  ding() { tone({ f0: 1320, dur: 0.18, vol: 0.12 }); tone({ f0: 1980, dur: 0.14, vol: 0.05, delay: 0.01 }); },
  tick() { tone({ f0: 1000, dur: 0.03, vol: 0.06, type: 'square' }); },
  fault() { tone({ f0: 220, f1: 160, dur: 0.28, vol: 0.18, type: 'sawtooth' }); },
  cheer(k) {     // 박수·함성
    k = Math.max(0.2, Math.min(1, k == null ? 0.7 : k));
    const dur = 1.1 + 1.3 * k;
    burst({ type: 'bandpass', f0: 700, f1: 1100, q: 0.5, dur, vol: 0.12 * k, att: 0.25 });
    for (let i = 0; i < 14 * k; i++) {
      burst({ type: 'highpass', f0: 2500 + Math.random() * 3000, dur: 0.03, vol: 0.05, delay: Math.random() * dur * 0.9 });
    }
  },
  groan() { burst({ type: 'bandpass', f0: 500, f1: 220, q: 0.8, dur: 0.7, vol: 0.1, att: 0.15 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ f0: f, dur: 0.22, vol: 0.16, delay: i * 0.12, type: 'triangle' })); SFX.cheer(1); },
  lose() { [392, 330, 262].forEach((f, i) => tone({ f0: f, dur: 0.3, vol: 0.14, delay: i * 0.18, type: 'triangle' })); },
};

root.SFX = SFX;
})(window);
