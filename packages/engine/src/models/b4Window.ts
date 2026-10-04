import type { Intervention, ModelNode } from '../types.js';

export const B4_WINDOW_MODEL = 'b4-electrochromic-window';
export const B4_WINDOW_VERSION = '1.0.0';

export const B4_WINDOW_ASSUMPTIONS = [
  'Affected population: every transition-metal site in the coated film (area × thickness); the response is the aggregate of that film, not of single atoms.',
  'Microscopic parameter: ion-insertion fraction x (electrons per metal site). In WO₃, inserted electrons localise as W⁵⁺ polarons that absorb red/near-IR light (~1.4 eV).',
  'Absorbing-centre density n = x · ρ N_A / M (density from literature, molar mass from PubChem).',
  'Film transmission T = (1 − R)² · exp(−σ n d) with a declared effective cross-section σ — a simplified, partly speculative mapping, not a fitted optical model.',
  'Room daylight: E_room = E_outdoor × T_window × A_window × daylight coupling / A_floor (daylight-factor approximation).',
  'Room energy: lamps make up any shortfall below 300 lx (100 lm/W LEDs, 0.6 utilisation); solar heat through the glass (irradiance = outdoor lux / 110 lm/W, same transmission) is removed by air-conditioning with COP 3.',
  'City: every windowed room in every building uses the same film; totals are rooms × per-room values.',
  'Placed ions: x = occupied interstitial sites / 125 in the representative 5×5×5 block (each inserted ion donates one electron to a metal site).',
];

export interface B4Energy {
  lightingW: number;
  coolingW: number;
  heatGainW: number;
  totalW: number;
  baselineTotalW: number;
}

export interface B4City {
  buildings: number;
  roomsPerBuilding: number;
  rooms: number;
  lightingW: number;
  coolingW: number;
  totalW: number;
  baselineTotalW: number;
  savingW: number;
  roomsNeedingLamps: number;
}

export interface WindowMaterial {
  id: 'WO3' | 'NiO';
  name: string;
  molarMassG: number;
  densityGcm3: number;
  sigmaCm2: number;
  /** Polaron / colour-centre absorption peak, eV. */
  peakEv: number;
  tintHex: string;
  /** +1 colours as x rises (cathodic, WO₃); −1 colours as x falls (anodic, NiO). */
  coloration: 1 | -1;
}

export interface B4WindowView {
  interventionId: string;
  label: string;
  material: WindowMaterial;
  x: number;
  thicknessNm: number;
  siteDensityCm3: number;
  absorberDensityCm3: number;
  alphaPerCm: number;
  opticalDensity: number;
  transmission: number;
  baselineTransmission: number;
  windowAreaM2: number;
  floorAreaM2: number;
  outdoorLux: number;
  roomLux: number;
  baselineRoomLux: number;
  tintHex: string;
  occupiedSites: number[];
  room: B4Energy;
  city: B4City;
}

