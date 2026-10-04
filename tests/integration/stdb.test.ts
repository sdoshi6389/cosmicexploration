/**
 * SpacetimeDB authority integration tests (spec A–I) against the live module.
 * Each client is a real SDK connection with its own identity, exactly like a browser.
 *
 *   npx vitest run -c tests/integration/vitest.config.ts
 *
 * Test G needs the backend (Imagine worker) running; it is skipped otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbConnection } from '../../apps/web/src/module_bindings/index';

const URI = 'wss://maincloud.spacetimedb.com';
const DB = 'cosmicexploration-dejjt';
const YEAR = 365.25 * 86400;
const rid = () => Math.random().toString(36).slice(2, 10);

interface Client {
  conn: DbConnection;
  hex: string;
  token: string;
}

const clients: Client[] = [];

function connect(token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 20_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnect((conn, identity, tok) => {
        clearTimeout(t);
        const c = { conn, hex: identity.toHexString(), token: tok };
        clients.push(c);
        resolve(c);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

function subscribe(c: Client, queries: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    c.conn.subscriptionBuilder().onApplied(() => resolve()).onError((ctx) => reject(new Error('subscription failed: ' + String((ctx as { event?: unknown }).event)))).subscribe(queries);
  });
}

const SESSION_TABLES = ['presence', 'world_branch', 'world_event', 'command_receipt', 'intervention', 'simulation_parameter', 'model_output', 'dependency_edge', 'simulation_clock', 'calculation_job', 'generated_asset'];
const subscribeAll = (c: Client, sessionId: string) =>
  subscribe(c, ['SELECT * FROM session_member', 'SELECT * FROM world_session', 'SELECT * FROM session_invite', ...SESSION_TABLES.map((t) => `SELECT * FROM ${t} WHERE session_id = '${sessionId}'`)]);

async function waitFor<T>(fn: () => T | undefined | null | false, ms = 15_000, label = 'condition'): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const branchRow = (c: Client, id: string) => c.conn.db.worldBranch.id.find(id);

async function submit(c: Client, branchId: string, action: string, parameters: Record<string, unknown>, opts: { source?: string; commandId?: string; expectedRevision?: number; targetId?: string } = {}) {
  const commandId = opts.commandId ?? `t-${rid()}`;
  const expectedRevision = opts.expectedRevision ?? branchRow(c, branchId)?.revision ?? 0;
  await c.conn.reducers.submitCommand({ branchId, commandId, expectedRevision, action, targetId: opts.targetId ?? '', parametersJson: JSON.stringify(parameters), source: opts.source ?? 'test' });
  return waitFor(() => c.conn.db.commandReceipt.commandKey.find(`${branchId}/${commandId}`), 15_000, `receipt ${commandId}`);
}

const outputOf = (c: Client, branchId: string, level: string) => {
  const o = c.conn.db.modelOutput.id.find(`${branchId}:${level}`);
  return o ? { ...o, summary: JSON.parse(o.summaryJson) as Record<string, number | string | boolean> } : undefined;
};
const ivsOf = (c: Client, branchId: string) => [...c.conn.db.intervention.iter()].filter((i) => i.branchId === branchId);

let owner: Client;
let editor: Client;
let sessionId: string;
let branchId: string;
let editorCode: string;
let viewerCode: string;

beforeAll(async () => {
  owner = await connect();
  editor = await connect();
  sessionId = `s-it-${rid()}`;
  branchId = `b-it-${rid()}`;
  await owner.conn.reducers.createSession({ sessionId, branchId, name: 'integration', displayName: 'Owner' });
  await subscribeAll(owner, sessionId);
  await waitFor(() => branchRow(owner, branchId), 15_000, 'branch');
  const invites = await waitFor(() => { const i = [...owner.conn.db.sessionInvite.iter()].filter((x) => x.sessionId === sessionId); return i.length === 2 ? i : undefined; }, 15_000, 'invites');
  editorCode = invites.find((i) => i.role === 'editor')!.code;
  viewerCode = invites.find((i) => i.role === 'viewer')!.code;
  await editor.conn.reducers.joinSession({ code: editorCode, displayName: 'Editor' });
  await subscribeAll(editor, sessionId);
  await waitFor(() => branchRow(editor, branchId), 15_000, 'editor sees branch');
}, 60_000);

afterAll(() => {
  for (const c of clients) c.conn.disconnect();
});

describe('SpacetimeDB authority', () => {
  it('A · two-client sync: an edit by one client appears for the other, with server-computed outputs', async () => {
    const r = await submit(owner, branchId, 'create_intervention', { kind: 'k1.network', params: { technology: 'solar', capacityPerRegion_W: 5e12 }, label: 'Global solar network' });
    expect(r.status).toBe('applied');
    const iv = await waitFor(() => ivsOf(editor, branchId).find((i) => i.kind === 'k1.network'), 15_000, 'editor sees intervention');
    expect(iv.label).toBe('Global solar network');
    const out = await waitFor(() => outputOf(editor, branchId, 'k1'), 15_000, 'editor sees k1 output');
    expect(Number(out.summary.usefulW)).toBeGreaterThan(0);
    expect(out.modelId).toBe('k1-regional-grid');
  });

  it('B · voice commands go through the same reducer under the speaker identity', async () => {
    const r = await submit(editor, branchId, 'create_intervention', { kind: 'k1.climate', params: { kind: 'orbital_shade', magnitude: 0.01 } }, { source: 'voice' });
    expect(r.status).toBe('applied');
    const ev = await waitFor(() => [...owner.conn.db.worldEvent.iter()].find((e) => e.branchId === branchId && e.commandId === r.commandId), 15_000, 'owner sees voice event');
    expect(ev.source).toBe('voice');
    expect(ev.author.toHexString()).toBe(editor.hex);
  });

  it('C · micro → macro: changing the film microstructure changes room illuminance; graph edges persisted', async () => {
    await submit(owner, branchId, 'set_capabilities', { capabilities: { kardashevLevel: 1, barrowLevel: 6 } });
    const c1 = await submit(owner, branchId, 'create_intervention', { kind: 'b4.window', params: { material: 'WO3', insertion_x: 0.35 } });
    expect(c1.status).toBe('applied');
    const dark = await waitFor(() => outputOf(editor, branchId, 'b4'), 15_000, 'b4 output');
    const id = c1.message.split(' ')[1]!;
    const c2 = await submit(editor, branchId, 'update_intervention', { id, params: { insertion_x: 0.02 } });
    expect(c2.status).toBe('applied');
    const clear = await waitFor(() => { const o = outputOf(owner, branchId, 'b4'); return o && o.inputHash !== dark.inputHash ? o : undefined; }, 15_000, 'b4 recompute');
    expect(Number(clear.summary.transmission)).toBeGreaterThan(Number(dark.summary.transmission));
    expect(Number(clear.summary.roomLux)).toBeGreaterThan(Number(dark.summary.roomLux));
    const edges = [...owner.conn.db.dependencyEdge.iter()].filter((e) => e.branchId === branchId && e.level === 'b4');
    expect(edges.map((e) => `${e.fromNode}>${e.toNode}`)).toEqual(expect.arrayContaining(['b4.lattice>b4.optics', 'b4.optics>b4.room']));
  });

  it('D · persistence: a fresh connection with the same identity sees identical state', async () => {
    const again = await connect(owner.token);
    expect(again.hex).toBe(owner.hex);
    await subscribeAll(again, sessionId);
    const b = await waitFor(() => branchRow(again, branchId), 15_000, 'branch after reconnect');
    expect(b.revision).toBe(branchRow(owner, branchId)!.revision);
    expect(ivsOf(again, branchId).map((i) => i.interventionId).sort()).toEqual(ivsOf(owner, branchId).map((i) => i.interventionId).sort());
  });

  it('E · stale revisions conflict; duplicate command ids are idempotent', async () => {
    const stale = await submit(owner, branchId, 'create_intervention', { kind: 'b6.device', params: {} }, { expectedRevision: 0 });
    expect(stale.status).toBe('conflict');
    expect(stale.latestRevision).toBeGreaterThan(0);
    const commandId = `dup-${rid()}`;
    const first = await submit(owner, branchId, 'create_intervention', { kind: 'b6.device', params: { eventRate_per_s: 1e14 } }, { commandId });
    expect(first.status).toBe('applied');
    const before = branchRow(owner, branchId)!.revision;
    const events = [...owner.conn.db.worldEvent.iter()].filter((e) => e.branchId === branchId).length;
    await owner.conn.reducers.submitCommand({ branchId, commandId, expectedRevision: before, action: 'create_intervention', targetId: '', parametersJson: '{"kind":"b6.device","params":{}}', source: 'test' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(branchRow(owner, branchId)!.revision).toBe(before);
    expect([...owner.conn.db.worldEvent.iter()].filter((e) => e.branchId === branchId).length).toBe(events);
  });

  it('F · permissions: viewers are rejected, non-members can neither read nor write', async () => {
    const viewer = await connect();
    await viewer.conn.reducers.joinSession({ code: viewerCode, displayName: 'Viewer' });
    await subscribeAll(viewer, sessionId);
    await waitFor(() => branchRow(viewer, branchId), 15_000, 'viewer reads branch');
    const r = await submit(viewer, branchId, 'create_intervention', { kind: 'k1.network', params: {} });
    expect(r.status).toBe('rejected');
    expect(r.message).toMatch(/viewer/i);
    expect([...viewer.conn.db.sessionInvite.iter()].filter((i) => i.sessionId === sessionId)).toHaveLength(0); // invites hidden from viewers

    const stranger = await connect();
    await subscribeAll(stranger, sessionId);
    expect(branchRow(stranger, branchId)).toBeFalsy();
    expect([...stranger.conn.db.intervention.iter()]).toHaveLength(0);
    await expect(stranger.conn.reducers.submitCommand({ branchId, commandId: `x-${rid()}`, expectedRevision: 0, action: 'reset', targetId: '', parametersJson: '{}', source: 'test' })).rejects.toBeTruthy();
    await expect(stranger.conn.reducers.completeJob({ jobId: 'nope', url: 'x', model: 'x', label: 'x' })).rejects.toBeTruthy();
  });

  const workerUp = existsSync(new URL('../../backend/.worker_identity.json', import.meta.url));
  it.skipIf(!workerUp)('G · async jobs: a result for a superseded state is rejected as stale', async () => {
    const commandId = `img-${rid()}`;
    await owner.conn.reducers.requestImagine({ branchId, commandId, level: 'k1', style: 'cinematic' });
    const jobId = `${branchId}:${commandId}`;
    await waitFor(() => owner.conn.db.calculationJob.id.find(jobId), 10_000, 'job row');
    // Change the K1 state before the worker can finish rendering.
    const iv = ivsOf(owner, branchId).find((i) => i.kind === 'k1.network')!;
    expect((await submit(owner, branchId, 'update_intervention', { id: iv.interventionId, params: { capacityPerRegion_W: 9e12 } })).status).toBe('applied');
    const job = await waitFor(() => { const j = owner.conn.db.calculationJob.id.find(jobId); return j && ['stale', 'done', 'failed'].includes(j.status) ? j : undefined; }, 90_000, 'job finish');
    expect(job.status).toBe('stale');
    expect(owner.conn.db.generatedAsset.id.find(jobId)).toBeFalsy();
  }, 120_000);

  it('H · the scheduled clock advances shared time and refreshes time-dependent outputs', async () => {
    await submit(owner, branchId, 'set_capabilities', { capabilities: { kardashevLevel: 3, barrowLevel: 6 } });
    expect((await submit(owner, branchId, 'create_intervention', { kind: 'k3.expansion', params: { speed_c: 0.1, settlementDelay_yr: 50 } })).status).toBe('applied');
    const cmd = async (action: string, value = 0) => {
      const commandId = `clk-${rid()}`;
      await owner.conn.reducers.clockControl({ branchId, commandId, action, value, source: 'test' });
      return waitFor(() => owner.conn.db.commandReceipt.commandKey.find(`${branchId}/${commandId}`), 10_000, 'clock receipt');
    };
    expect((await cmd('set_rate', 2000 * YEAR)).status).toBe('applied');
    expect((await cmd('play')).status).toBe('applied');
    const t0 = owner.conn.db.simulationClock.branchId.find(branchId)!.simSeconds;
    const advanced = await waitFor(() => { const c = editor.conn.db.simulationClock.branchId.find(branchId); return c && c.simSeconds > t0 + 1000 * YEAR ? c : undefined; }, 15_000, 'clock advance');
    expect(advanced.running).toBe(true);
    const k3 = await waitFor(() => { const o = outputOf(editor, branchId, 'k3'); return o && o.clockSeconds > 0 ? o : undefined; }, 15_000, 'k3 refresh');
    expect(Number(k3.summary.settledCount)).toBeGreaterThan(0);
    expect((await cmd('pause')).status).toBe('applied');
    const paused = owner.conn.db.simulationClock.branchId.find(branchId)!.simSeconds;
    await new Promise((r) => setTimeout(r, 2500));
    expect(owner.conn.db.simulationClock.branchId.find(branchId)!.simSeconds).toBe(paused);
    expect((await cmd('seek', 100 * YEAR)).status).toBe('applied');
    await waitFor(() => Math.abs((outputOf(owner, branchId, 'k3')?.clockSeconds ?? 0) - 100 * YEAR) < 1, 10_000, 'seek recompute');
  }, 60_000);

  it('I · undo, redo and reset are authoritative and shared', async () => {
    const n = ivsOf(owner, branchId).length;
    expect((await submit(editor, branchId, 'undo', {})).status).toBe('applied');
    await waitFor(() => ivsOf(owner, branchId).length === n - 1, 10_000, 'undo visible');
    expect((await submit(owner, branchId, 'redo', {})).status).toBe('applied');
    await waitFor(() => ivsOf(editor, branchId).length === n, 10_000, 'redo visible');
    expect((await submit(owner, branchId, 'reset', {})).status).toBe('applied');
    await waitFor(() => ivsOf(editor, branchId).length === 0, 10_000, 'reset visible');
    expect(branchRow(editor, branchId)!.cursor).toBe(0);
    expect(outputOf(editor, branchId, 'k1')).toBeUndefined();
  });
});
