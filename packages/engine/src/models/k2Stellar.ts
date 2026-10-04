import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import { AU_M } from '../science.js';
import type { Intervention, ModelNode } from '../types.js';
import { computeK2DysonSwarm } from './k2DysonSwarm.js';
import type { K2Output } from './outputs.js';

export const K2_STELLAR_MODEL = 'k2-stellar-economy';
export const K2_STELLAR_VERSION = '3.0.0';

export const K2_STELLAR_ASSUMPTIONS = [
  'Each swarm: P_intercepted = f·L, P_useful = η·f·L × construction progress (collectors not yet built capture nothing).',
  'Loads (habitats, stations, receivers) are served in priority order from the pooled useful swarm power.',
  'Power reaching a load = allocated × beaming efficiency (declared, decreasing with distance from the swarm by a declared loss per AU).',
  'Rendered collectors are a representative sample; modelled collector count and area come from the swarm parameters.',
];

export interface K2Load {
  id: string;
  label: string;
  kind: 'habitat' | 'station' | 'receiver';
  bodyId: string;
  bodyName: string;
  distanceAu: number;
  demandW: number;
  priority: number;
  allocatedW: number;
  deliveredW: number;
  beamLossW: number;
  servedFraction: number;
}

export interface K2SwarmView extends K2Output {
  interventionId: string;
  label: string;
  construction: number;
  layout: string;
  builtUsefulW: number;
}

export interface K2StellarView {
  swarms: K2SwarmView[];
  loads: K2Load[];
  totals: {
    interceptedW: number;
    usefulW: number;
    allocatedW: number;
    deliveredW: number;
    beamLossW: number;
    unallocatedW: number;
    unmetW: number;
    achievedK: number;
    transmittedFraction: number;
    earthEquilibriumTempK: number | null;
  };
}

