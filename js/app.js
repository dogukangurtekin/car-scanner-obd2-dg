import { PIDS, PID_BY_ID, STATUS_PID, DEFAULT_CHARTS, fmt } from './pids.js';
import { SerialTransport, BleTransport, SimTransport } from './transport.js';
import { ELM } from './elm.js';
import { dtcDescribe } from './dtc.js';
import { drawGauge, drawLine, drawBars } from './charts.js';

const $ = (s) => document.querySelector(s);
const now = () => performance.now() / 1000;
const COLORS = ['#3fb6ff', '#3ddc84', '#ffb020', '#c58cff', '#ff7aa8', '#4fe0d0', '#ff8f4f', '#a3d94a'];

const S = {
  elm: null, running: false, defs: [], latest: {}, hist: {}, rows: [],
  chartSel: new Set(JSON.parse(localStorage.getItem('chartSel') || 'null') || DEFAULT_CHARTS),
  tab: 'dash', pidCount: 0, rate: 0,
};

// ---------- yardımcılar ----------
function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}
const termLog = (kind, text) => {
  const t = $('#term');
  const d = document.createElement('div');
  d.className = kind;
  d.textContent = (kind === 'tx' ? '→ ' : kind === 'rx' ? '← ' : '') + text.replace(/\r/g, '⏎');
  t.append(d);
  while (t.childElementCount > 400) t.firstChild.remove();
  t.scrollTop = t.scrollHeight;
};

// ---------- trip istatistikleri ----------
const newTrip = () => ({
  t: 0, dist: 0, fuel: 0, vmax: 0, rmax: 0, idle: 0, vsum: 0, vt: 0, cmax: -99,
  rpmH: new Array(8).fill(0), spdH: new Array(8).fill(0), last: null,
});
let trip = newTrip();

function estimateMaf(v) {
  // MAF yoksa MAP/IAT/RPM'den yaklaşık (volumetrik verim 0.85, 1.6 L)
  const map = v['0B'], iat = v['0F'], rpm = v['0C'];
  if ([map, iat, rpm].some((x) => x == null)) return null;
  return ((rpm * map) / (iat + 273.15) / 2 / 60) * 0.85 * 1.6 * 28.97 / 8.314 / 1000;
}

function tripStep(dt) {
  const v = Object.fromEntries(Object.entries(S.latest).map(([k, x]) => [k, x.v]));
  const spd = v['0D'], rpm = v['0C'];
  trip.t += dt;
  if (spd != null) {
    trip.dist += (spd * dt) / 3600;
    trip.vmax = Math.max(trip.vmax, spd);
    trip.vsum += spd * dt; trip.vt += dt;
    trip.spdH[Math.min(7, Math.floor(spd / 25))] += dt;
  }
  if (rpm != null) {
    trip.rmax = Math.max(trip.rmax, rpm);
    trip.rpmH[Math.min(7, Math.floor(rpm / 1000))] += dt;
    if ((spd ?? 0) < 1 && rpm > 400) trip.idle += dt;
  }
  if (v['05'] != null) trip.cmax = Math.max(trip.cmax, v['05']);
  const maf = v['10'] ?? estimateMaf(v);
  if (maf != null && rpm > 400) {
    trip.fuel += (maf / 14.7 / 745) * dt; // litre
    trip.inst = spd > 3 ? ((maf / 14.7 / 745) * 3600 / spd) * 100 : null;
    trip.lph = (maf / 14.7 / 745) * 3600;
  }
}

// ---------- veri girişi ----------
function onValue(id, val) {
  const t = now();
  if (id === STATUS_PID) { S.latest[id] = { v: val, t }; return; }
  S.latest[id] = { v: val, t };
  const h = (S.hist[id] ||= []);
  h.push([t, val]);
  if (h.length > 6000) h.splice(0, 1500);
}

