// Two explorers in the same world: separate browsers (separate SpacetimeDB identities),
// joined through the invite link. Checks presence, avatars, shared builds, activity
// notifications, jump-to-view and follow-the-presenter.
import { chromium } from 'playwright';

const BASE = process.env.COSMOS_URL ?? 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
const errors = [];

async function explorer(name, url) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 880 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e).slice(0, 160)}`));
  await page.addInitScript((n) => { try { localStorage.setItem('cosmos.displayName', n); } catch {} }, name);
  await page.goto(url);
  await page.waitForFunction(() => window.__cosmos?.useWorld.getState().branchId && window.__cosmos.useWorld.getState().mode === 'live', null, { timeout: 120000 });
  return page;
}
const S = (p, fn, arg) => p.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(p, fn, arg, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await p.evaluate(fn, arg)) return true;
    await wait(300);
  }
  return false;
}

// Alice creates a world and copies the editor invite.
const alice = await explorer('Alice', `${BASE}?session=none`);
await S(alice, () => window.__cosmos.useWorld.getState().newSession('multiplayer-test'));
await until(alice, () => window.__cosmos.useWorld.getState().invites.length === 2);
const code = await S(alice, () => window.__cosmos.useWorld.getState().invites.find((i) => i.role === 'editor').code);
const sessionId = await S(alice, () => window.__cosmos.useWorld.getState().sessionId);

// Bob joins with the link.
const bob = await explorer('Bob', `${BASE}?join=${code}`);
check('Bob joins the same world via invite link', await until(bob, (sid) => window.__cosmos.useWorld.getState().sessionId === sid, sessionId), code);
check('Bob is an editor', (await S(bob, () => window.__cosmos.useWorld.getState().role)) === 'editor');
check('Alice sees Bob online', await until(alice, () => window.__cosmos.useWorld.getState().members.some((m) => m.displayName === 'Bob' && m.online)));

// Both go to the Solar System; each sees the other's avatar there.
await S(alice, () => window.__cosmos.executeTool('switch_civilisation', { civilisation: 'K2' }, 'test'));
await S(bob, () => window.__cosmos.useUi.getState().goTo('solar'));
await wait(4000);
check('Bob receives Alice’s live pose in the Solar System', await until(bob, () => window.__cosmos.useWorld.getState().poses.some((p) => p.displayName === 'Alice' && p.stop === 'solar')));
check('Alice’s avatar label renders in Bob’s scene', await until(bob, () => [...document.querySelectorAll('button')].some((x) => x.title === 'Jump to their view' && x.textContent === 'Alice')));
check('Bob’s avatar label renders in Alice’s scene', await until(alice, () => [...document.querySelectorAll('button')].some((x) => x.title === 'Jump to their view' && x.textContent === 'Bob')));

// Alice moves her camera; Bob sees the pose change.
const p0 = await S(bob, () => window.__cosmos.useWorld.getState().poses.find((p) => p.displayName === 'Alice').position.join());
await S(alice, () => window.__cosmos.useUi.getState().focusOn('body.jupiter'));
check('Alice’s camera movement streams to Bob', await until(bob, (old) => window.__cosmos.useWorld.getState().poses.find((p) => p.displayName === 'Alice')?.position.join() !== old, p0));

// Alice builds; Bob sees the structure and an activity notification.
await S(alice, () => window.__cosmos.executeTool('build', { host: 'sun', type: 'dyson_swarm', coverage: 0.2 }, 'test'));
check('Alice’s Dyson swarm appears in Bob’s world', await until(bob, () => window.__cosmos.useWorld.getState().interventions.some((i) => i.params.hostId === 'body.sun')));
check('Bob gets “Alice built …” notification', await until(bob, () => window.__cosmos.useUi.getState().toasts.some((t) => /^Alice built/.test(t.title))));

// Bob jumps to Alice's view after she moves to the galaxy.
await S(alice, () => window.__cosmos.executeTool('switch_civilisation', { civilisation: 'K3' }, 'test'));
await wait(3500);
await S(bob, () => {
  const p = window.__cosmos.useWorld.getState().poses.find((x) => x.displayName === 'Alice');
  window.__cosmos.useUi.getState().goTo(p.stop);
  window.__cosmos.useUi.getState().jumpTo(p.stop, p.position, p.target);
});
check('Bob jumps to Alice’s civilisation and view', await until(bob, () => window.__cosmos.useUi.getState().stop === 'galaxy'));

// Presenter mode: Alice presents, Bob follows, Alice goes to B4 — Bob follows.
await S(alice, () => window.__cosmos.useWorld.getState().setPresenter(true));
await until(bob, () => Boolean(window.__cosmos.useWorld.getState().presenterHex));
await S(bob, () => window.__cosmos.useWorld.getState().setFollowing(true));
await S(alice, () => window.__cosmos.executeTool('switch_civilisation', { civilisation: 'B4' }, 'test'));
check('Bob follows the presenter into B4', await until(bob, () => window.__cosmos.useUi.getState().stop === 'city', null, 25000));

await b.close();
for (const r of results) console.log(r);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
