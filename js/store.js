// Yerel depolama: yolculuk özetleri (localStorage), kayıtlar (IndexedDB), performans sonuçları
const TK = 'obdTrips', PK = 'obdPerf';

const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const loadTrips = () => rd(TK, []);
export function saveTrip(t) {
  const a = loadTrips();
  const i = a.findIndex((x) => x.id === t.id);
  if (i >= 0) a[i] = t; else a.push(t);
  wr(TK, a.slice(-400));
}
export const clearTrips = () => wr(TK, []);
export function deleteTrip(id) { wr(TK, loadTrips().filter((x) => x.id !== id)); }

// ---- Yolculuk zaman serisi (IndexedDB): her iv sn'de bir satır, SER_COLS sütun, düz dizi ----
export const SER_COLS = ['rpm', 'spd', 'cool', 'load', 'thr', 'map', 'iat', 'volt', 'lph'];
export async function tserSave(id, ser) {
  const d = await db();
  await tx(d, ['tser'], 'readwrite', (t) => { t.objectStore('tser').put({ id, iv: ser.iv, d: ser.d }); });
}
export async function tserGet(id) {
  const d = await db();
  return (await req(d.transaction('tser').objectStore('tser').get(id))) || null;
}
export async function tserDelete(id) {
  const d = await db();
  await tx(d, ['tser'], 'readwrite', (t) => { t.objectStore('tser').delete(id); });
}
export async function tserClear() {
  const d = await db();
  await tx(d, ['tser'], 'readwrite', (t) => { t.objectStore('tser').clear(); });
}

export const loadPerf = () => rd(PK, {});
export const savePerf = (p) => wr(PK, p);

// ---- IndexedDB: kayıtlar ----
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('obd', 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of ['meta', 'rows', 'snap', 'tser']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (d, stores, mode, fn) => new Promise((res, rej) => {
  const t = d.transaction(stores, mode);
  let out;
  t.oncomplete = () => res(out);
  t.onerror = () => rej(t.error);
  out = fn(t);
});
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function recSave(meta, rows) {
  const d = await db();
  await tx(d, ['meta', 'rows'], 'readwrite', (t) => { t.objectStore('meta').put(meta); t.objectStore('rows').put({ id: meta.id, rows }); });
}
export async function recList() {
  const d = await db();
  return (await req(d.transaction('meta').objectStore('meta').getAll())).sort((a, b) => b.start - a.start);
}
export async function recRows(id) {
  const d = await db();
  return (await req(d.transaction('rows').objectStore('rows').get(id)))?.rows || [];
}
export async function recDelete(id) {
  const d = await db();
  await tx(d, ['meta', 'rows'], 'readwrite', (t) => { t.objectStore('meta').delete(id); t.objectStore('rows').delete(id); });
}

// ---- Teşhis yedekleri (salt okunur okumaların ham kayıtları) ----
export async function snapSave(snap) {
  const d = await db();
  await tx(d, ['snap'], 'readwrite', (t) => { t.objectStore('snap').put(snap); });
}
export async function snapList() {
  const d = await db();
  return (await req(d.transaction('snap').objectStore('snap').getAll())).sort((a, b) => b.id - a.id);
}
export async function snapDelete(id) {
  const d = await db();
  await tx(d, ['snap'], 'readwrite', (t) => { t.objectStore('snap').delete(id); });
}
