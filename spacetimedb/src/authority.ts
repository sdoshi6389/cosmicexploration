import { ScheduleAt, SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import {
  CosmosWorld,
  LEVELS,
  compactView,
  imaginePrompt,
  interventionKind,
  levelForAssumption,
  type BranchEvent,
  type Intervention,
  type LevelId,
} from '../../packages/engine/src/index';
import spacetimedb from './schema';
import { engine } from './engineCache';
import { clockSchedule } from './worldTables';

/**
 * Authoritative simulation layer.
 *
 * Clients never write world state directly: every change is a validated command
 * (`submit_command`) that this module replays through the deterministic COSMOS
 * engine (the same code the browser bundles), then re-projects into the
 * intervention / parameter / model_output / dependency_edge tables inside one
 * transaction. Voice and chat use the same reducers under the speaker's identity.
 */

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const LEVEL_IDS = Object.keys(LEVELS) as LevelId[];
const ROLES = ['owner', 'editor', 'viewer'];
const SOURCES = ['ui', 'voice', 'chat', 'test', 'worker'];
const ALLOWED_ACTIONS = ['create_intervention', 'update_intervention', 'remove_intervention', 'set_assumption', 'set_capabilities', 'undo', 'redo', 'reset'];
const YEAR_S = 365.25 * 86400;
const MAX_SIM_SECONDS = 1e13;
const TICK_MICROS = 1_000_000n;

/* ------------------------------------------------------------ helpers */

const hex = (id: Identity) => id.toHexString();
const memberId = (sessionId: string, id: Identity) => `${sessionId}:${hex(id)}`;

function roleOf(ctx: Ctx, sessionId: string, who: Identity = ctx.sender): string | null {
  return ctx.db.sessionMember.id.find(memberId(sessionId, who))?.role ?? null;
}

function requireMember(ctx: Ctx, sessionId: string): string {
  const r = roleOf(ctx, sessionId);
  if (!r) throw new SenderError('not a member of this session');
  return r;
}

function requireEditor(ctx: Ctx, sessionId: string): string {
  const r = requireMember(ctx, sessionId);
  if (r === 'viewer') throw new SenderError('viewers cannot change this session');
  return r;
}

function requireAdmin(ctx: Ctx): void {
  const row = ctx.db.admin.id.find(0);
  if (!row || !row.owner.isEqual(ctx.sender)) throw new SenderError('admin identity required');
}

function branchOrThrow(ctx: Ctx, branchId: string) {
  const b = ctx.db.worldBranch.id.find(branchId);
  if (!b) throw new SenderError(`branch ${branchId} not found`);
  return b;
}

function checkId(label: string, v: string, max = 96): void {
  if (!/^[A-Za-z0-9_.:-]+$/.test(v) || v.length < 3 || v.length > max) throw new SenderError(`${label} must be 3–${max} chars of [A-Za-z0-9_.:-]`);
}

function ensureClockSchedule(ctx: Ctx): void {
  for (const _ of ctx.db.clockSchedule.iter()) return;
  ctx.db.clockSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
}

/** Load a branch's persisted events into the engine (the DB is the source of truth). */
function hydrate(ctx: Ctx, world: CosmosWorld, b: { id: string; revision: number; cursor: number; head: number; seed: number }): void {
  const events: BranchEvent[] = [...ctx.db.worldEvent.branchId.filter(b.id)]
    .sort((x, y) => x.seq - y.seq)
    .map((e) => ({ commandId: e.commandId, seq: e.seq, action: e.action, targetId: e.targetId, parameters: JSON.parse(e.parametersJson) as Record<string, unknown> }));
  world.hydrateBranch({ id: b.id, revision: b.revision, cursor: b.cursor, head: b.head, seed: b.seed }, events);
}

/**
 * Re-project a branch into the authoritative state tables. `levels` limits which
 * model outputs are rewritten (the clock tick only refreshes time-dependent ones).
 */
function project(ctx: Ctx, world: CosmosWorld, branchId: string, clockSeconds: number, levels?: LevelId[]): void {
  const b = branchOrThrow(ctx, branchId);
  hydrate(ctx, world, b);
  const p = world.project(branchId, clockSeconds);
  if (!p) throw new SenderError('projection failed');
  const sessionId = b.sessionId;

  if (!levels) {
    for (const row of [...ctx.db.intervention.branchId.filter(branchId)]) ctx.db.intervention.id.delete(row.id);
    for (const iv of p.interventions) {
      ctx.db.intervention.insert({
        id: `${branchId}:${iv.id}`, sessionId, branchId, interventionId: iv.id, level: iv.level, kind: iv.kind, label: iv.label,
        paramsJson: JSON.stringify(iv.params), createdSeq: iv.createdSeq, updatedSeq: iv.updatedSeq,
      });
    }
    for (const row of [...ctx.db.simulationParameter.branchId.filter(branchId)]) ctx.db.simulationParameter.id.delete(row.id);
    for (const [key, value] of Object.entries(p.assumptions)) {
      ctx.db.simulationParameter.insert({
        id: `${branchId}:${key}`, sessionId, branchId, key, level: levelForAssumption(world.ctx, key)?.level ?? '', valueJson: JSON.stringify(value),
      });
    }
    if (b.kardashevLevel !== p.capabilities.kardashevLevel || b.barrowLevel !== p.capabilities.barrowLevel) {
      ctx.db.worldBranch.id.update({ ...b, kardashevLevel: p.capabilities.kardashevLevel, barrowLevel: p.capabilities.barrowLevel });
    }
  }

  for (const level of levels ?? LEVEL_IDS) {
    const id = `${branchId}:${level}`;
    const out = p.outputs[level];
    const existing = ctx.db.modelOutput.id.find(id);
    if (!out) {
      if (existing) ctx.db.modelOutput.id.delete(id);
      for (const e of [...ctx.db.dependencyEdge.branchId.filter(branchId)]) if (e.level === level) ctx.db.dependencyEdge.id.delete(e.id);
      continue;
    }
    if (existing && existing.inputHash === out.inputHash) continue;
    const row = {
      id, sessionId, branchId, level, modelId: out.modelId, modelVersion: out.modelVersion, inputHash: out.inputHash, revision: b.revision,
      clockSeconds, summaryJson: JSON.stringify(out.summary), viewJson: JSON.stringify(compactView(out.view)),
      nodesJson: JSON.stringify(out.nodes), warningsJson: JSON.stringify(out.warnings), assumptionsJson: JSON.stringify(out.assumptions), computedAt: ctx.timestamp,
    };
    if (existing) ctx.db.modelOutput.id.update(row);
    else ctx.db.modelOutput.insert(row);
    for (const e of [...ctx.db.dependencyEdge.branchId.filter(branchId)]) if (e.level === level) ctx.db.dependencyEdge.id.delete(e.id);
    for (const n of out.nodes) {
      for (const from of n.dependsOn) {
        ctx.db.dependencyEdge.insert({ id: `${branchId}:${level}:${from}>${n.id}`, sessionId, branchId, level, fromNode: from, toNode: n.id, modelId: n.modelId, modelVersion: n.version });
      }
    }
  }
}

function clockSeconds(ctx: Ctx, branchId: string): number {
  return ctx.db.simulationClock.branchId.find(branchId)?.simSeconds ?? 0;
}

function receipt(ctx: Ctx, b: { id: string; sessionId: string }, commandId: string, action: string, status: string, message: string, revision: number, latestRevision: number, source: string): void {
  ctx.db.commandReceipt.insert({
    commandKey: `${b.id}/${commandId}`, sessionId: b.sessionId, branchId: b.id, commandId, action, status,
    message: message.slice(0, 2000), revision, latestRevision, source, sender: ctx.sender, createdAt: ctx.timestamp,
  });
}

function newBranchRow(ctx: Ctx, id: string, sessionId: string, name: string, baselineId: string, extra: Partial<{ parentBranchId: string; forkRevision: number; head: number; cursor: number; seed: number; kardashevLevel: number; barrowLevel: number }> = {}) {
  return {
    id, sessionId, name: name.slice(0, 80) || 'Untitled world', baselineId, parentBranchId: extra.parentBranchId ?? '', forkRevision: extra.forkRevision ?? 0,
    head: extra.head ?? 0, cursor: extra.cursor ?? 0, revision: 0, seed: extra.seed ?? 4242, kardashevLevel: extra.kardashevLevel ?? 1,
    barrowLevel: extra.barrowLevel ?? 1, archived: false, createdBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  };
}

function newClock(ctx: Ctx, branchId: string, sessionId: string, from?: { rate: number; simSeconds: number }) {
  ctx.db.simulationClock.insert({ branchId, sessionId, running: false, rate: from?.rate ?? 50 * YEAR_S, simSeconds: from?.simSeconds ?? 0, revision: 0, updatedAt: ctx.timestamp });
}

function upsertPresence(ctx: Ctx, sessionId: string, patch: Partial<{ displayName: string; role: string; branchId: string; stop: string; selectedId: string; following: boolean; online: boolean }>): void {
  const id = memberId(sessionId, ctx.sender);
  const cur = ctx.db.presence.id.find(id);
  const row = {
    id, sessionId, identity: ctx.sender, displayName: cur?.displayName ?? 'Explorer', role: cur?.role ?? 'viewer', branchId: cur?.branchId ?? '',
    stop: cur?.stop ?? '', selectedId: cur?.selectedId ?? '', following: cur?.following ?? false, online: true, lastSeen: ctx.timestamp, ...patch,
  };
  if (cur) ctx.db.presence.id.update(row);
  else ctx.db.presence.insert(row);
}

/** Keep the private RLS mirror in step with session_member (insert/update/delete). */
function syncAcl(ctx: Ctx, id: string): void {
  const m = ctx.db.sessionMember.id.find(id);
  const cur = ctx.db.memberAcl.id.find(id);
  if (!m) {
    if (cur) ctx.db.memberAcl.id.delete(id);
    return;
  }
  const row = { id, sessionId: m.sessionId, identity: m.identity, role: m.role };
  if (cur) ctx.db.memberAcl.id.update(row);
  else ctx.db.memberAcl.insert(row);
}

/* ------------------------------------------------------------ lifecycle */

export const init = spacetimedb.init((ctx) => {
  ensureClockSchedule(ctx);
});

export const on_connect = spacetimedb.clientConnected((ctx) => {
  ensureClockSchedule(ctx);
  for (const p of [...ctx.db.presence.identity.filter(ctx.sender)]) ctx.db.presence.id.update({ ...p, online: true, lastSeen: ctx.timestamp });
});

export const on_disconnect = spacetimedb.clientDisconnected((ctx) => {
  for (const p of [...ctx.db.presence.identity.filter(ctx.sender)]) ctx.db.presence.id.update({ ...p, online: false, following: false, lastSeen: ctx.timestamp });
  for (const s of [...ctx.db.worldSession.iter()]) if (s.presenterHex === hex(ctx.sender)) ctx.db.worldSession.id.update({ ...s, presenterHex: '' });
});

/* ------------------------------------------------------------ sessions */

/** Create a shared session with its main branch; the caller becomes owner. */
export const create_session = spacetimedb.reducer(
  { sessionId: t.string(), branchId: t.string(), name: t.string(), displayName: t.string() },
  (ctx, a) => {
    checkId('sessionId', a.sessionId);
    checkId('branchId', a.branchId);
    if (ctx.db.worldSession.id.find(a.sessionId)) {
      requireMember(ctx, a.sessionId); // idempotent for members
      return;
    }
    if (ctx.db.worldBranch.id.find(a.branchId)) throw new SenderError('branch id already used');
    const world = engine(ctx);
    ctx.db.worldSession.insert({ id: a.sessionId, name: a.name.slice(0, 80) || 'COSMOS session', owner: ctx.sender, mainBranchId: a.branchId, presenterHex: '', createdAt: ctx.timestamp });
    ctx.db.sessionMember.insert({ id: memberId(a.sessionId, ctx.sender), sessionId: a.sessionId, identity: ctx.sender, role: 'owner', displayName: a.displayName.slice(0, 40) || 'Owner', joinedAt: ctx.timestamp });
    syncAcl(ctx, memberId(a.sessionId, ctx.sender));
    for (const role of ['editor', 'viewer']) {
      const code = `${role === 'editor' ? 'E' : 'V'}-${ctx.newUuidV4().toString().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      ctx.db.sessionInvite.insert({ code, sessionId: a.sessionId, role, createdAt: ctx.timestamp });
    }
    ctx.db.worldBranch.insert(newBranchRow(ctx, a.branchId, a.sessionId, 'Main world', world.baseline.id));
    newClock(ctx, a.branchId, a.sessionId);
    upsertPresence(ctx, a.sessionId, { displayName: a.displayName.slice(0, 40) || 'Owner', role: 'owner', branchId: a.branchId });
    ensureClockSchedule(ctx);
  },
);

export const join_session = spacetimedb.reducer({ code: t.string(), displayName: t.string() }, (ctx, { code, displayName }) => {
  const invite = ctx.db.sessionInvite.code.find(code.trim().toUpperCase());
  if (!invite) throw new SenderError('invalid join code');
  const id = memberId(invite.sessionId, ctx.sender);
  const cur = ctx.db.sessionMember.id.find(id);
  const name = displayName.slice(0, 40) || 'Explorer';
  if (!cur) ctx.db.sessionMember.insert({ id, sessionId: invite.sessionId, identity: ctx.sender, role: invite.role, displayName: name, joinedAt: ctx.timestamp });
  else if (cur.role === 'viewer' && invite.role === 'editor') ctx.db.sessionMember.id.update({ ...cur, role: 'editor', displayName: name });
  syncAcl(ctx, id);
  const role = ctx.db.sessionMember.id.find(id)!.role;
  const session = ctx.db.worldSession.id.find(invite.sessionId)!;
  upsertPresence(ctx, invite.sessionId, { displayName: name, role, branchId: session.mainBranchId });
});

export const leave_session = spacetimedb.reducer({ sessionId: t.string() }, (ctx, { sessionId }) => {
  const role = requireMember(ctx, sessionId);
  if (role === 'owner') throw new SenderError('the owner cannot leave their session');
  ctx.db.sessionMember.id.delete(memberId(sessionId, ctx.sender));
  syncAcl(ctx, memberId(sessionId, ctx.sender));
  ctx.db.presence.id.delete(memberId(sessionId, ctx.sender));
});

export const set_member_role = spacetimedb.reducer({ sessionId: t.string(), identityHex: t.string(), role: t.string() }, (ctx, a) => {
  if (requireMember(ctx, a.sessionId) !== 'owner') throw new SenderError('only the owner can change roles');
  if (!['editor', 'viewer'].includes(a.role)) throw new SenderError('role must be editor or viewer');
  const target = ctx.db.sessionMember.id.find(`${a.sessionId}:${a.identityHex}`);
  if (!target || target.role === 'owner') throw new SenderError('member not found');
  ctx.db.sessionMember.id.update({ ...target, role: a.role });
  syncAcl(ctx, target.id);
  const p = ctx.db.presence.id.find(target.id);
  if (p) ctx.db.presence.id.update({ ...p, role: a.role });
});

/** Presenter mode: followers mirror the presenter's stop/selection from `presence`. */
export const set_presenter = spacetimedb.reducer({ sessionId: t.string(), presenting: t.bool() }, (ctx, { sessionId, presenting }) => {
  requireEditor(ctx, sessionId);
  const s = ctx.db.worldSession.id.find(sessionId)!;
  if (presenting) ctx.db.worldSession.id.update({ ...s, presenterHex: hex(ctx.sender) });
  else if (s.presenterHex === hex(ctx.sender)) ctx.db.worldSession.id.update({ ...s, presenterHex: '' });
});

export const update_presence = spacetimedb.reducer(
  { sessionId: t.string(), branchId: t.string(), stop: t.string(), selectedId: t.string(), following: t.bool(), displayName: t.string() },
  (ctx, a) => {
    const role = requireMember(ctx, a.sessionId);
    const name = a.displayName.trim().slice(0, 40);
    if (name) {
      const m = ctx.db.sessionMember.id.find(memberId(a.sessionId, ctx.sender));
      if (m && m.displayName !== name) ctx.db.sessionMember.id.update({ ...m, displayName: name });
    }
    if (a.branchId) {
      const b = ctx.db.worldBranch.id.find(a.branchId);
      if (!b || b.sessionId !== a.sessionId) throw new SenderError('branch not in session');
    }
    upsertPresence(ctx, a.sessionId, { role, branchId: a.branchId, stop: a.stop.slice(0, 40), selectedId: a.selectedId.slice(0, 120), following: a.following, ...(name ? { displayName: name } : {}) });
  },
);

/** Stream this explorer's camera (throttled client-side); members only. */
export const update_pose = spacetimedb.reducer(
  { sessionId: t.string(), stop: t.string(), px: t.f64(), py: t.f64(), pz: t.f64(), tx: t.f64(), ty: t.f64(), tz: t.f64(), color: t.string() },
  (ctx, a) => {
    requireMember(ctx, a.sessionId);
    const nums = [a.px, a.py, a.pz, a.tx, a.ty, a.tz];
    if (!nums.every((v) => Number.isFinite(v) && Math.abs(v) < 1e7)) throw new SenderError('pose out of range');
    const id = memberId(a.sessionId, ctx.sender);
    const row = { id, sessionId: a.sessionId, identity: ctx.sender, stop: a.stop.slice(0, 24), px: a.px, py: a.py, pz: a.pz, tx: a.tx, ty: a.ty, tz: a.tz, color: /^#[0-9a-fA-F]{6}$/.test(a.color) ? a.color : '#5ce1ff', updatedAt: ctx.timestamp };
    if (ctx.db.presencePose.id.find(id)) ctx.db.presencePose.id.update(row);
    else ctx.db.presencePose.insert(row);
  },
);

/* ------------------------------------------------------------ branches */

export const fork_world_branch = spacetimedb.reducer(
  { parentBranchId: t.string(), branchId: t.string(), name: t.string() },
  (ctx, a) => {
    checkId('branchId', a.branchId);
    const parent = branchOrThrow(ctx, a.parentBranchId);
    requireEditor(ctx, parent.sessionId);
    if (ctx.db.worldBranch.id.find(a.branchId)) return; // idempotent
    const events = [...ctx.db.worldEvent.branchId.filter(parent.id)].filter((e) => e.seq <= parent.cursor).sort((x, y) => x.seq - y.seq);
    ctx.db.worldBranch.insert(newBranchRow(ctx, a.branchId, parent.sessionId, a.name || `${parent.name} (fork)`, parent.baselineId, {
      parentBranchId: parent.id, forkRevision: parent.revision, head: events.length, cursor: events.length, seed: parent.seed,
      kardashevLevel: parent.kardashevLevel, barrowLevel: parent.barrowLevel,
    }));
    for (const e of events) ctx.db.worldEvent.insert({ ...e, id: `${a.branchId}:${e.seq}`, branchId: a.branchId });
    const pc = ctx.db.simulationClock.branchId.find(parent.id);
    newClock(ctx, a.branchId, parent.sessionId, pc ?? undefined);
    project(ctx, engine(ctx), a.branchId, pc?.simSeconds ?? 0);
  },
);

export const rename_world_branch = spacetimedb.reducer({ branchId: t.string(), name: t.string() }, (ctx, { branchId, name }) => {
  const b = branchOrThrow(ctx, branchId);
  requireEditor(ctx, b.sessionId);
  ctx.db.worldBranch.id.update({ ...b, name: name.slice(0, 80) || b.name, updatedAt: ctx.timestamp });
});

export const archive_world_branch = spacetimedb.reducer({ branchId: t.string() }, (ctx, { branchId }) => {
  const b = branchOrThrow(ctx, branchId);
  requireEditor(ctx, b.sessionId);
  const s = ctx.db.worldSession.id.find(b.sessionId)!;
  if (s.mainBranchId === branchId) throw new SenderError('the main branch cannot be archived');
  ctx.db.worldBranch.id.update({ ...b, archived: true, updatedAt: ctx.timestamp });
});

/* ------------------------------------------------------------ commands */

/**
 * The single write path for world changes (UI, chat and voice alike). Validation
 * failures are recorded as `rejected` receipts (atomic: nothing else changes) so
 * the caller — including the voice agent — can explain why.
 */
export const submit_command = spacetimedb.reducer(
  {
    branchId: t.string(), commandId: t.string(), expectedRevision: t.u32(), action: t.string(),
    targetId: t.string(), parametersJson: t.string(), source: t.string(),
  },
  (ctx, a) => {
    checkId('commandId', a.commandId);
    const b = branchOrThrow(ctx, a.branchId);
    requireMember(ctx, b.sessionId);
    if (ctx.db.commandReceipt.commandKey.find(`${b.id}/${a.commandId}`)) return; // duplicate: idempotent no-op
    const source = SOURCES.includes(a.source) ? a.source : 'ui';
    const reject = (msg: string) => receipt(ctx, b, a.commandId, a.action, 'rejected', msg, b.revision, b.revision, source);
    if (roleOf(ctx, b.sessionId) === 'viewer') return reject('Viewers cannot change the world; ask the owner for an editor code.');
    if (b.archived) return reject('Branch is archived.');
    if (!ALLOWED_ACTIONS.includes(a.action)) return reject(`Unsupported action "${a.action}".`);
    if (a.parametersJson.length > 20_000) return reject('Parameters too large.');
    let parameters: Record<string, unknown>;
    try {
      const parsed = JSON.parse(a.parametersJson || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reject('parameters must be a JSON object');
      parameters = parsed as Record<string, unknown>;
    } catch {
      return reject('parameters are not valid JSON');
    }
    const world = engine(ctx);
    hydrate(ctx, world, b);
    const result = world.execute({ commandId: a.commandId, branchId: b.id, expectedRevision: a.expectedRevision, action: a.action, targetId: a.targetId, parameters });
    if (!result.ok) {
      const latest = result.conflict?.latestRevision ?? b.revision;
      return receipt(ctx, b, a.commandId, a.action, result.conflict ? 'conflict' : 'rejected', (result.errors ?? ['rejected']).join('; '), b.revision, latest, source);
    }
    const nb = world.getBranch(b.id)!;
    if (result.event) {
      for (const e of [...ctx.db.worldEvent.branchId.filter(b.id)]) if (e.seq >= result.event.seq) ctx.db.worldEvent.id.delete(e.id);
      ctx.db.worldEvent.insert({
        id: `${b.id}:${result.event.seq}`, sessionId: b.sessionId, branchId: b.id, seq: result.event.seq, commandId: a.commandId, action: a.action,
        targetId: result.event.targetId, parametersJson: JSON.stringify(result.event.parameters), source, author: ctx.sender, createdAt: ctx.timestamp,
      });
    }
    ctx.db.worldBranch.id.update({ ...b, head: nb.head, cursor: nb.cursor, revision: nb.revision, updatedAt: ctx.timestamp });
    project(ctx, world, b.id, clockSeconds(ctx, b.id));
    const target = result.event?.targetId ? ` ${result.event.targetId}` : '';
    receipt(ctx, b, a.commandId, a.action, 'applied', `${a.action}${target}`, nb.revision, nb.revision, source);
  },
);

/* ------------------------------------------------------------ clock */

export const clock_control = spacetimedb.reducer(
  { branchId: t.string(), commandId: t.string(), action: t.string(), value: t.f64(), source: t.string() },
  (ctx, a) => {
    checkId('commandId', a.commandId);
    const b = branchOrThrow(ctx, a.branchId);
    requireMember(ctx, b.sessionId);
    if (ctx.db.commandReceipt.commandKey.find(`${b.id}/${a.commandId}`)) return;
    const source = SOURCES.includes(a.source) ? a.source : 'ui';
    const reject = (msg: string) => receipt(ctx, b, a.commandId, `clock.${a.action}`, 'rejected', msg, b.revision, b.revision, source);
    if (roleOf(ctx, b.sessionId) === 'viewer') return reject('Viewers cannot control the clock.');
    const c = ctx.db.simulationClock.branchId.find(b.id);
    if (!c) return reject('Branch has no clock.');
    const next = { ...c, revision: c.revision + 1, updatedAt: ctx.timestamp };
    if (a.action === 'play') next.running = true;
    else if (a.action === 'pause') next.running = false;
    else if (a.action === 'set_rate') {
      if (!Number.isFinite(a.value) || a.value <= 0 || a.value > 1e12) return reject('Rate must be between 0 and 10¹² simulated seconds per second.');
      next.rate = a.value;
    } else if (a.action === 'seek') {
      if (!Number.isFinite(a.value) || a.value < 0 || a.value > MAX_SIM_SECONDS) return reject(`Seek time must be between 0 and ${MAX_SIM_SECONDS} s.`);
      next.simSeconds = a.value;
    } else return reject(`Unknown clock action "${a.action}" (play, pause, set_rate, seek).`);
    ctx.db.simulationClock.branchId.update(next);
    if (a.action === 'seek') project(ctx, engine(ctx), b.id, next.simSeconds, timeLevels());
    receipt(ctx, b, a.commandId, `clock.${a.action}`, 'applied', `clock ${a.action}${a.action === 'seek' || a.action === 'set_rate' ? ` ${a.value}` : ''}`, b.revision, b.revision, source);
  },
);

function timeLevels(): LevelId[] {
  return LEVEL_IDS.filter((l) => LEVELS[l].timeDependent);
}

/** Scheduled heartbeat: advances running clocks and refreshes time-dependent outputs. */
export const clock_tick = spacetimedb.reducer({ name: 'clock_tick', onSchedule: clockSchedule }, { arg: clockSchedule.rowType }, (ctx) => {
  if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('clock_tick is scheduler-only');
  const now = ctx.timestamp.microsSinceUnixEpoch;
  let world: CosmosWorld | null = null;
  // Sessions with someone online right now; idle worlds are paused so they cost nothing.
  const active = new Set<string>();
  for (const p of ctx.db.presence.iter()) if (p.online) active.add(p.sessionId);
  for (const c of [...ctx.db.simulationClock.iter()]) {
    if (!c.running) continue;
    if (!active.has(c.sessionId)) {
      ctx.db.simulationClock.branchId.update({ ...c, running: false, updatedAt: ctx.timestamp });
      continue;
    }
    const dt = Math.min(5, Number(now - c.updatedAt.microsSinceUnixEpoch) / 1e6);
    const simSeconds = Math.min(MAX_SIM_SECONDS, c.simSeconds + c.rate * Math.max(0, dt));
    ctx.db.simulationClock.branchId.update({ ...c, simSeconds, running: simSeconds < MAX_SIM_SECONDS, updatedAt: ctx.timestamp });
    const hasTimeIv = [...ctx.db.intervention.branchId.filter(c.branchId)].some((i) => LEVELS[i.level as LevelId]?.timeDependent);
    if (!hasTimeIv) continue;
    world ??= engine(ctx);
    project(ctx, world, c.branchId, simSeconds, timeLevels());
  }
});

/* ------------------------------------------------------------ async jobs (Imagine) */

export const request_imagine = spacetimedb.reducer(
  { branchId: t.string(), commandId: t.string(), level: t.string(), style: t.string() },
  (ctx, a) => {
    checkId('commandId', a.commandId);
    const b = branchOrThrow(ctx, a.branchId);
    requireEditor(ctx, b.sessionId);
    const id = `${b.id}:${a.commandId}`;
    if (ctx.db.calculationJob.id.find(id)) return;
    if (!LEVEL_IDS.includes(a.level as LevelId)) throw new SenderError(`unknown level ${a.level}`);
    const out = ctx.db.modelOutput.id.find(`${b.id}:${a.level}`);
    if (!out) throw new SenderError(`No ${a.level.toUpperCase()} result on this branch yet — create an intervention first.`);
    const ivs: Intervention[] = [...ctx.db.intervention.branchId.filter(b.id)].map((i) => ({
      id: i.interventionId, level: i.level as LevelId, kind: i.kind, label: i.label, params: JSON.parse(i.paramsJson) as Record<string, unknown>, createdSeq: i.createdSeq, updatedSeq: i.updatedSeq,
    }));
    const prompt = imaginePrompt(a.level as LevelId, { summary: JSON.parse(out.summaryJson), modelId: out.modelId, modelVersion: out.modelVersion }, ivs, a.style.slice(0, 40) || 'cinematic');
    ctx.db.calculationJob.insert({
      id, sessionId: b.sessionId, branchId: b.id, kind: 'imagine', level: a.level, revision: b.revision, inputHash: out.inputHash,
      payloadJson: JSON.stringify({ prompt, modelId: out.modelId, modelVersion: out.modelVersion }), status: 'queued', leaseOwnerHex: '',
      leaseExpiresMicros: 0n, attempts: 0, resultJson: '', error: '', requestedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
  },
);

export const register_worker = spacetimedb.reducer({ identityHex: t.string(), kind: t.string(), name: t.string() }, (ctx, a) => {
  requireAdmin(ctx);
  const identity = Identity.fromString(a.identityHex);
  const row = { identity, kind: a.kind, name: a.name.slice(0, 40), createdAt: ctx.timestamp };
  if (ctx.db.worker.identity.find(identity)) ctx.db.worker.identity.update(row);
  else ctx.db.worker.insert(row);
});

function workerFor(ctx: Ctx, kind: string): void {
  const w = ctx.db.worker.identity.find(ctx.sender);
  if (!w || w.kind !== kind) throw new SenderError('caller is not a registered worker for this job kind');
}

/** Lease a queued (or lease-expired) job. Throws if someone else holds a live lease. */
export const claim_job = spacetimedb.reducer({ jobId: t.string(), leaseSeconds: t.u32() }, (ctx, { jobId, leaseSeconds }) => {
  const j = ctx.db.calculationJob.id.find(jobId);
  if (!j) throw new SenderError('job not found');
  workerFor(ctx, j.kind);
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const claimable = j.status === 'queued' || (j.status === 'leased' && j.leaseExpiresMicros < now);
  if (!claimable) throw new SenderError(`job is ${j.status}`);
  const lease = BigInt(Math.min(600, Math.max(10, leaseSeconds))) * 1_000_000n;
  ctx.db.calculationJob.id.update({ ...j, status: 'leased', leaseOwnerHex: hex(ctx.sender), leaseExpiresMicros: now + lease, attempts: j.attempts + 1, updatedAt: ctx.timestamp });
});

function heldLease(ctx: Ctx, jobId: string) {
  const j = ctx.db.calculationJob.id.find(jobId);
  if (!j) throw new SenderError('job not found');
  workerFor(ctx, j.kind);
  if (j.status !== 'leased' || j.leaseOwnerHex !== hex(ctx.sender)) throw new SenderError('lease not held by caller');
  if (j.leaseExpiresMicros < ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('lease expired');
  return j;
}

/**
 * Finish a job. The result is accepted only if the level's authoritative output
 * still has the input hash the job was requested against; otherwise it is stale.
 */
export const complete_job = spacetimedb.reducer({ jobId: t.string(), url: t.string(), model: t.string(), label: t.string() }, (ctx, a) => {
  const j = heldLease(ctx, a.jobId);
  const out = ctx.db.modelOutput.id.find(`${j.branchId}:${j.level}`);
  const branch = ctx.db.worldBranch.id.find(j.branchId);
  if (!branch || !out || out.inputHash !== j.inputHash) {
    ctx.db.calculationJob.id.update({ ...j, status: 'stale', error: `state changed since request (rev ${j.revision} → ${branch?.revision ?? '?'}); result discarded`, resultJson: JSON.stringify({ url: a.url }), updatedAt: ctx.timestamp });
    return;
  }
  const payload = JSON.parse(j.payloadJson) as { prompt: string };
  ctx.db.generatedAsset.insert({
    id: j.id, sessionId: j.sessionId, branchId: j.branchId, jobId: j.id, level: j.level, revision: j.revision, inputHash: j.inputHash,
    prompt: payload.prompt, model: a.model.slice(0, 60), url: a.url.slice(0, 500), label: a.label.slice(0, 200) || 'Illustrative concept — not a simulation output', createdAt: ctx.timestamp,
  });
  ctx.db.calculationJob.id.update({ ...j, status: 'done', resultJson: JSON.stringify({ url: a.url }), updatedAt: ctx.timestamp });
});

export const fail_job = spacetimedb.reducer({ jobId: t.string(), error: t.string() }, (ctx, a) => {
  const j = heldLease(ctx, a.jobId);
  ctx.db.calculationJob.id.update({ ...j, status: j.attempts >= 3 ? 'failed' : 'queued', leaseOwnerHex: '', leaseExpiresMicros: 0n, error: a.error.slice(0, 500), updatedAt: ctx.timestamp });
});

/* ------------------------------------------------------------ read authorization
 * Row-level visibility: session data is visible only to that session's members;
 * invites only to owners/editors; jobs also to registered workers of that kind.
 */
const member = (tbl: string) =>
  spacetimedb.clientVisibilityFilter.sql(`SELECT ${tbl}.* FROM ${tbl} JOIN member_acl ON member_acl.session_id = ${tbl}.session_id WHERE member_acl.identity = :sender`);

export const rls_session_member = spacetimedb.clientVisibilityFilter.sql('SELECT * FROM session_member WHERE identity = :sender');
export const rls_world_session = spacetimedb.clientVisibilityFilter.sql('SELECT world_session.* FROM world_session JOIN member_acl ON member_acl.session_id = world_session.id WHERE member_acl.identity = :sender');
export const rls_session_invite = spacetimedb.clientVisibilityFilter.sql("SELECT session_invite.* FROM session_invite JOIN member_acl ON member_acl.session_id = session_invite.session_id WHERE member_acl.identity = :sender AND member_acl.role != 'viewer'");
export const rls_presence = member('presence');
export const rls_presence_pose = member('presence_pose');
export const rls_world_branch = member('world_branch');
export const rls_world_event = member('world_event');
export const rls_command_receipt = member('command_receipt');
export const rls_intervention = member('intervention');
export const rls_simulation_parameter = member('simulation_parameter');
export const rls_model_output = member('model_output');
export const rls_dependency_edge = member('dependency_edge');
export const rls_simulation_clock = member('simulation_clock');
export const rls_generated_asset = member('generated_asset');
export const rls_calculation_job = member('calculation_job');
export const rls_calculation_job_worker = spacetimedb.clientVisibilityFilter.sql('SELECT calculation_job.* FROM calculation_job JOIN worker ON worker.kind = calculation_job.kind WHERE worker.identity = :sender');
export const rls_legacy_branch = spacetimedb.clientVisibilityFilter.sql('SELECT * FROM branch WHERE owner = :sender');

/** One-off migration: rebuild member_acl from session_member. */
export const rebuild_acl = spacetimedb.reducer((ctx) => {
  requireAdmin(ctx);
  for (const m of [...ctx.db.sessionMember.iter()]) syncAcl(ctx, m.id);
});

/** Admin: pause every running clock (energy cleanup). */
export const pause_all_clocks = spacetimedb.reducer((ctx) => {
  requireAdmin(ctx);
  for (const c of [...ctx.db.simulationClock.iter()]) if (c.running) ctx.db.simulationClock.branchId.update({ ...c, running: false, updatedAt: ctx.timestamp });
});

/** Admin can describe the active intervention kinds (sanity check after publish). */
export const describe_kinds = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  if (!interventionKind(kind)) throw new SenderError(`unknown kind ${kind}`);
});
