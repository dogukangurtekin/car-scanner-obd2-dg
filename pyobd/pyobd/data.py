# Otomatik uretildi (js/pids.js ve js/dtc.js kaynaklarindan) - elle duzenlemeyin; kaynak degisince tools/gen_data.mjs ile yeniden uretin
from typing import Callable, Optional

PIDS = [
    dict(id="03", key="03", name="Yakıt Sistemi Durumu", unit="", min=0, max=16, dec=None, fast=False, grp="Yakıt", lbl=True, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="04", key="04", name="Motor Yükü", unit="%", min=0, max=100, dec=None, fast=True, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="05", key="05", name="Soğutma Suyu", unit="°C", min=-40, max=130, dec=None, fast=False, grp="Sıcaklık", lbl=False, f=lambda a=0, b=0, c=0, d=0: a - 40),
    dict(id="06", key="06", name="Kısa Dönem Yakıt Düz.", unit="%", min=-25, max=25, dec=None, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: a / 1.28 - 100),
    dict(id="07", key="07", name="Uzun Dönem Yakıt Düz.", unit="%", min=-25, max=25, dec=None, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: a / 1.28 - 100),
    dict(id="0A", key="0A", name="Yakıt Basıncı (gösterge)", unit="kPa", min=0, max=765, dec=0, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 3),
    dict(id="0B", key="0B", name="Emme Manifold Basıncı", unit="kPa", min=0, max=255, dec=0, fast=False, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="0C", key="0C", name="Motor Devri", unit="rpm", min=0, max=7000, dec=None, fast=True, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 4),
    dict(id="0D", key="0D", name="Araç Hızı", unit="km/h", min=0, max=240, dec=None, fast=True, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="0E", key="0E", name="Ateşleme Avansı", unit="°", min=-64, max=64, dec=None, fast=False, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: a / 2 - 64),
    dict(id="0F", key="0F", name="Emme Havası Sıc.", unit="°C", min=-40, max=100, dec=None, fast=False, grp="Sıcaklık", lbl=False, f=lambda a=0, b=0, c=0, d=0: a - 40),
    dict(id="10", key="10", name="Hava Kütle Akışı (MAF)", unit="g/s", min=0, max=200, dec=None, fast=True, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 100),
    dict(id="11", key="11", name="Gaz Kelebeği", unit="%", min=0, max=100, dec=None, fast=True, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="12", key="12", name="İkincil Hava Durumu", unit="", min=0, max=8, dec=None, fast=False, grp="Emisyon", lbl=True, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="14", key="14", name="Lambda B1S1 Voltajı", unit="V", min=0, max=1.3, dec=3, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: a / 200),
    dict(id="15", key="15", name="Lambda B1S2 Voltajı", unit="V", min=0, max=1.3, dec=3, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: a / 200),
    dict(id="1C", key="1C", name="OBD Standardı", unit="", min=0, max=20, dec=None, fast=False, grp="Araç", lbl=True, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="1F", key="1F", name="Motor Çalışma Süresi", unit="s", min=0, max=3600, dec=None, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 256 + b),
    dict(id="21", key="21", name="MIL Sonrası Mesafe", unit="km", min=0, max=1000, dec=None, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 256 + b),
    dict(id="22", key="22", name="Yakıt Rayı Basıncı (vakuma göre)", unit="kPa", min=0, max=5000, dec=0, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) * 0.079),
    dict(id="23", key="23", name="Yakıt Rayı Basıncı (direkt enj.)", unit="kPa", min=0, max=15000, dec=0, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) * 10),
    dict(id="24", key="24", name="Lambda (Geniş Bant B1S1)", unit="λ", min=0.6, max=1.6, dec=None, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) * 2 / 65536),
    dict(id="24", key="24v", name="Lambda Sensör Voltajı B1S1", unit="V", min=0, max=8, dec=2, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: (c * 256 + d) * 8 / 65536),
    dict(id="2C", key="2C", name="Komut EGR", unit="%", min=0, max=100, dec=None, fast=False, grp="Emisyon", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="2D", key="2D", name="EGR Hatası", unit="%", min=-100, max=100, dec=None, fast=False, grp="Emisyon", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 128 - 100),
    dict(id="2E", key="2E", name="Komut EVAP Purge", unit="%", min=0, max=100, dec=None, fast=False, grp="Emisyon", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="2F", key="2F", name="Yakıt Seviyesi", unit="%", min=0, max=100, dec=None, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="30", key="30", name="Silmeden Sonra Isınma Sayısı", unit="", min=0, max=255, dec=0, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="31", key="31", name="Silme Sonrası Mesafe", unit="km", min=0, max=5000, dec=None, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 256 + b),
    dict(id="32", key="32", name="EVAP Sistem Buhar Basıncı", unit="Pa", min=-8000, max=8000, dec=0, fast=False, grp="Emisyon", lbl=False, f=lambda a=0, b=0, c=0, d=0: (lambda v: v - 65536 if v >= 32768 else v)(a * 256 + b) / 4),
    dict(id="33", key="33", name="Barometrik Basınç", unit="kPa", min=60, max=110, dec=0, fast=False, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: a),
    dict(id="34", key="34", name="Lambda B1S1 (akım tipi)", unit="λ", min=0.6, max=1.6, dec=None, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) * 2 / 65536),
    dict(id="34", key="34i", name="Lambda B1S1 Akımı", unit="mA", min=-128, max=128, dec=2, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: (c * 256 + d) / 256 - 128),
    dict(id="3C", key="3C", name="Katalizör Sıcaklığı B1S1", unit="°C", min=-40, max=900, dec=0, fast=False, grp="Sıcaklık", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 10 - 40),
    dict(id="3E", key="3E", name="Katalizör Sıcaklığı B1S2", unit="°C", min=-40, max=900, dec=0, fast=False, grp="Sıcaklık", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 10 - 40),
    dict(id="42", key="42", name="Kontrol Modülü Voltajı", unit="V", min=8, max=16, dec=None, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 1000),
    dict(id="43", key="43", name="Mutlak Motor Yükü", unit="%", min=0, max=200, dec=None, fast=False, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) * 100 / 255),
    dict(id="44", key="44", name="Komut Lambda", unit="λ", min=0.6, max=1.6, dec=None, fast=False, grp="Lambda", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) * 2 / 65536),
    dict(id="45", key="45", name="Bağıl Gaz Kelebeği", unit="%", min=0, max=100, dec=None, fast=False, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="46", key="46", name="Dış Hava Sıcaklığı", unit="°C", min=-40, max=60, dec=None, fast=False, grp="Sıcaklık", lbl=False, f=lambda a=0, b=0, c=0, d=0: a - 40),
    dict(id="47", key="47", name="Mutlak Gaz Kelebeği B", unit="%", min=0, max=100, dec=None, fast=False, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="49", key="49", name="Gaz Pedalı D", unit="%", min=0, max=100, dec=None, fast=False, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="4A", key="4A", name="Gaz Pedalı E", unit="%", min=0, max=100, dec=None, fast=False, grp="Motor", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="4C", key="4C", name="Komut Gaz Kelebeği", unit="%", min=0, max=100, dec=None, fast=False, grp="Hava", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 100 / 255),
    dict(id="4D", key="4D", name="MIL Açıkken Geçen Süre", unit="dk", min=0, max=600, dec=0, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 256 + b),
    dict(id="4E", key="4E", name="Silmeden Beri Geçen Süre", unit="dk", min=0, max=600, dec=0, fast=False, grp="Araç", lbl=False, f=lambda a=0, b=0, c=0, d=0: a * 256 + b),
    dict(id="5C", key="5C", name="Yağ Sıcaklığı", unit="°C", min=-40, max=160, dec=None, fast=False, grp="Sıcaklık", lbl=False, f=lambda a=0, b=0, c=0, d=0: a - 40),
    dict(id="5D", key="5D", name="Enjeksiyon Zamanlaması", unit="°", min=-210, max=302, dec=None, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 128 - 210),
    dict(id="5E", key="5E", name="Yakıt Debisi", unit="L/h", min=0, max=40, dec=None, fast=False, grp="Yakıt", lbl=False, f=lambda a=0, b=0, c=0, d=0: (a * 256 + b) / 20),
]

