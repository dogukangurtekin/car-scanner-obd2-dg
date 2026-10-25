// Mode 03 yanıtını kod listesine çevirir ve yaygın kodlara Türkçe açıklama verir.
export function decodeDtcs(lines, isCAN) {
  const out = [];
  for (const raw of lines) {
    const l = raw.replace(/^\d+:/, '').replace(/\s+/g, '').toUpperCase();
    if (!l.startsWith('43') || !/^[0-9A-F]+$/.test(l)) continue;
    const bytes = l.slice(2).match(/../g) || [];
    // CAN'da 43'ten sonra kod sayısı baytı gelir
    const data = isCAN || bytes.length % 2 === 1 ? bytes.slice(1) : bytes;
    for (let i = 0; i + 1 < data.length; i += 2) {
      const a = parseInt(data[i], 16), b = parseInt(data[i + 1], 16);
      if (!a && !b) continue;
      const code = 'PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() +
        (b >> 4).toString(16).toUpperCase() + (b & 15).toString(16).toUpperCase();
      if (!out.includes(code)) out.push(code);
    }
  }
  return out;
}

export const DTC_INFO = {
  P0030: 'Lambda sondası ısıtıcı kontrol devresi (B1S1)',
  P0101: 'MAF sensörü aralık/performans hatası',
  P0102: 'MAF sensörü sinyali düşük',
  P0103: 'MAF sensörü sinyali yüksek',
  P0106: 'MAP sensörü aralık/performans hatası',
  P0107: 'MAP sensörü sinyali düşük',
  P0108: 'MAP sensörü sinyali yüksek',
  P0112: 'Emme havası sıcaklık sensörü sinyali düşük',
  P0113: 'Emme havası sıcaklık sensörü sinyali yüksek',
  P0117: 'Soğutma suyu sıcaklık sensörü sinyali düşük',
  P0118: 'Soğutma suyu sıcaklık sensörü sinyali yüksek',
  P0121: 'Gaz kelebeği/pedal sensörü aralık hatası',
  P0125: 'Kapalı çevrim için soğutma suyu sıcaklığı yetersiz (termostat?)',
  P0128: 'Termostat: soğutma suyu sıcaklığı beklenenin altında',
  P0130: 'Lambda sondası devre hatası (B1S1)',
  P0131: 'Lambda sondası voltajı düşük (B1S1)',
  P0132: 'Lambda sondası voltajı yüksek (B1S1)',
  P0133: 'Lambda sondası yavaş tepki (B1S1)',
  P0134: 'Lambda sondası sinyal yok (B1S1)',
  P0135: 'Lambda sondası ısıtıcı devresi (B1S1)',
  P0136: 'Lambda sondası devre hatası (B1S2)',
  P0141: 'Lambda sondası ısıtıcı devresi (B1S2)',
  P0171: 'Karışım çok fakir (Bank 1) — emme kaçağı, MAF, yakıt basıncı kontrol edin',
  P0172: 'Karışım çok zengin (Bank 1)',
  P0201: 'Enjektör devresi hatası, silindir 1',
  P0202: 'Enjektör devresi hatası, silindir 2',
  P0203: 'Enjektör devresi hatası, silindir 3',
  P0204: 'Enjektör devresi hatası, silindir 4',
  P0299: 'Turbo/Supercharger düşük basınç',
  P0300: 'Rastgele/çoklu silindir ateşleme kaçırma',
  P0301: 'Silindir 1 ateşleme kaçırma',
  P0302: 'Silindir 2 ateşleme kaçırma',
  P0303: 'Silindir 3 ateşleme kaçırma',
  P0304: 'Silindir 4 ateşleme kaçırma',
  P0325: 'Vuruntu sensörü 1 devre hatası',
  P0335: 'Krank mili konum sensörü devre hatası',
  P0340: 'Eksantrik mili konum sensörü devre hatası',
  P0351: 'Ateşleme bobini A birincil/ikincil devre hatası',
  P0352: 'Ateşleme bobini B birincil/ikincil devre hatası',
  P0353: 'Ateşleme bobini C birincil/ikincil devre hatası',
  P0354: 'Ateşleme bobini D birincil/ikincil devre hatası',
  P0420: 'Katalitik konvertör verimi eşik altında (Bank 1)',
  P0441: 'EVAP sistemi hatalı purge akışı',
  P0442: 'EVAP sistemi küçük kaçak',
  P0455: 'EVAP sistemi büyük kaçak (yakıt kapağı?)',
  P0500: 'Araç hız sensörü hatası',
  P0505: 'Rölanti kontrol sistemi hatası',
  P0506: 'Rölanti devri beklenenden düşük',
  P0507: 'Rölanti devri beklenenden yüksek',
  P0562: 'Sistem voltajı düşük (akü/şarj)',
  P0563: 'Sistem voltajı yüksek',
  P0601: 'ECU bellek (checksum) hatası',
  P0606: 'ECU işlemci hatası',
  P0638: 'Gaz kelebeği aktüatör kontrol aralık hatası',
  P1128: 'Uzun dönem yakıt düzeltme sınırı aşıldı (VW)',
  P2096: 'Katalizör sonrası yakıt düzeltme çok fakir (B1)',
  P2097: 'Katalizör sonrası yakıt düzeltme çok zengin (B1)',
  P2106: 'Gaz kelebeği aktüatör kontrol sistemi — güç sınırlı',
  P2187: 'Rölantide sistem çok fakir (Bank 1)',
  P2188: 'Rölantide sistem çok zengin (Bank 1)',
  U0100: 'Motor kontrol ünitesi (ECM) ile iletişim kaybı',
  U0121: 'ABS kontrol ünitesi ile iletişim kaybı',
};

export const dtcDescribe = (c) => DTC_INFO[c] || 'Açıklama sözlükte yok — kodu VW/Golf 5 1.6 FSI ile aratın.';
