# pyobd — ELM327 ile OBD2 / UDS tanı uygulaması (Windows, Python)

Web panelinin masaüstü kardeşi. Golf 5 1.6 FSI (BLF) için geliştirildi, her OBD2 aracıyla çalışır.

## Kurulum ve çalıştırma
```
cd pyobd
pip install -r requirements.txt
python -m pyobd            # arayüz
python -m pyobd --demo     # sanal araçla dene (adaptör gerekmez)
```
`calistir.bat` aynısını çift tıkla yapar. Python 3.10+ gerekir, arayüz tkinter (Python ile gelir).

## Bağlantı
- **USB / Bluetooth ELM327:** Windows'ta COM port olarak görünür (Aygıt Yöneticisi → Bağlantı Noktaları), 38400 baud (olmazsa 115200).
- **Wi-Fi ELM327:** Bilgisayarı adaptörün Wi-Fi ağına bağlayın, 192.168.0.10:35000 (panel web'de çalışmaz, bu uygulamada çalışır).

## Neler yapar (ELM327 ile)
| Sekme | İşlev |
|---|---|
| Canlı veri | Desteklenen tüm Mode 01 PID'leri, grafik, anormal değer uyarısı, CSV kaydı |
| Arızalar | Kayıtlı/bekleyen/kalıcı arıza kodları, arıza silme (Mode 04), freeze frame, hazırlık monitörleri |
| Araç bilgisi | VIN, kalibrasyon ID, CVN, ECU adı, desteklenen PID listesi, Mode 06 test sonuçları |
| Ham / UDS | Başlık seçerek (ör. 7E0→7E8) ham servis gönderme, hazır okuma sorguları, AT komutları, **güvenli DID yazma** |
| Günlük | ELM327 ile giden/gelen tüm satırlar |

## Yazma işlemleri ve korumalar
Yazma sınıfı servisler (0x11, 0x14, 0x27, 0x2E, 0x2F, 0x31, 0x34-37, 0x3D, 0x85 ...) için:
1. Akü gerilimi ≥ 12.0 V olmalı (şarj cihazı önerilir), aksi halde reddedilir.
2. `ONAYLIYORUM` yazarak onaylanır.
3. **DID yazma:** mevcut değer önce okunup `~/pyobd_kayitlar/yedek_*.txt` dosyasına yedeklenir (okunamazsa yazılmaz), yazılır, geri okunur ve doğrulanır.
4. Her yazma `~/pyobd_kayitlar/yazma_gunlugu.csv` dosyasına işlenir.

## Sınırlar (dürüst not)
- ELM327 yalnızca standart OBD2 ve ISO-TP (CAN) / KWP2000 çerçevelemesini kendisi yapar. Golf 5'in VAG'a özel modülleri (kodlama, uyarlama, ölçüm blokları)
  çoğunlukla **TP2.0** konuşur; ELM327 bunu desteklemez. Ham sekmede "NO DATA" alırsanız modül ISO-TP UDS konuşmuyor demektir.
- Ucuz ELM327 klonları uzun yazma işlemlerinde güvenilmez. Yazmayı kaliteli adaptörle (OBDLink / STN çipli) yapın.
- Motor performansı / chip tuning kapsam dışıdır.

## Testler
```
python -m unittest discover -s tests -v
```
`pyobd/sim.py` sanal araç içerir; testler ve `--demo` bunu kullanır.

Veri tabloları (`pyobd/data.py`) web panelinden üretilir: `node tools/gen_data.mjs` (js/pids.js ve js/dtc.js kaynak).
