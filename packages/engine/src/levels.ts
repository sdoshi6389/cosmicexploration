import type { BaselineContext } from './baseline/fromScience.js';
import { REGIONS } from './regions.js';
import { kindsForLevel } from './interventions.js';
import type { AssumptionSpec, Evidence, Intervention, LevelId, LevelOutput, ModelNode } from './types.js';
import { LIGHT_YEAR_M, LSUN_W, type ScienceStar } from './science.js';
import { entityIndex, resolveEntity } from './entities.js';
import { computeStructures } from './models/structures.js';
import { kardashevFromPowerW } from './capabilities/kardashev.js';
import { SECONDS_PER_YEAR, SPEED_OF_LIGHT_MPS } from './models/constants.js';
import { computeK1Grid, K1_GRID_ASSUMPTIONS, K1_GRID_MODEL, K1_GRID_VERSION } from './models/k1Grid.js';
import { computeK2Stellar, K2_STELLAR_ASSUMPTIONS, K2_STELLAR_MODEL, K2_STELLAR_VERSION } from './models/k2Stellar.js';
import { computeK3GalaxyExpansion, K3_ASSUMPTIONS, K3_MODEL_ID, K3_MODEL_VERSION } from './models/k3GalaxyExpansion.js';
import { computeB2Body, B2_BODY_ASSUMPTIONS, B2_BODY_MODEL, B2_BODY_VERSION } from './models/b2Body.js';
import { B2_ASSUMPTIONS } from './models/b2GeneticEdit.js';
import { computeB4Window, B4_WINDOW_ASSUMPTIONS, B4_WINDOW_MODEL, B4_WINDOW_VERSION } from './models/b4Window.js';
import { B4_ASSUMPTIONS, computeB4AtomicState } from './models/b4AtomicState.js';
import { B5_ASSUMPTIONS, computeB5NuclearDecay } from './models/b5NuclearDecay.js';
import { computeB6Device, B6_DEVICE_ASSUMPTIONS, B6_DEVICE_MODEL, B6_DEVICE_VERSION } from './models/b6Device.js';
import { B6_ASSUMPTIONS, computeB6ParticleInteraction } from './models/b6ParticleInteraction.js';

export interface LevelComputeArgs {
  ctx: BaselineContext;
  interventions: Intervention[];
  assumptions: Record<string, unknown>;
  /** Branch simulation clock (scenario seconds). */
  clockSeconds: number;
  seed: number;
}

export interface LevelDefinition {
  level: LevelId;
  title: string;
  modelId: string;
  modelVersion: string;
  minKardashev?: 1 | 2 | 3;
  minBarrow?: 1 | 2 | 3 | 4 | 5 | 6;
  modelAssumptions: string[];
  /** Whether outputs depend on the simulation clock. */
  timeDependent: boolean;
  assumptions: (ctx: BaselineContext) => AssumptionSpec[];
  compute: (a: LevelComputeArgs) => Omit<LevelOutput, 'inputHash' | 'level' | 'modelId' | 'modelVersion' | 'assumptions'>;
}

