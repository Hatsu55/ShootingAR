// ==== ShootingAR - ArUco (MIP_36h12) 安定版 ====

// ---------- DOM ----------
const hud = document.getElementById('hud');
const video = document.getElementById('cam');
const view  = document.getElementById('view');
const over  = document.getElementById('overlay');
const shootBtn = document.getElementById('shootBtn');

// ---------- 設定 ----------
const CONF = {
  preFilter: 'contrast(1.15) brightness(1.05)', // 室内向けの軽い調整
  fpsWindow: 30,
  detectEvery: 1,             // 重い場合は 2,3 と上げる
  reticleRadiusPx: 40,
  dictionaryName: 'ARUCO_MIP_36h12', // ← ここが重要（MIP_36h12 に統一）
  maxHammingDistance: 5       // 誤検出抑制（0〜12）値を下げるほど厳しくなる
};

// ---------- ログ ----------
function log(...a){
  console.log(...a);
  const line = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ');
  hud.textContent = (line + '\n' + hud.textContent).split('\n').slice(0, 30).join('\n');
}

// ---------- Canvas ----------
const vCtx = view.getContext('2d', { willReadFrequently: true });
const oCtx = over.getContext('2d', { willReadFrequently: true });

// ---------- カメラ ----------
async function openCamera() {
  const constraints = {
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();

  view.width  = over.width  = video.videoWidth  || 960;
  view.height = over.height = video.videoHeight || 540;
  log('camera opened:', view.width, 'x', view.height);
}

// ---------- 検出器 ----------
let detector = null;

function createDetector(){
  if (!window.AR || !AR.Detector) {
    throw new Error('AR.Detector が見つかりません。cv.js / aruco.js の読み込みを確認してください。');
  }
  detector = new AR.Detector({
    dictionaryName: CONF.dictionaryName,
    maxHammingDistance: CONF.maxHammingDistance
  });
  log('AR.Detector ready. dict=', CONF.dictionaryName);
}

// ---------- 安定化 ----------
let lastTime = performance.now();
let fpsList = [], frameCount = 0;
let prevIds = new Set(), stableIds = new Set();
let lastShotAt = 0;

function calcFPS(){
  const now = performance.now(), fps = 1000 / (now - lastTime); lastTime = now;
  fpsList.push(fps); if (fpsList.length > CONF.fpsWindow) fpsList.shift();
  return (fpsList.reduce((a,b)=>a+b,0)/fpsList.length).toFixed(1);
}

function updateStability(markers){
  const ids = new Set(markers.map(m => m.id));
  const newStable = new Set();
  for (const id of ids) if (prevIds.has(id)) newStable.add(id);
  stableIds = newStable;
  prevIds = ids;
}

function drawMarkers(markers){
  oCtx.clearRect(0,0,over.width,over.height);
  oCtx.lineWidth = 3;
  for (const m of markers) {
    const cs = m.corners;
    oCtx.strokeStyle = stableIds.has(m.id) ? 'rgba(0,255,0,0.95)' : 'rgba(0,255,0,0.55)';
    oCtx.beginPath();
    oCtx.moveTo(cs[0].x, cs[0].y);
    for (let i=1;i<cs.length;i++) oCtx.lineTo(cs[i].x, cs[i].y);
    oCtx.closePath(); oCtx.stroke();

    const cx = m.corners.reduce((s,c)=>s+c.x,0)/4;
    const cy = m.corners.reduce((s,c)=>s+c.y,0)/4;
    oCtx.fillStyle = '#0f0';
    oCtx.beginPath(); oCtx.arc(cx, cy, 4, 0, Math.PI*2); oCtx.fill();
    oCtx.font = '16px monospace'; oCtx.fillText(String(m.id), cx+6, cy-6);
    m.center = { x: cx, y: cy };
  }
}

function isHit(markers){
  const rx = over.width/2, ry = over.height/2, r2 = CONF.reticleRadiusPx ** 2;
  for (const m of markers) {
    const cx = m.center.x, cy = m.center.y;
    const dx = cx - rx, dy = cy - ry;
    if (dx*dx + dy*dy <= r2) return m;
  }
  return null;
}

function flash(color='rgba(0,255,0,0.25)'){
  oCtx.save(); oCtx.fillStyle = color; oCtx.fillRect(0,0,over.width,over.height); oCtx.restore();
}

// ---------- メインループ ----------
async function detectLoop(){
  requestAnimationFrame(detectLoop);
  if (video.readyState < 2 || !detector) return;
  if (frameCount++ % CONF.detectEvery !== 0) return;

  // 軽い前処理（露出ゆれ対策）
  vCtx.filter = CONF.preFilter;
  vCtx.drawImage(video, 0, 0, view.width, view.height);
  vCtx.filter = 'none';

  const imageData = vCtx.getImageData(0,0,view.width, view.height);
  let markers = [];
  try {
    markers = detector.detect(imageData);
  } catch (e) {
    console.error('[AR.Detector.detect] failed', e);
  }

  updateStability(markers);
  drawMarkers(markers);

  const fps = calcFPS();
  hud.textContent =
    `tags=${markers.length} (stable=${[...stableIds].length})\n` +
    `fps(avg)=${fps}\n` +
    `(w=${view.width}, h=${view.height})\n` +
    `dict=${CONF.dictionaryName}  maxHD=${CONF.maxHammingDistance}`;

  // SHOOT 後 200ms 以内にヒット判定（安定タグのみ）
  if (performance.now() - lastShotAt < 200) {
    const hit = isHit(markers.filter(m => stableIds.has(m.id)));
    if (hit) { flash('rgba(0,255,0,0.30)'); lastShotAt = 0; }
  }
}

shootBtn.addEventListener('click', ()=>{
  lastShotAt = performance.now();
  flash('rgba(255,0,0,0.22)');
});

// ---------- 起動 ----------
(async () => {
  try {
    await openCamera();
    createDetector();
    detectLoop();
  } catch (e) {
    console.error(e);
    log('起動失敗:', e.message);
  }
})();