export interface B4WindowInputs {
  interventions: Intervention[];
  materials: Record<string, WindowMaterial>;
  outdoorLux: number;
  daylightCoupling: number;
  surfaceReflectance: number;
  baselineX: number;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const NA = 6.02214076e23;

function transmissionFor(mat: WindowMaterial, x: number, dNm: number, R: number) {
  const sites = (mat.densityGcm3 * NA) / mat.molarMassG;
  const absorbers = (mat.coloration === 1 ? x : Math.max(0, 0.5 - x)) * sites;
  const alpha = mat.sigmaCm2 * absorbers;
  const od = alpha * dNm * 1e-7;
  return { sites, absorbers, alpha, od, T: (1 - R) ** 2 * Math.exp(-od) };
}

export function computeB4Window(inp: B4WindowInputs): { view: B4WindowView | null; nodes: ModelNode[]; warnings: string[] } {
  const iv = inp.interventions.find((i) => i.kind === 'b4.window');
  if (!iv) return { view: null, nodes: [], warnings: [] };
  const p = iv.params;
  const mat = inp.materials[String(p.material ?? 'WO3')] ?? inp.materials.WO3!;
  const occupied = String(p.occupiedSites ?? '').split(',').filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 125);
  const x = clamp(occupied.length ? occupied.length / 125 : num(p.insertion_x, 0.25), 0, 0.5);
  const d = clamp(num(p.thickness_nm, 500), 50, 2000);
  const A = clamp(num(p.windowArea_m2, 3), 0.2, 30);
  const floor = clamp(num(p.floorArea_m2, 20), 4, 200);
  const R = inp.surfaceReflectance;
  const now = transmissionFor(mat, x, d, R);
  const base = transmissionFor(mat, inp.baselineX, d, R);
  const lux = (T: number) => (inp.outdoorLux * T * A * inp.daylightCoupling) / floor;
  // Room energy: lamps for any shortfall below 300 lx, air-conditioning for solar gain.
  const irradiance = inp.outdoorLux / 110;
  const energy = (T: number) => {
    const deficit = Math.max(0, 300 - lux(T));
    const lightingW = (floor * deficit) / (100 * 0.6);
    const heatGainW = irradiance * A * T;
    const coolingW = heatGainW / 3;
    return { lightingW, coolingW, heatGainW, totalW: lightingW + coolingW };
  };
  const e = energy(now.T);
  const eb = energy(base.T);
  const cityIv = inp.interventions.find((i) => i.kind === 'b4.city');
  const buildings = Math.max(1, Math.round(num(cityIv?.params.buildings, 1)));
  const rpb = Math.max(1, Math.round(num(cityIv?.params.roomsPerBuilding, 1)));
  const rooms = buildings * rpb;
  const view: B4WindowView = {
    interventionId: iv.id, label: iv.label, material: mat, x, thicknessNm: d, siteDensityCm3: now.sites, absorberDensityCm3: now.absorbers,
    alphaPerCm: now.alpha, opticalDensity: now.od, transmission: now.T, baselineTransmission: base.T, windowAreaM2: A, floorAreaM2: floor,
    outdoorLux: inp.outdoorLux, roomLux: lux(now.T), baselineRoomLux: lux(base.T), tintHex: mat.tintHex, occupiedSites: occupied,
    room: { ...e, baselineTotalW: eb.totalW },
    city: {
      buildings, roomsPerBuilding: rpb, rooms, lightingW: e.lightingW * rooms, coolingW: e.coolingW * rooms, totalW: e.totalW * rooms,
      baselineTotalW: eb.totalW * rooms, savingW: (eb.totalW - e.totalW) * rooms, roomsNeedingLamps: lux(now.T) < 300 ? rooms : 0,
    },
  };
  const q = (value: number | string, unit: string) => ({ value, unit });
  const nodes: ModelNode[] = [
    { id: 'b4.lattice', label: `${mat.name} lattice electronic state`, modelId: B4_WINDOW_MODEL, version: B4_WINDOW_VERSION, dependsOn: [],
      inputs: { insertion_x: q(x, 'e⁻/site'), density: q(mat.densityGcm3, 'g/cm³'), molarMass: q(mat.molarMassG, 'g/mol') },
      outputs: { siteDensity: q(now.sites, 'cm⁻³'), absorberDensity: q(now.absorbers, 'cm⁻³') }, evidence: 'derived', assumptions: [B4_WINDOW_ASSUMPTIONS[1]!, B4_WINDOW_ASSUMPTIONS[2]!] },
    { id: 'b4.optics', label: 'Film optical transmission', modelId: B4_WINDOW_MODEL, version: B4_WINDOW_VERSION, dependsOn: ['b4.lattice'],
      inputs: { absorberDensity: q(now.absorbers, 'cm⁻³'), sigma: q(mat.sigmaCm2, 'cm²'), thickness: q(d, 'nm') },
      outputs: { alpha: q(now.alpha, 'cm⁻¹'), opticalDensity: q(now.od, '1'), transmission: q(now.T, '1') }, evidence: 'assumed', assumptions: [B4_WINDOW_ASSUMPTIONS[0]!, B4_WINDOW_ASSUMPTIONS[3]!] },
    { id: 'b4.room', label: 'Room daylight', modelId: 'daylight-factor', version: '1.0.0', dependsOn: ['b4.optics'],
      inputs: { transmission: q(now.T, '1'), windowArea: q(A, 'm²'), floorArea: q(floor, 'm²'), outdoor: q(inp.outdoorLux, 'lx') },
      outputs: { roomIlluminance: q(view.roomLux, 'lx'), change: q(view.roomLux - view.baselineRoomLux, 'lx') }, evidence: 'simulated', assumptions: [B4_WINDOW_ASSUMPTIONS[4]!] },
    { id: 'b4.energy', label: 'Room lighting + cooling', modelId: B4_WINDOW_MODEL, version: B4_WINDOW_VERSION, dependsOn: ['b4.room', 'b4.optics'],
      inputs: { roomIlluminance: q(view.roomLux, 'lx'), transmission: q(now.T, '1'), irradiance: q(irradiance, 'W/m²') },
      outputs: { lighting: q(e.lightingW, 'W'), cooling: q(e.coolingW, 'W'), total: q(e.totalW, 'W') }, evidence: 'simulated', assumptions: [B4_WINDOW_ASSUMPTIONS[5]!] },
    { id: 'b4.city', label: 'City energy', modelId: B4_WINDOW_MODEL, version: B4_WINDOW_VERSION, dependsOn: ['b4.energy'],
      inputs: { buildings: q(buildings, 'count'), rooms: q(rooms, 'count') },
      outputs: { total: q(view.city.totalW, 'W'), saving: q(view.city.savingW, 'W') }, evidence: 'simulated', assumptions: [B4_WINDOW_ASSUMPTIONS[6]!] },
  ];
  if (occupied.length) nodes[0]!.inputs.placedIons = q(occupied.length, 'of 125 sites');
  const warnings = view.roomLux < 100 ? ['Room falls below ~100 lx (dim for reading) under these assumptions.'] : [];
  return { view, nodes, warnings };
}
