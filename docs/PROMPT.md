# Proje İstemi — Golf 5 1.6 FSI Web OBD2 Panosu

## Amaç
ELM327 (klasik Bluetooth SPP veya BLE) adaptörü üzerinden aracın OBD2 ECU'suna bağlanan, **yalnızca tarayıcıda çalışan** (backend yok, derleme adımı yok) bir canlı veri panosu. Car Scanner benzeri ama web arayüzlü: canlı göstergeler, grafikler, yolculuk istatistikleri, arıza kodu okuma/silme, CSV dışa aktarma, ham terminal.

## Hedef araç
VW Golf 5 (1K) 1.6 FSI (BAG / BLF / BLP motor kodları), 2004+ → **ISO 15765-4 CAN 11 bit / 500 kbaud** (ELM `ATSP6`; varsayılan `ATSP0` otomatik algılama).

## Aktarım katmanı (karar ve gerekçe)
| Aktarım | Ne zaman | Not |
|---|---|---|
| **Web Serial** | Klasik BT (SPP) ELM327 — resimdeki "OBD Advanced" gibi | Cihazı önce Windows'ta eşleştir; sanal COM port olarak seçilir. Chrome/Edge masaüstü. |
| **Web Bluetooth** | BLE ELM327 (Vgate iCar Pro BLE, vb.) | Klasik BT cihazlar BLE olmadığı için bununla ÇALIŞMAZ. Servis: FFF0/FFE0/18F0/E7810A71… |
| **Demo** | Araç yokken geliştirme/test | ELM327 yanıtlarını taklit eder. |

Her ikisi de **HTTPS veya localhost** gerektirir (secure context) → alt alan adı için SSL şart.

## ELM327 başlatma dizisi
`ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATAT1 → ATSP<n> → 0100 → ATDPN → ATRV`
Komut sonuna `\r`, yanıt `>` istemine kadar okunur. Hızlı mod: `01xx1` (beklenen yanıt sayısı 1) → daha hızlı sorgu.
Desteklenen PID'ler `0100/0120/0140/0160` bit maskelerinden çıkarılır; yalnızca desteklenenler sorgulanır.
Hızlı PID'ler (devir, hız, gaz, yük, MAF, MAP) her turda, yavaşlar (sıcaklıklar, yakıt seviyesi, voltaj…) her 6 turda bir.

## Okunacak veriler (Mode 01)
Motor yükü 04, soğutma suyu 05, kısa/uzun yakıt düzeltme 06/07 (FSI için kritik: lean/rich teşhisi), MAP 0B, **devir 0C**, **hız 0D**, ateşleme avansı 0E, emme havası 0F, **MAF 10**, gaz kelebeği 11, motor çalışma süresi 1F, MIL sonrası mesafe 21, geniş bant lambda 24, yakıt seviyesi 2F, silme sonrası mesafe 31, barometrik 33, kontrol modülü voltajı 42, mutlak yük 43, komut lambda 44, ortam sıcaklığı 46, yağ sıcaklığı 5C (genelde Golf 5'te yok), yakıt debisi 5E, MIL/DTC sayısı 01.
Diğer modlar: **03** kayıtlı arıza kodları, **04** silme, **0902** VIN, `ATRV` akü voltajı.

## Arayüz gereksinimleri (Türkçe, koyu tema, mobil uyumlu)
1. **Gösterge**: RPM ve hız kadranları, her PID için kart + mini grafik.
2. **Grafikler**: seçilebilir PID'ler, 30sn–15dk pencere, min/ort/maks.
3. **İstatistik**: süre, mesafe (hızın integrali), ort/maks hız, maks devir, rölanti süresi, MAF'tan yakıt tüketimi (L/100km, anlık ve ortalama; benzin AFR 14.7, yoğunluk 745 g/L; MAF yoksa MAP/IAT/RPM ile yaklaşık), devir ve hız dağılım histogramı.
4. **Arıza kodları**: P/C/B/U çözümleme, Türkçe açıklama sözlüğü, silme (onaylı).
5. **Araç bilgisi**: VIN, protokol, ELM sürümü, voltaj, desteklenen PID tablosu.
6. **Terminal**: ham AT/OBD komutları ve TX/RX günlüğü.
7. **CSV dışa aktarma** (oturum kaydı).

## Güvenlik / sınırlar
- Salt okunur teşhis; yalnızca Mode 01/03/04/09 ve AT komutları. Kodları silme kullanıcı onayıyla.
- VW'ye özel (KWP2000/UDS: vites, ABS, airbag, ham basınç değerleri) bu sürümde YOK; ELM327 klonları bunda sınırlıdır.
- Ucuz v2.1 klonlar yavaş/yarım olabilir; hız tipik 8–15 PID/sn.

## Teslimat
Statik dosyalar (`index.html`, `css/`, `js/`), GitHub repo, GitHub Actions ile alt alan adına otomatik dağıtım (SSH/rsync), HTTPS.
