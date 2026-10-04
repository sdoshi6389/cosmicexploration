import type { BaselineSnapshot, CosmosEntity, Evidence, Property, Relationship } from '../types.js';
import type { ScienceBundle, ScienceLevel, ScienceLine, Sourced } from '../science.js';
import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import { equilibriumTempK, greenhouseOffsetFor } from '../models/energyBalance.js';
import { ELECTRON_MASS_MEV_FALLBACK } from '../models/constants.js';

/** Derived, immutable values every model resolves its defaults from. */
export interface BaselineContext {
  science: ScienceBundle;
  earth: {
    P0_W: Sourced<number>;
    year: number;
    radius_m: number;
    meanTempK: Sourced<number>;
    albedo: Sourced<number>;
    emissivity: Sourced<number>;
    stellarFlux: Sourced<number>;
    greenhouseOffsetK: Sourced<number>;
  };
  sunLuminosityW: Sourced<number>;
  originIndex: number;
  electronMassMeV: Sourced<number>;
  thresholds: { label: string; massMeV: number }[];
  hydrogenLevels: ScienceLevel[];
  hydrogenLines: ScienceLine[];
  hydrogenIonizationEv: Sourced<number>;
  na22: ScienceBundle['na22'];
}

const REF_EARTH: Evidence = {
  kind: 'assumed',
  sourceId: 'nasa_nssdc_earth_factsheet',
  sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html',
  method: 'Reference value (NASA Earth Fact Sheet); editable assumption',
};

export function buildBaselineContext(science: ScienceBundle): BaselineContext {
  const albedo: Sourced<number> = { value: 0.306, evidence: { ...REF_EARTH, method: 'Bond albedo 0.306 (NASA Earth Fact Sheet)' } };
  const flux: Sourced<number> = { value: 1361, evidence: { ...REF_EARTH, method: 'Total solar irradiance 1361 W/m² (NASA Earth Fact Sheet)' } };
  const emissivity: Sourced<number> = {
    value: 1,
    evidence: { kind: 'assumed', method: 'Ideal gray-body emitter; greenhouse effect carried by the derived offset' },
  };
  const radius_m = science.earth.radiusKm.value * 1000;
  const area = 4 * Math.PI * radius_m * radius_m;
  const P0 = science.earth.primaryPowerW;
  const offset = greenhouseOffsetFor(science.earth.meanSurfaceTempK.value, flux.value, albedo.value, emissivity.value)
    - (equilibriumTempK(flux.value, albedo.value, emissivity.value, 0, P0.value / area)
      - equilibriumTempK(flux.value, albedo.value, emissivity.value, 0));
  const electron = science.particles.find((p) => p.mcId === 11);
  const mass = (mc: number) => science.particles.find((p) => p.mcId === mc)?.massMeV ?? null;
  const thresholds = [
    { label: 'e⁺e⁻ → μ⁺μ⁻', massMeV: mass(13) },
    { label: 'e⁺e⁻ → π⁺π⁻', massMeV: mass(211) },
    { label: 'e⁺e⁻ → p p̄', massMeV: mass(2212) },
    { label: 'e⁺e⁻ → τ⁺τ⁻', massMeV: mass(15) },
    { label: 'e⁺e⁻ → W⁺W⁻', massMeV: mass(24) },
  ].filter((t): t is { label: string; massMeV: number } => t.massMeV !== null);
  const origin = science.stars.findIndex((s) => s.id === 'star.sol');
  return {
    science,
    earth: {
      P0_W: P0,
      year: science.earth.primaryPowerYear,
      radius_m,
      meanTempK: science.earth.meanSurfaceTempK,
      albedo,
      emissivity,
      stellarFlux: flux,
      greenhouseOffsetK: {
        value: offset,
        evidence: {
          kind: 'derived',
          method: 'Offset that reproduces the NSSDC observed mean surface temperature with present-day waste heat included',
          sourceId: science.earth.meanSurfaceTempK.evidence.sourceId,
        },
      },
    },
    sunLuminosityW: science.sun.luminosityW,
    originIndex: origin >= 0 ? origin : 0,
    electronMassMeV: electron?.massMeV
      ? { value: electron.massMeV, evidence: { ...science.particleSource, sourceRecordId: 'mcid 11' } }
      : { value: ELECTRON_MASS_MEV_FALLBACK, evidence: { kind: 'assumed', method: 'PDG 2025 value (offline fallback)' } },
    thresholds,
    hydrogenLevels: science.hydrogen.levels,
    hydrogenLines: science.hydrogen.lines,
    hydrogenIonizationEv: science.hydrogen.ionizationEv,
    na22: science.na22,
  };
}

