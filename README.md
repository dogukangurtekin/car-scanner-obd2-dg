# Golf 5 OBD Panosu

ELM327 ile VW Golf 5 1.6 FSI için tarayıcıda çalışan canlı OBD2 panosu. Backend ve derleme yok; statik dosyalar.

- Canlı kadranlar, PID kartları, grafikler, yolculuk istatistikleri (mesafe, yakıt tahmini, dağılımlar)
- Arıza kodu okuma/silme, VIN, terminal, CSV dışa aktarma
- Bağlantı: **Web Serial** (klasik BT ELM327, Windows'ta eşleştirilmiş COM port), **Web Bluetooth** (yalnızca BLE modeller), **Demo**
- Gereksinim: Chrome/Edge masaüstü, **HTTPS** (veya localhost)

## Yerel çalıştırma
```bash
python -m http.server 8765
```
`http://localhost:8765` ana sayfa, `/panel.html` uygulama. `panel.html?demo=1` doğrudan demo modunu açar.

## Araca bağlanma
1. ELM327'yi OBD2 soketine takın, kontağı açın (motor çalışması şart değil).
2. Windows → Bluetooth → cihazı eşleştirin (PIN 1234 veya 0000).
3. Panoda "Klasik Bluetooth / USB (Web Serial)" → Bağlan → sanal COM portu seçin.

## Dağıtım (alt alan adı)
1. Sunucuda alt alan adı + web kökü oluşturun, **SSL (Let's Encrypt)** açın.
2. Sunucuda GitHub Actions için ayrı bir SSH anahtarı üretip public kısmını `authorized_keys`'e ekleyin.
3. Repo → Settings → Secrets → `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PATH`.
4. `main`'e push → `.github/workflows/deploy.yml` dosyaları rsync ile gönderir.

Tasarım ve kapsam için bkz. [docs/PROMPT.md](docs/PROMPT.md).
