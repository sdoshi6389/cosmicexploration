import type { BaselineContext } from './baseline/fromScience.js';
import { entitySuggestions, resolveEntity } from './entities.js';
import { STRUCTURE_TYPES } from './models/structures.js';
import { REGIONS } from './regions.js';
import type { BarrowLevel, KardashevLevel, LevelId, ParamSpec } from './types.js';

export interface InterventionKind {
  kind: string;
  level: LevelId;
  label: string;
  description: string;
  /** Only one active instance per branch (update it instead of creating another). */
  singleton: boolean;
  minKardashev?: KardashevLevel;
  minBarrow?: BarrowLevel;
  params: (ctx: BaselineContext) => ParamSpec[];
  /** Level chosen from the parameters (e.g. a structure's host decides K2 vs K3). */
  levelOf?: (params: Record<string, unknown>, ctx: BaselineContext) => LevelId;
}

const TECH = [
  { value: 'solar', label: 'Solar PV' }, { value: 'wind', label: 'Wind' }, { value: 'fusion', label: 'Fusion' },
  { value: 'fission', label: 'Fission' }, { value: 'geothermal', label: 'Geothermal' }, { value: 'orbital_solar', label: 'Orbital solar' },
];
const p = (s: ParamSpec) => s;
const frac = (key: string, label: string, def: number, description: string): ParamSpec => p({ key, label, unit: '', kind: 'number', min: 0, max: 1, step: 0.01, defaultValue: def, description });

