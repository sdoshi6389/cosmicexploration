import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import type { ScienceCity } from '../science.js';
import { CO2_DOUBLING_FORCING_WM2 } from './constants.js';
import { equilibriumTempK } from './energyBalance.js';
import type {
  K1ClimateKind,
  K1InfrastructureKind,
  K1InfrastructureNode,
  K1Output,
} from './outputs.js';

export const K1_MODEL_ID = 'k1-planetary-energy';
export const K1_MODEL_VERSION = '2.0.0';

export const K1_ASSUMPTIONS = [
  'P_useful = P0 + C × u × η, with P0 the sourced world primary-energy rate (OWID / Energy Institute).',
  'Waste heat P_useful / (4πR²) is added as extra absorbed flux in the gray-body energy balance.',
  'T_eq = [(S(1−a)/4 + F_waste)/(εσ)]^¼ + greenhouse offset; offset is derived so the baseline matches the observed mean surface temperature.',
  'Climate controls change Bond albedo by declared amounts; they are scenario levers, not engineering designs.',
  'Infrastructure is a scenario layout over real Natural Earth city locations, not an observed grid.',
];

export interface K1Inputs {
  P0_W: number;
  baselineYear: number;
  capacity_W: number;
  utilization: number;
  efficiency: number;
  stellarFlux_W_m2: number;
  albedo: number;
  emissivity: number;
  greenhouseOffset_K: number;
  earthRadius_m: number;
  climateKind: K1ClimateKind;
  climateMagnitude: number;
  cities: ScienceCity[];
}

const CLIMATE_DELTA_ALBEDO: Record<K1ClimateKind, number> = {
  none: 0,
  orbital_shade: 0.06,
  stratospheric_aerosol: 0.03,
  surface_albedo: 0.015,
};

export function computeK1PlanetaryEnergy(inputs: K1Inputs): K1Output {
  const u = clamp(inputs.utilization, 0, 1);
  const eta = clamp(inputs.efficiency, 0, 1);
  const C = Math.max(0, inputs.capacity_W);
  const addedUseful = C * u * eta;
  const usefulPowerW = inputs.P0_W + addedUseful;
  const losses = C * u * (1 - eta);
  const R = inputs.earthRadius_m;
  const area = 4 * Math.PI * R * R;
  const magnitude = clamp(inputs.climateMagnitude, 0, 1);
  const deltaAlbedo = CLIMATE_DELTA_ALBEDO[inputs.climateKind] * magnitude;
  const albedo = clamp(inputs.albedo + deltaAlbedo, 0, 0.95);

  // Baseline already includes present-day waste heat (P0); the counterfactual adds the rest.
  const baselineTempK = equilibriumTempK(
    inputs.stellarFlux_W_m2, inputs.albedo, inputs.emissivity, inputs.greenhouseOffset_K,
    inputs.P0_W / area,
  );
  const wasteHeatForcingWm2 = usefulPowerW / area;
  const equilibrium = equilibriumTempK(
    inputs.stellarFlux_W_m2, albedo, inputs.emissivity, inputs.greenhouseOffset_K, wasteHeatForcingWm2,
  );

  const infrastructure = layout(inputs.cities, C);
  const mix = summarizeMix(infrastructure);

  return {
    baselinePowerW: inputs.P0_W,
    baselineYear: inputs.baselineYear,
    addedCapacityW: C,
    utilization: u,
    distributionEfficiency: eta,
    usefulPowerW,
    addedUsefulPowerW: addedUseful,
    distributionLossesW: losses,
    achievedK: kardashevFromPowerW(usefulPowerW),
    baselineK: kardashevFromPowerW(inputs.P0_W),
    powerMultiple: usefulPowerW / inputs.P0_W,
    albedo,
    baselineAlbedo: inputs.albedo,
    emissivity: inputs.emissivity,
    stellarFluxWm2: inputs.stellarFlux_W_m2,
    greenhouseOffsetK: inputs.greenhouseOffset_K,
    baselineTempK,
    equilibriumTempK: equilibrium,
    deltaTK: equilibrium - baselineTempK,
    wasteHeatForcingWm2,
    wasteHeatVsCo2Doubling: (wasteHeatForcingWm2 - inputs.P0_W / area) / CO2_DOUBLING_FORCING_WM2,
    climate: { kind: inputs.climateKind, magnitude, deltaAlbedo },
    infrastructure,
    gridNetwork: buildGrid(infrastructure),
    mix,
  };
}

