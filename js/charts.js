// Bağımsız canvas grafik çizicileri (kütüphane yok)
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function drawGauge(canvas, { value, min, max, unit, label, warn, ticks = 8, decimals = 0 }) {
  const f = fit(canvas); if (!f) return;
  const { ctx, w, h } = f;
  const cx = w / 2, cy = h * 0.58, r = Math.min(w / 2, h * 0.62) - Math.max(8, h * 0.05);
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  const frac = (v) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  ctx.lineCap = 'round';
  const lw = Math.max(7, r * 0.11);
  ctx.lineWidth = lw;
  ctx.strokeStyle = css('--track');
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  if (warn != null) {
    ctx.strokeStyle = css('--bad');
    ctx.beginPath(); ctx.arc(cx, cy, r, a0 + (a1 - a0) * frac(warn), a1); ctx.stroke();
  }
  if (value != null) {
    const hot = warn != null && value >= warn;
    ctx.strokeStyle = hot ? css('--bad') : css('--accent');
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac(value)); ctx.stroke();
  }
  ctx.fillStyle = css('--muted');
  ctx.font = (r < 100 ? 9 : 11) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) {
    const a = a0 + (a1 - a0) * (i / ticks), v = min + (max - min) * (i / ticks);
    ctx.fillText(max > 1000 ? Math.round(v / 1000) : Math.round(v), cx + Math.cos(a) * (r - lw - 8), cy + Math.sin(a) * (r - lw - 8));
  }
  ctx.fillStyle = css('--text');
  ctx.font = '600 ' + Math.round(r * 0.42) + 'px system-ui';
  ctx.fillText(value == null ? '—' : value.toFixed(decimals), cx, cy + 4);
  ctx.fillStyle = css('--muted');
  ctx.font = (r < 100 ? 10 : 13) + 'px system-ui';
  ctx.fillText(unit, cx, cy + r * 0.34);
  ctx.fillText(label, cx, h - (r < 100 ? 4 : 10));
}

// series: [[t,v],...]; opts: {tmin,tmax,min,max,color,grid,labels,unit}
export function drawLine(canvas, series, o) {
  const f = fit(canvas); if (!f) return;
  const { ctx, w, h } = f;
  const L = o.labels ? 38 : 2, B = o.labels ? 16 : 2, T = 4, R = 4;
  const pw = w - L - R, ph = h - T - B;
  let { min, max } = o;
  const vis = series.filter((p) => p[0] >= o.tmin);
  if (min == null || max == null) {
    min = Infinity; max = -Infinity;
    for (const p of vis) { if (p[1] < min) min = p[1]; if (p[1] > max) max = p[1]; }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (max - min < 1e-6) { max = min + 1; }
    const pad = (max - min) * 0.1; min -= pad; max += pad;
  }
  const X = (t) => L + ((t - o.tmin) / (o.tmax - o.tmin)) * pw;
  const Y = (v) => T + ph - ((v - min) / (max - min)) * ph;
  if (o.grid) {
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      if (o.labels) ctx.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1), L - 4, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const span = o.tmax - o.tmin;
    for (let i = 0; i <= 4; i++) ctx.fillText(i === 4 ? 'şimdi' : '-' + Math.round(span * (1 - i / 4)) + 's', L + (pw * i) / 4, h - B + 3);
  }
  if (vis.length < 2) return;
  ctx.beginPath();
  vis.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
  ctx.strokeStyle = o.color; ctx.lineWidth = o.labels ? 1.8 : 1.4; ctx.lineJoin = 'round'; ctx.stroke();
  if (o.fill) {
    ctx.lineTo(X(vis[vis.length - 1][0]), T + ph); ctx.lineTo(X(vis[0][0]), T + ph); ctx.closePath();
    ctx.globalAlpha = 0.12; ctx.fillStyle = o.color; ctx.fill(); ctx.globalAlpha = 1;
  }
}

export function drawBars(canvas, labels, values, color) {
  const f = fit(canvas); if (!f) return;
  const { ctx, w, h } = f;
  const L = 6, B = 20, T = 8;
  const max = Math.max(1e-9, ...values), bw = (w - L * 2) / values.length;
  ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  values.forEach((v, i) => {
    const bh = (v / max) * (h - B - T);
    ctx.fillStyle = color; ctx.globalAlpha = 0.85;
    ctx.fillRect(L + i * bw + 2, h - B - bh, bw - 4, bh);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css('--muted');
    ctx.fillText(labels[i], L + i * bw + bw / 2, h - B + 4);
  });
}
