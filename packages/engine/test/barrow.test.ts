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
const run = (b: string, action: string, parameters: Record<string, unknown>) => {
  const r = world.execute({ commandId: `b${++n}`, branchId: b, action, parameters, targetId: '', expectedRevision: world.getBranch(b)!.revision } as Command);
  if (!r.ok) throw new Error(r.errors?.join('; '));
  return r;
};
const view = <T>(b: string, l: 'b2' | 'b4' | 'b6') => world.project(b)!.outputs[l]!.view as T;

beforeAll(() => {
  const tables: Record<string, unknown[]> = {};
  for (const f of readdirSync(DIR)) if (f.endsWith('.json')) tables[f.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  world = new CosmosWorld(buildScienceBundle(tables as never));
});

describe('B2 free base editing → population', () => {
  it('classifies synonymous, curated missense and nonsense edits from the protein', () => {
    world.createBranch('g1');
    run('g1', 'set_capabilities', { capabilities: { barrowLevel: 2 } });
    run('g1', 'create_intervention', { kind: 'b2.base_edit', params: { position: 6, alt: 'A' } }); // GTG→GTA Val→Val
    let v = view<{ phenotype: string; mutations: { effect: string }[] }>('g1', 'b2');
    expect(v.mutations[0]!.effect).toBe('synonymous');
    expect(v.phenotype).toBe('normal');
    run('g1', 'create_intervention', { kind: 'b2.base_edit', params: { position: 20, alt: 'T' } }); // GAG→GTG Glu→Val (HbS)
    v = view('g1', 'b2');
    expect(v.mutations[1]!.effect).toBe('missense');
    expect(v.phenotype).toBe('sickle');
    world.createBranch('g2');
    run('g2', 'set_capabilities', { capabilities: { barrowLevel: 2 } });
    run('g2', 'create_intervention', { kind: 'b2.base_edit', params: { position: 19, alt: 'T' } }); // GAG→TAG stop
    expect(view<{ phenotype: string }>('g2', 'b2').phenotype).toBe('absent_beta');
  });

  it('population outcome scales with the edited fraction', () => {
    world.createBranch('g3');
    run('g3', 'set_capabilities', { capabilities: { barrowLevel: 2 } });
    run('g3', 'create_intervention', { kind: 'b2.base_edit', params: { position: 20, alt: 'T' } });
    run('g3', 'create_intervention', { kind: 'b2.population', params: { size: 1000, editedFraction: 0.5 } });
    const v = view<{ oxygenDeliveryRelative: number; population: { meanOxygenDelivery: number; symptomatic: number } }>('g3', 'b2');
    expect(v.population.symptomatic).toBe(500);
    expect(v.population.meanOxygenDelivery).toBeCloseTo(0.5 * v.oxygenDeliveryRelative + 0.5, 6);
  });
});

describe('B4 placed ions → city energy', () => {
  it('ions placed in the lattice set x; city totals scale with rooms', () => {
    world.createBranch('w1');
    run('w1', 'set_capabilities', { capabilities: { barrowLevel: 4 } });
    run('w1', 'create_intervention', { kind: 'b4.window', params: { occupiedSites: '1,2,3,4,5' } });
    run('w1', 'create_intervention', { kind: 'b4.city', params: { buildings: 100, roomsPerBuilding: 10 } });
    const v = view<{ window: { x: number; room: { totalW: number }; city: { rooms: number; totalW: number } } }>('w1', 'b4').window;
    expect(v.x).toBeCloseTo(5 / 125, 9);
    expect(v.city.rooms).toBe(1000);
    expect(v.city.totalW).toBeCloseTo(v.room.totalW * 1000, 3);
  });
});

describe('B6 species → city grid', () => {
  it('p p̄ releases (m_p+T)/(m_e+T) more per event than e⁺e⁻ (PDG masses) and lights the city', () => {
    world.createBranch('p1');
    run('p1', 'set_capabilities', { capabilities: { barrowLevel: 6 } });
    const c = run('p1', 'create_intervention', { kind: 'b6.device', params: { eventRate_per_s: 1e16 } });
    run('p1', 'create_intervention', { kind: 'b6.city', params: { households: 1000, demandPerHousehold_W: 1000 } });
    const e = view<{ device: { energyPerEventJ: number; city: { litFraction: number } } }>('p1', 'b6').device;
    run('p1', 'update_intervention', { id: c.event!.targetId, params: { species: 'proton' } });
    const p = view<{ device: { energyPerEventJ: number; escapedW: number; city: { litFraction: number } } }>('p1', 'b6').device;
    expect(p.energyPerEventJ / e.energyPerEventJ).toBeCloseTo((938.272 + 0.5) / (0.511 + 0.5), 0);
    expect(p.escapedW).toBeGreaterThan(0);
    expect(p.city.litFraction).toBeGreaterThanOrEqual(e.city.litFraction);
  });
});
