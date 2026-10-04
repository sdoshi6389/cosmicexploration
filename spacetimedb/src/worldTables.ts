import { table, t } from 'spacetimedb/server';

/* ===================================================== authoritative world state (v3)
 * Every row below carries `sessionId` so the row-level visibility filters in
 * authority.ts can authorize reads with a single join on session_member.
 */

/** A shared workspace. Branches, presence and jobs all belong to one session. */
export const worldSession = table(
  { name: 'world_session', public: true },
  {
    id: t.string().primaryKey(),
    name: t.string(),
    owner: t.identity(),
    mainBranchId: t.string(),
    /** Hex identity whose navigation followers mirror (empty = nobody presenting). */
    presenterHex: t.string(),
    createdAt: t.timestamp(),
  },
);

/** Join codes; readable only by the session's owner/editors (see visibility filters). */
export const sessionInvite = table(
  { name: 'session_invite', public: true },
  {
    code: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    role: t.string(),
    createdAt: t.timestamp(),
  },
);

export const sessionMember = table(
  { name: 'session_member', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    /** owner | editor | viewer */
    role: t.string(),
    displayName: t.string(),
    joinedAt: t.timestamp(),
  },
);

/**
 * Mirror of memberships (session, identity, role — no names or codes) used inside
 * row-level-security joins. It must be public for the join to compile
 * and must not carry its own visibility rule; all session data stays gated on :sender.
 */
export const memberAcl = table(
  { name: 'member_acl', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    role: t.string(),
  },
);

export const presence = table(
  { name: 'presence', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    displayName: t.string(),
    role: t.string(),
    branchId: t.string(),
    stop: t.string(),
    selectedId: t.string(),
    following: t.bool(),
    online: t.bool(),
    lastSeen: t.timestamp(),
  },
);

/** Live camera pose of each explorer (≈4 Hz) so others see where they are and look. */
export const presencePose = table(
  { name: 'presence_pose', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    stop: t.string(),
    px: t.f64(),
    py: t.f64(),
    pz: t.f64(),
    tx: t.f64(),
    ty: t.f64(),
    tz: t.f64(),
    color: t.string(),
    updatedAt: t.timestamp(),
  },
);

export const worldBranch = table(
  { name: 'world_branch', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    name: t.string(),
    baselineId: t.string(),
    parentBranchId: t.string(),
    forkRevision: t.u32(),
    head: t.u32(),
    cursor: t.u32(),
    revision: t.u32(),
    seed: t.u32(),
    kardashevLevel: t.u32(),
    barrowLevel: t.u32(),
    archived: t.bool(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

/** Ordered, replayable command log; the source of truth for a branch. */
export const worldEvent = table(
  { name: 'world_event', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    seq: t.u32(),
    commandId: t.string(),
    action: t.string(),
    targetId: t.string(),
    parametersJson: t.string(),
    /** ui | voice | chat | test */
    source: t.string(),
    author: t.identity(),
    createdAt: t.timestamp(),
  },
);

/** One row per submitted command id: applied / rejected (+ reason). */
export const commandReceipt = table(
  { name: 'command_receipt', public: true },
  {
    commandKey: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    commandId: t.string(),
    action: t.string(),
    status: t.string(),
    message: t.string(),
    revision: t.u32(),
    latestRevision: t.u32(),
    source: t.string(),
    sender: t.identity(),
    createdAt: t.timestamp(),
  },
);

/** Projection: active interventions after replaying the branch to its cursor. */
export const intervention = table(
  { name: 'intervention', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    interventionId: t.string(),
    level: t.string(),
    kind: t.string(),
    label: t.string(),
    paramsJson: t.string(),
    createdSeq: t.u32(),
    updatedSeq: t.u32(),
  },
);

/** Projection: declared model assumptions overridden on this branch. */
export const simulationParameter = table(
  { name: 'simulation_parameter', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    key: t.string(),
    level: t.string(),
    valueJson: t.string(),
  },
);

/** Projection: authoritative model results per level, computed in this module. */
export const modelOutput = table(
  { name: 'model_output', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    level: t.string(),
    modelId: t.string(),
    modelVersion: t.string(),
    inputHash: t.string(),
    revision: t.u32(),
    clockSeconds: t.f64(),
    summaryJson: t.string(),
    /** Compact view: bulky render arrays become {omitted:n}; clients re-derive them deterministically and check inputHash. */
    viewJson: t.string(),
    nodesJson: t.string(),
    warningsJson: t.string(),
    assumptionsJson: t.string(),
    computedAt: t.timestamp(),
  },
);

/** Micro → macro dependency graph edges for each level's output. */
export const dependencyEdge = table(
  { name: 'dependency_edge', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    level: t.string(),
    fromNode: t.string(),
    toNode: t.string(),
    modelId: t.string(),
    modelVersion: t.string(),
  },
);

export const simulationClock = table(
  { name: 'simulation_clock', public: true },
  {
    branchId: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    running: t.bool(),
    /** Simulated seconds per real second. */
    rate: t.f64(),
    simSeconds: t.f64(),
    revision: t.u32(),
    updatedAt: t.timestamp(),
  },
);

/** Scheduled heartbeat that advances running clocks (see `clock_tick`). */
export const clockSchedule = table(
  { name: 'clock_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

/** Async work (Grok Imagine) claimed by registered workers under a time-limited lease. */
export const calculationJob = table(
  { name: 'calculation_job', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    kind: t.string().index('btree'),
    level: t.string(),
    revision: t.u32(),
    inputHash: t.string(),
    payloadJson: t.string(),
    /** queued | leased | done | failed | stale */
    status: t.string(),
    leaseOwnerHex: t.string(),
    leaseExpiresMicros: t.u64(),
    attempts: t.u32(),
    resultJson: t.string(),
    error: t.string(),
    requestedBy: t.identity(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

export const generatedAsset = table(
  { name: 'generated_asset', public: true },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    branchId: t.string().index('btree'),
    jobId: t.string(),
    level: t.string(),
    revision: t.u32(),
    inputHash: t.string(),
    prompt: t.string(),
    model: t.string(),
    url: t.string(),
    label: t.string(),
    createdAt: t.timestamp(),
  },
);

/** Identities allowed to claim jobs of a kind (registered by the admin). */
export const worker = table(
  { name: 'worker', public: true },
  {
    identity: t.identity().primaryKey(),
    kind: t.string().index('btree'),
    name: t.string(),
    createdAt: t.timestamp(),
  },
);

export const worldTables = {
  worldSession,
  sessionInvite,
  sessionMember,
  memberAcl,
  presence,
  presencePose,
  worldBranch,
  worldEvent,
  commandReceipt,
  intervention,
  simulationParameter,
  modelOutput,
  dependencyEdge,
  simulationClock,
  clockSchedule,
  calculationJob,
  generatedAsset,
  worker,
};
