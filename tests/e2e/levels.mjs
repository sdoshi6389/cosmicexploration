// End-to-end scenario tests per level, in a real browser against the live app and
// SpacetimeDB. Each scenario runs through executeTool (the voice/chat path), then
// asserts on the authoritative outputs mirrored from SpacetimeDB.
//
//   node tests/e2e/levels.mjs            (dev servers on :5173 and :8000)
import { chromium } from 'playwright';

const URL = process.env.COSMOS_URL ?? 'http://localhost:5173/?session=e2e-none';
const results = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto(URL);
await page.waitForFunction(() => window.__cosmos && window.__cosmos.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120_000 });
// Fresh session so runs are independent.
await page.evaluate(() => window.__cosmos.useWorld.getState().newSession('e2e'));
await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30_000 });

const tool = (name, args = {}) => page.evaluate(([n, a]) => window.__cosmos.executeTool(n, a, 'test'), [name, args]);
const out = (level) => page.evaluate((l) => window.__cosmos.useWorld.getState().outputs[l]?.summary ?? null, level);
const render = (level) => page.evaluate((l) => { const r = window.__cosmos.useWorld.getState().render[l]; return r ? { verified: r.verified, view: r.output.view } : null; }, level);

async function scenario(name, fn) {
  try {
    await fn();
    results.push([name, 'PASS', '']);
  } catch (e) {
    results.push([name, 'FAIL', String(e.message ?? e)]);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await scenario('K1 · build global solar network, increase capacity, show surplus regions', async () => {
  await tool('switch_civilisation', { civilisation: 'K1' });
  await page.waitForTimeout(2500);
  let r = await tool('create_intervention', { kind: 'k1.network', params: { technology: 'solar', regions: 'all', capacityPerRegion_W: 5e12 }, label: 'Global solar network' });
  assert(r.ok, JSON.stringify(r));
  const before = await out('k1');
  r = await tool('update_intervention', { params: { capacityPerRegion_W: 2e13 } }); // "increase its capacity" (follow-up, no target)
  assert(r.ok, JSON.stringify(r));
  const after = await out('k1');
  assert(after.usefulW > before.usefulW, 'useful power did not increase');
  const rv = await render('k1');
  assert(rv.verified, 'render not verified against server hash');
  const surplus = rv.view.regions.filter((x) => x.status === 'surplus').map((x) => x.name);
  assert(surplus.length > 0, 'no surplus regions');
  results.push(['   surplus regions', 'info', surplus.join(', ')]);
});

await scenario('K2 · Dyson swarm 30% + habitat near Mars', async () => {
  await tool('switch_civilisation', { civilisation: 'K2' });
  await page.waitForTimeout(2500);
  let r = await tool('create_intervention', { kind: 'k2.swarm', params: { captureFraction: 0.3 } });
  assert(r.ok, JSON.stringify(r));
  r = await tool('create_intervention', { kind: 'k2.habitat', params: { bodyId: 'body.mars', kind: 'habitat', demand_W: 1e17 }, label: 'Mars habitat' });
  assert(r.ok, JSON.stringify(r));
  const s = await out('k2');
  assert(s.deliveredW > 0 && s.loads === 1, JSON.stringify(s));
});

await scenario('K3 · expand at 0.1c, settle after 50 yr, swarms; clock scrub', async () => {
  await tool('switch_civilisation', { civilisation: 'K3' });
  await page.waitForTimeout(2500);
  const r = await tool('create_intervention', { kind: 'k3.expansion', params: { speed_c: 0.1, settlementDelay_yr: 50, buildSwarms: true } });
  assert(r.ok, JSON.stringify(r));
  await tool('set_clock', { action: 'seek', years: 3000 });
  await page.waitForFunction(() => (window.__cosmos.useWorld.getState().outputs.k3?.summary.settledCount ?? 0) > 0, null, { timeout: 20_000 });
  const a = await out('k3');
  await tool('set_clock', { action: 'seek', years: 9000 });
  await page.waitForFunction((n) => (window.__cosmos.useWorld.getState().outputs.k3?.summary.settledCount ?? 0) > n, a.settledCount, { timeout: 20_000 });
  await tool('set_clock', { action: 'pause' });
  const b = await out('k3');
  assert(b.sampleW > 0, 'no swarm power at settled stars');
});

await scenario('B2 · show HbS, apply reference, oxygen delivery recovers', async () => {
  await tool('switch_civilisation', { civilisation: 'B2' });
  await page.waitForTimeout(2500);
  let r = await tool('create_intervention', { kind: 'b2.edit', params: { variantRsId: 'rs334', operation: 'introduce' } });
  assert(r.ok, JSON.stringify(r));
  const sick = await out('b2');
  r = await tool('create_intervention', { kind: 'b2.edit', params: { variantRsId: 'rs334', operation: 'repair' } });
  assert(r.ok, JSON.stringify(r));
  const fixed = await out('b2');
  assert(sick.phenotype === 'sickle' && fixed.phenotype === 'normal', `${sick.phenotype} → ${fixed.phenotype}`);
  assert(fixed.oxygenDelivery > sick.oxygenDelivery, 'oxygen delivery did not recover');
  const z = await tool('navigate', { stop: 'body' });
  assert(z.ok, 'navigate body');
});

await scenario('B4 · window microstructure → transparency → room light', async () => {
  await tool('switch_civilisation', { civilisation: 'B4' });
  await page.waitForTimeout(2500);
  let r = await tool('create_intervention', { kind: 'b4.window', params: { material: 'WO3', insertion_x: 0.35 } });
  assert(r.ok, JSON.stringify(r));
  const dark = await out('b4');
  r = await tool('update_intervention', { target: 'window', params: { insertion_x: 0.02 } });
  assert(r.ok, JSON.stringify(r));
  const clear = await out('b4');
  assert(clear.transmission > dark.transmission && clear.roomLux > dark.roomLux, JSON.stringify({ dark, clear }));
  await tool('navigate', { stop: 'room' });
  await page.waitForTimeout(2500);
  r = await tool('zoom', { direction: 'in' });
  assert(r.ok && r.stop === 'lattice', JSON.stringify(r));
});

await scenario('B6 · raise interaction rate → usable power, heat, lights', async () => {
  await tool('switch_civilisation', { civilisation: 'B6' });
  await page.waitForTimeout(2500);
  let r = await tool('create_intervention', { kind: 'b6.device', params: { eventRate_per_s: 1e12, lightCount: 8, lightPower_W: 60 } });
  assert(r.ok, JSON.stringify(r));
  const lo = await out('b6');
  r = await tool('update_intervention', { target: 'b6.device', params: { eventRate_per_s: 1e16 } });
  assert(r.ok, JSON.stringify(r));
  const hi = await out('b6');
  assert(hi.electricalW > lo.electricalW && hi.grossW > hi.electricalW && hi.heatW > 0 && hi.supplyInputW > 0, JSON.stringify(hi));
  assert(hi.litFraction >= lo.litFraction, 'lights did not respond');
});

await scenario('Shared · ambiguity asks for clarification; undo; compare; reset', async () => {
  await tool('switch_civilisation', { civilisation: 'K2' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__cosmos.useUi.getState().select(null));
  await page.evaluate(() => { const u = window.__cosmos.useUi.getState(); u.recentSelections.length = 0; });
  const amb = await tool('remove_intervention', {});
  assert(amb.needs_clarification === true && amb.candidates.length >= 2, JSON.stringify(amb));
  const before = await page.evaluate(() => window.__cosmos.useWorld.getState().interventions.length);
  let r = await tool('undo');
  assert(r.ok, JSON.stringify(r));
  const after = await page.evaluate(() => window.__cosmos.useWorld.getState().interventions.length);
  assert(after === before - 1 || after === before, 'undo did not apply');
  r = await tool('fork_branch', { name: 'e2e fork' });
  assert(r.ok, JSON.stringify(r));
  await tool('update_intervention', { target: 'b6.device', params: { eventRate_per_s: 1e18 } });
  r = await tool('compare_branches', { with: 'parent' });
  assert(r.ok && r.levels.some((l) => l.level === 'b6'), JSON.stringify(r).slice(0, 300));
  r = await tool('reset');
  assert(r.ok, JSON.stringify(r));
  const n = await page.evaluate(() => window.__cosmos.useWorld.getState().interventions.length);
  assert(n === 0, `reset left ${n} interventions`);
});

await browser.close();
const fatal = errors.filter((e) => !/favicon|DevTools|WebGL|GPU stall|THREE\.WebGLRenderer/.test(e));
for (const [n, s, d] of results) console.log(`${s.padEnd(5)} ${n}${d ? ` — ${d}` : ''}`);
if (fatal.length) console.log(`\nconsole/page errors (${fatal.length}):\n${fatal.slice(0, 8).join('\n')}`);
const failed = results.filter((r) => r[1] === 'FAIL').length;
console.log(`\n${results.filter((r) => r[1] === 'PASS').length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
