import type { LevelId } from '@cosmos/engine';

export type CivId = 'b2' | 'b4' | 'b6';
export type StopId =
  | 'cosmic' | 'galaxy' | 'solar' | 'earth'
  | 'town' | 'body' | 'cell' | 'protein' | 'gene'
  | 'city' | 'room' | 'lattice' | 'atom'
  | 'grid' | 'device' | 'particle';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  minDistance: number;
  maxDistance: number;
}

export interface Stop {
  id: StopId;
  name: string;
  subtitle: string;
  /** log10 of the characteristic view span in metres. */
  exp: number;
  level: LevelId | null;
  badge: string | null;
  family: 'K' | 'B' | null;
  breadcrumb: string[];
  camera: CameraPose;
  blurb: string;
  /** Barrow civilisation this stop belongs to, and its depth (0 = human scale). */
  civ?: CivId;
  depth?: number;
  /** Short name in the depth breadcrumb. */
  depthLabel?: string;
}

export const STOPS: Stop[] = [
  {
    id: 'cosmic', name: 'Cosmic Web', subtitle: 'SDSS DR18 · 30,000 galaxies', exp: 25, level: null, badge: null, family: null,
    breadcrumb: ['Observable Universe', 'Local cosmic web'],
    camera: { position: [60, 45, 130], target: [0, 0, 0], minDistance: 8, maxDistance: 420 },
    blurb: 'Spectroscopic galaxies placed by redshift. The Milky Way is one point at the centre.',
  },
  {
    id: 'galaxy', name: 'Milky Way', subtitle: 'Gaia DR3 · Kardashev III', exp: 21, level: 'k3', badge: 'K3', family: 'K',
    breadcrumb: ['Local Group', 'Milky Way', 'Solar neighbourhood'],
    camera: { position: [118, 70, 120], target: [40, 0, 0], minDistance: 0.002, maxDistance: 520 },
    blurb: 'A galactic civilisation spreading star to star through a real Gaia sample.',
  },
  {
    id: 'solar', name: 'Solar System', subtitle: 'JPL Horizons · Kardashev II', exp: 13, level: 'k2', badge: 'K2', family: 'K',
    breadcrumb: ['Milky Way', 'Orion Arm', 'Solar System'],
    camera: { position: [0, 30, 58], target: [0, 0, 0], minDistance: 0.05, maxDistance: 260 },
    blurb: 'A stellar civilisation harnessing its star and every world around it.',
  },
  {
    id: 'earth', name: 'Earth', subtitle: 'NASA Earthdata · Kardashev I', exp: 7, level: 'k1', badge: 'K1', family: 'K',
    breadcrumb: ['Solar System', 'Sol III', 'Earth'],
    camera: { position: [3.4, 1.6, 6.2], target: [0, 0, 0], minDistance: 2.6, maxDistance: 30 },
    blurb: 'A planetary civilisation commanding all the energy its world can supply.',
  },

  /* ---------------------------------------------------- B2 · genome civilisation */
  {
    id: 'town', name: 'Genome Civilisation', subtitle: 'Barrow B2 · people ← genes', exp: 3, level: 'b2', badge: 'B2', family: 'B',
    civ: 'b2', depth: 0, depthLabel: 'Population',
    breadcrumb: ['Earth', 'B2 civilisation', 'Population'],
    camera: { position: [0, 22, 34], target: [0, 0, 0], minDistance: 6, maxDistance: 70 },
    blurb: 'A community whose biology is engineered at the level of single DNA bases. Zoom into a person, their blood, haemoglobin and the HBB gene — edit any base — then zoom back out to see the population change.',
  },
  {
    id: 'body', name: 'A Person', subtitle: 'B2 · body', exp: 0.2, level: 'b2', badge: 'B2', family: 'B',
    civ: 'b2', depth: 1, depthLabel: 'Person',
    breadcrumb: ['B2 civilisation', 'Population', 'A person'],
    camera: { position: [0, 1.2, 7.5], target: [0, 1, 0], minDistance: 3, maxDistance: 20 },
    blurb: 'Heart, vessels and oxygen reaching tissue — driven by the edited genome.',
  },
  {
    id: 'cell', name: 'Blood', subtitle: 'B2 · red cells', exp: -5, level: 'b2', badge: 'B2', family: 'B',
    civ: 'b2', depth: 2, depthLabel: 'Blood cells',
    breadcrumb: ['A person', 'Capillary', 'Red blood cells'],
    camera: { position: [27, 3.5, 12], target: [20, 0, 0], minDistance: 3, maxDistance: 60 },
    blurb: 'Red cells in a capillary; their shape follows the haemoglobin the gene encodes.',
  },
  {
    id: 'protein', name: 'Haemoglobin', subtitle: 'B2 · PDB 4HHB / 2HBS', exp: -8, level: 'b2', badge: 'B2', family: 'B',
    civ: 'b2', depth: 3, depthLabel: 'Haemoglobin',
    breadcrumb: ['Red cell', 'Haemoglobin', 'β-globin'],
    camera: { position: [4, 4, 24], target: [0, 0, 0], minDistance: 3, maxDistance: 60 },
    blurb: 'The protein the edited codons translate into (crystal structures from the PDB).',
  },
  {
    id: 'gene', name: 'HBB Gene', subtitle: 'B2 · NCBI / Ensembl / ClinVar', exp: -9.5, level: 'b2', badge: 'B2', family: 'B',
    civ: 'b2', depth: 4, depthLabel: 'Gene',
    breadcrumb: ['Haemoglobin', 'HBB gene', 'Coding sequence'],
    camera: { position: [-16, 2.5, 13], target: [-18, 0, 0], minDistance: 2, maxDistance: 40 },
    blurb: 'Click any base and change it. The protein, cells, body and population above update from your edit.',
  },

  /* ---------------------------------------------------- B4 · materials civilisation */
  {
    id: 'city', name: 'Materials Civilisation', subtitle: 'Barrow B4 · city ← atoms', exp: 3.5, level: 'b4', badge: 'B4', family: 'B',
    civ: 'b4', depth: 0, depthLabel: 'City',
    breadcrumb: ['Earth', 'B4 civilisation', 'City'],
    camera: { position: [26, 24, 34], target: [0, 4, 0], minDistance: 8, maxDistance: 120 },
    blurb: 'A city whose windows are engineered atom by atom. Zoom into a room, the window film, its lattice — place or remove ions — then zoom out to see the city’s light and energy change.',
  },
  {
    id: 'room', name: 'A Room', subtitle: 'B4 · daylight + energy', exp: 0.7, level: 'b4', badge: 'B4', family: 'B',
    civ: 'b4', depth: 1, depthLabel: 'Room',
    breadcrumb: ['City', 'A building', 'A room'],
    camera: { position: [5.5, 2.2, 6.5], target: [0, 1.3, 0], minDistance: 3, maxDistance: 22 },
    blurb: 'Daylight through the film, the lamps that make up any shortfall and the cooling that removes solar heat.',
  },
  {
    id: 'lattice', name: 'Film Lattice', subtitle: 'B4 · WO₃ / NiO', exp: -9.3, level: 'b4', badge: 'B4', family: 'B',
    civ: 'b4', depth: 2, depthLabel: 'Lattice',
    breadcrumb: ['Room', 'Window film', 'Crystal lattice'],
    camera: { position: [6, 5, 9], target: [0, 0, 0], minDistance: 3, maxDistance: 40 },
    blurb: 'Click interstitial sites to insert or remove ions. Each ion reduces a metal site that absorbs light.',
  },
  {
    id: 'atom', name: 'Atomic States', subtitle: 'B4 · NIST ASD', exp: -10, level: 'b4', badge: 'B4', family: 'B',
    civ: 'b4', depth: 3, depthLabel: 'Atom',
    breadcrumb: ['Lattice', 'Atom', 'Electron states'],
    camera: { position: [0, 4, 18], target: [0, 0, 0], minDistance: 2, maxDistance: 220 },
    blurb: 'Electron transitions between quantum states (hydrogen, NIST levels) — the physics behind absorption.',
  },

  /* ---------------------------------------------------- B6 · particle civilisation */
  {
    id: 'grid', name: 'Particle Civilisation', subtitle: 'Barrow B6 · city ← annihilation', exp: 3.5, level: 'b6', badge: 'B6', family: 'B',
    civ: 'b6', depth: 0, depthLabel: 'City grid',
    breadcrumb: ['Earth', 'B6 civilisation', 'City grid'],
    camera: { position: [30, 26, 36], target: [0, 2, 0], minDistance: 8, maxDistance: 130 },
    blurb: 'A city powered by matter–antimatter reactors. Zoom into a reactor and a single annihilation — choose particles and energies — then zoom out to see which districts stay lit.',
  },
  {
    id: 'device', name: 'Reactor', subtitle: 'B6 · capture + conversion', exp: -0.3, level: 'b6', badge: 'B6', family: 'B',
    civ: 'b6', depth: 1, depthLabel: 'Reactor',
    breadcrumb: ['City grid', 'Reactor hall', 'Annihilation cell'],
    camera: { position: [4.5, 2.6, 6], target: [0, 0.8, 0], minDistance: 2.5, maxDistance: 20 },
    blurb: 'Trap → calorimeter → converter: gross power, heat, and the energy it costs to make the antimatter.',
  },
  {
    id: 'particle', name: 'Annihilation', subtitle: 'B6 · PDG 2025', exp: -15, level: 'b6', badge: 'B6', family: 'B',
    civ: 'b6', depth: 2, depthLabel: 'Collision',
    breadcrumb: ['Reactor', 'Trap', 'Single collision'],
    camera: { position: [9, 6, 15], target: [0, 0, 0], minDistance: 4, maxDistance: 70 },
    blurb: 'One particle–antiparticle collision with every unit of energy and momentum balanced.',
  },
];

