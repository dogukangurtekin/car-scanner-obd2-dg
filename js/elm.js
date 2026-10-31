import { PIDS, STATUS_PID } from './pids.js?v=20';
import { decodeDtcs } from './dtc.js?v=20';

const clean = (l) => l.replace(/^\d+:/, '').replace(/\s+/g, '').toUpperCase();
const hexBytes = (s) => (s.match(/../g) || []).map((h) => parseInt(h, 16));
const toHex = (b) => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

// Satırlar içinde prefix ile başlayan ilk yanıtın veri baytlarını döndürür
function findResp(lines, prefix) {
  for (const raw of lines) {
    const l = clean(raw);
    if (l.startsWith(prefix) && /^[0-9A-F]+$/.test(l)) return hexBytes(l.slice(prefix.length));
  }
  return null;
}

// Çok çerçeveli yanıtları (CAN "0:/1:" satırları veya K-line tekrarları) birleştirir
function joinResp(lines, prefix) {
  const out = [];
  let started = false;
  for (const raw of lines) {
    const l = clean(raw);
    if (!/^[0-9A-F]+$/.test(l) || /^[0-9A-F]{3}$/.test(l)) continue;
    if (l.startsWith(prefix)) { out.push(...hexBytes(l.slice(prefix.length))); started = true; }
    else if (started) out.push(...hexBytes(l));
  }
  return started ? out : null;
}

const maskIds = (b, start) => {
  const ids = [];
  const mask = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  for (let i = 1; i <= 32; i++) if (mask & (1 << (32 - i))) ids.push(start + i);
  return { ids, more: !!(mask & 1) };
};
const h2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

export class ELM {
  constructor(transport, log) {
    this.t = transport;
    this.log = log || (() => {});
    this.buf = '';
    this.waiter = null;
    this.queue = Promise.resolve();
    this.fast = true;
    this.isCAN = true;
    this.info = {};
    this.t.onData = (s) => this._onData(s);
  }

