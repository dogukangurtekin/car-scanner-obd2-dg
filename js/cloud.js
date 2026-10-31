// Google ile giriş + yolculuk istatistiklerini kullanıcı hesabına (Firestore) yedekleme
import { FIREBASE_CONFIG } from './cloud-config.js?v=23';
import { loadTrips, saveTrip, tserGet, tserSave } from './store.js?v=23';

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

export async function pushPending() {
  if (!user || busy) return 0;
  busy = true;
  try {
    const done = synced();
    let n = 0;
    for (const t of loadTrips()) {
      if (done.has(t.id)) continue;
      const s = t.hasSer ? await tserGet(t.id) : null;
      await F.setDoc(F.doc(fs, 'users', user.uid, 'trips', String(t.id)), { ...t, ...(s ? { ser: s.d, iv: s.iv } : {}), savedAt: Date.now() });
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
    const ser = t.ser, iv = t.iv; delete t.ser; delete t.iv;
    done.add(t.id);
    if (!have.has(t.id)) { saveTrip(t); n++; if (ser) jobs.push(tserSave(t.id, { iv: iv || 5, d: ser })); }
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
      if (user) { await A.signOut(auth); return; }
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
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
  a.onAuthStateChanged(auth, async (u) => {
    user = u; ui();
    if (!u) return;
    toastFn('Giriş yapıldı: ' + (u.displayName || u.email));
    try {
      await pushPending();
      const n = await pullAll();
      if (n) { toastFn(`${n} yolculuk hesabınızdan yüklendi`); location.reload(); }
    } catch (e) { toastFn('Eşitleme hatası: ' + (e.code || e.message), true); }
  });
}
