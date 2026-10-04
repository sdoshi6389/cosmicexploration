export type EvidenceKind =
  | 'observed'
  | 'derived'
  | 'assumed'
  | 'simulated'
  | 'generated'
  | 'illustrative';

export interface Evidence {
  kind: EvidenceKind;
  sourceId?: string;
  sourceRecordId?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  release?: string;
  method?: string;
  uncertainty?: { lower?: number; upper?: number; description: string };
  assumptions?: string[];
}

export interface Property<T> {
  value: T | null;
  unit?: string;
  evidence: Evidence[];
  validAt?: { epoch: string; timeScale: 'UTC' | 'TDB' | 'TT' };
}

export interface CosmosEntity {
  id: string;
  type: string;
  name: string;
  sourceIds: Record<string, string>;
  characteristicLengthM?: number;
  properties: Record<string, Property<unknown>>;
  assetRefs: string[];
  availableActions: string[];
}

export interface Relationship {
  from: string;
  to: string;
  type:
    | 'contains'
    | 'orbits'
    | 'encodes'
    | 'associatedWith'
    | 'structureOf'
    | 'illustrates'
    | 'memberOf';
  evidence: Evidence[];
}

export interface StateVector {
  positionM: [number, number, number];
  velocityMps: [number, number, number];
  originId: string;
  frame: string;
  epoch: string;
  timeScale: 'UTC' | 'TDB' | 'TT';
  aberrationCorrection: string;
}

export interface Branch {
  id: string;
  baselineId: string;
  parentBranchId?: string;
  forkRevision?: number;
  /** Optimistic-concurrency revision: increments on append, undo, redo and reset. */
  revision: number;
  /** Number of active events (undo moves it back, redo forward). */
  cursor: number;
  /** Number of stored events (redo ceiling). */
  head: number;
  scenarioTimeSeconds: number;
  seed: number;
}

export interface Command {
  commandId: string;
  branchId: string;
  expectedRevision: number;
  action: string;
  targetId: string;
  parameters: Record<string, unknown>;
}

export interface ModelResult {
  modelId: string;
  modelVersion: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, Property<unknown>>;
  assumptions: string[];
  warnings: string[];
}

export interface BaselineSnapshot {
  id: string;
  version: string;
  entities: CosmosEntity[];
  relationships: Relationship[];
}

/** What is persisted per event (SpacetimeDB `branch_event`). Results are recomputed on replay. */
export interface BranchEvent {
  commandId: string;
  seq: number;
  action: string;
  targetId: string;
  parameters: Record<string, unknown>;
}

export interface NavigationIntent {
  entityId: string;
  route?: string[];
  message?: string;
}

export type LevelId = 'k1' | 'k2' | 'k3' | 'b2' | 'b4' | 'b5' | 'b6';

export interface ScenarioState {
  level: LevelId;
  action: string;
  targetId: string;
  parameters: Record<string, unknown>;
  result: ModelResult;
  seq: number;
}

export interface ProjectedBranchState {
  branch: Branch;
  entities: Record<string, CosmosEntity>;
  relationships: Relationship[];
  capabilities: CapabilityState;
  assumptions: Record<string, unknown>;
  interventions: Intervention[];
  outputs: Partial<Record<LevelId, LevelOutput>>;
  clockSeconds: number;
  events: BranchEvent[];
}

export type KardashevLevel = 1 | 2 | 3;
export type BarrowLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface CapabilityState {
  kardashevLevel: KardashevLevel;
  barrowLevel: BarrowLevel;
}

export interface CommandResult {
  ok: boolean;
  revision?: number;
  conflict?: { latestRevision: number; message: string };
  duplicate?: boolean;
  modelResult?: ModelResult;
  navigationIntent?: NavigationIntent;
  errors?: string[];
  /** The validated event the caller should persist (absent for duplicates and failures). */
  event?: BranchEvent;
}

/** An editable assumption a user (or Grok) can override inside a branch. */
export interface AssumptionSpec {
  key: string;
  level: LevelId;
  label: string;
  unit: string;
  /** `entity`: a free-text reference to any body or star (validated by `validate`; `choices` are suggestions). */
  kind: 'number' | 'boolean' | 'choice' | 'entity';
  min?: number;
  max?: number;
  step?: number;
  /** Display scale: 'log' sliders for quantities spanning decades. */
  scale?: 'linear' | 'log';
  choices?: { value: string; label: string }[];
  /** Sourced or declared default, resolved from the baseline. */
  defaultValue: number | boolean | string;
  evidence: Evidence;
  description: string;
}

/** A scenario control parameter (what the intervention does, as opposed to world assumptions). */
export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  kind: 'number' | 'boolean' | 'choice' | 'entity' | 'text';
  min?: number;
  max?: number;
  step?: number;
  scale?: 'linear' | 'log';
  choices?: { value: string; label: string }[];
  defaultValue: number | boolean | string;
  description: string;
  /** Multiplier from the displayed value to the model's SI parameter. */
  displayFactor?: number;
  /** Extra validation (e.g. the referenced entity exists). Returns an error message or null. */
  validate?: (v: unknown) => string | null;
}

/** A user-created object or change inside a branch (facility, swarm, habitat, edit, window, device…). */
export interface Intervention {
  id: string;
  level: LevelId;
  kind: string;
  label: string;
  params: Record<string, unknown>;
  createdSeq: number;
  updatedSeq: number;
}

export interface Quantity {
  value: number | string | boolean | null;
  unit: string;
}

/** One node in a level's dependency graph: a model step with typed inputs and outputs. */
export interface ModelNode {
  id: string;
  label: string;
  modelId: string;
  version: string;
  inputs: Record<string, Quantity>;
  outputs: Record<string, Quantity>;
  evidence: EvidenceKind;
  assumptions: string[];
  dependsOn: string[];
}

export interface LevelOutput {
  level: LevelId;
  modelId: string;
  modelVersion: string;
  nodes: ModelNode[];
  /** Render-ready view data for the scene. */
  view: unknown;
  summary: Record<string, number | string | boolean>;
  warnings: string[];
  assumptions: string[];
  inputHash: string;
}