ALERTS = {
 "42": {
  "name": "Akü / modül voltajı",
  "unit": "V",
  "lo": [
   11.8,
   11
  ],
  "hi": [
   15,
   15.6
  ],
  "text": "normal dışı — şarj sistemini kontrol edin"
 },
 "05": {
  "name": "Soğutma suyu",
  "unit": "°C",
  "hi": [
   100,
   108
  ],
  "text": "çok yüksek — motoru kontrol edin"
 },
 "5C": {
  "name": "Yağ sıcaklığı",
  "unit": "°C",
  "hi": [
   120,
   135
  ],
  "text": "çok yüksek"
 },
 "0C": {
  "name": "Motor devri",
  "unit": "rpm",
  "hi": [
   6200,
   6600
  ],
  "text": "kırmızı bölgede"
 },
 "06": {
  "name": "Kısa dönem yakıt düzeltmesi",
  "unit": "%",
  "abs": [
   15,
   25
  ],
  "text": "normal dışı — karışım hatası olabilir"
 },
 "07": {
  "name": "Uzun dönem yakıt düzeltmesi",
  "unit": "%",
  "abs": [
   15,
   25
  ],
  "text": "normal dışı — hava kaçağı/enjektör olabilir"
 },
 "0F": {
  "name": "Emme havası",
  "unit": "°C",
  "hi": [
   70,
   90
  ],
  "text": "çok yüksek"
 }
}

