import type { BaselineContext } from './baseline/fromScience.js';
import { entityIndex, resolveEntity, type EntityRef } from './entities.js';
import { interventionKind } from './interventions.js';
import { computeStructures } from './models/structures.js';
import { MEV_TO_JOULE } from './models/constants.js';
import type { CapabilityState, Intervention } from './types.js';

/**
 * What a civilisation at a given capability can physically do.
 *
 *  Kardashev (energy + reach) — power budgets anchored to real quantities:
 *   K1 · all sunlight intercepted by Earth (~1.7×10¹⁷ W); reach: Earth and the Moon.
 *   K2 · the Sun's luminosity (3.8×10²⁶ W); reach: the whole Solar System.
 *   K3 · a galaxy's luminosity (~10³⁷ W); reach: any star.
 *  Barrow (manipulation depth) — B2 genes, B4 atoms/materials, B6 elementary particles.
 *
 * Applied to the branch's state *after* a proposed change; failures explain the
 * limit and name the lowest civilisation where the request would work.
 */
export const K_BUDGET_W: Record<1 | 2 | 3, number> = { 1: 2e17, 2: 3.9e26, 3: 1e37 };
export const K_NAMES = ['', 'Kardashev I (planetary)', 'Kardashev II (stellar)', 'Kardashev III (galactic)'];
export const B_NAMES = ['', 'Barrow I', 'Barrow II (genes)', 'Barrow III (molecules)', 'Barrow IV (atoms)', 'Barrow V (nuclei)', 'Barrow VI (particles)'];

const K1_REACH = new Set(['body.earth', 'body.moon']);

export interface Feasibility {
  ok: boolean;
  requiredKardashev: number;
  requiredBarrow: number;
  /** Total power the branch would command after the change (W). */
  totalPowerW: number;
  reasons: string[];
  suggestion: string | null;
}

/** Power an intervention captures or produces (nameplate/gross, W). */
export function interventionPowerW(iv: Intervention, ctx: BaselineContext): number {
  const p = iv.params;
  const n = (k: string, d: number) => (typeof p[k] === 'number' && Number.isFinite(p[k] as number) ? (p[k] as number) : d);
  switch (iv.kind) {
    case 'k1.network':
      return n('capacityPerRegion_W', 5e12) * (p.regions === 'all' || p.regions === undefined ? 6 : 1);
    case 'k1.facility':
      return n('capacity_W', 1e12);
    case 'k2.swarm':
      return ctx.sunLuminosityW.value * n('captureFraction', 0.3) * n('construction', 1);
    case 'build.structure': {
      const idx = entityIndex(ctx.science);
      const r = computeStructures({ interventions: [iv], resolve: (id) => idx.byId.get(id) ?? resolveEntity(ctx.science, id), sunLuminosityW: ctx.sunLuminosityW.value, defaultLuminosityW: 0.5 * 3.828e26 });
      return r.items[0]?.interceptedW ?? 0;
    }
    case 'b6.device': {
      const species = p.species === 'proton' ? 'proton' : 'electron';
      const m = species === 'proton' ? ctx.science.particles.find((x) => x.mcId === 2212)?.massMeV ?? 938.272 : ctx.electronMassMeV.value;
      return n('eventRate_per_s', 1e14) * n('units', 1) * 2 * (m + n('kineticEnergy_MeV', 0.5)) * MEV_TO_JOULE;
    }
    default:
      return 0;
  }
}

/** Kardashev level needed to reach an entity. */
export function reachLevel(e: EntityRef | undefined): number {
  if (!e) return 1;
  if (e.system !== 'sol') return 3;
  return K1_REACH.has(e.id) ? 1 : 2;
}

function reachOf(iv: Intervention, ctx: BaselineContext): { k: number; what: string } {
  const p = iv.params;
  if (iv.kind === 'build.structure') {
    const e = resolveEntity(ctx.science, String(p.hostId ?? ''));
    return { k: reachLevel(e), what: e ? `${e.name}${e.system === 'sol' ? '' : ` (${e.distance.toFixed(1)} pc away)`}` : String(p.hostId) };
  }
  if (iv.kind === 'k2.habitat') {
    const e = resolveEntity(ctx.science, String(p.bodyId ?? ''));
    return { k: 2, what: e?.name ?? 'the Solar System' };
  }
  const kind = interventionKind(iv.kind);
  return { k: kind?.minKardashev ?? 1, what: kind?.label ?? iv.kind };
}

