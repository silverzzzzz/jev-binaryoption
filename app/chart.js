/**
 * 依存なしの簡易 canvas チャート。折れ線 + マーカー + 塗り。
 */
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(200, rect.width || canvas.clientWidth || 600);
  const h = canvas.height / (canvas.dataset.dpr ? Number(canvas.dataset.dpr) : 1) || 220;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.dataset.dpr = dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {Array<{values:number[], color?:string, width?:number, fill?:boolean, zeroLine?:boolean}>} opts.lines
 * @param {Array<{x:number, y:number, color:string, size?:number, shape?:'circle'|'up'|'down'}>} [opts.markers]
 * @param {string[]} [opts.xLabels] 各 x のラベル（一部だけ描画）
 * @param {number} [opts.digits]
 */
export function drawChart(canvas, opts) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 56, r: 12, t: 10, b: 22 };
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui';
  const lines = opts.lines.filter((l) => l.values && l.values.length);
  if (!lines.length) {
    ctx.fillStyle = css('--muted');
    ctx.font = '12px system-ui';
    ctx.fillText('データなし', pad.l, h / 2);
    return;
  }
  const n = Math.max(...lines.map((l) => l.values.length));
  let lo = Infinity, hi = -Infinity;
  for (const l of lines) for (const v of l.values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (opts.markers) for (const m of opts.markers) if (Number.isFinite(m.y)) { if (m.y < lo) lo = m.y; if (m.y > hi) hi = m.y; }
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
  const span = hi - lo;
  lo -= span * 0.05;
  hi += span * 0.05;
  const px = (i) => pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, n - 1);
  const py = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const digits = opts.digits ?? (hi - lo < 1 ? 5 : hi - lo < 100 ? 3 : 1);
  // 左余白はラベルの実幅に合わせる
  pad.l = Math.max(40, Math.ceil(Math.max(ctx.measureText(hi.toFixed(digits)).width, ctx.measureText(lo.toFixed(digits)).width)) + 10);

  // グリッド
  ctx.strokeStyle = css('--border');
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    const y = py(v);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(digits), pad.l - 4, y + 4);
  }
  if (opts.xLabels && opts.xLabels.length) {
    const labelEvery = Math.max(1, Math.ceil(n / Math.floor((w - pad.l - pad.r) / 90)));
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i += labelEvery) {
      if (opts.xLabels[i]) ctx.fillText(opts.xLabels[i], px(i), h - 6);
    }
  }
  // 線
  for (const l of lines) {
    ctx.strokeStyle = l.color || css('--accent');
    ctx.lineWidth = l.width || 1.5;
    if (l.zeroLine) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = css('--muted');
      ctx.beginPath();
      ctx.moveTo(pad.l, py(0));
      ctx.lineTo(w - pad.r, py(0));
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = l.color || css('--accent');
    }
    ctx.beginPath();
    let started = false;
    const step = Math.max(1, Math.floor(l.values.length / (w * 2)));
    for (let i = 0; i < l.values.length; i += step) {
      const v = l.values[i];
      if (!Number.isFinite(v)) continue;
      const x = px(i), y = py(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (l.fill) {
      ctx.lineTo(px(l.values.length - 1), py(Math.max(lo, 0)));
      ctx.lineTo(px(0), py(Math.max(lo, 0)));
      ctx.closePath();
      ctx.fillStyle = (l.color || css('--accent')) + '22';
      ctx.fill();
    }
  }
  // マーカー
  if (opts.markers) {
    for (const m of opts.markers) {
      if (!Number.isFinite(m.y)) continue;
      const x = px(m.x), y = py(m.y), s = m.size || 3;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      if (m.shape === 'up') { ctx.moveTo(x, y - s - 4); ctx.lineTo(x - s, y - 1); ctx.lineTo(x + s, y - 1); }
      else if (m.shape === 'down') { ctx.moveTo(x, y + s + 4); ctx.lineTo(x - s, y + 1); ctx.lineTo(x + s, y + 1); }
      else ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
  }
}