export const INTERVENTION_KINDS: InterventionKind[] = [
  {
    kind: 'k1.network', level: 'k1', label: 'Regional energy network', singleton: false, minKardashev: 1,
    description: 'A fleet of plants of one technology spread across regions, connected to the HVDC grid.',
    params: () => [
      p({ key: 'technology', label: 'Technology', unit: '', kind: 'choice', choices: TECH, defaultValue: 'solar', description: 'Generation technology.' }),
      p({ key: 'regions', label: 'Regions', unit: '', kind: 'choice', defaultValue: 'all', description: 'Where to build.', choices: [{ value: 'all', label: 'All regions' }, ...REGIONS.map((r) => ({ value: r.id, label: r.name }))] }),
      p({ key: 'capacityPerRegion_W', label: 'Capacity per region', unit: 'TW', kind: 'number', min: 1e11, max: 2e16, scale: 'log', defaultValue: 5e12, displayFactor: 1e12, description: 'Nameplate capacity built in each region.' }),
      p({ key: 'sitesPerRegion', label: 'Sites per region', unit: '', kind: 'number', min: 1, max: 12, step: 1, defaultValue: 6, description: 'Number of plant sites drawn per region.' }),
      frac('efficiency', 'Delivery efficiency', 0.9, 'Conversion + local distribution efficiency.'),
      frac('construction', 'Construction progress', 1, 'Fraction of the fleet built and operating.'),
    ],
  },
  {
    kind: 'k1.facility', level: 'k1', label: 'Power plant', singleton: false, minKardashev: 1,
    description: 'A single plant at a chosen location.',
    params: () => [
      p({ key: 'technology', label: 'Technology', unit: '', kind: 'choice', choices: TECH, defaultValue: 'solar', description: 'Generation technology.' }),
      p({ key: 'latDeg', label: 'Latitude', unit: '°', kind: 'number', min: -80, max: 80, step: 0.1, defaultValue: 23.4, description: 'Site latitude.' }),
      p({ key: 'lonDeg', label: 'Longitude', unit: '°', kind: 'number', min: -180, max: 180, step: 0.1, defaultValue: 12.0, description: 'Site longitude.' }),
      p({ key: 'capacity_W', label: 'Capacity', unit: 'TW', kind: 'number', min: 1e9, max: 2e16, scale: 'log', defaultValue: 1e12, displayFactor: 1e12, description: 'Nameplate capacity.' }),
      frac('utilization', 'Utilisation', 0.25, 'Capacity factor actually achieved.'),
      frac('efficiency', 'Delivery efficiency', 0.9, 'Conversion + local distribution efficiency.'),
      frac('construction', 'Construction progress', 1, 'Fraction built and operating.'),
    ],
  },
  {
    kind: 'k1.climate', level: 'k1', label: 'Climate intervention', singleton: true, minKardashev: 1,
    description: 'A declared albedo lever (L1 sunshade, aerosols or surface brightening).',
    params: () => [
      p({ key: 'kind', label: 'Lever', unit: '', kind: 'choice', defaultValue: 'orbital_shade', description: 'Which lever.', choices: [{ value: 'orbital_shade', label: 'L1 sunshade' }, { value: 'stratospheric_aerosol', label: 'Stratospheric aerosols' }, { value: 'surface_albedo', label: 'Surface brightening' }] }),
      frac('magnitude', 'Strength', 0.3, 'Fraction of the lever\'s declared maximum Δalbedo.'),
    ],
  },
  {
    kind: 'k2.swarm', level: 'k2', label: 'Dyson swarm', singleton: false, minKardashev: 2,
    description: 'Orbiting collector bands around the Sun.',
    params: () => [
      p({ key: 'captureFraction', label: 'Capture fraction of L☉', unit: '', kind: 'number', min: 0.001, max: 1, step: 0.001, defaultValue: 0.3, description: 'Share of the Sun\'s output intercepted when complete.' }),
      frac('efficiency', 'Conversion efficiency', 0.4, 'Intercepted → useful power.'),
      p({ key: 'radius_AU', label: 'Orbital radius', unit: 'AU', kind: 'number', min: 0.1, max: 5, step: 0.01, defaultValue: 0.7, description: 'Mean radius of the collector bands.' }),
      frac('construction', 'Construction progress', 1, 'Fraction of collectors built.'),
      p({ key: 'collectorCount', label: 'Modelled collectors', unit: '', kind: 'number', min: 1e6, max: 1e16, scale: 'log', defaultValue: 1e10, description: 'Modelled collector count (render sample is separate).' }),
      p({ key: 'layout', label: 'Band layout', unit: '', kind: 'choice', defaultValue: 'inclined', description: 'Orbital-band arrangement.', choices: [{ value: 'inclined', label: 'Inclined bands' }, { value: 'equatorial', label: 'Equatorial ring' }, { value: 'polar', label: 'Polar bands' }] }),
    ],
  },
  {
    kind: 'k2.habitat', level: 'k2', label: 'Habitat / station', singleton: false, minKardashev: 2,
    description: 'An orbital habitat, station or receiver drawing swarm power.',
    params: (ctx) => [
      p({ key: 'bodyId', label: 'Location', unit: '', kind: 'choice', defaultValue: 'body.mars', description: 'Body it orbits.', choices: ctx.science.bodies.filter((b) => b.kind !== 'spacecraft' && b.id !== 'body.sun').map((b) => ({ value: b.id, label: b.name })) }),
      p({ key: 'kind', label: 'Type', unit: '', kind: 'choice', defaultValue: 'habitat', description: 'Facility type.', choices: [{ value: 'habitat', label: 'Habitat' }, { value: 'station', label: 'Industrial station' }, { value: 'receiver', label: 'Power receiver' }] }),
      p({ key: 'demand_W', label: 'Power demand', unit: 'W', kind: 'number', min: 1e9, max: 1e26, scale: 'log', defaultValue: 1e17, description: 'Power requested from the swarm.' }),
      p({ key: 'priority', label: 'Priority', unit: '', kind: 'number', min: 1, max: 5, step: 1, defaultValue: 1, description: '1 = served first.' }),
    ],
  },
  {
    kind: 'k3.expansion', level: 'k3', label: 'Galactic expansion', singleton: true, minKardashev: 3,
    description: 'Settlement wave spreading star to star from an origin system.',
    params: (ctx) => [
      p({
        key: 'originStarId', label: 'Origin system', unit: '', kind: 'entity', defaultValue: 'star.sol', description: 'Any catalogued star (name or id); the Sun by default.',
        choices: [{ value: 'star.sol', label: 'Sun' }, ...entitySuggestions(ctx).filter((c) => c.value.startsWith('star.') || c.value.startsWith('gaia.'))],
        validate: (v) => {
          if (v === 'star.sol') return null;
          const e = typeof v === 'string' ? resolveEntity(ctx.science, v) : undefined;
          return e && e.kind === 'star' ? null : `Origin "${String(v)}" must be a catalogued star`;
        },
      }),
      p({ key: 'speed_c', label: 'Ship speed', unit: 'c', kind: 'number', min: 0.001, max: 0.99, step: 0.001, defaultValue: 0.1, description: 'Cruise speed as a fraction of c.' }),
      p({ key: 'settlementDelay_yr', label: 'Settlement delay', unit: 'yr', kind: 'number', min: 0, max: 20000, step: 5, defaultValue: 50, description: 'Years before a colony launches onward.' }),
      p({ key: 'startTime_yr', label: 'Start time', unit: 'yr', kind: 'number', min: 0, max: 100000, step: 10, defaultValue: 0, description: 'Scenario year when the first ships leave.' }),
      p({ key: 'targets', label: 'Targets', unit: '', kind: 'choice', defaultValue: 'all', description: 'Which catalogue stars to settle.', choices: [{ value: 'all', label: 'All sample stars' }, { value: 'exoplanet_hosts', label: 'Known planet hosts' }, { value: 'sunlike', label: 'Sun-like (0.5–2 L☉)' }] }),
      p({ key: 'buildSwarms', label: 'Build swarms at settled stars', unit: '', kind: 'boolean', defaultValue: true, description: 'Settled systems capture stellar power.' }),
      p({ key: 'captureFraction', label: 'Capture per system', unit: '', kind: 'number', min: 0.001, max: 1, step: 0.001, defaultValue: 0.5, description: 'Fraction of each settled star\'s light captured.' }),
      frac('efficiency', 'Conversion efficiency', 0.4, 'Intercepted → useful power.'),
      p({ key: 'speculativeFTL', label: 'Speculative FTL', unit: '', kind: 'boolean', defaultValue: false, description: 'Allow speeds above c (labelled speculative).' }),
    ],
  },
  {
    kind: 'b2.edit', level: 'b2', label: 'HBB sequence edit', singleton: false, minBarrow: 2,
    description: 'Introduce or repair a curated HBB variant (edits apply in order).',
    params: (ctx) => [
      p({ key: 'variantRsId', label: 'Variant', unit: '', kind: 'choice', defaultValue: 'rs334', description: 'ClinVar/Ensembl variant.', choices: ctx.science.hbb.variants.map((v) => ({ value: v.rsId, label: `${v.label} · ${v.hgvsC}` })) }),
      p({ key: 'operation', label: 'Operation', unit: '', kind: 'choice', defaultValue: 'introduce', description: 'Introduce the variant or restore the reference base.', choices: [{ value: 'introduce', label: 'Introduce variant' }, { value: 'repair', label: 'Apply reference' }] }),
    ],
  },
  {
    kind: 'b2.base_edit', level: 'b2', label: 'Base edit', singleton: false, minBarrow: 2,
    description: 'Change any single base of the HBB coding sequence (reference base validated; effects classified from the translated protein).',
    params: (ctx) => [
      p({ key: 'position', label: 'CDS position', unit: 'nt', kind: 'number', min: 1, max: ctx.science.hbb.cds.value.length, step: 1, defaultValue: 20, description: 'c. coordinate (1 = A of the ATG start codon).' }),
      p({ key: 'alt', label: 'New base', unit: '', kind: 'choice', defaultValue: 'T', description: 'Replacement nucleotide.', choices: ['A', 'C', 'G', 'T'].map((b) => ({ value: b, label: b })) }),
    ],
  },
  {
    kind: 'b2.population', level: 'b2', label: 'Population', singleton: true, minBarrow: 2,
    description: 'The community the edited genome is applied to: how many people, and what fraction carries the edit.',
    params: () => [
      p({ key: 'size', label: 'Population', unit: 'people', kind: 'number', min: 10, max: 1e10, scale: 'log', defaultValue: 10000, description: 'People in the modelled community.' }),
      frac('editedFraction', 'Fraction carrying the edit', 1, 'Share of the population whose HBB matches the edited sequence.'),
    ],
  },
  {
    kind: 'b4.window', level: 'b4', label: 'Electrochromic window', singleton: true, minBarrow: 4,
    description: 'A window coated with an ion-insertion oxide film whose electronic state sets its transparency.',
    params: () => [
      p({ key: 'material', label: 'Film material', unit: '', kind: 'choice', defaultValue: 'WO3', description: 'Electrochromic oxide.', choices: [{ value: 'WO3', label: 'Tungsten trioxide (WO₃)' }, { value: 'NiO', label: 'Nickel oxide (NiO)' }] }),
      p({ key: 'insertion_x', label: 'Ion insertion x', unit: 'e⁻/site', kind: 'number', min: 0, max: 0.5, step: 0.005, defaultValue: 0.25, description: 'Electrons inserted per metal site. WO₃ (cathodic) DARKENS as x rises; NiO (anodic) CLEARS as x rises. 0–0.5.' }),
      p({ key: 'thickness_nm', label: 'Film thickness', unit: 'nm', kind: 'number', min: 50, max: 2000, step: 10, defaultValue: 500, description: 'Coating thickness.' }),
      p({ key: 'windowArea_m2', label: 'Window area', unit: 'm²', kind: 'number', min: 0.2, max: 30, step: 0.1, defaultValue: 3, description: 'Glazed area.' }),
      p({ key: 'floorArea_m2', label: 'Room floor area', unit: 'm²', kind: 'number', min: 4, max: 200, step: 1, defaultValue: 20, description: 'Floor area lit by the window.' }),
      p({
        key: 'occupiedSites', label: 'Occupied ion sites', unit: '', kind: 'text', defaultValue: '', description: 'Indices of inserted ions in the representative 5×5×5 interstitial block (set by placing atoms; x follows).',
        validate: (v) => (typeof v === 'string' && v.split(',').filter(Boolean).every((t) => /^\d+$/.test(t) && Number(t) < 125) ? null : 'occupiedSites must be comma-separated indices 0–124'),
      }),
    ],
  },
  {
    kind: 'b4.city', level: 'b4', label: 'City', singleton: true, minBarrow: 4,
    description: 'Scale the window design up to a city: every room in every building gets the same film.',
    params: () => [
      p({ key: 'buildings', label: 'Buildings', unit: '', kind: 'number', min: 1, max: 1e6, scale: 'log', defaultValue: 2000, description: 'Buildings using the film.' }),
      p({ key: 'roomsPerBuilding', label: 'Rooms per building', unit: '', kind: 'number', min: 1, max: 1000, scale: 'log', defaultValue: 40, description: 'Windowed rooms per building.' }),
    ],
  },
  {
    kind: 'b4.transition', level: 'b4', label: 'Hydrogen electron transition', singleton: true, minBarrow: 4,
    description: 'Move a hydrogen electron between NIST-evaluated states.',
    params: () => [
      p({ key: 'nInitial', label: 'Initial n', unit: '', kind: 'number', min: 1, max: 7, step: 1, defaultValue: 1, description: 'Principal quantum number before.' }),
      p({ key: 'lInitial', label: 'Initial l', unit: '', kind: 'number', min: 0, max: 6, step: 1, defaultValue: 0, description: 'Orbital angular momentum before.' }),
      p({ key: 'nFinal', label: 'Final n', unit: '', kind: 'number', min: 1, max: 7, step: 1, defaultValue: 3, description: 'Principal quantum number after.' }),
      p({ key: 'lFinal', label: 'Final l', unit: '', kind: 'number', min: 0, max: 6, step: 1, defaultValue: 1, description: 'Orbital angular momentum after.' }),
      p({ key: 'mFinal', label: 'Final m', unit: '', kind: 'number', min: -6, max: 6, step: 1, defaultValue: 0, description: 'Magnetic quantum number.' }),
    ],
  },
  {
    kind: 'b5.decay', level: 'b5', label: 'Na-22 β⁺ decay', singleton: true, minBarrow: 5,
    description: 'Trigger a sodium-22 positron emission.',
    params: () => [frac('positronFraction', 'Positron share of endpoint', 0.395, 'Where on the β⁺ spectrum this decay lands.')],
  },
  {
    kind: 'b6.device', level: 'b6', label: 'Annihilation power cell', singleton: true, minBarrow: 6,
    description: 'Hypothetical device converting e⁺e⁻ annihilation photons into electricity for connected lights.',
    params: () => [
      p({ key: 'species', label: 'Particle–antiparticle pair', unit: '', kind: 'choice', defaultValue: 'electron', description: 'What annihilates (PDG masses).', choices: [{ value: 'electron', label: 'Electron + positron (e⁺e⁻ → γγ)' }, { value: 'proton', label: 'Proton + antiproton (p p̄ → pions)' }] }),
      p({ key: 'eventRate_per_s', label: 'Interaction rate', unit: 'events/s', kind: 'number', min: 1e6, max: 1e22, scale: 'log', defaultValue: 1e14, description: 'Annihilations per second, per reactor.' }),
      p({ key: 'units', label: 'Reactors', unit: '', kind: 'number', min: 1, max: 1e5, scale: 'log', defaultValue: 1, description: 'Identical reactors feeding the grid.' }),
      p({ key: 'kineticEnergy_MeV', label: 'Kinetic energy per lepton', unit: 'MeV', kind: 'number', min: 0, max: 1000, scale: 'log', defaultValue: 0.5, description: 'Collision energy (equal, head-on).' }),
      frac('captureFraction', 'Photon capture fraction', 0.8, 'Share of gamma energy absorbed by the converter.'),
      frac('conversionEfficiency', 'Conversion efficiency', 0.35, 'Absorbed energy → electricity.'),
      p({ key: 'lightCount', label: 'Connected lights', unit: '', kind: 'number', min: 0, max: 64, step: 1, defaultValue: 8, description: 'Lamps wired to the output.' }),
      p({ key: 'lightPower_W', label: 'Power per light', unit: 'W', kind: 'number', min: 1, max: 5000, step: 1, defaultValue: 60, description: 'Rated draw of each lamp.' }),
    ],
  },
  {
    kind: 'b6.city', level: 'b6', label: 'City grid', singleton: true, minBarrow: 6,
    description: 'The city the reactors power: households and their average demand.',
    params: () => [
      p({ key: 'households', label: 'Households', unit: '', kind: 'number', min: 1, max: 1e9, scale: 'log', defaultValue: 100000, description: 'Connected households.' }),
      p({ key: 'demandPerHousehold_W', label: 'Average demand per household', unit: 'W', kind: 'number', min: 100, max: 20000, scale: 'log', defaultValue: 1200, description: 'Mean continuous electrical demand.' }),
    ],
  },
  {
    kind: 'b6.collision', level: 'b6', label: 'Single collision', singleton: true, minBarrow: 6,
    description: 'Inspect one equal-energy e⁺e⁻ event in the detector.',
    params: () => [
      p({ key: 'kineticEnergy_MeV', label: 'Kinetic energy per lepton', unit: 'MeV', kind: 'number', min: 0, max: 100000, scale: 'log', defaultValue: 0.5, description: 'Each beam particle\'s kinetic energy.' }),
      p({ key: 'photonAngle_deg', label: 'Photon emission angle', unit: '°', kind: 'number', min: 0, max: 180, step: 1, defaultValue: 90, description: 'Display direction of the back-to-back photons.' }),
    ],
  },
  {
    kind: 'build.structure', level: 'k2', label: 'Structure', singleton: false, minKardashev: 1,
    description: 'Free building: harness or inhabit any body or star — Dyson swarms/spheres around any star, collectors on any moon or planet, orbital rings, gas-giant fuel harvesters, habitats.',
    levelOf: (params, ctx) => {
      const host = resolveEntity(ctx.science, String(params.hostId ?? ''));
      return host && host.system !== 'sol' ? 'k3' : 'k2';
    },
    params: (ctx) => [
      p({
        key: 'hostId', label: 'Host body or star', unit: '', kind: 'entity', defaultValue: 'body.moon', choices: entitySuggestions(ctx),
        description: 'Any planet, moon, dwarf planet, the Sun, or any catalogued star (name or id).',
        validate: (v) => {
          const e = typeof v === 'string' ? resolveEntity(ctx.science, v) : undefined;
          if (!e) return `Host "${String(v)}" not found among Solar-System bodies or catalogued stars`;
          return e.kind === 'spacecraft' ? 'Spacecraft cannot host structures' : null;
        },
      }),
      p({ key: 'type', label: 'Structure', unit: '', kind: 'choice', defaultValue: 'surface_collectors', choices: STRUCTURE_TYPES.map((t) => ({ value: t.value, label: t.label })), description: 'What to build.' }),
      p({ key: 'coverage', label: 'Coverage', unit: '', kind: 'number', min: 1e-6, max: 1, scale: 'log', defaultValue: 0.1, description: 'Fraction of the star’s output (Dyson) or of the body’s sunlit disc (collectors) intercepted.' }),
      frac('efficiency', 'Conversion efficiency', 0.25, 'Captured energy → useful power.'),
      frac('construction', 'Construction progress', 1, 'Fraction of the structure built.'),
      p({ key: 'orbitRadius_AU', label: 'Orbit radius (stellar hosts)', unit: 'AU', kind: 'number', min: 0.02, max: 20, scale: 'log', defaultValue: 1, description: 'Swarm/shell radius around a star; sets radiator temperature.' }),
      p({ key: 'harvestRate_kgps', label: 'Fuel harvest rate', unit: 'kg/s', kind: 'number', min: 1, max: 1e9, scale: 'log', defaultValue: 1e5, description: 'Gas harvesters only.' }),
      p({ key: 'demand_W', label: 'Power demand (0 = from population)', unit: 'W', kind: 'number', min: 0, max: 1e28, scale: 'log', defaultValue: 0, description: 'Habitats only; 0 derives demand from population at a declared 10 kW per person.' }),
      p({ key: 'population', label: 'Population', unit: 'people', kind: 'number', min: 0, max: 1e13, scale: 'log', defaultValue: 1e6, description: 'Habitats only (display).' }),
    ],
  },
];

export function interventionKind(kind: string): InterventionKind | undefined {
  return INTERVENTION_KINDS.find((k) => k.kind === kind);
}

export function kindsForLevel(level: LevelId): InterventionKind[] {
  return INTERVENTION_KINDS.filter((k) => k.level === level || (k.levelOf && (level === 'k2' || level === 'k3')));
}

/** The level an intervention of this kind lands in, given its parameters. */
export function levelOfKind(kind: InterventionKind, params: Record<string, unknown>, ctx: BaselineContext): LevelId {
  return kind.levelOf ? kind.levelOf(params, ctx) : kind.level;
}

/** Minimum Kardashev capability for an intervention (K3 for structures at other stars). */
export function minKardashevOf(kind: InterventionKind, level: LevelId): number | undefined {
  if (kind.levelOf) return level === 'k3' ? 3 : 1;
  return kind.minKardashev;
}
