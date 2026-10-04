# Build status

**Who this is for:** anyone picking up the project who needs to know what works and what hasn't been verified.

## Working and verified

| Area | Evidence |
|---|---|
| Data: 33 science tables from 23 sources in SpacetimeDB, verified row counts | `scripts/publish_spacetime.py` verification (latest: energy_record 1394, molecule 11, dataset_manifest 23) |
| Engine v3: interventions, regional K1 grid, K2 swarms + loads, K3 clocked expansion, B2 body, B4 window/room, B6 device | `npm run test:engine`: 24/24 (incl. free building, Barrow micro→macro, civilisation limits) |
| SpacetimeDB authoritative module: sessions, roles, visibility rules, validated `submit_command`, in-module projection, dependency edges, scheduled clock, jobs/leases | `npm run test:stdb`: 9/9 (A–I) |
| Grok Imagine worker (claim → render → complete; stale rejection) | CLI smoke job `done` with a labelled asset; STDB-G |
| Browser: all six spec scenarios through the voice/chat tool path | `node tests/e2e/levels.mjs`: 7/7, no page errors |
| Free building: any body or star as a host (Dyson swarm/sphere, surface collectors, orbital ring, gas harvester, habitat); focus on any object | engine `structures.test.ts` 5/5; `npm run test:grok`: 5/5 real-Grok free-form requests (incl. "take me to the moon, i want to harness its power") |
| **Grok Voice through the microphone path** (fake-mic WAV → realtime → tools → SpacetimeDB → spoken reply) | `npm run test:voice`: PASS (events tagged `voice`) |
| K2/K3 civilisation layers (structures, traffic, colony ships, near-camera swarms, galaxy lighting) | `tests/e2e/civ_smoke.mjs`: no page errors |
| Barrow civilisations as zoom stacks (B2 town → person → blood → haemoglobin → gene; B4 city → room → lattice → atom; B6 grid → reactor → collision) with micro controls at each depth and macro outcomes (population health, city lighting + cooling, districts lit) | engine `barrow.test.ts` 4/4; `tests/e2e/barrow.mjs` 25/25 (dock navigation, every depth, gene-panel base edit, lattice ions, p p̄) |
| Civilisation limits enforced in SpacetimeDB (reach: K1 Earth+Moon, K2 Solar System, K3 any star; energy budgets 2×10¹⁷ / 3.9×10²⁶ / 10³⁷ W; Barrow depth B2/B4/B6) with suggested level on rejection | engine `feasibility.test.ts` 5/5 |
| Grok Voice agent across civilisation levels (builds what's possible, refuses what isn't with reason + level, never self-escalates, refuses FTL / perpetual motion) | `tests/e2e/voice_matrix.mjs` 17/17 (realtime voice session); mic-path rejection test PASS |
| Typecheck and production build | `tsc` clean (engine, module, web); `vite build` OK |

## Not verified by me (owner to test)

- **Grok Voice with your physical microphone and room acoustics.** The full pipeline is verified with a synthesized spoken WAV fed as the microphone.
- **Visuals of the new Body, Room, Lattice and Device scenes, and the region and beam overlays.** These were checked for runtime errors only.
- **Presenter/follow mode across two browsers.**
- **Command resend after a network drop.** The logic exists; it has no automated test.

## Next candidates

- More clickable scene objects (individual facilities, stars).
- Country-level K1 regions.
- Measured optical spectra for B4.
- Additional time-dependent levels (for example K2 construction over time).
