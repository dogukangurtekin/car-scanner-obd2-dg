// Mode 01 PID tanımları. f(a,b,c,d) ham baytlardan değeri üretir.
// fast: her turda sorgulanır, değilse sırayla tek tek araya girer.
// key: panodaki benzersiz ad (varsayılan id). Aynı PID'den birden fazla değer türetilebilir.
// lbl: sayısal değeri metne çevirir. dec: ondalık basamak.
const FUEL_STATUS = { 1: 'Açık çevrim (motor soğuk)', 2: 'Kapalı çevrim (lambda)', 4: 'Açık çevrim (yük/yavaşlama)', 8: 'Açık çevrim (arıza)', 16: 'Kapalı çevrim (sensör arızası)', 0: '—' };
const OBD_STD = { 1: 'OBD-II (CARB)', 2: 'OBD (EPA)', 3: 'OBD ve OBD-II', 4: 'OBD-I', 5: 'OBD değil', 6: 'EOBD (Avrupa)', 7: 'EOBD ve OBD-II', 8: 'EOBD ve OBD', 9: 'EOBD, OBD ve OBD-II', 10: 'JOBD (Japonya)', 11: 'JOBD ve OBD-II', 12: 'JOBD ve EOBD', 13: 'JOBD, EOBD ve OBD-II' };
const SEC_AIR = { 0: 'Yok', 1: 'Yukarı akış', 2: 'Katalizör öncesi', 4: 'Dış hava / kapalı', 8: 'Tanı için pompa' };

