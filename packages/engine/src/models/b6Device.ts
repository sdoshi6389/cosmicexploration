import type { Intervention, ModelNode } from '../types.js';
import { MEV_TO_JOULE } from './constants.js';
import { computeB6ParticleInteraction } from './b6ParticleInteraction.js';
import type { B6Output } from './outputs.js';

export const B6_DEVICE_MODEL = 'b6-annihilation-device';
export const B6_DEVICE_VERSION = '1.0.0';

export const B6_DEVICE_ASSUMPTIONS = [
  'Hypothetical device. Each event is an equal-energy e⁺e⁻ annihilation (toy kinematics, PDG electron mass); energy per event = 2(mₑc² + T).',
  'Gross power = event rate × energy per event; a declared fraction of the photons is absorbed and a declared efficiency becomes electricity; everything else is heat.',
  'Particle supply is not free: producing each positron costs (mₑc² + T) / supply efficiency of input energy (declared). Net power = electrical − supply input.',
  'Lights draw their rated power; brightness = min(1, available electrical power / total rated load).',
  'Proton–antiproton annihilation yields mostly pions; a declared ~50% of the energy leaves as neutrinos and cannot be captured. Masses from PDG.',
  'City grid: households draw a declared average power; the share of districts lit = min(1, reactor output / demand).',
];

export interface B6CityView {
  households: number;
  demandW: number;
  supplyW: number;
  litFraction: number;
  netW: number;
}

export interface B6DeviceView {
  interventionId: string;
  label: string;
  interaction: B6Output;
  eventRatePerS: number;
  energyPerEventJ: number;
  grossW: number;
  capturedW: number;
  electricalW: number;
  heatW: number;
  supplyInputW: number;
  netW: number;
  lightCount: number;
  lightPowerW: number;
  loadW: number;
  litFraction: number;
  positronsPerSecond: number;
  species: 'electron' | 'proton';
  particleMassMeV: number;
  units: number;
  escapedW: number;
  city: B6CityView | null;
}

