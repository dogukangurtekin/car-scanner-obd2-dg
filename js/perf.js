// Performans testleri: hız örneklerinden 0-100, ara hızlanma ve mesafe süreleri
export const TESTS = [
  { id: '0-100', name: '0 – 100 km/h', from: 0, to: 100, standing: true },
  { id: '0-60mph', name: '0 – 60 mph', from: 0, to: 96.56, standing: true },
  { id: '0-200', name: '0 – 200 km/h', from: 0, to: 200, standing: true },
  { id: '60-120', name: '60 – 120 km/h', from: 60, to: 120 },
  { id: '80-120', name: '80 – 120 km/h (sollama)', from: 80, to: 120 },
  { id: '100-200', name: '100 – 200 km/h', from: 100, to: 200 },
  { id: '1/8', name: '1/8 mil (201 m)', dist: 201.168, standing: true },
  { id: '1/4', name: '1/4 mil (402 m)', dist: 402.336, standing: true },
];

const STOP = 2; // km/h altı = duruyor

export class PerfEngine {
  constructor(onResult) {
    this.onResult = onResult;
    this.st = {};
    this.reset();
  }

  reset() {
    for (const t of TESTS) this.st[t.id] = { state: 'wait', t0: 0, dist: 0 };
    this.prev = null;
  }

  // Her hız örneği için çağrılır (t: saniye, v: km/h)
  sample(t, v) {
    const p = this.prev;
    if (p && t - p.t > 2) { // veri akışı koptu: çalışan testleri iptal et
      for (const s of Object.values(this.st)) if (s.state === 'run') s.state = 'wait';
      this.prev = { t, v };
      return;
    }
    for (const test of TESTS) {
      const s = this.st[test.id];
      if (test.standing) this._standing(test, s, t, v, p);
      else this._rolling(test, s, t, v, p);
    }
    this.prev = { t, v };
  }

  _cross(p, t, v, level) {
    if (!p || v === p.v) return t;
    return p.t + ((level - p.v) / (v - p.v)) * (t - p.t);
  }

  _standing(test, s, t, v, p) {
    if (s.state === 'wait' || s.state === 'done') { if (v <= STOP) s.state = 'ready'; return; }
    if (s.state === 'ready') {
      if (v > STOP && p) { s.state = 'run'; s.t0 = this._cross(p, t, v, STOP); s.dist = 0; s.vmax = v; }
      return;
    }
    if (s.state === 'run') {
      const dt = t - p.t;
      s.dist += ((p.v + v) / 2 / 3.6) * dt;
      s.vmax = Math.max(s.vmax, v);
      s.elapsed = t - s.t0;
      if (v <= STOP || s.elapsed > 90) { s.state = v <= STOP ? 'ready' : 'wait'; return; }
      if (test.to != null && v >= test.to) this._done(test, s, this._cross(p, t, v, test.to) - s.t0, v);
      else if (test.dist != null && s.dist >= test.dist) {
        const over = s.dist - test.dist, vms = v / 3.6;
        this._done(test, s, t - s.t0 - (vms > 0 ? over / vms : 0), v);
      }
    }
  }

  _rolling(test, s, t, v, p) {
    if (s.state === 'wait' || s.state === 'done') { if (v < test.from - 3) s.state = 'ready'; return; }
    if (s.state === 'ready') {
      if (v >= test.from) { s.state = 'run'; s.t0 = this._cross(p, t, v, test.from); }
      return;
    }
    if (s.state === 'run') {
      s.elapsed = t - s.t0;
      if (v < test.from - 5 || s.elapsed > 90) { s.state = 'ready'; return; }
      if (v >= test.to) this._done(test, s, this._cross(p, t, v, test.to) - s.t0, v);
    }
  }

  _done(test, s, seconds, v) {
    s.state = 'done';
    s.elapsed = seconds;
    s.last = seconds;
    this.onResult(test, seconds, v);
  }
}
