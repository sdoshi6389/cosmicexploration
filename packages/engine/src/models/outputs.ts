/**
 * Renderable model output contracts.
 *
 * Scenes read these shapes from projected scenario state. Every field a renderer
 * needs is here, so geometry can only show what a model calculated. Units are in
 * field names.
 */

/* ------------------------------------------------------------------ K1 ----- */

export type K1InfrastructureKind =
  | 'solar_farm'
  | 'wind_array'
  | 'fusion_plant'
  | 'fission_plant'
  | 'geothermal'
  | 'orbital_ring'
  | 'orbital_collector'
  | 'rectenna'
  | 'space_elevator';

export interface K1InfrastructureNode {
  id: string;
  kind: K1InfrastructureKind;
  label: string;
  latDeg: number;
  lonDeg: number;
  altitudeM: number;
  capacityW: number;
  /** Build order 0..1, used to stagger the construction animation. */
  buildOrder: number;
  linkedToId?: string;
  cityId?: string;
}

export type K1ClimateKind = 'none' | 'orbital_shade' | 'stratospheric_aerosol' | 'surface_albedo';

export interface K1Output {
  baselinePowerW: number;
  baselineYear: number;
  addedCapacityW: number;
  utilization: number;
  distributionEfficiency: number;
  usefulPowerW: number;
  addedUsefulPowerW: number;
  distributionLossesW: number;
  achievedK: number;
  baselineK: number;
  /** Multiplier on present-day civilisation power (drives night-light intensity). */
  powerMultiple: number;
  albedo: number;
  baselineAlbedo: number;
  emissivity: number;
  stellarFluxWm2: number;
  greenhouseOffsetK: number;
  baselineTempK: number;
  equilibriumTempK: number;
  deltaTK: number;
  wasteHeatForcingWm2: number;
  /** Forcing from waste heat relative to 2xCO2 radiative forcing (≈3.7 W/m²), for scale. */
  wasteHeatVsCo2Doubling: number;
  climate: { kind: K1ClimateKind; magnitude: number; deltaAlbedo: number };
  infrastructure: K1InfrastructureNode[];
  gridNetwork: { fromId: string; toId: string; powerW: number }[];
  mix: { kind: K1InfrastructureKind; capacityW: number }[];
}

/* ------------------------------------------------------------------ K2 ----- */

export interface K2CollectorBand {
  id: string;
  radiusM: number;
  inclinationDeg: number;
  ascendingNodeDeg: number;
  collectorCount: number;
  /** Keplerian orbital period at this radius around the star (days). */
  periodDays: number;
}

export interface K2CollectorSample {
  bandIndex: number;
  /** Orbital phase (radians) at scenario epoch. */
  phase: number;
}

export interface K2Output {
  starLuminosityW: number;
  captureFraction: number;
  conversionEfficiency: number;
  orbitalRadiusM: number;
  collectorCount: number;
  interceptedPowerW: number;
  usefulPowerW: number;
  wasteHeatW: number;
  effectiveAreaM2: number;
  perCollectorAreaM2: number;
  achievedK: number;
  /** Equilibrium temperature of the radiating swarm (outer surface), K. */
  swarmRadiatorTempK: number;
  /** Wien peak of the swarm's waste-heat emission, µm (infrared signature). */
  radiatorPeakMicron: number;
  /** Fraction of starlight still escaping to the outer system. */
  transmittedFraction: number;
  /** Earth's insolation and equilibrium temperature if the swarm sits inside 1 AU. */
  earthInsolationWm2: number;
  earthEquilibriumTempK: number;
  earthShadowed: boolean;
  bands: K2CollectorBand[];
  collectorSample: K2CollectorSample[];
  omittedEffects: string[];
}

/* ------------------------------------------------------------------ K3 ----- */

export interface K3Output {
  travelSpeedMps: number;
  travelSpeedFractionC: number;
  settlementDelaySeconds: number;
  scenarioTimeSeconds: number;
  maxHopLy: number;
  captureFraction: number;
  conversionEfficiency: number;
  sampleSize: number;
  reachableCount: number;
  settledCount: number;
  coverageFraction: number;
  /** Causal front radius (speed × time), metres. */
  frontRadiusM: number;
  /** Distance of the farthest settled star, metres. */
  settledExtentM: number;
  sampleUsefulPowerW: number;
  achievedK: number;
  speculativeFtl: boolean;
  originStarId: string;
  /** Per-star arrival times in seconds (Infinity = unreachable), aligned with the star sample order. */
  arrivalSeconds: Float64Array | number[];
  /** Parent index in the sample for each star (-1 = origin/unreachable). */
  parentIndex: Int32Array | number[];
  /** Time (s) at which coverage reaches 10/50/90 % of reachable stars. */
  milestones: { fraction: number; seconds: number }[];
  galaxyExtrapolation: {
    modelLabel: string;
    disk: { scaleLengthKpc: number; scaleHeightKpc: number; sunRadiusKpc: number };
    assumedStarCount: number;
    assumedMeanLuminosityLsun: number;
    fractionOfGalaxyInsideFront: number;
    extrapolatedPowerW: number;
    extrapolatedK: number;
  };
}

/* ------------------------------------------------------------------ B2 ----- */