export const STOP_BY_ID = Object.fromEntries(STOPS.map((s) => [s.id, s])) as Record<StopId, Stop>;

/** Entry stop for each level (human scale for Barrow civilisations). */
export const STOP_FOR_LEVEL: Record<LevelId, StopId> = {
  k1: 'earth', k2: 'solar', k3: 'galaxy', b2: 'town', b4: 'city', b5: 'grid', b6: 'grid',
};

/** Stops shown on the scale rail: Kardashev scales + each Barrow civilisation's entry. */
export const RAIL_STOPS: Stop[] = STOPS.filter((s) => !s.civ || s.depth === 0);

/** The depth chain of a Barrow civilisation, human scale first. */
export function depthChain(civ: CivId): Stop[] {
  return STOPS.filter((s) => s.civ === civ).sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
}

export function deeper(id: StopId): StopId | null {
  const s = STOP_BY_ID[id];
  if (!s.civ) return null;
  return depthChain(s.civ).find((x) => x.depth === (s.depth ?? 0) + 1)?.id ?? null;
}

export function shallower(id: StopId): StopId | null {
  const s = STOP_BY_ID[id];
  if (!s.civ || !s.depth) return null;
  return depthChain(s.civ).find((x) => x.depth === (s.depth ?? 0) - 1)?.id ?? null;
}

/** Journey order for ← / → keys. */
export const JOURNEY: StopId[] = RAIL_STOPS.map((s) => s.id);
