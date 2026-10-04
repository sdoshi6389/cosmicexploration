import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { SCIENCE_SPEC } from './science';
import spacetimedb from './schema';
import { invalidateWorld } from './engineCache';

export default spacetimedb;
export * from './authority';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function requireAdmin(ctx: Ctx): void {
  const row = ctx.db.admin.id.find(0);
  if (!row || !row.owner.isEqual(ctx.sender)) throw new SenderError('admin identity required');
}

function ownedBranch(ctx: Ctx, branchId: string) {
  const b = ctx.db.branch.id.find(branchId);
  if (!b) throw new SenderError(`branch ${branchId} not found`);
  if (!b.owner.isEqual(ctx.sender)) throw new SenderError('branch belongs to another identity');
  return b;
}

function checkRevision(b: { revision: number }, expected: number): void {
  if (b.revision !== expected) {
    throw new SenderError(`stale revision: expected ${expected}, latest ${b.revision}`);
  }
}

/* ----------------------------------------------------------------- admin */

/** First caller after publish becomes admin (the publisher claims it immediately). */
export const claim_admin = spacetimedb.reducer((ctx) => {
  if (ctx.db.admin.id.find(0)) {
    requireAdmin(ctx);
    return;
  }
  ctx.db.admin.insert({ id: 0, owner: ctx.sender });
});

/**
 * Upsert a chunk of science rows. `json` is column-oriented: {"c": [...cols], "r": [[...], ...]}
 * Values are coerced to the generated column types; null becomes an empty option.
 */
export const ingest_rows = spacetimedb.reducer({ table: t.string(), json: t.string() }, (ctx, args) => {
  requireAdmin(ctx);
  invalidateWorld();
  const spec = SCIENCE_SPEC[args.table];
  if (!spec) throw new SenderError(`unknown science table ${args.table}`);
  const [accessor, pk, columns] = spec;
  const payload = JSON.parse(args.json) as { c: string[]; r: unknown[][] };
  const index = new Map(payload.c.map((c, i) => [c, i]));
  // Dynamic accessor lookup: table names come from the generated spec, not the caller.
  const tbl = (ctx.db as unknown as Record<string, any>)[accessor];
  for (const raw of payload.r) {
    const row: Record<string, unknown> = {};
    for (const [col, typ] of columns) {
      const i = index.get(col);
      const v = i === undefined ? null : raw[i];
      const optional = typ.endsWith('?');
      const base = optional ? typ.slice(0, -1) : typ;
      if (v === null || v === undefined) {
        if (!optional && base !== 'str') throw new SenderError(`${args.table}.${col} missing`);
        row[col] = optional ? undefined : '';
        continue;
      }
      if (base === 'str') row[col] = String(v);
      else if (base === 'f64') row[col] = Number(v);
      else if (base === 'u32' || base === 'i32') row[col] = Math.trunc(Number(v));
      else if (base === 'bool') row[col] = Boolean(v);
    }
    if (tbl[pk].find(row[pk])) tbl[pk].delete(row[pk]);
    tbl.insert(row);
  }
});

export const clear_table = spacetimedb.reducer({ table: t.string() }, (ctx, { table: name }) => {
  requireAdmin(ctx);
  invalidateWorld();
  const spec = SCIENCE_SPEC[name];
  if (!spec) throw new SenderError(`unknown science table ${name}`);
  const [accessor, pk] = spec;
  const tbl = (ctx.db as unknown as Record<string, any>)[accessor];
  for (const row of [...tbl.iter()]) tbl[pk].delete(row[pk]);
});

/** Empties the superseded v1 tables (the generated science tables replace them). */
export const clear_science = spacetimedb.reducer((ctx) => {
  requireAdmin(ctx);
  for (const row of [...ctx.db.source_manifest.iter()]) ctx.db.source_manifest.id.delete(row.id);
  for (const row of [...ctx.db.star.iter()]) ctx.db.star.id.delete(row.id);
  for (const row of [...ctx.db.solar_body.iter()]) ctx.db.solar_body.id.delete(row.id);
  for (const row of [...ctx.db.earth_constant.iter()]) ctx.db.earth_constant.id.delete(row.id);
  for (const row of [...ctx.db.earth_anchor.iter()]) ctx.db.earth_anchor.id.delete(row.id);
  for (const row of [...ctx.db.earth_energy.iter()]) ctx.db.earth_energy.source.delete(row.source);
  for (const row of [...ctx.db.exoplanet.iter()]) ctx.db.exoplanet.id.delete(row.id);
  for (const row of [...ctx.db.particle.iter()]) ctx.db.particle.id.delete(row.id);
  for (const row of [...ctx.db.atomic_level.iter()]) ctx.db.atomic_level.id.delete(row.id);
  for (const row of [...ctx.db.isotope.iter()]) ctx.db.isotope.id.delete(row.id);
  for (const row of [...ctx.db.gene.iter()]) ctx.db.gene.id.delete(row.id);
});

/* -------------------------------------------------------------- branches */