async function pollLoop() {
  let cycle = 0, last = now(), count = 0, rateT = now();
  const status = S.elm.supported.has(STATUS_PID);
  while (S.running) {
    for (const p of S.defs) {
      if (!S.running) break;
      if (!p.fast && cycle % 6) continue;
      try {
        const v = await S.elm.readPid(p.id);
        if (v != null) { onValue(p.id, v); count++; }
      } catch (e) {
        if (S.running) { termLog('sys', 'Hata: ' + e.message); await new Promise((r) => setTimeout(r, 300)); }
      }
    }
    if (status && cycle % 20 === 0) {
      try { const v = await S.elm.readPid(STATUS_PID); if (v != null) onValue(STATUS_PID, v); } catch {}
    }
    if (cycle % 40 === 0) S.elm.refreshVoltage().catch(() => {});
    const t = now();
    tripStep(Math.min(2, t - last)); last = t;
    const row = { zaman: new Date().toISOString() };
    for (const p of S.defs) row[`${p.name} (${p.unit})`] = S.latest[p.id]?.v != null ? +S.latest[p.id].v.toFixed(3) : '';
    S.rows.push(row);
    if (S.rows.length > 20000) S.rows.splice(0, 2000);
    if (t - rateT >= 2) { S.rate = count / (t - rateT); count = 0; rateT = t; }
    cycle++;
    if (!S.defs.length) await new Promise((r) => setTimeout(r, 500));
  }
}

// ---------- bağlantı ----------
async function connect() {
  const kind = $('#selTransport').value;
  let tr;
  try {
    if (kind === 'serial') {
      if (!SerialTransport.supported) throw new Error('Bu tarayıcı Web Serial desteklemiyor — Chrome/Edge masaüstü kullanın.');
      tr = new SerialTransport({ baud: +$('#selBaud').value });
    } else if (kind === 'ble') {
      if (!BleTransport.supported) throw new Error('Bu tarayıcı Web Bluetooth desteklemiyor.');
      tr = new BleTransport();
    } else tr = new SimTransport();
    $('#btnConn').disabled = true;
    $('#connMsg').textContent = kind === 'ble' ? 'Açılan listeden ELM327 cihazınızı seçin…' : '';
    $('#stConn').textContent = 'Bağlanıyor…';
    S.elm = new ELM(tr, termLog);
    await tr.open();
    tr.onClose = () => { if (S.running) { toast('Bağlantı koptu', true); disconnect(true); } };
    const sup = await S.elm.init({ protocol: $('#selProto').value, fast: $('#selFast').value === '1' });
    S.defs = PIDS.filter((p) => sup.has(p.id));
    if (!S.defs.length) throw new Error('Araç hiçbir standart PID bildirmedi.');
    S.latest = {}; S.hist = {}; S.rows = []; trip = newTrip();
    S.running = true;
    $('#connect').classList.add('hidden');
    $('#btnDisc').classList.remove('hidden');
    $('#stConn').textContent = kind === 'sim' ? 'Demo' : 'Bağlı';
    $('#stConn').classList.add('on');
    buildTiles(); buildChartPick(); buildInfo();
    pollLoop();
    S.elm.readVin().then((v) => { S.vin = v; buildInfo(); }).catch(() => {});
    toast(`${S.defs.length} PID bulundu, okuma başladı`);
  } catch (e) {
    toast(e.message || String(e), true);
    $('#connMsg').textContent = 'Hata: ' + (e.name ? e.name + ' — ' : '') + (e.message || e);
    try { await tr?.close(); } catch {}
    S.elm = null;
    $('#stConn').textContent = 'Bağlı değil';
  } finally { $('#btnConn').disabled = false; }
}

async function disconnect(silent) {
  S.running = false;
  try { await S.elm?.t.close(); } catch {}
  S.elm = null;
  $('#connect').classList.remove('hidden');
  $('#btnDisc').classList.add('hidden');
  $('#stConn').textContent = 'Bağlı değil';
  $('#stConn').classList.remove('on');
  if (!silent) toast('Bağlantı kapatıldı');
}

// ---------- arayüz kurulumu ----------
function buildTiles() {
  const box = $('#tiles');
  box.innerHTML = '';
  for (const p of S.defs) {
    const d = document.createElement('div');
    d.className = 'card tile'; d.id = 'tile' + p.id;
    d.innerHTML = `<div class="n">${p.name}</div><div class="v"><span>—</span><small>${p.unit}</small></div><canvas></canvas>`;
    box.append(d);
  }
}

function buildChartPick() {
  const box = $('#chartPick');
  box.innerHTML = '';
  for (const p of S.defs) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${p.id}" ${S.chartSel.has(p.id) ? 'checked' : ''}>${p.name}`;
    l.firstChild.addEventListener('change', (e) => {
      e.target.checked ? S.chartSel.add(p.id) : S.chartSel.delete(p.id);
      localStorage.setItem('chartSel', JSON.stringify([...S.chartSel]));
      buildCharts();
    });
    box.append(l);
  }
  buildCharts();
}

