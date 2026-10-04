import type { BaselineContext } from './baseline/fromScience.js';
import { AU_M, LSUN_W, PARSEC_M, type ScienceBundle } from './science.js';

/**
 * Every addressable object in the baseline: the Sun, planets, moons, dwarf planets
 * and asteroids from JPL Horizons, and every Gaia DR3 / SIMBAD star. Used to resolve
 * free-text references ("the Moon", "Vega", "gaia.4049506483413484672") for
 * navigation and for building structures anywhere.
 */
export interface EntityRef {
  id: string;
  name: string;
  /** star | planet | moon | dwarf | asteroid | spacecraft */
  kind: string;
  /** 'sol' for Solar-System objects; the star id for other systems. */
  system: string;
  /** Heliocentric position, metres (ICRF for bodies, ICRS for stars). */
  positionM: [number, number, number];
  radiusKm: number | null;
  massKg: number | null;
  /** Luminosity in watts (stars only). */
  luminosityW: number | null;
  parentId: string | null;
  /** Distance from the Sun: AU for bodies, parsecs for stars. */
  distance: number;
  distanceUnit: 'AU' | 'pc';
}

const ALIASES: Record<string, string> = {
  sun: 'body.sun', sol: 'body.sun', 'the sun': 'body.sun', 'star.sol': 'body.sun', moon: 'body.moon', luna: 'body.moon', 'the moon': 'body.moon',
  'earths moon': 'body.moon', 'alpha centauri': 'star.rigel_kentaurus', 'alpha centauri a': 'star.rigel_kentaurus', 'alpha centauri b': 'star.toliman',
  'rigil kentaurus': 'star.rigel_kentaurus', polaris: 'star.lodestar', 'north star': 'star.lodestar', 'pole star': 'star.lodestar', sirius: 'star.sirius_a',
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();

const cache = new WeakMap<ScienceBundle, { byId: Map<string, EntityRef>; list: EntityRef[]; byName: Map<string, EntityRef[]> }>();

export function entityIndex(science: ScienceBundle) {
  const hit = cache.get(science);
  if (hit) return hit;
  const list: EntityRef[] = [];
  for (const b of science.bodies) {
    const d = Math.hypot(...b.positionM) / AU_M;
    list.push({
      id: b.id, name: b.name, kind: b.id === 'body.sun' ? 'star' : b.kind, system: 'sol', positionM: b.positionM, radiusKm: b.radiusKm, massKg: b.massKg,
      luminosityW: b.id === 'body.sun' ? science.sun.luminosityW.value : null, parentId: b.parentId ?? null, distance: d, distanceUnit: 'AU',
    });
  }
  for (const s of science.stars) {
    if (s.id === 'star.sol') continue;
    list.push({
      id: s.id, name: s.name ?? `Gaia DR3 ${s.id.replace('gaia.', '')}`, kind: 'star', system: s.id, positionM: s.positionM, radiusKm: null, massKg: null,
      luminosityW: s.luminosityLsun != null ? s.luminosityLsun * LSUN_W : null, parentId: null, distance: Math.hypot(...s.positionM) / PARSEC_M, distanceUnit: 'pc',
    });
  }
  const byId = new Map(list.map((e) => [e.id, e]));
  const byName = new Map<string, EntityRef[]>();
  for (const e of list) {
    for (const key of new Set([norm(e.name), norm(e.id), norm(e.id.split('.').slice(1).join(' ').replace(/_/g, ' '))])) {
      if (!key) continue;
      const arr = byName.get(key) ?? [];
      arr.push(e);
      byName.set(key, arr);
    }
  }
  const out = { byId, list, byName };
  cache.set(science, out);
  return out;
}

/** Ranked matches for a free-text query (exact id/name, alias, prefix, then substring). */
export function searchEntities(science: ScienceBundle, query: string, limit = 8): EntityRef[] {
  const idx = entityIndex(science);
  const q = norm(query).replace(/^(the|star|planet|moon of)\s+/, '');
  if (!q) return [];
  const direct = idx.byId.get(query) ?? idx.byId.get(ALIASES[q] ?? '');
  if (direct) return [direct];
  const exact = idx.byName.get(q);
  if (exact?.length) return exact.slice(0, limit);
  const scored: [number, EntityRef][] = [];
  for (const e of idx.list) {
    const n = norm(e.name);
    if (!n.includes(q) && !q.includes(n)) continue;
    // Prefer named objects, Solar-System bodies, then nearer stars.
    const score = (n.startsWith(q) ? 0 : 1) + (e.system === 'sol' ? 0 : 0.5) + (e.name.startsWith('Gaia DR3') ? 2 : 0) + Math.min(1, e.distance / 1000);
    scored.push([score, e]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map((x) => x[1]);
}

export function resolveEntity(science: ScienceBundle, query: string): EntityRef | undefined {
  return searchEntities(science, query, 1)[0];
}

/** Suggestions for UI pickers: all Solar-System bodies and named stars. */
export function entitySuggestions(ctx: BaselineContext): { value: string; label: string }[] {
  return entityIndex(ctx.science).list
    .filter((e) => e.kind !== 'spacecraft' && !e.name.startsWith('Gaia DR3'))
    .map((e) => ({ value: e.id, label: e.system === 'sol' ? `${e.name} (${e.kind})` : `${e.name} · ${e.distance.toFixed(1)} pc` }));
}
