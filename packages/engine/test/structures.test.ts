import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScienceBundle } from '../src/bundle.js';
import { resolveEntity, searchEntities } from '../src/entities.js';
import type { Command } from '../src/types.js';
import { CosmosWorld } from '../src/world.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/data/tables');
let world: CosmosWorld;
let n = 0;
const cmd = (b: string, action: string, parameters: Record<string, unknown>) =>
  world.execute({ commandId: `s${++n}`, branchId: b, action, parameters, targetId: '', expectedRevision: world.getBranch(b)!.revision } as Command);

beforeAll(() => {
  const tables: Record<string, unknown[]> = {};
  for (const f of readdirSync(DIR)) if (f.endsWith('.json')) tables[f.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  world = new CosmosWorld(buildScienceBundle(tables as never));
});

describe('entity resolution', () => {
  it('resolves bodies and stars by name and alias', () => {
    const sci = world.ctx.science;
    expect(resolveEntity(sci, 'the moon')?.id).toBe('body.moon');
    expect(resolveEntity(sci, 'Vega')?.id).toBe('star.vega');
    expect(resolveEntity(sci, 'jupiter')?.id).toBe('body.jupiter');
    expect(resolveEntity(sci, 'alpha centauri')?.id).toBe('star.rigel_kentaurus');
    expect(searchEntities(sci, 'Sirius').length).toBeGreaterThan(0);
  });
});

describe('free building', () => {
  it('harnesses the Moon (K2) with physically scaled output', () => {
    world.createBranch('m');
    cmd('m', 'set_capabilities', { capabilities: { kardashevLevel: 2 } });
    const r = cmd('m', 'create_intervention', { kind: 'build.structure', params: { hostId: 'moon', type: 'surface_collectors', coverage: 0.5, efficiency: 0.3 } });
    expect(r.ok).toBe(true);
    const p = world.project('m')!;
    expect(p.interventions[0]!.params.hostId).toBe('body.moon'); // canonicalised
    expect(p.interventions[0]!.level).toBe('k2');
    const st = (p.outputs.k2!.view as { structures: { usefulW: number; label: string }[] }).structures[0]!;
    // ~1361 W/m² × π(1737 km)² × 0.5 × 0.3 ≈ 1.9e15 W
    expect(st.usefulW).toBeGreaterThan(1e15);
    expect(st.usefulW).toBeLessThan(4e15);
    expect(st.label).toMatch(/Moon/);
  });

  it('builds a Dyson swarm at Vega (K3) without an expansion scenario', () => {
    world.createBranch('v');
    expect(cmd('v', 'set_capabilities', { capabilities: { kardashevLevel: 2 } }).ok).toBe(true);
    const denied = cmd('v', 'create_intervention', { kind: 'build.structure', params: { hostId: 'Vega', type: 'dyson_swarm', coverage: 0.2 } });
    expect(denied.ok).toBe(false); // other stars need K3
    cmd('v', 'set_capabilities', { capabilities: { kardashevLevel: 3 } });
    expect(cmd('v', 'create_intervention', { kind: 'build.structure', params: { hostId: 'Vega', type: 'dyson_swarm', coverage: 0.2 } }).ok).toBe(true);
    const out = world.project('v')!.outputs.k3!;
    expect(Number(out.summary.structuresW)).toBeGreaterThan(5e26); // Vega ≈ 49 L☉ × 0.2 × 0.25
  });

  it('rejects unknown hosts and invalid host/type pairs are flagged', () => {
    world.createBranch('x');
    cmd('x', 'set_capabilities', { capabilities: { kardashevLevel: 2 } });
    expect(cmd('x', 'create_intervention', { kind: 'build.structure', params: { hostId: 'Planet Nine' } }).ok).toBe(false);
    expect(cmd('x', 'create_intervention', { kind: 'build.structure', params: { hostId: 'jupiter', type: 'surface_collectors' } }).ok).toBe(true);
    expect(world.project('x')!.outputs.k2!.warnings.join(' ')).toMatch(/no surface/);
  });

  it('gas harvester at Jupiter powers a habitat on Europa', () => {
    world.createBranch('j');
    cmd('j', 'set_capabilities', { capabilities: { kardashevLevel: 2 } });
    cmd('j', 'create_intervention', { kind: 'build.structure', params: { hostId: 'jupiter', type: 'gas_harvester', harvestRate_kgps: 1e4, efficiency: 0.4 } });
    cmd('j', 'create_intervention', { kind: 'build.structure', params: { hostId: 'europa', type: 'habitat', demand_W: 1e18 } });
    const sts = (world.project('j')!.outputs.k2!.view as { structures: { type: string; servedFraction: number; usefulW: number }[] }).structures;
    expect(sts.find((s) => s.type === 'gas_harvester')!.usefulW).toBeCloseTo(1e4 * 3.4e14 * 0.4, -10);
    expect(sts.find((s) => s.type === 'habitat')!.servedFraction).toBeCloseTo(1, 5);
  });
});
