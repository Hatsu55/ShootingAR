// ==== ShootingAR - ArUco (MIP_36h12) 命中/エフェクト整合 + 更新高速化 版 ====

// ---------- DOM ----------
const hud = document.getElementById('hud');
const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');  // 検出描画
const fx = document.getElementById('fx');            // フラッシュ専用（検出描画で消さない）
const shootBtn = document.getElementById('shootBtn');
const reticleEl = document.getElementById('reticle');

// ---------- 設定（必要に応じて調整） ----------
const CONF = {
  dictionaryName: 'ARUCO_MIP_36h12',
  maxHammingDistance: 5,

  // 検出負荷と応答性のバランス
  sampleScale: 0.85,      // 検出用縮小率（0.6〜1.0）。大きいほど安定/精度↑, ただし重い
  detectEvery: 1,         // 何フレームおきに検出するか（=1で毎フレーム）
  autoSkip: false,        // 自動スキップOFF（応答性優先）
  targetDetectMs: 20,     // autoSkipを使う場合のみ有効

  preFilter: 'contrast(1.12) brightness(1.04)',

  // ヒット判定
  requireStableForHit: false, // 連続2フレームの安定検出に限定するなら true
  hitWindowMs: 350,           // SHOOT後この時間だけ命中を受付

  // レティクル半径：nullでDOMから自動算出。固定なら数値(px)を入れる
  fixedReticleRadiusPx: null,

  // HUD
  fpsWindow: 30,
};

// ---------- ログ ----------
function logHud(lines) { hud.textContent = lines.join('\n'); }
function dbg(...a){ console.log(...a); }

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

  const vw = video.videoWidth || 960;
  const vh = video.videoHeight || 540;

  overlay.width = fx.width = vw;
  overlay.height = fx.height = vh;

  detectCanvas.width = Math.max(320, Math.round(vw * CONF.sampleScale));
  detectCanvas.height = Math.max(180, Math.round(vh * CONF.sampleScale));

  dbg('camera opened:', vw, 'x', vh, ' detect=', detectCanvas.width, 'x', detectCanvas.height);
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

// ---------- ループ制御・統計 ----------
let lastTime = performance.now();
let fpsList = [];
let frameCount = 0;
let detectMsList = [];
let currentSkip = CONF.detectEvery;

let prevIds = new Set();
let stableIds = new Set();

// SHOOTの扱い：赤は“ミス時のみ後出し”、緑は“命中時のみ”
let shotSeq = 0;          // ショットごとにインクリメント
let missTimer = null;     // 外したときに赤を出すための遅延タイマー
let flashUntil = 0;       // フラッシュ終了予定時刻（ms）

function calcAvg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

// ---------- フラッシュ（fxキャンバスに描画） ----------
function showFlash(color='rgba(255,0,0,0.22)', durationMs=120) {
  flashUntil = performance.now() + durationMs;
  fCtx.clearRect(0,0,fx.width,fx.height);
  fCtx.fillStyle = color;
  fCtx.fillRect(0,0,fx.width,fx.height);
  setTimeout(() => {
    if (performance.now() >= flashUntil) fCtx.clearRect(0,0,fx.width,fx.height);
  }, durationMs + 16);
}

// ---------- 安定化（連続フレームで出ているIDだけ“安定”） ----------
function updateStability(markers) {
  const ids = new Set(markers.map(m => m.id));
  const stable = new Set();
  for (const id of ids) if (prevIds.has(id)) stable.add(id);
  stableIds = stable;
  prevIds = ids;
}

// ---------- レティクル半径（CSS→Canvas座標に変換） ----------
function getReticleRadiusCanvasPx() {
  if (typeof CONF.fixedReticleRadiusPx === 'number') return CONF.fixedReticleRadiusPx;
  const rect = reticleEl.getBoundingClientRect(); // CSSピクセルでの直径
  const scaleX = overlay.width / overlay.clientWidth;
  const scaleY = overlay.height / overlay.clientHeight;
  const radiusCss = rect.width / 2;
  return radiusCss * (scaleX + scaleY) / 2; // 等方スケール想定
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

  // フラッシュの残像管理
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
  // 軽い前処理
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

  // ---- SHOOT後の命中／ミス判定 ----
  if (shotSeq !== 0) {
    // 候補：安定限定 or 現フレームのすべて
    const candidate = CONF.requireStableForHit ? markers.filter(m => stableIds.has(m.id)) : markers;
    const hit = isHit(candidate);
    if (hit) {
      // 命中 → 緑フラッシュのみ（赤は出さない）
      clearTimeout(missTimer);
      missTimer = null;
      showFlash('rgba(0,255,0,0.30)', 140);
      shotSeq = 0;
    }
    // ミス時の赤は setTimeout 側で発火（この瞬間は何もしない）
  }

  // 自動スキップ調整（OFFのときは無視）
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
  dbg('AR.Detector ready. dict=', CONF.dictionaryName);

  // SHOOT：赤は“外したときだけ後出し”。ここでは赤を出さない。
  shootBtn.addEventListener('click', () => {
    // 新しいショットを開始
    shotSeq++;
    const mySeq = shotSeq;

    // 既存ミスタイマーをクリア
    if (missTimer) { clearTimeout(missTimer); missTimer = null; }

    // ヒットウィンドウ終了時点でまだ同じショットが存続していれば「ミス」＝赤フラッシュ
    missTimer = setTimeout(() => {
      if (shotSeq === mySeq) {
        showFlash('rgba(255,0,0,0.22)', 110); // ミスのみ赤
        shotSeq = 0;
        missTimer = null;
      }
    }, CONF.hitWindowMs);
  });

  // 画面回転や表示サイズが変わったときにHUD用の半径表示を更新
  window.addEventListener('resize', () => {
    const rpx = Math.round(getReticleRadiusCanvasPx());
    dbg('resize reticleR(px)=', rpx);
  });
}

start().catch(e => {
  console.error(e);
  alert(`起動失敗: ${e.message}`);
});
