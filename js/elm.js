import { PIDS, PID_BY_ID, STATUS_PID } from './pids.js';
import { decodeDtcs } from './dtc.js';

const ERR = /UNABLE|ERROR|BUS INIT|STOPPED|NO DATA|^\?$|CAN ERROR|DATA ERROR/i;

const clean = (l) => l.replace(/^\d+:/, '').replace(/\s+/g, '').toUpperCase();

// Satırlar içinde "41<pid>" ile başlayan ilk yanıtın veri baytlarını döndürür
function findResp(lines, prefix) {
  for (const raw of lines) {
    const l = clean(raw);
    if (l.startsWith(prefix) && /^[0-9A-F]+$/.test(l)) return (l.slice(prefix.length).match(/../g) || []).map((h) => parseInt(h, 16));
  }
  return null;
}

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
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP' + protocol]) await this.cmd(c, 4000);
    const supported = new Set();
    let next = true;
    for (const base of ['00', '20', '40', '60']) {
      if (!next) break;
      const lines = await this.cmd('01' + base, 15000);
      const b = findResp(lines, '41' + base);
      if (!b || b.length < 4) {
        if (base === '00') throw new Error('Araca bağlanılamadı: ' + (lines.join(' ') || 'yanıt yok') + ' (kontağı açtınız mı?)');
        break;
      }
      const mask = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
      const start = parseInt(base, 16);
      for (let i = 1; i <= 32; i++) if (mask & (1 << (32 - i))) supported.add((start + i).toString(16).toUpperCase().padStart(2, '0'));
      next = !!(mask & 1);
    }
    this.supported = supported;
    const dpn = (await this.cmd('ATDPN').catch(() => ['']))[0] || '';
    this.info.protocol = dpn;
    this.isCAN = /[6-9]/.test(dpn.replace(/^A/, ''));
    await this.refreshVoltage();
    return supported;
  }

  async refreshVoltage() {
    const v = (await this.cmd('ATRV').catch(() => ['']))[0] || '';
    this.info.voltage = parseFloat(v) || null;
    return this.info.voltage;
  }

  async readPid(id) {
    const lines = await this.cmd('01' + id + (this.fast ? '1' : ''), 3000);
    const b = findResp(lines, '41' + id);
    if (!b) return lines.some((l) => ERR.test(l)) ? null : null;
    if (id === STATUS_PID) return b[0];
    const p = PID_BY_ID[id];
    return p ? p.f(b[0] ?? 0, b[1] ?? 0) : null;
  }

  async readDtcs() { return decodeDtcs(await this.cmd('03', 8000), this.isCAN); }
  async clearDtcs() { return this.cmd('04', 8000); }

  async readVin() {
    const lines = await this.cmd('0902', 8000);
    const hex = lines.map(clean).filter((l) => !/^[0-9A-F]{3}$/.test(l)).join('');
    const i = hex.indexOf('4902');
    if (i < 0) return '';
    const bytes = (hex.slice(i + 4).match(/../g) || []).map((h) => parseInt(h, 16));
    if (bytes[0] === 1) bytes.shift();
    return bytes.filter((c) => c >= 48 && c < 91).map((c) => String.fromCharCode(c)).join('').slice(0, 17);
  }
}

export const supportedDefs = (set) => PIDS.filter((p) => set.has(p.id));
