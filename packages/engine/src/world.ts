import { clone } from './util/clone.js';
import { buildBaseline, buildBaselineContext, type BaselineContext } from './baseline/fromScience.js';
import { WorldGraph } from './graph/worldGraph.js';
import { resolveEntity } from './entities.js';
import { assessFeasibility } from './feasibility.js';
import { interventionKind, INTERVENTION_KINDS, levelOfKind } from './interventions.js';
import { LEVELS, levelForAssumption } from './levels.js';
import type { ScienceBundle } from './science.js';
import type {
  AssumptionSpec,
  BaselineSnapshot,
  Branch,
  BranchEvent,
  CapabilityState,
  Command,
  CommandResult,
  CosmosEntity,
  Intervention,
  LevelId,
  LevelOutput,
  ParamSpec,
  ProjectedBranchState,
} from './types.js';

interface BranchRecord {
  branch: Branch;
  events: BranchEvent[];
}

export interface LevelComparison {
  level: LevelId;
  title: string;
  a: Record<string, number | string | boolean> | null;
  b: Record<string, number | string | boolean> | null;
}

export interface BranchComparison {
  branchAId: string;
  branchBId: string;
  levels: LevelComparison[];
  capabilities: { a: CapabilityState; b: CapabilityState };
  assumptionDiffs: { key: string; a: unknown; b: unknown }[];
  interventionDiff: { onlyA: string[]; onlyB: string[]; changed: string[] };
}

export const COMMAND_ACTIONS = [
  'create_intervention', 'update_intervention', 'remove_intervention', 'set_assumption', 'set_capabilities', 'navigate_to', 'undo', 'redo', 'reset',
] as const;

