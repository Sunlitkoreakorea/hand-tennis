/* 손 인식: Google MediaPipe Hand Landmarker (Apache-2.0, 브라우저에서 바로 실행).
   웹캠 영상은 이 페이지 밖으로 나가지 않는다. 라이브러리와 모델 파일만 CDN에서 내려받는다. */
(function (root) {
'use strict';

const BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PALM = [0, 5, 9, 13, 17];

const H = { on: false, busy: false, stream: null, hl: null, delegate: '', video: null, cb: null, raf: 0, lastT: -1, errs: 0, fps: 0, _p: null, _frames: [] };

/* 모델 불러오기 (한 번만) */
H.load = function () {
  if (H._p) return H._p;
  H._p = (async () => {
    const vision = await import(BASE + '/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks(BASE + '/wasm');
    const make = delegate => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    H._make = make;
    const wantCpu = /[?&]cpu=1/.test(location.search);
    if (!wantCpu) { try { H.hl = await make('GPU'); H.delegate = 'GPU'; return H.hl; } catch (_) { /* CPU로 */ } }
    H.hl = await make('CPU'); H.delegate = 'CPU';
    return H.hl;
  })();
  H._p.catch(() => { H._p = null; });
  return H._p;
};

/* 카메라를 켜고 매 프레임 cb(sample|null, 초)를 부른다.
   sample.x/y/size: 거울상 화면에서 손바닥 중심과 손 크기 (영상 높이 단위),
   sample.nx/ny: 0~1로 정규화한 거울상 위치, sample.lm: 원본 랜드마크 21개 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FATAL = { NotAllowedError: 1, SecurityError: 1, NotFoundError: 1, NotSupportedError: 1 };

/* 카메라 목록 (적외선·깊이 카메라는 뒤로). 권한을 한 번 받은 뒤라야 이름이 나온다 */
H.cameras = async function () {
  try {
    const ir = /\b(ir|infrared|depth)\b|적외선/i;
    const cams = (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || '카메라 ' + (i + 1) }));
    return cams.sort((a, b) => ir.test(a.label) - ir.test(b.label));
  } catch (_) { return []; }
};

/* 카메라 하나를 연다. 해상도·프레임 조건이 안 맞아 실패하는 드라이버가 있어서 조건을 단계적으로 줄여 가며 시도한다 */
async function openOne(deviceId) {
  const base = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' };
  const tries = [
    Object.assign({ width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, base),
    Object.assign({ width: { ideal: 640 }, height: { ideal: 480 } }, base),
    deviceId ? base : true,
  ];
  let last;
  for (let i = 0; i < tries.length; i++) {
    try { return await navigator.mediaDevices.getUserMedia({ video: tries[i], audio: false }); }
    catch (e) { last = e; if (FATAL[e.name]) throw e; await sleep(250); }
  }
  throw last;
}

/* 기본 카메라가 안 열리면 다른 카메라를 하나씩 시도한다
   (노트북엔 윈도우 헬로용 적외선 카메라가 같이 있어서 기본 장치가 엉뚱한 쪽일 수 있다) */
async function openStream(deviceId) {
  try { return await openOne(deviceId); }
  catch (e) {
    if (deviceId || FATAL[e.name]) throw e;
    for (const c of await H.cameras()) { try { return await openOne(c.id); } catch (_) { /* 다음 카메라 */ } }
    throw e;
  }
}

H.start = async function (video, cb, deviceId) {
  if (H.on || H.busy) return;
  H.busy = true; H.video = video; H.cb = cb;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    }
    H.stream = await openStream(deviceId);
    const track = H.stream.getVideoTracks()[0];
    H.deviceId = (track && track.getSettings && track.getSettings().deviceId) || '';
    video.srcObject = H.stream;
    try { await video.play(); } catch (_) { await sleep(200); await video.play(); }
    await H.load();
    H.on = true; H.errs = 0; H.lastT = -1; H._frames.length = 0;
    schedule();
  } catch (err) {
    H.stop();
    throw err;
  } finally {
    H.busy = false;
  }
};

H.stop = function () {
  H.on = false;
  if (H.raf) { try { cancelAnimationFrame(H.raf); } catch (_) {} H.raf = 0; }
  if (H.stream) H.stream.getTracks().forEach(t => t.stop());
  H.stream = null;
  if (H.video) { try { H.video.pause(); } catch (_) {} H.video.srcObject = null; }
};

function schedule() {
  if (!H.on) return;
  H.raf = requestAnimationFrame(tick);
}

function tick() {
  if (!H.on) return;
  schedule();
  const v = H.video;
  if (v.readyState < 2 || v.currentTime === H.lastT) return;
  H.lastT = v.currentTime;
  let lm = null;
  try {
    const r = H.hl.detectForVideo(v, performance.now());
    lm = (r.landmarks && r.landmarks[0]) || null;
    H.errs = 0;
  } catch (e) {
    // GPU가 중간에 말썽이면 CPU로 갈아탄다
    if (++H.errs >= 5 && H.delegate === 'GPU' && H._make) {
      H.errs = 0; H.delegate = 'CPU';
      const old = H.hl; H.hl = null;
      H._make('CPU').then(hl => { H.hl = hl; try { old && old.close(); } catch (_) {} }).catch(() => {});
      return;
    }
    if (!H.hl) return;
  }
  const t = performance.now() / 1000;
  const fr = H._frames; fr.push(t); while (fr.length > 20) fr.shift();
  H.fps = fr.length > 2 ? (fr.length - 1) / (t - fr[0]) : 0;
  if (!lm) { H.cb(null, t); return; }
  const asp = (v.videoWidth || 640) / (v.videoHeight || 480);
  let px = 0, py = 0;
  for (const i of PALM) { px += lm[i].x; py += lm[i].y; }
  px /= PALM.length; py /= PALM.length;
  H.cb({
    x: (1 - px) * asp, y: py, nx: 1 - px, ny: py,
    size: Math.hypot((lm[0].x - lm[9].x) * asp, lm[0].y - lm[9].y),
    lm,
  }, t);
}

root.Hands = H;
})(window);
