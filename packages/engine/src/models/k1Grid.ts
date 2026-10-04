import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import { REGIONS, regionDistanceKm, regionOf, type RegionDef } from '../regions.js';
import type { ScienceCity } from '../science.js';
import type { Intervention, ModelNode } from '../types.js';
import { CO2_DOUBLING_FORCING_WM2 } from './constants.js';
import { equilibriumTempK } from './energyBalance.js';

export const K1_GRID_MODEL = 'k1-regional-grid';
export const K1_GRID_VERSION = '3.0.0';

export const K1_GRID_ASSUMPTIONS = [
  'Generation = capacity × utilisation × construction progress; utilisation defaults to a declared regional capacity factor per technology.',
  'Delivered = generation × facility efficiency (conversion + local distribution).',
  'Existing supply equals each region\'s OWID primary-energy rate; demand is an editable regional target (default 2× today).',
  'Regions serve local demand first; surplus is exported over HVDC links to regions with unmet demand, losing a declared fraction per 1,000 km.',
  'Waste heat from all useful power enters a gray-body energy balance; a higher K never implies a better climate by itself.',
];

export type K1Tech = 'solar' | 'wind' | 'fusion' | 'fission' | 'geothermal' | 'orbital_solar';

export interface K1Facility {
  id: string;
  interventionId: string;
  label: string;
  technology: K1Tech;
  regionId: string;
  latDeg: number;
  lonDeg: number;
  capacityW: number;
  utilization: number;
  efficiency: number;
  construction: number;
  generatedW: number;
  deliveredW: number;
}

export interface K1RegionState {
  id: string;
  name: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  centroid: [number, number];
  baselineW: number;
  demandW: number;
  newSupplyW: number;
  supplyW: number;
  importsW: number;
  exportsW: number;
  /** Pre-trade local balance (supply − demand); positive = region produces a surplus. */
  localBalanceW: number;
  /** Post-trade balance after HVDC exports/imports. */
  balanceW: number;
  status: 'surplus' | 'balanced' | 'deficit';
}

export interface K1GridView {
  facilities: K1Facility[];
  regions: K1RegionState[];
  links: { from: string; to: string; powerW: number; lossW: number }[];
  totals: {
    installedW: number;
    generatedW: number;
    deliveredW: number;
    conversionLossW: number;
    transmissionLossW: number;
    usefulW: number;
    demandW: number;
    unmetW: number;
    surplusW: number;
    baselineW: number;
    achievedK: number;
    baselineK: number;
  };
  climate: {
    kind: string;
    magnitude: number;
    albedo: number;
    baselineAlbedo: number;
    baselineTempK: number;
    equilibriumTempK: number;
    deltaTK: number;
    wasteHeatForcingWm2: number;
    wasteHeatVsCo2Doubling: number;
  };
}

export interface K1GridInputs {
  interventions: Intervention[];
  cities: ScienceCity[];
  regionalBaselineW: Record<string, number>;
  P0_W: number;
  demandW: Record<string, number>;
  lossPer1000km: number;
  stellarFlux: number;
  albedo: number;
  emissivity: number;
  greenhouseOffsetK: number;
  earthRadiusM: number;
}

const CLIMATE_DELTA_ALBEDO: Record<string, number> = { none: 0, orbital_shade: 0.06, stratospheric_aerosol: 0.03, surface_albedo: 0.015 };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Deterministic site layout for a regional network: largest cities in the region, nudged by technology. */
function sitesFor(region: RegionDef, tech: K1Tech, cities: ScienceCity[], n: number): { lat: number; lon: number; name: string }[] {
  const inRegion = cities.filter((c) => regionOf(c.latDeg, c.lonDeg)?.id === region.id).sort((a, b) => b.population - a.population);
  const out: { lat: number; lon: number; name: string }[] = [];
  for (let i = 0; i < n; i++) {
    const c = inRegion[i % Math.max(1, inRegion.length)];
    const jitter = ((i * 37) % 11) / 11 - 0.5;
    if (c) {
      const offset = tech === 'solar' ? -3 : tech === 'wind' ? 3 : 0.6;
      out.push({ lat: clamp(c.latDeg + offset * Math.sign(c.latDeg || 1) * 0.6 + jitter, -80, 80), lon: c.lonDeg + jitter * 4, name: c.name });
    } else {
      out.push({ lat: region.centroid[0] + jitter * 10, lon: region.centroid[1] + jitter * 20, name: region.name });
    }
  }
  return out;
}