export function assessFeasibility(ctx: BaselineContext, caps: CapabilityState, interventions: Intervention[], changed: Intervention): Feasibility {
  const kind = interventionKind(changed.kind);
  const reasons: string[] = [];
  const reach = reachOf(changed, ctx);
  let needK = Math.max(changed.level.startsWith('k') ? 1 : 0, kind?.minKardashev ?? 0, reach.k);
  const needB = kind?.minBarrow ?? 1;
  // Energy budget: everything the branch commands after this change.
  const total = interventions.reduce((s, iv) => s + interventionPowerW(iv, ctx), 0);
  const energyK = total <= K_BUDGET_W[1] ? 1 : total <= K_BUDGET_W[2] ? 2 : total <= K_BUDGET_W[3] ? 3 : 4;
  if (energyK === 4) {
    return {
      ok: false, requiredKardashev: 4, requiredBarrow: needB, totalPowerW: total,
      reasons: [`That would command ${total.toExponential(2)} W — more than an entire galaxy emits (~10³⁷ W). No Kardashev civilisation in this model can do that.`],
      suggestion: 'Reduce the scale (coverage, capacity, rate or number of units).',
    };
  }
  needK = Math.max(needK, energyK);
  if (reach.k > caps.kardashevLevel) {
    reasons.push(
      reach.k === 3
        ? `${reach.what} is another star system; a ${K_NAMES[caps.kardashevLevel]} civilisation cannot build beyond the Solar System.`
        : `${reach.what} is beyond a planetary civilisation's reach (K1 can build on Earth and the Moon only).`,
    );
  }
  if ((kind?.minKardashev ?? 0) > caps.kardashevLevel && reach.k <= caps.kardashevLevel) {
    reasons.push(`${kind!.label} is a ${K_NAMES[kind!.minKardashev!]} project.`);
  }
  if (energyK > caps.kardashevLevel) {
    reasons.push(`It would bring the branch to ${total.toExponential(2)} W, above the ${K_NAMES[caps.kardashevLevel]} budget of ${K_BUDGET_W[caps.kardashevLevel as 1 | 2 | 3].toExponential(1)} W.`);
  }
  if (needB > caps.barrowLevel) {
    reasons.push(`${kind?.label ?? changed.kind} needs ${B_NAMES[needB]} manipulation; this civilisation is at ${B_NAMES[caps.barrowLevel]}.`);
  }
  const ok = reasons.length === 0;
  const target = [needK > caps.kardashevLevel ? `K${needK}` : null, needB > caps.barrowLevel ? `B${needB}` : null].filter(Boolean).join(' · ');
  return {
    ok, requiredKardashev: needK, requiredBarrow: needB, totalPowerW: total, reasons,
    suggestion: ok ? null : `Possible for a ${target} civilisation — advance this branch (or fork one) to ${target} to build it.`,
  };
}

/** Human-readable summary of what the current civilisation can and cannot do. */
export function abilitiesOf(caps: CapabilityState): { can: string[]; cannot: string[] } {
  const k = caps.kardashevLevel;
  const b = caps.barrowLevel;
  const can: string[] = [];
  const cannot: string[] = [];
  can.push(`${K_NAMES[k]}: command up to ${K_BUDGET_W[k as 1 | 2 | 3].toExponential(1)} W`);
  if (k >= 1) can.push('Earth: regional grids, power plants, climate levers; structures on Earth and the Moon');
  if (k >= 2) can.push('Anywhere in the Solar System: Dyson swarms/spheres around the Sun, collectors on any planet or moon, gas-giant harvesters, habitats');
  else cannot.push('Anything beyond Earth and the Moon, Dyson structures, gas-giant harvesting → needs K2');
  if (k >= 3) can.push('Other stars: interstellar expansion, Dyson structures at any catalogued star');
  else cannot.push('Other star systems and galactic expansion → needs K3');
  if (b >= 2) can.push('B2: edit any base of the HBB gene and set who carries it');
  else cannot.push('Gene editing → needs B2');
  if (b >= 4) can.push('B4: place ions atom by atom in window films; atomic transitions');
  else cannot.push('Atom-level materials engineering → needs B4');
  if (b >= 6) can.push('B6: matter–antimatter reactors (e⁺e⁻ or p p̄), single-collision control');
  else cannot.push('Antimatter / particle engineering → needs B6');
  cannot.push('At any level: faster-than-light travel, time travel, other universes, energy from nothing (antimatter must be produced first)');
  return { can, cannot };
}
