import { KW1281, KWError, MODULES, vagToP, decodeValue } from './kw1281.js?v=22';
import { KLineSerial } from './kwio.js?v=22';
import { snapSave, snapList, snapDelete } from './store.js?v=22';

const $ = (s) => document.querySelector(s);
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let io = null, busy = false, stop = false;
const logLines = [];
function log(msg) {
  const line = `${new Date().toLocaleTimeString('tr-TR')}  ${msg}`;
  logLines.push(line);
  const el = $('#log');
  el.append(line + '\n');
  el.scrollTop = el.scrollHeight;
}
function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
}

// ---------- modül listesi ----------
$('#modList').innerHTML = MODULES.map(([a, n], i) => `<label><input type="checkbox" value="${a}" ${['01', '03', '09', '17', '19'].includes(a) ? 'checked' : ''}>${a} · ${n}</label>`).join('');

// ---------- bağlantı ----------
$('#btnConn').addEventListener('click', async () => {
  if (!KLineSerial.supported) return toast('Bu tarayıcı Web Serial desteklemiyor — Chrome/Edge (bilgisayar) kullanın.', true);
  try {
    const sig = $('#selSig').value;
    io = new KLineSerial({ baud: +$('#selBaud').value, echo: $('#selEcho').value, dtr: sig[0] === '1', rts: sig[1] === '1', log });
    await io.pick();
    await io.open();
    $('#stConn').textContent = 'Kablo bağlı'; $('#stConn').classList.add('on');
    $('#btnConn').classList.add('hidden'); $('#btnDisc').classList.remove('hidden');
    $('#connMsg').textContent = '';
  } catch (e) {
    $('#connMsg').textContent = 'Bağlanamadı: ' + e.message;
    log('Bağlantı hatası: ' + e.message);
  }
});
$('#btnDisc').addEventListener('click', async () => {
  stop = true;
  await io?.close(); io = null;
  $('#stConn').textContent = 'Bağlı değil'; $('#stConn').classList.remove('on');
  $('#btnConn').classList.remove('hidden'); $('#btnDisc').classList.add('hidden');
  log('Kablo bağlantısı kapatıldı');
});

// ---------- oturum yardımcısı: init + kimlik + işlem + kapat ----------
async function withModule(addr, fn) {
  const kw = new KW1281(io, (m) => log('  ' + m));
  let info;
  try {
    info = await kw.init(addr);
  } catch (e) {
    // baud uyumsuzsa diğer hızla bir kez daha dene
    if (e instanceof KWError && /baud/.test(e.message)) {
      const other = io.baud === 10400 ? 9600 : 10400;
      log(`  ${io.baud} baud uyumsuz, ${other} deneniyor`);
      await io.reopen(other);
      info = await kw.init(addr);
    } else throw e;
  }
  if (!info.kw1281) {
    await sleep(100);
    return { info, unsupported: true };
  }
  const ident = await kw.readIdent();
  const out = await fn(kw, info, ident);
  await kw.end();
  return { info, ident, ...out };
}

// ---------- yedek ----------
async function saveSnap(addr, name, data) {
  const snap = { id: Date.now() + Math.floor(Math.random() * 1000), time: new Date().toISOString(), addr, name, ...data };
  try { await snapSave(snap); } catch (e) { log('Yedek yazılamadı: ' + e.message); }
  refreshSnaps();
}
async function refreshSnaps() {
  let list = [];
  try { list = await snapList(); } catch {}
  $('#snapPill').textContent = list.length + ' yedek';
  $('#snapBody').innerHTML = list.slice(0, 30).map((s) => `<tr><td>${new Date(s.time).toLocaleString('tr-TR')}</td><td>${s.addr} ${esc(s.name || '')}</td><td>${esc(s.summary || '')}</td><td><button class="btn alt" data-id="${s.id}">Sil</button></td></tr>`).join('') || '<tr><td class="na">Yedek yok.</td></tr>';
  S.snaps = list;
}
const S = { snaps: [] };
$('#snapBody').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (confirm('Bu yedek silinsin mi?')) { await snapDelete(+b.dataset.id); refreshSnaps(); }
});
$('#btnSnapDl').addEventListener('click', () => {
  if (!S.snaps.length) return toast('Yedek yok', true);
  download('teshis-yedekleri-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json', JSON.stringify(S.snaps, null, 2), 'application/json');
});
$('#btnSnapClr').addEventListener('click', async () => {
  if (!confirm('TÜM teşhis yedekleri silinsin mi? Bu geri alınamaz.')) return;
  for (const s of S.snaps) await snapDelete(s.id);
  refreshSnaps();
});
$('#btnLogDl').addEventListener('click', () => download('teshis-gunlugu-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt', logLines.join('\n'), 'text/plain'));

// ---------- tarama ----------
const modName = (a) => MODULES.find((m) => m[0] === a)?.[1] || 'Modül';
function faultText(f) {
  const p = vagToP(f.code);
  return `${String(f.code).padStart(5, '0')}${p ? ' (' + p + ')' : ''}  durum 0x${hex(f.status)}`;
}

