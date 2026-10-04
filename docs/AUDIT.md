# COSMOS requirement audit

**Who this is for:** the project owner and reviewers checking each requirement against the code.

**Status key:**
- ✅ Implemented and verified by an automated test.
- ☑️ Implemented and exercised manually or by smoke test, with no dedicated automated test.
- ⚠️ Partial or limited.
- ❌ Not done.

**Test names used below:**
- **ENG** = `packages/engine/test/scenarios.test.ts`
- **STDB-A…I** = `tests/integration/stdb.test.ts`
- **E2E** = `tests/e2e/levels.mjs`

## Shared functionality

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Select and inspect objects (interventions, regions, model nodes, sources, assumptions) | ☑️ | `state/ui.ts` (selection + history), `ui/panels/InterventionsPanel.tsx`, `ui/panels/DependencyGraph.tsx`, `three/scenes/EarthScene.tsx` (region badges), Body/Room/Device/Solar click targets, `ui/panels/SourcesPanel.tsx`, Assumptions tab | E2E (select through tools); manual UI | Not every scene object is clickable (stars, individual facilities) |
| Create, modify and remove interventions | ✅ | `engine/interventions.ts`, `engine/world.ts`, `authority.ts:submit_command`, `InterventionsPanel.tsx` | ENG, STDB-A/C, E2E | — |
| Pause, resume, speed, scrub time | ✅ | `authority.ts:clock_control/clock_tick`, `ui/ClockBar.tsx`, `GalaxyScene` playhead | STDB-H, E2E K3 | Only K3 is time-dependent; other levels are steady-state |
| Branches, compare, undo, redo, reset | ✅ | `fork_world_branch`, `state/world.ts:computeComparison`, `ui/panels/WorldsPanel.tsx` | ENG, STDB-I, E2E shared | — |

## Grok voice agent

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Real microphone input (xAI realtime) | ✅ | `ai/voice.ts` (client secret from `/api/voice/session`, PCM 24 kHz, server VAD); tool calls serialized | `tests/e2e/voice_mic.mjs`: Chromium fake microphone plays a spoken command → transcription → `focus` + `build` → SpacetimeDB (source `voice`) → spoken answer | Owner to try with a physical mic |
| Knows level, selection, branch | ☑️ | `ai/tools.ts:contextSnapshot` (stop, level, selection, recent selections, branch/revision, role, interventions, clock, results, last receipts) | E2E uses the same tools | — |
| Navigates and zooms | ✅ | tools `navigate`, `zoom` | E2E B2/B4 | — |
| Executes validated tools through reducers under the user's identity | ✅ | `executeTool` → store → `submit_command(source='voice')` | STDB-B, E2E | — |
| Multi-step requests | ☑️ | serialized tool queue in `voice.ts`; prompt instructs sequencing; preset steps | E2E K2 (two creates) | — |
| Follow-ups ("increase that", "change its material", "undo the last change") | ✅ | `resolveIntervention` (selection → recent → level → most recent), `undo` | E2E K1 (target-less update), shared | — |
| Clarifies when ambiguous | ✅ | `needs_clarification` + candidates; system prompt rule | E2E shared | — |
| Explains actual results; compare, reset, Imagine | ✅ | `get_results` (summary + node chain), `compare_branches`, `reset`, `request_imagine` | E2E | — |

## Free building and navigation

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Go to any planet, moon or catalogued star | ✅ | `engine/entities.ts` (30 Horizons bodies + 49k Gaia/SIMBAD stars, aliases), `ai/tools.ts:focus`, `three/focus.ts`, scene focus resolvers | `test:grok` (Moon, Betelgeuse), `civ_smoke` (Vega, Sirius) | Unnamed Gaia stars are addressable by id only |
| Harness the power of anything | ✅ | `build.structure` kind; `models/structures.ts` (star luminosity, insolation × disc, fuel harvest, habitat allocation); host decides K2 vs K3 | engine `structures.test.ts`; `test:grok` | Black holes and other exotic sources are not modelled |
| Build from the scene | ☑️ | click planets, moons and stars → `SelectionCard` build buttons | Manual | — |

