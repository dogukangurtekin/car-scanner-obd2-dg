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

export const loadPerf = () => rd(PK, {});
export const savePerf = (p) => wr(PK, p);

// ---- IndexedDB: kayıtlar ----
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('obd', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta', { keyPath: 'id' });
      r.result.createObjectStore('rows', { keyPath: 'id' });
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
