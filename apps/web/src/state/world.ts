import {
  CosmosWorld,
  LEVELS,
  interventionKind,
  type CapabilityState,
  type Intervention,
  type LevelId,
  type LevelOutput,
  type ModelNode,
  type ScienceBundle,
} from '@cosmos/engine';
import { create } from 'zustand';
import { reconnectSpacetime, subscribeMembership, subscribeSession, type SubscriptionHandle } from '../data/spacetime';
import type { DbConnection } from '../module_bindings';
import { useUi } from './ui';

/**
 * Client view of the authoritative world.
 *
 * Live mode: SpacetimeDB owns every piece of simulation state. This store only
 * mirrors subscribed rows, submits validated commands, and re-derives bulky render
 * geometry with the same deterministic engine (checked against the server's
 * inputHash). Offline mode runs the identical engine locally so the app still works
 * without a connection; it is labelled as such.
 */

export type Source = 'ui' | 'voice' | 'chat' | 'test';

export interface ServerOutput {
  level: LevelId;
  modelId: string;
  modelVersion: string;
  inputHash: string;
  revision: number;
  clockSeconds: number;
  summary: Record<string, number | string | boolean>;
  view: unknown;
  nodes: ModelNode[];
  warnings: string[];
  assumptions: string[];
}

export interface RenderOutput {
  output: LevelOutput;
  /** Local re-derivation matches the authoritative inputHash. */
  verified: boolean;
}

export interface BranchInfo {
  id: string;
  name: string;
  revision: number;
  cursor: number;
  head: number;
  seed: number;
  parentBranchId: string;
  kardashevLevel: number;
  barrowLevel: number;
  archived: boolean;
  updatedAt: number;
}

export interface Receipt {
  commandId: string;
  action: string;
  status: 'applied' | 'rejected' | 'conflict' | 'timeout' | 'offline';
  message: string;
  revision: number;
  latestRevision: number;
  source: string;
  senderHex: string;
  createdAt: number;
  /** Set by createIntervention when applied. */
  interventionId?: string;
}

export interface EventInfo {
  seq: number;
  action: string;
  targetId: string;
  source: string;
  authorHex: string;
  parameters: Record<string, unknown>;
  createdAt: number;
}

export interface Member {
  identityHex: string;
  displayName: string;
  role: string;
  online: boolean;
  branchId: string;
  stop: string;
  selectedId: string;
  following: boolean;
}

export interface Pose {
  identityHex: string;
  displayName: string;
  color: string;
  stop: string;
  position: [number, number, number];
  target: [number, number, number];
  updatedAt: number;
  online: boolean;
}

export interface JobInfo {
  id: string;
  branchId: string;
  level: string;
  status: string;
  revision: number;
  inputHash: string;
  prompt: string;
  error: string;
  createdAt: number;
}

export interface AssetInfo {
  id: string;
  branchId: string;
  level: string;
  revision: number;
  inputHash: string;
  url: string;
  prompt: string;
  model: string;
  label: string;
  createdAt: number;
  /** The level output changed since this render was made. */
  stale: boolean;
}

export interface ClockState {
  running: boolean;
  rate: number;
  simSeconds: number;
  updatedAtMs: number;
  revision: number;
}

export interface LevelComparisonRow {
  level: LevelId;
  title: string;
  a: Record<string, number | string | boolean> | null;
  b: Record<string, number | string | boolean> | null;
}

export interface Comparison {
  aId: string;
  bId: string;
  levels: LevelComparisonRow[];
  assumptionDiffs: { key: string; a: unknown; b: unknown }[];
  interventionDiff: { onlyA: string[]; onlyB: string[]; changed: string[] };
}

interface Preview {
  key: string;
  output?: LevelOutput;
  errors?: string[];
}

export interface CmdOpts {
  source?: Source;
  label?: string;
}

interface WorldState {
  world: CosmosWorld | null;
  conn: DbConnection | null;
  identityHex: string | null;
  mode: 'live' | 'offline';
  status: 'connecting' | 'live' | 'reconnecting' | 'offline';
  sessionId: string;
  sessionName: string;
  mainBranchId: string;
  presenterHex: string;
  role: 'owner' | 'editor' | 'viewer';
  invites: { code: string; role: string }[];
  members: Member[];
  /** Other explorers' live camera poses (multiplayer). */
  poses: Pose[];
  displayName: string;
  setDisplayName: (name: string) => void;
  reportPose: (stop: string, position: [number, number, number], target: [number, number, number]) => void;
  /** Raise the branch capability to the civilisation the user is in (any route: dock, rail, follow, jump). */
  ensureCivCapability: (level: LevelId | null) => Promise<void>;
  branchId: string;
  branches: BranchInfo[];
  interventions: Intervention[];
  assumptions: Record<string, unknown>;
  capabilities: CapabilityState;
  outputs: Partial<Record<LevelId, ServerOutput>>;
  render: Partial<Record<LevelId, RenderOutput>>;
  edges: { level: string; from: string; to: string }[];
  clock: ClockState;
  events: EventInfo[];
  receipts: Receipt[];
  jobs: JobInfo[];
  assets: AssetInfo[];
  previews: Partial<Record<LevelId, Preview>>;
  compareId: string | null;
  comparison: Comparison | null;
  following: boolean;
  pending: number;
  lastError: string | null;

