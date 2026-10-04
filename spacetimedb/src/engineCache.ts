import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import { CosmosWorld, buildScienceBundle } from '../../packages/engine/src/index';
import type spacetimedb from './schema';
import { SCIENCE_SPEC } from './science';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const ENGINE_TABLES = [
  'dataset_manifest', 'decay_radiation', 'earth_city', 'energy_record', 'exoplanet_system', 'gaia_star', 'gene_record',
  'horizons_body', 'ionization_energy', 'molecule', 'named_star', 'nist_level', 'nist_line', 'nuclide', 'pdb_atom',
  'pdb_entry', 'pdg_particle', 'planet_fact', 'sequence_record', 'spice_constant', 'variant_record',
];

/** Engine built from the science tables, cached for the lifetime of the module instance. */
let WORLD: CosmosWorld | null = null;

/** Drop the cached engine (science tables changed). */
export function invalidateWorld(): void {
  WORLD = null;
}

export function engine(ctx: Ctx): CosmosWorld {
  if (WORLD) return WORLD;
  const db = ctx.db as unknown as Record<string, { iter(): Iterable<Record<string, unknown>> }>;
  const tables: Record<string, unknown[]> = {};
  for (const name of ENGINE_TABLES) {
    const spec = SCIENCE_SPEC[name];
    if (!spec) continue;
    // Optional columns arrive as undefined; the engine expects null like the JSON cache.
    tables[name] = [...db[spec[0]]!.iter()].map((r) => {
      const o: Record<string, unknown> = {};
      for (const k in r) o[k] = r[k] === undefined ? null : r[k];
      return o;
    });
  }
  WORLD = new CosmosWorld(buildScienceBundle(tables as never));
  return WORLD;
}

