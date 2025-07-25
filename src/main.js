// src/main.js
// ShootingAR (Aruco fallback) - 完全版
// 依存: public/vendor/aruco/cv.js, aruco.js, posit1.js（読み込み順厳守）

const hud = document.getElementById('hud');
function log(...args) {
  const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  hud.textContent = (hud.textContent + '\n' + line).split('\n').slice(-30).join('\n'); // 直近30行だけ
  // console.log も出しておく
  console.log(...args);
}

function assert(cond, ...msg) {
  if (!cond) {
    const m = msg.join(' ') || 'assertion failed';
    log('[ASSERT]', m);
    throw new Error(m);
  }
}

// --- ここでグローバルに AR.* があるか確認 ---
assert(window.AR && typeof window.AR.Detector === 'function',
  'AR.Detector が見つかりません。cv.js / aruco.js の読み込み順とパスを確認してください。');

// =========================
//   コンフィグ（推奨値）
// =========================
const CONF = {
  // デバイスの実カメラ解像度によって勝手に縮むことがあります
  videoWidth:  960,
  videoHeight: 540,
  // 1フレームおきに検出して負荷を落とす（重ければ 2, 3 と増やす）
  detectEvery: 1,
  // FPS の移動平均
  fpsWindow: 30,
  // 検出が多すぎるときの上限
  maxMarkersToDraw: 32,
  // ヒット判定用（レティクル半径 px）
  reticleRadiusPx: 40,
  // ArUco2 の辞書（'ARUCO' or 'ARUCO_MIP_36h12'）
  dictionaryName: 'ARUCO',
  // 検出結果のバウンディングボックスの線幅
  strokeWidth: 3
};

// =========================
//   DOM 取得
// =========================
const video = document.getElementById('cam');
const view  = document.getElementById('view');
const over  = document.getElementById('overlay');
const shootBtn = document.getElementById('shootBtn');

view.width  = over.width  = CONF.videoWidth;
view.height = over.height = CONF.videoHeight;

// 画面サイズにフィットさせる（CSS ですでに cover しているのでここでは固定のままでもOK）

const vCtx = view.getContext('2d');
const oCtx = over.getContext('2d');

// =========================
//   ArUco Detector 準備
// =========================
const detector = new AR.Detector({
  dictionaryName: CONF.dictionaryName
});
log('AR.Detector ready. dict=', CONF.dictionaryName);

// =========================
//   カメラ開始
// =========================
async function openCamera() {
  const constraints = {
    audio: false,
    video: {
      facingMode: 'environment',
      width:  { ideal: CONF.videoWidth  },
      height: { ideal: CONF.videoHeight }
    }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
  log('camera opened:', video.videoWidth, 'x', video.videoHeight);
  // 実際の取得サイズに合わせて canvas も合わせる
  view.width  = over.width  = video.videoWidth  || CONF.videoWidth;
  view.height = over.height = video.videoHeight || CONF.videoHeight;
}

// =========================
//   検出ループ
// =========================
let lastTime = performance.now();
let frameCount = 0;
let fpsList = [];
let lastShotAt = 0;

function calcFPS() {
  const now = performance.now();
  const dt  = now - lastTime;
  lastTime = now;
  const fps = 1000 / dt;
  fpsList.push(fps);
  if (fpsList.length > CONF.fpsWindow) fpsList.shift();
  const avg = fpsList.reduce((a, b) => a + b, 0) / fpsList.length;
  return avg.toFixed(1);
}

function drawMarkers(markers) {
  oCtx.clearRect(0, 0, over.width, over.height);
  oCtx.lineWidth = CONF.strokeWidth;

  for (let i = 0; i < markers.length && i < CONF.maxMarkersToDraw; i++) {
    const m = markers[i];
    const corners = m.corners;

    // 線
    oCtx.strokeStyle = 'rgba(0,255,0,0.9)';
    oCtx.beginPath();
    for (let j = 0; j < corners.length; j++) {
      const p = corners[j];
      if (j === 0) oCtx.moveTo(p.x, p.y); else oCtx.lineTo(p.x, p.y);
    }
    oCtx.closePath();
    oCtx.stroke();

    // 中心点 & id
    const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;

    oCtx.fillStyle = 'rgba(0,255,0,0.9)';
    oCtx.beginPath();
    oCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    oCtx.fill();

    oCtx.fillStyle = '#0f0';
    oCtx.font = '16px monospace';
    oCtx.fillText(String(m.id), cx + 6, cy - 6);
  }
}

function isHitByReticle(markers) {
  const rx = over.width / 2;
  const ry = over.height / 2;
  const r2 = CONF.reticleRadiusPx * CONF.reticleRadiusPx;

  for (const m of markers) {
    const corners = m.corners;
    const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;

    const dx = cx - rx;
    const dy = cy - ry;
    if (dx * dx + dy * dy <= r2) {
      return m; // 最初に当たったマーカーを返す
    }
  }
  return null;
}

async function detectLoop() {
  requestAnimationFrame(detectLoop);

  if (video.readyState < 2) return; // メタデータ未取得

  // 1フレームおきに検出（重ければ CONF.detectEvery を増やす）
  if (frameCount++ % CONF.detectEvery !== 0) {
    return;
  }

  // video -> canvas
  vCtx.drawImage(video, 0, 0, view.width, view.height);
  const imageData = vCtx.getImageData(0, 0, view.width, view.height);

  // detect
  const markers = detector.detect(imageData);

  drawMarkers(markers);

  const fps = calcFPS();
  hud.textContent =
    `markers=${markers.length}\n` +
    `fps(avg)=${fps}\n` +
    `(w=${view.width}, h=${view.height})\n` +
    `dict=${CONF.dictionaryName}`;

  // SHOOT ボタンが押されたあと 200ms 以内にヒット判定をする簡単な仕組み
  if (performance.now() - lastShotAt < 200) {
    const hit = isHitByReticle(markers);
    if (hit) {
      log(`[HIT] id=${hit.id}`);
      flashOverlay('rgba(0,255,0,0.3)');
      lastShotAt = 0; // 一回で終わらせる
    } else {
      // ミスでも何もしない
    }
  }
}

function flashOverlay(color = 'rgba(255,255,255,0.2)', durationMs = 120) {
  oCtx.save();
  oCtx.fillStyle = color;
  oCtx.fillRect(0, 0, over.width, over.height);
  oCtx.restore();
  setTimeout(() => {
    // 直後の drawMarkers で上書きされるので実際不要
  }, durationMs);
}

// =========================
//   エントリ
// =========================
async function start() {
  try {
    await openCamera();
    log('typeof AR.Detector:', typeof AR.Detector);
    detectLoop();
  } catch (e) {
    console.error(e);
    log('起動に失敗しました:', e.message);
  }
}

shootBtn.addEventListener('click', () => {
  lastShotAt = performance.now();
  flashOverlay('rgba(255,0,0,0.25)', 80);
});

start();
