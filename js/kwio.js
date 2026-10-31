// Web Serial üzerinden K-hattı (KKL kablo) giriş/çıkışı: 5 baud başlatma, yankı (echo) ayıklama
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class KLineSerial {
  constructor({ baud = 10400, echo = 'auto', dtr = true, rts = false, log = () => {} } = {}) {
    this.baud = baud;
    this.echoMode = echo;                     // 'auto' | 'on' | 'off'
    this.echo = echo === 'on' ? true : echo === 'off' ? false : null;
    this.dtr = dtr; this.rts = rts;
    this.log = log;
    this.rx = [];
    this.waiters = [];
  }
  static get supported() { return 'serial' in navigator; }

  async pick() { this.port = await navigator.serial.requestPort(); }

  async open(baud = this.baud) {
    this.baud = baud;
    await this.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096 });
    try { await this.port.setSignals({ dataTerminalReady: this.dtr, requestToSend: this.rts, break: false }); } catch (e) { this.log('Sinyaller ayarlanamadı: ' + e.message); }
    this.writer = this.port.writable.getWriter();
    this.reading = true;
    this._readLoop();
    this.log(`Port açıldı: ${baud} baud, DTR=${this.dtr ? 1 : 0}, RTS=${this.rts ? 1 : 0}`);
  }

  async _readLoop() {
    while (this.port.readable && this.reading) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) for (const b of value) this._push(b);
        }
      } catch { break; } finally { this.reader.releaseLock(); }
    }
  }
  _push(b) {
    const w = this.waiters.shift();
    if (w) { clearTimeout(w.t); w.res(b); } else this.rx.push(b);
  }

  async close() {
    this.reading = false;
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port.setSignals({ break: false }); } catch {}
    try { await this.port.close(); } catch {}
  }
  async reopen(baud) { await this.close(); await sleep(150); this.rx = []; await this.open(baud); }

  async flush() { this.rx = []; }

  read(timeoutMs) {
    if (this.rx.length) return Promise.resolve(this.rx.shift());
    return new Promise((res) => {
      const w = { res };
      w.t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); res(null); }, timeoutMs);
      this.waiters.push(w);
    });
  }

  // Bayt gönder; KKL kabloların yankısını (echo) tüket
  async write(b) {
    await this.writer.write(Uint8Array.of(b));
    if (this.echo === false) return;
    const e = await this.read(this.echo === null ? 80 : 40);
    if (e === b) { if (this.echo === null) { this.echo = true; this.log('Kablo yankısı algılandı'); } return; }
    if (e != null) this.rx.unshift(e);
    if (this.echo === null) { this.echo = false; this.log('Kablo yankı vermiyor'); }
  }

  // 5 baud adres gönderimi: TX hattını "break" ile aşağı çekip bit bit zamanlar (7 bit + tek parite)
  async fiveBaud(addr) {
    const ones = [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => n + ((addr >> i) & 1), 0);
    const parity = ones % 2 === 0 ? 1 : 0;
    const bits = [0, ...[0, 1, 2, 3, 4, 5, 6].map((i) => (addr >> i) & 1), parity, 1]; // başlangıç, 7 veri, parite, bitiş
    await this.port.setSignals({ break: false });
    await sleep(350);
    const t0 = performance.now();
    for (let i = 0; i < bits.length; i++) {
      await this.port.setSignals({ break: bits[i] === 0 });
      const wait = t0 + (i + 1) * 200 - performance.now();
      if (wait > 0) await sleep(wait);
    }
    await this.port.setSignals({ break: false });
    this.rx = []; // başlatma sırasında oluşan yankı/çerçeve hataları
  }
}