export interface K2StellarInputs {
  interventions: Intervention[];
  luminosityW: number;
  bodies: { id: string; name: string; positionM: [number, number, number] }[];
  beamEfficiency: number;
  beamLossPerAu: number;
  earthAlbedo: number;
  earthEmissivity: number;
  earthGreenhouseOffsetK: number;
  seed: number;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function computeK2Stellar(inp: K2StellarInputs): { view: K2StellarView; nodes: ModelNode[]; warnings: string[] } {
  const warnings: string[] = [];
  const swarms: K2SwarmView[] = [];
  let transmitted = 1;
  for (const iv of inp.interventions.filter((i) => i.kind === 'k2.swarm')) {
    const p = iv.params;
    const out = computeK2DysonSwarm({
      luminosity_W: inp.luminosityW * transmitted,
      captureFraction: num(p.captureFraction, 0.3),
      efficiency: num(p.efficiency, 0.4),
      radius_m: num(p.radius_AU, 0.7) * AU_M,
      collectorCount: num(p.collectorCount, 1e10),
      seed: inp.seed,
      earthAlbedo: inp.earthAlbedo,
      earthEmissivity: inp.earthEmissivity,
      earthGreenhouseOffset_K: inp.earthGreenhouseOffsetK,
    });
    const construction = clamp(num(p.construction, 1), 0, 1);
    const layout = String(p.layout ?? 'inclined');
    const bands = out.bands.map((b, i) => ({
      ...b,
      inclinationDeg: layout === 'equatorial' ? (i % 3) * 2 : layout === 'polar' ? 80 + (i % 3) * 3 : b.inclinationDeg,
    }));
    swarms.push({ ...out, bands, interventionId: iv.id, label: iv.label, construction, layout, builtUsefulW: out.usefulPowerW * construction });
    transmitted *= 1 - out.captureFraction * construction;
  }
  const pool = swarms.reduce((s, w) => s + w.builtUsefulW, 0);
  const swarmR = swarms[0] ? swarms[0].orbitalRadiusM / AU_M : 0.7;
  const loads: K2Load[] = inp.interventions
    .filter((i) => i.kind === 'k2.habitat')
    .map((iv) => {
      const body = inp.bodies.find((b) => b.id === iv.params.bodyId) ?? inp.bodies.find((b) => b.id === 'body.mars');
      const au = body ? Math.hypot(...body.positionM) / AU_M : 1.5;
      return {
        id: iv.id, label: iv.label, kind: (iv.params.kind as K2Load['kind']) ?? 'habitat', bodyId: body?.id ?? 'body.mars',
        bodyName: body?.name ?? 'Mars', distanceAu: au, demandW: num(iv.params.demand_W, 1e15), priority: num(iv.params.priority, 1),
        allocatedW: 0, deliveredW: 0, beamLossW: 0, servedFraction: 0,
      };
    })
    .sort((a, b) => a.priority - b.priority);
  let remaining = pool;
  for (const l of loads) {
    const eff = clamp(inp.beamEfficiency * (1 - inp.beamLossPerAu * Math.abs(l.distanceAu - swarmR)), 0.01, 1);
    const need = l.demandW / eff;
    const alloc = Math.min(remaining, need);
    remaining -= alloc;
    l.allocatedW = alloc;
    l.deliveredW = alloc * eff;
    l.beamLossW = alloc - l.deliveredW;
    l.servedFraction = l.demandW > 0 ? l.deliveredW / l.demandW : 1;
    if (l.servedFraction < 0.999) warnings.push(`${l.label} at ${l.bodyName} receives ${(l.servedFraction * 100).toFixed(0)}% of its demand.`);
  }
  const intercepted = swarms.reduce((s, w) => s + w.interceptedPowerW * w.construction, 0);
  const allocated = loads.reduce((s, l) => s + l.allocatedW, 0);
  const delivered = loads.reduce((s, l) => s + l.deliveredW, 0);
  const beamLoss = loads.reduce((s, l) => s + l.beamLossW, 0);
  const unmet = loads.reduce((s, l) => s + Math.max(0, l.demandW - l.deliveredW), 0);
  const inner = swarms.find((w) => w.earthShadowed);
  const view: K2StellarView = {
    swarms,
    loads,
    totals: {
      interceptedW: intercepted, usefulW: pool, allocatedW: allocated, deliveredW: delivered, beamLossW: beamLoss,
      unallocatedW: remaining, unmetW: unmet, achievedK: kardashevFromPowerW(pool), transmittedFraction: transmitted,
      earthEquilibriumTempK: inner ? inner.earthEquilibriumTempK : null,
    },
  };
  const W = (v: number) => ({ value: v, unit: 'W' });
  const nodes: ModelNode[] = [
    { id: 'k2.swarm', label: 'Dyson swarm capture', modelId: 'k2-dyson-swarm', version: '2.0.0', dependsOn: [],
      inputs: { luminosity: W(inp.luminosityW), swarms: { value: swarms.length, unit: 'count' } },
      outputs: { intercepted: W(intercepted), useful: W(pool), transmittedFraction: { value: transmitted, unit: '1' } }, evidence: 'simulated', assumptions: [K2_STELLAR_ASSUMPTIONS[0]!, K2_STELLAR_ASSUMPTIONS[3]!] },
    { id: 'k2.allocation', label: 'Power allocation to loads', modelId: K2_STELLAR_MODEL, version: K2_STELLAR_VERSION, dependsOn: ['k2.swarm'],
      inputs: { pool: W(pool), loads: { value: loads.length, unit: 'count' }, beamEfficiency: { value: inp.beamEfficiency, unit: '1' } },
      outputs: { allocated: W(allocated), delivered: W(delivered), beamLoss: W(beamLoss), unallocated: W(remaining), unmet: W(unmet) }, evidence: 'simulated', assumptions: [K2_STELLAR_ASSUMPTIONS[1]!, K2_STELLAR_ASSUMPTIONS[2]!] },
    { id: 'k2.kardashev', label: 'Achieved Kardashev level', modelId: 'kardashev-sagan', version: '1.0.0', dependsOn: ['k2.swarm'],
      inputs: { useful: W(pool) }, outputs: { K: { value: kardashevFromPowerW(pool), unit: 'K' } }, evidence: 'derived', assumptions: ['K = (log10 P − 6) / 10'] },
  ];
  return { view, nodes, warnings };
}