export function computeK1Grid(inp: K1GridInputs): { view: K1GridView; nodes: ModelNode[]; warnings: string[] } {
  const facilities: K1Facility[] = [];
  const warnings: string[] = [];
  for (const iv of inp.interventions) {
    const p = iv.params;
    if (iv.kind === 'k1.network') {
      const tech = (p.technology as K1Tech) ?? 'solar';
      const regionIds = String(p.regions ?? 'all') === 'all' ? REGIONS.map((r) => r.id) : String(p.regions).split(',').map((s) => s.trim());
      const perRegion = num(p.capacityPerRegion_W, 1e13);
      const sites = Math.round(clamp(num(p.sitesPerRegion, 6), 1, 12));
      for (const rid of regionIds) {
        const region = REGIONS.find((r) => r.id === rid);
        if (!region) continue;
        const util = p.utilization == null || p.utilization === 'auto' ? region.capacityFactor[tech] ?? 0.3 : num(p.utilization, 0.3);
        sitesFor(region, tech, inp.cities, sites).forEach((s, i) => {
          facilities.push(mkFacility(`${iv.id}:${rid}:${i}`, iv.id, `${tech} · ${s.name}`, tech, rid, s.lat, s.lon, perRegion / sites, util, num(p.efficiency, 0.9), num(p.construction, 1)));
        });
      }
    } else if (iv.kind === 'k1.facility') {
      const tech = (p.technology as K1Tech) ?? 'solar';
      const lat = num(p.latDeg, 25);
      const lon = num(p.lonDeg, 10);
      const region = REGIONS.find((r) => r.id === p.regionId) ?? regionOf(lat, lon) ?? REGIONS[3]!;
      const util = p.utilization == null || p.utilization === 'auto' ? region.capacityFactor[tech] ?? 0.3 : num(p.utilization, 0.3);
      facilities.push(mkFacility(iv.id, iv.id, iv.label || `${tech} plant`, tech, region.id, lat, lon, num(p.capacity_W, 1e12), util, num(p.efficiency, 0.9), num(p.construction, 1)));
    }
  }

  // Regional balance, then export surplus to deficits with distance losses.
  const regions: K1RegionState[] = REGIONS.map((r) => {
    const baseline = inp.regionalBaselineW[r.id] ?? 0;
    const newSupply = facilities.filter((f) => f.regionId === r.id).reduce((s, f) => s + f.deliveredW, 0);
    const demand = inp.demandW[r.id] ?? baseline * 2;
    return {
      id: r.id, name: r.name, latMin: r.latMin, latMax: r.latMax, lonMin: r.lonMin, lonMax: r.lonMax, centroid: r.centroid,
      baselineW: baseline, demandW: demand, newSupplyW: newSupply, supplyW: baseline + newSupply,
      importsW: 0, exportsW: 0, localBalanceW: baseline + newSupply - demand, balanceW: baseline + newSupply - demand, status: 'balanced',
    };
  });
  const links: K1GridView['links'] = [];
  let transmissionLoss = 0;
  const exporters = regions.filter((r) => r.balanceW > 0);
  const importers = regions.filter((r) => r.balanceW < 0);
  for (const imp of importers.sort((a, b) => a.balanceW - b.balanceW)) {
    for (const ex of exporters
      .filter((e) => e.balanceW > 0)
      .sort((a, b) => regionDistanceKm(REGIONS.find((x) => x.id === a.id)!, REGIONS.find((x) => x.id === imp.id)!) -
        regionDistanceKm(REGIONS.find((x) => x.id === b.id)!, REGIONS.find((x) => x.id === imp.id)!))) {
      if (imp.balanceW >= 0) break;
      const dist = regionDistanceKm(REGIONS.find((x) => x.id === ex.id)!, REGIONS.find((x) => x.id === imp.id)!);
      const keep = Math.max(0, 1 - inp.lossPer1000km * (dist / 1000));
      if (keep <= 0) continue;
      const needSent = -imp.balanceW / keep;
      const sent = Math.min(ex.balanceW, needSent);
      const arrived = sent * keep;
      ex.balanceW -= sent;
      ex.exportsW += sent;
      imp.balanceW += arrived;
      imp.importsW += arrived;
      transmissionLoss += sent - arrived;
      links.push({ from: ex.id, to: imp.id, powerW: arrived, lossW: sent - arrived });
    }
  }
  for (const r of regions) {
    const rel = r.demandW > 0 ? (r.exportsW > 0 ? r.localBalanceW : r.balanceW) / r.demandW : 0;
    r.status = rel > 0.02 ? 'surplus' : rel < -0.02 ? 'deficit' : 'balanced';
  }

  const installed = facilities.reduce((s, f) => s + f.capacityW * f.construction, 0);
  const generated = facilities.reduce((s, f) => s + f.generatedW, 0);
  const delivered = facilities.reduce((s, f) => s + f.deliveredW, 0);
  const demandTotal = regions.reduce((s, r) => s + r.demandW, 0);
  const unmet = regions.reduce((s, r) => s + Math.max(0, -r.balanceW), 0);
  const surplus = regions.reduce((s, r) => s + Math.max(0, r.balanceW), 0);
  const useful = inp.P0_W + delivered - transmissionLoss;
  if (unmet > 0 && facilities.length) warnings.push(`Unmet demand of ${(unmet / 1e12).toFixed(1)} TW remains after grid transfers.`);

  // Climate lever + energy balance.
  const climateIv = inp.interventions.find((i) => i.kind === 'k1.climate');
  const ck = String(climateIv?.params.kind ?? 'none');
  const cm = clamp(num(climateIv?.params.magnitude, 0), 0, 1);
  const albedo = clamp(inp.albedo + (CLIMATE_DELTA_ALBEDO[ck] ?? 0) * cm, 0, 0.95);
  const area = 4 * Math.PI * inp.earthRadiusM ** 2;
  const baseT = equilibriumTempK(inp.stellarFlux, inp.albedo, inp.emissivity, inp.greenhouseOffsetK, inp.P0_W / area);
  const forcing = useful / area;
  const T = equilibriumTempK(inp.stellarFlux, albedo, inp.emissivity, inp.greenhouseOffsetK, forcing);
  if (T - baseT > 1.5) warnings.push(`Waste heat warms the equilibrium temperature by ${(T - baseT).toFixed(2)} K.`);

  const view: K1GridView = {
    facilities,
    regions,
    links,
    totals: {
      installedW: installed, generatedW: generated, deliveredW: delivered, conversionLossW: generated - delivered,
      transmissionLossW: transmissionLoss, usefulW: useful, demandW: demandTotal, unmetW: unmet, surplusW: surplus,
      baselineW: inp.P0_W, achievedK: kardashevFromPowerW(useful), baselineK: kardashevFromPowerW(inp.P0_W),
    },
    climate: {
      kind: ck, magnitude: cm, albedo, baselineAlbedo: inp.albedo, baselineTempK: baseT, equilibriumTempK: T, deltaTK: T - baseT,
      wasteHeatForcingWm2: forcing, wasteHeatVsCo2Doubling: (forcing - inp.P0_W / area) / CO2_DOUBLING_FORCING_WM2,
    },
  };
  const W = (v: number) => ({ value: v, unit: 'W' });
  const nodes: ModelNode[] = [
    { id: 'k1.generation', label: 'Facility generation', modelId: K1_GRID_MODEL, version: K1_GRID_VERSION, dependsOn: [],
      inputs: { facilities: { value: facilities.length, unit: 'count' }, installed: W(installed) },
      outputs: { generated: W(generated), delivered: W(delivered), conversionLoss: W(generated - delivered) }, evidence: 'simulated', assumptions: [K1_GRID_ASSUMPTIONS[0]!, K1_GRID_ASSUMPTIONS[1]!] },
    { id: 'k1.grid', label: 'Regional allocation & HVDC grid', modelId: K1_GRID_MODEL, version: K1_GRID_VERSION, dependsOn: ['k1.generation'],
      inputs: { delivered: W(delivered), demand: W(demandTotal), lossPer1000km: { value: inp.lossPer1000km, unit: '1/1000 km' } },
      outputs: { transmissionLoss: W(transmissionLoss), unmet: W(unmet), surplus: W(surplus), useful: W(useful) }, evidence: 'simulated', assumptions: [K1_GRID_ASSUMPTIONS[2]!, K1_GRID_ASSUMPTIONS[3]!] },
    { id: 'k1.kardashev', label: 'Achieved Kardashev level', modelId: 'kardashev-sagan', version: '1.0.0', dependsOn: ['k1.grid'],
      inputs: { useful: W(useful) }, outputs: { K: { value: kardashevFromPowerW(useful), unit: 'K' } }, evidence: 'derived', assumptions: ['K = (log10 P − 6) / 10'] },
    { id: 'k1.climate', label: 'Planetary energy balance', modelId: 'gray-body-energy-balance', version: '1.0.0', dependsOn: ['k1.grid'],
      inputs: { albedo: { value: albedo, unit: '1' }, wasteHeat: { value: forcing, unit: 'W/m²' } },
      outputs: { T_eq: { value: T, unit: 'K' }, deltaT: { value: T - baseT, unit: 'K' } }, evidence: 'simulated', assumptions: [K1_GRID_ASSUMPTIONS[4]!] },
  ];
  return { view, nodes, warnings };
}

function mkFacility(id: string, ivId: string, label: string, tech: K1Tech, regionId: string, lat: number, lon: number, cap: number, util: number, eff: number, construction: number): K1Facility {
  const u = clamp(util, 0, 1);
  const e = clamp(eff, 0, 1);
  const c = clamp(construction, 0, 1);
  const gen = cap * u * c;
  return { id, interventionId: ivId, label, technology: tech, regionId, latDeg: lat, lonDeg: lon, capacityW: cap, utilization: u, efficiency: e, construction: c, generatedW: gen, deliveredW: gen * e };
}
