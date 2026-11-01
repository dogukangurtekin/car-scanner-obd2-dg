"""Ham servis (UDS / KWP2000 CAN üzerinden ISO-TP) gönderimi ve yazma korumaları.

ELM327 ISO-TP çerçevelemeyi kendisi yapar (ATCAF1); biz yalnızca başlık (ATSH) ve veri baytlarını veririz.
NOT: Golf 5 (2005-2008) motor kontrol cihazının VAG'a özel kısmı çoğunlukla TP2.0 / KWP2000 konuşur ve
standart ISO-TP ile cevap vermeyebilir. Cevap gelmezse 'NO DATA' görürsünüz: bu araç/modül ISO-TP UDS konuşmuyor demektir.
"""
import csv
import os
import time

from .elm import ELM, ELMError, hex_bytes, join_resp, to_hex

NRC = {
    0x10: 'Genel ret', 0x11: 'Servis desteklenmiyor', 0x12: 'Alt fonksiyon desteklenmiyor', 0x13: 'Mesaj uzunluğu/biçimi hatalı',
    0x14: 'Yanıt çok uzun', 0x21: 'Meşgul, tekrar deneyin', 0x22: 'Koşullar uygun değil', 0x24: 'İstek sırası hatalı',
    0x31: 'İstek aralık dışı (DID/parametre yok)', 0x33: 'Güvenlik erişimi reddedildi', 0x35: 'Geçersiz anahtar',
    0x36: 'Anahtar deneme sınırı aşıldı', 0x37: 'Zaman gecikmesi dolmadı', 0x72: 'Genel programlama hatası',
    0x78: 'Yanıt bekleniyor (işlem sürüyor)', 0x7E: 'Alt fonksiyon bu oturumda desteklenmiyor', 0x7F: 'Servis bu oturumda desteklenmiyor',
}

SERVICES = {
    0x10: 'Oturum kontrol', 0x11: 'ECU sıfırla', 0x14: 'Arıza kodlarını sil (UDS)', 0x19: 'Arıza kodlarını oku (UDS)',
    0x22: 'Veri oku (DID)', 0x23: 'Bellek oku', 0x27: 'Güvenlik erişimi', 0x2E: 'Veri yaz (DID)', 0x2F: 'Giriş/çıkış kontrolü',
    0x31: 'Rutin kontrol', 0x34: 'İndirme başlat', 0x35: 'Yükleme başlat', 0x36: 'Veri aktar', 0x37: 'Aktarım bitir',
    0x3D: 'Belleğe yaz', 0x3E: 'Tester present', 0x85: 'DTC ayarı kontrol', 0x1A: 'KWP kimlik oku', 0x21: 'KWP yerel veri oku',
    0x2C: 'Dinamik veri tanımla', 0x30: 'KWP giriş/çıkış kontrolü', 0x3B: 'KWP kimliğe yaz',
}
# Kontrol cihazının durumunu / belleğini değiştirebilecek servisler
WRITE_SERVICES = {0x11, 0x14, 0x27, 0x2E, 0x2F, 0x30, 0x31, 0x34, 0x35, 0x36, 0x37, 0x3B, 0x3D, 0x85}

# Hazır sorgular (yalnızca okuma): ad -> (açıklama, veri)
PRESETS = [
    ('Oturum: varsayılan (10 01)', '1001'), ('Oturum: genişletilmiş (10 03)', '1003'), ('Tester present (3E 00)', '3E00'),
    ('VIN (22 F190)', '22F190'), ('Donanım no (22 F191)', '22F191'), ('Yazılım no (22 F194)', '22F194'),
    ('Sistem adı (22 F197)', '22F197'), ('Donanım sürümü (22 F193)', '22F193'), ('Yazılım sürümü (22 F195)', '22F195'),
    ('Seri no (22 F18C)', '22F18C'), ('Yedek parça no (22 F187)', '22F187'), ('Kodlama/ayar (22 F19E)', '22F19E'),
    ('Arıza kodları (19 02 FF)', '1902FF'),
]

DEFAULT_HEADER = '7DF'


def classify(data: bytes):
    """-> (servis kodu, ad, yazma_mı)"""
    sid = data[0]
    return sid, SERVICES.get(sid, f'Servis {sid:02X}'), sid in WRITE_SERVICES


class UDSError(Exception):
    pass


class Response:
    def __init__(self, raw_lines, payload, header):
        self.lines, self.payload, self.header = raw_lines, payload, header

    @property
    def negative(self):
        return bool(self.payload) and self.payload[0] == 0x7F and len(self.payload) >= 3

    @property
    def nrc(self):
        return self.payload[2] if self.negative else None

    def describe(self):
        if self.payload is None:
            return 'Yanıt yok (NO DATA)'
        if self.negative:
            return f'Olumsuz yanıt {self.payload[1]:02X}: {NRC.get(self.nrc, "NRC %02X" % self.nrc)}'
        return 'Olumlu yanıt: ' + to_hex(self.payload)


