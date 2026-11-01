"""pyobd arayüzü (tkinter). Çalıştırma: python -m pyobd"""
import queue
import threading
import time
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from . import __version__
from .elm import ELM, ELMError, to_hex
from .link import SerialLink, TcpLink, list_ports
from .logger import CsvLogger
from .obd import PID_BY_KEY, Obd, alert_of, dtc_describe, fmt
from .uds import PRESETS, UDS, UDSError, classify

PROTOCOLS = [('Otomatik', '0'), ('ISO 15765 CAN 11bit 500k (Golf 5 OBD2)', '6'), ('ISO 15765 CAN 29bit 500k', '7'),
             ('ISO 14230 KWP hızlı', '5'), ('ISO 14230 KWP yavaş (5 baud)', '4'), ('ISO 9141-2', '3')]
CONFIRM_WORD = 'ONAYLIYORUM'


class App(tk.Tk):
    def __init__(self, sim_autoconnect=False):
        super().__init__()
        self.title(f'pyobd {__version__} — ELM327 tanı')
        self.geometry('1050x700')
        self.elm = self.obd = self.uds = None
        self.big = threading.RLock()       # aynı anda tek komut dizisi (başlık değişimi canlı okumayı bozmasın)
        self.ui_q = queue.Queue()
        self.live = False
        self.logger = None
        self.hist = {}
        self.defs = []
        self._build()
        self.after(50, self._pump)
        self.protocol('WM_DELETE_WINDOW', self._close)
        if sim_autoconnect:
            self.mode.set('sim')
            self.after(200, self.connect)

    # ---------- altyapı ----------
    def bg(self, fn, ok=None, err=None):
        def run():
            try:
                with self.big:
                    r = fn()
                self.ui_q.put((ok, r))
            except Exception as e:  # noqa: BLE001
                self.ui_q.put((err or self._show_err, e))
        threading.Thread(target=run, daemon=True).start()

    def _pump(self):
        try:
            while True:
                cb, arg = self.ui_q.get_nowait()
                if cb:
                    cb(arg)
        except queue.Empty:
            pass
        self.after(50, self._pump)

    def _show_err(self, e):
        self.status.set('Hata: ' + str(e))
        messagebox.showerror('Hata', str(e))

    def log(self, kind, text):
        self.ui_q.put((lambda a: self._log_line(*a), (kind, text)))

    def _log_line(self, kind, text):
        self.logbox.insert('end', f'{time.strftime("%H:%M:%S")} {kind:>3}  {text}\n')
        self.logbox.see('end')

    # ---------- arayüz ----------
    def _build(self):
        self.status = tk.StringVar(value='Bağlı değil')
        nb = self.nb = ttk.Notebook(self)
        nb.pack(fill='both', expand=True)
        for name, fn in (('Bağlantı', self._tab_conn), ('Canlı veri', self._tab_live), ('Arızalar', self._tab_dtc),
                         ('Araç bilgisi', self._tab_info), ('Ham / UDS', self._tab_raw), ('Günlük', self._tab_log)):
            f = ttk.Frame(nb, padding=8)
            nb.add(f, text=name)
            fn(f)
        ttk.Label(self, textvariable=self.status, relief='sunken', anchor='w').pack(fill='x')

    def _tab_conn(self, f):
        self.mode = tk.StringVar(value='serial')
        box = ttk.LabelFrame(f, text='Bağlantı türü', padding=8)
        box.pack(fill='x')
        ttk.Radiobutton(box, text='USB / Bluetooth (COM port)', variable=self.mode, value='serial').grid(row=0, column=0, sticky='w')
        self.port = ttk.Combobox(box, width=34)
        self.port.grid(row=0, column=1, padx=4)
        ttk.Button(box, text='Yenile', command=self._refresh_ports).grid(row=0, column=2)
        self.baud = ttk.Combobox(box, width=8, values=['38400', '115200', '9600', '57600'])
        self.baud.set('38400')
        self.baud.grid(row=0, column=3, padx=4)
        ttk.Radiobutton(box, text='Wi-Fi ELM327', variable=self.mode, value='tcp').grid(row=1, column=0, sticky='w')
        self.host = ttk.Entry(box, width=20)
        self.host.insert(0, '192.168.0.10')
        self.host.grid(row=1, column=1, sticky='w', padx=4)
        self.tport = ttk.Entry(box, width=8)
        self.tport.insert(0, '35000')
        self.tport.grid(row=1, column=2, sticky='w')
        ttk.Radiobutton(box, text='Demo (sanal araç)', variable=self.mode, value='sim').grid(row=2, column=0, sticky='w')
        ttk.Label(box, text='Protokol').grid(row=3, column=0, sticky='w', pady=(8, 0))
        self.proto = ttk.Combobox(box, width=40, values=[p[0] for p in PROTOCOLS], state='readonly')
        self.proto.current(0)
        self.proto.grid(row=3, column=1, pady=(8, 0), padx=4, sticky='w')
        self.fast = tk.BooleanVar(value=True)
        ttk.Checkbutton(box, text='Hızlı sorgu (yanıt sayısı = 1)', variable=self.fast).grid(row=3, column=2, columnspan=2, pady=(8, 0))
        row = ttk.Frame(f)
        row.pack(fill='x', pady=8)
        self.btn_conn = ttk.Button(row, text='Bağlan', command=self.connect)
        self.btn_conn.pack(side='left')
        self.btn_disc = ttk.Button(row, text='Bağlantıyı kes', command=self.disconnect, state='disabled')
        self.btn_disc.pack(side='left', padx=6)
        self.info = tk.StringVar()
        ttk.Label(f, textvariable=self.info, justify='left').pack(anchor='w')
        ttk.Label(f, justify='left', foreground='#555', wraplength=950, text=(
            'İpucu: Bluetooth ELM327 Windows’ta eşleştirilince bir COM port oluşturur (Aygıt Yöneticisi → Bağlantı Noktaları). '
            'Wi-Fi ELM327 için bilgisayarı adaptörün Wi-Fi ağına bağlayın (genelde 192.168.0.10:35000). '
            'Kontağı açın (motor çalışmayabilir) ve sonra bağlanın.')).pack(anchor='w', pady=8)
        self._refresh_ports()

    def _refresh_ports(self):
        ports = list_ports()
        self.port['values'] = [f'{d} — {desc}' for d, desc in ports]
        if ports and not self.port.get():
            self.port.current(0)

    def _tab_live(self, f):
        top = ttk.Frame(f)
        top.pack(fill='x')
        self.btn_live = ttk.Button(top, text='▶ Seçilenleri başlat', command=self.toggle_live, state='disabled')
        self.btn_live.pack(side='left')
        self.rec = tk.BooleanVar()
        ttk.Checkbutton(top, text='CSV’ye kaydet', variable=self.rec).pack(side='left', padx=10)
        self.alert = tk.StringVar()
        ttk.Label(top, textvariable=self.alert, foreground='#c00').pack(side='left', padx=10)
        mid = ttk.Frame(f)
        mid.pack(fill='both', expand=True, pady=6)
        cols = ('ad', 'deger', 'birim')
        self.tree = ttk.Treeview(mid, columns=cols, show='headings', selectmode='extended', height=18)
        for c, t, w in (('ad', 'Değer', 280), ('deger', 'Şimdi', 110), ('birim', 'Birim', 60)):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor='w' if c == 'ad' else 'e')
        self.tree.tag_configure('warn', background='#fff3c4')
        self.tree.tag_configure('crit', background='#ffc9c9')
        self.tree.pack(side='left', fill='y')
        self.tree.bind('<<TreeviewSelect>>', lambda e: self._draw())
        self.canvas = tk.Canvas(mid, bg='#101820', highlightthickness=0)
        self.canvas.pack(side='left', fill='both', expand=True, padx=(8, 0))
        self.canvas.bind('<Configure>', lambda e: self._draw())

    def _tab_dtc(self, f):
        bar = ttk.Frame(f)
        bar.pack(fill='x')
        for t, c in (('Arıza kodlarını oku', self.read_dtcs), ('Arıza kodlarını sil…', self.clear_dtcs),
                     ('Freeze frame', self.read_ff), ('Hazırlık durumu (monitörler)', self.read_ready)):
            ttk.Button(bar, text=t, command=c).pack(side='left', padx=(0, 6))
        self.dtc_text = tk.Text(f, wrap='word', height=30)
        self.dtc_text.pack(fill='both', expand=True, pady=6)

    def _tab_info(self, f):
        bar = ttk.Frame(f)
        bar.pack(fill='x')
        ttk.Button(bar, text='Araç bilgilerini oku (VIN, kalibrasyon, ECU)', command=self.read_info).pack(side='left')
        ttk.Button(bar, text='Mode 06 test sonuçları', command=self.read_m6).pack(side='left', padx=6)
        self.info_text = tk.Text(f, wrap='word')
        self.info_text.pack(fill='both', expand=True, pady=6)

    def _tab_raw(self, f):
        g = ttk.LabelFrame(f, text='Ham servis (CAN / ISO-TP)', padding=8)
        g.pack(fill='x')
        ttk.Label(g, text='Başlık (ATSH)').grid(row=0, column=0)
        self.hdr = ttk.Entry(g, width=8)
        self.hdr.insert(0, '7E0')
        self.hdr.grid(row=0, column=1, padx=4)
        ttk.Label(g, text='Yanıt filtresi (ATCRA)').grid(row=0, column=2)
        self.rx = ttk.Entry(g, width=8)
        self.rx.insert(0, '7E8')
        self.rx.grid(row=0, column=3, padx=4)
        ttk.Label(g, text='Veri (hex)').grid(row=1, column=0, pady=6)
        self.dat = ttk.Entry(g, width=40)
        self.dat.grid(row=1, column=1, columnspan=3, sticky='we', padx=4)
        ttk.Button(g, text='Gönder', command=self.send_raw).grid(row=1, column=4, padx=4)
        self.preset = ttk.Combobox(g, width=34, values=[p[0] for p in PRESETS], state='readonly')
        self.preset.grid(row=2, column=1, columnspan=3, sticky='w', padx=4)
        self.preset.bind('<<ComboboxSelected>>', lambda e: (self.dat.delete(0, 'end'), self.dat.insert(0, dict(PRESETS)[self.preset.get()])))
        ttk.Label(g, text='Hazır sorgu').grid(row=2, column=0)
        w = ttk.LabelFrame(f, text='DID yaz (yedekle → yaz → geri oku → doğrula)', padding=8)
        w.pack(fill='x', pady=8)
        ttk.Label(w, text='DID (hex, 4 hane)').grid(row=0, column=0)
        self.did = ttk.Entry(w, width=8)
        self.did.grid(row=0, column=1, padx=4)
        ttk.Label(w, text='Yeni değer (hex)').grid(row=0, column=2)
        self.val = ttk.Entry(w, width=34)
        self.val.grid(row=0, column=3, padx=4)
        ttk.Button(w, text='Güvenli yaz…', command=self.write_did).grid(row=0, column=4, padx=4)
        a = ttk.LabelFrame(f, text='AT komutu (ELM327)', padding=8)
        a.pack(fill='x')
        self.at = ttk.Entry(a, width=30)
        self.at.grid(row=0, column=0, padx=4)
        ttk.Button(a, text='Gönder', command=self.send_at).grid(row=0, column=1)
        self.raw_out = tk.Text(f, height=16)
        self.raw_out.pack(fill='both', expand=True, pady=6)

    def _tab_log(self, f):
        self.logbox = tk.Text(f, font=('Consolas', 9))
        self.logbox.pack(fill='both', expand=True)

    # ---------- bağlantı ----------
    def connect(self):
        mode = self.mode.get()
        self.btn_conn.config(state='disabled')
        self.status.set('Bağlanılıyor…')
        proto = dict(PROTOCOLS)[self.proto.get()]
        # tkinter nesnelerine yalnızca ana iş parçacığından erişilir
        port, baud, host, tport, fast = (self.port.get().split(' — ')[0].strip(), self.baud.get(), self.host.get().strip(),
                                         self.tport.get(), self.fast.get())

        def work():
            if mode == 'serial':
                if not port:
                    raise ELMError('COM port seçin')
                link = SerialLink(port, int(baud))
            elif mode == 'tcp':
                link = TcpLink(host, int(tport))
            else:
                from .sim import SimLink
                link = SimLink()
            elm = ELM(link, self.log)
            try:
                elm.init(proto, fast)
                vin = ''
                try:
                    vin = Obd(elm).read_vin()
                except Exception:  # noqa: BLE001
                    pass
            except Exception:
                elm.close()
                raise
            return elm, vin

        def ok(r):
            self.elm, vin = r
            self.obd, self.uds = Obd(self.elm), UDS(self.elm)
            self.btn_disc.config(state='normal')
            self.btn_live.config(state='normal')
            i = self.elm.info
            self.info.set(f"Adaptör: {i.get('elm', '?')}\nProtokol kodu: {i.get('protocol', '?')}   Akü: {i.get('voltage')} V\n"
                          f"VIN: {vin or '—'}\nDesteklenen PID sayısı: {len(self.elm.supported)}")
            self.status.set('Bağlı')
            self._fill_tree()
            self.nb.select(1)

        def err(e):
            self.btn_conn.config(state='normal')
            self._show_err(e)

        self.bg(work, ok, err)

    def disconnect(self):
        self.live = False
        if self.logger:
            self.logger.close()
            self.logger = None

        def work():
            self.elm.close()

        def done(_):
            self.elm = self.obd = self.uds = None
            self.btn_conn.config(state='normal')
            self.btn_disc.config(state='disabled')
            self.btn_live.config(state='disabled')
            self.tree.delete(*self.tree.get_children())
            self.status.set('Bağlı değil')
        self.bg(work, done)

    def _close(self):
        self.live = False
        try:
            if self.elm:
                self.elm.close()
        finally:
            self.destroy()

    # ---------- canlı veri ----------
    def _fill_tree(self):
        self.defs = self.obd.supported_defs()
        self.tree.delete(*self.tree.get_children())
        for p in self.defs:
            self.tree.insert('', 'end', iid=p['key'], values=(p['name'], '—', p['unit']))
        for k in ('0C', '0D', '05', '04'):
            if self.tree.exists(k):
                self.tree.selection_add(k)
        self.hist = {p['key']: [] for p in self.defs}

    def toggle_live(self):
        if self.live:
            self.live = False
            self.btn_live.config(text='▶ Seçilenleri başlat')
            if self.logger:
                self.status.set(f'Kayıt: {self.logger.path} ({self.logger.rows} satır)')
                self.logger.close()
                self.logger = None
            return
        keys = list(self.tree.selection())
        if not keys:
            return messagebox.showinfo('Canlı veri', 'Soldan en az bir değer seçin (Ctrl/Shift ile çoklu).')
        defs = [PID_BY_KEY[k] for k in keys]
        if self.rec.get():
            self.logger = CsvLogger(defs)
        self.live = True
        self.btn_live.config(text='■ Durdur')

        def loop():
            while self.live and self.elm:
                try:
                    with self.big:
                        vals = self.obd.read_many(defs)
                    self.ui_q.put((self._on_values, vals))
                    if self.logger:
                        self.logger.add(vals)
                except Exception as e:  # noqa: BLE001
                    self.live = False
                    self.ui_q.put((lambda x: (self.btn_live.config(text='▶ Seçilenleri başlat'), self._show_err(x)), e))
                time.sleep(0.02)
        threading.Thread(target=loop, daemon=True).start()

    def _on_values(self, vals):
        msgs = []
        for k, v in vals.items():
            p = PID_BY_KEY[k]
            a = alert_of(p['key'], v)
            self.tree.item(k, values=(p['name'], fmt(p, v), p['unit']), tags=(a['level'],) if a else ())
            if a:
                msgs.append(a['msg'])
            h = self.hist.setdefault(k, [])
            h.append(v)
            del h[:-300]
        self.alert.set(' | '.join(msgs))
        self._draw()

    def _draw(self):
        c = self.canvas
        c.delete('all')
        sel = self.tree.selection()
        if not sel:
            return
        k = sel[-1]
        p = PID_BY_KEY.get(k)
        h = [x for x in self.hist.get(k, []) if x is not None]
        w, hh = c.winfo_width(), c.winfo_height()
        c.create_text(10, 10, anchor='nw', fill='#9fb3c8', text=f"{p['name']} ({p['unit']})")
        if len(h) < 2:
            return
        lo, hi = min(h), max(h)
        if hi - lo < 1e-9:
            hi = lo + 1
        pts = []
        for i, v in enumerate(h):
            pts += [20 + i * (w - 40) / (len(h) - 1), hh - 20 - (v - lo) / (hi - lo) * (hh - 60)]
        c.create_line(*pts, fill='#3fb6ff', width=2, smooth=True)
        c.create_text(w - 10, 10, anchor='ne', fill='#e6edf3', text=f'{fmt(p, h[-1])}  (min {fmt(p, lo)}, maks {fmt(p, hi if hi != lo + 1 else lo)})')

    # ---------- arızalar ----------
    def _put(self, widget, text):
        widget.delete('1.0', 'end')
        widget.insert('end', text)

    def read_dtcs(self):
        def work():
            out = {}
            for m, n in (('03', 'Kayıtlı'), ('07', 'Bekleyen'), ('0A', 'Kalıcı')):
                try:
                    out[n] = self.obd.read_dtcs(m)
                except Exception:  # noqa: BLE001
                    out[n] = None
            return out

        def ok(r):
            lines = []
            for n, codes in r.items():
                lines.append(f'== {n} arıza kodları ==')
                if codes is None:
                    lines.append('  Araç desteklemiyor / yanıt yok')
                elif not codes:
                    lines.append('  Yok')
                else:
                    lines += [f'  {c}  {dtc_describe(c)}' for c in codes]
            self._put(self.dtc_text, '\n'.join(lines))
        self.bg(work, ok)

    def clear_dtcs(self):
        if not messagebox.askyesno('Arıza kodlarını sil', 'Mode 04 gönderilecek.\n\n• Kayıtlı arıza kodları ve freeze frame silinir\n'
                                   '• Hazırlık (readiness) monitörleri sıfırlanır; muayene için sürüş döngüsü gerekir\n'
                                   '• Arıza nedeni giderilmediyse kod geri gelir\n\nDevam edilsin mi?'):
            return
        self.bg(lambda: (self.uds._journal('7DF', '04', None, 'OBD2 mod 04 arıza silme'), self.obd.clear_dtcs())[1],
                lambda r: (self._put(self.dtc_text, 'Silme ' + ('başarılı' if r[0] else 'yanıtı alınamadı: ' + ' '.join(r[1]))), None)[1])

    def read_ff(self):
        ids = [p['id'] for p in self.defs if p['key'] == p['id']][:20]

        def ok(r):
            dtc, vals = r
            lines = [f'Tetikleyen kod: {dtc} — {dtc_describe(dtc)}' if dtc else 'Donmuş veri yok (kayıtlı arıza yoksa normaldir).']
            for i, b in vals.items():
                p = next((x for x in self.defs if x['id'] == i and x['key'] == i), None)
                if p:
                    try:
                        lines.append(f"  {p['name']}: {fmt(p, p['f'](*b[:4]))} {p['unit']}")
                    except Exception:  # noqa: BLE001
                        lines.append(f"  {p['name']}: {to_hex(b)}")
            self._put(self.dtc_text, '\n'.join(lines))
        self.bg(lambda: self.obd.read_freeze_frame(ids), ok)

    def read_ready(self):
        def ok(b):
            if not b:
                return self._put(self.dtc_text, 'Durum okunamadı.')
            s = Obd.decode_status(b)
            lines = [f"MIL (motor arıza lambası): {'YANIYOR' if s['mil'] else 'sönük'}   Kayıtlı kod sayısı: {s['count']}", '']
            lines += [f"  {'✔ tamamlandı' if done else '… tamamlanmadı'}  {n}" for n, done in s['monitors']]
            self._put(self.dtc_text, '\n'.join(lines))
        self.bg(lambda: self.obd.read_status('01'), ok)

    # ---------- araç bilgisi ----------
    def read_info(self):
        def work():
            r = {'Adaptör': self.elm.info.get('elm'), 'Protokol': self.elm.info.get('protocol'),
                 'Akü gerilimi': f"{self.elm.refresh_voltage()} V", 'VIN': self.obd.read_vin()}
            for pid, n in (('04', 'Kalibrasyon ID'), ('06', 'CVN'), ('0A', 'ECU adı')):
                try:
                    r[n] = self.obd.read_info(pid)
                except Exception:  # noqa: BLE001
                    r[n] = None
            r['Desteklenen PID'] = ' '.join(sorted(self.elm.supported))
            return r
        self.bg(work, lambda r: self._put(self.info_text, '\n'.join(f'{k}: {v or "—"}' for k, v in r.items())))

    def read_m6(self):
        def ok(rows):
            lines = ['MID TID Birim  Değer  Min    Maks   Sonuç']
            for r in rows:
                s = '—' if r['ok'] is None else 'GEÇTİ' if r['ok'] else 'KALDI'
                lines.append(f"{r['mid']}  {r['tid']}  {r['uas']}   {r['val']:<6} {r['min']:<6} {r['max']:<6} {s}")
            self._put(self.info_text, '\n'.join(lines) if rows else 'Araç Mode 06 desteklemiyor.')
        self.bg(self.obd.read_mode06, ok)

    # ---------- ham / UDS ----------
    def _out(self, text):
        self.raw_out.insert('end', text + '\n')
        self.raw_out.see('end')

    def send_raw(self):
        data = self.dat.get().strip()
        if not data:
            return
        try:
            sid, name, write = classify(bytes.fromhex(data.replace(' ', '')))
        except ValueError:
            return messagebox.showerror('Hata', 'Veri hex olmalı (örn. 22F190)')
        hdr, rx = self.hdr.get().strip() or None, self.rx.get().strip() or None
        if write:
            ans = simpledialog.askstring('Yazma sınıfı servis', f'{sid:02X} — {name}\n\nBu servis kontrol cihazının durumunu veya belleğini '
                                         f'değiştirebilir. Aküde şarj cihazı olduğundan ve bunun ne yaptığını bildiğinizden emin olun.\n\n'
                                         f'Devam için {CONFIRM_WORD} yazın:')
            if (ans or '').strip().upper() != CONFIRM_WORD:
                return self._out('İptal edildi.')
            fn = lambda: self.uds.send_write(data, hdr or self.uds.header, rx)  # noqa: E731
        else:
            fn = lambda: self.uds.send(data, hdr, rx)  # noqa: E731
        self._out(f'> [{hdr}] {data}  ({name})')
        self.bg(fn, lambda r: self._out('< ' + r.describe() + (f"  (satırlar: {' | '.join(r.lines)})" if r.payload is None else '')))

    def write_did(self):
        try:
            did = int(self.did.get(), 16)
            value = bytes.fromhex(self.val.get().replace(' ', ''))
        except ValueError:
            return messagebox.showerror('Hata', 'DID ve değer hex olmalı.')
        hdr, rx = self.hdr.get().strip(), self.rx.get().strip() or None
        ans = simpledialog.askstring('Veri yaz', f'Başlık {hdr}, DID {did:04X} ← {value.hex().upper()}\n\nÖnce mevcut değer yedeklenecek, yazılacak, '
                                     f'geri okunup doğrulanacak. Yanlış değer kontrol cihazını bozabilir.\n\nDevam için {CONFIRM_WORD} yazın:')
        if (ans or '').strip().upper() != CONFIRM_WORD:
            return self._out('İptal edildi.')

        def work():
            self.uds.send('1003', hdr, rx)  # genişletilmiş oturum
            return self.uds.write_did(did, value, hdr, rx)

        def ok(r):
            self._out(f'Yazıldı ve doğrulandı. Eski değer: {r[0].hex().upper()}  Yedek dosya: {r[1]}')
        self.bg(work, ok, lambda e: self._out('HATA: ' + str(e)))

    def send_at(self):
        c = self.at.get().strip()
        if not c.upper().startswith('AT'):
            return messagebox.showinfo('AT', 'Yalnızca AT komutları (örn. ATI, ATRV, ATDP).')
        self.bg(lambda: self.elm.cmd(c, 5), lambda r: self._out(f'{c} → {" | ".join(r)}'))


def main(argv=None):
    import sys
    App(sim_autoconnect='--demo' in (argv or sys.argv)).mainloop()


if __name__ == '__main__':
    main()
