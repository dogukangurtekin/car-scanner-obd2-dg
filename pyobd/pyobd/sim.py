"""Gerçek araç/adaptör olmadan denemek ve test etmek için sanal ELM327 + araç (CAN, ISO 15765-4 11 bit, ATS0/ATH0 biçimi)."""
import math
import re
import time

from .link import Link

VIN = 'WVWZZZ1KZ6W000001'
CALID = 'MAE06A906032CA'
DTCS = (0x0171, 0x2187)  # P0171, P2187


def _hex(b):
    return ''.join(f'{x:02X}' for x in b)


def _isotp(payload: bytes):
    """ELM327 (ATH0) çok çerçeveli yanıt biçimi."""
    if len(payload) <= 7:
        return [_hex(payload)]
    chunks = [payload[0:6]] + [payload[i:i + 7] for i in range(6, len(payload), 7)]
    out = [f'{len(payload):03X}']
    for i, c in enumerate(chunks):
        out.append(f'{i % 16:X}:' + _hex(c))
    return out


class SimLink(Link):
    def __init__(self, battery=12.7, dids=None):
        self.out = bytearray()
        self.echo = True
        self.t0 = time.time()
        self.battery = battery
        self.dtcs = list(DTCS)
        self.header = '7DF'
        self.dids = dids if dids is not None else {0xF190: VIN.encode(), 0xF199: bytes([0x20, 0x26, 0x01, 0x10]),
                                                   0xF187: b'1K0907115AB', 0xF19E: b'ASAM00001'}
        self.session = 1
        self.log = []

    # ---- Link ----
    def write(self, data: bytes):
        for cmd in data.decode('ascii').split('\r'):
            cmd = cmd.strip()
            if not cmd:
                continue
            self.log.append(cmd)
            if self.echo:
                self.out += (cmd + '\r').encode()
            self.out += ('\r'.join(self._answer(cmd.upper().replace(' ', ''))) + '\r\r>').encode()

    def read(self, timeout=0.05):
        d, self.out = bytes(self.out), bytearray()
        return d

    # ---- araç ----
    def _rpm(self):
        return 800 + 700 * (1 + math.sin((time.time() - self.t0) / 3))

    def _pid(self, pid):
        t = time.time() - self.t0
        rpm = int(self._rpm() * 4)
        spd = int(40 + 30 * math.sin(t / 5))
        table = {
            '00': [0xBE, 0x3F, 0xA8, 0x13], '20': [0x80, 0x00, 0x00, 0x01], '40': [0x44, 0x00, 0x00, 0x00],
            '01': [0x82 if self.dtcs else 0x00, 0x07, 0xE5, 0x1F], '03': [2, 0], '04': [90], '05': [min(255, 130 + int(t) // 20)],
            '06': [128 + 2], '07': [128 + 3], '0B': [35], '0C': [rpm >> 8, rpm & 255], '0D': [spd], '0E': [0x90],
            '0F': [70], '10': [0x02, 0x58], '11': [60], '1C': [6], '1F': [0x00, 0x3C], '2F': [140],
            '33': [101], '42': [0x32, 0xC8], '46': [60], '5C': [min(255, 150 + int(t) // 10)],
        }
        return table.get(pid)

    def _answer(self, c):
        if c.startswith('AT'):
            return self._at(c)
        if c == '0100' or c.startswith('01') and len(c) in (4, 5):
            pid = c[2:4]
            d = self._pid(pid)
            return [_hex([0x41, int(pid, 16)] + d)] if d is not None else ['NO DATA']
        if c == '03':
            return _isotp(bytes([0x43, len(self.dtcs)] + [x for d in self.dtcs for x in (d >> 8, d & 255)]))
        if c == '07':
            return _isotp(bytes([0x47, 0]))
        if c == '0A':
            return _isotp(bytes([0x4A, 0]))
        if c == '04':
            self.dtcs = []
            return ['44']
        if c == '020200':
            return [_hex([0x42, 0x02, 0x00, 0x01, 0x71]) if self.dtcs else '420200 0000'.replace(' ', '')]
        if re.fullmatch(r'02[0-9A-F]{2}00', c):
            pid = c[2:4]
            d = self._pid(pid)
            return [_hex([0x42, int(pid, 16), 0] + d)] if d is not None and self.dtcs else ['NO DATA']
        if c == '0900':
            return [_hex([0x49, 0x00, 0x55, 0x40, 0x00, 0x00])]
        if c == '0902':
            return _isotp(bytes([0x49, 0x02, 0x01]) + VIN.encode())
        if c == '0904':
            return _isotp(bytes([0x49, 0x04, 0x01]) + CALID.encode().ljust(16, b'\0'))
        if c == '0906':
            return _isotp(bytes([0x49, 0x06, 0x01, 0xDE, 0xAD, 0xBE, 0xEF]))
        if c == '090A':
            return _isotp(bytes([0x49, 0x0A, 0x01]) + b'ECM-EngineControl\0\0\0')
        if c == '0600':
            return [_hex([0x46, 0x00, 0xC0, 0x00, 0x00, 0x01])]
        if c == '0601':
            return _isotp(bytes([0x46, 0x01, 0x01, 0x0B, 0x01, 0x00, 0x00, 0x10, 0x03, 0x00,
                                 0x02, 0x0B, 0x00, 0x20, 0x00, 0x00, 0x00, 0x30]))
        if c.startswith('06'):
            return ['NO DATA']
        # ham servisler (UDS)
        if re.fullmatch(r'([0-9A-F]{2})+', c):
            return self._uds(bytes.fromhex(c))
        return ['?']

    def _at(self, c):
        if c == 'ATZ':
            self.echo = True
            return ['', 'ELM327 v1.5']
        if c == 'ATE0':
            self.echo = False
        if c == 'ATE1':
            self.echo = True
        if c == 'ATI':
            return ['ELM327 v1.5']
        if c == 'ATRV':
            return [f'{self.battery:.1f}V']
        if c == 'ATDPN':
            return ['A6']
        if c.startswith('ATSH'):
            self.header = c[4:]
        return ['OK']

    def _uds(self, d):
        sid = d[0]
        if sid == 0x10:
            self.session = d[1]
            return _isotp(bytes([0x50, d[1], 0x00, 0x32, 0x01, 0xF4]))
        if sid == 0x3E:
            return ['7E00']
        if sid == 0x22 and len(d) >= 3:
            did = (d[1] << 8) | d[2]
            if did in self.dids:
                return _isotp(bytes([0x62, d[1], d[2]]) + self.dids[did])
            return _isotp(bytes([0x7F, 0x22, 0x31]))
        if sid == 0x2E and len(d) >= 4:
            did = (d[1] << 8) | d[2]
            if did not in self.dids:
                return _isotp(bytes([0x7F, 0x2E, 0x31]))
            if self.session != 3:
                return _isotp(bytes([0x7F, 0x2E, 0x7F]))
            self.dids[did] = d[3:]
            return _isotp(bytes([0x6E, d[1], d[2]]))
        if sid == 0x19:
            return _isotp(bytes([0x59, 0x02, 0xFF]))
        return _isotp(bytes([0x7F, sid, 0x11]))