  init: (bundle: ScienceBundle, conn: DbConnection | null, identityHex: string | null) => Promise<void>;
  submit: (action: string, parameters: Record<string, unknown>, opts?: CmdOpts & { targetId?: string }) => Promise<Receipt>;
  createIntervention: (kind: string, params: Record<string, unknown>, opts?: CmdOpts) => Promise<Receipt>;
  updateIntervention: (id: string, params: Record<string, unknown>, opts?: CmdOpts) => Promise<Receipt>;
  removeIntervention: (id: string, opts?: CmdOpts) => Promise<Receipt>;
  setAssumption: (key: string, value: unknown, opts?: CmdOpts) => Promise<Receipt>;
  setCapabilities: (caps: Partial<CapabilityState>, opts?: CmdOpts) => Promise<Receipt>;
  undo: (opts?: CmdOpts) => Promise<Receipt>;
  redo: (opts?: CmdOpts) => Promise<Receipt>;
  reset: (opts?: CmdOpts) => Promise<Receipt>;
  clockControl: (action: 'play' | 'pause' | 'set_rate' | 'seek', value?: number, opts?: CmdOpts) => Promise<Receipt>;
  fork: (name?: string) => Promise<string | null>;
  switchTo: (id: string) => void;
  rename: (name: string) => void;
  compareWith: (id: string | null) => void;
  preview: (level: LevelId, change: { create?: { kind: string; params: Record<string, unknown> }; update?: { id: string; params: Record<string, unknown> } } | null) => void;
  requestImagine: (level: LevelId, style?: string) => Promise<{ ok: boolean; message: string; jobId?: string }>;
  joinSession: (code: string, displayName?: string) => Promise<{ ok: boolean; message: string }>;
  newSession: (name?: string) => Promise<void>;
  setPresenter: (on: boolean) => void;
  setFollowing: (on: boolean) => void;
  reportPresence: (stop: string, selectedId: string) => void;
  /** Interpolated simulation time for smooth animation between server ticks. */
  simNow: () => number;
}

const LEVEL_IDS = Object.keys(LEVELS) as LevelId[];

