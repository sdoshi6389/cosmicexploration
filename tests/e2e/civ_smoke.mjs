// Runtime smoke for the K2/K3 civilisation layers: build structures, run an
// expansion, focus/select objects in both scenes, and fail on any page error.
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto('http://localhost:5173/?session=none');
await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });
await page.evaluate(() => window.__cosmos.useWorld.getState().newSession('civ-smoke'));
await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30000 });
const tool = (n, a) => page.evaluate(([x, y]) => window.__cosmos.executeTool(x, y, 'test'), [n, a]);
const steps = [
  ['switch_civilisation', { civilisation: 'K2' }],
  ['build', { host: 'sun', type: 'dyson_swarm', coverage: 0.3, orbitRadius_AU: 0.8 }],
  ['build', { host: 'moon', type: 'surface_collectors', coverage: 0.4 }],
  ['build', { host: 'saturn', type: 'orbital_ring', coverage: 0.2 }],
  ['build', { host: 'mars', type: 'habitat', population: 5e8 }],
  ['focus', { target: 'moon' }],
  ['switch_civilisation', { civilisation: 'K3' }],
  ['build', { host: 'Vega', type: 'dyson_sphere' }],
  ['create_intervention', { kind: 'k3.expansion', params: { speed_c: 0.1, settlementDelay_yr: 50 } }],
  ['set_clock', { action: 'seek', years: 20000 }],
  ['focus', { target: 'Vega' }],
  ['focus', { target: 'Sirius' }],
];
for (const [n, a] of steps) {
  const r = await tool(n, a);
  console.log(r.ok === false ? 'FAIL' : 'ok  ', n, JSON.stringify(a), r.ok === false ? JSON.stringify(r).slice(0, 200) : '');
  await page.waitForTimeout(2500);
}
const s = await page.evaluate(() => ({ stop: window.__cosmos.useUi.getState().stop, k2: window.__cosmos.useWorld.getState().outputs.k2?.summary, k3: window.__cosmos.useWorld.getState().outputs.k3?.summary }));
console.log(JSON.stringify(s));
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await b.close();
process.exit(errors.length ? 1 : 0);
