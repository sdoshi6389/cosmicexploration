import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScienceBundle } from '../src/bundle.js';
import type { Command } from '../src/types.js';
import { CosmosWorld } from '../src/world.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/data/tables');
let world: CosmosWorld;
let n = 0;
const exec = (b: string, action: string, parameters: Record<string, unknown>) =>
  world.execute({ commandId: `f${++n}`, branchId: b, action, parameters, targetId: '', expectedRevision: world.getBranch(b)!.revision } as Command);
const civ = (id: string, k: number, b: number) => {
  world.createBranch(id);
  exec(id, 'set_capabilities', { capabilities: { kardashevLevel: k, barrowLevel: b } });
};
const build = (b: string, kind: string, params: Record<string, unknown>) => exec(b, 'create_intervention', { kind, params });

beforeAll(() => {
  const tables: Record<string, unknown[]> = {};
  for (const f of readdirSync(DIR)) if (f.endsWith('.json')) tables[f.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  world = new CosmosWorld(buildScienceBundle(tables as never));
});

describe('civilisation limits', () => {
  it('K1 reaches Earth and the Moon only', () => {
    civ('a', 1, 1);
    expect(build('a', 'build.structure', { hostId: 'moon', type: 'surface_collectors', coverage: 0.2 }).ok).toBe(true);
    const mars = build('a', 'build.structure', { hostId: 'mars', type: 'surface_collectors' });
    expect(mars.ok).toBe(false);
    expect(mars.errors![0]).toMatch(/K2/);
  });

  it('K1 energy budget: stacking past Earth’s sunlight needs K2', () => {
    civ('b', 1, 1);
    expect(build('b', 'k1.network', { capacityPerRegion_W: 2e16 }).ok).toBe(true); // 1.2×10¹⁷ W
    const r = build('b', 'k1.network', { capacityPerRegion_W: 2e16, technology: 'fusion' });
    expect(r.ok).toBe(false);
    expect(r.errors![0]).toMatch(/budget/);
    expect(r.errors![0]).toMatch(/K2/);
  });

  it('K2 can capture the whole Sun but not another star', () => {
    civ('c', 2, 1);
    expect(build('c', 'build.structure', { hostId: 'sun', type: 'dyson_sphere', coverage: 1 }).ok).toBe(true);
    const vega = build('c', 'build.structure', { hostId: 'Vega', type: 'dyson_swarm' });
    expect(vega.ok).toBe(false);
    expect(vega.errors![0]).toMatch(/another star system/);
    expect(vega.errors![0]).toMatch(/K3/);
  });

  it('Barrow depth gates genes, atoms and particles', () => {
    civ('d', 1, 2);
    expect(build('d', 'b2.base_edit', { position: 20, alt: 'T' }).ok).toBe(true);
    const atoms = build('d', 'b4.window', { occupiedSites: '1,2,3' });
    expect(atoms.ok).toBe(false);
    expect(atoms.errors![0]).toMatch(/B4/);
    const anti = build('d', 'b6.device', {});
    expect(anti.ok).toBe(false);
    expect(anti.errors![0]).toMatch(/B6/);
  });

  it('nothing exceeds a galaxy', () => {
    civ('e', 3, 6);
    const r = build('e', 'b6.device', { species: 'proton', eventRate_per_s: 1e22, units: 1e5 });
    expect(r.ok).toBe(true); // ~3×10¹⁷ W
    for (let i = 0; i < 3; i++) build('e', 'build.structure', { hostId: ['Deneb', 'Rigel', 'Betelgeuse'][i]!, type: 'dyson_sphere' });
    const huge = build('e', 'k1.network', { capacityPerRegion_W: 2e16 });
    expect(huge.ok).toBe(true);
  });
});
