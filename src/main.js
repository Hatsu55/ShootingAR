// ==== ShootingAR - ArUco (MIP_36h12) 命中判定修正版 ====

// ---------- DOM ----------
const hud = document.getElementById('hud');
const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');  // 検出描画
const fx = document.getElementById('fx');            // フラッシュ専用
const shootBtn = document.getElementById('shootBtn');
const reticleEl = document.getElementById('reticle');

// ---------- 設定（調整可） ----------
const CONF = {
  dictionaryName: 'ARUCO_MIP_36h12',
  maxHammingDistance: 5,
  sampleScale: 0.75,              // 検出用縮小率（0.6〜1.0）
  detectEvery: 1,                 // 何フレームおきに検出（自動調整あり）
  autoSkip: true,
  targetDetectMs: 20,
  preFilter: 'contrast(1.12) brightness(1.04)',

  // ★命中判定まわり（今回の修正点）
  requireStableForHit: false,     // ← 安定検出に限定せず、現フレーム検出もヒット対象に
  hitWindowMs: 350,               // ← SHOOT後にヒットを受け付ける時間
  // reticleRadius は DOM から算出（CSS→Canvas 変換）。固定にしたければ null を数値(px)に
  fixedReticleRadiusPx: null
};

// ---------- ログ ----------
function logHud(lines) { hud.textContent = lines.join('\n'); }
function appendLog(...a){ console.log(...a); }

// ---------- Canvas ----------
const oCtx = overlay.getContext('2d', { willReadFrequently: true });
const fCtx = fx.getContext('2d', { willReadFrequently: true });
const detectCanvas = document.createElement('canvas');
const dCtx = detectCanvas.getContext('2d', { willReadFrequently: true });

