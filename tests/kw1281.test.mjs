// Sanal KW1281 ECU ile protokol mantığı testi: node tests/kw1281.test.mjs
import { KW1281, KWError, vagToP, decodeValue } from '../js/kw1281.js';

const cmp = (b) => 0xff ^ b;

class MockECU {
  constructor() {
    this.rx = [];                       // tester'a giden baytlar
    this.state = 'idle';
    this.pending = [];
    this.tx = null; this.txIdx = 0; this.testerCounter = 0;
    this.rxFrame = []; this.expectLen = 0;
    this.ended = false;
  }
  async flush() { this.rx = []; }
  async fiveBaud(addr) { this.addr = addr; this.rx = [0x55, 0x01, 0x8a]; this.state = 'await_kw2'; }
  async read() { return this.rx.length ? this.rx.shift() : null; }
  async write(b) { this.onTester(b); }

  startSend(title, body) {
    this.counter = (this.testerCounter + 1) & 0xff;
    this.tx = [body.length + 3, this.counter, title, ...body, 0x03];
    this.txIdx = 0; this.state = 'sending'; this.rx.push(this.tx[0]);
  }
  sendNext() { const b = this.pending.shift(); this.startSend(b.title, b.body); }

  onTester(b) {
    if (this.state === 'await_kw2') {
      if (b !== cmp(0x8a)) throw new Error('kw2 tamamlayıcısı yanlış');
      this.rx.push(cmp(this.addr));
      this.pending = [
        { title: 0xf6, body: [...Buffer.from('1K0907115AB  ')] },
        { title: 0xf6, body: [...Buffer.from('1.6L R4 FSI  ')] },
        { title: 0x09, body: [] },
      ];
      this.testerCounter = 0; this.sendNext(); return;
    }
    if (this.state === 'sending') {
      if (b !== cmp(this.tx[this.txIdx])) throw new Error(`tester tamamlayıcı yanlış idx=${this.txIdx}`);
      this.txIdx++;
      this.rx.push(this.tx[this.txIdx]);
      if (this.txIdx === this.tx.length - 1) this.state = 'recv_wait'; // 0x03 gönderildi, ack beklenmez
      return;
    }
    // tester blok gönderiyor
    this.state = 'recv';
    if (this.rxFrame.length === 0) { this.expectLen = b; this.rx.push(cmp(b)); this.rxFrame.push(b); return; }
    this.rxFrame.push(b);
    if (this.rxFrame.length - 1 < this.expectLen) { this.rx.push(cmp(b)); return; }
    const [, counter, title, ...rest] = this.rxFrame; rest.pop(); // 0x03
    this.rxFrame = []; this.testerCounter = counter;
    this.handle(title, rest);
  }

  handle(title, body) {
    if (title === 0x09) { if (this.pending.length) this.sendNext(); return; }
    if (title === 0x07) {
      this.pending = [{ title: 0xfc, body: [0x40, 0x66, 0x23, 0xff, 0xff, 0x88].slice(0, 3) }, { title: 0x09, body: [] }]; this.sendNext(); return;
    }
    if (title === 0x29) {
      if (body[0] === 200) { this.pending = []; this.startSend(0x0a, []); return; }
      this.pending = [{ title: 0xe7, body: [0x01, 0x04, 0x00, 0x05, 0x04, 0xc6, 0x06, 0x04, 0x95, 0x07, 0x00, 0x00] }, { title: 0x09, body: [] }]; this.sendNext(); return;
    }
    if (title === 0x06) { this.ended = true; return; }
    throw new Error('bilinmeyen komut 0x' + title.toString(16));
  }
}

let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK   ' : 'HATA ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };

const ecu = new MockECU();
const kw = new KW1281(ecu, () => {});
const info = await kw.init(0x01);
ok('init: anahtar kelime 018A, KW1281', info.keyword === '018A' && info.kw1281);
const ident = await kw.readIdent();
ok('kimlik 2 satır', ident.length === 2 && ident[0] === '1K0907115AB' && ident[1] === '1.6L R4 FSI', JSON.stringify(ident));
const faults = await kw.readFaults();
ok('arıza kodu okundu', faults.length === 1 && faults[0].code === 16486 && vagToP(faults[0].code) === 'P0102', JSON.stringify(faults));
const g = await kw.readGroup(1);
const dec = g.values.map((v) => decodeValue(v).text);
ok('ölçüm bloğu 3 değer', g.values.length === 4 && dec[0] === '0.8 rpm' || dec[0].endsWith('rpm'), JSON.stringify(dec));
const g2 = await kw.readGroup(200);
ok('geçersiz grup reddi (NAK)', g2.refused === true);
await kw.end();
ok('oturum kapatma', ecu.ended === true);

// zaman aşımı: sessiz modül
const silent = { flush: async () => {}, fiveBaud: async () => {}, read: async () => null, write: async () => {} };
try { await new KW1281(silent).init(0x03); ok('sessiz modül hata verir', false); } catch (e) { ok('sessiz modül hata verir', e instanceof KWError, e.message); }
// yanlış senkron
const bad = { flush: async () => {}, fiveBaud: async () => {}, read: async () => 0x00, write: async () => {} };
try { await new KW1281(bad).init(0x03); ok('yanlış senkron hata verir', false); } catch (e) { ok('yanlış senkron hata verir', /baud/.test(e.message), e.message); }

console.log(fail ? `\n${fail} test BAŞARISIZ` : '\nTüm testler geçti');
process.exit(fail ? 1 : 0);