/** Deterministic intervention id derived from the creating command (stable under replay). */
export function interventionIdFor(commandId: string): string {
  return `iv_${commandId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
}

/**
 * Deterministic simulation world: branches are ordered event logs over an immutable
 * baseline. The same class runs inside the SpacetimeDB module (authoritative) and in
 * the browser (previews / rendering derivations only).
 */
export class CosmosWorld {
  readonly ctx: BaselineContext;
  readonly baseline: BaselineSnapshot;
  readonly graph: WorldGraph;
  private readonly baselineEntities: Record<string, CosmosEntity>;
  private readonly branches = new Map<string, BranchRecord>();
  private readonly memo = new Map<string, LevelOutput>();

  constructor(science: ScienceBundle) {
    this.ctx = buildBaselineContext(science);
    this.baseline = Object.freeze(buildBaseline(this.ctx)) as BaselineSnapshot;
    this.graph = new WorldGraph(this.baseline);
    this.baselineEntities = Object.fromEntries(this.baseline.entities.map((e) => [e.id, e]));
  }

  /* ----------------------------------------------------------- branches */

  hydrateBranch(branch: Omit<Branch, 'baselineId' | 'scenarioTimeSeconds'>, events: BranchEvent[]): void {
    this.branches.set(branch.id, {
      branch: { ...branch, baselineId: this.baseline.id, scenarioTimeSeconds: 0 },
      events: [...events].sort((a, b) => a.seq - b.seq),
    });
  }

  createBranch(id: string, seed = 4242): Branch {
    const existing = this.branches.get(id);
    if (existing) return { ...existing.branch };
    const branch: Branch = { id, baselineId: this.baseline.id, revision: 0, cursor: 0, head: 0, scenarioTimeSeconds: 0, seed };
    this.branches.set(id, { branch, events: [] });
    return { ...branch };
  }

  getBranch(id: string): Branch | undefined {
    const r = this.branches.get(id);
    return r ? { ...r.branch } : undefined;
  }

  /* ----------------------------------------------------------- commands */

  /** Validate a command against the branch's projected state; returns the event to append. */
  validate(command: Command): { ok: true; event: BranchEvent } | { ok: false; errors: string[]; conflict?: CommandResult['conflict'] } {
    const rec = this.branches.get(command.branchId);
    if (!rec) return { ok: false, errors: [`Branch ${command.branchId} not found`] };
    if (!command.commandId?.trim()) return { ok: false, errors: ['commandId is required'] };
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) return { ok: false, errors: ['expectedRevision must be a non-negative integer'] };
    if (command.expectedRevision !== rec.branch.revision) {
      return { ok: false, errors: [`Stale revision: expected ${command.expectedRevision}, latest ${rec.branch.revision}`], conflict: { latestRevision: rec.branch.revision, message: 'Branch changed; refresh and retry.' } };
    }
    const p = command.parameters ?? {};
    if (typeof p !== 'object') return { ok: false, errors: ['parameters must be an object'] };
    const state = this.replay(rec, rec.branch.cursor);
    const event: BranchEvent = { commandId: command.commandId, seq: rec.branch.cursor + 1, action: command.action, targetId: command.targetId ?? '', parameters: clone(p) };
    switch (command.action) {
      case 'set_capabilities': {
        const c = p.capabilities as Partial<CapabilityState> | undefined;
        if (!c) return { ok: false, errors: ['capabilities object required'] };
        if ((c.kardashevLevel !== undefined && ![1, 2, 3].includes(c.kardashevLevel)) || (c.barrowLevel !== undefined && ![1, 2, 3, 4, 5, 6].includes(c.barrowLevel))) {
          return { ok: false, errors: ['Kardashev must be 1–3 and Barrow 1–6'] };
        }
        return { ok: true, event };
      }
      case 'set_assumption': {
        const key = String(p.key ?? '');
        const spec = levelForAssumption(this.ctx, key)?.assumptions(this.ctx).find((a) => a.key === key);
        if (!spec) return { ok: false, errors: [`Unknown assumption "${key}"`] };
        const err = checkValue(spec, p.value);
        return err ? { ok: false, errors: [err] } : { ok: true, event: { ...event, targetId: key } };
      }
      case 'navigate_to':
        return { ok: true, event };
      case 'create_intervention': {
        const kind = interventionKind(String(p.kind ?? ''));
        if (!kind) return { ok: false, errors: [`Unknown intervention kind "${p.kind}". Available: ${INTERVENTION_KINDS.map((k) => k.kind).join(', ')}`] };
        const given = this.canonicalize((event.parameters.params as Record<string, unknown>) ?? {});
        event.parameters.params = given;
        const defaults = Object.fromEntries(kind.params(this.ctx).map((s) => [s.key, s.defaultValue]));
        const lvl = levelOfKind(kind, { ...defaults, ...given }, this.ctx);
        const proposed: Intervention = { id: 'proposed', level: lvl, kind: kind.kind, label: kind.label, params: { ...defaults, ...given }, createdSeq: 1e9, updatedSeq: 1e9 };
        const errs0 = checkParams(kind.params(this.ctx), given);
        if (errs0.length) return { ok: false, errors: errs0 };
        const feas = assessFeasibility(this.ctx, state.capabilities, [...state.interventions.filter((i) => !(kind.singleton && i.kind === kind.kind)), proposed], proposed);
        if (!feas.ok) return { ok: false, errors: [`Not possible for this civilisation: ${feas.reasons.join(' ')}${feas.suggestion ? ` ${feas.suggestion}` : ''}`] };
        if (kind.singleton && state.interventions.some((i) => i.kind === kind.kind)) {
          const existing = state.interventions.find((i) => i.kind === kind.kind)!;
          return { ok: false, errors: [`A ${kind.label} already exists (${existing.id}); update it instead.`] };
        }
        const errs = checkParams(kind.params(this.ctx), given);
        if (errs.length) return { ok: false, errors: errs };
        return { ok: true, event: { ...event, targetId: interventionIdFor(command.commandId) } };
      }
      case 'update_intervention': {
        const id = String(p.id ?? command.targetId ?? '');
        const iv = state.interventions.find((i) => i.id === id);
        if (!iv) return { ok: false, errors: [`No active intervention "${id}"`] };
        const kind = interventionKind(iv.kind)!;
        const given = this.canonicalize((event.parameters.params as Record<string, unknown>) ?? {});
        event.parameters.params = given;
        const lvl = levelOfKind(kind, { ...iv.params, ...given }, this.ctx);
        const errs0 = checkParams(kind.params(this.ctx), given);
        if (errs0.length) return { ok: false, errors: errs0 };
        const updated: Intervention = { ...iv, level: lvl, params: { ...iv.params, ...given } };
        const feas = assessFeasibility(this.ctx, state.capabilities, state.interventions.map((i) => (i.id === iv.id ? updated : i)), updated);
        if (!feas.ok) return { ok: false, errors: [`Not possible for this civilisation: ${feas.reasons.join(' ')}${feas.suggestion ? ` ${feas.suggestion}` : ''}`] };
        const errs = checkParams(kind.params(this.ctx), given);
        if (errs.length) return { ok: false, errors: errs };
        return { ok: true, event: { ...event, targetId: id } };
      }
      case 'remove_intervention': {
        const id = String(p.id ?? command.targetId ?? '');
        if (!state.interventions.some((i) => i.id === id)) return { ok: false, errors: [`No active intervention "${id}"`] };
        return { ok: true, event: { ...event, targetId: id } };
      }
      default:
        return { ok: false, errors: [`Unsupported action "${command.action}"`] };
    }
  }

  execute(command: Command): CommandResult {
    const rec = this.branches.get(command.branchId);
    if (!rec) return { ok: false, errors: [`Branch ${command.branchId} not found`] };
    if (rec.events.some((e) => e.commandId === command.commandId)) return { ok: true, duplicate: true, revision: rec.branch.revision };
    if (command.action === 'undo') return this.undo(command.branchId, command.expectedRevision);
    if (command.action === 'redo') return this.redo(command.branchId, command.expectedRevision);
    if (command.action === 'reset') return this.reset(command.branchId, command.expectedRevision);
    const v = this.validate(command);
    if (!v.ok) return { ok: false, errors: v.errors, conflict: v.conflict };
    rec.events = rec.events.slice(0, rec.branch.cursor);
    rec.events.push(v.event);
    rec.branch.cursor = v.event.seq;
    rec.branch.head = v.event.seq;
    rec.branch.revision += 1;
    return { ok: true, revision: rec.branch.revision, event: v.event };
  }

  undo(branchId: string, expectedRevision: number): CommandResult {
    const rec = this.branches.get(branchId);
    if (!rec) return { ok: false, errors: ['Branch not found'] };
    if (expectedRevision !== rec.branch.revision) return stale(rec.branch.revision);
    if (rec.branch.cursor <= 0) return { ok: false, errors: ['Nothing to undo'] };
    rec.branch.cursor -= 1;
    rec.branch.revision += 1;
    return { ok: true, revision: rec.branch.revision };
  }

  redo(branchId: string, expectedRevision: number): CommandResult {
    const rec = this.branches.get(branchId);
    if (!rec) return { ok: false, errors: ['Branch not found'] };
    if (expectedRevision !== rec.branch.revision) return stale(rec.branch.revision);
    if (rec.branch.cursor >= rec.branch.head) return { ok: false, errors: ['Nothing to redo'] };
    rec.branch.cursor += 1;
    rec.branch.revision += 1;
    return { ok: true, revision: rec.branch.revision };
  }

  reset(branchId: string, expectedRevision: number): CommandResult {
    const rec = this.branches.get(branchId);
    if (!rec) return { ok: false, errors: ['Branch not found'] };
    if (expectedRevision !== rec.branch.revision) return stale(rec.branch.revision);
    rec.branch.cursor = 0;
    rec.branch.revision += 1;
    return { ok: true, revision: rec.branch.revision };
  }

  /* --------------------------------------------------------- projection */

  private replay(rec: BranchRecord, cursor: number) {
    let capabilities: CapabilityState = { kardashevLevel: 1, barrowLevel: 1 };
    const assumptions: Record<string, unknown> = {};
    const map = new Map<string, Intervention>();
    for (const e of rec.events.slice(0, cursor)) {
      const p = e.parameters;
      if (e.action === 'set_capabilities') capabilities = { ...capabilities, ...(p.capabilities as Partial<CapabilityState>) };
      else if (e.action === 'set_assumption') assumptions[String(p.key)] = p.value;
      else if (e.action === 'create_intervention') {
        const kind = interventionKind(String(p.kind));
        if (!kind) continue;
        const defaults = Object.fromEntries(kind.params(this.ctx).map((s) => [s.key, s.defaultValue]));
        const count = [...map.values()].filter((i) => i.kind === kind.kind).length;
        const params = { ...defaults, ...((p.params as Record<string, unknown>) ?? {}) };
        map.set(e.targetId, {
          id: e.targetId, level: levelOfKind(kind, params, this.ctx), kind: kind.kind, label: String(p.label ?? this.defaultLabel(kind.kind, kind.label, params, count)),
          params, createdSeq: e.seq, updatedSeq: e.seq,
        });
      } else if (e.action === 'update_intervention') {
        const iv = map.get(e.targetId);
        if (iv) {
          const params = { ...iv.params, ...((p.params as Record<string, unknown>) ?? {}) };
          const kind = interventionKind(iv.kind);
          map.set(iv.id, { ...iv, level: kind ? levelOfKind(kind, params, this.ctx) : iv.level, label: typeof p.label === 'string' ? p.label : iv.label, params, updatedSeq: e.seq });
        }
      } else if (e.action === 'remove_intervention') map.delete(e.targetId);
    }
    return { capabilities, assumptions, interventions: [...map.values()].sort((a, b) => a.createdSeq - b.createdSeq) };
  }

  project(branchId: string, clockSeconds = 0): ProjectedBranchState | undefined {
    const rec = this.branches.get(branchId);
    if (!rec) return undefined;
    const { capabilities, assumptions, interventions } = this.replay(rec, rec.branch.cursor);
    const outputs: Partial<Record<LevelId, LevelOutput>> = {};
    for (const def of Object.values(LEVELS)) {
      const ivs = interventions.filter((i) => i.level === def.level);
      if (!ivs.length) continue;
      outputs[def.level] = this.computeLevel(def.level, ivs, assumptions, clockSeconds, rec.branch.seed);
    }
    return {
      branch: { ...rec.branch, scenarioTimeSeconds: clockSeconds },
      entities: this.baselineEntities,
      relationships: this.baseline.relationships,
      capabilities,
      assumptions,
      interventions,
      outputs,
      clockSeconds,
      events: rec.events.map((e) => ({ ...e })),
    };
  }

  computeLevel(level: LevelId, interventions: Intervention[], assumptions: Record<string, unknown>, clockSeconds: number, seed: number): LevelOutput {
    const def = LEVELS[level];
    const relevant = Object.fromEntries(def.assumptions(this.ctx).map((a) => [a.key, assumptions[a.key]]).filter(([, v]) => v !== undefined));
    const key = `${this.baseline.id}|${def.modelId}@${def.modelVersion}|${seed}|${stableJson(interventions.map((i) => [i.id, i.kind, i.params]))}|${stableJson(relevant)}|${def.timeDependent ? Math.round(clockSeconds) : ''}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const r = def.compute({ ctx: this.ctx, interventions, assumptions: relevant, clockSeconds, seed });
    const out: LevelOutput = { ...r, level, modelId: def.modelId, modelVersion: def.modelVersion, assumptions: def.modelAssumptions, inputHash: fnv(key) };
    if (this.memo.size > 200) this.memo.delete(this.memo.keys().next().value as string);
    this.memo.set(key, out);
    return out;
  }

  /** Compute a level with a hypothetical intervention change (preview only, never committed). */
  preview(branchId: string, change: { create?: { kind: string; params: Record<string, unknown> }; update?: { id: string; params: Record<string, unknown> } }, clockSeconds = 0): { ok: true; output: LevelOutput } | { ok: false; errors: string[] } {
    const state = this.project(branchId, clockSeconds);
    if (!state) return { ok: false, errors: ['Branch not found'] };
    let ivs = state.interventions;
    let level: LevelId | undefined;
    if (change.create) {
      const kind = interventionKind(change.create.kind);
      if (!kind) return { ok: false, errors: ['Unknown kind'] };
      const errs = checkParams(kind.params(this.ctx), change.create.params);
      if (errs.length) return { ok: false, errors: errs };
      const defaults = Object.fromEntries(kind.params(this.ctx).map((s) => [s.key, s.defaultValue]));
      level = levelOfKind(kind, { ...defaults, ...change.create.params }, this.ctx);
      ivs = [...ivs.filter((i) => !(kind.singleton && i.kind === kind.kind)), { id: 'preview', level, kind: kind.kind, label: kind.label, params: { ...defaults, ...change.create.params }, createdSeq: 1e9, updatedSeq: 1e9 }];
    } else if (change.update) {
      const iv = ivs.find((i) => i.id === change.update!.id);
      if (!iv) return { ok: false, errors: ['No such intervention'] };
      const errs = checkParams(interventionKind(iv.kind)!.params(this.ctx), change.update.params);
      if (errs.length) return { ok: false, errors: errs };
      const kind = interventionKind(iv.kind)!;
      level = levelOfKind(kind, { ...iv.params, ...change.update.params }, this.ctx);
      ivs = ivs.map((i) => (i.id === iv.id ? { ...i, level: level!, params: { ...i.params, ...change.update!.params } } : i));
    }
    if (!level) return { ok: false, errors: ['Nothing to preview'] };
    return { ok: true, output: this.computeLevel(level, ivs.filter((i) => i.level === level), state.assumptions, clockSeconds, state.branch.seed) };
  }

  compare(branchAId: string, branchBId: string, clockSeconds = 0): BranchComparison | undefined {
    const a = this.project(branchAId, clockSeconds);
    const b = this.project(branchBId, clockSeconds);
    if (!a || !b) return undefined;
    const levels: LevelComparison[] = Object.values(LEVELS).map((def) => ({ level: def.level, title: def.title, a: a.outputs[def.level]?.summary ?? null, b: b.outputs[def.level]?.summary ?? null }));
    const keys = new Set([...Object.keys(a.assumptions), ...Object.keys(b.assumptions)]);
    const assumptionDiffs = [...keys].filter((k) => JSON.stringify(a.assumptions[k]) !== JSON.stringify(b.assumptions[k])).map((k) => ({ key: k, a: a.assumptions[k], b: b.assumptions[k] }));
    const ia = new Map(a.interventions.map((i) => [i.id, i]));
    const ib = new Map(b.interventions.map((i) => [i.id, i]));
    return {
      branchAId, branchBId, levels, capabilities: { a: a.capabilities, b: b.capabilities }, assumptionDiffs,
      interventionDiff: {
        onlyA: [...ia.keys()].filter((k) => !ib.has(k)).map((k) => ia.get(k)!.label),
        onlyB: [...ib.keys()].filter((k) => !ia.has(k)).map((k) => ib.get(k)!.label),
        changed: [...ia.keys()].filter((k) => ib.has(k) && stableJson(ia.get(k)!.params) !== stableJson(ib.get(k)!.params)).map((k) => ia.get(k)!.label),
      },
    };
  }

  /** Replace free-text entity references (e.g. hostId "Vega") with canonical ids. */
  private canonicalize(params: Record<string, unknown>): Record<string, unknown> {
    let out = params;
    if (typeof params.hostId === 'string') {
      const e = resolveEntity(this.ctx.science, params.hostId);
      if (e) out = { ...out, hostId: e.id };
    }
    if (typeof params.originStarId === 'string') {
      const e = resolveEntity(this.ctx.science, params.originStarId);
      if (e && e.kind === 'star') out = { ...out, originStarId: e.id === 'body.sun' ? 'star.sol' : e.id };
    }
    return out;
  }

  private defaultLabel(kind: string, base: string, params: Record<string, unknown>, count: number): string {
    if (kind === 'build.structure') {
      const host = resolveEntity(this.ctx.science, String(params.hostId ?? ''));
      const type = String(params.type ?? 'structure').replace(/_/g, ' ');
      return `${type.charAt(0).toUpperCase()}${type.slice(1)} · ${host?.name ?? params.hostId}`;
    }
    return `${base}${count ? ` ${count + 1}` : ''}`;
  }

  /* ----------------------------------------------------------- metadata */

  assumptionSpecs(level: LevelId): AssumptionSpec[] {
    return LEVELS[level].assumptions(this.ctx);
  }

  kindParams(kind: string): ParamSpec[] {
    return interventionKind(kind)?.params(this.ctx) ?? [];
  }
}

