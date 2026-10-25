// Mode 01 PID tanımları. f(a,b) ham baytlardan değeri üretir.
// fast: her turda sorgulanır, değilse her 6 turda bir.
export const PIDS = [
  { id: '04', name: 'Motor Yükü', unit: '%', min: 0, max: 100, fast: true, f: (a) => a * 100 / 255 },
  { id: '05', name: 'Soğutma Suyu', unit: '°C', min: -40, max: 130, warn: 105, f: (a) => a - 40 },
  { id: '06', name: 'Kısa Dönem Yakıt Düz.', unit: '%', min: -25, max: 25, f: (a) => a / 1.28 - 100 },
  { id: '07', name: 'Uzun Dönem Yakıt Düz.', unit: '%', min: -25, max: 25, f: (a) => a / 1.28 - 100 },
  { id: '0B', name: 'Emme Manifold Basıncı', unit: 'kPa', min: 0, max: 255, f: (a) => a },
  { id: '0C', name: 'Motor Devri', unit: 'rpm', min: 0, max: 7000, warn: 6500, fast: true, f: (a, b) => (a * 256 + b) / 4 },
  { id: '0D', name: 'Araç Hızı', unit: 'km/h', min: 0, max: 240, fast: true, f: (a) => a },
  { id: '0E', name: 'Ateşleme Avansı', unit: '°', min: -64, max: 64, f: (a) => a / 2 - 64 },
  { id: '0F', name: 'Emme Havası Sıc.', unit: '°C', min: -40, max: 100, f: (a) => a - 40 },
  { id: '10', name: 'Hava Kütle Akışı (MAF)', unit: 'g/s', min: 0, max: 200, fast: true, f: (a, b) => (a * 256 + b) / 100 },
  { id: '11', name: 'Gaz Kelebeği', unit: '%', min: 0, max: 100, fast: true, f: (a) => a * 100 / 255 },
  { id: '1F', name: 'Motor Çalışma Süresi', unit: 's', min: 0, max: 3600, f: (a, b) => a * 256 + b },
  { id: '21', name: 'MIL Sonrası Mesafe', unit: 'km', min: 0, max: 1000, f: (a, b) => a * 256 + b },
  { id: '24', name: 'Lambda (Geniş Bant B1S1)', unit: 'λ', min: 0.6, max: 1.6, f: (a, b) => (a * 256 + b) * 2 / 65536 },
  { id: '2F', name: 'Yakıt Seviyesi', unit: '%', min: 0, max: 100, f: (a) => a * 100 / 255 },
  { id: '31', name: 'Silme Sonrası Mesafe', unit: 'km', min: 0, max: 5000, f: (a, b) => a * 256 + b },
  { id: '33', name: 'Barometrik Basınç', unit: 'kPa', min: 60, max: 110, f: (a) => a },
  { id: '42', name: 'Kontrol Modülü Voltajı', unit: 'V', min: 8, max: 16, f: (a, b) => (a * 256 + b) / 1000 },
  { id: '43', name: 'Mutlak Motor Yükü', unit: '%', min: 0, max: 200, f: (a, b) => (a * 256 + b) * 100 / 255 },
  { id: '44', name: 'Komut Lambda', unit: 'λ', min: 0.6, max: 1.6, f: (a, b) => (a * 256 + b) * 2 / 65536 },
  { id: '46', name: 'Dış Hava Sıcaklığı', unit: '°C', min: -40, max: 60, f: (a) => a - 40 },
  { id: '5C', name: 'Yağ Sıcaklığı', unit: '°C', min: -40, max: 160, warn: 130, f: (a) => a - 40 },
  { id: '5E', name: 'Yakıt Debisi', unit: 'L/h', min: 0, max: 40, f: (a, b) => (a * 256 + b) / 20 },
];

// Gösterge dışı, yalnızca durum için okunan PID: 0101 (MIL + DTC sayısı)
export const STATUS_PID = '01';

// Panoda kart olarak gösterilmeyen, ama aracın bildirebildiği standart PID'lerin adları (yalnızca bilgi amaçlı)
export const EXTRA_NAMES = {
  '03': 'Yakıt sistemi durumu (açık/kapalı çevrim)', '12': 'İkincil hava durumu', '13': 'Lambda sondalarının yeri',
  '14': 'Lambda B1S1 voltajı', '15': 'Lambda B1S2 voltajı', '1C': 'OBD standardı', '1D': 'Lambda sondalarının yeri (4 banka)',
  '1E': 'PTO durumu', '2C': 'Komut EGR', '2D': 'EGR hatası', '2E': 'Komut buharlaşma purge', '30': 'Silme sonrası ısınma sayısı',
  '32': 'EVAP sistem buhar basıncı', '34': 'Lambda B1S1 (akım)', '3C': 'Katalizör sıcaklığı B1S1', '3E': 'Katalizör sıcaklığı B1S2',
  '41': 'Bu sürüş döngüsünde monitör durumu', '45': 'Bağıl gaz kelebeği', '47': 'Mutlak gaz kelebeği B', '49': 'Gaz pedalı D',
  '4A': 'Gaz pedalı E', '4C': 'Komut gaz kelebeği', '4D': 'MIL açıkken geçen süre (dk)', '4E': 'Silmeden beri geçen süre (dk)',
  '51': 'Yakıt tipi', '20': 'Desteklenen PID 21-40', '40': 'Desteklenen PID 41-60', '60': 'Desteklenen PID 61-80',
};

export const PID_BY_ID = Object.fromEntries(PIDS.map((p) => [p.id, p]));

// Demo/ilk açılış için varsayılan grafik seçimi
export const DEFAULT_CHARTS = ['0C', '0D', '05', '11'];

export function fmt(p, v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (p.unit === 'rpm' || p.unit === 'km/h' || p.unit === 'km' || p.unit === 's') return Math.round(v).toString();
  if (p.unit === 'λ' || p.unit === 'V') return v.toFixed(2);
  return v.toFixed(1);
}
