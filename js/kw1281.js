// VAG KW1281 (K-hattı) protokolü — yalnızca OKUMA: kimlik, arıza kodları, ölçüm blokları.
// io: { fiveBaud(addr), read(timeoutMs) -> bayt|null, write(bayt), flush() }
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class KWError extends Error {}

// Blok başlıkları
const T = { ACK: 0x09, NAK: 0x0a, END: 0x06, ASCII: 0xf6, FAULTS_REQ: 0x07, FAULTS: 0xfc, GROUP_REQ: 0x29, GROUP: 0xe7 };

export class KW1281 {
  constructor(io, log = () => {}) {
    this.io = io;
    this.log = log;
    this.counter = 0;
  }

  async init(addr) {
    await this.io.flush();
    this.log(`5 baud başlatma: adres 0x${hex(addr)}`);
    await this.io.fiveBaud(addr);
    const sync = await this.io.read(1500);
    if (sync == null) throw new KWError('Modül yanıt vermedi (senkron baytı gelmedi)');
    if (sync !== 0x55) throw new KWError(`Beklenmeyen senkron baytı 0x${hex(sync)} — baud hızı uyumsuz olabilir (10400/9600 deneyin)`);
    const kw1 = await this.io.read(400), kw2 = await this.io.read(400);
    if (kw1 == null || kw2 == null) throw new KWError('Anahtar kelime (keyword) alınamadı');
    this.log(`Anahtar kelime: ${hex(kw1)} ${hex(kw2)}`);
    await sleep(35);
    await this.io.write(0xff ^ kw2);
    const ia = await this.io.read(600);
    this.log(ia == null ? 'Adres yankısı gelmedi' : `Adres yankısı: 0x${hex(ia)}`);
    this.counter = 0;
    this.kw = [kw1, kw2];
    return { kw1, kw2, kw1281: kw1 === 0x01, keyword: hex(kw1) + hex(kw2) };
  }

  async recvBlock(timeout = 2000) {
    const len = await this.io.read(timeout);
    if (len == null) throw new KWError('Blok zaman aşımı');
    await this.io.write(0xff ^ len);
    const data = [];
    for (let i = 0; i < len; i++) {
      const b = await this.io.read(1000);
      if (b == null) throw new KWError('Blok ortasında zaman aşımı');
      data.push(b);
      if (i < len - 1) await this.io.write(0xff ^ b);
    }
    if (data[len - 1] !== 0x03) throw new KWError('Blok sonu 0x03 değil');
    this.counter = data[0];
    const blk = { counter: data[0], title: data[1], body: data.slice(2, len - 1) };
    this.log(`← blok başlık 0x${hex(blk.title)} [${blk.body.map(hex).join(' ')}]`);
    return blk;
  }

  async sendBlock(title, body = []) {
    this.counter = (this.counter + 1) & 0xff;
    const frame = [body.length + 3, this.counter, title, ...body, 0x03];
    this.log(`→ blok başlık 0x${hex(title)} [${body.map(hex).join(' ')}]`);
    for (let i = 0; i < frame.length; i++) {
      await this.io.write(frame[i]);
      if (i < frame.length - 1) {
        const c = await this.io.read(1000);
        if (c == null || c !== (0xff ^ frame[i])) throw new KWError('ECU tamamlayıcı baytı hatalı/eksik');
      }
    }
  }

  // Kimlik: ECU ASCII bloklar gönderir, sonunda ACK ile oturumu bize bırakır
  async readIdent() {
    const lines = [];
    for (let n = 0; n < 20; n++) {
      const b = await this.recvBlock();
      if (b.title === T.ACK) return lines;
      if (b.title === T.ASCII) lines.push(b.body.map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('').trim());
      await this.sendBlock(T.ACK);
    }
    return lines;
  }

  // Komut gönder, ECU'nun ACK ile bitirdiği tüm blokları topla
  async command(title, body = []) {
    await this.sendBlock(title, body);
    const out = [];
    for (let n = 0; n < 40; n++) {
      const b = await this.recvBlock(3000);
      if (b.title === T.ACK) return out;
      if (b.title === T.NAK) { out.push(b); return out; }
      out.push(b);
      await this.sendBlock(T.ACK);
    }
    return out;
  }

  async readFaults() {
    const blocks = await this.command(T.FAULTS_REQ);
    const faults = [];
    for (const b of blocks) {
      if (b.title !== T.FAULTS) continue;
      for (let i = 0; i + 2 < b.body.length; i += 3) {
        const hi = b.body[i], lo = b.body[i + 1], status = b.body[i + 2];
        if (hi === 0xff && lo === 0xff) continue; // "arıza yok" göstergesi
        faults.push({ code: hi * 256 + lo, status });
      }
    }
    return faults;
  }

  async readGroup(group) {
    const blocks = await this.command(T.GROUP_REQ, [group]);
    if (blocks.some((b) => b.title === T.NAK)) return { refused: true, values: [] };
    const values = [];
    for (const b of blocks) {
      if (b.title !== T.GROUP) continue;
      for (let i = 0; i + 2 < b.body.length; i += 3) values.push({ f: b.body[i], a: b.body[i + 1], b: b.body[i + 2] });
    }
    return { refused: false, values };
  }

  async end() {
    try { await this.sendBlock(T.END); } catch { /* oturum zaten kapanmış olabilir */ }
  }
}

// VAG arıza kod numarası → P kodu (≥16384 ise)
export function vagToP(code) {
  return code >= 16384 ? 'P' + String(code - 16384).padStart(4, '0') : null;
}

// Bilinen ölçüm formülleri (a, b ham baytlar). Bilinmeyenler ham gösterilir.
const FORMULAS = {
  0x01: (a, b) => [0.2 * a * b, 'rpm'],
  0x02: (a, b) => [a * 0.002 * b, '%'],
  0x03: (a, b) => [0.002 * a * b, '°'],
  0x04: (a, b) => [Math.abs(b - 127) * 0.01 * a, '°'],
  0x05: (a, b) => [a * (b - 100) * 0.1, '°C'],
  0x06: (a, b) => [0.001 * a * b, 'V'],
  0x07: (a, b) => [0.01 * a * b, 'km/h'],
  0x08: (a, b) => [0.1 * a * b, ''],
  0x0f: (a, b) => [0.01 * a * b, 'ms'],
  0x12: (a, b) => [0.04 * a * b, 'mbar'],
};
export function decodeValue(v) {
  const f = FORMULAS[v.f];
  if (!f) return { text: `ham: F=${hex(v.f)} A=${v.a} B=${v.b}`, known: false };
  const [x, u] = f(v.a, v.b);
  return { text: `${Math.round(x * 100) / 100} ${u}`.trim(), known: true };
}

// Yaygın modül adresleri (VCDS ile aynı numaralandırma)
export const MODULES = [
  ['01', 'Motor'], ['02', 'Şanzıman'], ['03', 'ABS / frenler'], ['08', 'Klima'], ['09', 'Merkezi elektrik'],
  ['15', 'Hava yastığı'], ['16', 'Direksiyon elektroniği'], ['17', 'Gösterge paneli'], ['19', 'Gateway (CAN)'],
  ['25', 'İmmobilizer'], ['34', 'Seviye kontrol'], ['36', 'Sürücü koltuğu'], ['37', 'Navigasyon'], ['44', 'Direksiyon yardımı'],
  ['45', 'İç mekan izleme'], ['46', 'Konfor sistemi'], ['55', 'Far menzil'], ['56', 'Radyo'], ['5F', 'Bilgi/eğlence'],
];
