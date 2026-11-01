// Google ile giriş + yolculuk istatistiklerini kullanıcı hesabına (Firestore) yedekleme
import { FIREBASE_CONFIG } from './cloud-config.js?v=32';
import { loadTrips, saveTrip, tserGet, tserSave, recList, recRows, recSave } from './store.js?v=32';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = (s) => document.querySelector(s);
const configured = !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

let auth, fs, A, F, user = null, busy = false;
const syncKey = () => 'obdSynced:' + user.uid;
const synced = () => { try { return new Set(JSON.parse(localStorage.getItem(syncKey()) || '[]')); } catch { return new Set(); } };
const markSynced = (s) => { try { localStorage.setItem(syncKey(), JSON.stringify([...s].slice(-1000))); } catch {} };

let toastFn = () => {};
function ui() {
  const b = $('#btnLogin'); if (!b) return;
  if (user) {
    b.innerHTML = '';
    if (user.photoURL) { const i = document.createElement('img'); i.src = user.photoURL; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.className = 'avatar'; b.append(i); }
    b.append((user.displayName || user.email || 'Hesap').split(' ')[0] + ' · Çıkış');
    b.title = user.email + ' — çıkış yapmak için tıklayın';
  } else {
    b.textContent = 'G  Google ile giriş';
    b.title = configured ? 'Google ile giriş yap: yolculuklarınız hesabınıza kaydedilir' : 'Google girişi henüz yapılandırılmadı';
  }
}

const scope = () => { try { return localStorage.getItem('obdScope') || ''; } catch { return ''; } };
const setScope = (v) => { try { if (v) localStorage.setItem('obdScope', v); else localStorage.removeItem('obdScope'); } catch {} };

export async function pushPending() {
  if (!user || busy) return 0;
  busy = true;
  try {
    const done = synced();
    let n = 0;
    for (const t of loadTrips()) {
      if (done.has(t.id)) continue;
      const s = t.hasSer ? await tserGet(t.id) : null;
      await F.setDoc(F.doc(fs, 'users', user.uid, 'trips', String(t.id)), { ...t, ...(s ? { ser: s.d, iv: s.iv, cols: s.cols } : {}), savedAt: Date.now() });
      done.add(t.id); n++;
    }
    markSynced(done);
    if (n) toastFn(`${n} yolculuk Google hesabınıza kaydedildi`);
    return n;
  } catch (e) {
    toastFn('Hesaba kaydedilemedi: ' + (e.code || e.message), true);
    return 0;
  } finally { busy = false; }
}

const RCH = 40000; // belge başına en çok bu kadar sayı (Firestore 1 MB sınırı; iç içe dizi yasak olduğu için düz dizi)
const syncedRec = () => { try { return new Set(JSON.parse(localStorage.getItem('obdSyncedRec:' + user.uid) || '[]')); } catch { return new Set(); } };
const markRec = (s) => { try { localStorage.setItem('obdSyncedRec:' + user.uid, JSON.stringify([...s].slice(-1000))); } catch {} };

export async function pushRecs() {
  if (!user || !F) return 0;
  try {
    const done = syncedRec();
    let n = 0;
    for (const m of await recList()) {
      if (done.has(m.id)) continue;
      const rows = await recRows(m.id), w = m.keys.length + 1, flat = rows.flat();
      const base = F.doc(fs, 'users', user.uid, 'recs', String(m.id));
      const per = Math.max(w, Math.floor(RCH / w) * w), parts = Math.max(1, Math.ceil(flat.length / per));
      for (let i = 0; i < parts; i++) await F.setDoc(F.doc(base, 'rows', String(i)), { d: flat.slice(i * per, (i + 1) * per) });
      await F.setDoc(base, { ...m, w, parts, savedAt: Date.now() });
      done.add(m.id); n++;
    }
    markRec(done);
    if (n) toastFn(`${n} kayıt Google hesabınıza kaydedildi`);
    return n;
  } catch (e) { toastFn('Kayıt hesaba kaydedilemedi: ' + (e.code || e.message), true); return 0; }
}

export async function removeRemoteRec(id) {
  if (!user || !F) return;
  try {
    const base = F.doc(fs, 'users', user.uid, 'recs', String(id));
    const sub = await F.getDocs(F.collection(base, 'rows'));
    for (const d of sub.docs) await F.deleteDoc(d.ref);
    await F.deleteDoc(base);
  } catch (e) { toastFn('Kayıt hesaptan silinemedi: ' + (e.code || e.message), true); }
}