export interface B6DeviceInputs {
  interventions: Intervention[];
  electronMassMeV: number;
  protonMassMeV: number;
  thresholds: { label: string; massMeV: number }[];
  supplyEfficiency: number;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function computeB6Device(inp: B6DeviceInputs): { view: B6DeviceView | null; nodes: ModelNode[]; warnings: string[] } {
  const iv = inp.interventions.find((i) => i.kind === 'b6.device');
  if (!iv) return { view: null, nodes: [], warnings: [] };
  const p = iv.params;
  const T = clamp(num(p.kineticEnergy_MeV, 0.5), 0, 1e5);
  const rate = clamp(num(p.eventRate_per_s, 1e14), 0, 1e22);
  const capture = clamp(num(p.captureFraction, 0.8), 0, 1);
  const eta = clamp(num(p.conversionEfficiency, 0.35), 0, 1);
  const n = Math.round(clamp(num(p.lightCount, 8), 0, 64));
  const pl = clamp(num(p.lightPower_W, 60), 1, 5000);
  const species = p.species === 'proton' ? 'proton' : 'electron';
  const m = species === 'proton' ? inp.protonMassMeV : inp.electronMassMeV;
  const units = Math.max(1, Math.round(num(p.units, 1)));
  const interaction = computeB6ParticleInteraction({ kineticEnergyMeV: T, axis: [1, 0, 0], photonAngleDeg: 90, electronMassMeV: inp.electronMassMeV, thresholds: inp.thresholds });
  const eEvent = 2 * (m + T) * MEV_TO_JOULE;
  const gross = rate * eEvent * units;
  const escaped = species === 'proton' ? gross * 0.5 : 0;
  const captured = (gross - escaped) * capture;
  const electrical = captured * eta;
  const heat = gross - escaped - electrical;
  const supply = (rate * units * (m + T) * MEV_TO_JOULE) / Math.max(1e-12, inp.supplyEfficiency);
  const load = n * pl;
  const lit = load > 0 ? clamp(electrical / load, 0, 1) : 0;
  const view: B6DeviceView = {
    interventionId: iv.id, label: iv.label, interaction, eventRatePerS: rate, energyPerEventJ: eEvent, grossW: gross, capturedW: captured,
    electricalW: electrical, heatW: heat, supplyInputW: supply, netW: electrical - supply, lightCount: n, lightPowerW: pl, loadW: load,
    litFraction: lit, positronsPerSecond: rate * units, species, particleMassMeV: m, units, escapedW: escaped, city: null,
  };
  const cityIv = inp.interventions.find((i) => i.kind === 'b6.city');
  if (cityIv) {
    const households = Math.max(1, Math.round(num(cityIv.params.households, 1e5)));
    const demand = households * num(cityIv.params.demandPerHousehold_W, 1200);
    view.city = { households, demandW: demand, supplyW: electrical, litFraction: clamp(electrical / demand, 0, 1), netW: electrical - supply };
  }
  const W = (v: number) => ({ value: v, unit: 'W' });
  const nodes: ModelNode[] = [
    { id: 'b6.interaction', label: 'e⁺e⁻ → γγ kinematics', modelId: 'b6-particle-interaction', version: '2.0.0', dependsOn: [],
      inputs: { kineticEnergy: { value: T, unit: 'MeV' }, electronMass: { value: inp.electronMassMeV, unit: 'MeV' } },
      outputs: { energyPerEvent: { value: eEvent, unit: 'J' }, photonEnergy: { value: interaction.photonEnergyMev, unit: 'MeV' }, balanced: { value: interaction.conservation.balanced, unit: 'bool' } },
      evidence: 'simulated', assumptions: [B6_DEVICE_ASSUMPTIONS[0]!] },
    { id: 'b6.conversion', label: 'Photon capture & conversion', modelId: B6_DEVICE_MODEL, version: B6_DEVICE_VERSION, dependsOn: ['b6.interaction'],
      inputs: { rate: { value: rate, unit: 'events/s' }, captureFraction: { value: capture, unit: '1' }, efficiency: { value: eta, unit: '1' } },
      outputs: { gross: W(gross), electrical: W(electrical), heat: W(heat) }, evidence: 'simulated', assumptions: [B6_DEVICE_ASSUMPTIONS[1]!] },
    { id: 'b6.supply', label: 'Positron supply energy budget', modelId: B6_DEVICE_MODEL, version: B6_DEVICE_VERSION, dependsOn: ['b6.conversion'],
      inputs: { supplyEfficiency: { value: inp.supplyEfficiency, unit: '1' } }, outputs: { supplyInput: W(supply), net: W(electrical - supply) },
      evidence: 'assumed', assumptions: [B6_DEVICE_ASSUMPTIONS[2]!] },
    { id: 'b6.loads', label: 'Connected lights', modelId: B6_DEVICE_MODEL, version: B6_DEVICE_VERSION, dependsOn: ['b6.conversion'],
      inputs: { electrical: W(electrical), load: W(load) }, outputs: { litFraction: { value: lit, unit: '1' } }, evidence: 'simulated', assumptions: [B6_DEVICE_ASSUMPTIONS[3]!] },
  ];
  nodes[0] = { ...nodes[0]!, label: species === 'proton' ? 'p p̄ → pions (energy budget)' : nodes[0]!.label, inputs: { ...nodes[0]!.inputs, particleMass: { value: m, unit: 'MeV' }, species: { value: species, unit: '' } }, assumptions: species === 'proton' ? [B6_DEVICE_ASSUMPTIONS[4]!] : nodes[0]!.assumptions };
  if (escaped > 0) nodes[1]!.outputs.neutrinoLoss = W(escaped);
  if (view.city) {
    nodes.push({ id: 'b6.city', label: 'City grid', modelId: B6_DEVICE_MODEL, version: B6_DEVICE_VERSION, dependsOn: ['b6.conversion', 'b6.supply'],
      inputs: { households: { value: view.city.households, unit: 'count' }, demand: W(view.city.demandW) },
      outputs: { supply: W(electrical), districtsLit: { value: view.city.litFraction, unit: '1' } }, evidence: 'simulated', assumptions: [B6_DEVICE_ASSUMPTIONS[5]!] });
  }
  const warnings = [`Net power ${electrical - supply >= 0 ? '+' : ''}${(electrical - supply).toExponential(2)} W after paying for positron supply — annihilation is a store of energy, not a free source.`];
  return { view, nodes, warnings };
}
