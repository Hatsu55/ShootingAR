// src/main.js
const $ = (q) => document.querySelector(q);
const hud = $("#hud");
const video = $("#video");
const canvas = $("#canvas");
const overlay = $("#overlay");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const octx = overlay.getContext("2d");

let apriltag = null;
let ready = false;

// ---- AprilTag 初期化（ARENAビルド） ----
// グローバルに Apriltag() が来る（非モジュールスクリプト）
function initApriltag() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof Apriltag !== "function") {
        reject(new Error("Apriltag() が見つかりません。index.html の読み込み順を確認してください。"));
        return;
      }
      apriltag = Apriltag(() => {
        try {
          // 速度最優先。検出数は無制限、ポーズ推定はOFF
          apriltag.set_max_detections(0);
          apriltag.set_return_pose(0);
          apriltag.set_return_solutions(0);
          // 20cm のタグID=3 を使う予定（将来ポーズが必要になったら有効）
          // apriltag.set_tag_size(3, 0.20);
          ready = true;
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

// ---- カメラ起動 ----
async function openCamera() {
  // 720p 縦横比優先。背面カメラ
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();

  // キャンバス解像度を実際のビデオに合わせる
  const vw = video.videoWidth || 960;
  const vh = video.videoHeight || 540;
  canvas.width = overlay.width = vw;
  canvas.height = overlay.height = vh;

  log(`camera opened: ${vw} x ${vh}`);
}

// ---- ループ ----
let frameCount = 0;
const t0 = performance.now();

async function detectLoop() {
  if (!ready) return;

  // 1) フレームをキャンバスへ
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2) グレースケール作成（平均）
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = img.data;                // RGBA
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    gray[j] = (src[i] + src[i + 1] + src[i + 2]) / 3 | 0;
  }

  // 3) 検出
  let detections = [];
  const t1 = performance.now();
  try {
    detections = await apriltag.detect(gray, canvas.width, canvas.height);
  } catch (e) {
    // 一部ビルドでは strict-mode 関連の TypeError が内部で出ることがある
    // その場合でも検出自体は継続できるケースがあるため、画面に記録して続行
    if (String(e?.message || "").includes("'caller', 'callee', and 'arguments'")) {
      console.warn("ignored strict-mode error:", e);
    } else {
      console.error("[detect] failed:", e);
    }
  }
  const t2 = performance.now();

  // 4) オーバーレイ描画
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.strokeStyle = "#0f0";
  octx.lineWidth = 2;
  octx.font = "16px monospace";
  octx.fillStyle = "#0f0";

  if (Array.isArray(detections) && detections.length) {
    detections.forEach((d) => {
      // 角を結ぶ
      if (d.corners && d.corners.length === 4) {
        octx.beginPath();
        octx.moveTo(d.corners[0].x, d.corners[0].y);
        for (let k = 1; k < 4; k++) octx.lineTo(d.corners[k].x, d.corners[k].y);
        octx.closePath();
        octx.stroke();
      }
      // センターとID
      if (d.center) {
        octx.beginPath();
        octx.arc(d.center.x, d.center.y, 5, 0, Math.PI * 2);
        octx.stroke();
      }
      const label = `id=${d.id}`;
      const px = d.center ? d.center.x + 8 : 12;
      const py = d.center ? d.center.y - 8 : 24;
      octx.fillText(label, px, py);
    });
  }

  // 5) HUD
  frameCount++;
  const elapsed = (t2 - t0) / 1000;
  const fps = frameCount / Math.max(elapsed, 0.001);
  log([
    `detections=${detections?.length ?? 0}`,
    `detect: ${(t2 - t1).toFixed(1)} ms`,
    `w${canvas.width} x h${canvas.height} @ ${fps.toFixed(1)} FPS`
  ].join("\n"));

  requestAnimationFrame(detectLoop);
}

// ---- 小物 ----
function log(s) {
  hud.textContent = s;
}

// ---- エントリ ----
(async () => {
  try {
    await initApriltag();
    await openCamera();
    log("Apriltag ready.");
    requestAnimationFrame(detectLoop);
  } catch (e) {
    console.error(e);
    log(String(e));
  }
})();