/** Stable, distinct colour per explorer identity. */
export function colorFor(hex: string): string {
  let h = 0;
  for (let i = 0; i < hex.length; i++) h = (h * 31 + hex.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = (n: number) => {
    const k = (n + hue / 30) % 12;
    const v = 0.62 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${c(0)}${c(8)}${c(4)}`;
}
const short = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const cmdId = () => `c-${short()}`;
const SESSION_KEY = 'cosmos.session';
const NAME_KEY = 'cosmos.displayName';

const ms = (ts: unknown): number => {
  const micros = (ts as { microsSinceUnixEpoch?: bigint } | undefined)?.microsSinceUnixEpoch;
  return micros !== undefined ? Number(micros / 1000n) : Date.now();
};
const json = <T,>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/* Pending live commands awaiting their receipt row (resent on reconnect: ids are idempotent). */
interface PendingCmd {
  resolve: (r: Receipt) => void;
  send: () => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}
const pendingCmds = new Map<string, PendingCmd>();
let sessionSub: SubscriptionHandle | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
let offlineClock: ReturnType<typeof setInterval> | null = null;
const lastRevision = new Map<string, number>();
/** In-flight capability raise; commands wait for it so they don't race the revision. */
let capsRaise: Promise<void> = Promise.resolve();

export const useWorld = create<WorldState>((set, get) => {
  /* ------------------------------------------------------------ derivations */

  const derive = (partial: Partial<WorldState>) => {
    const s = { ...get(), ...partial };
    const { world } = s;
    const render: Partial<Record<LevelId, RenderOutput>> = {};
    const branch = s.branches.find((b) => b.id === s.branchId);
    if (world && branch) {
      for (const level of LEVEL_IDS) {
        const srv = s.outputs[level];
        if (!srv) continue;
        const ivs = s.interventions.filter((i) => i.level === level);
        try {
          const out = world.computeLevel(level, ivs, s.assumptions, srv.clockSeconds, branch.seed);
          render[level] = { output: out, verified: out.inputHash === srv.inputHash };
        } catch {
          /* render derivation failure leaves the server summary visible */
        }
      }
    }
    return { ...partial, render, comparison: computeComparison(s) };
  };

  const computeComparison = (s: WorldState): Comparison | null => {
    if (!s.compareId || !s.conn || s.mode === 'offline') {
      if (s.compareId && s.world && s.mode === 'offline') {
        const c = s.world.compare(s.branchId, s.compareId, s.clock.simSeconds);
        return c ? { aId: c.branchAId, bId: c.branchBId, levels: c.levels, assumptionDiffs: c.assumptionDiffs, interventionDiff: c.interventionDiff } : null;
      }
      return null;
    }
    const conn = s.conn;
    const outs = (id: string) => Object.fromEntries([...conn.db.modelOutput.iter()].filter((o) => o.branchId === id).map((o) => [o.level, json(o.summaryJson, {})]));
    const params = (id: string) => Object.fromEntries([...conn.db.simulationParameter.iter()].filter((p) => p.branchId === id).map((p) => [p.key, json(p.valueJson, null as unknown)]));
    const ivs = (id: string) => new Map([...conn.db.intervention.iter()].filter((i) => i.branchId === id).map((i) => [i.interventionId, i]));
    const oa = outs(s.branchId), ob = outs(s.compareId);
    const pa = params(s.branchId), pb = params(s.compareId);
    const ia = ivs(s.branchId), ib = ivs(s.compareId);
    const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
    return {
      aId: s.branchId,
      bId: s.compareId,
      levels: LEVEL_IDS.map((l) => ({ level: l, title: LEVELS[l].title, a: oa[l] ?? null, b: ob[l] ?? null })),
      assumptionDiffs: [...keys].filter((k) => JSON.stringify(pa[k]) !== JSON.stringify(pb[k])).map((k) => ({ key: k, a: pa[k], b: pb[k] })),
      interventionDiff: {
        onlyA: [...ia.keys()].filter((k) => !ib.has(k)).map((k) => ia.get(k)!.label),
        onlyB: [...ib.keys()].filter((k) => !ia.has(k)).map((k) => ib.get(k)!.label),
        changed: [...ia.keys()].filter((k) => ib.has(k) && ia.get(k)!.paramsJson !== ib.get(k)!.paramsJson).map((k) => ia.get(k)!.label),
      },
    };
  };

  /* ------------------------------------------------------------ live mirror */

  const refresh = () => {
    const { conn, sessionId, identityHex } = get();
    if (!conn || !sessionId) return;
    const db = conn.db;
    const session = db.worldSession.id.find(sessionId);
    const me = [...db.sessionMember.iter()].find((m) => m.sessionId === sessionId && m.identity.toHexString() === identityHex);
    const branches: BranchInfo[] = [...db.worldBranch.iter()]
      .filter((b) => b.sessionId === sessionId)
      .map((b) => ({
        id: b.id, name: b.name, revision: b.revision, cursor: b.cursor, head: b.head, seed: b.seed, parentBranchId: b.parentBranchId,
        kardashevLevel: b.kardashevLevel, barrowLevel: b.barrowLevel, archived: b.archived, updatedAt: ms(b.updatedAt),
      }))
      .sort((a, b) => (a.id === session?.mainBranchId ? -1 : b.id === session?.mainBranchId ? 1 : b.updatedAt - a.updatedAt));
    let branchId = get().branchId;
    if (!branches.some((b) => b.id === branchId)) branchId = session?.mainBranchId ?? branches[0]?.id ?? '';
    const branch = branches.find((b) => b.id === branchId);
    const interventions: Intervention[] = [...db.intervention.iter()]
      .filter((i) => i.branchId === branchId)
      .map((i) => ({ id: i.interventionId, level: i.level as LevelId, kind: i.kind, label: i.label, params: json(i.paramsJson, {}), createdSeq: i.createdSeq, updatedSeq: i.updatedSeq }))
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const assumptions = Object.fromEntries([...db.simulationParameter.iter()].filter((p) => p.branchId === branchId).map((p) => [p.key, json(p.valueJson, null as unknown)]));
    const outputs: Partial<Record<LevelId, ServerOutput>> = {};
    for (const o of db.modelOutput.iter()) {
      if (o.branchId !== branchId) continue;
      outputs[o.level as LevelId] = {
        level: o.level as LevelId, modelId: o.modelId, modelVersion: o.modelVersion, inputHash: o.inputHash, revision: o.revision, clockSeconds: o.clockSeconds,
        summary: json(o.summaryJson, {}), view: json(o.viewJson, null), nodes: json(o.nodesJson, []), warnings: json(o.warningsJson, []), assumptions: json(o.assumptionsJson, []),
      };
    }
    const c = db.simulationClock.branchId.find(branchId);
    const clock: ClockState = c ? { running: c.running, rate: c.rate, simSeconds: c.simSeconds, updatedAtMs: Date.now(), revision: c.revision } : get().clock;
    const events: EventInfo[] = [...db.worldEvent.iter()]
      .filter((e) => e.branchId === branchId)
      .map((e) => ({ seq: e.seq, action: e.action, targetId: e.targetId, source: e.source, authorHex: e.author.toHexString(), parameters: json(e.parametersJson, {}), createdAt: ms(e.createdAt) }))
      .sort((a, b) => a.seq - b.seq);
    const receipts: Receipt[] = [...db.commandReceipt.iter()]
      .filter((r) => r.sessionId === sessionId)
      .map((r) => toReceipt(r))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60);
    const members: Member[] = [...db.presence.iter()]
      .filter((p) => p.sessionId === sessionId)
      .map((p) => ({ identityHex: p.identity.toHexString(), displayName: p.displayName, role: p.role, online: p.online, branchId: p.branchId, stop: p.stop, selectedId: p.selectedId, following: p.following }));
    const poses: Pose[] = [...db.presencePose.iter()]
      .filter((p) => p.sessionId === sessionId && p.identity.toHexString() !== identityHex)
      .map((p) => {
        const hexId = p.identity.toHexString();
        const m = members.find((x) => x.identityHex === hexId);
        return { identityHex: hexId, displayName: m?.displayName ?? 'Explorer', color: p.color, stop: p.stop, position: [p.px, p.py, p.pz], target: [p.tx, p.ty, p.tz], updatedAt: ms(p.updatedAt), online: m?.online ?? false };
      });
    const assetsRaw = [...db.generatedAsset.iter()].filter((a) => a.sessionId === sessionId);
    const assets: AssetInfo[] = assetsRaw
      .map((a) => {
        const cur = db.modelOutput.id.find(`${a.branchId}:${a.level}`);
        return { id: a.id, branchId: a.branchId, level: a.level, revision: a.revision, inputHash: a.inputHash, url: a.url, prompt: a.prompt, model: a.model, label: a.label, createdAt: ms(a.createdAt), stale: !cur || cur.inputHash !== a.inputHash };
      })
      .sort((x, y) => y.createdAt - x.createdAt);
    const jobs: JobInfo[] = [...db.calculationJob.iter()]
      .filter((j) => j.sessionId === sessionId)
      .map((j) => ({ id: j.id, branchId: j.branchId, level: j.level, status: j.status, revision: j.revision, inputHash: j.inputHash, prompt: json<{ prompt?: string }>(j.payloadJson, {}).prompt ?? '', error: j.error, createdAt: ms(j.createdAt) }))
      .sort((x, y) => y.createdAt - x.createdAt);
    const edges = [...db.dependencyEdge.iter()].filter((e) => e.branchId === branchId).map((e) => ({ level: e.level, from: e.fromNode, to: e.toNode }));
    const invites = [...db.sessionInvite.iter()].filter((i) => i.sessionId === sessionId).map((i) => ({ code: i.code, role: i.role }));
    // Fire build animations for levels whose authoritative output changed.
    const prev = get().outputs;
    for (const l of LEVEL_IDS) if (outputs[l] && prev[l]?.inputHash !== outputs[l]!.inputHash && !LEVELS[l].timeDependent) useUi.getState().pulse(l);
    set(derive({
      sessionName: session?.name ?? '', mainBranchId: session?.mainBranchId ?? '', presenterHex: session?.presenterHex ?? '',
      role: (me?.role as WorldState['role']) ?? 'viewer', invites, members, poses, branchId, branches, interventions, assumptions,
      capabilities: { kardashevLevel: (branch?.kardashevLevel ?? 1) as 1, barrowLevel: (branch?.barrowLevel ?? 1) as 1 },
      outputs, edges, clock, events, receipts, jobs, assets,
    }));
    followPresenter();
  };

  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 30);
  };

  const toReceipt = (r: { commandId: string; action: string; status: string; message: string; revision: number; latestRevision: number; source: string; sender: { toHexString(): string }; createdAt: unknown }): Receipt => ({
    commandId: r.commandId, action: r.action, status: r.status as Receipt['status'], message: r.message, revision: r.revision, latestRevision: r.latestRevision,
    source: r.source, senderHex: r.sender.toHexString(), createdAt: ms(r.createdAt),
  });

  const onReceipt = (r: Parameters<typeof toReceipt>[0] & { branchId: string }) => {
    const p = pendingCmds.get(r.commandId);
    if (r.status === 'applied') lastRevision.set(r.branchId, Math.max(lastRevision.get(r.branchId) ?? 0, r.revision));
    if (p) {
      clearTimeout(p.timer);
      pendingCmds.delete(r.commandId);
      set({ pending: pendingCmds.size });
      const rec = toReceipt(r);
      if (rec.status === 'applied' && rec.action === 'create_intervention') rec.interventionId = rec.message.split(' ')[1];
      if (rec.status !== 'applied') set({ lastError: rec.message });
      // Let the same-transaction row updates land in the store first.
      refresh();
      p.resolve(rec);
    } else scheduleRefresh();
  };

  const followPresenter = () => {
    const { following, presenterHex, identityHex, members, branchId } = get();
    if (!following || !presenterHex || presenterHex === identityHex) return;
    const p = members.find((m) => m.identityHex === presenterHex);
    if (!p) return;
    if (p.branchId && p.branchId !== branchId) get().switchTo(p.branchId);
    const ui = useUi.getState();
    if (p.stop && p.stop !== ui.stop && !ui.transition) ui.goTo(p.stop as never);
    if (p.selectedId !== (ui.selection?.id ?? '')) ui.select(p.selectedId ? { id: p.selectedId, kind: 'remote', label: p.selectedId } : null);
  };

  const attach = (conn: DbConnection) => {
    const db = conn.db as unknown as Record<string, { onInsert(cb: (...a: unknown[]) => void): void; onUpdate?(cb: (...a: unknown[]) => void): void; onDelete(cb: (...a: unknown[]) => void): void }>;
    for (const t of ['worldSession', 'sessionMember', 'sessionInvite', 'presence', 'presencePose', 'worldBranch', 'worldEvent', 'intervention', 'simulationParameter', 'modelOutput', 'dependencyEdge', 'simulationClock', 'calculationJob', 'generatedAsset']) {
      db[t]!.onInsert(scheduleRefresh);
      db[t]!.onUpdate?.(scheduleRefresh);
      db[t]!.onDelete(scheduleRefresh);
    }
    conn.db.commandReceipt.onInsert((_ctx, r) => onReceipt(r));
    // Activity feed: tell everyone what other explorers just changed.
    conn.db.worldEvent.onInsert((_ctx, e) => {
      const st = get();
      if (e.sessionId !== st.sessionId || e.author.toHexString() === st.identityHex) return;
      if (Date.now() - ms(e.createdAt) > 15_000) return;
      const who = st.members.find((m) => m.identityHex === e.author.toHexString())?.displayName ?? 'Another explorer';
      const p = json<Record<string, unknown>>(e.parametersJson, {});
      const inner = (p.params as Record<string, unknown> | undefined) ?? {};
      const what = e.action === 'create_intervention'
        ? `built ${String(p.label ?? (p.kind === 'build.structure' ? `${String(inner.type ?? 'a structure').replace(/_/g, ' ')} at ${String(inner.hostId ?? '').replace(/^(body|star|gaia)\./, '')}` : interventionKind(String(p.kind))?.label ?? p.kind))}`
        : e.action === 'update_intervention' ? 'changed a build' : e.action === 'remove_intervention' ? 'removed a build' : e.action.replace(/_/g, ' ');
      useUi.getState().toast({ kind: 'info', title: `${who} ${what}`, body: e.source === 'voice' ? 'by voice' : undefined });
    });
  };

  const enterSession = async (conn: DbConnection, sessionId: string) => {
    sessionSub?.unsubscribe();
    store.set(SESSION_KEY, sessionId);
    set({ sessionId });
    sessionSub = await subscribeSession(conn, sessionId);
    refresh();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('session', sessionId);
      url.searchParams.delete('join');
      window.history.replaceState(null, '', url);
    } catch {
      /* non-browser */
    }
  };

  const waitFor = (pred: () => boolean, timeoutMs = 10_000) =>
    new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const tick = () => (pred() ? resolve(true) : Date.now() - t0 > timeoutMs ? resolve(false) : setTimeout(tick, 60));
      tick();
    });

  const displayName = () => store.get(NAME_KEY) ?? `Explorer-${(get().identityHex ?? 'xxxx').slice(0, 4)}`;

  /* ------------------------------------------------------------ offline engine */

  const offlineProject = () => {
    const { world, branchId, clock } = get();
    if (!world) return;
    const p = world.project(branchId, clock.simSeconds);
    if (!p) return;
    const b = world.getBranch(branchId)!;
    const prev = get().branches;
    const outputs: Partial<Record<LevelId, ServerOutput>> = {};
    const render: Partial<Record<LevelId, RenderOutput>> = {};
    for (const [l, o] of Object.entries(p.outputs) as [LevelId, LevelOutput][]) {
      outputs[l] = { level: l, modelId: o.modelId, modelVersion: o.modelVersion, inputHash: o.inputHash, revision: b.revision, clockSeconds: clock.simSeconds, summary: o.summary, view: o.view, nodes: o.nodes, warnings: o.warnings, assumptions: o.assumptions };
      render[l] = { output: o, verified: true };
      if (get().outputs[l]?.inputHash !== o.inputHash && !LEVELS[l].timeDependent) useUi.getState().pulse(l);
    }
    const branches = prev.map((x) => (x.id === branchId ? { ...x, revision: b.revision, cursor: b.cursor, head: b.head, kardashevLevel: p.capabilities.kardashevLevel, barrowLevel: p.capabilities.barrowLevel, updatedAt: Date.now() } : x));
    set({
      branches, interventions: p.interventions, assumptions: p.assumptions, capabilities: p.capabilities, outputs, render,
      events: p.events.slice(0, b.cursor).map((e) => ({ seq: e.seq, action: e.action, targetId: e.targetId, source: 'ui', authorHex: 'local', parameters: e.parameters, createdAt: Date.now() })),
      edges: Object.values(p.outputs).flatMap((o) => o!.nodes.flatMap((n) => n.dependsOn.map((f) => ({ level: o!.level, from: f, to: n.id })))),
    });
    set({ comparison: computeComparison(get()) });
  };

  const offlineSubmit = (action: string, parameters: Record<string, unknown>, targetId: string, source: string): Receipt => {
    const { world, branchId } = get();
    const id = cmdId();
    const now = Date.now();
    if (!world) return { commandId: id, action, status: 'rejected', message: 'World not ready', revision: 0, latestRevision: 0, source, senderHex: 'local', createdAt: now };
    const before = world.getBranch(branchId)!;
    const res = world.execute({ commandId: id, branchId, expectedRevision: before.revision, action, targetId, parameters });
    const rec: Receipt = {
      commandId: id, action, status: res.ok ? 'applied' : res.conflict ? 'conflict' : 'rejected', message: res.ok ? `${action}${res.event?.targetId ? ` ${res.event.targetId}` : ''}` : (res.errors ?? []).join('; '),
      revision: res.revision ?? before.revision, latestRevision: res.revision ?? before.revision, source, senderHex: 'local', createdAt: now,
      interventionId: action === 'create_intervention' && res.ok ? res.event?.targetId : undefined,
    };
    set((s) => ({ receipts: [rec, ...s.receipts].slice(0, 60), lastError: res.ok ? null : rec.message }));
    if (res.ok) offlineProject();
    return rec;
  };

  /* ------------------------------------------------------------ store */

  return {
    world: null,
    conn: null,
    identityHex: null,
    mode: 'offline',
    status: 'connecting',
    sessionId: '',
    sessionName: '',
    mainBranchId: '',
    presenterHex: '',
    role: 'owner',
    invites: [],
    members: [],
    poses: [],
    displayName: store.get(NAME_KEY) ?? '',

    setDisplayName: (name) => {
      const n = name.trim().slice(0, 40);
      store.set(NAME_KEY, n);
      set({ displayName: n });
      get().reportPresence(useUi.getState().stop, useUi.getState().selection?.id ?? '');
    },

    ensureCivCapability: (level) => {
      if (!level || level === 'b5') return Promise.resolve();
      const { capabilities: caps, role } = get();
      if (role === 'viewer') return Promise.resolve();
      const n = Number(level[1]);
      const needK = level[0] === 'k' && caps.kardashevLevel < n ? (n as 1 | 2 | 3) : undefined;
      const needB = level[0] === 'b' && caps.barrowLevel < n ? (n as 2 | 4 | 6) : undefined;
      if (!needK && !needB) return capsRaise;
      capsRaise = capsRaise
        .then(() => get().setCapabilities({ ...(needK ? { kardashevLevel: needK } : {}), ...(needB ? { barrowLevel: needB } : {}) }))
        .then(() => undefined, () => undefined);
      return capsRaise;
    },

    reportPose: (stop, position, target) => {
      const { conn, sessionId, mode, identityHex } = get();
      if (!conn || mode === 'offline' || !sessionId) return;
      conn.reducers.updatePose({ sessionId, stop, px: position[0], py: position[1], pz: position[2], tx: target[0], ty: target[1], tz: target[2], color: colorFor(identityHex ?? '') }).catch(() => undefined);
    },
    branchId: '',
    branches: [],
    interventions: [],
    assumptions: {},
    capabilities: { kardashevLevel: 1, barrowLevel: 1 },
    outputs: {},
    render: {},
    edges: [],
    clock: { running: false, rate: 50 * 365.25 * 86400, simSeconds: 0, updatedAtMs: Date.now(), revision: 0 },
    events: [],
    receipts: [],
    jobs: [],
    assets: [],
    previews: {},
    compareId: null,
    comparison: null,
    following: false,
    pending: 0,
    lastError: null,

    init: async (bundle, conn, identityHex) => {
      const world = new CosmosWorld(bundle);
      set({ world, conn, identityHex });
      if (!conn) {
        const id = 'local-main';
        world.createBranch(id, 4242);
        set({
          mode: 'offline', status: 'offline', sessionId: 'local', sessionName: 'Offline session', mainBranchId: id, role: 'owner', branchId: id,
          branches: [{ id, name: 'Main world (offline)', revision: 0, cursor: 0, head: 0, seed: 4242, parentBranchId: '', kardashevLevel: 1, barrowLevel: 1, archived: false, updatedAt: Date.now() }],
        });
        offlineProject();
        return;
      }
      set({ mode: 'live', status: 'live' });
      attach(conn);
      await subscribeMembership(conn);
      const url = new URL(window.location.href);
      const join = url.searchParams.get('join');
      if (join) {
        const r = await get().joinSession(join);
        if (r.ok) return;
        useUi.getState().toast({ kind: 'error', title: 'Could not join session', body: r.message });
      }
      const mine = [...conn.db.sessionMember.iter()].filter((m) => m.identity.toHexString() === identityHex);
      const wanted = url.searchParams.get('session') ?? store.get(SESSION_KEY);
      const pick = mine.find((m) => m.sessionId === wanted) ?? mine.sort((a, b) => ms(b.joinedAt) - ms(a.joinedAt))[0];
      if (pick) await enterSession(conn, pick.sessionId);
      else await get().newSession();
    },

    newSession: async (name) => {
      const { conn } = get();
      if (!conn) return;
      const sessionId = `s-${short()}`;
      const branchId = `b-${short()}`;
      await conn.reducers.createSession({ sessionId, branchId, name: name ?? 'COSMOS session', displayName: displayName() });
      await waitFor(() => Boolean(conn.db.worldSession.id.find(sessionId)));
      set({ branchId });
      await enterSession(conn, sessionId);
    },

    joinSession: async (code, name) => {
      const { conn, identityHex } = get();
      if (!conn) return { ok: false, message: 'Offline — sessions need SpacetimeDB.' };
      if (name) store.set(NAME_KEY, name);
      try {
        await conn.reducers.joinSession({ code: code.trim().toUpperCase(), displayName: name ?? displayName() });
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      const before = new Set([get().sessionId]);
      const ok = await waitFor(() => [...conn.db.sessionMember.iter()].some((m) => m.identity.toHexString() === identityHex && !before.has(m.sessionId)) || [...conn.db.sessionMember.iter()].some((m) => m.identity.toHexString() === identityHex));
      const m = [...conn.db.sessionMember.iter()].filter((x) => x.identity.toHexString() === identityHex).sort((a, b) => ms(b.joinedAt) - ms(a.joinedAt))[0];
      if (!ok || !m) return { ok: false, message: 'Joined, but membership did not replicate in time.' };
      await enterSession(conn, m.sessionId);
      return { ok: true, message: `Joined as ${m.role}` };
    },

    submit: (action, parameters, opts = {}) => {
      const source = opts.source ?? 'ui';
      const targetId = opts.targetId ?? '';
      const { conn, mode, branchId } = get();
      if (mode === 'offline' || !conn) return Promise.resolve(offlineSubmit(action, parameters, targetId, source));
      const commandId = cmdId();
      return new Promise<Receipt>((resolve) => {
        const send = async () => {
          const c = get().conn!;
          const row = c.db.worldBranch.id.find(branchId);
          const expectedRevision = Math.max(row?.revision ?? 0, lastRevision.get(branchId) ?? 0);
          await c.reducers.submitCommand({ branchId, commandId, expectedRevision, action, targetId, parametersJson: JSON.stringify(parameters), source });
        };
        const timer = setTimeout(() => {
          pendingCmds.delete(commandId);
          set({ pending: pendingCmds.size });
          resolve({ commandId, action, status: 'timeout', message: 'No receipt from SpacetimeDB within 12 s — reconnecting (the command is retried with the same id).', revision: 0, latestRevision: 0, source, senderHex: get().identityHex ?? '', createdAt: Date.now() });
          handleDisconnect();
        }, 12_000);
        pendingCmds.set(commandId, { resolve, send, timer });
        set({ pending: pendingCmds.size });
        if (!(get().conn as unknown as { isActive?: boolean }).isActive) handleDisconnect();
        send().catch((e: unknown) => {
          // Reducer threw (non-member, bad id...). Surface as a rejection.
          const p = pendingCmds.get(commandId);
          if (!p) return;
          clearTimeout(p.timer);
          pendingCmds.delete(commandId);
          set({ pending: pendingCmds.size, lastError: String(e) });
          resolve({ commandId, action, status: 'rejected', message: e instanceof Error ? e.message : String(e), revision: 0, latestRevision: 0, source, senderHex: get().identityHex ?? '', createdAt: Date.now() });
        });
      });
    },

    createIntervention: async (kind, params, opts = {}) => {
      // Capability is never raised implicitly: what a civilisation can build is
      // enforced by the module (reach, energy budget, manipulation depth).
      const k = interventionKind(kind);
      await capsRaise;
      const r = await get().submit('create_intervention', { kind, params, ...(opts.label ? { label: opts.label } : {}) }, opts);
      // Time-dependent scenarios start playing so the expansion is visible immediately.
      if (r.status === 'applied' && k && LEVELS[k.level].timeDependent && !get().clock.running) void get().clockControl('play', 0, opts);
      return r;
    },

    updateIntervention: async (id, params, opts = {}) => (await capsRaise, get().submit('update_intervention', { id, params, ...(opts.label ? { label: opts.label } : {}) }, { ...opts, targetId: id })),
    removeIntervention: (id, opts = {}) => get().submit('remove_intervention', { id }, { ...opts, targetId: id }),
    setAssumption: (key, value, opts = {}) => get().submit('set_assumption', { key, value }, { ...opts, targetId: key }),
    setCapabilities: (caps, opts = {}) => get().submit('set_capabilities', { capabilities: { ...get().capabilities, ...caps } }, opts),
    undo: (opts = {}) => get().submit('undo', {}, opts),
    redo: (opts = {}) => get().submit('redo', {}, opts),
    reset: (opts = {}) => get().submit('reset', {}, opts),

    clockControl: async (action, value = 0, opts = {}) => {
      const source = opts.source ?? 'ui';
      const { conn, mode, branchId } = get();
      if (mode === 'offline' || !conn) {
        const c = { ...get().clock, updatedAtMs: Date.now() };
        if (action === 'play') c.running = true;
        if (action === 'pause') c.running = false;
        if (action === 'set_rate') c.rate = value;
        if (action === 'seek') c.simSeconds = value;
        set({ clock: c });
        if (offlineClock) clearInterval(offlineClock);
        if (c.running) {
          offlineClock = setInterval(() => {
            const k = get().clock;
            set({ clock: { ...k, simSeconds: Math.min(1e13, k.simSeconds + k.rate), updatedAtMs: Date.now() } });
            offlineProject();
          }, 1000);
        }
        offlineProject();
        return { commandId: cmdId(), action: `clock.${action}`, status: 'applied', message: `clock ${action}`, revision: 0, latestRevision: 0, source, senderHex: 'local', createdAt: Date.now() };
      }
      const commandId = cmdId();
      return new Promise<Receipt>((resolve) => {
        const send = () => get().conn!.reducers.clockControl({ branchId, commandId, action, value, source });
        const timer = setTimeout(() => {
          pendingCmds.delete(commandId);
          resolve({ commandId, action: `clock.${action}`, status: 'timeout', message: 'No receipt within 20 s', revision: 0, latestRevision: 0, source, senderHex: '', createdAt: Date.now() });
        }, 20_000);
        pendingCmds.set(commandId, { resolve, send, timer });
        send().catch((e: unknown) => {
          clearTimeout(timer);
          pendingCmds.delete(commandId);
          resolve({ commandId, action: `clock.${action}`, status: 'rejected', message: String(e), revision: 0, latestRevision: 0, source, senderHex: '', createdAt: Date.now() });
        });
      });
    },

    simNow: () => {
      const c = get().clock;
      return c.running ? Math.min(1e13, c.simSeconds + (c.rate * (Date.now() - c.updatedAtMs)) / 1000) : c.simSeconds;
    },

    fork: async (name) => {
      const { conn, mode, branchId, branches, world } = get();
      const parent = branches.find((b) => b.id === branchId);
      const label = name?.trim() || `${parent?.name ?? 'World'} · fork ${branches.length}`;
      const id = `b-${short()}`;
      if (mode === 'offline' || !conn) {
        if (!world) return null;
        const p = world.getBranch(branchId)!;
        const evs = world.project(branchId)!.events.slice(0, p.cursor);
        world.hydrateBranch({ id, revision: 0, cursor: evs.length, head: evs.length, seed: p.seed }, evs);
        set((s) => ({ branches: [...s.branches, { ...parent!, id, name: label, revision: 0, parentBranchId: branchId, updatedAt: Date.now() }], branchId: id, compareId: branchId }));
        offlineProject();
        return id;
      }
      try {
        await conn.reducers.forkWorldBranch({ parentBranchId: branchId, branchId: id, name: label });
      } catch (e) {
        useUi.getState().toast({ kind: 'error', title: 'Fork rejected', body: e instanceof Error ? e.message : String(e) });
        return null;
      }
      await waitFor(() => Boolean(conn.db.worldBranch.id.find(id)));
      set({ branchId: id, compareId: branchId });
      refresh();
      get().reportPresence(useUi.getState().stop, useUi.getState().selection?.id ?? '');
      return id;
    },

    switchTo: (id) => {
      if (!get().branches.some((b) => b.id === id)) return;
      set({ branchId: id, previews: {}, compareId: get().compareId === id ? null : get().compareId });
      if (get().mode === 'offline') offlineProject();
      else refresh();
      get().reportPresence(useUi.getState().stop, useUi.getState().selection?.id ?? '');
    },

    rename: (name) => {
      const { conn, branchId, mode } = get();
      if (mode === 'offline' || !conn) {
        set((s) => ({ branches: s.branches.map((b) => (b.id === branchId ? { ...b, name } : b)) }));
        return;
      }
      conn.reducers.renameWorldBranch({ branchId, name }).catch((e: unknown) => useUi.getState().toast({ kind: 'error', title: 'Rename rejected', body: String(e) }));
    },

    compareWith: (id) => {
      set({ compareId: id });
      set({ comparison: computeComparison(get()) });
    },

    preview: (level, change) => {
      if (!change) {
        set((s) => ({ previews: { ...s.previews, [level]: undefined } }));
        return;
      }
      const { world, branchId, interventions, assumptions, branches, mode } = get();
      if (!world) return;
      const seed = branches.find((b) => b.id === branchId)?.seed ?? 4242;
      const key = JSON.stringify(change);
      // Previews are local what-ifs over the mirrored authoritative inputs; never committed.
      if (mode === 'offline') {
        const r = world.preview(branchId, change, get().clock.simSeconds);
        set((s) => ({ previews: { ...s.previews, [level]: r.ok ? { key, output: r.output } : { key, errors: r.errors } } }));
        return;
      }
      let ivs = interventions.filter((i) => i.level === level);
      const errors: string[] = [];
      if (change.create) {
        const k = interventionKind(change.create.kind);
        if (!k) errors.push('Unknown kind');
        else {
          const defaults = Object.fromEntries(k.params(world.ctx).map((p) => [p.key, p.defaultValue]));
          ivs = [...ivs.filter((i) => !(k.singleton && i.kind === k.kind)), { id: 'preview', level, kind: k.kind, label: k.label, params: { ...defaults, ...change.create.params }, createdSeq: 1e9, updatedSeq: 1e9 }];
        }
      } else if (change.update) {
        ivs = ivs.map((i) => (i.id === change.update!.id ? { ...i, params: { ...i.params, ...change.update!.params } } : i));
      }
      if (errors.length) {
        set((s) => ({ previews: { ...s.previews, [level]: { key, errors } } }));
        return;
      }
      try {
        const output = world.computeLevel(level, ivs, assumptions, get().simNow(), seed);
        set((s) => ({ previews: { ...s.previews, [level]: { key, output } } }));
      } catch (e) {
        set((s) => ({ previews: { ...s.previews, [level]: { key, errors: [String(e)] } } }));
      }
    },

    requestImagine: async (level, style = 'cinematic') => {
      const { conn, mode, branchId, outputs } = get();
      if (!outputs[level]) return { ok: false, message: `No ${level.toUpperCase()} result on this branch yet — create an intervention first.` };
      if (mode === 'offline' || !conn) return { ok: false, message: 'Imagine jobs need the SpacetimeDB connection (offline mode).' };
      try {
        const commandId = `img-${short()}`;
        await conn.reducers.requestImagine({ branchId, commandId, level, style });
        // Hosted builds render on demand (serverless worker); the local backend polls instead.
        void fetch('/api/imagine/run', { method: 'POST' }).catch(() => undefined);
        return { ok: true, jobId: `${branchId}:${commandId}`, message: `Imagine job queued for ${level.toUpperCase()} at revision ${get().branches.find((b) => b.id === branchId)?.revision ?? '?'}` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },

    setPresenter: (on) => {
      const { conn, sessionId } = get();
      conn?.reducers.setPresenter({ sessionId, presenting: on }).catch((e: unknown) => useUi.getState().toast({ kind: 'error', title: 'Presenter mode rejected', body: String(e) }));
    },

    setFollowing: (on) => {
      set({ following: on });
      get().reportPresence(useUi.getState().stop, useUi.getState().selection?.id ?? '');
      if (on) followPresenter();
    },

    reportPresence: (stop, selectedId) => {
      const { conn, sessionId, mode } = get();
      if (!conn || mode === 'offline' || !sessionId) return;
      if (presenceTimer) clearTimeout(presenceTimer);
      presenceTimer = setTimeout(() => {
        const s = get();
        conn.reducers.updatePresence({ sessionId: s.sessionId, branchId: s.branchId, stop, selectedId, following: s.following, displayName: s.displayName }).catch(() => undefined);
      }, 250);
    },
  };
});

/** Reconnect: rebuild the connection with the same identity, resubscribe, resend unacknowledged commands. */
let reconnecting = false;
export function handleDisconnect(): void {
  const s = useWorld.getState();
  if (s.mode !== 'live' || reconnecting) return;
  reconnecting = true;
  useWorld.setState({ status: 'reconnecting' });
  let attempt = 0;
  const retry = () => {
    attempt++;
    reconnectSpacetime({
      onConnect: async (conn) => {
        reconnecting = false;
        useWorld.setState({ conn, status: 'live' });
        const st = useWorld.getState();
        // Re-attach listeners and subscriptions on the fresh connection.
        await st.init(st.world!.ctx.science, conn, st.identityHex).catch(() => undefined);
        for (const p of pendingCmds.values()) void p.send().catch(() => undefined);
        useUi.getState().toast({ kind: 'success', title: 'Reconnected to SpacetimeDB', body: pendingCmds.size ? `Resent ${pendingCmds.size} pending command(s) (idempotent ids).` : undefined });
      },
      onDisconnect: () => handleDisconnect(),
      onError: () => setTimeout(retry, Math.min(15_000, 1000 * 2 ** attempt)),
    });
  };
  setTimeout(retry, 800);
}

/** Parse "Possible for a K2 · B4 civilisation" from a rejection into a capability target. */
export function requiredFrom(message: string): { kardashevLevel?: 1 | 2 | 3; barrowLevel?: 1 | 2 | 3 | 4 | 5 | 6; label: string } | null {
  const m = message.match(/Possible for a (K(\d))?(?: · )?(B(\d))? civilisation/);
  if (!m) return null;
  return {
    ...(m[2] ? { kardashevLevel: Number(m[2]) as 1 | 2 | 3 } : {}),
    ...(m[4] ? { barrowLevel: Number(m[4]) as 1 | 2 | 3 | 4 | 5 | 6 } : {}),
    label: [m[1], m[3]].filter(Boolean).join(' · '),
  };
}

/** Toast a rejected command; if it names a higher civilisation, offer to advance to it. */
export function toastRejection(title: string, r: Receipt): void {
  const req = requiredFrom(r.message);
  useUi.getState().toast({
    kind: 'error', title, body: r.message,
    ...(req ? { action: { label: `Advance to ${req.label}`, run: () => void useWorld.getState().setCapabilities({ ...req }) } } : {}),
  });
}

/** Watchdog: the SDK does not always report server-side disconnects (e.g. module republish). */
export function startConnectionWatchdog(): void {
  setInterval(() => {
    const s = useWorld.getState();
    if (s.mode === 'live' && s.conn && !(s.conn as unknown as { isActive?: boolean }).isActive) handleDisconnect();
  }, 3000);
}

/** A level's render data: live preview while editing, otherwise the authoritative output (re-derived locally). */
export function levelOutput(s: WorldState, level: LevelId): { output: LevelOutput | null; preview: boolean; verified: boolean } {
  const p = s.previews[level]?.output;
  if (p) return { output: p, preview: true, verified: false };
  const r = s.render[level];
  return { output: r?.output ?? null, preview: false, verified: r?.verified ?? false };
}
