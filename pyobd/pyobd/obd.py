"""OBD2 (SAE J1979) işlemleri: canlı PID'ler, arıza kodları, freeze frame, araç bilgisi, hazırlık durumu, Mode 06."""
import re

from .data import ALERTS, DTC_INFO, PIDS
from .elm import ELM, ELMError, find_resp, hex_bytes, join_resp, mask_ids, to_hex

FUEL_STATUS = {1: 'Açık çevrim (motor soğuk)', 2: 'Kapalı çevrim (lambda)', 4: 'Açık çevrim (yük/yavaşlama)',
               8: 'Açık çevrim (arıza)', 16: 'Kapalı çevrim (sensör arızası)', 0: '—'}
OBD_STD = {1: 'OBD-II (CARB)', 2: 'OBD (EPA)', 3: 'OBD ve OBD-II', 4: 'OBD-I', 5: 'OBD değil', 6: 'EOBD (Avrupa)',
           7: 'EOBD ve OBD-II', 8: 'EOBD ve OBD', 9: 'EOBD, OBD ve OBD-II'}
SEC_AIR = {0: 'Yok', 1: 'Yukarı akış', 2: 'Katalizör öncesi', 4: 'Dış hava / kapalı', 8: 'Tanı için pompa'}
LABELS = {'03': FUEL_STATUS, '1C': OBD_STD, '12': SEC_AIR}

PID_BY_KEY = {p['key']: p for p in PIDS}


def fmt(p, v):
    if v is None:
        return '—'
    if p['lbl']:
        return LABELS[p['id']].get(int(v), f'Kod {int(v)}')
    d = p['dec']
    if d is None:
        d = {'rpm': 0, 'km/h': 0, 'km': 0, 's': 0, 'λ': 2, 'V': 2}.get(p['unit'], 1)
    return f'{v:.{d}f}'


def alert_of(key, v):
    a = ALERTS.get(key)
    if not a or v is None:
        return None

    def test(i):
        return (a.get('hi') and v >= a['hi'][i]) or (a.get('lo') and v <= a['lo'][i]) or (a.get('abs') and abs(v) >= a['abs'][i])
    level = 'crit' if test(1) else 'warn' if test(0) else None
    return {'level': level, 'msg': f"{a['name']} {v:.1f} {a['unit']} {a['text']}"} if level else None


def dtc_describe(code):
    return DTC_INFO.get(code, 'Açıklama sözlükte yok — kodu VW/Golf 5 1.6 FSI ile aratın.')


def decode_dtcs(lines, is_can, prefix='43'):
    out = []
    for raw in lines:
        l = re.sub(r'^\d+:', '', raw).replace(' ', '').upper()
        if not l.startswith(prefix) or not re.fullmatch(r'[0-9A-F]+', l):
            continue
        data = hex_bytes(l[len(prefix):])
        if is_can or len(data) % 2 == 1:
            data = data[1:]  # CAN'da kod sayısı baytı
        for i in range(0, len(data) - 1, 2):
            a, b = data[i], data[i + 1]
            if not a and not b:
                continue
            code = 'PCBU'[a >> 6] + str((a >> 4) & 3) + f'{a & 15:X}{b >> 4:X}{b & 15:X}'
            if code not in out:
                out.append(code)
    return out