function prop<T>(value: T, unit: string | undefined, evidence: Evidence): Property<T> {
  return { value, unit, evidence: [evidence] };
}

function entity(
  id: string, type: string, name: string, properties: Record<string, Property<unknown>>,
  actions: string[] = [], sourceIds: Record<string, string> = {}, length?: number,
): CosmosEntity {
  return { id, type, name, sourceIds, characteristicLengthM: length, properties, assetRefs: [], availableActions: actions };
}

/** Immutable baseline graph: entities carry sourced properties and their evidence. */
export function buildBaseline(ctx: BaselineContext): BaselineSnapshot {
  const s = ctx.science;
  const entities: CosmosEntity[] = [];
  for (const b of s.bodies) {
    const props: Record<string, Property<unknown>> = {
      stateVector: prop(
        { positionM: b.positionM, velocityMps: b.velocityMps, originId: 'body.sun', frame: 'ICRF', epoch: b.epoch, timeScale: 'TDB', aberrationCorrection: 'NONE' },
        undefined,
        { ...s.bodySource, sourceRecordId: b.id },
      ),
    };
    if (b.radiusKm) props.radius_km = prop(b.radiusKm, 'km', { kind: 'observed', sourceId: 'naif_spice', method: 'pck00011 RADII' });
    if (b.massKg) props.mass_kg = prop(b.massKg, 'kg', { kind: 'derived', sourceId: 'naif_spice', method: 'GM (gm_de440) / G' });
    const actions = b.id === 'body.earth' ? ['configure_k1_infrastructure'] : b.id === 'body.sun' ? ['configure_dyson_swarm'] : [];
    entities.push(entity(b.id, b.kind, b.name, props, actions, { horizons: b.id }, (b.radiusKm ?? 0) * 1000));
  }
  const earth = entities.find((e) => e.id === 'body.earth');
  if (earth) {
    earth.properties.primaryPower_W = prop(ctx.earth.P0_W.value, 'W', ctx.earth.P0_W.evidence);
    earth.properties.achievedK = prop(kardashevFromPowerW(ctx.earth.P0_W.value), 'K_Sagan', { kind: 'derived', method: 'K = (log10 P − 6)/10' });
    earth.properties.meanSurfaceTemp_K = prop(ctx.earth.meanTempK.value, 'K', ctx.earth.meanTempK.evidence);
    earth.properties.bondAlbedo = prop(ctx.earth.albedo.value, '1', ctx.earth.albedo.evidence);
  }
  const sun = entities.find((e) => e.id === 'body.sun');
  if (sun) sun.properties.luminosity_W = prop(ctx.sunLuminosityW.value, 'W', ctx.sunLuminosityW.evidence);

  entities.push(entity('galaxy.milky_way', 'galaxy', 'Milky Way', {
    morphology: prop('Illustrative barred-spiral rendering; not a measured map.', undefined, { kind: 'illustrative' }),
  }, [], {}, 9.5e20));
  entities.push(entity('catalog.stellar_sample', 'catalog', 'Gaia DR3 + SIMBAD stellar sample', {
    starCount: prop(s.stars.length, '1', s.starSource),
    selection: prop('bright (G-sorted) + nearby (<100 pc) + field (1–4 kpc, G<13), parallax/error > 10', undefined, s.starSource),
  }, ['expand_galaxy_civilization']));
  for (const st of s.stars) {
    if (!st.name) continue;
    entities.push(entity(st.id, 'star', st.name, {
      distance_pc: prop(st.distancePc, 'pc', s.starSource),
      luminosity_Lsun: prop(st.luminosityLsun, 'L_sun', {
        kind: st.luminositySource === 'flame' ? 'observed' : st.luminositySource === 'photometric' ? 'derived' : 'assumed',
        method: st.luminositySource === 'flame' ? 'Gaia DR3 FLAME lum_flame'
          : st.luminositySource === 'photometric' ? 'From apparent magnitude + parallax, no bolometric/extinction correction' : 'missing',
      }),
    }, [], {}, undefined));
  }
  entities.push(entity('gene.hbb', 'gene', 'HBB · haemoglobin subunit β', {
    transcript: prop(s.hbb.transcript, undefined, s.hbb.cds.evidence),
    cds: prop(s.hbb.cds.value, 'nt', s.hbb.cds.evidence),
    protein: prop(s.hbb.protein.value, 'aa', s.hbb.protein.evidence),
  }, ['apply_genetic_edit']));
  for (const v of s.hbb.variants) {
    entities.push(entity(`variant.${v.rsId}`, 'variant', `${v.label} · ${v.hgvsC}`, {
      clinvar: prop(v.clinvarId, undefined, s.hbb.variantSource),
      clinicalSignificance: prop(v.clinicalSignificance, undefined, s.hbb.variantSource),
      reviewStatus: prop(v.reviewStatus, undefined, s.hbb.variantSource),
      conditions: prop(v.conditions, undefined, s.hbb.variantSource),
    }, ['apply_genetic_edit']));
  }
  entities.push(entity('structure.4HHB', 'protein_structure', '4HHB · deoxy haemoglobin A', {
    betaChains: prop(s.hbb.betaChains['4HHB'] ?? [], undefined, s.hbb.structureSource),
  }));
  entities.push(entity('structure.2HBS', 'protein_structure', '2HBS · deoxy haemoglobin S', {
    betaChains: prop(s.hbb.betaChains['2HBS'] ?? [], undefined, s.hbb.structureSource),
  }));
  entities.push(entity('atom.hydrogen', 'atom', 'Hydrogen (H I)', {
    ionizationEnergy_eV: prop(ctx.hydrogenIonizationEv.value, 'eV', ctx.hydrogenIonizationEv.evidence),
    levelCount: prop(ctx.hydrogenLevels.length, '1', s.hydrogen.source),
  }, ['set_atomic_state'], {}, 5.29e-11));
  if (s.na22) {
    entities.push(entity('nucleus.na22', 'nucleus', 'Sodium-22 nucleus', {
      halfLife_s: prop(s.na22.halfLifeS.value, 's', s.na22.halfLifeS.evidence),
      qEC_keV: prop(s.na22.qEcKeV.value, 'keV', s.na22.qEcKeV.evidence),
    }, ['trigger_nuclear_decay'], {}, 3.4e-15));
  }
  entities.push(entity('interaction.ee_annihilation', 'interaction', 'e⁺e⁻ annihilation', {
    electronMass_MeV: prop(ctx.electronMassMeV.value, 'MeV', ctx.electronMassMeV.evidence),
  }, ['run_particle_interaction'], {}, 2.8e-15));

  const relationships: Relationship[] = [
    ...s.bodies.filter((b) => b.kind === 'planet' || b.kind === 'dwarf').map((b) => ({
      from: b.id, to: 'body.sun', type: 'orbits' as const, evidence: [s.bodySource],
    })),
    { from: 'gene.hbb', to: 'structure.4HHB', type: 'encodes', evidence: [s.hbb.structureSource] },
    { from: 'structure.2HBS', to: 'gene.hbb', type: 'associatedWith', evidence: [s.hbb.structureSource] },
    { from: 'body.sun', to: 'galaxy.milky_way', type: 'memberOf', evidence: [{ kind: 'observed' }] },
  ];
  return { id: s.baselineId, version: '2.0.0', entities, relationships };
}
