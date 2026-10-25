// Emisyon hazırlık (readiness) çözümü ve Mode 06 ad tabloları

// PID 01 / PID 41 baytları: [A, B, C, D]
export function decodeReadiness(b, drive) {
  const [A, B, C, D] = b;
  const diesel = !!(B & 0x08);
  const items = [];
  const add = (name, avail, incomplete) => items.push({ name, avail: !!avail, complete: !!avail && !incomplete });
  add('Misfire (ateşleme kaçırma)', B & 1, B & 0x10);
  add('Yakıt Sistemi', B & 2, B & 0x20);
  add('Bileşenler', B & 4, B & 0x40);
  const spark = [
    ['Katalizatör', 0], ['Isıtmalı Katalizör', 1], ['Buharlaşma (EVAP) Sistemi', 2], ['İkincil Hava Sistemi', 3],
    ['A/C Klima', 4], ['Oksijen Sensörü', 5], ['Oksijen Sensörü Isıtıcısı', 6], ['EGR Sistemi', 7],
  ];
  const comp = [
    ['NMHC Katalizör', 0], ['NOx/SCR Sistemi', 1], ['Turbo Basınç', 3], ['Egzoz Gazı Sensörü', 5], ['Partikül Filtresi (DPF)', 6], ['EGR / VVT', 7],
  ];
  for (const [name, bit] of diesel ? comp : spark) add(name, C & (1 << bit), D & (1 << bit));
  const mil = drive ? null : !!(A & 0x80);
  const count = drive ? null : A & 0x7f;
  const supported = items.filter((i) => i.avail);
  const ready = supported.every((i) => i.complete);
  return { diesel, items, mil, count, ready, pending: supported.filter((i) => !i.complete).length };
}

export const MID_NAMES = {
  '01': 'O2 Sensörü Monitörü B1S1', '02': 'O2 Sensörü Monitörü B1S2', '03': 'O2 Sensörü Monitörü B1S3', '04': 'O2 Sensörü Monitörü B1S4',
  '05': 'O2 Sensörü Monitörü B2S1', '06': 'O2 Sensörü Monitörü B2S2', '07': 'O2 Sensörü Monitörü B2S3', '08': 'O2 Sensörü Monitörü B2S4',
  '21': 'Katalizör Monitörü B1', '22': 'Katalizör Monitörü B2', '23': 'Katalizör Monitörü B3', '24': 'Katalizör Monitörü B4',
  '31': 'EGR Monitörü B1', '32': 'EGR Monitörü B2', '33': 'EGR Monitörü B3', '34': 'EGR Monitörü B4',
  '35': 'VVT Monitörü B1', '36': 'VVT Monitörü B2', '37': 'VVT Monitörü B3', '38': 'VVT Monitörü B4',
  '39': 'EVAP Monitörü (0.020")', '3A': 'EVAP Monitörü (0.040")', '3B': 'EVAP Monitörü (0.090")', '3C': 'EVAP Monitörü (0.150")',
  '41': 'O2 Sensör Isıtıcı Monitörü B1S1', '42': 'O2 Sensör Isıtıcı Monitörü B1S2', '43': 'O2 Sensör Isıtıcı Monitörü B1S3', '44': 'O2 Sensör Isıtıcı Monitörü B1S4',
  '45': 'O2 Sensör Isıtıcı Monitörü B2S1', '46': 'O2 Sensör Isıtıcı Monitörü B2S2', '47': 'O2 Sensör Isıtıcı Monitörü B2S3', '48': 'O2 Sensör Isıtıcı Monitörü B2S4',
  '61': 'Isıtmalı Katalizör Monitörü B1', '62': 'Isıtmalı Katalizör Monitörü B2', '71': 'İkincil Hava Monitörü 1', '72': 'İkincil Hava Monitörü 2',
  '81': 'Yakıt Sistemi Monitörü B1', '82': 'Yakıt Sistemi Monitörü B2', '83': 'Yakıt Sistemi Monitörü B3', '84': 'Yakıt Sistemi Monitörü B4',
  'A1': 'Misfire Verileri (genel)', 'A2': 'Misfire Silindir 1', 'A3': 'Misfire Silindir 2', 'A4': 'Misfire Silindir 3', 'A5': 'Misfire Silindir 4',
  'A6': 'Misfire Silindir 5', 'A7': 'Misfire Silindir 6', 'A8': 'Misfire Silindir 7', 'A9': 'Misfire Silindir 8',
};

// Mode 06 baytları → [{mid, tid, uas, value, min, max, pass}]
export function decodeMode06(bytes) {
  const out = [];
  const h = (x) => x.toString(16).toUpperCase().padStart(2, '0');
  for (let i = 0; i + 9 <= bytes.length; i += 9) {
    const [mid, tid, uas] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const value = bytes[i + 3] * 256 + bytes[i + 4];
    const min = bytes[i + 5] * 256 + bytes[i + 6];
    const max = bytes[i + 7] * 256 + bytes[i + 8];
    out.push({ mid: h(mid), tid: h(tid), uas: h(uas), value, min, max, pass: value >= min && (max === 0 || value <= max) });
  }
  return out;
}