## K1 · planet

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Earth regions and layers | ✅ | `engine/regions.ts` (6 regions, OWID continental energy), EarthScene layers (LST/NDVI/quakes) | ENG K1 | Regions are continental boxes, not country polygons |
| Facilities: location, capacity, utilization, efficiency, construction | ✅ | `k1.facility`, `k1.network` kinds; `models/k1Grid.ts` | ENG, E2E | — |
| Grid with regional demand and allocation, HVDC losses | ✅ | `k1Grid.ts` (nearest-exporter trade, loss per 1000 km) | ENG, E2E | Greedy allocation (declared), not an optimal power flow |
| Capacity, generated, losses, useful, unmet, achieved K | ✅ | `K1GridView.totals`, `LevelResults.tsx:K1Grid` | ENG | — |
| Climate interventions | ✅ | `k1.climate` (shade, aerosols, albedo) | ENG (via model) | — |
| Compare | ✅ | compare panel / tool | E2E shared | — |
| Scenario: solar network → increase → surplus regions | ✅ | presets "Global solar network", "Scale solar ×4"; region badges | E2E K1 (surplus: South America, Africa, Oceania) | — |

## K2 · star

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Swarm create/modify/remove: radius, capture, efficiency, construction, band layouts | ✅ | `k2.swarm`, `models/k2Stellar.ts`, SolarScene (multiple swarms) | ENG, E2E | — |
| Habitats and stations with demand and allocation | ✅ | `k2.habitat` (priority, beam efficiency, loss per AU), `PowerBeams` | ENG, E2E | — |
| Animation, K, Imagine | ☑️ | SolarScene swarm shader + beams; Imagine job | Manual | — |
| Scenario: swarm 30% + Mars habitat | ✅ | preset | E2E K2 | — |

## K3 · galaxy

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Catalog vs background stars | ✅ | Gaia sample + exponential-disk extrapolation (labelled) | ENG | — |
| Origin, targets, speed, delay, start time | ✅ | `k3.expansion` params | ENG | Origin list limited to named stars within 30 pc |
| Arrival graph, animated fronts, pause and scrub | ✅ | k-d tree kNN + Dijkstra; clock-driven playhead | STDB-H, E2E K3 | — |
| Swarms at settled stars; coverage and energy | ✅ | `buildSwarms`, `sampleW`, coverage | E2E K3 | — |
| Labelled extrapolation | ✅ | `galaxyExtrapolation` marked assumed | ENG | — |
| Compare strategies | ✅ | fork + compare | E2E shared | — |

## Barrow micro → macro (common)

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Everyday-scale scene per level | ☑️ | `BodyScene` (B2), `RoomScene` (B4), `DeviceScene` (B6) | Boots without page errors (E2E) | Visual polish not reviewed (by request) |
| Semantic zoom inward/outward | ✅ | `Stop.zoomIn/zoomOut`, `ZoomButtons`, `zoom` tool, in-scene ⊕ targets | E2E B4 | — |
| Editable microscopic parameters | ✅ | b2.edit, b4.window (x, thickness, material), b6.device (rate, KE, capture, efficiency) | ENG, E2E | — |
| Explicit micro → intermediate → macro models | ✅ | `models/b2Body.ts`, `b4Window.ts`, `b6Device.ts` node chains | ENG, STDB-C | — |
| Dependency graph with inputs/outputs/units/model id/version/sources/assumptions | ✅ | `dependency_edge` + `nodes_json`; `DependencyGraph.tsx` | STDB-C | Node "sources" are evidence classes; dataset ids are in the Sources tab |
| Macro results visible; compare and undo; voice throughout | ✅ | Results tab, scene labels, tools | E2E | — |

