import { PIDS, PID_BY_ID, PID_BY_KEY, STATUS_PID, DEFAULT_CHARTS, EXTRA_NAMES } from './pids.js?v=16';
import { SerialTransport, BleTransport, SimTransport } from './transport.js?v=16';
import { ELM } from './elm.js?v=16';
import { decodeVin, carLabel, lookupNhtsa } from './vin.js?v=16';
import { dtcDescribe } from './dtc.js?v=16';
import { drawGauge, drawLine } from './charts.js?v=16';
import { loadSettings, saveSettings, activeProfile, conv, show, fuelFlowLps } from './calc.js?v=16';
import { saveTrip } from './store.js?v=16';
import { initExtra } from './extra.js?v=16';

const $ = (s) => document.querySelector(s);
const now = () => performance.now() / 1000;
const COLORS = ['#3fb6ff', '#3ddc84', '#ffb020', '#c58cff', '#ff7aa8', '#4fe0d0', '#ff8f4f', '#a3d94a'];

const S = {
  elm: null, running: false, defs: [], byId: new Map(), latest: {}, hist: {}, status: null,
  chartSel: new Set(JSON.parse(localStorage.getItem('chartSel') || 'null') || DEFAULT_CHARTS),
  tab: 'dash', rate: 0, settings: loadSettings(), trip: null, car: null, vin: '', online: null, onSample: null,
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

// Metni dosya olarak kaydet: önce paylaşım menüsü (iOS), olmazsa indirme bağlantısı
async function saveFile(name, text, mime = 'text/csv') {
  try {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  toast('Dosya hazırlandı: ' + name);
}

const val = (key) => S.latest[key]?.v ?? null;
const valsMap = () => Object.fromEntries(Object.entries(S.latest).map(([k, x]) => [k, x.v]));

// ---------- yolculuk istatistikleri ----------
const newTrip = () => ({
  id: Date.now(), start: Date.now(), t: 0, dist: 0, fuel: 0, vmax: 0, rmax: 0, idle: 0, vsum: 0, vt: 0, cmax: -99,
  rpmH: new Array(8).fill(0), spdH: new Array(8).fill(0), inst: null, lph: null,
});
S.trip = newTrip();

function tripStep(dt) {
  const trip = S.trip, v = valsMap();
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
  const lps = fuelFlowLps(v, activeProfile(S.settings));
  if (lps != null) {
    trip.fuel += lps * dt;
    trip.lph = lps * 3600;
    trip.inst = spd > 3 ? (lps * 3600 / spd) * 100 : null;
  }
}

function persistTrip() {
  const t = S.trip;
  if (t.t < 20 || (t.dist < 0.05 && t.t < 60)) return;
  saveTrip({
    id: t.id, start: t.start, end: Date.now(), t: t.t, dist: t.dist, fuel: t.fuel, vsum: t.vsum, vt: t.vt,
    idle: t.idle, vmax: t.vmax, rmax: t.rmax, price: S.settings.price, cur: S.settings.cur,
    car: S.car ? carLabel(S.car, S.online) : activeProfile(S.settings).name,
  });
}

// ---------- veri girişi ----------
function onValue(key, v) {
  const t = now();
  S.latest[key] = { v, t };
  const h = (S.hist[key] ||= []);
  h.push([t, v]);
  if (h.length > 6000) h.splice(0, 1500);
  S.onSample?.(key, v, t);
}

async function pollLoop() {
  let cycle = 0, last = now(), count = 0, rateT = now();
  const status = S.elm.supported.has(STATUS_PID);
  const ids = [...S.byId.keys()];
  const fastIds = ids.filter((id) => S.byId.get(id).some((p) => p.fast));
  const midIds = ids.filter((id) => !fastIds.includes(id) && S.byId.get(id).some((p) => p.mid));
  const slowIds = ids.filter((id) => !fastIds.includes(id) && !midIds.includes(id));
  while (S.running) {
    const order = [...fastIds, ...(cycle % 3 === 0 ? midIds : []), ...(slowIds.length ? [slowIds[(cycle * 2) % slowIds.length], slowIds[(cycle * 2 + 1) % slowIds.length]] : [])];
    for (const id of order) {
      if (!S.running) break;
      try {
        const b = await S.elm.readBytes(id);
        if (b) {
          for (const p of S.byId.get(id)) onValue(p.key, p.f(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0));
          count++;
        }
      } catch (e) {
        if (S.running) { termLog('sys', 'Hata: ' + e.message); await new Promise((r) => setTimeout(r, 300)); }
      }
    }
    if (status && cycle % 20 === 0) {
      try { const b = await S.elm.readStatusBytes('01'); if (b) S.status = { bytes: b, t: now() }; } catch {}
    }
    if (cycle % 40 === 0) S.elm.refreshVoltage().catch(() => {});
    const t = now();
    tripStep(Math.min(2, t - last)); last = t;
    if (cycle % 40 === 39) persistTrip();
    if (t - rateT >= 2) { S.rate = count / (t - rateT); count = 0; rateT = t; }
    cycle++;
    if (!order.length) await new Promise((r) => setTimeout(r, 500));
  }
}

// ---------- bağlantı ----------
const dbg = (m) => { const d = $('#dbg'); if (d) d.textContent += new Date().toLocaleTimeString() + ' ' + m + '\n'; };
window.addEventListener('error', (e) => dbg('JS hatası: ' + e.message));
window.addEventListener('unhandledrejection', (e) => dbg('Yakalanmamış hata: ' + (e.reason?.message || e.reason)));

async function connect() {
  const kind = $('#selTransport').value;
  $('#dbg').textContent = '';
  dbg('Bağlan basıldı, tür=' + kind);
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
    const stepTimer = setInterval(() => tr.step && dbg('adım: ' + tr.step), 700);
    try { await tr.open(); } finally { clearInterval(stepTimer); }
    dbg('open() tamam, ELM başlatılıyor');
    tr.onClose = () => { if (S.running) { toast('Bağlantı koptu', true); disconnect(true); } };
    const sup = await S.elm.init({ protocol: $('#selProto').value, fast: $('#selFast').value === '1' });
    S.defs = PIDS.filter((p) => sup.has(p.id));
    if (!S.defs.length) throw new Error('Araç hiçbir standart PID bildirmedi.');
    S.byId = new Map();
    for (const p of S.defs) (S.byId.get(p.id) ?? S.byId.set(p.id, []).get(p.id)).push(p);
    S.latest = {}; S.hist = {}; S.status = null; S.trip = newTrip();
    S.running = true;
    $('#connect').classList.add('hidden');
    $('#btnDisc').classList.remove('hidden');
    $('#stConn').textContent = kind === 'sim' ? 'Demo' : 'Bağlı';
    $('#stConn').classList.add('on');
    buildTiles(); buildChartPick(); buildInfo();
    X.onConnect();
    pollLoop();
    S.online = null;
    S.elm.readVin().then((v) => {
      S.vin = v; S.car = decodeVin(v); updateCar(); buildInfo();
      if (v) X.onVin(v, S.car ? carLabel(S.car, S.online) : '');
    }).catch(() => {});
    toast(`${S.defs.length} PID bulundu, okuma başladı`);
  } catch (e) {
    const msg = (e && (e.name ? e.name + ' — ' : '') + (e.message || '')) || String(e);
    dbg('HATA: ' + (typeof e) + ' ' + JSON.stringify(e && e.name) + ' ' + msg);
    const full = msg + (tr?.step ? ' [adım: ' + tr.step + ']' : '');
    toast(full, true);
    $('#connMsg').textContent = 'Hata: ' + full;
    $('#connMsg').scrollIntoView({ block: 'center' });
    try { await tr?.close(); } catch {}
    S.elm = null;
    $('#stConn').textContent = 'Bağlı değil';
  } finally { $('#btnConn').disabled = false; }
}

async function disconnect(silent) {
  persistTrip();
  S.running = false;
  X.onDisconnect();
  try { await S.elm?.t.close(); } catch {}
  S.elm = null; S.car = null; S.online = null; S.vin = '';
  updateCar();
  $('#connect').classList.remove('hidden');
  $('#btnDisc').classList.add('hidden');
  $('#stConn').textContent = 'Bağlı değil';
  $('#stConn').classList.remove('on');
  if (!silent) toast('Bağlantı kapatıldı');
}

// ---------- arayüz kurulumu ----------
const gaugeable = (p) => !p.lbl; // metin değerli PID'ler kart/grafik olmaz

function buildTiles() {
  const box = $('#tiles');
  box.innerHTML = '';
  for (const p of S.defs.filter(gaugeable)) {
    const d = document.createElement('div');
    d.className = 'card tile'; d.id = 'tile' + p.key;
    d.innerHTML = `<div class="n">${p.name}</div><div class="v"><span>—</span><small>${p.unit}</small></div><canvas></canvas>`;
    box.append(d);
  }
}

function buildChartPick() {
  const box = $('#chartPick');
  box.innerHTML = '';
  for (const p of S.defs.filter(gaugeable)) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${p.key}" ${S.chartSel.has(p.key) ? 'checked' : ''}>${p.name}`;
    l.firstChild.addEventListener('change', (e) => {
      e.target.checked ? S.chartSel.add(p.key) : S.chartSel.delete(p.key);
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
  S.defs.filter((p) => gaugeable(p) && S.chartSel.has(p.key)).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'card chart'; d.id = 'ch' + p.key; d.dataset.color = COLORS[i % COLORS.length];
    d.innerHTML = `<div class="hd"><b>${p.name}</b><span>—</span></div><canvas></canvas><div class="mm"></div>`;
    box.append(d);
  });
}

function updateCar() {
  const name = S.car ? carLabel(S.car, S.online) : activeProfile(S.settings).name !== 'Varsayılan araç' && S.running ? activeProfile(S.settings).name : 'OBD2';
  $('#carName').textContent = name + ' · OBD Panosu';
  document.title = name + ' OBD Panosu';
}

function buildInfo() {
  const e = S.elm;
  const rows = [
    ['ELM327', e?.info.elm || '—'],
    ['VIN', S.vin || '— (araç desteklemiyor olabilir)'],
    ['Araç (VIN\'den)', S.car ? carLabel(S.car, S.online) + (S.car.model || S.online?.model ? '' : ' — model VIN\'den çıkarılamadı') : '—'],
    ['Model kodu (7-8. hane)', S.car ? S.car.code : '—'],
    ['Protokol (ATDPN)', e?.info.protocol || '—'],
    ['Akü voltajı (ATRV)', e?.info.voltage ? e.info.voltage + ' V' : '—'],
    ['Desteklenen PID sayısı', S.defs.length + ' tanımlı değer / ' + (e?.supported?.size ?? 0) + ' PID (araçta toplam)'],
  ];
  $('#infoBody').innerHTML = rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('');
  $('#pidBody').innerHTML = S.defs.map((p) => `<tr><td>${p.id}</td><td>${p.name}</td><td id="pv${p.key}">—</td></tr>`).join('');
  const extra = [...(e?.supported || [])].filter((id) => !PID_BY_ID[id] && id !== STATUS_PID).sort();
  $('#rawCount').textContent = extra.length + ' PID';
  $('#rawBody').innerHTML = extra.map((id) => `<tr><td>${id}</td><td>${EXTRA_NAMES[id] || 'Tanımsız / üreticiye özel'}</td><td id="rw${id}">—</td></tr>`).join('');
}

// ---------- çizim döngüsü ----------
function sparkOpts(color) { return { tmin: now() - 60, tmax: now(), min: null, max: null, color, fill: true }; }

const disp = {};
function ease(k, target) {
  if (target == null) return (disp[k] = null);
  disp[k] = disp[k] == null ? target : disp[k] + (target - disp[k]) * 0.3;
  return disp[k];
}

let tick = 0;
function render() {
  tick++;
  const t = now(), st = S.settings;
  $('#stRate').textContent = (S.running ? S.rate.toFixed(1) : '—') + ' PID/sn';
  const volt = val('42') ?? S.elm?.info.voltage;
  $('#stVolt').textContent = 'Akü ' + (volt ? volt.toFixed(1) + ' V' : '—');
  const sb = S.status?.bytes[0];
  const mil = $('#stMil');
  mil.textContent = sb == null ? 'MIL —' : sb & 0x80 ? `MIL AÇIK · ${sb & 0x7f} kod` : 'MIL kapalı';
  mil.classList.toggle('on', sb != null && !!(sb & 0x80));

  if (S.tab === 'dash') {
    const mph = st.speed === 'mph';
    drawGauge($('#gRpm'), { value: ease('rpm', val('0C')), min: 0, max: 7000, ticks: 7, unit: 'rpm', label: 'Motor Devri', warn: 6200 });
    const sv = val('0D');
    drawGauge($('#gSpd'), { value: ease('spd', sv == null ? null : mph ? sv * 0.621371 : sv), min: 0, max: mph ? 150 : 240, ticks: mph ? 5 : 8, unit: mph ? 'mph' : 'km/h', label: 'Hız' });
    for (const p of S.defs) {
      const el = document.getElementById('tile' + p.key); if (!el) continue;
      const v = val(p.key), [txt, unit] = show(p, v, st);
      el.querySelector('.v span').textContent = txt;
      el.querySelector('.v small').textContent = unit;
      el.classList.toggle('bad', p.warn != null && v != null && v >= p.warn);
      drawLine(el.querySelector('canvas'), S.hist[p.key] || [], { ...sparkOpts('#3fb6ff'), min: p.min, max: p.max });
    }
  } else if (S.tab === 'charts') {
    if (tick % 2) return;
    const win = +$('#selWin').value;
    document.querySelectorAll('.chart').forEach((el) => {
      const p = PID_BY_KEY[el.id.slice(2)], h = S.hist[p.key] || [];
      const vis = h.filter((x) => x[0] >= t - win).map((x) => [x[0], conv(p.unit, x[1], st)[0]]);
      const [cur, unit] = show(p, val(p.key), st);
      el.querySelector('.hd span').textContent = cur + ' ' + unit;
      if (vis.length) {
        const vs = vis.map((x) => x[1]), f = (x) => x.toFixed(Math.abs(x) >= 100 ? 0 : 1);
        el.querySelector('.mm').textContent = `min ${f(Math.min(...vs))} · ort ${f(vs.reduce((a, b) => a + b, 0) / vs.length)} · maks ${f(Math.max(...vs))}`;
      }
      drawLine(el.querySelector('canvas'), vis, { tmin: t - win, tmax: t, color: el.dataset.color, grid: true, labels: true, fill: true });
    });
  } else if (S.tab === 'info') {
    for (const p of S.defs) { const c = document.getElementById('pv' + p.key); if (c) { const [x, u] = show(p, val(p.key), st); c.textContent = x + ' ' + u; } }
  } else {
    X.render(S.tab, tick);
  }
}

// ---------- olaylar ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('main > section[id^=tab-]').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + S.tab));
  X.tabShown(S.tab);
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

// arıza kodları: kayıtlı + bekleyen + kalıcı
const dtcRow = (c) => `<tr><td class="code">${c}</td><td>${dtcDescribe(c)}</td></tr>`;
async function readCodes(mode) { try { return await S.elm.readDtcs(mode); } catch { return null; } }
$('#btnDtc').addEventListener('click', async () => {
  if (!S.elm) return toast('Önce bağlanın', true);
  try {
    const codes = await S.elm.readDtcs('03');
    $('#dtcCount').textContent = codes.length ? codes.length + ' kod' : 'Kayıtlı arıza yok';
    $('#dtcBody').innerHTML = codes.length ? codes.map(dtcRow).join('') : '<tr><td colspan="2" class="ok">Kayıtlı arıza kodu bulunmuyor.</td></tr>';
    const pend = await readCodes('07'), perm = await readCodes('0A');
    const fill = (id, a) => { $(id).innerHTML = a == null ? '<tr><td class="na">Araç desteklemiyor / yanıt yok</td></tr>' : a.length ? a.map(dtcRow).join('') : '<tr><td class="ok">Yok</td></tr>'; };
    fill('#dtcPend', pend); fill('#dtcPerm', perm);
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

$('#btnRaw').addEventListener('click', async () => {
  if (!S.elm) return toast('Önce bağlanın', true);
  for (const td of document.querySelectorAll('#rawBody td[id^=rw]')) {
    if (!S.elm) break;
    try { td.textContent = (await S.elm.readRaw(td.id.slice(2))) ?? 'yanıt yok'; } catch { td.textContent = 'hata'; }
  }
});
$('#btnVinOnline').addEventListener('click', async () => {
  if (!S.vin) return toast('VIN okunamadı', true);
  if (!confirm('VIN (' + S.vin + ') model doğrulaması için ABD NHTSA sunucusuna (vpic.nhtsa.dot.gov) gönderilecek. Devam edilsin mi?')) return;
  try {
    S.online = await lookupNhtsa(S.vin);
    if (!S.online.make && !S.online.model) toast('NHTSA bu VIN için kayıt bulamadı (Avrupa araçlarında normal)', true);
    updateCar(); buildInfo();
  } catch (e) { toast('Sorgulanamadı: ' + e.message, true); }
});

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#btnTheme').textContent = t === 'light' ? '🌙 Gece' : '☀ Gündüz';
  try { localStorage.setItem('theme', t); } catch {}
  render();
}
$('#btnTheme').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
$('#btnTheme').textContent = document.documentElement.dataset.theme === 'light' ? '🌙 Gece' : '☀ Gündüz';

window.addEventListener('pagehide', persistTrip);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistTrip(); });

// ---------- ek özellikler (sensörler, istatistik, monitörler, performans, kayıt, ayarlar) ----------
const X = initExtra({
  S, $, toast, now, saveFile, val, valsMap, saveSettings,
  resetTrip: () => { S.trip = newTrip(); },
  persistTrip, updateCar,
});

if (!SerialTransport.supported && BleTransport.supported) {
  $('#selTransport').value = 'ble';
  $('#selTransport').dispatchEvent(new Event('change'));
}
if (!SerialTransport.supported && !BleTransport.supported) {
  $('#connHelp').textContent = 'Bu tarayıcı Web Serial/Bluetooth desteklemiyor. Chrome veya Edge (masaüstü, HTTPS) kullanın; demo modu yine çalışır.';
  $('#selTransport').value = 'sim';
}
setInterval(render, 60);