class UDS:
    def __init__(self, elm: ELM, log_dir: str = None):
        self.elm = elm
        self.header = DEFAULT_HEADER
        self.log_dir = log_dir or os.path.join(os.path.expanduser('~'), 'pyobd_kayitlar')

    def set_header(self, header: str, rx: str = None):
        self.elm.cmd('ATSH' + header, 3)
        if rx:
            self.elm.cmd('ATCRA' + rx, 3)
        else:
            self.elm.cmd('ATCRA', 3)
        self.header = header

    def reset_header(self):
        self.set_header(DEFAULT_HEADER)

    def send(self, data_hex: str, header: str = None, rx: str = None, timeout: float = 5.0) -> Response:
        """Ham servis gönderir. Yazma servisleri için ayrı fonksiyonlar (write_did vb.) kullanın; bu fonksiyon korumasızdır."""
        data = bytes.fromhex(data_hex.replace(' ', ''))
        if not data:
            raise UDSError('Boş istek')
        if header and header != self.header:
            self.set_header(header, rx)
        lines = self.elm.cmd(to_hex(data, ''), timeout)
        for l in lines:
            if l.upper().startswith(('UNABLE TO CONNECT', 'CAN ERROR', 'BUS')):
                raise ELMError(l)
        payload = None
        # olumlu: sid+0x40 ile başlar, olumsuz: 7F sid nrc
        for pre in (f'{data[0] + 0x40:02X}', '7F'):
            b = join_resp(lines, pre)
            if b is not None:
                payload = bytes([int(pre, 16)]) + bytes(b)
                break
        return Response(lines, payload, self.header)

    # ---- yazma günlüğü ve korumalar ----
    def _journal(self, header, req, resp, note=''):
        os.makedirs(self.log_dir, exist_ok=True)
        path = os.path.join(self.log_dir, 'yazma_gunlugu.csv')
        new = not os.path.exists(path)
        with open(path, 'a', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f, delimiter=';')
            if new:
                w.writerow(['zaman', 'baslik', 'istek', 'yanit', 'not'])
            w.writerow([time.strftime('%Y-%m-%d %H:%M:%S'), header, req, resp.describe() if resp else '', note])

    def check_ready_for_write(self, min_voltage: float = 12.0):
        v = self.elm.refresh_voltage()
        if v is None:
            raise UDSError('Akü gerilimi okunamadı; yazma işlemi yapılmaz.')
        if v < min_voltage:
            raise UDSError(f'Akü gerilimi {v:.1f} V < {min_voltage:.1f} V. Aküye şarj cihazı bağlayıp tekrar deneyin.')
        return v

    def send_write(self, data_hex: str, header: str, rx: str = None, note: str = '') -> Response:
        """Yazma sınıfı servisleri gönderir: gerilim kontrolü + günlük. Onay çağıran taraftadır (GUI)."""
        self.check_ready_for_write()
        r = self.send(data_hex, header, rx)
        self._journal(header, data_hex, r, note)
        return r

    def read_did(self, did: int, header: str, rx: str = None):
        r = self.send(f'22{did:04X}', header, rx)
        if r.payload is None or r.negative or len(r.payload) < 3:
            return None, r
        return r.payload[3:], r  # 62 DIDh DIDl <veri>

    def write_did(self, did: int, value: bytes, header: str, rx: str = None):
        """Yedekle -> yaz -> geri oku -> doğrula. Mevcut değer okunamıyorsa yazmaz."""
        old, r0 = self.read_did(did, header, rx)
        if old is None:
            raise UDSError('Mevcut değer okunamadı (' + r0.describe() + '); geri dönüş yedeği alınamadığı için yazılmaz.')
        os.makedirs(self.log_dir, exist_ok=True)
        bk = os.path.join(self.log_dir, f'yedek_{header}_{did:04X}_{time.strftime("%Y%m%d_%H%M%S")}.txt')
        with open(bk, 'w', encoding='utf-8') as f:
            f.write(f'baslik={header}\ndid={did:04X}\neski_deger={old.hex().upper()}\n')
        r = self.send_write(f'2E{did:04X}{value.hex()}', header, rx, note='eski=' + old.hex().upper())
        if r.payload is None or r.negative:
            raise UDSError('Yazma reddedildi: ' + r.describe() + f' (yedek: {bk})')
        new, _ = self.read_did(did, header, rx)
        if new != value:
            raise UDSError(f'Doğrulama başarısız! Okunan: {new.hex().upper() if new else None}, beklenen: {value.hex().upper()}. '
                           f'Eski değer yedeği: {bk}')
        return old, bk