const ASSUMED = (method: string): Evidence => ({ kind: 'assumed', method });
const num = (args: LevelComputeArgs, specs: AssumptionSpec[], key: string): number => {
  const v = args.assumptions[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return Number(specs.find((s) => s.key === key)?.defaultValue ?? 0);
};
const val = <T,>(args: LevelComputeArgs, specs: AssumptionSpec[], key: string): T =>
  (key in args.assumptions ? args.assumptions[key] : specs.find((s) => s.key === key)?.defaultValue) as T;
const ofLevel = (a: LevelComputeArgs, level: LevelId) => a.interventions.filter((i) => i.level === level);

/* =================================================================== K1 */
const k1Assumptions = (ctx: BaselineContext): AssumptionSpec[] => [
  { key: 'P0_W', level: 'k1', label: `Present civilisation power (${ctx.earth.year})`, unit: 'W', kind: 'number', min: 1e12, max: 1e15, scale: 'log', defaultValue: ctx.earth.P0_W.value, evidence: ctx.earth.P0_W.evidence, description: 'World primary energy expressed as continuous power.' },
  ...REGIONS.map((r): AssumptionSpec => ({
    key: `demand_${r.id}`, level: 'k1', label: `${r.name} demand target`, unit: 'W', kind: 'number', min: 1e11, max: 1e17, scale: 'log',
    defaultValue: (ctx.science.earth.regionalPowerW[r.id] ?? 1e12) * 2,
    evidence: ASSUMED(`2× ${r.name}'s OWID ${ctx.earth.year} primary energy (declared growth scenario)`), description: 'Regional demand the grid tries to meet.',
  })),
  { key: 'lossPer1000km', level: 'k1', label: 'HVDC loss per 1,000 km', unit: '', kind: 'number', min: 0, max: 0.2, step: 0.001, defaultValue: 0.035, evidence: ASSUMED('Typical ±800 kV HVDC line loss ≈3.5%/1,000 km'), description: 'Fraction of exported power lost per 1,000 km of transfer.' },
  { key: 'stellarFlux_W_m2', level: 'k1', label: 'Solar irradiance', unit: 'W/m²', kind: 'number', min: 1000, max: 2000, step: 1, defaultValue: ctx.earth.stellarFlux.value, evidence: ctx.earth.stellarFlux.evidence, description: 'Total solar irradiance.' },
  { key: 'albedo', level: 'k1', label: 'Bond albedo', unit: '', kind: 'number', min: 0.05, max: 0.9, step: 0.001, defaultValue: ctx.earth.albedo.value, evidence: ctx.earth.albedo.evidence, description: 'Reflected fraction of sunlight.' },
  { key: 'emissivity', level: 'k1', label: 'Effective emissivity', unit: '', kind: 'number', min: 0.3, max: 1, step: 0.01, defaultValue: ctx.earth.emissivity.value, evidence: ctx.earth.emissivity.evidence, description: 'Gray-body emissivity.' },
  { key: 'greenhouseOffset_K', level: 'k1', label: 'Greenhouse offset', unit: 'K', kind: 'number', min: 0, max: 80, step: 0.1, defaultValue: ctx.earth.greenhouseOffsetK.value, evidence: ctx.earth.greenhouseOffsetK.evidence, description: 'Matches the observed mean surface temperature.' },
];

const K1: LevelDefinition = {
  level: 'k1', title: 'Kardashev I · Planetary energy', modelId: K1_GRID_MODEL, modelVersion: K1_GRID_VERSION, minKardashev: 1,
  modelAssumptions: K1_GRID_ASSUMPTIONS, timeDependent: false, assumptions: k1Assumptions,
  compute: (a) => {
    const specs = k1Assumptions(a.ctx);
    const demandW: Record<string, number> = {};
    for (const r of REGIONS) demandW[r.id] = num(a, specs, `demand_${r.id}`);
    const { view, nodes, warnings } = computeK1Grid({
      interventions: ofLevel(a, 'k1'), cities: a.ctx.science.earth.cities, regionalBaselineW: a.ctx.science.earth.regionalPowerW,
      P0_W: num(a, specs, 'P0_W'), demandW, lossPer1000km: num(a, specs, 'lossPer1000km'), stellarFlux: num(a, specs, 'stellarFlux_W_m2'),
      albedo: num(a, specs, 'albedo'), emissivity: num(a, specs, 'emissivity'), greenhouseOffsetK: num(a, specs, 'greenhouseOffset_K'),
      earthRadiusM: a.ctx.earth.radius_m,
    });
    const t = view.totals;
    return {
      view, nodes, warnings,
      summary: { usefulW: t.usefulW, installedW: t.installedW, unmetW: t.unmetW, surplusW: t.surplusW, achievedK: t.achievedK, deltaTK: view.climate.deltaTK, facilities: view.facilities.length },
    };
  },
};

/* ============================================================ structures */
function structuresFor(a: LevelComputeArgs, level: 'k2' | 'k3', sunLuminosityW: number, defaultLuminosityW = 0.5 * LSUN_W) {
  const idx = entityIndex(a.ctx.science);
  return computeStructures({
    interventions: a.interventions.filter((i) => i.level === level && i.kind === 'build.structure'),
    resolve: (id) => idx.byId.get(id) ?? resolveEntity(a.ctx.science, id),
    sunLuminosityW, defaultLuminosityW,
  });
}

/* =================================================================== K2 */
const k2Assumptions = (ctx: BaselineContext): AssumptionSpec[] => [
  { key: 'luminosity_W', level: 'k2', label: 'Solar luminosity', unit: 'W', kind: 'number', min: 1e25, max: 1e28, scale: 'log', defaultValue: ctx.sunLuminosityW.value, evidence: ctx.sunLuminosityW.evidence, description: 'Bolometric luminosity.' },
  { key: 'beamEfficiency', level: 'k2', label: 'Beaming efficiency', unit: '', kind: 'number', min: 0.01, max: 1, step: 0.01, defaultValue: 0.6, evidence: ASSUMED('Laser/microwave power-beaming end-to-end efficiency (declared)'), description: 'Fraction of allocated power reaching a load at the swarm radius.' },
  { key: 'beamLossPerAu', level: 'k2', label: 'Beam loss per AU', unit: '1/AU', kind: 'number', min: 0, max: 0.5, step: 0.005, defaultValue: 0.05, evidence: ASSUMED('Declared divergence/pointing loss'), description: 'Additional relative loss per AU between swarm and load.' },
  ...k1Assumptions(ctx).filter((s) => ['albedo', 'emissivity', 'greenhouseOffset_K'].includes(s.key)).map((s) => ({ ...s, key: `earth_${s.key}`, level: 'k2' as const, label: `Earth ${s.label.toLowerCase()}` })),
];

const K2: LevelDefinition = {
  level: 'k2', title: 'Kardashev II · Stellar energy', modelId: K2_STELLAR_MODEL, modelVersion: K2_STELLAR_VERSION, minKardashev: 2,
  modelAssumptions: K2_STELLAR_ASSUMPTIONS, timeDependent: false, assumptions: k2Assumptions,
  compute: (a) => {
    const specs = k2Assumptions(a.ctx);
    const { view, nodes, warnings } = computeK2Stellar({
      interventions: ofLevel(a, 'k2'), luminosityW: num(a, specs, 'luminosity_W'),
      bodies: a.ctx.science.bodies.map((b) => ({ id: b.id, name: b.name, positionM: b.positionM })),
      beamEfficiency: num(a, specs, 'beamEfficiency'), beamLossPerAu: num(a, specs, 'beamLossPerAu'),
      earthAlbedo: num(a, specs, 'earth_albedo'), earthEmissivity: num(a, specs, 'earth_emissivity'), earthGreenhouseOffsetK: num(a, specs, 'earth_greenhouseOffset_K'),
      seed: a.seed,
    });
    const st = structuresFor(a, 'k2', num(a, specs, 'luminosity_W'));
    const t = view.totals;
    const usefulW = t.usefulW + st.totals.usefulW;
    const achievedK = kardashevFromPowerW(Math.max(1, usefulW));
    const merged = { ...view, structures: st.items, totals: { ...t, usefulW, achievedK, structuresW: st.totals.usefulW, structureDemandW: st.totals.demandW, structureServedW: st.totals.servedW } };
    return {
      view: merged, nodes: [...nodes, ...st.nodes], warnings: [...warnings, ...st.warnings],
      summary: { usefulW, deliveredW: t.deliveredW, unmetW: t.unmetW + st.totals.unmetW, achievedK, swarms: view.swarms.length, loads: view.loads.length, structures: st.items.length, structuresW: st.totals.usefulW },
    };
  },
};

/* =================================================================== K3 */
const k3Assumptions = (): AssumptionSpec[] => [
  { key: 'maxHopLy', level: 'k3', label: 'Maximum hop length', unit: 'ly', kind: 'number', min: 5, max: 5000, scale: 'log', defaultValue: 1500, evidence: ASSUMED('Declared ship range per leg'), description: 'Longer neighbour links are not travelled.' },
  { key: 'neighborK', level: 'k3', label: 'Neighbours per star', unit: '', kind: 'number', min: 2, max: 24, step: 1, defaultValue: 8, evidence: ASSUMED('k-nearest-neighbour graph degree'), description: 'Candidate destinations per system.' },
  { key: 'defaultLuminosityLsun', level: 'k3', label: 'Luminosity when unmeasured', unit: 'L☉', kind: 'number', min: 0.001, max: 100, scale: 'log', defaultValue: 0.5, evidence: ASSUMED('Only for stars with no FLAME or photometric estimate'), description: 'Fallback luminosity.' },
  { key: 'assumedStarCount', level: 'k3', label: 'Milky Way star count', unit: '', kind: 'number', min: 1e10, max: 1e12, scale: 'log', defaultValue: 2e11, evidence: ASSUMED('Literature range 1–4×10¹¹'), description: 'Galaxy-wide extrapolation only.' },
  { key: 'assumedMeanLuminosityLsun', level: 'k3', label: 'Mean stellar luminosity', unit: 'L☉', kind: 'number', min: 0.01, max: 2, scale: 'log', defaultValue: 0.15, evidence: ASSUMED('≈3×10¹⁰ L☉ / 2×10¹¹ stars'), description: 'Galaxy-wide extrapolation only.' },
  { key: 'diskScaleLengthKpc', level: 'k3', label: 'Disk scale length', unit: 'kpc', kind: 'number', min: 1, max: 6, step: 0.1, defaultValue: 2.6, evidence: ASSUMED('Bland-Hawthorn & Gerhard 2016'), description: 'Exponential disk radial scale.' },
  { key: 'diskScaleHeightKpc', level: 'k3', label: 'Disk scale height', unit: 'kpc', kind: 'number', min: 0.05, max: 1.5, step: 0.01, defaultValue: 0.3, evidence: ASSUMED('Thin-disk scale height'), description: 'Exponential disk vertical scale.' },
  { key: 'sunGalactocentricKpc', level: 'k3', label: 'Sun–Galactic centre distance', unit: 'kpc', kind: 'number', min: 7, max: 9.5, step: 0.01, defaultValue: 8.18, evidence: ASSUMED('GRAVITY Collaboration 2019'), description: 'Places the Sun in the disk model.' },
];

const filteredStars = new Map<string, { stars: ScienceStar[]; indexInFull: Int32Array }>();
function starsFor(ctx: BaselineContext, targets: string, originId: string): { stars: ScienceStar[]; indexInFull: Int32Array } {
  const key = `${ctx.science.baselineId}:${targets}:${originId}`;
  const hit = filteredStars.get(key);
  if (hit) return hit;
  const all = ctx.science.stars;
  const hosts = new Set(ctx.science.exoplanetHostIds);
  const keep = (s: ScienceStar) =>
    s.id === originId || s.id === 'star.sol' ||
    (targets === 'exoplanet_hosts' ? hosts.has(s.id) : targets === 'sunlike' ? (s.luminosityLsun ?? 0) >= 0.5 && (s.luminosityLsun ?? 0) <= 2 : true);
  const idx: number[] = [];
  const stars: ScienceStar[] = [];
  all.forEach((s, i) => {
    if (keep(s)) {
      idx.push(i);
      stars.push(s);
    }
  });
  const out = { stars: targets === 'all' ? all : stars, indexInFull: targets === 'all' ? new Int32Array(0) : Int32Array.from(idx) };
  filteredStars.set(key, out);
  return out;
}

const K3: LevelDefinition = {
  level: 'k3', title: 'Kardashev III · Galactic expansion', modelId: K3_MODEL_ID, modelVersion: K3_MODEL_VERSION, minKardashev: 3,
  modelAssumptions: K3_ASSUMPTIONS, timeDependent: true, assumptions: k3Assumptions,
  compute: (a) => {
    const iv = ofLevel(a, 'k3').find((i) => i.kind === 'k3.expansion');
    const specs = k3Assumptions();
    const st = structuresFor(a, 'k3', a.ctx.sunLuminosityW.value, num(a, specs, 'defaultLuminosityLsun') * LSUN_W);
    if (!iv) {
      if (!st.items.length) return { view: null, nodes: [], warnings: [], summary: {} as Record<string, number | string | boolean> };
      return {
        view: { structures: st.items, structuresOnly: true }, nodes: st.nodes, warnings: st.warnings,
        summary: { structures: st.items.length, structuresW: st.totals.usefulW, achievedK: st.totals.achievedK } as Record<string, number | string | boolean>,
      };
    }
    const p = iv.params;
    const n = (k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
    const origin = String(p.originStarId ?? 'star.sol');
    const targets = String(p.targets ?? 'all');
    const { stars, indexInFull } = starsFor(a.ctx, targets, origin);
    const originIndex = Math.max(0, stars.findIndex((s) => s.id === origin));
    const elapsed = Math.max(0, a.clockSeconds - n('startTime_yr', 0) * SECONDS_PER_YEAR);
    const build = p.buildSwarms !== false;
    const out = computeK3GalaxyExpansion({
      stars, originIndex, scenarioTimeSeconds: elapsed, travelSpeedMps: n('speed_c', 0.1) * SPEED_OF_LIGHT_MPS,
      settlementDelaySeconds: n('settlementDelay_yr', 50) * SECONDS_PER_YEAR, maxHopLy: num(a, specs, 'maxHopLy'), neighborK: num(a, specs, 'neighborK'),
      captureFraction: build ? n('captureFraction', 0.5) : 0, efficiency: n('efficiency', 0.4), speculativeFTL: p.speculativeFTL === true,
      defaultLuminosityLsun: num(a, specs, 'defaultLuminosityLsun'), assumedStarCount: num(a, specs, 'assumedStarCount'),
      assumedMeanLuminosityLsun: num(a, specs, 'assumedMeanLuminosityLsun'), diskScaleLengthKpc: num(a, specs, 'diskScaleLengthKpc'),
      diskScaleHeightKpc: num(a, specs, 'diskScaleHeightKpc'), sunGalactocentricKpc: num(a, specs, 'sunGalactocentricKpc'),
    });
    const warnings: string[] = [];
    if (p.speculativeFTL === true) warnings.push('Speculative FTL mode: speeds above c violate known physics.');
    if (!build) warnings.push('Swarms disabled: settled systems capture no stellar power in this scenario.');
    const view = { ...out, targets, buildSwarms: build, startTimeYr: n('startTime_yr', 0), elapsedSeconds: elapsed, indexInFull, structures: st.items };
    warnings.push(...st.warnings);
    const q = (value: number | boolean, unit: string) => ({ value, unit });
    const nodes: ModelNode[] = [
      { id: 'k3.graph', label: 'Stellar neighbour graph', modelId: K3_MODEL_ID, version: K3_MODEL_VERSION, dependsOn: [], inputs: { stars: q(stars.length, 'count'), maxHop: q(num(a, specs, 'maxHopLy'), 'ly') }, outputs: { reachable: q(out.reachableCount, 'count') }, evidence: 'derived', assumptions: [K3_ASSUMPTIONS[0]!] },
      { id: 'k3.arrivals', label: 'Arrival times (Dijkstra)', modelId: K3_MODEL_ID, version: K3_MODEL_VERSION, dependsOn: ['k3.graph'], inputs: { speed: q(n('speed_c', 0.1), 'c'), delay: q(n('settlementDelay_yr', 50), 'yr') }, outputs: { settled: q(out.settledCount, 'count'), frontLy: q(out.frontRadiusM / LIGHT_YEAR_M, 'ly') }, evidence: 'simulated', assumptions: [K3_ASSUMPTIONS[1]!, K3_ASSUMPTIONS[2]!] },
      { id: 'k3.energy', label: 'Settled-system power', modelId: K3_MODEL_ID, version: K3_MODEL_VERSION, dependsOn: ['k3.arrivals'], inputs: { buildSwarms: q(build, 'bool'), capture: q(build ? n('captureFraction', 0.5) : 0, '1') }, outputs: { sampleW: q(out.sampleUsefulPowerW, 'W'), K: q(out.achievedK, 'K') }, evidence: 'simulated', assumptions: [K3_ASSUMPTIONS[3]!, K3_ASSUMPTIONS[4]!] },
      { id: 'k3.extrapolation', label: 'Galaxy-wide extrapolation', modelId: 'exponential-disk', version: '1.0.0', dependsOn: ['k3.energy'], inputs: { starCount: q(num(a, specs, 'assumedStarCount'), 'count') }, outputs: { galaxyW: q(out.galaxyExtrapolation.extrapolatedPowerW, 'W'), K: q(out.galaxyExtrapolation.extrapolatedK, 'K') }, evidence: 'assumed', assumptions: [K3_ASSUMPTIONS[5]!] },
    ];
    const totalW = out.sampleUsefulPowerW + st.totals.usefulW;
    return {
      view, nodes: [...nodes, ...st.nodes], warnings,
      summary: { settledCount: out.settledCount, coverage: out.coverageFraction, sampleW: out.sampleUsefulPowerW, achievedK: kardashevFromPowerW(Math.max(1, totalW)), frontLy: out.frontRadiusM / LIGHT_YEAR_M, elapsedYr: elapsed / SECONDS_PER_YEAR, structures: st.items.length, structuresW: st.totals.usefulW },
    };
  },
};

/* =================================================================== B2 */
const b2Assumptions = (): AssumptionSpec[] => [
  { key: 'mechanismRule', level: 'b2', label: 'Protein → cell rule', unit: '', kind: 'choice', defaultValue: 'qualitative_hb_rules', evidence: ASSUMED('Declared educational rule table'), description: 'How protein changes map to red-cell behaviour.', choices: [{ value: 'qualitative_hb_rules', label: 'Qualitative haemoglobinopathy rules' }, { value: 'sequence_only', label: 'Sequence only' }] },
  { key: 'zygosity', level: 'b2', label: 'Alleles edited', unit: '', kind: 'choice', defaultValue: 'both', evidence: ASSUMED('Counterfactual applies to both HBB copies unless set to one'), description: 'Both alleles (disease model) or one (carrier).', choices: [{ value: 'both', label: 'Both alleles' }, { value: 'one', label: 'One allele (carrier)' }] },
  { key: 'sicklingThreshold', level: 'b2', label: 'Sickling threshold (HbS fraction)', unit: '', kind: 'number', min: 0, max: 0.9, step: 0.01, defaultValue: 0.5, evidence: ASSUMED('Carriers (~40% HbS) rarely sickle'), description: 'Below this variant fraction cells do not sickle.' },
  { key: 'maxSickledFraction', level: 'b2', label: 'Sickled fraction (homozygous, hypoxic)', unit: '', kind: 'number', min: 0, max: 1, step: 0.01, defaultValue: 0.3, evidence: ASSUMED('Educational scale value'), description: 'Fraction of red cells sickled under low oxygen when fully HbS.' },
  { key: 'hbNormal', level: 'b2', label: 'Normal haemoglobin', unit: 'g/dL', kind: 'number', min: 10, max: 18, step: 0.1, defaultValue: 14.5, evidence: ASSUMED('Typical adult reference value'), description: 'Baseline blood haemoglobin.' },
  { key: 'hbSevere', level: 'b2', label: 'Haemoglobin in severe anaemia', unit: 'g/dL', kind: 'number', min: 4, max: 12, step: 0.1, defaultValue: 8, evidence: ASSUMED('Typical steady-state value in sickle-cell anaemia (6–9 g/dL)'), description: 'Value reached at full severity.' },
  { key: 'occlusionFactor', level: 'b2', label: 'Microvascular occlusion factor', unit: '', kind: 'number', min: 0, max: 1, step: 0.01, defaultValue: 0.35, evidence: ASSUMED('Declared toy coefficient'), description: 'O₂ delivery lost per unit sickled fraction.' },
  { key: 'compensationMax', level: 'b2', label: 'Max cardiac compensation', unit: '×', kind: 'number', min: 1, max: 2, step: 0.01, defaultValue: 1.3, evidence: ASSUMED('Declared cap on raised cardiac output'), description: 'How much the heart can compensate.' },
];

const B2: LevelDefinition = {
  level: 'b2', title: 'Barrow B2 · Gene → body', modelId: B2_BODY_MODEL, modelVersion: B2_BODY_VERSION, minBarrow: 2,
  modelAssumptions: [...B2_ASSUMPTIONS, ...B2_BODY_ASSUMPTIONS], timeDependent: false, assumptions: b2Assumptions,
  compute: (a) => {
    const s = b2Assumptions();
    const hbb = a.ctx.science.hbb;
    const { view, nodes, warnings } = computeB2Body({
      interventions: ofLevel(a, 'b2'), referenceCds: hbb.cds.value, transcript: hbb.transcript, variants: hbb.variants, residues: hbb.residues,
      betaChains: hbb.betaChains, mechanismRule: val(a, s, 'mechanismRule'), zygosity: val(a, s, 'zygosity'), sicklingThreshold: num(a, s, 'sicklingThreshold'),
      maxSickledFraction: num(a, s, 'maxSickledFraction'), hbNormal: num(a, s, 'hbNormal'), hbSevere: num(a, s, 'hbSevere'),
      occlusionFactor: num(a, s, 'occlusionFactor'), compensationMax: num(a, s, 'compensationMax'),
    });
    return {
      view, nodes, warnings,
      summary: {
        phenotype: view.phenotype, sickledFraction: view.sickledFraction, hemoglobin: view.hemoglobinGdl, oxygenDelivery: view.oxygenDeliveryRelative, edits: view.edits.length,
        population: view.population.size, meanOxygenDelivery: view.population.meanOxygenDelivery, symptomatic: view.population.symptomatic,
      },
    };
  },
};

/* =================================================================== B4 */
const b4Assumptions = (): AssumptionSpec[] => [
  { key: 'outdoorLux', level: 'b4', label: 'Outdoor daylight', unit: 'lx', kind: 'number', min: 1000, max: 120000, scale: 'log', defaultValue: 20000, evidence: ASSUMED('Overcast-to-bright daylight on the façade'), description: 'Illuminance on the window.' },
  { key: 'daylightCoupling', level: 'b4', label: 'Daylight coupling', unit: '', kind: 'number', min: 0.05, max: 1, step: 0.01, defaultValue: 0.4, evidence: ASSUMED('Sky-view × utilisation factor'), description: 'Share of transmitted light reaching the work plane.' },
  { key: 'surfaceReflectance', level: 'b4', label: 'Film surface reflectance', unit: '', kind: 'number', min: 0, max: 0.4, step: 0.01, defaultValue: 0.08, evidence: ASSUMED('Typical coated glass'), description: 'Reflection at each surface.' },
  { key: 'baselineX', level: 'b4', label: 'Baseline insertion x', unit: 'e⁻/site', kind: 'number', min: 0, max: 0.5, step: 0.005, defaultValue: 0.25, evidence: ASSUMED('Reference state used for before/after'), description: 'Comparison state of the film.' },
  { key: 'useNist', level: 'b4', label: 'Use NIST evaluated levels', unit: '', kind: 'boolean', defaultValue: true, evidence: ASSUMED('Off = Bohr model'), description: 'Hydrogen transition energies source.' },
];

const B4: LevelDefinition = {
  level: 'b4', title: 'Barrow B4 · Atom → material → room', modelId: B4_WINDOW_MODEL, modelVersion: B4_WINDOW_VERSION, minBarrow: 4,
  modelAssumptions: [...B4_WINDOW_ASSUMPTIONS, ...B4_ASSUMPTIONS], timeDependent: false, assumptions: b4Assumptions,
  compute: (a) => {
    const s = b4Assumptions();
    const ivs = ofLevel(a, 'b4');
    const w = computeB4Window({
      interventions: ivs, materials: a.ctx.science.materials, outdoorLux: num(a, s, 'outdoorLux'), daylightCoupling: num(a, s, 'daylightCoupling'),
      surfaceReflectance: num(a, s, 'surfaceReflectance'), baselineX: num(a, s, 'baselineX'),
    });
    const tr = ivs.find((i) => i.kind === 'b4.transition');
    const transition = tr
      ? computeB4AtomicState({
        nInitial: Number(tr.params.nInitial ?? 1), lInitial: Number(tr.params.lInitial ?? 0), nFinal: Number(tr.params.nFinal ?? 3),
        lFinal: Number(tr.params.lFinal ?? 1), mFinal: Number(tr.params.mFinal ?? 0), levels: a.ctx.hydrogenLevels, lines: a.ctx.hydrogenLines,
        ionizationEv: a.ctx.hydrogenIonizationEv.value, useNist: val<boolean>(a, s, 'useNist') !== false,
      })
      : null;
    const nodes = [...w.nodes];
    if (transition) {
      nodes.push({ id: 'b4.transition', label: 'Hydrogen transition', modelId: 'b4-atomic-state', version: '2.0.0', dependsOn: [],
        inputs: { initial: { value: transition.initial.configuration, unit: '' }, final: { value: transition.final.configuration, unit: '' } },
        outputs: { deltaE: { value: transition.deltaEnergyEv, unit: 'eV' }, wavelength: { value: transition.photonWavelengthNm, unit: 'nm' } }, evidence: 'simulated', assumptions: B4_ASSUMPTIONS });
    }
    const warnings = [...w.warnings, ...(transition && !transition.selectionRuleAllowed ? [transition.selectionRuleNote] : [])];
    return {
      view: { window: w.view, transition }, nodes, warnings,
      summary: {
        transmission: w.view?.transmission ?? 0, roomLux: w.view?.roomLux ?? 0, insertion: w.view?.x ?? 0, wavelengthNm: transition?.photonWavelengthNm ?? 0,
        roomEnergyW: w.view?.room.totalW ?? 0, cityEnergyW: w.view?.city.totalW ?? 0, citySavingW: w.view?.city.savingW ?? 0,
      },
    };
  },
};

/* =================================================================== B5 */
const B5: LevelDefinition = {
  level: 'b5', title: 'Barrow B5 · Nuclear decay', modelId: 'b5-nuclear-decay', modelVersion: '1.0.0', minBarrow: 5,
  modelAssumptions: B5_ASSUMPTIONS, timeDependent: false, assumptions: () => [],
  compute: (a) => {
    const iv = ofLevel(a, 'b5').find((i) => i.kind === 'b5.decay');
    const na = a.ctx.na22;
    if (!iv || !na) return { view: null, nodes: [], warnings: [], summary: {} as Record<string, number | string | boolean> };
    const out = computeB5NuclearDecay({ halfLifeS: na.halfLifeS.value, qEcKeV: na.qEcKeV.value, gammaKeV: na.gammaKeV, electronMassKeV: a.ctx.electronMassMeV.value * 1000, positronFraction: Number(iv.params.positronFraction ?? 0.395), molarMassG: 21.9944 });
    const nodes: ModelNode[] = [{ id: 'b5.decay', label: 'β⁺ decay kinematics', modelId: 'b5-nuclear-decay', version: '1.0.0', dependsOn: [], inputs: { qEC: { value: na.qEcKeV.value, unit: 'keV' } }, outputs: { positron: { value: out.positronKineticKeV, unit: 'keV' }, gamma: { value: out.gammaKeV, unit: 'keV' } }, evidence: 'simulated', assumptions: B5_ASSUMPTIONS }];
    return { view: out, nodes, warnings: [], summary: { positronKeV: out.positronKineticKeV, gammaKeV: out.gammaKeV, balanced: out.ledger.balanced } };
  },
};

/* =================================================================== B6 */
const b6Assumptions = (ctx: BaselineContext): AssumptionSpec[] => [
  { key: 'electronMass_MeV', level: 'b6', label: 'Electron mass', unit: 'MeV/c²', kind: 'number', min: 0.5, max: 0.52, step: 1e-6, defaultValue: ctx.electronMassMeV.value, evidence: ctx.electronMassMeV.evidence, description: 'Rest energy mₑc² (PDG).' },
  { key: 'supplyEfficiency', level: 'b6', label: 'Positron supply efficiency', unit: '', kind: 'number', min: 1e-9, max: 1, scale: 'log', defaultValue: 1e-4, evidence: ASSUMED('Declared; present accelerator antimatter production is far lower (~10⁻⁹)'), description: 'Fraction of input energy embodied in each supplied positron.' },
];

const B6: LevelDefinition = {
  level: 'b6', title: 'Barrow B6 · Particle → device → lights', modelId: B6_DEVICE_MODEL, modelVersion: B6_DEVICE_VERSION, minBarrow: 6,
  modelAssumptions: [...B6_DEVICE_ASSUMPTIONS, ...B6_ASSUMPTIONS], timeDependent: false, assumptions: b6Assumptions,
  compute: (a) => {
    const s = b6Assumptions(a.ctx);
    const ivs = ofLevel(a, 'b6');
    const me = num(a, s, 'electronMass_MeV');
    const protonMassMeV = a.ctx.science.particles.find((pp) => pp.mcId === 2212)?.massMeV ?? 938.272;
    const d = computeB6Device({ interventions: ivs, electronMassMeV: me, protonMassMeV, thresholds: a.ctx.thresholds, supplyEfficiency: num(a, s, 'supplyEfficiency') });
    const col = ivs.find((i) => i.kind === 'b6.collision');
    const collision = col ? computeB6ParticleInteraction({ kineticEnergyMeV: Number(col.params.kineticEnergy_MeV ?? 0.5), axis: [1, 0, 0], photonAngleDeg: Number(col.params.photonAngle_deg ?? 90), electronMassMeV: me, thresholds: a.ctx.thresholds }) : null;
    return {
      view: { device: d.view, collision: collision ?? d.view?.interaction ?? null }, nodes: d.nodes, warnings: d.warnings,
      summary: { cityLitFraction: d.view?.city?.litFraction ?? 0, cityDemandW: d.view?.city?.demandW ?? 0, grossW: d.view?.grossW ?? 0, supplyInputW: d.view?.supplyInputW ?? 0, electricalW: d.view?.electricalW ?? 0, heatW: d.view?.heatW ?? 0, netW: d.view?.netW ?? 0, litFraction: d.view?.litFraction ?? 0, balanced: (collision ?? d.view?.interaction)?.conservation.balanced ?? false },
    };
  },
};

export const LEVELS: Record<LevelId, LevelDefinition> = { k1: K1, k2: K2, k3: K3, b2: B2, b4: B4, b5: B5, b6: B6 };

export function levelForAssumption(ctx: BaselineContext, key: string): LevelDefinition | undefined {
  return Object.values(LEVELS).find((l) => l.assumptions(ctx).some((a) => a.key === key));
}

export function kindsOf(level: LevelId) {
  return kindsForLevel(level);
}