function buildCharts() {
  const box = $('#charts');
  box.innerHTML = '';
  S.defs.filter((p) => S.chartSel.has(p.id)).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'card chart'; d.id = 'ch' + p.id; d.dataset.color = COLORS[i % COLORS.length];
    d.innerHTML = `<div class="hd"><b>${p.name}</b><span>—</span></div><canvas></canvas><div class="mm"></div>`;
    box.append(d);
  });
}

function buildInfo() {
  const e = S.elm;
  const rows = [
    ['ELM327', e?.info.elm || '—'],
    ['VIN', S.vin || '— (araç desteklemiyor olabilir)'],
    ['Protokol (ATDPN)', e?.info.protocol || '—'],
    ['Akü voltajı (ATRV)', e?.info.voltage ? e.info.voltage + ' V' : '—'],
    ['Desteklenen PID sayısı', S.defs.length + ' / ' + (e?.supported?.size ?? 0) + ' (panoda tanımlı / araçta toplam)'],
  ];
  $('#infoBody').innerHTML = rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('');
  $('#pidBody').innerHTML = S.defs.map((p) => `<tr><td>${p.id}</td><td>${p.name}</td><td id="pv${p.id}">—</td></tr>`).join('');
}

// ---------- çizim döngüsü ----------
const val = (id) => S.latest[id]?.v ?? null;
function sparkOpts(color) { return { tmin: now() - 60, tmax: now(), min: null, max: null, color, fill: true }; }

function render() {
  const t = now();
  $('#stRate').textContent = (S.running ? S.rate.toFixed(1) : '—') + ' PID/sn';
  const volt = val('42') ?? S.elm?.info.voltage;
  $('#stVolt').textContent = 'Akü ' + (volt ? volt.toFixed(1) + ' V' : '—');
  const st = val(STATUS_PID);
  const mil = $('#stMil');
  mil.textContent = st == null ? 'MIL —' : st & 0x80 ? `MIL AÇIK · ${st & 0x7f} kod` : 'MIL kapalı';
  mil.classList.toggle('on', st != null && !!(st & 0x80));

  if (S.tab === 'dash') {
    drawGauge($('#gRpm'), { value: val('0C'), min: 0, max: 7000, ticks: 7, unit: 'rpm', label: 'Motor Devri', warn: 6200 });
    drawGauge($('#gSpd'), { value: val('0D'), min: 0, max: 240, ticks: 8, unit: 'km/h', label: 'Hız' });
    for (const p of S.defs) {
      const el = $('#tile' + p.id); if (!el) continue;
      const v = val(p.id);
      el.querySelector('.v span').textContent = fmt(p, v);
      el.classList.toggle('bad', p.warn != null && v != null && v >= p.warn);
      drawLine(el.querySelector('canvas'), S.hist[p.id] || [], { ...sparkOpts('#3fb6ff'), min: p.min, max: p.max });
    }
  } else if (S.tab === 'charts') {
    const win = +$('#selWin').value;
    document.querySelectorAll('.chart').forEach((el) => {
      const p = PID_BY_ID[el.id.slice(2)], h = S.hist[p.id] || [];
      const vis = h.filter((x) => x[0] >= t - win);
      el.querySelector('.hd span').textContent = fmt(p, val(p.id)) + ' ' + p.unit;
      if (vis.length) {
        const vs = vis.map((x) => x[1]);
        el.querySelector('.mm').textContent = `min ${fmt(p, Math.min(...vs))} · ort ${fmt(p, vs.reduce((a, b) => a + b, 0) / vs.length)} · maks ${fmt(p, Math.max(...vs))}`;
      }
      drawLine(el.querySelector('canvas'), h, { tmin: t - win, tmax: t, color: el.dataset.color, grid: true, labels: true, fill: true });
    });
  } else if (S.tab === 'stats') {
    renderStats();
  } else if (S.tab === 'info') {
    for (const p of S.defs) { const c = $('#pv' + p.id); if (c) c.textContent = fmt(p, val(p.id)) + ' ' + p.unit; }
  }
}

