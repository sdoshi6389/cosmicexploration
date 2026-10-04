import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import type { EntityRef } from '../entities.js';
import { AU_M } from '../science.js';
import type { Intervention, ModelNode } from '../types.js';

export const STRUCTURES_MODEL = 'free-build-structures';
export const STRUCTURES_VERSION = '1.0.0';

export const STRUCTURE_TYPES = [
  { value: 'dyson_swarm', label: 'Dyson swarm (orbiting collectors)', hosts: 'star' },
  { value: 'dyson_sphere', label: 'Dyson sphere (closed shell)', hosts: 'star' },
  { value: 'surface_collectors', label: 'Surface solar collectors', hosts: 'body' },
  { value: 'orbital_ring', label: 'Orbital collector ring', hosts: 'body' },
  { value: 'gas_harvester', label: 'Gas-giant fusion-fuel harvester', hosts: 'giant' },
  { value: 'habitat', label: 'Habitat / city (power consumer)', hosts: 'any' },
] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number]['value'];

export const STRUCTURES_ASSUMPTIONS = [
  'Stellar structures intercept coverage × L★ (L★ from Gaia FLAME or photometry; Sun: IAU nominal); useful = intercepted × conversion efficiency.',
  'Body collectors intercept the solar flux at the body’s Horizons distance over coverage × πR²; atmospheres reduce surface yield by a declared factor (Earth 0.5, Venus 0.1, Titan 0.02).',
  'Gas-giant harvesters burn extracted D–³He/deuterium fuel at a declared 3.4×10¹⁴ J/kg before conversion losses.',
  'Habitats draw from the power produced in the same system, in creation order; demand defaults to 10 kW per person (declared); unmet demand is reported, not invented.',
  'Waste heat is radiated at the structure; shell radiator temperature from L_waste = 4πr²σT⁴.',
];

const SIGMA = 5.670374419e-8;
const FUEL_J_PER_KG = 3.4e14;
/** Declared per-capita power for habitats (≈ 5× today’s global average primary power per person). */
const PER_CAPITA_W = 1e4;
const GIANTS = new Set(['body.jupiter', 'body.saturn', 'body.uranus', 'body.neptune']);
const ATMOSPHERE: Record<string, number> = { 'body.earth': 0.5, 'body.venus': 0.1, 'body.titan': 0.02, 'body.mars': 0.85 };

export interface StructureView {
  interventionId: string;
  label: string;
  type: StructureType;
  hostId: string;
  hostName: string;
  hostKind: string;
  system: string;
  hostPositionM: [number, number, number];
  hostRadiusKm: number | null;
  orbitRadiusAU: number;
  coverage: number;
  construction: number;
  efficiency: number;
  interceptedW: number;
  usefulW: number;
  heatW: number;
  demandW: number;
  servedW: number;
  servedFraction: number;
  population: number;
  radiatorTempK: number | null;
  /** Fraction of the host star's light still escaping (stars only). */
  transmittedFraction: number | null;
  valid: boolean;
  note: string;
}

