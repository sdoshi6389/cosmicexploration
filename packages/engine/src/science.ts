import type { Evidence } from './types.js';

/**
 * The sourced inputs the engine needs, assembled by the client from SpacetimeDB
 * science tables (or the offline cache of the same rows). Every value carries the
 * dataset it came from so the baseline can attach provenance to each property.
 */
export interface Sourced<T> {
  value: T;
  evidence: Evidence;
}

export interface ScienceCity {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  population: number;
}

export interface ScienceBody {
  id: string;
  name: string;
  kind: string;
  /** Horizons parent body id (moons → planet, planets → sun). */
  parentId?: string;
  positionM: [number, number, number];
  velocityMps: [number, number, number];
  radiusKm: number | null;
  massKg: number | null;
  epoch: string;
}

export interface ScienceStar {
  id: string;
  name: string | null;
  /** Heliocentric ICRS cartesian, metres. */
  positionM: [number, number, number];
  /** Galactic longitude/latitude, degrees, and distance, parsecs. */
  lDeg: number;
  bDeg: number;
  distancePc: number;
  luminosityLsun: number | null;
  /** How luminosity was obtained: Gaia FLAME, derived from photometry, or absent. */
  luminositySource: 'flame' | 'photometric' | 'none';
  sample: string;
}

export interface ScienceVariant {
  rsId: string;
  label: string;
  clinvarId: string;
  hgvsC: string;
  hgvsP: string;
  cdsPosition: number | null;
  codonRef: string;
  codonAlt: string;
  refAllele: string;
  altAllele: string;
  clinicalSignificance: string;
  reviewStatus: string;
  conditions: string;
  consequence: string;
}

export interface ScienceResidue {
  entryId: string;
  chain: string;
  resSeq: number;
  resName: string;
}

export interface ScienceLevel {
  configuration: string;
  term: string;
  j: string;
  n: number | null;
  l: number | null;
  energyEv: number;
}

export interface ScienceLine {
  lowerConf: string;
  upperConf: string;
  lowerJ: string;
  upperJ: string;
  wavelengthNm: number;
  akiPerS: number | null;
  eiEv: number;
  ekEv: number;
}

export interface ScienceParticle {
  mcId: number;
  name: string;
  massMeV: number | null;
  massErrMeV: number | null;
  charge: number;
}

export interface ScienceBundle {
  /** Stable identifier of the immutable baseline (dataset release fingerprint). */
  baselineId: string;
  earth: {
    /** Continental primary-energy rate (OWID), W, keyed by REGIONS id. */
    regionalPowerW: Record<string, number>;
    radiusKm: Sourced<number>;
    meanSurfaceTempK: Sourced<number>;
    primaryPowerW: Sourced<number>;
    primaryPowerYear: number;
    cities: ScienceCity[];
    citySource: Evidence;
  };
  sun: { luminosityW: Sourced<number>; radiusKm: Sourced<number> };
  bodies: ScienceBody[];
  bodySource: Evidence;
  stars: ScienceStar[];
  starSource: Evidence;
  /** Star ids (in `stars`) that host a confirmed exoplanet (Gaia DR3 cross-match). */
  exoplanetHostIds: string[];
  /** Electrochromic film materials: PubChem molar mass + declared optical constants. */
  materials: Record<string, { id: 'WO3' | 'NiO'; name: string; molarMassG: number; densityGcm3: number; sigmaCm2: number; peakEv: number; tintHex: string; coloration: 1 | -1; pubchemCid: number | null }>;
  hbb: {
    cds: Sourced<string>;
    protein: Sourced<string>;
    transcript: string;
    ensemblTranscript: string;
    variants: ScienceVariant[];
    variantSource: Evidence;
    /** β-chain residues from the reference (4HHB) and HbS (2HBS) structures. */
    residues: ScienceResidue[];
    betaChains: Record<string, string[]>;
    structureSource: Evidence;
  };
  hydrogen: {
    levels: ScienceLevel[];
    lines: ScienceLine[];
    ionizationEv: Sourced<number>;
    source: Evidence;
  };
  particles: ScienceParticle[];
  particleSource: Evidence;
  na22: {
    halfLifeS: Sourced<number>;
    qEcKeV: Sourced<number>;
    betaPlusMeanKeV: number;
    betaPlusIntensityPct: number;
    gammaKeV: number;
    gammaIntensityPct: number;
    source: Evidence;
  } | null;
}

export const LSUN_W = 3.828e26;
export const PARSEC_M = 3.0856775814913673e16;
export const LIGHT_YEAR_M = 9.4607304725808e15;
export const AU_M = 1.495978707e11;
/** 1 TWh per year expressed as a continuous average power in watts. */
export const TWH_PER_YEAR_TO_W = 1e12 / (365.25 * 24);