/** Deterministic scenario layout: technology chosen by latitude band, capacity by population. */
function layout(cities: ScienceCity[], capacityW: number): K1InfrastructureNode[] {
  if (capacityW <= 0 || cities.length === 0) return [];
  const top = [...cities].sort((a, b) => b.population - a.population).slice(0, 60);
  const popSum = top.reduce((s, c) => s + c.population, 0) || 1;
  const ground = capacityW * 0.78;
  const nodes: K1InfrastructureNode[] = top.map((c, i) => {
    const lat = Math.abs(c.latDeg);
    const kind: K1InfrastructureKind =
      lat < 35 && lat > 12 ? 'solar_farm'
        : lat >= 45 ? 'wind_array'
          : i % 3 === 0 ? 'fusion_plant'
            : i % 3 === 1 ? 'fission_plant' : 'geothermal';
    return {
      id: `k1.ground.${c.id}`,
      kind,
      label: `${kind.replace('_', ' ')} · ${c.name}`,
      latDeg: c.latDeg,
      lonDeg: c.lonDeg,
      altitudeM: 0,
      capacityW: ground * (c.population / popSum),
      buildOrder: i / top.length,
      cityId: c.id,
    };
  });
  const orbitalShare = capacityW * 0.22;
  const hosts = top.slice(0, 8);
  hosts.forEach((c, i) => {
    const rect = `k1.rectenna.${c.id}`;
    nodes.push({
      id: rect, kind: 'rectenna', label: `Rectenna · ${c.name}`, latDeg: c.latDeg, lonDeg: c.lonDeg + 0.6,
      altitudeM: 0, capacityW: orbitalShare * 0.6 / hosts.length, buildOrder: 0.5 + i / 20, cityId: c.id,
    });
    nodes.push({
      id: `k1.collector.${c.id}`, kind: 'orbital_collector', label: `Orbital collector → ${c.name}`,
      latDeg: 0, lonDeg: c.lonDeg, altitudeM: 35_786_000, capacityW: orbitalShare * 0.6 / hosts.length,
      buildOrder: 0.6 + i / 20, linkedToId: rect,
    });
  });
  nodes.push({
    id: 'k1.ring.geo', kind: 'orbital_ring', label: 'Geostationary power ring', latDeg: 0, lonDeg: 0,
    altitudeM: 35_786_000, capacityW: orbitalShare * 0.4, buildOrder: 0.9,
  });
  nodes.push({
    id: 'k1.elevator', kind: 'space_elevator', label: 'Equatorial elevator (scenario)', latDeg: 0,
    lonDeg: -80, altitudeM: 35_786_000, capacityW: 0, buildOrder: 1,
  });
  return nodes;
}

function summarizeMix(nodes: K1InfrastructureNode[]): { kind: K1InfrastructureKind; capacityW: number }[] {
  const m = new Map<K1InfrastructureKind, number>();
  for (const n of nodes) {
    if (n.kind === 'orbital_collector' || n.kind === 'space_elevator') continue;
    m.set(n.kind, (m.get(n.kind) ?? 0) + n.capacityW);
  }
  return [...m.entries()].map(([kind, capacityW]) => ({ kind, capacityW })).sort((a, b) => b.capacityW - a.capacityW);
}

function buildGrid(nodes: K1InfrastructureNode[]): { fromId: string; toId: string; powerW: number }[] {
  const ground = nodes.filter((n) => n.kind !== 'orbital_collector' && n.kind !== 'orbital_ring' &&
    n.kind !== 'space_elevator' && n.kind !== 'rectenna');
  const edges: { fromId: string; toId: string; powerW: number }[] = [];
  const seen = new Set<string>();
  for (const a of ground) {
    const near = ground
      .filter((b) => b !== a)
      .map((b) => ({ b, d: haversineKm(a.latDeg, a.lonDeg, b.latDeg, b.lonDeg) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 3);
    for (const { b, d } of near) {
      if (d > 4500) continue; // HVDC corridors longer than ~4,500 km are not modelled
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromId: a.id, toId: b.id, powerW: Math.min(a.capacityW, b.capacityW) * 0.2 });
    }
  }
  for (const n of nodes) if (n.linkedToId) edges.push({ fromId: n.id, toId: n.linkedToId, powerW: n.capacityW });
  return edges;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const s = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
