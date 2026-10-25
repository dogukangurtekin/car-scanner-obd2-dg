// Aktarım arayüzü: open(), write(str), close(), onData(str), onClose()

export class SerialTransport {
  constructor({ baud = 38400 } = {}) {
    this.baud = baud;
    this.onData = () => {};
    this.onClose = () => {};
  }
  static get supported() { return 'serial' in navigator; }
  async open() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baud });
    this.writer = this.port.writable.getWriter();
    this.reading = true;
    this._read();
  }
  async _read() {
    const dec = new TextDecoder();
    while (this.port.readable && this.reading) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.onData(dec.decode(value, { stream: true }));
        }
      } catch { break; } finally { this.reader.releaseLock(); }
    }
    if (this.reading) this.onClose();
  }
  async write(s) { await this.writer.write(new TextEncoder().encode(s)); }
  async close() {
    this.reading = false;
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port.close(); } catch {}
  }
}

export class BleTransport {
  constructor() {
    this.onData = () => {};
    this.onClose = () => {};
  }
  static get supported() { return 'bluetooth' in navigator; }
  async open() {
    const u = (x) => `0000${x}-0000-1000-8000-00805f9b34fb`;
    const svc = [u('fff0'), u('ffe0'), u('18f0'), u('ae00'), u('ff00'), 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455', '6e400001-b5a3-f393-e0a9-e50e24dcca9e'];
    const attempts = [
      { acceptAllDevices: true, optionalServices: svc },
      { acceptAllDevices: true, optionalServices: svc.slice(0, 3) },
      { filters: svc.map((s) => ({ services: [s] })), optionalServices: svc },
      { filters: ['OBD', 'ELM', 'V-LINK', 'VLINK', 'Vgate', 'IOS', 'CAN', 'Carista', 'Viecar', 'KONNWEI', 'BLE'].map((namePrefix) => ({ namePrefix })), optionalServices: svc },
    ];
    let lastErr;
    this.step = 'cihaz seçimi (requestDevice)';
    for (const [i, opt] of attempts.entries()) {
      try { this.dev = await navigator.bluetooth.requestDevice(opt); this.attempt = i + 1; lastErr = null; break; }
      catch (e) { lastErr = e; if (!/pars|payload|TypeError/i.test(e.name + ' ' + e.message)) break; }
    }
    if (lastErr) throw lastErr;
    this.dev.addEventListener('gattserverdisconnected', () => this.onClose());
    this.step = 'GATT bağlantısı';
    const server = await this.dev.gatt.connect();
    let rx = null, tx = null;
    const seen = [];
    this.step = 'servis arama';
    let services = [];
    try { services = await server.getPrimaryServices(); } catch {}
    if (!services.length) {
      for (const id of svc) { try { services.push(await server.getPrimaryService(id)); } catch {} }
    }
    this.step = 'karakteristik okuma';
    for (const sv of services) {
      for (const ch of await sv.getCharacteristics()) {
        const p = ch.properties;
        seen.push(`${sv.uuid.slice(4, 8)}/${ch.uuid.slice(4, 8)}[${['notify', 'indicate', 'write', 'writeWithoutResponse'].filter((k) => p[k]).join(',')}]`);
        if (!rx && (p.notify || p.indicate)) rx = ch;
        if (!tx && (p.write || p.writeWithoutResponse)) tx = ch;
      }
      if (rx && tx) break;
    }
    if (!rx || !tx) throw new Error('Uygun BLE servis/karakteristik bulunamadı. Bulunanlar: ' + (seen.join(' ') || 'yok'));
    this.tx = tx;
    const dec = new TextDecoder();
    rx.addEventListener('characteristicvaluechanged', (e) => this.onData(dec.decode(e.target.value)));
    this.step = 'bildirim açma (startNotifications)';
    await rx.startNotifications();
    this.step = 'hazır';
  }
  async write(s) {
    const data = new TextEncoder().encode(s);
    for (let i = 0; i < data.length; i += 20) {
      const chunk = data.slice(i, i + 20);
      if (this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
      else await this.tx.writeValue(chunk);
    }
  }
  async close() { try { this.dev?.gatt?.disconnect(); } catch {} }
}

// ---- Demo: ELM327 + Golf 5 1.6 FSI taklidi ----
const SIM_PIDS = ['01', '04', '05', '06', '07', '0B', '0C', '0D', '0E', '0F', '10', '11', '1F', '21', '24', '2F', '31', '33', '42', '43', '46'];
const hex = (n, w = 2) => Math.max(0, Math.round(n)).toString(16).toUpperCase().padStart(w, '0').slice(-w);

function supportMask(base) {
  let m = 0;
  for (let p = base + 1; p <= base + 0x20; p++) if (SIM_PIDS.includes(hex(p))) m |= 1 << (32 - (p - base));
  if (SIM_PIDS.some((x) => parseInt(x, 16) > base + 0x20)) m |= 1;
  return hex(m >>> 0, 8);
}

export class SimTransport {
  constructor() {
    this.onData = () => {};
    this.onClose = () => {};
    this.buf = '';
    this.t0 = performance.now();
    this.dtcCleared = false;
  }
  async open() {}
  async close() {}
  car() {
    const t = (performance.now() - this.t0) / 1000;
    const spd = (x) => Math.max(0, 55 + 45 * Math.sin(x / 12) + 12 * Math.sin(x / 3.1) - 8);
    const speed = spd(t);
    const acc = spd(t + 1) - speed;
    const throttle = Math.min(90, Math.max(10, 14 + acc * 3 + speed * 0.15));
    const rpm = speed < 2 ? 820 + 20 * Math.sin(t * 3) : 900 + speed * 28 + 200 * Math.sin(t / 2);
    const load = Math.min(95, 20 + throttle * 0.6);
    return {
      speed, rpm, throttle, load,
      map: 30 + load * 0.7,
      maf: rpm * load * 0.00028,
      coolant: Math.min(91, 40 + t * 0.4),
      iat: 28 + Math.min(10, t / 30),
      volt: 14.1 + 0.1 * Math.sin(t),
      fuel: 62 - t / 600,
      ign: 12 + throttle * 0.2,
      stft: 3 * Math.sin(t / 5), ltft: 4.5, t,
    };
  }
  async write(s) {
    this.buf += s;
    let i;
    while ((i = this.buf.indexOf('\r')) >= 0) {
      const c = this.buf.slice(0, i).trim().toUpperCase().replace(/ /g, '');
      this.buf = this.buf.slice(i + 1);
      setTimeout(() => this.onData(this.reply(c) + '\r\r>'), 30 + Math.random() * 40);
    }
  }
  reply(c) {
    if (c === 'ATZ' || c === 'ATI') return 'ELM327 v1.5';
    if (c === 'ATDPN') return 'A6';
    if (c === 'ATRV') return this.car().volt.toFixed(1) + 'V';
    if (c.startsWith('AT')) return 'OK';
    if (c === '0902') return '014\r0: 49 02 01 57 56 57\r1: 5A 5A 5A 31 4B 5A 36\r2: 57 30 30 30 30 30 30';
    if (c === '03') return this.dtcCleared ? '4300' : '43010171 0000 00';
    if (c === '04') { this.dtcCleared = true; return '44'; }
    if (c.length === 5 && c.startsWith('01')) c = c.slice(0, 4); // hızlı mod son haneyi at
    if (c.length !== 4 || !c.startsWith('01')) return '?';
    const id = c.slice(2);
    if (['00', '20', '40', '60'].includes(id)) return '41' + id + supportMask(parseInt(id, 16));
    if (!SIM_PIDS.includes(id)) return 'NO DATA';
    const k = this.car();
    const p = '41' + id;
    const u16 = (v) => hex(v, 4);
    switch (id) {
      case '01': return p + (this.dtcCleared ? '00' : '81') + '076500';
      case '04': return p + hex(k.load * 2.55);
      case '05': return p + hex(k.coolant + 40);
      case '06': return p + hex((k.stft + 100) * 1.28);
      case '07': return p + hex((k.ltft + 100) * 1.28);
      case '0B': return p + hex(k.map);
      case '0C': return p + u16(k.rpm * 4);
      case '0D': return p + hex(k.speed);
      case '0E': return p + hex((k.ign + 64) * 2);
      case '0F': return p + hex(k.iat + 40);
      case '10': return p + u16(k.maf * 100);
      case '11': return p + hex(k.throttle * 2.55);
      case '1F': return p + u16(k.t);
      case '21': return p + u16(this.dtcCleared ? 0 : 120);
      case '24': return p + u16(32768 + 600 * Math.sin(k.t / 4)) + '0000'.slice(0, 0);
      case '2F': return p + hex(k.fuel * 2.55);
      case '31': return p + u16(this.dtcCleared ? 3 : 1234);
      case '33': return p + hex(99);
      case '42': return p + u16(k.volt * 1000);
      case '43': return p + u16(k.load * 2.55);
      case '46': return p + hex(18 + 40);
      default: return 'NO DATA';
    }
  }
}