export function checkValue(spec: ParamSpec | AssumptionSpec, value: unknown, label = spec.label): string | null {
  if (spec.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number`;
    if (spec.min !== undefined && value < spec.min) return `${label} must be ≥ ${spec.min}${spec.unit ? ` ${spec.unit}` : ''}`;
    if (spec.max !== undefined && value > spec.max) return `${label} must be ≤ ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}`;
    return null;
  }
  if (spec.kind === 'boolean') return typeof value === 'boolean' ? null : `${label} must be true or false`;
  if (spec.kind === 'choice') return spec.choices?.some((c) => c.value === value) ? null : `${label} must be one of ${spec.choices?.map((c) => c.value).join(', ')}`;
  if (spec.kind === 'entity') return typeof value === 'string' && value.trim() ? null : `${label} must name a body or star`;
  if (spec.kind === 'text') return typeof value === 'string' ? null : `${label} must be text`;
  return null;
}

function checkParams(specs: ParamSpec[], params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const s = specs.find((x) => x.key === k);
    if (!s) {
      errors.push(`Unknown parameter "${k}" (allowed: ${specs.map((x) => x.key).join(', ')})`);
      continue;
    }
    const e = checkValue(s, v) ?? s.validate?.(v) ?? null;
    if (e) errors.push(e);
  }
  return errors;
}


function stale(latest: number): CommandResult {
  return { ok: false, conflict: { latestRevision: latest, message: `Stale revision; latest is ${latest}` }, errors: ['Stale revision'] };
}

/**
 * Authoritative-storage form of a level view: arrays longer than `maxArray` (render
 * samples, per-star arrival tables) are replaced by `{ omitted: length }`. Clients
 * re-derive them with the same deterministic model and check the output's inputHash.
 */
export function compactView(v: unknown, maxArray = 300): unknown {
  if (Array.isArray(v)) return v.length > maxArray ? { omitted: v.length } : v.map((x) => compactView(x, maxArray));
  if (ArrayBuffer.isView(v)) return { omitted: (v as unknown as { length: number }).length };
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compactView(x, maxArray)]));
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}

export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