async function scanOne(addr) {
  const card = document.createElement('div');
  card.className = 'card mod'; card.id = 'mod' + addr;
  card.innerHTML = `<h3>${addr} · ${esc(modName(addr))} <span class="st na">taranıyor…</span></h3><pre></pre><div class="row act hidden"></div>`;
  $('#mods').prepend(card);
  const st = card.querySelector('.st'), pre = card.querySelector('pre'), act = card.querySelector('.act');
  try {
    log(`== Modül ${addr} (${modName(addr)}) ==`);
    const r = await withModule(parseInt(addr, 16), async (kw) => ({ faults: await kw.readFaults() }));
    if (r.unsupported) {
      st.textContent = 'KWP2000 (henüz desteklenmiyor)'; st.className = 'st badx';
      pre.textContent = `Anahtar kelime ${r.info.keyword}: modül KW1281 değil. Günlük kaydedildi.`;
      await saveSnap(addr, modName(addr), { keyword: r.info.keyword, summary: 'KWP2000: ' + r.info.keyword, ident: [], faults: [] });
      return;
    }
    st.textContent = 'yanıt verdi'; st.className = 'st ok';
    pre.textContent = r.ident.join('\n') + '\n\nArıza kodları: ' + (r.faults.length ? '\n' + r.faults.map(faultText).join('\n') : 'yok');
    act.classList.remove('hidden');
    act.innerHTML = `<label class="f">Ölçüm bloğu<input type="number" min="1" max="255" value="1" style="width:80px"></label><button class="btn alt" data-a="group">Oku</button><button class="btn alt" data-a="range">1–10 arası hepsini oku</button><div class="gout" style="width:100%"></div>`;
    act.dataset.addr = addr;
    await saveSnap(addr, modName(addr), { keyword: r.info.keyword, ident: r.ident, faults: r.faults, summary: `${r.ident[0] || ''} · ${r.faults.length} arıza` });
    log(`  yanıt verdi: ${r.ident.join(' | ')} · ${r.faults.length} arıza kodu`);
  } catch (e) {
    st.textContent = e instanceof KWError ? 'yanıt yok' : 'hata'; st.className = 'st badx';
    pre.textContent = e.message;
    log('  ' + e.message);
  }
}

$('#btnScan').addEventListener('click', async () => {
  if (!io) return toast('Önce kabloyu bağlayın', true);
  if (busy) return;
  const sel = [...document.querySelectorAll('#modList input:checked')].map((i) => i.value);
  const man = $('#manAddr').value.trim().toUpperCase();
  if (/^[0-9A-F]{1,2}$/.test(man) && !sel.includes(man.padStart(2, '0'))) sel.push(man.padStart(2, '0'));
  if (!sel.length) return toast('Modül seçin', true);
  busy = true; stop = false;
  $('#btnScan').classList.add('hidden'); $('#btnStop').classList.remove('hidden');
  for (const [i, a] of sel.entries()) {
    if (stop) break;
    $('#scanPill').textContent = `Taranıyor ${i + 1}/${sel.length}: ${a}`;
    await scanOne(a);
    await sleep(600);
  }
  $('#scanPill').textContent = stop ? 'Durduruldu' : 'Tarama bitti';
  busy = false;
  $('#btnScan').classList.remove('hidden'); $('#btnStop').classList.add('hidden');
});
$('#btnStop').addEventListener('click', () => { stop = true; });

// ölçüm bloğu okuma (modül kartındaki düğmeler)
$('#mods').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-a]'); if (!b || busy) return;
  const act = b.closest('.act'), addr = act.dataset.addr, out = act.querySelector('.gout');
  const one = +act.querySelector('input').value;
  const groups = b.dataset.a === 'range' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [one];
  busy = true; out.innerHTML = '<span class="na">okunuyor…</span>';
  try {
    log(`== Modül ${addr}: ölçüm blokları ${groups[0]}–${groups[groups.length - 1]} ==`);
    const r = await withModule(parseInt(addr, 16), async (kw) => {
      const res = {};
      for (const g of groups) { res[g] = await kw.readGroup(g); await sleep(100); }
      return { groups: res };
    });
    const html = [], store = {};
    for (const g of groups) {
      const v = r.groups[g];
      if (v.refused) { html.push(`<div><b>Blok ${g}:</b> <span class="na">modül reddetti</span></div>`); continue; }
      store[g] = v.values;
      html.push(`<div><b>Blok ${g}:</b> ${v.values.map((x) => esc(decodeValue(x).text)).join(' · ')}</div>`);
    }
    out.innerHTML = html.join('');
    await saveSnap(addr, modName(addr), { keyword: r.info.keyword, ident: r.ident, groups: store, summary: `ölçüm blokları ${groups.join(',')}` });
  } catch (err) {
    out.innerHTML = `<span class="badx">${esc(err.message)}</span>`;
    log('  ' + err.message);
  }
  busy = false;
});

log('Hazır. Kabloyu bağlayıp modül taraması başlatın.');
refreshSnaps();
