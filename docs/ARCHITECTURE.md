# COSMOS architecture: SpacetimeDB as the authoritative world

**Who this is for:** engineers working on or reviewing COSMOS. Read this to see how state flows, what lives where, and how the guarantees are enforced and tested.

## 1. The short version

SpacetimeDB (`cosmicexploration-dejjt` on maincloud) owns all simulation state.

- **Browser, chat and voice clients never write world state directly.** Every change is a command sent to one validated reducer, `submit_command`.
- **The reducer is atomic.** It checks identity, role, revision, bounds, capability and duplicate command ids. It then runs the deterministic COSMOS engine *inside the module* and re-projects the results into tables, all in one transaction.
- **Clients render from subscriptions.** The browser bundles the same engine for two purposes only:
  - **Live what-if previews.** These are never committed.
  - **Bulky render arrays.** Examples are star arrival tables and collector samples. The client re-derives them and checks them against the server's `inputHash`.

```
 UI / chat / Grok Voice ──► conn.reducers.submitCommand(...)   (caller's identity)
                                   │
                        SpacetimeDB module (spacetimedb/src)
                        ├─ validate (member? editor? revision? duplicate? bounds? capability?)
                        ├─ append world_event (or move cursor for undo/redo/reset)
                        ├─ CosmosWorld.project()  ← packages/engine, bundled into the module
                        ├─ rewrite intervention / simulation_parameter / model_output / dependency_edge
                        └─ insert command_receipt (applied | rejected | conflict)
                                   │  (one transaction)
                        row-level security + session-scoped subscriptions
                                   ▼
            every member's browser updates (scenes, panels, voice context)

 clock_schedule (1 s) ──► clock_tick ──► simulation_clock + time-dependent model_output (K3)
 request_imagine ──► calculation_job ──► backend worker (own identity): claim_job → Grok Imagine → complete_job
                                          (rejected as `stale` if the level's inputHash changed)
```

## 2. Authority inventory

| Concern | Where it lives | Writer |
|---|---|---|
| Sessions | `world_session` | `create_session` |
| Members and roles | `session_member` (own row visible), `member_acl` (RLS mirror) | `create_session`, `join_session`, `set_member_role`, `leave_session` |
| Join codes | `session_invite` (visible to owner/editors only) | `create_session` |
| Presence and follow | `presence`, `world_session.presenter_hex` | `update_presence`, `set_presenter`, connect/disconnect lifecycle |
| Branches | `world_branch` (revision, cursor, head, seed, K/B capability) | `create_session`, `fork_world_branch`, `rename_world_branch`, `archive_world_branch`, `submit_command` |
| Command log (source of truth) | `world_event` (author identity, `source` = ui/voice/chat/test) | `submit_command` |
| Command receipts and duplicates | `command_receipt` (PK `branchId/commandId`) | `submit_command`, `clock_control` |
| Interventions (entities and overrides) | `intervention` (projection) | `submit_command` → engine replay |
| Parameters (assumption overrides) | `simulation_parameter` (projection) | `submit_command` |
| Model outputs | `model_output` (summary, compact view, nodes, warnings, assumptions, model id/version, inputHash, revision, clock) | `submit_command`, `clock_tick`, `clock_control(seek)` |
| Micro → macro graph | `dependency_edge` (+ node inputs/outputs/units in `model_output.nodes_json`) | same as outputs |
| Clock | `simulation_clock`, `clock_schedule` (scheduled reducer) | `clock_control`, `clock_tick` |
| Async jobs | `calculation_job` (queued → leased → done / stale / failed) | `request_imagine`, `claim_job`, `complete_job`, `fail_job` |
| Generated assets | `generated_asset` (labelled illustrative, revision + inputHash) | `complete_job` only, and only when not stale |
| Workers | `worker` | `register_worker` (admin) |
| Scientific baseline | 33 science tables (`science.ts`, generated from `scripts/ingest/schema.py`) | `ingest_rows` / `clear_table` (admin) |

Legacy v1/v2 tables (`branch`, `branch_event`, `concept_asset` and the old science tables) are kept so migrations stay non-destructive. The client no longer uses them. Old `branch` rows are visible only to their owner.

## 3. Reducer guarantees

`submit_command(branchId, commandId, expectedRevision, action, targetId, parametersJson, source)` is the only path for world changes. The actions are create/update/remove intervention, set_assumption, set_capabilities, undo, redo and reset.

1. **Identity and membership.** The caller must be a member of the branch's session; otherwise the reducer throws and nothing is written.
2. **Duplicate command ids.** A repeat of `branchId/commandId` is a no-op. This makes client retries after a reconnect safe.
3. **Role.** Viewers get a `rejected` receipt with a reason.
4. **Revision.** If `expectedRevision` is not the latest, the result is a `conflict` receipt carrying `latestRevision`. There is no last-write-wins.
5. **Bounds, kinds, unknown keys, singletons and capability.** These are enforced by the engine's `validate()`, using the same specs the UI sliders use.
6. **Atomic application.** The event is appended (truncating any redo tail), the branch revision and cursor advance, and the engine replays and re-projects every derived table. The receipt is written in the same transaction.

Rejections are recorded as receipts instead of being thrown. That way the caller, including the voice agent, can explain *why*. Each rejected receipt is atomic too: nothing else changes.

## 4. Deterministic computation in the module