  _onData(s) {
    this.log('rx', s);
    this.buf += s;
    const i = this.buf.indexOf('>');
    if (i >= 0 && this.waiter) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const w = this.waiter;
      this.waiter = null;
      w(raw);
    }
  }

  cmd(c, timeout = 3000) {
    const run = () => new Promise((resolve, reject) => {
      this.buf = '';
      const to = setTimeout(() => { this.waiter = null; reject(new Error('Zaman aşımı: ' + c)); }, timeout);
      this.waiter = (raw) => {
        clearTimeout(to);
        const lines = raw.split(/[\r\n]+/).map((x) => x.trim())
          .filter((x) => x && x.toUpperCase() !== c.toUpperCase() && !/^SEARCHING/i.test(x));
        resolve(lines);
      };
      this.log('tx', c);
      this.t.write(c + '\r').catch((e) => { clearTimeout(to); this.waiter = null; reject(e); });
    });
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  async init({ protocol = '0', fast = true } = {}) {
    this.fast = fast;
    const z = await this.cmd('ATZ', 8000).catch(() => []);
    this.info.elm = z.find((l) => /ELM|OBD/i.test(l)) || '';
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT2', 'ATSTFF', 'ATSP' + protocol]) await this.cmd(c, 4000);
    const supported = new Set();
    let next = true;
    for (const base of ['00', '20', '40', '60']) {
      if (!next) break;
      const lines = base === '00' ? await this.firstPid(protocol) : await this.cmd('01' + base, 15000);
      const b = findResp(lines, '41' + base);
      if (!b || b.length < 4) {
        if (base === '00') throw new Error('Araca bağlanılamadı: ' + (lines.join(' ') || 'yanıt yok') + ' (kontağı açtınız mı?)');
        break;
      }
      const { ids, more } = maskIds(b, parseInt(base, 16));
      ids.forEach((n) => supported.add(h2(n)));
      next = more;
    }
    this.supported = supported;
    const dpn = (await this.cmd('ATDPN').catch(() => ['']))[0] || '';
    this.info.protocol = dpn;
    this.isCAN = /[6-9]/.test(dpn.replace(/^A/, ''));
    await this.refreshVoltage();
    return supported;
  }

  // İlk 0100 isteği; otomatik protokol başarısız olursa protokolleri tek tek dener
  async firstPid(protocol) {
    let lines = await this.cmd('0100', 20000);
    if (findResp(lines, '4100') || protocol !== '0') return lines;
    for (const p of ['7', '6', '9', '8', '5', '4', '3', '1']) {
      this.log('sys', 'Protokol deneniyor: ' + p);
      await this.cmd('ATPC', 3000).catch(() => {});
      await this.cmd('ATSP' + p, 4000);
      lines = await this.cmd('0100', 12000).catch(() => []);
      if (findResp(lines, '4100')) { this.info.forced = p; return lines; }
    }
    await this.cmd('ATSP0', 4000).catch(() => {});
    return lines;
  }

  async refreshVoltage() {
    const v = (await this.cmd('ATRV').catch(() => ['']))[0] || '';
    this.info.voltage = parseFloat(v) || null;
    return this.info.voltage;
  }

  // Mode 01 ham baytları (yanıt yoksa null)
  async readBytes(id) {
    const lines = await this.cmd('01' + id + (this.fast ? '1' : ''), 3000);
    return findResp(lines, '41' + id);
  }

  async readRaw(id) {
    const b = findResp(await this.cmd('01' + id, 3000), '41' + id);
    return b ? toHex(b) : null;
  }

  // PID 01 (MIL + monitör durumu) veya 41 (bu sürüş döngüsü): [A,B,C,D]
  async readStatusBytes(id = '01') {
    const b = findResp(await this.cmd('01' + id, 4000), '41' + id);
    return b && b.length >= 4 ? b.slice(0, 4) : null;
  }

  // Arıza kodları: '03' kayıtlı, '07' bekleyen, '0A' kalıcı
  async readDtcs(mode = '03') {
    const prefix = h2(parseInt(mode, 16) + 0x40);
    return decodeDtcs(await this.cmd(mode, 8000), this.isCAN, prefix);
  }
  async clearDtcs() { return this.cmd('04', 8000); }

  // Freeze frame (Mode 02): { dtc, values: { id: bytes } }
  async readFreezeFrame(ids) {
    const d = findResp(await this.cmd('020200', 5000), '420200');
    let dtc = null;
    if (d && d.length >= 2 && (d[0] || d[1])) dtc = decodeDtcs(['43' + toHex(d.slice(0, 2)).replace(/ /g, '')], false)[0] || null;
    const values = {};
    for (const id of ids) {
      if (id === '02') continue;
      try {
        const b = findResp(await this.cmd('02' + id + '00', 3000), '42' + id + '00');
        if (b && b.length) values[id] = b;
      } catch {}
    }
    return { dtc, values };
  }

  // Mode 06 test sonuçları → [mid, kayıtlar...] birleşik bayt dizisi
  async readMode06(onProgress) {
    const mids = [];
    for (const base of ['00', '20', '40', '60', '80', 'A0', 'C0', 'E0']) {
      const b = findResp(await this.cmd('06' + base, 5000), '46' + base);
      if (!b || b.length < 4) break;
      const { ids, more } = maskIds(b, parseInt(base, 16));
      mids.push(...ids.map(h2));
      if (!more) break;
    }
    const list = mids.filter((m) => parseInt(m, 16) % 0x20 !== 0);
    const all = [];
    for (const [i, mid] of list.entries()) {
      onProgress?.(i + 1, list.length);
      try {
        const b = joinResp(await this.cmd('06' + mid, 6000), '46' + mid);
        if (b && b.length) all.push(parseInt(mid, 16), ...b);
      } catch {}
    }
    return { mids: list, bytes: all };
  }

  // Mode 09 bilgileri (04 kalibrasyon ID, 06 CVN, 0A ECU adı)
  async readInfo(pid) {
    const b = joinResp(await this.cmd('09' + pid, 8000), '49' + pid);
    if (!b || !b.length) return null;
    const data = b[0] <= 8 ? b.slice(1) : b; // ilk bayt öğe sayısı
    if (pid === '06') return (toHex(data).match(/(?:[0-9A-F]{2} ?){1,4}/g) || []).map((s) => s.trim()).join('  ');
    const txt = data.filter((c) => c >= 32 && c < 127).map((c) => String.fromCharCode(c)).join('').trim();
    return txt || toHex(data);
  }

  async readVin() {
    const b = joinResp(await this.cmd('0902', 8000), '4902');
    if (!b) return '';
    const bytes = b[0] === 1 ? b.slice(1) : b;
    return bytes.filter((c) => c >= 48 && c < 91).map((c) => String.fromCharCode(c)).join('').slice(0, 17);
  }
}

export const supportedDefs = (set) => PIDS.filter((p) => set.has(p.id) || p.id === STATUS_PID);
