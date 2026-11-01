"""CAN hattini dinler (hicbir sey GONDERMEZ), kare kare CSV'ye yazar ve kimlik ozeti verir.

Kullanim (CANable slcan yazilimiyla, COM port):
    python tools/can_sniff.py --channel COM5 --seconds 20
candleLight yazilimiyla (Zadig/libusb gerekir):
    python tools/can_sniff.py --interface gs_usb --channel 0 --seconds 20
Deneme (adaptor yok): python tools/can_sniff.py --virtual
Gerekir: pip install python-can   (gs_usb icin: pip install "python-can[gs_usb]")
"""
import argparse
import collections
import csv
import os
import time

import can


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--interface', default='slcan')
    ap.add_argument('--channel', default='COM5')
    ap.add_argument('--bitrate', type=int, default=500000)
    ap.add_argument('--seconds', type=float, default=20)
    ap.add_argument('--virtual', action='store_true', help='adaptorsuz kendi kendine deneme')
    a = ap.parse_args()

    if a.virtual:
        bus = can.Bus(interface='virtual', channel='sniff')
        tx = can.Bus(interface='virtual', channel='sniff')
        for i in range(5):
            tx.send(can.Message(arbitration_id=0x200 + i, data=[i, 1, 2, 3], is_extended_id=False))
    else:
        bus = can.Bus(interface=a.interface, channel=a.channel, bitrate=a.bitrate)
    out = os.path.join(os.path.expanduser('~'), 'pyobd_kayitlar')
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, 'can_' + time.strftime('%Y%m%d_%H%M%S') + '.csv')
    counts, first = collections.Counter(), {}
    n = 0
    t0 = time.time()
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['sure_sn', 'kimlik', 'uzunluk', 'veri'])
        while time.time() - t0 < a.seconds:
            m = bus.recv(0.2)
            if m is None:
                if a.virtual and n >= 5:
                    break
                continue
            n += 1
            counts[m.arbitration_id] += 1
            first.setdefault(m.arbitration_id, m.data.hex().upper())
            w.writerow([f'{m.timestamp - t0:.4f}'.replace('.', ',') if m.timestamp else '', f'{m.arbitration_id:03X}', m.dlc, m.data.hex().upper()])
    bus.shutdown()
    print(f'{n} kare, {len(counts)} farkli kimlik -> {path}')
    for i, c in counts.most_common(30):
        print(f'  {i:03X}  {c:6d} kare   ornek: {first[i]}')


if __name__ == '__main__':
    main()
