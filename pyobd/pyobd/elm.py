"""ELM327 komut katmanı: AT komutları, yanıt ayrıştırma, çok çerçeveli (ISO-TP) yanıt birleştirme."""
import re
import threading
import time

ERRORS = ('UNABLE TO CONNECT', 'CAN ERROR', 'BUS INIT', 'BUS BUSY', 'BUFFER FULL', 'DATA ERROR', 'FB ERROR', 'LV RESET', 'ACT ALERT', 'STOPPED', 'ERR')


class ELMError(Exception):
    pass


def hex_bytes(s: str):
    return [int(s[i:i + 2], 16) for i in range(0, len(s) - 1, 2)]


def to_hex(b, sep=' '):
    return sep.join(f'{x:02X}' for x in b)


def _clean(line: str) -> str:
    return re.sub(r'^\d+:', '', line).replace(' ', '').upper()


def find_resp(lines, prefix: str):
    """prefix ile başlayan ilk yanıtın veri baytları (yoksa None)."""
    for raw in lines:
        l = _clean(raw)
        if l.startswith(prefix) and re.fullmatch(r'[0-9A-F]+', l):
            return hex_bytes(l[len(prefix):])
    return None


def join_resp(lines, prefix: str):
    """Çok çerçeveli yanıtı ('0:', '1:' satırları) birleştirir; ilk satırın prefix'ini atar."""
    out, started = [], False
    for raw in lines:
        l = _clean(raw)
        if not re.fullmatch(r'[0-9A-F]+', l) or re.fullmatch(r'[0-9A-F]{3}', l):
            continue  # "014" gibi uzunluk satırı
        if l.startswith(prefix) and not started:
            out += hex_bytes(l[len(prefix):])
            started = True
        elif started:
            out += hex_bytes(l)
    return out if started else None


def mask_ids(b, start):
    mask = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
    ids = [start + i for i in range(1, 33) if mask & (1 << (32 - i))]
    return ids, bool(mask & 1)


class ELM:
    def __init__(self, link, log=None):
        self.link = link
        self.log = log or (lambda kind, text: None)
        self.lock = threading.RLock()
        self.info = {}
        self.is_can = True
        self.fast = True
        self.supported = set()

    # ---- düşük seviye ----
    def cmd(self, c: str, timeout: float = 3.0):
        """Komutu gönderir, '>' istemine kadar okur, satır listesi döndürür."""
        with self.lock:
            self.link.flush()
            self.log('tx', c)
            self.link.write((c + '\r').encode('ascii'))
            buf = bytearray()
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                chunk = self.link.read(0.05)
                if chunk:
                    buf += chunk
                    if b'>' in buf:
                        break
            else:
                raise TimeoutError('Zaman aşımı: ' + c)
            text = buf.decode('ascii', 'ignore').split('>')[0]
            self.log('rx', text.strip().replace('\r', ' | '))
            lines = [x.strip() for x in re.split(r'[\r\n]+', text)]
            return [x for x in lines if x and x.upper() != c.upper() and not x.upper().startswith('SEARCHING')]

    def request(self, c: str, prefix: str, timeout: float = 3.0, join: bool = False):
        """c'yi gönderir, prefix ile başlayan yanıtın verisini döndürür. Yanıt yoksa None; bağlantı hatasında ELMError."""
        lines = self.cmd(c, timeout)
        for l in lines:
            u = l.upper()
            if any(u.startswith(e) for e in ERRORS) or u == '?':
                raise ELMError(l)
        return (join_resp if join else find_resp)(lines, prefix)

    # ---- başlatma ----
    def init(self, protocol: str = '0', fast: bool = True):
        self.fast = fast
        try:
            z = self.cmd('ATZ', 8)
        except TimeoutError:
            z = []
        self.info['elm'] = next((l for l in z if re.search(r'ELM|OBD', l, re.I)), '')
        for c in ('ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT2', 'ATSTFF', 'ATCAF1', 'ATSP' + protocol):
            self.cmd(c, 4)
        supported, nxt = set(), True
        for base in ('00', '20', '40', '60'):
            if not nxt:
                break
            lines = self._first_pid(protocol) if base == '00' else self.cmd('01' + base, 15)
            b = find_resp(lines, '41' + base)
            if not b or len(b) < 4:
                if base == '00':
                    raise ELMError('Araca bağlanılamadı: ' + (' '.join(lines) or 'yanıt yok') + ' (kontağı açtınız mı?)')
                break
            ids, nxt = mask_ids(b, int(base, 16))
            supported.update(f'{n:02X}' for n in ids)
        self.supported = supported
        dpn = (self.cmd('ATDPN') or [''])[0]
        self.info['protocol'] = dpn
        self.is_can = bool(re.search(r'[6-9]', re.sub(r'^A', '', dpn)))
        self.refresh_voltage()
        return supported

    def _first_pid(self, protocol):
        lines = self.cmd('0100', 20)
        if find_resp(lines, '4100') or protocol != '0':
            return lines
        for p in ('7', '6', '9', '8', '5', '4', '3', '1'):
            self.log('sys', 'Protokol deneniyor: ' + p)
            try:
                self.cmd('ATPC', 3)
            except Exception:
                pass
            self.cmd('ATSP' + p, 4)
            try:
                lines = self.cmd('0100', 12)
            except TimeoutError:
                lines = []
            if find_resp(lines, '4100'):
                self.info['forced'] = p
                return lines
        self.cmd('ATSP0', 4)
        return lines

    def refresh_voltage(self):
        try:
            m = re.search(r'[\d.]+', (self.cmd('ATRV') or [''])[0])
            self.info['voltage'] = float(m.group()) if m else None
        except Exception:
            self.info['voltage'] = None
        return self.info['voltage']

    def close(self):
        try:
            self.link.close()
        except Exception:
            pass
