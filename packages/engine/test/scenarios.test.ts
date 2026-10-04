import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScienceBundle } from '../src/bundle.js';
import type { Command } from '../src/types.js';
import { CosmosWorld } from '../src/world.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/data/tables');
const YEAR = 365.25 * 86400;
let world: CosmosWorld;
let n = 0;

function cmd(branchId: string, action: string, parameters: Record<string, unknown> = {}): Command {
  const b = world.getBranch(branchId)!;
  return { commandId: `t${++n}`, branchId, action, parameters, expectedRevision: b.revision, actor: 'test' } as unknown as Command;
}
function run(branchId: string, action: string, parameters: Record<string, unknown> = {}) {
  const r = world.execute(cmd(branchId, action, parameters));
  if (!r.ok) throw new Error(`${action}: ${r.errors?.join('; ')}`);
  return r;
}
const s = (branchId: string, level: string, clock = 0) => world.project(branchId, clock)!.outputs[level as 'k1']!;

beforeAll(() => {
  const tables: Record<string, unknown[]> = {};
  for (const f of readdirSync(DIR)) if (f.endsWith('.json')) tables[f.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  world = new CosmosWorld(buildScienceBundle(tables as never));
});

describe('K1 — global solar network', () => {
  it('builds, scales capacity and reports regional surplus', () => {
    world.createBranch('k1');
    const c = run('k1', 'create_intervention', { kind: 'k1.network', params: { technology: 'solar', capacityPerRegion_W: 2e12 } });
    const before = s('k1', 'k1');
    run('k1', 'update_intervention', { id: c.event!.targetId, params: { capacityPerRegion_W: 2e13 } });
    const after = s('k1', 'k1');
    expect(Number(after.summary.usefulW)).toBeGreaterThan(Number(before.summary.usefulW));
    const view = after.view as { regions: { id: string; localBalanceW: number; status: string }[] };
    expect(view.regions.some((r) => r.localBalanceW > 0 && r.status === 'surplus')).toBe(true);
    expect(after.nodes.length).toBeGreaterThan(0);
  });
  it('rejects out-of-range and unknown params', () => {
    world.createBranch('k1b');
    expect(world.execute(cmd('k1b', 'create_intervention', { kind: 'k1.network', params: { capacityPerRegion_W: -5 } })).ok).toBe(false);
    expect(world.execute(cmd('k1b', 'create_intervention', { kind: 'k1.network', params: { bogus: 1 } })).ok).toBe(false);
  });
});

describe('K2 — Dyson swarm + Mars habitat', () => {
  it('requires K2 capability, then delivers power to the habitat', () => {
    world.createBranch('k2');
    expect(world.execute(cmd('k2', 'create_intervention', { kind: 'k2.swarm', params: { captureFraction: 0.3 } })).ok).toBe(false);
    run('k2', 'set_capabilities', { capabilities: { kardashevLevel: 2 } });
    run('k2', 'create_intervention', { kind: 'k2.swarm', params: { captureFraction: 0.3 } });
    run('k2', 'create_intervention', { kind: 'k2.habitat', params: { bodyId: 'body.mars', demand_W: 1e17 } });
    const out = s('k2', 'k2', 1e12);
    expect(Number(out.summary.usefulW)).toBeGreaterThan(1e24);
    expect(Number(out.summary.deliveredW)).toBeGreaterThan(0);
  });
});

describe('K3 — expansion at 0.1c, 50-year settlement', () => {
  it('fronts advance with the clock; singleton enforced', () => {
    world.createBranch('k3');
    run('k3', 'set_capabilities', { capabilities: { kardashevLevel: 3 } });
    run('k3', 'create_intervention', { kind: 'k3.expansion', params: { speed_c: 0.1, settlementDelay_yr: 50, buildSwarms: true } });
    const early = s('k3', 'k3', 200 * YEAR);
    const late = s('k3', 'k3', 5000 * YEAR);
    expect(Number(late.summary.settledCount)).toBeGreaterThan(Number(early.summary.settledCount));
    expect(Number(late.summary.sampleW)).toBeGreaterThan(0);
    expect(world.execute(cmd('k3', 'create_intervention', { kind: 'k3.expansion', params: {} })).ok).toBe(false);
  });
});

describe('B2 — HBB repair', () => {
  it('sickle variant lowers O2 delivery; applying reference restores it', () => {
    world.createBranch('b2');
    run('b2', 'set_capabilities', { capabilities: { barrowLevel: 2 } });
    run('b2', 'create_intervention', { kind: 'b2.edit', params: { variantRsId: 'rs334', operation: 'introduce' } });
    const sick = s('b2', 'b2');
    run('b2', 'create_intervention', { kind: 'b2.edit', params: { variantRsId: 'rs334', operation: 'repair' } });
    const fixed = s('b2', 'b2');
    expect(sick.summary.phenotype).toBe('sickle');
    expect(fixed.summary.phenotype).toBe('normal');
    expect(Number(sick.summary.oxygenDelivery)).toBeLessThan(Number(fixed.summary.oxygenDelivery));
  });
});

describe('B4 — window transparency', () => {
  it('lower insertion raises WO3 transmission and room illuminance', () => {
    world.createBranch('b4');
    run('b4', 'set_capabilities', { capabilities: { barrowLevel: 4 } });
    const c = run('b4', 'create_intervention', { kind: 'b4.window', params: { material: 'WO3', insertion_x: 0.3 } });
    const dark = s('b4', 'b4');
    run('b4', 'update_intervention', { id: c.event!.targetId, params: { insertion_x: 0.02 } });
    const clear = s('b4', 'b4');
    expect(Number(clear.summary.transmission)).toBeGreaterThan(Number(dark.summary.transmission));
    expect(Number(clear.summary.roomLux)).toBeGreaterThan(Number(dark.summary.roomLux));
  });
});

describe('B6 — annihilation device', () => {
  it('rate increase raises usable power; gross > electrical; supply accounted', () => {
    world.createBranch('b6');
    run('b6', 'set_capabilities', { capabilities: { barrowLevel: 6 } });
    const c = run('b6', 'create_intervention', { kind: 'b6.device', params: { eventRate_per_s: 1e12 } });
    const lo = s('b6', 'b6');
    run('b6', 'update_intervention', { id: c.event!.targetId, params: { eventRate_per_s: 1e16 } });
    const hi = s('b6', 'b6');
    expect(Number(hi.summary.electricalW)).toBeGreaterThan(Number(lo.summary.electricalW));
    expect(Number(hi.summary.grossW)).toBeGreaterThan(Number(hi.summary.electricalW));
    expect(Number(hi.summary.supplyInputW)).toBeGreaterThan(0);
    expect(Number(hi.summary.litFraction)).toBeGreaterThanOrEqual(Number(lo.summary.litFraction));
    expect(hi.summary.balanced).toBe(true);
  });
});

describe('Branch semantics', () => {
  it('undo / redo / reset, duplicates and stale revisions', () => {
    world.createBranch('h');
    const c1 = cmd('h', 'set_capabilities', { capabilities: { barrowLevel: 6 } });
    expect(world.execute(c1).ok).toBe(true);
    expect(world.execute(c1).duplicate).toBe(true);
    expect(world.execute({ ...cmd('h', 'navigate_to'), expectedRevision: 0 }).conflict).toBeTruthy();
    run('h', 'create_intervention', { kind: 'b6.device', params: {} });
    expect(world.project('h')!.interventions.length).toBe(1);
    run('h', 'undo');
    expect(world.project('h')!.interventions.length).toBe(0);
    run('h', 'redo');
    expect(world.project('h')!.interventions.length).toBe(1);
    run('h', 'reset');
    expect(world.project('h')!.interventions.length).toBe(0);
    expect(world.project('h')!.capabilities.barrowLevel).toBe(1);
  });
  it('projection is memoised and hashed deterministically', () => {
    const a = s('k1', 'k1');
    expect(a.inputHash).toMatch(/^[0-9a-f]{8}$/);
    expect(s('k1', 'k1')).toBe(a);
  });
  it('compare reports per-level differences', () => {
    const c = world.compare('k1', 'k1b')!;
    expect(c.levels.find((l) => l.level === 'k1')!.a).not.toBeNull();
    expect(c.interventionDiff.onlyA.length).toBe(1);
  });
});