export type B2Stage = 'dna' | 'mrna' | 'protein' | 'cell';

export interface B2MechanismStep {
  stage: B2Stage;
  title: string;
  before: string;
  after: string;
  note: string;
  assumption: string;
}

export type B2Phenotype = 'normal' | 'sickle' | 'crystal' | 'unstable' | 'absent_beta' | 'unknown';

export interface B2Output {
  operation: 'introduce' | 'repair' | 'custom';
  variantRsId: string | null;
  variantLabel: string;
  clinvarId: string | null;
  clinicalSignificance: string | null;
  reviewStatus: string | null;
  transcript: string;
  cdsPosition: number;
  refBase: string;
  altBase: string;
  applied: boolean;
  validationMessage: string;
  codonIndex: number;
  beforeCodon: string;
  afterCodon: string;
  beforeAminoAcid: string;
  afterAminoAcid: string;
  /** HGVS protein numbering (Met = 1). */
  hgvsResidue: number;
  /** Mature-protein / crystallographic numbering (Met removed) used by 4HHB and 2HBS. */
  structureResidue: number;
  structureMappingValidated: boolean;
  structureNote: string;
  betaChains: string[];
  /** Window of the CDS around the edit, for display. */
  /** Full post-edit CDS so later edits in the branch validate against the current sequence. */
  afterCds: string;
  windowStart: number;
  windowBefore: string;
  windowAfter: string;
  beforeProteinWindow: string;
  afterProteinWindow: string;
  phenotype: B2Phenotype;
  /** 0..1 qualitative tendency from the declared toy rule (not a probability). */
  polymerisationTendency: number;
  mechanismRule: string;
  mechanism: B2MechanismStep[];
  /** PDB entry that best represents the post-edit state (2HBS exists for HbS). */
  structureEntry: string;
}

/* ------------------------------------------------------------------ B4 ----- */

export interface B4LevelState {
  configuration: string;
  n: number;
  l: number;
  energyEv: number;
  occupied: boolean;
}

export interface B4Output {
  species: string;
  initial: { configuration: string; n: number; l: number; energyEv: number };
  final: { configuration: string; n: number; l: number; m: number; energyEv: number };
  energySource: 'nist' | 'bohr';
  deltaEnergyEv: number;
  deltaEnergyJ: number;
  process: 'absorption' | 'emission' | 'none';
  photonFrequencyHz: number;
  photonWavelengthNm: number;
  photonEnergyEv: number;
  band: 'gamma' | 'x-ray' | 'uv' | 'visible' | 'infrared' | 'microwave' | 'radio' | 'none';
  visibleColorHex: string | null;
  selectionRuleAllowed: boolean;
  selectionRuleNote: string;
  /** NIST Einstein A coefficient for the matched line, s⁻¹ (null when not evaluated). */
  einsteinAPerS: number | null;
  /** Radiative lifetime 1/A of the upper level for this channel, s. */
  upperLifetimeS: number | null;
  nistLineWavelengthNm: number | null;
  seriesName: string | null;
  ionisationEnergyEv: number;
  ionised: boolean;
  levels: B4LevelState[];
  orbital: { n: number; l: number; m: number; label: string; meanRadiusBohr: number };
}

/* ------------------------------------------------------------------ B5 ----- */

export interface B5Output {
  parent: string;
  daughter: string;
  mode: 'beta+' | 'EC';
  halfLifeS: number;
  qEcKeV: number;
  excitedLevelKeV: number;
  positronEndpointKeV: number;
  positronKineticKeV: number;
  neutrinoEnergyKeV: number;
  gammaKeV: number;
  ledger: {
    chargeIn: number;
    chargeOut: number;
    baryonIn: number;
    baryonOut: number;
    leptonIn: number;
    leptonOut: number;
    energyAvailableKeV: number;
    energyAccountedKeV: number;
    balanced: boolean;
  };
  activityBqPerMicrogram: number;
}

/* ------------------------------------------------------------------ B6 ----- */

export interface B6ParticleState {
  label: string;
  pdgId: number;
  charge: number;
  massMev: number;
  kineticEnergyMev: number;
  totalEnergyMev: number;
  momentumMevC: [number, number, number];
  momentumMagnitudeMevC: number;
  wavelengthNm?: number;
}

export interface B6Channel {
  label: string;
  thresholdMev: number;
  open: boolean;
  executed: boolean;
}

export interface B6Output {
  channel: string;
  electronMassMev: number;
  kineticEnergyPerParticleMev: number;
  totalEnergyMev: number;
  invariantMassMev: number;
  photonEnergyMev: number;
  photonWavelengthNm: number;
  incomingBetaFractionC: number;
  lorentzGamma: number;
  incoming: B6ParticleState[];
  outgoing: B6ParticleState[];
  channels: B6Channel[];
  conservation: {
    energyInMev: number;
    energyOutMev: number;
    momentumInMevC: [number, number, number];
    momentumOutMevC: [number, number, number];
    chargeIn: number;
    chargeOut: number;
    leptonNumberIn: number;
    leptonNumberOut: number;
    balanced: boolean;
    residualEnergyMev: number;
    residualMomentumMevC: number;
  };
  unsupportedPredictions: string[];
}
