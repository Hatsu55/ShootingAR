// ==== ShootingAR - ArUco (MIP_36h12) 改良版（フラッシュ可視化 + FPS/遅延改善）====

// ---------- DOM ----------
const hud = document.getElementById('hud');
const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const fx = document.getElementById('fx');
const shootBtn = document.getElementById('shootBtn');

// ---------- 設定（調整可） ----------
const CONF = {
  dictionaryName: 'ARUCO_MIP_36h12', // ← ここはMIP_36h12固定
  maxHammingDistance: 5,             // 誤検出抑制（下げると厳しくなる）
  sampleScale: 0.75,                 // 検出用に縮小して処理（0.6〜1.0 推奨）
  detectEvery: 1,                    // 何フレームおきに検出するか（自動調整あり）
  preFilter: 'contrast(1.12) brightness(1.04)',
  reticleRadiusPx: 40,               // 命中半径(px)
  fpsWindow: 30,                     // FPS 移動平均
  autoSkip: true,                    // 自動スキップON
  targetDetectMs: 20                 // 検出平均がこのmsを超えたらスキップ増やす
};

// ---------- ログ ----------
function logHud(lines) {
  hud.textContent = lines.join('\n');
}
function appendLog(...a) {
  console.log(...a);
}

// ---------- Canvas ----------
const oCtx = overlay.getContext('2d', { willReadFrequently: true });
const fCtx = fx.getContext('2d', { willReadFrequently: true });

// 検出専用のオフスクリーンキャンバス（画面には出さない）
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

  // 画面キャンバスを実映像サイズに合わせる
  const vw = video.videoWidth || 960;
  const vh = video.videoHeight || 540;
  overlay.width = fx.width = vw;
  overlay.height = fx.height = vh;

  // 検出は縮小キャンバスで（sampleScale）
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

let lastShotAt = 0;
let flashUntil = 0; // ミリ秒（performance.now基準）

function calcAvg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

// ---------- フラッシュ（fxキャンバスに描く：検出描画に消されない） ----------
function showFlash(color='rgba(255,0,0,0.22)', durationMs=120) {
  flashUntil = performance.now() + durationMs;
  // 即座に描く（次フレームまで待たない）
  fCtx.clearRect(0,0,fx.width,fx.height);
  fCtx.fillStyle = color;
  fCtx.fillRect(0,0,fx.width,fx.height);
  // 一定時間後に消す（描画ループでも監視）
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

  // フラッシュの残像処理（必要時間を過ぎたら fx をクリア）
  if (flashUntil && performance.now() >= flashUntil) {
    fCtx.clearRect(0,0,fx.width,fx.height);
    flashUntil = 0;
  }
}

// ---------- 命中判定 ----------
function isHit(markers) {
  const rx = overlay.width/2, ry = overlay.height/2, r2 = CONF.reticleRadiusPx ** 2;
  for (const m of markers) {
    const dx = m.center.x - rx, dy = m.center.y - ry;
    if (dx*dx + dy*dy <= r2) return m;
  }
  return null;
}

// ---------- 検出1回 ----------
function detectOnce() {
  // 軽い前処理（露出ゆれ対策）
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

// ---------- ループ（requestVideoFrameCallback優先） ----------
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

  // 検出
  const markers = detectOnce();

  // 検出結果を画面サイズへスケール
  const scaleX = overlay.width / detectCanvas.width;
  const scaleY = overlay.height / detectCanvas.height;

  updateStability(markers);
  drawMarkers(markers, scaleX, scaleY);

  // HUD
  const avgFps = calcAvg(fpsList).toFixed(1);
  const avgDet = calcAvg(detectMsList).toFixed(1);
  logHud([
    `tags=${markers.length} (stable=${[...stableIds].length})`,
    `fps(avg)=${avgFps}  dt(avg)=${avgDet}ms  skip=${currentSkip}`,
    `(screen ${overlay.width}x${overlay.height}) (detect ${detectCanvas.width}x${detectCanvas.height})`,
    `dict=${CONF.dictionaryName}  maxHD=${CONF.maxHammingDistance}`
  ]);

  // SHOOT 後 200ms 以内にヒット判定（安定タグのみ）
  if (performance.now() - lastShotAt < 200) {
    const hit = isHit(markers.filter(m => stableIds.has(m.id)));
    if (hit) { showFlash('rgba(0,255,0,0.30)', 140); lastShotAt = 0; }
  }

  // 自動スキップ調整
  if (CONF.autoSkip && detectMsList.length >= 10) {
    const det = parseFloat(avgDet);
    if (det > CONF.targetDetectMs + 10 && currentSkip < 3) currentSkip++;        // 重い → もっと間引く
    else if (det < CONF.targetDetectMs - 5 && currentSkip > 1) currentSkip--;     // 余裕 → 間引きを減らす
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

  // クリック（タップ）時に赤フラッシュを即表示（検出で消されない）
  shootBtn.addEventListener('click', () => {
    lastShotAt = performance.now();
    showFlash('rgba(255,0,0,0.22)', 100);
  });
}

start().catch(e => {
  console.error(e);
  alert(`起動失敗: ${e.message}`);
});
