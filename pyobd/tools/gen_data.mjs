import { pathToFileURL } from 'url';
import fs from 'fs';
const root = new URL('../../js/', import.meta.url).href;
const { PIDS, ALERTS } = await import(root + 'pids.js');
const { DTC_INFO } = await import(root + 'dtc.js');
let out = '# Otomatik uretildi (js/pids.js ve js/dtc.js kaynaklarindan) - elle duzenlemeyin; kaynak degisince tools/gen_data.mjs ile yeniden uretin\nfrom typing import Callable, Optional\n\n';
out += 'PIDS = [\n';
for (const p of PIDS) {
  const src = p.f.toString();
  const m = src.match(/^\(?([^)=]*)\)?\s*=>\s*([\s\S]+)$/);
  let args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  let body = m[2].trim();
  if (body.includes('<<')) body = '(lambda v: v - 65536 if v >= 32768 else v)(a * 256 + b) / 4';
  const lam = `lambda ${['a','b','c','d'].map((x)=>x+'=0').join(', ')}: ${body.replace(/\bMath\./g, '')}`;
  out += `    dict(id=${JSON.stringify(p.id)}, key=${JSON.stringify(p.key)}, name=${JSON.stringify(p.name)}, unit=${JSON.stringify(p.unit)}, min=${p.min}, max=${p.max}, dec=${p.dec ?? 'None'}, fast=${p.fast ? 'True' : 'False'}, grp=${JSON.stringify(p.grp)}, lbl=${p.lbl ? 'True' : 'False'}, f=${lam}),\n`;
}
out += ']\n\nALERTS = ' + JSON.stringify(ALERTS, null, 1).replace(/null/g, 'None') + '\n\nDTC_INFO = ' + JSON.stringify(DTC_INFO, null, 1) + '\n';
fs.writeFileSync(new URL('../pyobd/data.py', import.meta.url), out);
