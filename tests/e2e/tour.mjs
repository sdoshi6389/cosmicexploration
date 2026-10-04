// Browser walkthrough: boots COSMOS, visits every stop, executes each level's intervention,
// and saves screenshots + console errors. Usage: node tests/e2e/tour.mjs [outDir] [stops...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'test-results/tour';
const only = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const URL = process.env.COSMOS_URL ?? 'http://localhost:5173/';

const STOPS = [
  { id: 'earth', key: '4', execute: true },
  { id: 'solar', key: '3', execute: true },
  { id: 'galaxy', key: '2', execute: true },
  { id: 'cosmic', key: '1', execute: false },
  { id: 'cell', key: '5', execute: true },
  { id: 'molecule', key: '6', execute: false },
  { id: 'atom', key: '7', execute: true },
  { id: 'nucleus', key: '8', execute: true },
  { id: 'particle', key: '9', execute: true },
].filter((s) => !only.length || only.includes(s.id));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`.slice(0, 600));
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.addInitScript(() => { try { localStorage.setItem('cosmos.displayName', 'Tester'); } catch {} });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: path.join(out, '00-loader.png') });
await page.waitForFunction(() => !document.body.innerText.includes('MULTISCALE UNIVERSE SANDBOX'), null, { timeout: 120000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(out, '01-boot.png') });

let i = 2;
for (const s of STOPS) {
  await page.mouse.click(820, 500); // focus the canvas (no input focused)
  await page.keyboard.press(s.key);
  await page.waitForTimeout(3600);
  await page.screenshot({ path: path.join(out, `${String(i++).padStart(2, '0')}-${s.id}.png`) });
  if (s.execute) {
    const btn = page.getByRole('button', { name: /^Execute/ });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(s.id === 'galaxy' ? 8000 : s.id === 'cell' ? 9000 : 4200);
      await page.screenshot({ path: path.join(out, `${String(i++).padStart(2, '0')}-${s.id}-executed.png`) });
    } else {
      errors.push(`no Execute button at ${s.id}`);
    }
  }
}
fs.writeFileSync(path.join(out, 'console.txt'), errors.join('\n'));
console.log(`console errors/warnings: ${errors.length}`);
console.log(errors.slice(0, 30).join('\n'));
await browser.close();
