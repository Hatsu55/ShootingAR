// src/draw.js
export function drawReticle(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.04;

  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.moveTo(cx - r * 1.6, cy);
  ctx.lineTo(cx + r * 1.6, cy);
  ctx.moveTo(cx, cy - r * 1.6);
  ctx.lineTo(cx, cy + r * 1.6);
  ctx.stroke();
}

export function drawDetections(ctx, detections, scaleX, scaleY, color = 'lime') {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  detections.forEach(d => {
    const corners = d.corners;
    if (!corners || corners.length !== 4) return;

    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      const x = p.x * scaleX;
      const y = p.y * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    const cx = d.center.x * scaleX;
    const cy = d.center.y * scaleY;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '14px monospace';
    ctx.fillText(`id:${d.id ?? -1}`, cx + 6, cy - 6);
  });
}
