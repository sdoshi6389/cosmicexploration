import { schema, table, t } from 'spacetimedb/server';
import { worldTables } from './worldTables';
import { scienceTables } from './science';

/**
 * COSMOS SpacetimeDB module.
 *
 *  - Science tables (generated in ./science.ts from scripts/ingest/schema.py) hold the
 *    immutable, versioned baseline. Only the admin identity may write them.
 *  - `branch` / `branch_event` persist every counterfactual world as an ordered event
 *    log. The deterministic client engine replays events to project state, so the
 *    database stores commands, revisions and compact result summaries — never
 *    regenerated physics.
 *  - `concept_asset` records Grok Imagine renders tied to the branch revision that
 *    produced them, so stale renders can never masquerade as the current state.
 */

/* ------------------------------------------------------------------ legacy */
// v1 tables kept verbatim so the schema migrates without deleting data. They are
// emptied by `clear_science` and superseded by the generated science tables.
const legacy = {
  source_manifest: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      sourceName: t.string(),
      sourceUrl: t.string(),
      release: t.string(),
      rowCount: t.u32(),
      note: t.string(),
    },
  ),
  star: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      raDeg: t.f64(),
      decDeg: t.f64(),
      distanceM: t.f64(),
      parallaxMas: t.f64(),
      x: t.f64(),
      y: t.f64(),
      z: t.f64(),
      luminosityW: t.f64(),
      teffK: t.f64(),
      colorHex: t.string(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  solar_body: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      horizonsId: t.string(),
      kind: t.string(),
      radiusM: t.f64(),
      massKg: t.f64(),
      xM: t.f64(),
      yM: t.f64(),
      zM: t.f64(),
      vxMps: t.f64(),
      vyMps: t.f64(),
      vzMps: t.f64(),
      luminosityW: t.f64(),
      orbitPeriodDays: t.f64(),
      colorHex: t.string(),
      epoch: t.string(),
      frame: t.string(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  earth_constant: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      radiusM: t.f64(),
      massKg: t.f64(),
      albedo: t.f64(),
      emissivity: t.f64(),
      solarConstantWm2: t.f64(),
      greenhouseOffsetK: t.f64(),
      observedMeanSurfaceTempK: t.f64(),
      baselinePrimaryPowerW: t.f64(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  earth_anchor: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      latDeg: t.f64(),
      lonDeg: t.f64(),
      weight: t.f64(),
    },
  ),
  earth_energy: table(
    { public: true },
    {
      source: t.string().primaryKey(),
      capacityW: t.f64(),
      generationW: t.f64(),
      capacityFactor: t.f64(),
    },
  ),
  exoplanet: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      hostname: t.string(),
      raDeg: t.f64(),
      decDeg: t.f64(),
      distancePc: t.f64(),
      orbitalPeriodDays: t.f64(),
      semiMajorAxisAu: t.f64(),
      radiusEarth: t.f64(),
      massEarth: t.f64(),
      starTeffK: t.f64(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  particle: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      symbol: t.string(),
      pdgId: t.i32(),
      massMev: t.f64(),
      charge: t.f64(),
      spinJ: t.f64(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  atomic_level: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      species: t.string(),
      n: t.u32(),
      l: t.u32(),
      energyEv: t.f64(),
      term: t.string(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  isotope: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      symbol: t.string(),
      z: t.u32(),
      a: t.u32(),
      bindingEnergyPerNucleonMev: t.f64(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
  gene: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      geneSymbol: t.string(),
      transcriptId: t.string(),
      cdsSequence: t.string(),
      variantLabel: t.string(),
      rsId: t.string(),
      structureId: t.string(),
      evidenceKind: t.string(),
      sourceId: t.string(),
    },
  ),
};

/* -------------------------------------------------------------- simulation */
const admin = table(
  { name: 'admin' },
  {
    id: t.u32().primaryKey(),
    owner: t.identity(),
  },
);

const branch = table(
  { name: 'branch', public: true },
  {
    id: t.string().primaryKey(),
    name: t.string(),
    owner: t.identity().index('btree'),
    baselineId: t.string(),
    parentBranchId: t.string(),
    forkRevision: t.u32(),
    /** Number of stored events (redo ceiling). */
    head: t.u32(),
    /** Number of active events; undo/redo move this cursor. */
    cursor: t.u32(),
    /** Optimistic-concurrency revision; increments on every mutation. */
    revision: t.u32(),
    seed: t.u32(),
    archived: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const branchEvent = table(
  { name: 'branch_event', public: true },
  {
    id: t.string().primaryKey(),
    branchId: t.string().index('btree'),
    seq: t.u32(),
    /** `${branchId}/${commandId}` — duplicate command ids are idempotent per branch. */
    commandKey: t.string().unique(),
    commandId: t.string(),
    action: t.string(),
    targetId: t.string(),
    parametersJson: t.string(),
    modelId: t.string(),
    modelVersion: t.string(),
    summaryJson: t.string(),
    author: t.identity(),
    createdAt: t.timestamp(),
  },
);

const conceptAsset = table(
  { name: 'concept_asset', public: true },
  {
    id: t.string().primaryKey(),
    branchId: t.string().index('btree'),
    revision: t.u32(),
    level: t.string(),
    promptHash: t.string(),
    prompt: t.string(),
    model: t.string(),
    assetUrl: t.string(),
    status: t.string(),
    author: t.identity(),
    createdAt: t.timestamp(),
  },
);


const spacetimedb = schema({
  ...legacy,
  ...scienceTables,
  admin,
  branch,
  branchEvent,
  conceptAsset,
  ...worldTables,
});

export default spacetimedb;
export type Schema = typeof spacetimedb;
