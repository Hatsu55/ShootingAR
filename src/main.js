// ============================
// Camera + Reticle Minimum
// ============================

const video = document.getElementById('camera');
const canvas = document.getElementById('reticle');
const ctx = canvas.getContext('2d');
const shootBtn = document.getElementById('shoot');
const scoreEl = document.getElementById('scoreValue');

let score = 0;

// 画面サイズに合わせてCanvasを更新
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// レティクルを描画（中央に十字）
function drawReticle() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const len = Math.min(canvas.width, canvas.height) * 0.04; // 十字の長さ
  const w = 2; // 線の太さ

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(cx - len, cy);
  ctx.lineTo(cx + len, cy);
  ctx.moveTo(cx, cy - len);
  ctx.lineTo(cx, cy + len);
  ctx.stroke();

  // 中心の円（ヒット判定の参考用に少し大きめ）
  ctx.beginPath();
  ctx.arc(cx, cy, len * 0.4, 0, Math.PI * 2);
  ctx.stroke();
}

// カメラ起動
async function startCamera() {
  try {
    const constraints = {
      audio: false,
      video: {
        facingMode: 'environment', // 背面カメラを優先
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      drawLoop(); // ループ開始
    };
  } catch (err) {
    alert('カメラを取得できませんでした。権限を許可してください。\n' + err.message);
    console.error(err);
  }
}

function drawLoop() {
  drawReticle();
  requestAnimationFrame(drawLoop);
}

shootBtn.addEventListener('click', () => {
  // まだタグ検出はしていないので、ここではスコアだけ増える
  score++;
  scoreEl.textContent = score;
});

// 起動
startCamera();
