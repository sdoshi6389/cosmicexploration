// Grok Voice agent × civilisation levels. Each case runs in the live realtime voice
// session (same model, instructions and tools as speech; turns injected as text),
// at a fixed civilisation level, and checks the authoritative outcome:
//   expect 'build'  → a new intervention matching `want` appears
//   expect 'reject' → nothing is built, capability unchanged, reply names `level`
import { chromium } from 'playwright';

const CASES = [
  ['B2', 'Build a Dyson sphere around Vega.', { expect: 'reject', level: /K3|Kardashev III|galactic/i }],
  ['B2', 'Put solar farms across Europe.', { expect: 'reject', level: /K1|Kardashev I|planetary/i }],
  // civ, utterance, expectation
  ['K1', 'Cover Africa with solar farms, about two terawatts per region.', { expect: 'build', want: (i) => i.kind === 'k1.network' || i.kind === 'k1.facility' }],
  ['K1', 'Put solar collectors on the Moon.', { expect: 'build', want: (i) => i.params.hostId === 'body.moon' }],
  ['K1', 'Build a Dyson swarm around the Sun.', { expect: 'reject', level: /K2|Kardashev II|stellar/i }],
  ['K1', 'Mine fusion fuel from Jupiter.', { expect: 'reject', level: /K2|Kardashev II|stellar/i }],
  ['K2', 'Wrap the Sun in a Dyson sphere.', { expect: 'build', want: (i) => i.params.type === 'dyson_sphere' && i.params.hostId === 'body.sun' }],
  ['K2', 'Build an orbital collector ring around Saturn.', { expect: 'build', want: (i) => i.params.hostId === 'body.saturn' }],
  ['K2', 'Build a Dyson swarm around Sirius.', { expect: 'reject', level: /K3|Kardashev III|galactic/i }],
  ['K3', 'Build a Dyson sphere around Betelgeuse.', { expect: 'build', want: (i) => i.params.type === 'dyson_sphere' && /betelgeuse/.test(String(i.params.hostId)) }],
  ['K3', 'Expand across the galaxy at half the speed of light.', { expect: 'build', want: (i) => i.kind === 'k3.expansion' }],
  ['K3', 'Start a second expansion wave from Betelgeuse at a tenth of light speed.', { expect: 'build', want: (i) => i.kind === 'k3.expansion' && /betelgeuse/.test(String(i.params.originStarId)) }],
  ['K3', 'Change base 20 of the HBB gene to T.', { expect: 'reject', level: /B2|genome|Barrow/i }],
  ['K1', 'Wrap the Sun in a Dyson swarm capturing half its light.', { expect: 'reject', level: /K2|Kardashev II|stellar/i }],
  ['K3', 'Send a ship to Andromeda faster than light.', { expect: 'reject', level: /light|impossible|physics|not possible/i }],
  ['B2', 'Change base 20 of the HBB gene to T, and give it to half of a town of ten thousand people.', { expect: 'build', want: (i) => i.kind === 'b2.base_edit' || i.kind === 'b2.population' }],
  ['B2', 'Insert lithium ions into the window film to darken it.', { expect: 'reject', level: /B4|Barrow IV|atom/i }],
  ['B4', 'Make the windows in the city more transparent.', { expect: 'build', want: (i) => i.kind === 'b4.window' }],
  ['B4', 'Build an antimatter reactor for the city.', { expect: 'reject', level: /B6|Barrow VI|particle/i }],
  ['B6', 'Build a proton antiproton reactor and connect it to a city of fifty thousand homes.', { expect: 'build', want: (i) => i.kind === 'b6.device' || i.kind === 'b6.city' }],
  ['B6', 'Make a perpetual motion machine that creates energy from nothing.', { expect: 'reject', level: /nothing|impossible|conservation|not possible|thermodynamic/i }],
];

const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto('http://localhost:5173/?session=none');
await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });

const state = () => page.evaluate(() => ({
  ivs: window.__cosmos.useWorld.getState().interventions.map((i) => ({ id: i.id, kind: i.kind, params: i.params })),
  caps: window.__cosmos.useWorld.getState().capabilities,
}));
let civ = '';
let pass = 0;
for (const [level, text, exp] of CASES) {
  if (level !== civ) {
    // Fresh session per civilisation level; level set directly (not by the agent).
    civ = level;
    await page.evaluate(() => window.__cosmos.voice.stop(false));
    await page.evaluate((n) => window.__cosmos.useWorld.getState().newSession(n), `voice-${level}`);
    await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30000 });
    const STOP = { K1: 'earth', K2: 'solar', K3: 'galaxy', B2: 'town', B4: 'city', B6: 'grid' };
    await page.evaluate(() => window.__cosmos.useWorld.getState().setCapabilities({ kardashevLevel: 3, barrowLevel: 6 }));
    await page.evaluate((st) => window.__cosmos.useUi.getState().goTo(st), STOP[level]);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__cosmos.voice.start());
    await page.waitForFunction(() => ['live', 'listening'].includes(window.__cosmos.useUi.getState().voice), null, { timeout: 30000 });
  }
  const before = await state();
  const stop0 = await page.evaluate(() => window.__cosmos.useUi.getState().stop);
  const n0 = await page.evaluate(() => window.__cosmos.useUi.getState().transcript.length);
  await page.evaluate((t) => window.__cosmos.voice.sendText(t), text);
  // Wait for the agent to finish (tools done + an assistant reply that stopped streaming).
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < 70000) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate((n) => {
      const lines = window.__cosmos.useUi.getState().transcript.slice(n);
      const a = lines.filter((l) => l.role === 'assistant');
      return { done: a.length > 0 && !a.at(-1).streaming, busy: window.__cosmos.voice.busy };
    }, n0);
    quiet = st.done && !st.busy ? quiet + 1 : 0;
    if (quiet >= 3) break;
  }
  const after = await state();
  const lines = await page.evaluate((n) => window.__cosmos.useUi.getState().transcript.slice(n).map((l) => `${l.role}: ${l.text}`), n0);
  const reply = lines.filter((l) => l.startsWith('assistant')).join(' ');
  const added = after.ivs.filter((i) => !before.ivs.some((x) => x.id === i.id) || JSON.stringify(x => 0) === '');
  const changed = after.ivs.filter((i) => { const o = before.ivs.find((x) => x.id === i.id); return !o || JSON.stringify(o.params) !== JSON.stringify(i.params); });
  let ok;
  if (exp.expect === 'build') ok = changed.some(exp.want);
  else ok = changed.length === 0 && exp.level.test(reply) && (await page.evaluate(() => window.__cosmos.useUi.getState().stop)) === stop0;
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${level}] ${exp.expect.toUpperCase()}  "${text}"`);
  for (const l of lines.filter((x) => !x.startsWith('user'))) console.log(`         ${l.slice(0, 260)}`);
  void added;
}
await page.evaluate(() => window.__cosmos.voice.stop(false));
await b.close();
console.log(`\n${pass}/${CASES.length} passed${errors.length ? ` · page errors: ${errors.join(' | ')}` : ''}`);
process.exit(pass === CASES.length ? 0 : 1);