class Obd:
    def __init__(self, elm: ELM):
        self.elm = elm
        self._slow = 0

    # ---- canlı veri ----
    def read_bytes(self, pid_id):
        return self.elm.request('01' + pid_id + ('1' if self.elm.fast else ''), '41' + pid_id)

    def read_pid(self, p):
        b = self.read_bytes(p['id'])
        if not b:
            return None
        try:
            return p['f'](*b[:4])
        except Exception:
            return None

    def supported_defs(self):
        return [p for p in PIDS if p['id'] in self.elm.supported]

    def read_many(self, defs):
        """{key: değer}. Aynı PID'den türeyen değerler tek istekle okunur; hızlı PID'ler her turda,
        diğerleri sırayla tek tek araya girer (ELM yavaşlamasın)."""
        slow = [p for p in defs if not p['fast']]
        pick = [p for p in defs if p['fast']]
        if slow:
            pick.append(slow[self._slow % len(slow)])
            self._slow += 1
        out, cache = {}, {}
        for p in pick:
            if p['id'] not in cache:
                cache[p['id']] = self.read_bytes(p['id'])
            b = cache[p['id']]
            for q in defs:
                if q['id'] == p['id'] and b:
                    try:
                        out[q['key']] = q['f'](*b[:4])
                    except Exception:
                        pass
        return out

    # ---- arıza kodları ----
    def read_dtcs(self, mode='03'):
        prefix = f'{int(mode, 16) + 0x40:02X}'
        return decode_dtcs(self.elm.cmd(mode, 8), self.elm.is_can, prefix)

    def clear_dtcs(self):
        """Mode 04: arıza kodlarını, freeze frame'i ve hazırlık durumunu siler."""
        lines = self.elm.cmd('04', 8)
        ok = any(l.replace(' ', '').upper().startswith('44') for l in lines)
        return ok, lines

    def read_freeze_frame(self, ids):
        d = find_resp(self.elm.cmd('020200', 5), '420200')
        dtc = None
        if d and len(d) >= 2 and (d[0] or d[1]):
            dtc = (decode_dtcs(['43' + to_hex(d[:2], ''), ], False) or [None])[0]
        values = {}
        for i in ids:
            if i == '02':
                continue
            try:
                b = find_resp(self.elm.cmd('02' + i + '00', 3), '42' + i + '00')
            except Exception:
                b = None
            if b:
                values[i] = b
        return dtc, values

    # ---- durum / hazırlık ----
    def read_status(self, pid='01'):
        b = find_resp(self.elm.cmd('01' + pid, 4), '41' + pid)
        return b[:4] if b and len(b) >= 4 else None

    @staticmethod
    def decode_status(b):
        mil, count = bool(b[0] & 0x80), b[0] & 0x7F
        diesel = bool(b[1] & 0x08)
        mon = []
        for i, name in enumerate(('Ateşleme kaçırma', 'Yakıt sistemi', 'Kapsamlı bileşenler')):
            if b[1] & (1 << i):
                mon.append((name, not (b[1] & (1 << (i + 4)))))
        names = (('Katalizör', 'NMHC katalizör'), ('Isıtmalı katalizör', 'NOx/SCR'), ('EVAP sistemi', 'Turbo basınç'),
                 ('İkincil hava', '—'), ('Klima gazı', 'Egzoz sensörü'), ('Lambda sensörü', 'PM filtresi'),
                 ('Lambda ısıtıcı', 'Egzoz sensörü ısıtıcı'), ('EGR / VVT', 'EGR / VVT'))
        for i, (spark, comp) in enumerate(names):
            if b[2] & (1 << i):
                mon.append((comp if diesel else spark, not (b[3] & (1 << i))))
        return {'mil': mil, 'count': count, 'diesel': diesel, 'monitors': mon}

    # ---- araç bilgisi (Mode 09) ----
    def read_vin(self):
        b = join_resp(self.elm.cmd('0902', 8), '4902')
        if not b:
            return ''
        data = b[1:] if b and b[0] == 1 else b
        return ''.join(chr(c) for c in data if 48 <= c < 91)[:17]

    def read_info(self, pid):
        b = join_resp(self.elm.cmd('09' + pid, 8), '49' + pid)
        if not b:
            return None
        data = b[1:] if b[0] <= 8 else b
        if pid == '06':
            h = to_hex(data, '')
            return '  '.join(h[i:i + 8] for i in range(0, len(h), 8))
        txt = ''.join(chr(c) for c in data if 32 <= c < 127).strip()
        return txt or to_hex(data)

    # ---- Mode 06 ----
    def read_mode06(self):
        mids, nxt = [], True
        for base in ('00', '20', '40', '60', '80', 'A0', 'C0', 'E0'):
            if not nxt:
                break
            b = find_resp(self.elm.cmd('06' + base, 5), '46' + base)
            if not b or len(b) < 4:
                break
            ids, nxt = mask_ids(b, int(base, 16))
            mids += [m for m in ids if m % 0x20]
        rows = []
        for mid in mids:
            m = f'{mid:02X}'
            try:
                b = join_resp(self.elm.cmd('06' + m, 6), '46' + m)
            except Exception:
                b = None
            if not b:
                continue
            # kayıtlar (MID sonrası): TID, birim/ölçek ID, test değeri(2), min(2), max(2) = 8 bayt; bazı araçlar her kayıtta MID'i tekrarlar
            i = 0
            while i + 8 <= len(b):
                tid, uas = b[i], b[i + 1]
                val, lo, hi = (b[i + 2] << 8) | b[i + 3], (b[i + 4] << 8) | b[i + 5], (b[i + 6] << 8) | b[i + 7]
                rows.append({'mid': m, 'tid': f'{tid:02X}', 'uas': f'{uas:02X}', 'val': val, 'min': lo, 'max': hi,
                             'ok': (lo <= val <= hi) if hi else None})
                i += 8
                if i < len(b) and b[i] == mid and (len(b) - i) % 8 == 1:
                    i += 1
        return rows