## Barrow civilisations (zoom stacks)

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Human-scale civilisation per Barrow level | ✅ | `TownScene` (B2 population), `CityScene` (B4 city), `GridScene` (B6 city grid) | `barrow.mjs` | — |
| Continuous zoom to the micro scale and back | ✅ | `navigation/stops.ts` depth chains, `CivHud` (breadcrumb, scroll-past-limit, ↑/↓ keys) | `barrow.mjs` every depth | — |
| Direct micro control | ✅ | gene editor (any base, `b2.base_edit`), clickable lattice ions (`occupiedSites`), particle species/energy/rate | engine `barrow.test.ts`; `barrow.mjs` | — |
| Macro consequences visible at every depth | ✅ | `b2.population`, `b4.city` (lighting + cooling), `b6.city` (districts lit, net after antimatter cost) | engine + `barrow.mjs` | — |
| Dock buttons navigate to K1/K2/K3/B2/B4/B6 (B1/B3/B5 removed) | ✅ | `CapabilityDock.tsx` | `barrow.mjs` | — |

## B2 · B4 · B6

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| B2: body → tissue/cell/gene/protein; validated HBB edits; O₂ delivery model | ✅ | BodyScene → CellScene; `b2GeneticEdit` reference-base validation; `b2Body` | ENG, E2E B2 | Educational model, declared assumptions |
| B2 scenario: show mutation → apply reference → oxygen delivery | ✅ | presets | E2E B2 | — |
| B4: window/room chain + retained hydrogen transition | ✅ | `b4Window` (x → α → T → lux), `b4.transition` | ENG, STDB-C, E2E | Optical constants are declared (cited), not measured spectra |
| B4 scenario: change microstructure → room changes | ✅ | presets "Clear/Tinted window" | E2E B4 | — |
| B6: annihilation → capture → conversion → power and heat → lights; gross vs net; particle supply | ✅ | `b6Device` (supplyEfficiency assumption, net may be negative) | ENG, E2E B6 | — |
| B6 scenario: increase rate → usable power and heat → lights | ✅ | presets | E2E B6 | — |

## Imagine

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| State-linked prompts | ✅ | `engine/imagine.ts` built in `request_imagine` from the authoritative output | CLI smoke + STDB-G | — |
| Labelled output, revision reference | ✅ | `generated_asset.label/revision/input_hash`; ConceptCard and Mission panel | CLI smoke (`done`, labelled asset) | — |
| Stale-job protection | ✅ | `complete_job` inputHash check; lease checks | STDB-G | — |

## SpacetimeDB authoritative layer

| Requirement | Status | Code | Verification | Remaining |
|---|---|---|---|---|
| Owns sessions, members, branches, entities/overrides, interventions, parameters, outputs, edges, clocks, receipts, events, jobs, assets, presence | ✅ | `spacetimedb/src/worldTables.ts` | STDB A–I | Baseline entities stay in science tables (immutable) |
| Reducers validate identity, role, revision, bounds, capability, duplicates; atomic | ✅ | `authority.ts` | STDB-E/F, ENG | — |
| Deterministic models in the module; micro→macro propagation | ✅ | `engineCache.ts`, `project()` | STDB-A/C | — |
| Session/branch-scoped subscriptions; reconnect | ✅ / ☑️ | `data/spacetime.ts`, `handleDisconnect` | STDB-D (identity persists); resend-on-reconnect not automated | — |
| Voice through the same reducers under the user's identity | ✅ | tools → `submit_command` | STDB-B | — |
| Scheduled clock tick | ✅ | `clock_schedule` / `clock_tick` | STDB-H | 1 s tick granularity |
| External worker with claim/lease; stale rejected | ✅ | `backend/app/worker.py` | STDB-G, CLI smoke | Single worker; no autoscaling |
| Viewer/editor permissions, presence, follow-presenter, server-side read authorization | ✅ / ☑️ | roles, visibility rules, `presence`, `set_presenter`, `followPresenter()` | STDB-F (reads + writes); presence/follow manual only | — |
| Architecture explanation and inventory | ✅ | `docs/ARCHITECTURE.md` | — | — |

## Known limitations

- `member_acl` is public by necessity (see ARCHITECTURE §5). It reveals session-membership tuples but no session content.
- The module builds the engine from about 120k science rows on first use per instance. That first command is slower (seconds); later commands are fast.
- Voice with a real microphone and the visual quality of the new scenes have not been verified by me. They are left for the owner to test.
