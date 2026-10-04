# COSMOS

A multiscale universe simulator grounded in real scientific data. You can:

- run Kardashev scenarios: K1 planet grid, K2 Dyson swarm with habitats, K3 galactic expansion;
- run Barrow micro→macro scenarios: B2 gene → oxygen delivery, B4 window film → room light, B6 annihilation device → lights;
- drive everything from the UI, chat, or **Grok Voice**.

**SpacetimeDB is the authoritative world state.** Every change is a validated reducer command, models run inside the module, and every connected client sees the same result. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how this works and [docs/AUDIT.md](docs/AUDIT.md) for requirement status.

## Run it

```powershell
npm install
# backend: xAI gateway (chat, voice tokens) + Grok Imagine job worker
cd backend; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt; cd ..
npm run dev:api        # :8000 — needs XAI_API_KEY in .env
npm run dev:web        # :5173
```

Open http://localhost:5173.

- **Your first session.** The first visit creates a session and its main branch in SpacetimeDB.
- **Sharing.** Open the **Worlds** tab and copy the editor or viewer link. Anyone who opens it joins the same live world.
- **Worker registration (one-time).** On first start the worker creates its own SpacetimeDB identity and logs a `register_worker` command. Run that once with the admin CLI identity.

## Try the scenarios

| Level | Say or type | Then |
|---|---|---|
| K1 | "Build a global solar network, increase its capacity, and show which regions have an energy surplus" | Region badges on Earth; Results → regions |
| K2 | "Build a Dyson swarm around the Sun, capture 30 percent of its output, and allocate power to a habitat near Mars" | Power beam to Mars, served fraction |
| K3 | "Expand from our Solar System at 10 percent of light speed, settle each system after 50 years, and build swarms around settled stars" | Clock bar: play, pause, scrub |
| B2 | "Show this mutation, apply the reference sequence in this branch, and zoom out to show the modelled change in oxygen delivery" | Body ⇄ cell zoom |
| B4 | "Change this window's microscopic configuration to increase transparency, then zoom out and show how the room changes" | Room ⇄ lattice zoom |
| B6 | "Increase the interaction rate in this device, show the usable power and heat, and use the output to power these lights" | Gross / electrical / heat / net, lamps lit |

It's a free-building sandbox: "take me to Betelgeuse", "harness the Moon", "put a Dyson sphere around Vega", "build a habitat on Europa powered by Jupiter". You can also click any planet, moon or star and build there.

Follow-ups work: "increase that", "change its material to nickel oxide", "undo the last change", "compare with the parent", "imagine this". If a reference is ambiguous, COSMOS asks which one you mean.

## Tests

```powershell
npm run test:engine          # deterministic engine scenarios (real data)
npm run test:stdb            # live SpacetimeDB authority tests A–I (two+ real clients)
npm run test:e2e             # browser end-to-end per level + civilisation smoke (dev servers running)
npm run test:grok            # real Grok free-form building requests
npm run test:voice           # Grok Voice via a fake microphone (spoken WAV)
```

## Layout

```
apps/web            React + R3F client (subscriptions, scenes, panels, voice/chat tools)
packages/engine     Deterministic simulation engine (shared by browser and SpacetimeDB module)
spacetimedb/src     Module: science tables, authoritative world tables, reducers, RLS, clock, jobs
backend             FastAPI: xAI chat/voice tokens + Imagine worker
scripts/ingest      23-source ingestion pipeline → data/normalized → SpacetimeDB
tests               integration (SpacetimeDB) + e2e (Playwright)
docs                ARCHITECTURE, AUDIT, DESIGN, BUILD_STATUS, DEMO
```

The xAI key stays server-side in `.env`. The browser only ever receives short-lived voice client secrets.
