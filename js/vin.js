// VIN'den çevrimdışı marka / model yılı / (VW grubu için) model çözümü
const WMI = {
  WVW: 'Volkswagen', WV1: 'Volkswagen Ticari', WV2: 'Volkswagen Ticari', WVG: 'Volkswagen', VWV: 'Volkswagen', '3VW': 'Volkswagen', '1VW': 'Volkswagen',
  WAU: 'Audi', WUA: 'Audi', TRU: 'Audi', TMB: 'Škoda', VSS: 'SEAT', WP0: 'Porsche', WBA: 'BMW', WBS: 'BMW M', WBY: 'BMW',
  WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDD: 'Mercedes-Benz', W1K: 'Mercedes-Benz', W1N: 'Mercedes-Benz', WF0: 'Ford', WOL: 'Opel', W0L: 'Opel',
  VF1: 'Renault', VF3: 'Peugeot', VF7: 'Citroën', VR1: 'DS', UU1: 'Dacia', ZFA: 'Fiat', ZAR: 'Alfa Romeo', ZFF: 'Ferrari', ZLA: 'Lancia',
  NM0: 'Ford (Otosan)', NMT: 'Toyota (Türkiye)', NMH: 'Honda (Türkiye)', NLH: 'Hyundai (Türkiye)', NM4: 'Tofaş/Fiat', NMB: 'Mercedes-Benz (Türkiye)', NLA: 'Honda (Türkiye)', NLE: 'Mercedes-Benz Türk',
  YV1: 'Volvo', SAL: 'Land Rover', SAJ: 'Jaguar', SCC: 'Lotus', KMH: 'Hyundai', KNA: 'Kia', KND: 'Kia', JTD: 'Toyota', JT2: 'Toyota', SB1: 'Toyota (UK)',
  JHM: 'Honda', JN1: 'Nissan', SJN: 'Nissan (UK)', JMZ: 'Mazda', JS3: 'Suzuki', TSM: 'Suzuki (Macaristan)', '1G1': 'Chevrolet', '1FA': 'Ford', '5YJ': 'Tesla', '7SA': 'Tesla',
};
const WMI_FIRST = { W: 'Almanya', V: 'Fransa/İspanya', Z: 'İtalya', S: 'İngiltere', T: 'Çekya/Macaristan', J: 'Japonya', K: 'Güney Kore', N: 'Türkiye', Y: 'İsveç/Finlandiya', '1': 'ABD', '2': 'Kanada', '3': 'Meksika', '5': 'ABD' };

// VW grubu: 7-8. haneler
const VW_MODEL = {
  '1K': 'Golf V / Jetta', '5M': 'Golf Plus', '1F': 'Eos', '13': 'Scirocco', '1J': 'Golf IV / Bora', '1H': 'Golf III / Vento', '5K': 'Golf VI',
  AU: 'Golf VII', CD: 'Golf VIII', '3C': 'Passat B6/B7 / CC', '3G': 'Passat B8', '3B': 'Passat B5', '7N': 'Sharan', '5N': 'Tiguan', AD: 'Tiguan II',
  '6R': 'Polo V', '6C': 'Polo V', '9N': 'Polo IV', AW: 'Polo VI', '2K': 'Caddy', '2H': 'Amarok', '7H': 'Transporter T5', '7E': 'Transporter T5', '7J': 'Transporter T5',
  '1T': 'Touran', '7L': 'Touareg', '7P': 'Touareg II', '3H': 'Arteon', '1Z': 'Octavia II', '5E': 'Octavia III', '1U': 'Octavia I', NH: 'Fabia III',
  '5J': 'Fabia II', '5L': 'Yeti', '3T': 'Superb II', '3V': 'Superb III', '1P': 'Leon II', '5F': 'Leon III', '8P': 'A3', '8V': 'A3', '8E': 'A4 B6/B7',
  '8K': 'A4 B8', '4F': 'A6 C6', '4G': 'A6 C7', '8J': 'TT',
};
const VW_GROUP = ['WVW', 'WV1', 'WV2', 'WVG', 'VWV', 'WAU', 'WUA', 'TRU', 'TMB', 'VSS', '3VW', '1VW'];

const YEARS = 'ABCDEFGHJKLMNPRSTVWXY';
export function vinYear(c) {
  if (/[1-9]/.test(c)) return 2000 + Number(c);
  const i = YEARS.indexOf(c);
  return i >= 0 ? 2010 + i : null;
}

export function decodeVin(vin) {
  if (!vin || vin.length < 11) return null;
  const v = vin.toUpperCase();
  const wmi = v.slice(0, 3);
  const make = WMI[wmi] || WMI_FIRST[v[0]] && `Bilinmeyen marka (${WMI_FIRST[v[0]]}, ${wmi})` || 'Bilinmeyen marka';
  const year = vinYear(v[9]);
  const code = v.slice(6, 8);
  const model = VW_GROUP.includes(wmi) ? VW_MODEL[code] || null : null;
  return { vin: v, make, model, year, code, known: !!WMI[wmi] };
}

export function carLabel(d, online) {
  if (!d) return 'OBD2';
  const m = online?.model || d.model;
  const make = online?.make || d.make;
  return [make, m].filter(Boolean).join(' ') + (d.year ? ` (${online?.year || d.year})` : '');
}

// İsteğe bağlı: NHTSA vPIC (VIN dışarı gider, kullanıcı onayıyla)
export async function lookupNhtsa(vin) {
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
  if (!r.ok) throw new Error('NHTSA yanıt vermedi: ' + r.status);
  const x = (await r.json()).Results?.[0] || {};
  return { make: x.Make || null, model: x.Model || null, year: x.ModelYear || null };
}
