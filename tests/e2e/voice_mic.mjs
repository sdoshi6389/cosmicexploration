// Grok Voice end-to-end with a (fake) microphone: Chromium feeds a spoken WAV file
// to getUserMedia, so the real pipeline runs — client secret → xAI realtime
// WebSocket → server VAD + transcription → tool calls → SpacetimeDB → spoken reply.
//
//   node tests/e2e/voice_mic.mjs path/to/command.wav "<expected hostId>"
import { chromium } from 'playwright';

const wav = process.argv[2];
const expectHost = process.argv[3] ?? 'body.jupiter';
const civ = process.argv[4] ?? '';
const rejectLevel = process.argv[5] ? new RegExp(process.argv[5], 'i') : null;
const b = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await b.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto('http://localhost:5173/?session=none');
await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });
await page.evaluate(() => window.__cosmos.useWorld.getState().newSession('voice-test'));
await page.waitForFunction(() => window.__cosmos.useWorld.getState().branches.length > 0, null, { timeout: 30000 });

if (civ) {
  const [k, bl] = civ.match(/\d/g).map(Number);
  await page.evaluate(([kk, bb]) => window.__cosmos.useWorld.getState().setCapabilities({ kardashevLevel: kk, barrowLevel: bb }), [k, bl]);
  await page.waitForTimeout(1500);
}
await page.evaluate(() => window.__cosmos.voice.start());
const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 60000 && !done) {
  await page.waitForTimeout(2000);
  done = rejectLevel
    ? await page.evaluate((re) => window.__cosmos.useUi.getState().transcript.some((l) => l.role === 'assistant' && !l.streaming && new RegExp(re, 'i').test(l.text)), rejectLevel.source)
    : await page.evaluate((h) => window.__cosmos.useWorld.getState().interventions.some((i) => i.params.hostId === h), expectHost);
}
if (rejectLevel) done = done && (await page.evaluate(() => window.__cosmos.useWorld.getState().interventions.length === 0));
await page.waitForTimeout(6000); // let the spoken reply finish
const out = await page.evaluate(() => ({
  voice: window.__cosmos.useUi.getState().voice,
  transcript: window.__cosmos.useUi.getState().transcript.map((l) => `${l.role}: ${l.text}`),
  ivs: window.__cosmos.useWorld.getState().interventions.map((i) => `${i.kind} ${i.label}`),
  stop: window.__cosmos.useUi.getState().stop,
  sources: window.__cosmos.useWorld.getState().events.map((e) => `${e.action}:${e.source}`),
}));
console.log('voice status:', out.voice, '· stop:', out.stop);
for (const l of out.transcript) console.log('  ', l.slice(0, 240));
console.log('interventions:', out.ivs);
console.log('events:', out.sources);
console.log(done ? (rejectLevel ? 'PASS voice → rejected with level suggestion, nothing built' : 'PASS voice → tool → SpacetimeDB') : 'FAIL');
await b.close();
process.exit(done ? 0 : 1);