export const create_branch = spacetimedb.reducer(
  { id: t.string(), name: t.string(), baselineId: t.string(), seed: t.u32() },
  (ctx, { id, name, baselineId, seed }) => {
    if (!id.trim()) throw new SenderError('branch id required');
    if (ctx.db.branch.id.find(id)) return; // idempotent: same id twice is a no-op
    ctx.db.branch.insert({
      id,
      name: name.slice(0, 80) || 'Untitled world',
      owner: ctx.sender,
      baselineId,
      parentBranchId: '',
      forkRevision: 0,
      head: 0,
      cursor: 0,
      revision: 0,
      seed,
      archived: false,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  },
);

/** Fork copies the parent's active events (up to its cursor) into a new branch. */
export const fork_branch = spacetimedb.reducer(
  { id: t.string(), name: t.string(), parentId: t.string() },
  (ctx, { id, name, parentId }) => {
    if (ctx.db.branch.id.find(id)) return;
    const parent = ctx.db.branch.id.find(parentId);
    if (!parent) throw new SenderError(`parent branch ${parentId} not found`);
    const events = [...ctx.db.branchEvent.branchId.filter(parentId)]
      .filter((e) => e.seq <= parent.cursor)
      .sort((a, b) => a.seq - b.seq);
    ctx.db.branch.insert({
      id,
      name: name.slice(0, 80) || `${parent.name} (fork)`,
      owner: ctx.sender,
      baselineId: parent.baselineId,
      parentBranchId: parentId,
      forkRevision: parent.revision,
      head: events.length,
      cursor: events.length,
      revision: 0,
      seed: parent.seed,
      archived: false,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    for (const e of events) {
      ctx.db.branchEvent.insert({
        ...e,
        id: `${id}:${e.seq}`,
        branchId: id,
        commandKey: `${id}/${e.commandId}`,
        author: ctx.sender,
        createdAt: ctx.timestamp,
      });
    }
  },
);

export const rename_branch = spacetimedb.reducer(
  { branchId: t.string(), name: t.string() },
  (ctx, { branchId, name }) => {
    const b = ownedBranch(ctx, branchId);
    ctx.db.branch.id.update({ ...b, name: name.slice(0, 80), updatedAt: ctx.timestamp });
  },
);

export const archive_branch = spacetimedb.reducer({ branchId: t.string() }, (ctx, { branchId }) => {
  const b = ownedBranch(ctx, branchId);
  ctx.db.branch.id.update({ ...b, archived: true, updatedAt: ctx.timestamp });
});

/**
 * Append a validated command. Stale revisions are rejected (no last-write-wins);
 * a repeated commandId on the same branch is a silent no-op; any redo tail beyond
 * the cursor is truncated.
 */
export const append_event = spacetimedb.reducer(
  {
    branchId: t.string(),
    expectedRevision: t.u32(),
    commandId: t.string(),
    action: t.string(),
    targetId: t.string(),
    parametersJson: t.string(),
    modelId: t.string(),
    modelVersion: t.string(),
    summaryJson: t.string(),
  },
  (ctx, a) => {
    if (ctx.db.branchEvent.commandKey.find(`${a.branchId}/${a.commandId}`)) return;
    const b = ownedBranch(ctx, a.branchId);
    checkRevision(b, a.expectedRevision);
    if (a.parametersJson.length > 200_000) throw new SenderError('parameters too large');
    for (const e of [...ctx.db.branchEvent.branchId.filter(a.branchId)]) {
      if (e.seq > b.cursor) ctx.db.branchEvent.id.delete(e.id);
    }
    const seq = b.cursor + 1;
    ctx.db.branchEvent.insert({
      id: `${a.branchId}:${seq}`,
      branchId: a.branchId,
      seq,
      commandKey: `${a.branchId}/${a.commandId}`,
      commandId: a.commandId,
      action: a.action,
      targetId: a.targetId,
      parametersJson: a.parametersJson,
      modelId: a.modelId,
      modelVersion: a.modelVersion,
      summaryJson: a.summaryJson.slice(0, 20_000),
      author: ctx.sender,
      createdAt: ctx.timestamp,
    });
    ctx.db.branch.id.update({
      ...b,
      head: seq,
      cursor: seq,
      revision: b.revision + 1,
      updatedAt: ctx.timestamp,
    });
  },
);

export const undo_event = spacetimedb.reducer(
  { branchId: t.string(), expectedRevision: t.u32() },
  (ctx, { branchId, expectedRevision }) => {
    const b = ownedBranch(ctx, branchId);
    checkRevision(b, expectedRevision);
    if (b.cursor === 0) throw new SenderError('nothing to undo');
    ctx.db.branch.id.update({ ...b, cursor: b.cursor - 1, revision: b.revision + 1, updatedAt: ctx.timestamp });
  },
);

export const redo_event = spacetimedb.reducer(
  { branchId: t.string(), expectedRevision: t.u32() },
  (ctx, { branchId, expectedRevision }) => {
    const b = ownedBranch(ctx, branchId);
    checkRevision(b, expectedRevision);
    if (b.cursor >= b.head) throw new SenderError('nothing to redo');
    ctx.db.branch.id.update({ ...b, cursor: b.cursor + 1, revision: b.revision + 1, updatedAt: ctx.timestamp });
  },
);

/** Reset returns the projection to the baseline; events stay available to redo. */
export const reset_branch = spacetimedb.reducer(
  { branchId: t.string(), expectedRevision: t.u32() },
  (ctx, { branchId, expectedRevision }) => {
    const b = ownedBranch(ctx, branchId);
    checkRevision(b, expectedRevision);
    ctx.db.branch.id.update({ ...b, cursor: 0, revision: b.revision + 1, updatedAt: ctx.timestamp });
  },
);

/* --------------------------------------------------------------- imagine */

export const record_concept = spacetimedb.reducer(
  {
    id: t.string(),
    branchId: t.string(),
    revision: t.u32(),
    level: t.string(),
    promptHash: t.string(),
    prompt: t.string(),
    model: t.string(),
    assetUrl: t.string(),
    status: t.string(),
  },
  (ctx, a) => {
    ownedBranch(ctx, a.branchId);
    const existing = ctx.db.conceptAsset.id.find(a.id);
    const row = {
      ...a,
      prompt: a.prompt.slice(0, 4000),
      author: ctx.sender,
      createdAt: existing?.createdAt ?? ctx.timestamp,
    };
    if (existing) ctx.db.conceptAsset.id.update(row);
    else ctx.db.conceptAsset.insert(row);
  },
);
