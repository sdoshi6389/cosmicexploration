// Regression for "refused in B6, switched to B4 with the dock, asked again, still refused".
// Runs the exact flow through real Grok in chat and in the live voice session.
import { chromium } from 'playwright';

const ASK = 'Switch the film to nickel oxide and make the room bright enough to read';
const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto('http://localhost:5173/?session=none');
await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });

const film = () => page.evaluate(() => window.__cosmos.useWorld.getState().interventions.find((i) => i.kind === 'b4.window')?.params.material ?? null);
const clockVisible = () => page.evaluate(() => Boolean([...document.querySelectorAll('[aria-label="Simulation time"]')].length));
const results = [];
const check = (name, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? ` — ${d}` : ''}`);

async function fresh(name) {
  await page.evaluate((n) => window.__cosmos.useWorld.getState().newSession(n), name);
  await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30000 });
  // Visit everything (like the user): K3 expansion running, every level unlocked.
  await page.evaluate(() => window.__cosmos.useWorld.getState().setCapabilities({ kardashevLevel: 3, barrowLevel: 6 }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__cosmos.executeTool('switch_civilisation', { civilisation: 'K3' }, 'test'));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__cosmos.executeTool('create_intervention', { kind: 'k3.expansion', params: { speed_c: 0.1 } }, 'test'));
  await page.waitForTimeout(1500);
  check(`${name}: clock bar visible in K3`, await clockVisible());
  await page.getByRole('button', { name: /^B2/ }).first().click();
  await page.waitForTimeout(2500);
  check(`${name}: clock bar hidden outside K3`, !(await clockVisible()));
}
const lastAssistant = () => page.evaluate(() => window.__cosmos.useUi.getState().transcript.filter((l) => l.role === 'assistant').at(-1)?.text ?? '');

// ---- chat (Grok text) ----
await fresh('switch-chat');
await page.evaluate((t) => window.__cosmos.sendCommand(t), ASK);
check('chat: refused in B2 (needs B4), nothing built', (await film()) === null, (await lastAssistant()).slice(0, 140));
await page.getByRole('button', { name: /^B4/ }).first().click();
await page.waitForTimeout(2500);
await page.evaluate((t) => window.__cosmos.sendCommand(t), ASK);
await page.waitForTimeout(1500);
check('chat: after switching to B4, same request builds NiO film', (await film()) === 'NiO', (await lastAssistant()).slice(0, 160));
check('chat: room actually bright enough to read (≥300 lx)', (await page.evaluate(() => Number(window.__cosmos.useWorld.getState().outputs.b4?.summary.roomLux ?? 0))) >= 300);

// ---- voice (realtime session) ----
await fresh('switch-voice');
await page.evaluate(() => window.__cosmos.voice.start());
await page.waitForFunction(() => ['live', 'listening'].includes(window.__cosmos.useUi.getState().voice), null, { timeout: 30000 });
async function sayVoice(text) {
  const n0 = await page.evaluate(() => window.__cosmos.useUi.getState().transcript.length);
  await page.evaluate((t) => window.__cosmos.voice.sendText(t), text);
  let quiet = 0;
  for (let i = 0; i < 70 && quiet < 3; i++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate((n) => { const a = window.__cosmos.useUi.getState().transcript.slice(n).filter((l) => l.role === 'assistant'); return a.length > 0 && !a.at(-1).streaming && !window.__cosmos.voice.busy; }, n0);
    quiet = st ? quiet + 1 : 0;
  }
}
await sayVoice(ASK);
check('voice: refused in B2 (needs B4), nothing built', (await film()) === null, (await lastAssistant()).slice(0, 140));
await page.getByRole('button', { name: /^B4/ }).first().click();
await page.waitForTimeout(2500);
await sayVoice(ASK);
check('voice: after switching to B4, same request builds NiO film', (await film()) === 'NiO', (await lastAssistant()).slice(0, 160));
await page.evaluate(() => window.__cosmos.voice.stop(false));

await b.close();
for (const r of results) console.log(r);
if (errors.length) console.log('page errors:', errors.join(' | '));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
