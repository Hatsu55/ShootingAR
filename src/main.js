// ==== ShootingAR - AprilTag 36h11 安定版 ====

// ---------- DOM & ログ ----------
const hud = document.getElementById('hud');
const video = document.getElementById('cam');
const view  = document.getElementById('view');
const over  = document.getElementById('overlay');
const shootBtn = document.getElementById('shootBtn');

function log(...a){
  console.log(...a);
  const line = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ');
  hud.textContent = (line + '\n' + hud.textContent).split('\n').slice(0, 30).join('\n');
}

// ---------- 設定 ----------
const CONF = {
  preFilter: 'contrast(1.12) brightness(1.04)', // 室内向けの軽い調整
  fpsWindow: 30,
  detectEvery: 1,          // 重ければ 2,3 と上げる
  reticleRadiusPx: 40      // 命中半径(px)
};

// ---------- Canvas context ----------
const vCtx = view.getContext('2d', { willReadFrequently: true });
const oCtx = over.getContext('2d', { willReadFrequently: true });

// ---------- AprilTag ロード ----------
let apriltag = null;
async function loadApriltag() {
  return new Promise((resolve, reject) => {
    const ctor = window.Apriltag; // index.html のエイリアスで吸収
    if (typeof ctor !== 'function') {
      return reject(new Error('Apriltag() が見つかりません。script のパス/ファイル名を確認してください。'));
    }
    apriltag = ctor(() => {
      // 速度寄りに（利用可能な API の範囲で）
      try { apriltag.set_max_detections?.(0); } catch {}
      try { apriltag.set_return_pose?.(0); }   catch {}
      try { apriltag.set_return_solutions?.(0);} catch {}
      resolve();
    });
  });
}

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

// ---------- 補助 ----------
let lastTime = performance.now();
let fpsList = [], frameCount = 0;
let prevIds = new Set(), stableIds = new Set();
let lastShotAt = 0;

function calcFPS(){
  const now = performance.now(), fps = 1000 / (now - lastTime); lastTime = now;
  fpsList.push(fps); if (fpsList.length > CONF.fpsWindow) fpsList.shift();
  return (fpsList.reduce((a,b)=>a+b,0)/fpsList.length).toFixed(1);
}

function toGray(imageData){
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i=0,j=0; i<data.length; i+=4, j++) {
    gray[j] = (data[i] + data[i+1] + data[i+2]) / 3; // R+G+B 平均
  }
  return gray;
}

function updateStability(dets){
  const ids = new Set(dets.map(d => d.id));
  const newStable = new Set();
  for (const id of ids) if (prevIds.has(id)) newStable.add(id);
  stableIds = newStable;
  prevIds = ids;
}

function drawMarkers(dets){
  oCtx.clearRect(0,0,over.width,over.height);
  oCtx.lineWidth = 3;
  for (const d of dets) {
    const cs = d.corners;
    oCtx.strokeStyle = stableIds.has(d.id) ? 'rgba(0,255,0,0.95)' : 'rgba(0,255,0,0.55)';
    oCtx.beginPath();
    oCtx.moveTo(cs[0].x, cs[0].y);
    for (let i=1;i<cs.length;i++) oCtx.lineTo(cs[i].x, cs[i].y);
    oCtx.closePath(); oCtx.stroke();

    const cx = d.center.x, cy = d.center.y;
    oCtx.fillStyle = '#0f0';
    oCtx.beginPath(); oCtx.arc(cx, cy, 4, 0, Math.PI*2); oCtx.fill();
    oCtx.font = '16px monospace'; oCtx.fillText(String(d.id), cx+6, cy-6);
  }
}

function isHit(dets){
  const rx = over.width/2, ry = over.height/2, r2 = CONF.reticleRadiusPx ** 2;
  for (const d of dets) {
    const cx = d.center.x, cy = d.center.y;
    const dx = cx - rx, dy = cy - ry;
    if (dx*dx + dy*dy <= r2) return d;
  }
  return null;
}

function flash(color='rgba(0,255,0,0.25)'){
  oCtx.save(); oCtx.fillStyle = color; oCtx.fillRect(0,0,over.width,over.height); oCtx.restore();
}

// ---------- ループ ----------
async function detectLoop(){
  requestAnimationFrame(detectLoop);
  if (video.readyState < 2 || !apriltag) return;
  if (frameCount++ % CONF.detectEvery !== 0) return;

  // 軽い前処理
  vCtx.filter = CONF.preFilter;
  vCtx.drawImage(video, 0, 0, view.width, view.height);
  vCtx.filter = 'none';

  const img = vCtx.getImageData(0,0,view.width,view.height);
  const gray = toGray(img);

  let detections = [];
  try {
    // JSON 配列（id, corners[], center）を受け取れるビルドを想定
    detections = await apriltag.detect(gray, view.width, view.height);
  } catch (e) {
    console.error('[apriltag.detect] failed', e);
  }

  updateStability(detections);
  drawMarkers(detections);

  const fps = calcFPS();
  hud.textContent =
    `tags=${detections.length} (stable=${[...stableIds].length})\n` +
    `fps(avg)=${fps}\n` +
    `(w=${view.width}, h=${view.height})\n` +
    `family=tag36h11`;

  // SHOOT 後 200ms 以内にヒット判定
  if (performance.now() - lastShotAt < 200) {
    const hit = isHit(detections.filter(d => stableIds.has(d.id)));
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
    await loadApriltag();
    log('Apriltag ready.');
    detectLoop();
  } catch (e) {
    console.error(e);
    log('起動失敗:', e.message);
  }
})();