// ---------- カメラ ----------
async function openCamera() {
  const constraints = {
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();

  const vw = video.videoWidth || 960;
  const vh = video.videoHeight || 540;

  overlay.width = fx.width = vw;
  overlay.height = fx.height = vh;

  detectCanvas.width = Math.max(320, Math.round(vw * CONF.sampleScale));
  detectCanvas.height = Math.max(180, Math.round(vh * CONF.sampleScale));

  appendLog('camera opened:', vw, 'x', vh, ' detect=', detectCanvas.width, 'x', detectCanvas.height);
}

// ---------- 検出器 ----------
let detector = null;
function createDetector() {
  if (!window.AR || !AR.Detector) {
    alert('AR.Detector が見つかりません。cv.js / aruco.js の読み込みを確認してください。');
    throw new Error('AR.Detector not found');
  }
  detector = new AR.Detector({
    dictionaryName: CONF.dictionaryName,
    maxHammingDistance: CONF.maxHammingDistance
  });
}

// ---------- ループ制御 ----------
let lastTime = performance.now();
let fpsList = [];
let frameCount = 0;
let detectMsList = [];
let currentSkip = CONF.detectEvery;

let prevIds = new Set();
let stableIds = new Set();

let lastShotAt = 0;  // SHOOT押下時刻（ms）
let flashUntil = 0;  // フラッシュ終了予定時刻（ms）

function calcAvg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

// ---------- フラッシュ ----------
function showFlash(color='rgba(255,0,0,0.22)', durationMs=120) {
  flashUntil = performance.now() + durationMs;
  fCtx.clearRect(0,0,fx.width,fx.height);
  fCtx.fillStyle = color;
  fCtx.fillRect(0,0,fx.width,fx.height);
  setTimeout(() => {
    if (performance.now() >= flashUntil) fCtx.clearRect(0,0,fx.width,fx.height);
  }, durationMs + 16);
}

// ---------- 安定化（連続フレーム） ----------
function updateStability(markers) {
  const ids = new Set(markers.map(m => m.id));
  const stable = new Set();
  for (const id of ids) if (prevIds.has(id)) stable.add(id);
  stableIds = stable;
  prevIds = ids;
}

// ---------- レティクル半径（CSS→Canvasの変換） ----------
function getReticleRadiusCanvasPx() {
  if (typeof CONF.fixedReticleRadiusPx === 'number') return CONF.fixedReticleRadiusPx;

  const rect = reticleEl.getBoundingClientRect(); // CSSピクセルでの直径
  // overlay の CSSサイズ → Canvas内部ピクセルへの変換係数
  const scaleX = overlay.width / overlay.clientWidth;
  const scaleY = overlay.height / overlay.clientHeight;
  const radiusCss = rect.width / 2;
  // 画面は等方スケール想定。X,Y の平均で十分
  const radiusCanvas = radiusCss * (scaleX + scaleY) / 2;
  return radiusCanvas;
}

// ---------- 描画 ----------
function drawMarkers(markers, scaleX, scaleY) {
  oCtx.clearRect(0,0,overlay.width,overlay.height);
  oCtx.lineWidth = 3;

  for (const m of markers) {
    const cs = m.corners;
    oCtx.strokeStyle = stableIds.has(m.id) ? 'rgba(0,255,0,0.95)' : 'rgba(0,255,0,0.55)';
    oCtx.beginPath();
    oCtx.moveTo(cs[0].x*scaleX, cs[0].y*scaleY);
    for (let i=1;i<cs.length;i++) oCtx.lineTo(cs[i].x*scaleX, cs[i].y*scaleY);
    oCtx.closePath(); oCtx.stroke();

    const cx = (cs[0].x + cs[1].x + cs[2].x + cs[3].x)/4 * scaleX;
    const cy = (cs[0].y + cs[1].y + cs[2].y + cs[3].y)/4 * scaleY;
    m.center = { x: cx, y: cy };

    oCtx.fillStyle = '#0f0';
    oCtx.beginPath(); oCtx.arc(cx, cy, 4, 0, Math.PI*2); oCtx.fill();
    oCtx.font = '16px monospace'; oCtx.fillText(String(m.id), cx+6, cy-6);
  }

  if (flashUntil && performance.now() >= flashUntil) {
    fCtx.clearRect(0,0,fx.width,fx.height);
    flashUntil = 0;
  }
}

// ---------- 命中判定 ----------
function isHit(markers) {
  const rx = overlay.width/2, ry = overlay.height/2;
  const r = getReticleRadiusCanvasPx();
  const r2 = r * r;

  for (const m of markers) {
    const dx = m.center.x - rx, dy = m.center.y - ry;
    if (dx*dx + dy*dy <= r2) return m;
  }
  return null;
}

// ---------- 検出1回 ----------
function detectOnce() {
  dCtx.filter = CONF.preFilter;
  dCtx.drawImage(video, 0, 0, detectCanvas.width, detectCanvas.height);
  dCtx.filter = 'none';

  const t0 = performance.now();
  const img = dCtx.getImageData(0, 0, detectCanvas.width, detectCanvas.height);
  const markers = detector.detect(img) || [];
  const t1 = performance.now();

  detectMsList.push(t1 - t0);
  if (detectMsList.length > 30) detectMsList.shift();

  return markers;
}

// ---------- ループ ----------
function tick() {
  const now = performance.now();
  const fps = 1000 / (now - lastTime);
  lastTime = now;
  fpsList.push(fps);
  if (fpsList.length > CONF.fpsWindow) fpsList.shift();

  // フレームスキップ
  if ((frameCount++ % currentSkip) !== 0) {
    scheduleNext();
    return;
  }

  const markers = detectOnce();
  const scaleX = overlay.width / detectCanvas.width;
  const scaleY = overlay.height / detectCanvas.height;

  updateStability(markers);
  drawMarkers(markers, scaleX, scaleY);

  // HUD
  const avgFps = calcAvg(fpsList).toFixed(1);
  const avgDet = calcAvg(detectMsList).toFixed(1);
  const rpx = Math.round(getReticleRadiusCanvasPx());
  const stableCount = [...stableIds].length;
  logHud([
    `tags=${markers.length} (stable=${stableCount})`,
    `fps(avg)=${avgFps}  dt(avg)=${avgDet}ms  skip=${currentSkip}`,
    `(screen ${overlay.width}x${overlay.height}) (detect ${detectCanvas.width}x${detectCanvas.height})`,
    `dict=${CONF.dictionaryName}  maxHD=${CONF.maxHammingDistance}`,
    `reticleR(px)=${rpx}  requireStableForHit=${CONF.requireStableForHit}`
  ]);

  // SHOOT 後 ヒット判定
  if (now - lastShotAt < CONF.hitWindowMs) {
    const candidate = CONF.requireStableForHit
      ? markers.filter(m => stableIds.has(m.id))
      : markers;
    const hit = isHit(candidate);
    if (hit) {
      showFlash('rgba(0,255,0,0.30)', 140);
      lastShotAt = 0; // 一度で終了
    }
  }

  // 自動スキップ調整
  if (CONF.autoSkip && detectMsList.length >= 10) {
    const det = parseFloat(avgDet);
    if (det > CONF.targetDetectMs + 10 && currentSkip < 3) currentSkip++;
    else if (det < CONF.targetDetectMs - 5 && currentSkip > 1) currentSkip--;
  }

  scheduleNext();
}

function scheduleNext() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => tick());
  } else {
    requestAnimationFrame(() => tick());
  }
}

// ---------- 起動 ----------
async function start() {
  await openCamera();
  createDetector();
  scheduleNext();
  appendLog('AR.Detector ready. dict=', CONF.dictionaryName);

  shootBtn.addEventListener('click', () => {
    lastShotAt = performance.now();
    showFlash('rgba(255,0,0,0.22)', 100); // 押下時は赤
  });

  // 画面回転や表示サイズが変わったときも半径が追従するよう、resizeでHUD更新
  window.addEventListener('resize', () => {
    // HUDの半径表示だけ更新（判定は毎フレーム getReticleRadiusCanvasPx() で再計算）
    const rpx = Math.round(getReticleRadiusCanvasPx());
    appendLog('resize reticleR(px)=', rpx);
  });
}

start().catch(e => {
  console.error(e);
  alert(`起動失敗: ${e.message}`);
});
