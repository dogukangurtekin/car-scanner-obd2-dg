import { PIDS, PID_BY_KEY, PID_BY_ID } from './pids.js?v=19';
import { dtcDescribe } from './dtc.js?v=19';
import { drawBars, drawLine, drawCombo } from './charts.js?v=19';
import { conv, consConv, show, activeProfile, fuelFlowLps, estimateHp, FUEL, DEFAULT_PROFILE } from './calc.js?v=19';
import { decodeReadiness, decodeMode06, MID_NAMES } from './monitors.js?v=19';
import { PerfEngine, TESTS } from './perf.js?v=19';
import { loadTrips, clearTrips, loadPerf, savePerf, recSave, recList, recRows, recDelete } from './store.js?v=19';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dur = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function initExtra(ctx) {
  const { S, $, toast, now, saveFile, val, valsMap, saveSettings, resetTrip, persistTrip, updateCar } = ctx;
  const st = () => S.settings;
  const prof = () => activeProfile(S.settings);
  const save = () => saveSettings(S.settings);
  const money = (x) => (st().price > 0 ? `${x.toFixed(2)} ${st().cur}` : '—');
  const cons = (l100) => { const [x, u] = consConv(l100, st()); return x == null ? '—' : `${x.toFixed(1)} ${u}`; };
  const dist = (km) => { const [x, u] = conv('km', km, st()); return `${x.toFixed(2)} ${u}`; };
  const spd = (kmh) => { const [x, u] = conv('km/h', kmh, st()); return `${x.toFixed(0)} ${u}`; };

  // ================= AYARLAR + ARAÇLARIM =================
  function ensureProfile() {
    if (!S.settings.profiles.length) {
      S.settings.profiles.push({ ...DEFAULT_PROFILE });
      S.settings.activeProfile = DEFAULT_PROFILE.id;
      save();
    }
    if (!S.settings.profiles.some((p) => p.id === S.settings.activeProfile)) S.settings.activeProfile = S.settings.profiles[0].id;
  }
  function fillProfiles() {
    ensureProfile();
    $('#profSel').innerHTML = S.settings.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('#profSel').value = S.settings.activeProfile;
    const p = prof();
    $('#profName').value = p.name; $('#profDisp').value = p.disp; $('#profFuel').value = p.fuel; $('#profTank').value = p.tank;
  }
  function fillSettings() {
    const s = st();
    $('#setSpeed').value = s.speed; $('#setTemp').value = s.temp; $('#setPress').value = s.press; $('#setCons').value = s.cons;
    $('#setPrice').value = s.price; $('#setCur').value = s.cur; $('#setWake').checked = !!s.wake;
    fillProfiles();
  }
  for (const [id, key] of [['#setSpeed', 'speed'], ['#setTemp', 'temp'], ['#setPress', 'press'], ['#setCons', 'cons']]) {
    $(id).addEventListener('change', () => { S.settings[key] = $(id).value; save(); });
  }
  $('#setPrice').addEventListener('input', () => { S.settings.price = Math.max(0, parseFloat($('#setPrice').value) || 0); save(); });
  $('#setCur').addEventListener('input', () => { S.settings.cur = $('#setCur').value.slice(0, 4); save(); });
  $('#setWake').addEventListener('change', () => { S.settings.wake = $('#setWake').checked; save(); wake(S.running && S.settings.wake); });
  $('#profSel').addEventListener('change', () => { S.settings.activeProfile = $('#profSel').value; save(); fillProfiles(); updateCar(); });
  const editProf = (fn) => { fn(prof()); save(); const o = $('#profSel').selectedOptions[0]; if (o) o.textContent = prof().name; };
  $('#profName').addEventListener('input', () => editProf((p) => { p.name = $('#profName').value || 'Araç'; }));
  $('#profDisp').addEventListener('input', () => editProf((p) => { p.disp = Math.min(10, Math.max(0.5, parseFloat($('#profDisp').value) || 1.6)); }));
  $('#profFuel').addEventListener('change', () => editProf((p) => { p.fuel = $('#profFuel').value; }));
  $('#profTank').addEventListener('input', () => editProf((p) => { p.tank = Math.min(200, Math.max(10, parseFloat($('#profTank').value) || 55)); }));
  $('#btnProfNew').addEventListener('click', () => {
    const p = { ...DEFAULT_PROFILE, id: 'p' + Date.now(), name: 'Yeni araç' };
    S.settings.profiles.push(p); S.settings.activeProfile = p.id; save(); fillProfiles();
  });
  $('#btnProfDel').addEventListener('click', () => {
    if (!confirm(`"${prof().name}" silinsin mi?`)) return;
    S.settings.profiles = S.settings.profiles.filter((p) => p.id !== S.settings.activeProfile);
    S.settings.activeProfile = null; ensureProfile(); save(); fillProfiles();
  });
  function onVin(vin, label) {
    ensureProfile();
    let p = S.settings.profiles.find((x) => x.vin === vin);
    if (!p) {
      const blank = S.settings.profiles.length === 1 && !S.settings.profiles[0].vin ? S.settings.profiles[0] : null;
      if (blank) { p = blank; p.vin = vin; if (p.name === DEFAULT_PROFILE.name) p.name = label || vin; }
      else {
        p = { ...DEFAULT_PROFILE, id: 'v' + Date.now(), vin, name: label || vin };
        S.settings.profiles.push(p);
        toast('Yeni araç profili oluşturuldu — motor hacmi/yakıtı Ayarlar → Araçlarım\'dan kontrol edin');
      }
    }
    S.settings.activeProfile = p.id; save(); fillProfiles();
  }

  // ================= EKRANI AÇIK TUT =================
  let wl = null;
  async function wake(on) {
    try {
      if (on && 'wakeLock' in navigator) wl = await navigator.wakeLock.request('screen');
      else { await wl?.release(); wl = null; }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.running && st().wake) wake(true); });

  // ================= TÜM SENSÖRLER =================
  const COMP = [
    ['c_inst', 'Anlık tüketim'], ['c_lph', 'Anlık yakıt akışı'], ['c_avg', 'Ortalama tüketim (yolculuk)'], ['c_fuel', 'Kullanılan yakıt (yolculuk)'],
    ['c_cost', 'Maliyet (yolculuk)'], ['c_dist', 'Katedilen mesafe (yolculuk)'], ['c_avgv', 'Ortalama hız'], ['c_vmax', 'Maksimum hız'],
    ['c_time', 'Yolculuk süresi'], ['c_idle', 'Rölanti süresi'], ['c_acc', 'Araç ivmesi'], ['c_boost', 'Emme basıncı − barometrik (boost/vakum)'],
    ['c_hp', 'Tahmini motor gücü (yakıt tüketiminden)'], ['c_co2', 'CO₂ emisyonu (tahmini)'], ['c_rpmk', 'Devir ×1000'],
    ['c_range', 'Tahmini menzil'], ['c_volt', 'OBD adaptör voltajı'],
  ];
  function accel() {
    const h = S.hist['0D'];
    if (!h || h.length < 2) return null;
    const [t1, v1] = h[h.length - 1];
    for (let i = h.length - 2; i >= 0; i--) if (t1 - h[i][0] >= 0.6) return (v1 - h[i][1]) / 3.6 / (t1 - h[i][0]) / 9.81;
    return null;
  }
  function computeAll() {
    const v = valsMap(), p = prof(), tr = S.trip, f = FUEL[p.fuel] || FUEL.petrol;
    const lps = fuelFlowLps(v, p), spdv = v['0D'];
    const lph = lps != null ? lps * 3600 : null;
    const inst = lps != null && spdv > 3 ? (lph / spdv) * 100 : null;
    const avg = tr.dist > 0.2 && tr.fuel > 0 ? (tr.fuel / tr.dist) * 100 : null;
    const out = {};
    const [ci, cu] = consConv(inst, st());
    out.c_inst = [ci != null ? ci.toFixed(1) : (lph != null ? '∞' : '—'), cu];
    out.c_lph = [lph != null ? lph.toFixed(2) : '—', 'L/h'];
    const [ca, cau] = consConv(avg, st());
    out.c_avg = [ca != null ? ca.toFixed(1) : '—', cau];
    out.c_fuel = [tr.fuel.toFixed(3), 'L'];
    out.c_cost = [st().price > 0 ? (tr.fuel * st().price).toFixed(2) : '—', st().cur];
    const [dv, du] = conv('km', tr.dist, st()); out.c_dist = [dv.toFixed(2), du];
    const [av, au] = conv('km/h', tr.vt ? tr.vsum / tr.vt : 0, st()); out.c_avgv = [av.toFixed(0), au];
    const [mv, mu] = conv('km/h', tr.vmax, st()); out.c_vmax = [mv.toFixed(0), mu];
    out.c_time = [dur(tr.t), ''];
    out.c_idle = [dur(tr.idle), ''];
    const a = accel(); out.c_acc = [a == null ? '—' : a.toFixed(2), 'g'];
    if (v['0B'] != null) { const [bv, bu] = conv('kPa', v['0B'] - (v['33'] ?? 101.3), st()); out.c_boost = [bv.toFixed(bu === 'bar' ? 2 : 1), bu]; } else out.c_boost = ['—', ''];
    const hp = estimateHp(lps, p); out.c_hp = [hp != null ? hp.toFixed(0) : '—', 'hp'];
    out.c_co2 = [inst != null ? (inst * f.co2 * 10).toFixed(0) : '—', 'g/km'];
    out.c_rpmk = [v['0C'] != null ? (v['0C'] / 1000).toFixed(2) : '—', 'x1000'];
    const ref = avg ?? inst;
    if (v['2F'] != null && ref) { const [rv, ru] = conv('km', (v['2F'] / 100 * p.tank / ref) * 100, st()); out.c_range = [rv.toFixed(0), ru]; } else out.c_range = ['—', ''];
    out.c_volt = [S.elm?.info.voltage ? S.elm.info.voltage.toFixed(1) : '—', 'V'];
    return out;
  }
  function buildSensors() {
    const groups = new Set();
    const rows = [];
    for (const p of S.defs) { groups.add(p.grp || 'Diğer'); rows.push(`<tr data-k="${p.key}" data-g="${p.grp || 'Diğer'}"><td>${esc(p.name)}<span class="ms"></span></td><td>—</td></tr>`); }
    groups.add('Hesaplanan');
    for (const [k, n] of COMP) rows.push(`<tr data-k="${k}" data-g="Hesaplanan"><td>${esc(n)}</td><td>—</td></tr>`);
    $('#senBody').innerHTML = rows.join('');
    $('#senGroup').innerHTML = '<option value="">Tümü</option>' + [...groups].sort().map((g) => `<option>${g}</option>`).join('');
    filterSensors();
  }
  function filterSensors() {
    const q = $('#senSearch').value.trim().toLowerCase(), g = $('#senGroup').value;
    document.querySelectorAll('#senBody tr').forEach((r) => {
      r.classList.toggle('hidden', (g && r.dataset.g !== g) || (q && !r.firstChild.textContent.toLowerCase().includes(q)));
    });
  }
  $('#senSearch').addEventListener('input', filterSensors);
  $('#senGroup').addEventListener('change', filterSensors);
  function renderSensors() {
    const comp = computeAll(), t = now();
    document.querySelectorAll('#senBody tr').forEach((r) => {
      if (r.classList.contains('hidden')) return;
      const k = r.dataset.k, c = r.children[1];
      if (comp[k]) { c.textContent = (comp[k][0] + ' ' + comp[k][1]).trim(); return; }
      const p = PID_BY_KEY[k], l = S.latest[k];
      const [x, u] = show(p, l?.v, st());
      c.textContent = (x + ' ' + u).trim();
      r.querySelector('.ms').textContent = l ? Math.round((t - l.t) * 1000) + 'ms' : '';
    });
  }

  // ================= İSTATİSTİK =================
  let trips = loadTrips(), tripsAt = 0;
  const fmtDate = (ts) => new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  function agg(list) {
    const a = { dist: 0, fuel: 0, t: 0, cost: 0 };
    for (const x of list) { a.dist += x.dist; a.fuel += x.fuel; a.t += x.t; a.cost += x.fuel * (x.price || 0); }
    return a;
  }
  function allTrips() {
    const cur = S.trip;
    const live = { id: cur.id, start: cur.start, t: cur.t, dist: cur.dist, fuel: cur.fuel, vsum: cur.vsum, vt: cur.vt, price: st().price, cur: st().cur };
    return [...trips.filter((x) => x.id !== cur.id), ...(cur.t > 0 ? [live] : [])];
  }
  function renderStats(tick) {
    if (tick - tripsAt > 25) { trips = loadTrips(); tripsAt = tick; }
    const tr = S.trip, p = prof(), f = FUEL[p.fuel] || FUEL.petrol;
    const avgV = tr.vt ? tr.vsum / tr.vt : 0;
    const avgC = tr.dist > 0.05 && tr.fuel > 0 ? (tr.fuel / tr.dist) * 100 : null;
    const kp = [
      ['Süre', dur(tr.t)], ['Mesafe', dist(tr.dist)], ['Ort. hız', spd(avgV)], ['Maks. hız', spd(tr.vmax)],
      ['Maks. devir', tr.rmax.toFixed(0) + ' rpm'], ['Rölanti', dur(tr.idle)], ['Kullanılan yakıt', tr.fuel.toFixed(2) + ' L'],
      ['Anlık tüketim', tr.inst != null ? cons(tr.inst) : tr.lph != null ? tr.lph.toFixed(1) + ' L/h' : '—'],
      ['Ort. tüketim', cons(avgC)], ['Maliyet', money(tr.fuel * st().price)],
      ['CO₂ (ort.)', avgC != null ? (avgC * f.co2 * 10).toFixed(0) + ' g/km' : '—'],
      ['Maks. su sıc.', tr.cmax > -99 ? (() => { const [x, u] = conv('°C', tr.cmax, st()); return x.toFixed(0) + ' ' + u; })() : '—'],
    ];
    const box = (n, v) => `<div class="card kpi"><div class="n">${n}</div><div class="v">${v}</div></div>`;
    $('#kpis').innerHTML = kp.map(([n, v]) => box(n, v)).join('');

    const list = allTrips(), today = dayKey(Date.now()), weekAgo = Date.now() - 7 * 864e5;
    const sets = [['Bugün', list.filter((x) => dayKey(x.start) === today)], ['Son 7 gün', list.filter((x) => x.start >= weekAgo)], ['Toplam', list]];
    $('#kpisTot').innerHTML = sets.map(([n, l]) => {
      const a = agg(l);
      return box(n, `${dist(a.dist)}<div class="mm" style="font-size:12px;color:var(--muted);font-weight:400">${a.fuel.toFixed(1)} L · ${cons(a.dist > 0.2 ? (a.fuel / a.dist) * 100 : null)} · ${money(a.cost)}</div>`);
    }).join('');

    const pct = (a) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map((x) => (x / s) * 100); };
    drawBars($('#hRpm'), ['0-1k', '1-2k', '2-3k', '3-4k', '4-5k', '5-6k', '6-7k', '7k+'], pct(tr.rpmH), '#3fb6ff');
    drawBars($('#hSpd'), ['0-25', '25-50', '50-75', '75-100', '100-125', '125-150', '150-175', '175+'], pct(tr.spdH), '#3ddc84');

    // günlük çubuk + tüketim çizgisi (son 14 gün)
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
    const labels = days.map((d) => `${d.getDate()}.${d.getMonth() + 1}`);
    const per = days.map((d) => agg(list.filter((x) => dayKey(x.start) === dayKey(d.getTime()))));
    const bars = per.map((a) => conv('km', a.dist, st())[0]);
    const line = per.map((a) => (a.dist > 0.5 ? consConv((a.fuel / a.dist) * 100, st())[0] : null));
    drawCombo($('#hDays'), labels, bars, line, ['#3fb6ff', '#ff7a59']);

    $('#tripBody').innerHTML = list.slice().sort((a, b) => b.start - a.start).slice(0, 15).map((x) => {
      const a = x.vt ? x.vsum / x.vt : 0, c = x.dist > 0.2 && x.fuel > 0 ? (x.fuel / x.dist) * 100 : null;
      return `<tr><td>${fmtDate(x.start)}</td><td>${dur(x.t)}</td><td>${dist(x.dist)}</td><td>${spd(a)}</td><td>${x.fuel.toFixed(2)} L</td><td>${cons(c)}</td><td>${x.price > 0 ? (x.fuel * x.price).toFixed(2) + ' ' + (x.cur || '') : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="na">Henüz yolculuk yok.</td></tr>';
  }
  $('#btnReset').addEventListener('click', () => { persistTrip(); resetTrip(); trips = loadTrips(); });
  $('#btnTripClear').addEventListener('click', () => { if (confirm('Tüm yolculuk geçmişi silinsin mi?')) { clearTrips(); trips = []; } });
  $('#btnTripCsv').addEventListener('click', () => {
    const list = allTrips();
    if (!list.length) return toast('Yolculuk yok', true);
    const head = ['baslangic', 'sure_sn', 'mesafe_km', 'yakit_L', 'tuketim_L100km', 'maliyet'];
    const rows = list.map((x) => [new Date(x.start).toISOString(), x.t.toFixed(0), x.dist.toFixed(3), x.fuel.toFixed(3), x.dist > 0.2 ? ((x.fuel / x.dist) * 100).toFixed(2) : '', x.price > 0 ? (x.fuel * x.price).toFixed(2) : ''].join(';').replace(/\./g, ','));
    saveFile('yolculuklar.csv', '﻿' + [head.join(';'), ...rows].join('\r\n'));
  });

  // ================= FREEZE FRAME =================
  $('#btnFreeze').addEventListener('click', async () => {
    if (!S.elm) return toast('Önce bağlanın', true);
    $('#ffDtc').textContent = 'Okunuyor…';
    try {
      const ids = [...S.elm.supported].filter((id) => PID_BY_ID[id] && id !== '01');
      const { dtc, values } = await S.elm.readFreezeFrame(ids);
      $('#ffDtc').textContent = dtc ? 'Tetikleyen kod: ' + dtc : 'Donmuş veri yok';
      const rows = [];
      for (const p of PIDS) {
        const b = values[p.id];
        if (!b) continue;
        const [x, u] = show(p, p.f(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0), st());
        rows.push(`<tr><td>${esc(p.name)}</td><td>${(x + ' ' + u).trim()}</td></tr>`);
      }
      $('#ffBody').innerHTML = dtc || rows.length ? rows.join('') : '<tr><td class="na">Araç freeze frame verisi vermedi (kayıtlı arıza yoksa normaldir).</td></tr>';
      if (dtc) $('#ffDtc').title = dtcDescribe(dtc);
    } catch (e) { toast(e.message, true); $('#ffDtc').textContent = '—'; }
  });

  // ================= EMİSYON / MONİTÖRLER =================
  function drawReadiness(el, r) {
    el.innerHTML = r.items.map((i) => {
      const status = !i.avail ? '<span class="na">Uygun değil</span>' : i.complete ? '<span class="ok">Tamamlandı</span>' : '<span class="badx">Tamamlanmadı</span>';
      return `<tr><td>${i.name}</td><td style="text-align:right">${status}</td></tr>`;
    }).join('');
  }
  async function readReady() {
    if (!S.elm) return toast('Önce bağlanın', true);
    $('#readyPill').textContent = 'Okunuyor…';
    try {
      const a = await S.elm.readStatusBytes('01');
      if (!a) { $('#readyPill').textContent = 'Araç yanıt vermedi'; return; }
      const r = decodeReadiness(a, false);
      drawReadiness($('#readyBody'), r);
      $('#readyBody').insertAdjacentHTML('afterbegin', `<tr><td>Motor arıza lambası (MIL)</td><td style="text-align:right" class="${r.mil ? 'badx' : 'ok'}">${r.mil ? 'AÇIK' : 'Kapalı'} · ${r.count} kod</td></tr>`);
      const pill = $('#readyPill');
      pill.textContent = r.ready && !r.mil ? 'Muayeneye hazır' : `${r.pending} test tamamlanmadı${r.mil ? ' · MIL açık' : ''}`;
      pill.className = 'pill ' + (r.ready && !r.mil ? 'on' : '');
      const b = await S.elm.readStatusBytes('41').catch(() => null);
      if (b) drawReadiness($('#readyDrive'), decodeReadiness([0, ...b.slice(1)], true));
      else $('#readyDrive').innerHTML = '<tr><td class="na">Araç bu bilgiyi vermiyor</td></tr>';
    } catch (e) { toast(e.message, true); }
  }
  $('#btnReady').addEventListener('click', readReady);
  $('#btnMode06').addEventListener('click', async () => {
    if (!S.elm) return toast('Önce bağlanın', true);
    $('#m06Pill').textContent = 'Okunuyor…';
    try {
      const { mids, bytes } = await S.elm.readMode06((i, n) => { $('#m06Pill').textContent = `Okunuyor ${i}/${n}`; });
      const res = decodeMode06(bytes);
      $('#m06Pill').textContent = res.length ? `${res.length} test sonucu` : mids.length ? 'Sonuç yok' : 'Araç Mode 06 desteklemiyor';
      $('#m06Body').innerHTML = res.map((r) => `<tr><td>${MID_NAMES[r.mid] || 'MID $' + r.mid}<div class="na" style="font-size:11px">MID $${r.mid}</div></td><td>$${r.tid}</td><td>${r.value}</td><td>${r.min}</td><td>${r.max}</td><td class="${r.pass ? 'ok' : 'badx'}">${r.pass ? 'GEÇTİ' : 'KALDI'}</td></tr>`).join('');
    } catch (e) { toast(e.message, true); $('#m06Pill').textContent = '—'; }
  });

  // ================= ECU TANIMLAYICILARI =================
  $('#btnEcuId').addEventListener('click', async () => {
    if (!S.elm) return toast('Önce bağlanın', true);
    const rows = [];
    for (const [pid, name] of [['0A', 'ECU adı'], ['04', 'Kalibrasyon ID'], ['06', 'Kalibrasyon doğrulama (CVN)']]) {
      let v = null;
      try { v = await S.elm.readInfo(pid); } catch {}
      rows.push(`<tr><th>${name}</th><td>${v ? esc(v) : '<span class="na">Araç vermedi</span>'}</td></tr>`);
    }
    $('#ecuBody').innerHTML = rows.join('');
  });

  // ================= PERFORMANS =================
  let perfData = loadPerf();
  const perf = new PerfEngine((test, seconds, vmax) => {
    const d = (perfData[test.id] ||= { best: null, hist: [] });
    const best = d.best == null || seconds < d.best;
    if (best) d.best = seconds;
    d.hist = [...d.hist, { s: +seconds.toFixed(3), v: Math.round(vmax), t: Date.now() }].slice(-10);
    savePerf(perfData);
    toast(`${test.name}: ${seconds.toFixed(2)} sn${best ? ' — yeni en iyi!' : ''}`);
  });
  const perfTiles = $('#perfTiles');
  perfTiles.innerHTML = TESTS.map((t) => `<div class="card tile ptile" data-id="${t.id}"><div class="n">${t.name}</div><div class="v">—</div><div class="s"></div></div>`).join('');
  const STATE_TXT = (t, s) => ({
    wait: t.standing ? 'Bekleniyor: aracı durdurun' : `Bekleniyor: ${t.from} km/h altına inin`,
    ready: t.standing ? 'HAZIR — kalkın' : `Hazır — ${t.from} km/h'ye çıkın`,
    run: 'Ölçülüyor…', done: 'Tamamlandı',
  }[s.state]);
  function renderPerf() {
    const v = val('0D');
    $('#perfPill').textContent = v == null ? 'Hız verisi bekleniyor' : 'Hız: ' + spd(v);
    perfTiles.querySelectorAll('.ptile').forEach((el) => {
      const t = TESTS.find((x) => x.id === el.dataset.id), s = perf.st[t.id], d = perfData[t.id];
      el.className = 'card tile ptile ' + (s.state === 'run' ? 'run' : s.state === 'ready' ? 'ready' : s.state === 'done' ? 'done' : '');
      el.querySelector('.v').textContent = s.state === 'run' ? (s.elapsed || 0).toFixed(2) + ' sn' : s.last != null ? s.last.toFixed(2) + ' sn' : '—';
      el.querySelector('.s').innerHTML = STATE_TXT(t, s) + (d?.best != null ? `<br>En iyi: ${d.best.toFixed(2)} sn` : '');
    });
  }
  $('#btnPerfReset').addEventListener('click', () => {
    if (!confirm('En iyi süreler dahil tüm performans sonuçları silinsin mi?')) return;
    perfData = {}; savePerf(perfData); perf.reset();
    for (const s of Object.values(perf.st)) s.last = null;
  });

  // ================= KAYIT =================
  const rec = { on: false, keys: [], rows: [], timer: null, t0: 0, start: 0, sel: new Set() };
  function buildRecPick() {
    const items = S.defs.filter((p) => !p.lbl);
    if (!rec.sel.size) items.forEach((p) => rec.sel.add(p.key));
    $('#recPick').innerHTML = items.map((p) => `<label><input type="checkbox" value="${p.key}" ${rec.sel.has(p.key) ? 'checked' : ''}>${esc(p.name)}</label>`).join('');
    $('#recPick').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { i.checked ? rec.sel.add(i.value) : rec.sel.delete(i.value); }));
  }
  function recSample() {
    const row = [(now() - rec.t0)];
    for (const k of rec.keys) { const l = S.latest[k]; row.push(l && now() - l.t < 10 ? +l.v.toFixed(3) : null); }
    rec.rows.push(row);
    if (rec.rows.length >= 100000) stopRec();
  }
  function startRec() {
    if (!S.running) return toast('Önce bağlanın', true);
    rec.keys = S.defs.filter((p) => rec.sel.has(p.key) && !p.lbl).map((p) => p.key);
    if (!rec.keys.length) return toast('En az bir değer seçin', true);
    rec.rows = []; rec.t0 = now(); rec.start = Date.now(); rec.on = true;
    rec.timer = setInterval(recSample, +$('#recInt').value);
    $('#btnRecToggle').textContent = '■ Kaydı durdur';
  }
  async function stopRec() {
    if (!rec.on) return;
    clearInterval(rec.timer); rec.on = false;
    $('#btnRecToggle').textContent = '● Kaydı başlat';
    if (rec.rows.length < 2) { $('#recPill').textContent = 'Kayıt kapalı'; return toast('Kayıt çok kısa, saklanmadı', true); }
    const meta = {
      id: rec.start, start: rec.start, dur: rec.rows[rec.rows.length - 1][0], count: rec.rows.length,
      keys: rec.keys, names: rec.keys.map((k) => PID_BY_KEY[k].name), units: rec.keys.map((k) => PID_BY_KEY[k].unit),
    };
    try { await recSave(meta, rec.rows); toast('Kayıt saklandı'); } catch (e) { toast('Kayıt saklanamadı: ' + e.message, true); }
    rec.rows = [];
    refreshRecList();
  }
  $('#btnRecToggle').addEventListener('click', () => (rec.on ? stopRec() : startRec()));
  let viewing = null;
  async function refreshRecList() {
    let list = [];
    try { list = await recList(); } catch {}
    $('#recList').innerHTML = list.length ? list.map((m) => `<tr><td><div class="recrow"><span><b>${fmtDate(m.start)}</b> · ${dur(m.dur)} · ${m.count} satır · ${m.keys.length} değer</span><span class="row"><button class="btn alt" data-a="view" data-id="${m.id}">Göster</button><button class="btn alt" data-a="csv" data-id="${m.id}">CSV</button><button class="btn danger" data-a="del" data-id="${m.id}">Sil</button></span></div></td></tr>`).join('') : '<tr><td class="na">Kayıt yok.</td></tr>';
    S.recMeta = Object.fromEntries(list.map((m) => [m.id, m]));
  }
  $('#recList').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = +b.dataset.id, m = S.recMeta[id];
    if (b.dataset.a === 'del') { if (confirm('Kayıt silinsin mi?')) { await recDelete(id); if (viewing === id) $('#recView').classList.add('hidden'); refreshRecList(); } }
    else if (b.dataset.a === 'csv') {
      const rows = await recRows(id);
      const head = ['sure_sn', ...m.names.map((n, i) => `${n} (${m.units[i]})`)];
      const csv = [head.join(';'), ...rows.map((r) => r.map((x) => (x == null ? '' : String(x).replace('.', ','))).join(';'))].join('\r\n');
      saveFile('kayit-' + new Date(m.start).toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv', '﻿' + csv);
    } else {
      viewing = id;
      $('#recView').classList.remove('hidden');
      $('#recTitle').textContent = fmtDate(m.start) + ' · ' + dur(m.dur);
      $('#recSeries').innerHTML = m.names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
      drawRec();
    }
  });
  async function drawRec() {
    const m = S.recMeta[viewing]; if (!m) return;
    const rows = await recRows(viewing), i = +$('#recSeries').value, unit = m.units[i];
    const series = rows.filter((r) => r[i + 1] != null).map((r) => [r[0], conv(unit, r[i + 1], st())[0]]);
    drawLine($('#recChart'), series, { tmin: 0, tmax: m.dur || 1, color: '#3fb6ff', grid: true, labels: true, fill: true });
  }
  $('#recSeries').addEventListener('change', drawRec);

  // ================= DIŞARIYA AÇILAN ARAYÜZ =================
  fillSettings();
  refreshRecList();

  return {
    onConnect() {
      buildSensors(); buildRecPick(); perf.reset();
      S.onSample = (k, v, t) => { if (k === '0D') perf.sample(t, v); };
      wake(st().wake);
    },
    onDisconnect() { stopRec(); S.onSample = null; wake(false); },
    onVin,
    tabShown(tab) {
      if (tab === 'stats') { trips = loadTrips(); renderStats(0); }
      if (tab === 'mon' && S.elm && !$('#readyBody').children.length) readReady();
      if (tab === 'rec') refreshRecList();
    },
    render(tab, tick) {
      if (rec.on) $('#recPill').textContent = `● Kayıt: ${dur(now() - rec.t0)} · ${rec.rows.length} satır`;
      else if ($('#recPill').textContent.startsWith('●')) $('#recPill').textContent = 'Kayıt kapalı';
      if (tab === 'sensors') { if (tick % 3 === 0) renderSensors(); }
      else if (tab === 'stats') { if (tick % 5 === 0) renderStats(tick); }
      else if (tab === 'perf') renderPerf();
    },
  };
}