async function pullRecs() {
  const have = new Set((await recList()).map((m) => m.id));
  const done = syncedRec();
  let n = 0;
  for (const d of (await F.getDocs(F.collection(fs, 'users', user.uid, 'recs'))).docs) {
    const m = d.data(); delete m.savedAt;
    done.add(m.id);
    if (have.has(m.id)) continue;
    const flat = [];
    for (let i = 0; i < m.parts; i++) { const r = await F.getDoc(F.doc(d.ref, 'rows', String(i))); if (r.exists()) flat.push(...r.data().d); }
    const w = m.w, rows = [];
    for (let i = 0; i + w <= flat.length; i += w) rows.push(flat.slice(i, i + w));
    delete m.w; delete m.parts;
    await recSave(m, rows); n++;
  }
  markRec(done);
  return n;
}

// Ayarlar + araç profilleri: hesapta varsa hesaptaki gelir, yoksa bu cihazdakiler hesaba yazılır
const setsRef = () => F.doc(fs, 'users', user.uid, 'meta', 'settings');
const SKEY = () => 'obdSettings:' + user.uid;
let setsTimer;
window.addEventListener('obd-settings-saved', (e) => {
  if (!user || !F || !scope()) return;
  clearTimeout(setsTimer);
  setsTimer = setTimeout(() => { F.setDoc(setsRef(), { json: JSON.stringify(e.detail), savedAt: Date.now() }).catch(() => {}); }, 1500);
});
async function syncSettings() {
  const snap = await F.getDoc(setsRef());
  const local = localStorage.getItem(SKEY());
  if (snap.exists()) {
    const remote = snap.data().json;
    if (remote && remote !== local) { localStorage.setItem(SKEY(), remote); return true; }
    return false;
  }
  if (local) await F.setDoc(setsRef(), { json: local, savedAt: Date.now() });
  return false;
}

export async function removeRemote(id) {
  if (!user || !F) return;
  try { await F.deleteDoc(F.doc(fs, 'users', user.uid, 'trips', String(id))); } catch (e) { toastFn('Hesaptan silinemedi: ' + (e.code || e.message), true); }
}

async function pullAll() {
  const snap = await F.getDocs(F.collection(fs, 'users', user.uid, 'trips'));
  const have = new Set(loadTrips().map((t) => t.id));
  const done = synced();
  let n = 0;
  const jobs = [];
  snap.forEach((d) => {
    const t = d.data(); delete t.savedAt;
    const ser = t.ser, iv = t.iv, cols = t.cols; delete t.ser; delete t.iv; delete t.cols;
    done.add(t.id);
    if (!have.has(t.id)) { saveTrip(t); n++; if (ser) jobs.push(tserSave(t.id, { iv: iv || 5, d: ser, cols })); }
  });
  await Promise.all(jobs);
  markSynced(done);
  return n;
}

export async function initCloud({ toast, onChange }) {
  toastFn = toast;
  const b = $('#btnLogin'); if (!b) return;
  ui();
  b.addEventListener('click', async () => {
    if (!configured) return toast('Google girişi için js/cloud-config.js içine Firebase ayarları girilmeli (README).', true);
    try {
      if (!A) await load();
      if (user) {
        // Çıkışta yerel veriler silinmez (kullanıcı silmedikçe kalır); yalnızca önce buluta gönderilir. Farklı hesapla girişte temizlenir.
        try {
          await pushPending(); await pushRecs();
          await A.signOut(auth);
        } finally { location.reload(); }
        return;
      }
      // iOS/Safari (Bluefy dahil) açılır pencereyi sekme olarak açıp oturum bilgisini kaybeder: aynı sekmede yönlendirme kullan
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const prov = new A.GoogleAuthProvider();
      if (ios) await A.signInWithRedirect(auth, prov); else await A.signInWithPopup(auth, prov);
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast('Giriş yapılamadı: ' + (e.code || e.message), true);
    }
  });
  if (configured) { try { await load(); } catch (e) { /* çevrimdışı olabilir; giriş düğmesi yine de çalışır */ } }
}

async function load() {
  if (A) return;
  const [app, a, f] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  A = a; F = f;
  auth = a.getAuth(app.initializeApp(FIREBASE_CONFIG));
  fs = f.getFirestore(auth.app);
  a.getRedirectResult(auth).catch((e) => toastFn('Giriş yapılamadı: ' + (e.code || e.message), true));
  a.onAuthStateChanged(auth, async (u) => {
    user = u; ui();
    if (!u) { if (scope()) { setScope(''); location.reload(); } return; }
    toastFn('Giriş yapıldı: ' + (u.displayName || u.email));
    try {
      // Hesaba ait veriler ayrı kapsamda tutulur; kapsam bu hesap değilse geçip yenile
      if (scope() !== u.uid) { setScope(u.uid); location.reload(); return; }
      await pushPending(); await pushRecs();
      const n = await pullAll(), r = await pullRecs(), s = await syncSettings();
      if (n || r || s) { toastFn(`${n} yolculuk, ${r} kayıt hesabınızdan yüklendi`); location.reload(); }
    } catch (e) { toastFn('Eşitleme hatası: ' + (e.code || e.message), true); }
  });
}
