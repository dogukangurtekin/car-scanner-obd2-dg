// Bağımsız canvas grafik çizicileri (kütüphane yok)
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const rgba = (c, a) => {
  c = c.trim();
  if (c[0] !== '#') return c;
  if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
  const n = parseInt(c.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const rr = (ctx, x, y, w, h, r) => { r = Math.min(r, w / 2, Math.abs(h)); ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h); ctx.closePath(); };

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
  const acc = css('--accent'), acc2 = css('--accent2'), bad = css('--bad');
  ctx.lineCap = 'round';
  const lw = Math.max(8, r * 0.12);
  // iz
  ctx.lineWidth = lw; ctx.strokeStyle = css('--track');
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  // kırmızı bölge (ince dış halka)
  if (warn != null) {
    ctx.lineWidth = Math.max(2, lw * 0.25); ctx.strokeStyle = rgba(bad, 0.85);
    ctx.beginPath(); ctx.arc(cx, cy, r + lw * 0.85, a0 + (a1 - a0) * frac(warn), a1); ctx.stroke();
  }
  // değer yayı: degrade + parıltı
  if (value != null && frac(value) > 0) {
    const hot = warn != null && value >= warn;
    const g = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    g.addColorStop(0, hot ? bad : acc); g.addColorStop(1, hot ? bad : acc2);
    ctx.save();
    ctx.shadowColor = rgba(hot ? bad : acc, 0.55); ctx.shadowBlur = lw * 1.1;
    ctx.lineWidth = lw; ctx.strokeStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac(value)); ctx.stroke();
    ctx.restore();
  }
  // ölçek çizgileri ve sayılar
  ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line2');
  ctx.font = '500 ' + (r < 100 ? 9 : 11) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 1; ctx.lineCap = 'butt';
  for (let i = 0; i <= ticks; i++) {
    const a = a0 + (a1 - a0) * (i / ticks), v = min + (max - min) * (i / ticks);
    const r1 = r - lw * 0.5 - 3, r2 = r1 - 4;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    ctx.fillText(max > 1000 ? Math.round(v / 1000) : Math.round(v), cx + Math.cos(a) * (r - lw - 12), cy + Math.sin(a) * (r - lw - 12));
  }
  ctx.fillStyle = css('--text');
  ctx.font = '650 ' + Math.round(r * 0.44) + 'px system-ui'; ctx.textBaseline = 'middle';
  ctx.fillText(value == null ? '—' : value.toFixed(decimals), cx, cy + 4);
  ctx.fillStyle = css('--muted');
  ctx.font = '500 ' + (r < 100 ? 10 : 13) + 'px system-ui';
  ctx.fillText(unit, cx, cy + r * 0.36);
  ctx.font = '600 ' + (r < 100 ? 9 : 11) + 'px system-ui';
  ctx.fillText(String(label).toUpperCase(), cx, h - (r < 100 ? 6 : 12));
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
    for (let i = 0; i <= 4; i++) ctx.fillText(o.xlab ? o.xlab(o.tmin + span * (i / 4)) : i === 4 ? 'şimdi' : '-' + Math.round(span * (1 - i / 4)) + 's', L + (pw * i) / 4, h - B + 3);
  }
  if (vis.length < 2) return;
  const pts = vis.map((p) => [X(p[0]), Y(p[1])]);
  const path = () => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2;
      ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  if (o.fill) {
    path(); ctx.lineTo(pts[pts.length - 1][0], T + ph); ctx.lineTo(pts[0][0], T + ph); ctx.closePath();
    const g = ctx.createLinearGradient(0, T, 0, T + ph);
    g.addColorStop(0, rgba(o.color, 0.32)); g.addColorStop(1, rgba(o.color, 0));
    ctx.fillStyle = g; ctx.fill();
  }
  path(); ctx.strokeStyle = o.color; ctx.lineWidth = o.labels ? 2 : 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  if (o.labels) {
    const [lx, ly] = pts[pts.length - 1];
    ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, 7); ctx.fill();
    ctx.strokeStyle = rgba(o.color, 0.3); ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7); ctx.stroke();
  }
}

export function drawBars(canvas, labels, values, color) {
  const f = fit(canvas); if (!f) return;
  const { ctx, w, h } = f;
  const L = 6, B = 22, T = 18;
  const max = Math.max(1e-9, ...values), bw = (w - L * 2) / values.length;
  ctx.font = '500 10px system-ui'; ctx.textAlign = 'center';
  ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, h - B + 0.5); ctx.lineTo(w - L, h - B + 0.5); ctx.stroke();
  values.forEach((v, i) => {
    const bh = Math.max(v > 0 ? 2 : 0, (v / max) * (h - B - T)), x = L + i * bw + bw * 0.14, ww = bw * 0.72;
    if (bh > 0) {
      const g = ctx.createLinearGradient(0, h - B - bh, 0, h - B);
      g.addColorStop(0, color); g.addColorStop(1, rgba(color, 0.45));
      ctx.fillStyle = g; rr(ctx, x, h - B - bh, ww, bh, 5); ctx.fill();
      if (v >= 1) { ctx.fillStyle = css('--text'); ctx.textBaseline = 'bottom'; ctx.fillText(Math.round(v) + '%', x + ww / 2, h - B - bh - 2); }
    }
    ctx.fillStyle = css('--muted'); ctx.textBaseline = 'top';
    ctx.fillText(labels[i], L + i * bw + bw / 2, h - B + 6);
  });
}

// Gün bazlı çubuk (mesafe) + çizgi (tüketim, ikinci eksen)
export function drawCombo(canvas, labels, bars, line, colors) {
  const f = fit(canvas); if (!f) return;
  const { ctx, w, h } = f;
  const L = 34, R = 34, B = 20, T = 8;
  const pw = w - L - R, ph = h - T - B, n = Math.max(1, labels.length), bw = pw / n;
  const bmax = Math.max(1e-9, ...bars) * 1.1, lmax = Math.max(1e-9, ...line.filter((x) => x != null)) * 1.1;
  ctx.font = '10px system-ui'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--grid');
  for (let i = 0; i <= 2; i++) {
    const y = T + ph - (ph * i) / 2;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(((bmax * i) / 2).toFixed(0), L - 4, y + 3);
    ctx.textAlign = 'left'; ctx.fillText(((lmax * i) / 2).toFixed(1), w - R + 4, y + 3);
  }
  bars.forEach((v, i) => {
    const bh = (v / bmax) * ph;
    if (bh > 0) {
      const g = ctx.createLinearGradient(0, T + ph - bh, 0, T + ph);
      g.addColorStop(0, colors[0]); g.addColorStop(1, rgba(colors[0], 0.4));
      ctx.fillStyle = g; rr(ctx, L + i * bw + bw * 0.18, T + ph - bh, bw * 0.64, bh, 4); ctx.fill();
    }
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'center';
    if (n <= 10 || i % 2 === 0) ctx.fillText(labels[i], L + i * bw + bw / 2, h - 6);
  });
  ctx.strokeStyle = colors[1]; ctx.lineWidth = 2; ctx.beginPath();
  let started = false;
  line.forEach((v, i) => {
    if (v == null) return;
    const x = L + i * bw + bw / 2, y = T + ph - (v / lmax) * ph;
    started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true;
  });
  ctx.stroke();
  ctx.fillStyle = colors[1];
  line.forEach((v, i) => { if (v != null) { ctx.beginPath(); ctx.arc(L + i * bw + bw / 2, T + ph - (v / lmax) * ph, 3, 0, 7); ctx.fill(); } });
}