DTC_INFO = {
 "P0030": "Lambda sondası ısıtıcı kontrol devresi (B1S1)",
 "P0101": "MAF sensörü aralık/performans hatası",
 "P0102": "MAF sensörü sinyali düşük",
 "P0103": "MAF sensörü sinyali yüksek",
 "P0106": "MAP sensörü aralık/performans hatası",
 "P0107": "MAP sensörü sinyali düşük",
 "P0108": "MAP sensörü sinyali yüksek",
 "P0112": "Emme havası sıcaklık sensörü sinyali düşük",
 "P0113": "Emme havası sıcaklık sensörü sinyali yüksek",
 "P0117": "Soğutma suyu sıcaklık sensörü sinyali düşük",
 "P0118": "Soğutma suyu sıcaklık sensörü sinyali yüksek",
 "P0121": "Gaz kelebeği/pedal sensörü aralık hatası",
 "P0125": "Kapalı çevrim için soğutma suyu sıcaklığı yetersiz (termostat?)",
 "P0128": "Termostat: soğutma suyu sıcaklığı beklenenin altında",
 "P0130": "Lambda sondası devre hatası (B1S1)",
 "P0131": "Lambda sondası voltajı düşük (B1S1)",
 "P0132": "Lambda sondası voltajı yüksek (B1S1)",
 "P0133": "Lambda sondası yavaş tepki (B1S1)",
 "P0134": "Lambda sondası sinyal yok (B1S1)",
 "P0135": "Lambda sondası ısıtıcı devresi (B1S1)",
 "P0136": "Lambda sondası devre hatası (B1S2)",
 "P0141": "Lambda sondası ısıtıcı devresi (B1S2)",
 "P0171": "Karışım çok fakir (Bank 1) — emme kaçağı, MAF, yakıt basıncı kontrol edin",
 "P0172": "Karışım çok zengin (Bank 1)",
 "P0201": "Enjektör devresi hatası, silindir 1",
 "P0202": "Enjektör devresi hatası, silindir 2",
 "P0203": "Enjektör devresi hatası, silindir 3",
 "P0204": "Enjektör devresi hatası, silindir 4",
 "P0299": "Turbo/Supercharger düşük basınç",
 "P0300": "Rastgele/çoklu silindir ateşleme kaçırma",
 "P0301": "Silindir 1 ateşleme kaçırma",
 "P0302": "Silindir 2 ateşleme kaçırma",
 "P0303": "Silindir 3 ateşleme kaçırma",
 "P0304": "Silindir 4 ateşleme kaçırma",
 "P0325": "Vuruntu sensörü 1 devre hatası",
 "P0335": "Krank mili konum sensörü devre hatası",
 "P0340": "Eksantrik mili konum sensörü devre hatası",
 "P0351": "Ateşleme bobini A birincil/ikincil devre hatası",
 "P0352": "Ateşleme bobini B birincil/ikincil devre hatası",
 "P0353": "Ateşleme bobini C birincil/ikincil devre hatası",
 "P0354": "Ateşleme bobini D birincil/ikincil devre hatası",
 "P0420": "Katalitik konvertör verimi eşik altında (Bank 1)",
 "P0441": "EVAP sistemi hatalı purge akışı",
 "P0442": "EVAP sistemi küçük kaçak",
 "P0455": "EVAP sistemi büyük kaçak (yakıt kapağı?)",
 "P0500": "Araç hız sensörü hatası",
 "P0505": "Rölanti kontrol sistemi hatası",
 "P0506": "Rölanti devri beklenenden düşük",
 "P0507": "Rölanti devri beklenenden yüksek",
 "P0562": "Sistem voltajı düşük (akü/şarj)",
 "P0563": "Sistem voltajı yüksek",
 "P0601": "ECU bellek (checksum) hatası",
 "P0606": "ECU işlemci hatası",
 "P0638": "Gaz kelebeği aktüatör kontrol aralık hatası",
 "P1128": "Uzun dönem yakıt düzeltme sınırı aşıldı (VW)",
 "P2096": "Katalizör sonrası yakıt düzeltme çok fakir (B1)",
 "P2097": "Katalizör sonrası yakıt düzeltme çok zengin (B1)",
 "P2106": "Gaz kelebeği aktüatör kontrol sistemi — güç sınırlı",
 "P2187": "Rölantide sistem çok fakir (Bank 1)",
 "P2188": "Rölantide sistem çok zengin (Bank 1)",
 "U0100": "Motor kontrol ünitesi (ECM) ile iletişim kaybı",
 "U0121": "ABS kontrol ünitesi ile iletişim kaybı"
}