- **Shared engine.** `spacetimedb/src/engineCache.ts` builds `CosmosWorld` from the science tables once per module instance and caches it. Ingestion invalidates the cache. The engine source in `packages/engine/src` is the same code the browser runs: no clocks, no `Math.random` and no `structuredClone`, so outputs are reproducible.
- **Projection.** Each projection hydrates the branch from `world_event` rows, which are the DB truth, and computes only the levels that have interventions.
- **Memoisation.** Results are memoised on `(baselineId, model@version, seed, interventions, relevant assumptions, clock if time-dependent)`. The FNV hash of that key is the `inputHash`.
- **Micro to macro.** Each level output carries `ModelNode`s with inputs, outputs, units, model id, version, evidence class and assumptions. The `dependsOn` links form the dependency graph:
  - B2: sequence → protein → haemoglobin → red cell → blood → O₂ delivery.
  - B4: lattice (ion insertion) → optics (α, T) → room illuminance, plus the hydrogen transition.
  - B6: interaction → conversion (captured, electrical, heat) → supply (positron production input, net) → loads (lights).
- **Compact storage.** `model_output.view_json` stores a compact view: arrays longer than 300 items become `{omitted: n}`. The full K3 arrival tables and K2 collector samples (up to about 2 MB) are re-derived by the client with the same engine. The UI shows "render verified (hash match)" when the local `inputHash` equals the server's.

## 5. Subscriptions and read authorization

- **Visibility filters.** `clientVisibilityFilter.sql` rules make session data readable only by members of that session. They join through `member_acl` on `session_id` with `identity = :sender`.
  - Invites are visible to owners and editors only.
  - `calculation_job` is also visible to registered workers of the job's kind.
  - `session_member` shows a caller only their own rows.
- **Why a separate ACL table.** SpacetimeDB requires the joined table to be public, indexed on the join column, and free of its own visibility rule. So `member_acl` is a public mirror holding only (session id, identity, role): no names, no codes, no world data. A session id alone grants nothing, because every rule gates on the caller's own identity.
- **Two-phase subscriptions** (`apps/web/src/data/spacetime.ts`):
  1. Memberships.
  2. `SELECT * FROM <table> WHERE session_id = '<id>'` for the 11 session tables. All branches are included so compare works.
- **Reconnect.**
  - On disconnect, the client reconnects with the stored token (same identity) and backs off exponentially.
  - It re-subscribes and re-sends any unacknowledged commands with their original ids. Duplicate-id idempotency makes this safe.

## 6. Voice, chat and UI use the same reducers

- **One tool layer.** `apps/web/src/ai/tools.ts` implements every tool by calling the store's `submit*` / `clockControl` / `requestImagine`. These call the same reducers under the **user's own identity**, and the `source` field records `voice` or `chat`.
- **Serialized voice calls.** Grok Voice tool calls run one at a time, so each command sees the revision produced by the previous one.
- **Follow-up resolution.** References like "that", "it" or "the window" resolve against the current selection, then recent selections, then interventions at the current level. If more than one matches, the tool returns `needs_clarification` with the candidates, and the agent is instructed to ask.

## 7. Clock

- `clock_schedule` holds a 1 s interval row (created by `init` and ensured on connect).
- `clock_tick` runs only when the scheduler calls it (`sender == databaseIdentity`). It advances running clocks by `rate × Δt`, capping Δt at 5 s, and re-projects only the time-dependent levels (K3).
- `clock_control` (play / pause / set_rate / seek) is editor-only and deduplicated through receipts. Seek recomputes immediately.
- Clients interpolate between ticks (`simNow()`) for a smooth playhead.

## 8. Async Imagine worker

`backend/app/worker.py` runs inside the FastAPI lifespan as its own SpacetimeDB client.

- **Identity.** It obtains its own identity via `POST /v1/identity`. The token is stored in `backend/.worker_identity.json`, which is gitignored and never in a client bundle. The admin registers the identity with `register_worker`.
- **Polling.** It polls queued jobs over the HTTP SQL API (visibility rules apply), then calls `claim_job` for a 120 s lease.
- **Prompts.** The prompt is built **server-side** by `imaginePrompt()` from the authoritative output at request time, so it is state-linked.
- **Completion.** The worker renders with Grok Imagine, stores the bytes under `assets/generated/`, and calls `complete_job`. That reducer:
  - rejects callers who are not the live lease holder;
  - marks the job `stale` (no asset written) if the level's `inputHash` changed since the request;
  - otherwise writes a `generated_asset` labelled "Illustrative concept … not a simulation output".
- **Stale display.** Assets whose level has since changed are shown greyed out as stale in the UI.

## 9. Tests

| Suite | Command | What it proves |
|---|---|---|
| Engine scenarios (10) | `npm run test:engine` | Six level scenarios on real data, validation, undo/redo/reset, duplicates/conflicts, memoised hashing, compare |
| SpacetimeDB authority A–I (9) | `npm run test:stdb` | Live module with real SDK clients (separate identities): A two-client sync · B voice source/author · C micro→macro + edges · D persistence on reconnect · E conflicts + duplicate ids · F viewer/non-member permissions (writes and reads) · G stale job rejected · H scheduled clock + pause + seek · I undo/redo/reset shared |
| Browser end-to-end per level (7) | `node tests/e2e/levels.mjs` (dev servers up) | Each spec scenario through the voice/chat tool path in a real browser, asserting the authoritative outputs; ambiguity clarification; fork/compare/reset |

## 10. Deploying a module change

```bash
spacetime build --module-path ./spacetimedb
npm run publish:module            # non-destructive update (adds tables/indexes/rules)
spacetime generate --lang typescript -o apps/web/src/module_bindings -p ./spacetimedb --yes
```

The migration only adds things. Changing existing columns would need `--delete-data`, which wipes the science tables. In that case, re-run `python scripts/publish_spacetime.py` afterwards.
