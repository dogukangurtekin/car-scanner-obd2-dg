"""Canlı veri CSV kaydı (Excel Türkçe: ';' ayırıcı, ondalık virgül, UTF-8 BOM)."""
import csv
import os
import time


class CsvLogger:
    def __init__(self, defs, folder=None):
        self.defs = defs
        folder = folder or os.path.join(os.path.expanduser('~'), 'pyobd_kayitlar')
        os.makedirs(folder, exist_ok=True)
        self.path = os.path.join(folder, 'canli_' + time.strftime('%Y%m%d_%H%M%S') + '.csv')
        self.f = open(self.path, 'w', newline='', encoding='utf-8-sig')
        self.w = csv.writer(self.f, delimiter=';')
        self.w.writerow(['zaman', 'sure_sn'] + [f"{p['name']} ({p['unit']})" if p['unit'] else p['name'] for p in defs])
        self.t0 = time.time()
        self.rows = 0
        self.last = {}

    def add(self, values: dict):
        """Her çağrıda tek satır; o turda okunmayan değerler son bilinen değerle doldurulur (veri kaybı olmasın)."""
        self.last.update(values)
        now = time.time()
        row = [time.strftime('%H:%M:%S', time.localtime(now)), f'{now - self.t0:.2f}'.replace('.', ',')]
        for p in self.defs:
            v = self.last.get(p['key'])
            row.append('' if v is None else (str(round(v, 4)).replace('.', ',')))
        self.w.writerow(row)
        self.rows += 1
        if self.rows % 20 == 0:
            self.f.flush()

    def close(self):
        try:
            self.f.close()
        except Exception:
            pass
