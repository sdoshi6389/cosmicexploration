// Free-form requests through real Grok (chat path with tools) in the browser.
// Asserts on the authoritative state each request should produce.
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto('http://localhost:5173/?session=none');
await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });
await page.evaluate(() => window.__cosmos.useWorld.getState().newSession('grok-freebuild'));
await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30000 });

const say = async (text) => {
  const before = await page.evaluate(() => window.__cosmos.useUi.getState().transcript.length);
  await page.evaluate((t) => window.__cosmos.sendCommand(t), text);
  const lines = await page.evaluate((n) => window.__cosmos.useUi.getState().transcript.slice(n).map((l) => `${l.role}: ${l.text}`), before);
  return lines;
};
const state = () => page.evaluate(() => {
  const w = window.__cosmos.useWorld.getState();
  const u = window.__cosmos.useUi.getState();
  return { stop: u.stop, selection: u.selection, focus: u.focus, ivs: w.interventions.map((i) => ({ kind: i.kind, level: i.level, label: i.label, params: i.params })) };
});

const cases = [
  ['take me to the moon, i want to harness its power', (s) => s.ivs.some((i) => i.kind === 'build.structure' && i.params.hostId === 'body.moon')],
  ['now fly me to Betelgeuse', (s) => s.stop === 'galaxy' && s.focus && /betelgeuse/i.test(s.selection?.label ?? '')],
  ['build a dyson sphere around Vega', (s) => s.ivs.some((i) => i.params.hostId === 'star.vega' && i.params.type === 'dyson_sphere' && i.level === 'k3')],
  ['put a habitat for a million people on Europa and power it by harvesting fuel from Jupiter', (s) => s.ivs.some((i) => i.params.hostId === 'body.europa' && i.params.type === 'habitat') && s.ivs.some((i) => i.params.hostId === 'body.jupiter' && i.params.type === 'gas_harvester')],
  ['make the moon collectors cover twice as much', (s) => (s.ivs.find((i) => i.params.hostId === 'body.moon')?.params.coverage ?? 0) > 0.1],
];
let pass = 0;
for (const [text, check] of cases) {
  const lines = await say(text);
  await page.waitForTimeout(1500);
  const s = await state();
  const ok = Boolean(check(s));
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${text}"`);
  for (const l of lines) console.log(`        ${l.slice(0, 220)}`);
}
console.log(`\n${pass}/${cases.length} passed`);
await b.close();
process.exit(pass === cases.length ? 0 : 1);