const dur = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function renderStats() {
  const avgV = trip.vt ? trip.vsum / trip.vt : 0;
  const avgC = trip.dist > 0.05 ? (trip.fuel / trip.dist) * 100 : null;
  const k = [
    ['Süre', dur(trip.t)], ['Mesafe', trip.dist.toFixed(2) + ' km'], ['Ort. hız', avgV.toFixed(0) + ' km/h'],
    ['Maks. hız', trip.vmax.toFixed(0) + ' km/h'], ['Maks. devir', trip.rmax.toFixed(0) + ' rpm'],
    ['Rölanti süresi', dur(trip.idle)], ['Yakıt (tahmini)', trip.fuel.toFixed(2) + ' L'],
    ['Anlık tüketim', trip.inst != null ? trip.inst.toFixed(1) + ' L/100km' : trip.lph != null ? trip.lph.toFixed(1) + ' L/sa' : '—'],
    ['Ort. tüketim', avgC != null ? avgC.toFixed(1) + ' L/100km' : '—'],
    ['Maks. su sıc.', trip.cmax > -99 ? trip.cmax.toFixed(0) + ' °C' : '—'],
  ];
  $('#kpis').innerHTML = k.map(([n, v]) => `<div class="card kpi"><div class="n">${n}</div><div class="v">${v}</div></div>`).join('');
  const pct = (a) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map((x) => (x / s) * 100); };
  drawBars($('#hRpm'), ['0-1k', '1-2k', '2-3k', '3-4k', '4-5k', '5-6k', '6-7k', '7k+'], pct(trip.rpmH), '#3fb6ff');
  drawBars($('#hSpd'), ['0-25', '25-50', '50-75', '75-100', '100-125', '125-150', '150-175', '175+'], pct(trip.spdH), '#3ddc84');
  $('#rowCount').textContent = S.rows.length + ' kayıt';
}

const loop = () => setInterval(render, 120);

// ---------- olaylar ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('main > section[id^=tab-]').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + S.tab));
  render();
});
$('#selTransport').addEventListener('change', () => {
  const k = $('#selTransport').value;
  $('#selBaud').disabled = k !== 'serial';
  $('#connHelp').textContent = {
    serial: 'Klasik BT için: önce Windows\'ta ELM327\'yi eşleştirin (PIN 1234 / 0000), kontağı açın, sonra "Bağlan" → sanal COM portunu seçin. Chrome veya Edge (masaüstü) gerekir.',
    ble: 'Yalnızca BLE (Bluetooth 4+) ELM327 modelleri. Klasik BT modeller listede görünmez/bağlanmaz — onun için Web Serial seçin.',
    sim: 'Demo: gerçek araç olmadan ELM327 yanıtlarını taklit eder. Arayüzü denemek içindir.',
  }[k];
});
$('#btnConn').addEventListener('click', connect);
$('#btnDisc').addEventListener('click', () => disconnect());
$('#selWin').addEventListener('change', render);

$('#btnDtc').addEventListener('click', async () => {
  if (!S.elm) return toast('Önce bağlanın', true);
  try {
    const codes = await S.elm.readDtcs();
    $('#dtcCount').textContent = codes.length ? codes.length + ' kod' : 'Kayıtlı arıza yok';
    $('#dtcBody').innerHTML = codes.length
      ? codes.map((c) => `<tr><td class="code">${c}</td><td>${dtcDescribe(c)}</td></tr>`).join('')
      : '<tr><td colspan="2" style="color:var(--good)">Kayıtlı arıza kodu bulunmuyor.</td></tr>';
  } catch (e) { toast(e.message, true); }
});
$('#btnDtcClr').addEventListener('click', async () => {
  if (!S.elm) return toast('Önce bağlanın', true);
  if (!confirm('Arıza kodları ve MIL silinecek. Devam edilsin mi?')) return;
  try { await S.elm.clearDtcs(); toast('Silme komutu gönderildi'); $('#btnDtc').click(); } catch (e) { toast(e.message, true); }
});

$('#termForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = $('#termIn').value.trim(); if (!c) return;
  if (!S.elm) return toast('Önce bağlanın', true);
  $('#termIn').value = '';
  try { await S.elm.cmd(c, 8000); } catch (err) { termLog('sys', err.message); }
});

$('#btnReset').addEventListener('click', () => { trip = newTrip(); S.rows = []; });
$('#btnCsv').addEventListener('click', () => {
  if (!S.rows.length) return toast('Kayıt yok', true);
  const cols = Object.keys(S.rows[S.rows.length - 1]);
  const csv = [cols.join(';'), ...S.rows.map((r) => cols.map((c) => String(r[c] ?? '').replace('.', ',')).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = 'golf5-obd-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

if (!SerialTransport.supported && BleTransport.supported) {
  $('#selTransport').value = 'ble';
  $('#selTransport').dispatchEvent(new Event('change'));
}
if (!SerialTransport.supported && !BleTransport.supported) {
  $('#connHelp').textContent = 'Bu tarayıcı Web Serial/Bluetooth desteklemiyor. Chrome veya Edge (masaüstü, HTTPS) kullanın; demo modu yine çalışır.';
  $('#selTransport').value = 'sim';
}
loop();