export const PIDS = [
  { id: '03', name: 'Yakıt Sistemi Durumu', unit: '', min: 0, max: 16, f: (a) => a, lbl: (v) => FUEL_STATUS[v] ?? 'Bilinmiyor (' + v + ')', grp: 'Yakıt' },
  { id: '04', name: 'Motor Yükü', unit: '%', min: 0, max: 100, fast: true, f: (a) => a * 100 / 255, grp: 'Motor' },
  { id: '05', mid: true, name: 'Soğutma Suyu', unit: '°C', min: -40, max: 130, warn: 105, f: (a) => a - 40, grp: 'Sıcaklık' },
  { id: '06', mid: true, name: 'Kısa Dönem Yakıt Düz.', unit: '%', min: -25, max: 25, f: (a) => a / 1.28 - 100, grp: 'Yakıt' },
  { id: '07', mid: true, name: 'Uzun Dönem Yakıt Düz.', unit: '%', min: -25, max: 25, f: (a) => a / 1.28 - 100, grp: 'Yakıt' },
  { id: '0A', name: 'Yakıt Basıncı (gösterge)', unit: 'kPa', min: 0, max: 765, dec: 0, f: (a) => a * 3, grp: 'Yakıt' },
  { id: '0B', mid: true, name: 'Emme Manifold Basıncı', unit: 'kPa', min: 0, max: 255, dec: 0, f: (a) => a, grp: 'Hava' },
  { id: '0C', name: 'Motor Devri', unit: 'rpm', min: 0, max: 7000, warn: 6500, fast: true, f: (a, b) => (a * 256 + b) / 4, grp: 'Motor' },
  { id: '0D', name: 'Araç Hızı', unit: 'km/h', min: 0, max: 240, fast: true, f: (a) => a, grp: 'Motor' },
  { id: '0E', name: 'Ateşleme Avansı', unit: '°', min: -64, max: 64, f: (a) => a / 2 - 64, grp: 'Motor' },
  { id: '0F', mid: true, name: 'Emme Havası Sıc.', unit: '°C', min: -40, max: 100, f: (a) => a - 40, grp: 'Sıcaklık' },
  { id: '10', name: 'Hava Kütle Akışı (MAF)', unit: 'g/s', min: 0, max: 200, fast: true, f: (a, b) => (a * 256 + b) / 100, grp: 'Hava' },
  { id: '11', name: 'Gaz Kelebeği', unit: '%', min: 0, max: 100, fast: true, f: (a) => a * 100 / 255, grp: 'Hava' },
  { id: '12', name: 'İkincil Hava Durumu', unit: '', min: 0, max: 8, f: (a) => a, lbl: (v) => SEC_AIR[v] ?? String(v), grp: 'Emisyon' },
  { id: '14', name: 'Lambda B1S1 Voltajı', unit: 'V', min: 0, max: 1.3, dec: 3, f: (a) => a / 200, grp: 'Lambda' },
  { id: '15', name: 'Lambda B1S2 Voltajı', unit: 'V', min: 0, max: 1.3, dec: 3, f: (a) => a / 200, grp: 'Lambda' },
  { id: '1C', name: 'OBD Standardı', unit: '', min: 0, max: 20, f: (a) => a, lbl: (v) => OBD_STD[v] ?? 'Kod ' + v, grp: 'Araç' },
  { id: '1F', name: 'Motor Çalışma Süresi', unit: 's', min: 0, max: 3600, f: (a, b) => a * 256 + b, grp: 'Araç' },
  { id: '21', name: 'MIL Sonrası Mesafe', unit: 'km', min: 0, max: 1000, f: (a, b) => a * 256 + b, grp: 'Araç' },
  { id: '22', name: 'Yakıt Rayı Basıncı (vakuma göre)', unit: 'kPa', min: 0, max: 5000, dec: 0, f: (a, b) => (a * 256 + b) * 0.079, grp: 'Yakıt' },
  { id: '23', name: 'Yakıt Rayı Basıncı (direkt enj.)', unit: 'kPa', min: 0, max: 15000, dec: 0, f: (a, b) => (a * 256 + b) * 10, grp: 'Yakıt' },
  { id: '24', key: '24', mid: true, name: 'Lambda (Geniş Bant B1S1)', unit: 'λ', min: 0.6, max: 1.6, f: (a, b) => (a * 256 + b) * 2 / 65536, grp: 'Lambda' },
  { id: '24', key: '24v', name: 'Lambda Sensör Voltajı B1S1', unit: 'V', min: 0, max: 8, dec: 2, f: (a, b, c, d) => (c * 256 + d) * 8 / 65536, grp: 'Lambda' },
  { id: '2C', name: 'Komut EGR', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Emisyon' },
  { id: '2D', name: 'EGR Hatası', unit: '%', min: -100, max: 100, f: (a) => a * 100 / 128 - 100, grp: 'Emisyon' },
  { id: '2E', name: 'Komut EVAP Purge', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Emisyon' },
  { id: '2F', name: 'Yakıt Seviyesi', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Yakıt' },
  { id: '30', name: 'Silmeden Sonra Isınma Sayısı', unit: '', min: 0, max: 255, dec: 0, f: (a) => a, grp: 'Araç' },
  { id: '31', name: 'Silme Sonrası Mesafe', unit: 'km', min: 0, max: 5000, f: (a, b) => a * 256 + b, grp: 'Araç' },
  { id: '32', name: 'EVAP Sistem Buhar Basıncı', unit: 'Pa', min: -8000, max: 8000, dec: 0, f: (a, b) => (((a * 256 + b) << 16) >> 16) / 4, grp: 'Emisyon' },
  { id: '33', name: 'Barometrik Basınç', unit: 'kPa', min: 60, max: 110, dec: 0, f: (a) => a, grp: 'Hava' },
  { id: '34', key: '34', name: 'Lambda B1S1 (akım tipi)', unit: 'λ', min: 0.6, max: 1.6, f: (a, b) => (a * 256 + b) * 2 / 65536, grp: 'Lambda' },
  { id: '34', key: '34i', name: 'Lambda B1S1 Akımı', unit: 'mA', min: -128, max: 128, dec: 2, f: (a, b, c, d) => (c * 256 + d) / 256 - 128, grp: 'Lambda' },
  { id: '3C', name: 'Katalizör Sıcaklığı B1S1', unit: '°C', min: -40, max: 900, dec: 0, f: (a, b) => (a * 256 + b) / 10 - 40, grp: 'Sıcaklık' },
  { id: '3E', name: 'Katalizör Sıcaklığı B1S2', unit: '°C', min: -40, max: 900, dec: 0, f: (a, b) => (a * 256 + b) / 10 - 40, grp: 'Sıcaklık' },
  { id: '42', name: 'Kontrol Modülü Voltajı', unit: 'V', min: 8, max: 16, f: (a, b) => (a * 256 + b) / 1000, grp: 'Araç' },
  { id: '43', name: 'Mutlak Motor Yükü', unit: '%', min: 0, max: 200, f: (a, b) => (a * 256 + b) * 100 / 255, grp: 'Motor' },
  { id: '44', name: 'Komut Lambda', unit: 'λ', min: 0.6, max: 1.6, f: (a, b) => (a * 256 + b) * 2 / 65536, grp: 'Lambda' },
  { id: '45', name: 'Bağıl Gaz Kelebeği', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Hava' },
  { id: '46', name: 'Dış Hava Sıcaklığı', unit: '°C', min: -40, max: 60, f: (a) => a - 40, grp: 'Sıcaklık' },
  { id: '47', name: 'Mutlak Gaz Kelebeği B', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Hava' },
  { id: '49', name: 'Gaz Pedalı D', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Motor' },
  { id: '4A', name: 'Gaz Pedalı E', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Motor' },
  { id: '4C', name: 'Komut Gaz Kelebeği', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255, grp: 'Hava' },
  { id: '4D', name: 'MIL Açıkken Geçen Süre', unit: 'dk', min: 0, max: 600, dec: 0, f: (a, b) => a * 256 + b, grp: 'Araç' },
  { id: '4E', name: 'Silmeden Beri Geçen Süre', unit: 'dk', min: 0, max: 600, dec: 0, f: (a, b) => a * 256 + b, grp: 'Araç' },
  { id: '5C', name: 'Yağ Sıcaklığı', unit: '°C', min: -40, max: 160, warn: 130, f: (a) => a - 40, grp: 'Sıcaklık' },
  { id: '5D', name: 'Enjeksiyon Zamanlaması', unit: '°', min: -210, max: 302, f: (a, b) => (a * 256 + b) / 128 - 210, grp: 'Yakıt' },
  { id: '5E', name: 'Yakıt Debisi', unit: 'L/h', min: 0, max: 40, f: (a, b) => (a * 256 + b) / 20, grp: 'Yakıt' },
];
PIDS.forEach((p) => { p.key = p.key || p.id; });

// Gösterge dışı, yalnızca durum için okunan PID: 0101 (MIL + DTC sayısı + monitör durumu)
export const STATUS_PID = '01';

export const PID_BY_KEY = Object.fromEntries(PIDS.map((p) => [p.key, p]));
// aynı PID'den türeyen ilk tanım (listeleme için)
export const PID_BY_ID = {};
for (const p of PIDS) PID_BY_ID[p.id] ||= p;

// Panoda kart olarak gösterilmeyen, ama aracın bildirebildiği standart PID'lerin adları (yalnızca bilgi amaçlı)
export const EXTRA_NAMES = {
  '13': 'Lambda sondalarının yeri', '1D': 'Lambda sondalarının yeri (4 banka)', '1E': 'PTO durumu',
  '41': 'Bu sürüş döngüsünde monitör durumu', '51': 'Yakıt tipi',
  '20': 'Desteklenen PID 21-40', '40': 'Desteklenen PID 41-60', '60': 'Desteklenen PID 61-80',
};

// Varsayılan grafik seçimi
export const DEFAULT_CHARTS = ['0C', '0D', '05', '11'];

export function fmt(p, v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (p.lbl) return p.lbl(v);
  const d = p.dec ?? ({ rpm: 0, 'km/h': 0, km: 0, s: 0, 'λ': 2, V: 2 }[p.unit] ?? 1);
  return v.toFixed(d);
}