export interface StructuresResult {
  items: StructureView[];
  totals: { interceptedW: number; usefulW: number; heatW: number; demandW: number; servedW: number; unmetW: number; achievedK: number };
  nodes: ModelNode[];
  warnings: string[];
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function computeStructures(input: {
  interventions: Intervention[];
  resolve: (id: string) => EntityRef | undefined;
  sunLuminosityW: number;
  defaultLuminosityW: number;
}): StructuresResult {
  const warnings: string[] = [];
  const items: StructureView[] = [];
  const sunPos = input.resolve('body.sun')?.positionM ?? [0, 0, 0];
  const capturedByStar = new Map<string, number>();
  for (const iv of input.interventions.filter((i) => i.kind === 'build.structure').sort((a, b) => a.createdSeq - b.createdSeq)) {
    const p = iv.params;
    const type = String(p.type ?? 'surface_collectors') as StructureType;
    const host = input.resolve(String(p.hostId ?? ''));
    const base = {
      interventionId: iv.id, label: iv.label, type, coverage: num(p.coverage, 0.1), construction: num(p.construction, 1), efficiency: num(p.efficiency, 0.25),
      orbitRadiusAU: num(p.orbitRadius_AU, 1), population: num(p.population, 0), demandW: 0, servedW: 0, servedFraction: 0, radiatorTempK: null as number | null,
      transmittedFraction: null as number | null, interceptedW: 0, usefulW: 0, heatW: 0,
    };
    if (!host) {
      warnings.push(`${iv.label}: host "${p.hostId}" not found.`);
      items.push({ ...base, hostId: String(p.hostId), hostName: '?', hostKind: '?', system: 'sol', hostPositionM: [0, 0, 0], hostRadiusKm: null, valid: false, note: 'unknown host' });
      continue;
    }
    const isStar = host.kind === 'star';
    const h = { hostId: host.id, hostName: host.name, hostKind: host.kind, system: host.system, hostPositionM: host.positionM, hostRadiusKm: host.radiusKm };
    let note = '';
    let valid = true;
    const built = base.coverage * base.construction;
    if (type === 'dyson_swarm' || type === 'dyson_sphere') {
      if (!isStar) {
        valid = false;
        note = 'Dyson structures need a star as host.';
      } else {
        const L = host.id === 'body.sun' ? input.sunLuminosityW : host.luminosityW ?? input.defaultLuminosityW;
        if (host.luminosityW == null && host.id !== 'body.sun') note = 'luminosity unmeasured: declared default used';
        const cov = type === 'dyson_sphere' ? Math.max(base.coverage, 0.9) : base.coverage;
        base.interceptedW = L * cov * base.construction;
        base.usefulW = base.interceptedW * base.efficiency;
        base.heatW = base.interceptedW - base.usefulW;
        const r = Math.max(0.01, base.orbitRadiusAU) * AU_M;
        base.radiatorTempK = (base.heatW / (4 * Math.PI * r * r * SIGMA)) ** 0.25;
        capturedByStar.set(host.id, (capturedByStar.get(host.id) ?? 0) + base.interceptedW / L);
      }
    } else if (type === 'surface_collectors' || type === 'orbital_ring') {
      if (isStar) {
        valid = false;
        note = 'Use a Dyson swarm/sphere around stars.';
      } else if (type === 'surface_collectors' && GIANTS.has(host.id)) {
        valid = false;
        note = 'Gas giants have no surface — use an orbital ring or a gas harvester.';
      } else {
        const dM = Math.hypot(host.positionM[0] - sunPos[0], host.positionM[1] - sunPos[1], host.positionM[2] - sunPos[2]);
        const flux = input.sunLuminosityW / (4 * Math.PI * dM * dM);
        const R = (host.radiusKm ?? 100) * 1000;
        const atm = type === 'surface_collectors' ? ATMOSPHERE[host.id] ?? 1 : 1;
        base.interceptedW = flux * Math.PI * R * R * built * atm;
        base.usefulW = base.interceptedW * base.efficiency;
        base.heatW = base.interceptedW - base.usefulW;
        note = `${flux.toFixed(1)} W/m² at ${(dM / AU_M).toFixed(2)} AU${atm < 1 ? ` · atmosphere ×${atm}` : ''}`;
      }
    } else if (type === 'gas_harvester') {
      if (!GIANTS.has(host.id)) {
        valid = false;
        note = 'Fuel harvesting needs a gas giant (Jupiter, Saturn, Uranus, Neptune).';
      } else {
        base.interceptedW = num(p.harvestRate_kgps, 1e5) * FUEL_J_PER_KG * base.construction;
        base.usefulW = base.interceptedW * base.efficiency;
        base.heatW = base.interceptedW - base.usefulW;
        note = `${num(p.harvestRate_kgps, 1e5).toExponential(1)} kg/s fuel`;
      }
    } else if (type === 'habitat') {
      const explicit = num(p.demand_W, 0);
      base.demandW = (explicit > 0 ? explicit : num(p.population, 1e6) * PER_CAPITA_W) * base.construction;
      note = explicit > 0 ? '' : `${num(p.population, 1e6).toExponential(1)} people × 10 kW`;
    }
    if (!valid) warnings.push(`${iv.label}: ${note}`);
    items.push({ ...base, ...h, valid, note });
  }
  // Light still escaping each harvested star (blocking adds up across structures).
  for (const it of items) if (capturedByStar.has(it.hostId)) it.transmittedFraction = Math.max(0, 1 - capturedByStar.get(it.hostId)!);
  // Habitats are served from production in the same system, in creation order.
  const pool = new Map<string, number>();
  for (const it of items) pool.set(it.system, (pool.get(it.system) ?? 0) + it.usefulW);
  for (const it of items.filter((x) => x.type === 'habitat')) {
    const avail = pool.get(it.system) ?? 0;
    it.servedW = Math.min(avail, it.demandW);
    it.servedFraction = it.demandW > 0 ? it.servedW / it.demandW : 1;
    pool.set(it.system, avail - it.servedW);
  }
  const t = items.reduce(
    (acc, it) => ({ interceptedW: acc.interceptedW + it.interceptedW, usefulW: acc.usefulW + it.usefulW, heatW: acc.heatW + it.heatW, demandW: acc.demandW + it.demandW, servedW: acc.servedW + it.servedW }),
    { interceptedW: 0, usefulW: 0, heatW: 0, demandW: 0, servedW: 0 },
  );
  const totals = { ...t, unmetW: t.demandW - t.servedW, achievedK: kardashevFromPowerW(Math.max(1, t.usefulW)) };
  const q = (value: number | string, unit: string) => ({ value, unit });
  const nodes: ModelNode[] = items.length
    ? [
        { id: 'build.hosts', label: 'Hosts (Horizons / Gaia)', modelId: STRUCTURES_MODEL, version: STRUCTURES_VERSION, dependsOn: [], inputs: { structures: q(items.length, 'count') }, outputs: { hosts: q([...new Set(items.map((i) => i.hostName))].join(', ').slice(0, 120), '') }, evidence: 'observed', assumptions: [] },
        { id: 'build.capture', label: 'Energy capture', modelId: STRUCTURES_MODEL, version: STRUCTURES_VERSION, dependsOn: ['build.hosts'], inputs: { coverage: q(items.reduce((m, i) => Math.max(m, i.coverage), 0), 'max') }, outputs: { intercepted: q(t.interceptedW, 'W'), useful: q(t.usefulW, 'W'), heat: q(t.heatW, 'W') }, evidence: 'simulated', assumptions: STRUCTURES_ASSUMPTIONS.slice(0, 3) },
        { id: 'build.allocation', label: 'Habitat allocation', modelId: STRUCTURES_MODEL, version: STRUCTURES_VERSION, dependsOn: ['build.capture'], inputs: { demand: q(t.demandW, 'W') }, outputs: { served: q(t.servedW, 'W'), unmet: q(totals.unmetW, 'W'), K: q(totals.achievedK, 'K') }, evidence: 'simulated', assumptions: [STRUCTURES_ASSUMPTIONS[3]!] },
      ]
    : [];
  return { items, totals, nodes, warnings };
}
