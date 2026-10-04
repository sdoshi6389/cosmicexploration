// Barrow civilisations end-to-end in a real browser: dock navigation, every zoom
// depth renders, micro edits made through the UI propagate to macro outcomes.
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto('http://localhost:5173/?session=none');
await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });
await page.evaluate(() => window.__cosmos.useWorld.getState().newSession('barrow-e2e'));
await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30000 });

const results = [];
const check = (name, ok, detail = '') => results.push([ok ? 'PASS' : 'FAIL', name, detail]);
const stop = () => page.evaluate(() => window.__cosmos.useUi.getState().stop);
const caps = () => page.evaluate(() => window.__cosmos.useWorld.getState().capabilities);
const sum = (l) => page.evaluate((x) => window.__cosmos.useWorld.getState().outputs[x]?.summary ?? null, l);
const settle = (ms = 2600) => page.waitForTimeout(ms);
const tool = (n, a) => page.evaluate(([x, y]) => window.__cosmos.executeTool(x, y, 'test'), [n, a]);

// 1. Dock buttons navigate (and raise capability).
for (const [label, expect] of [['K1', 'earth'], ['K2', 'solar'], ['K3', 'galaxy'], ['B2', 'town'], ['B4', 'city'], ['B6', 'grid']]) {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  await settle();
  const s = await stop();
  check(`dock ${label} → ${expect}`, s === expect, s);
}
const c = await caps();
check('capability raised to K3 · B6 by visiting', c.kardashevLevel === 3 && c.barrowLevel === 6, JSON.stringify(c));
check('no B1/B3/B5 buttons', (await page.getByRole('button', { name: /^B[135]$/ }).count()) === 0);

// 2. Every depth renders.
for (const s of ['town', 'body', 'cell', 'protein', 'gene', 'city', 'room', 'lattice', 'atom', 'grid', 'device', 'particle']) {
  await page.evaluate((x) => window.__cosmos.useUi.getState().goTo(x), s);
  await settle(1800);
  check(`depth ${s} renders`, (await stop()) === s && errors.length === 0, errors.at(-1) ?? '');
}

// 3. B2: edit a base through the gene editor panel, then check the population.
await page.evaluate(() => { window.__cosmos.useUi.getState().goTo('gene'); window.__cosmos.useUi.getState().setConsole(true, 'mission'); window.__cosmos.useUi.getState().setGeneCursor(20); });
await settle();
await page.getByRole('button', { name: /^T.*V$|^TE7V|E7V/ }).first().click().catch(() => {});
await settle(3500);
await tool('create_intervention', { kind: 'b2.population', params: { size: 20000, editedFraction: 0.25 } });
await settle();
let b2 = await sum('b2');
check('B2 gene-panel edit c.20A>T → sickle phenotype', b2?.phenotype === 'sickle', JSON.stringify(b2));
check('B2 population: 5,000 symptomatic of 20,000', b2?.symptomatic === 5000 && b2?.meanOxygenDelivery < 1, JSON.stringify(b2));

// 4. B4: place ions in the lattice, then scale to a city.
await tool('switch_civilisation', { civilisation: 'B4' });
await settle();
await tool('create_intervention', { kind: 'b4.window', params: { occupiedSites: '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29' } });
await settle();
const dark = await sum('b4');
await tool('update_intervention', { target: 'b4.window', params: { occupiedSites: '0,1' } });
await tool('create_intervention', { kind: 'b4.city', params: { buildings: 1000, roomsPerBuilding: 30 } });
await settle();
const clear = await sum('b4');
check('B4 fewer ions → more transmission and room light', clear.transmission > dark.transmission && clear.roomLux > dark.roomLux, `${dark.transmission.toFixed(3)} → ${clear.transmission.toFixed(3)}`);
check('B4 city energy computed for 30,000 rooms', clear.cityEnergyW > 0, `${clear.cityEnergyW.toExponential(2)} W`);

// 5. B6: switch to proton–antiproton, connect a city.
await tool('switch_civilisation', { civilisation: 'B6' });
await settle();
await tool('create_intervention', { kind: 'b6.device', params: { eventRate_per_s: 1e14, units: 4 } });
await tool('create_intervention', { kind: 'b6.city', params: { households: 50000 } });
await settle();
const e6 = await sum('b6');
await tool('update_intervention', { target: 'b6.device', params: { species: 'proton' } });
await settle();
const p6 = await sum('b6');
check('B6 p p̄ lights more of the city than e⁺e⁻ at the same rate', p6.cityLitFraction >= e6.cityLitFraction && p6.electricalW > e6.electricalW * 100, `${e6.cityLitFraction.toFixed(4)} → ${p6.cityLitFraction.toFixed(4)}`);

await b.close();
for (const r of results) console.log(r.filter(Boolean).join('  '));
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
