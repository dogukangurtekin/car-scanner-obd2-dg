// Ayarlar, birim çevirme, yakıt/güç hesapları
const KEY = 'obdSettings';

export const DEFAULTS = {
  speed: 'kmh', temp: 'c', press: 'kpa', cons: 'l100', price: 0, cur: '₺', wake: true,
  activeProfile: null, profiles: [],
};
export const DEFAULT_PROFILE = { id: 'default', name: 'Varsayılan araç', vin: '', disp: 1.6, fuel: 'petrol', tank: 55 };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export const activeProfile = (s) => s.profiles.find((p) => p.id === s.activeProfile) || { ...DEFAULT_PROFILE };

export const FUEL = {
  petrol: { label: 'Benzin', afr: 14.7, dens: 745, co2: 2.31, mj: 32.0, eff: 0.30 },
  diesel: { label: 'Dizel', afr: 14.5, dens: 832, co2: 2.68, mj: 35.8, eff: 0.35 },
  lpg: { label: 'LPG', afr: 15.5, dens: 540, co2: 1.51, mj: 25.5, eff: 0.28 },
};

// ---- birimler ----
export function conv(unit, v, st) {
  switch (unit) {
    case 'km/h': return st.speed === 'mph' ? [v * 0.621371, 'mph'] : [v, 'km/h'];
    case 'km': return st.speed === 'mph' ? [v * 0.621371, 'mi'] : [v, 'km'];
    case '°C': return st.temp === 'f' ? [v * 9 / 5 + 32, '°F'] : [v, '°C'];
    case 'kPa':
      if (st.press === 'psi') return [v * 0.145038, 'psi'];
      if (st.press === 'bar') return [v / 100, 'bar'];
      return [v, 'kPa'];
    default: return [v, unit];
  }
}
export function consConv(l100, st) {
  if (l100 == null || !isFinite(l100)) return [null, ''];
  if (st.cons === 'kml') return [l100 > 0 ? 100 / l100 : null, 'km/L'];
  if (st.cons === 'mpg') return [l100 > 0 ? 235.215 / l100 : null, 'MPG'];
  return [l100, 'L/100km'];
}

// PID değerini gösterim metnine çevirir: [metin, birim]
export function show(p, v, st) {
  if (v == null || Number.isNaN(v)) return ['—', p.unit];
  if (p.lbl) return [p.lbl(v), ''];
  const [x, u] = conv(p.unit, v, st);
  const base = p.dec ?? ({ rpm: 0, 'km/h': 0, km: 0, s: 0, 'λ': 2, V: 2 }[p.unit] ?? 1);
  const d = u === 'mph' || u === 'mi' ? 0 : u === 'bar' ? 2 : u === 'psi' ? Math.max(base, 1) : base;
  return [x.toFixed(d), u];
}

// ---- yakıt / güç ----
export function estimateMaf(v, disp) {
  const map = v['0B'], iat = v['0F'], rpm = v['0C'];
  if ([map, iat, rpm].some((x) => x == null)) return null;
  // g/s = (RPM*MAP/IAT_K/2/60) * VE * hacim(L) * 28.97 / 8.314 / 1000 ... (VE 0.85)
  return ((rpm * map) / (iat + 273.15) / 2 / 60) * 0.85 * disp * 28.97 / 8.314 / 1000;
}

// Anlık yakıt akışı (litre/saniye); hesaplanamazsa null
export function fuelFlowLps(v, prof) {
  const f = FUEL[prof.fuel] || FUEL.petrol;
  const rpm = v['0C'];
  if (rpm != null && rpm < 400) return 0;
  if (v['5E'] != null) return v['5E'] / 3600;
  if (prof.fuel === 'diesel') return null; // dizelde MAF'tan yakıt hesaplanamaz
  const maf = v['10'] ?? estimateMaf(v, prof.disp || 1.6);
  if (maf == null) return null;
  let lam = v['24'] ?? v['34'] ?? v['44'];
  lam = lam != null && lam > 0.6 && lam < 3 ? lam : 1;
  return maf / (f.afr * lam) / f.dens;
}

// Yakıt akışından tahmini motor gücü (hp)
export function estimateHp(lps, prof) {
  if (lps == null) return null;
  const f = FUEL[prof.fuel] || FUEL.petrol;
  const kw = lps * f.mj * 1000 * f.eff; // MJ/L * 1000 kJ/MJ * (L/s) = kW (yakıt gücü) * verim
  return kw * 1.341;
}
