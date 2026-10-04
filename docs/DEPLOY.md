# Deploying COSMOS (Vercel + SpacetimeDB maincloud)

**Who this is for:** whoever deploys or operates the hosted app.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Web app (React/Three.js, engine) | Vercel static hosting | `apps/web/dist`, vendor chunks cached for one year |
| Authoritative world + multiplayer | SpacetimeDB maincloud (`cosmicexploration-dejjt`) | Browsers connect directly over WebSocket; nothing extra to host |
| `/api/chat` | Vercel function | Grok text with tools. Key stays server-side. |
| `/api/voice/session` | Vercel function | Mints short-lived Grok Voice client secrets |
| `/api/imagine/run` | Vercel function (on demand, ≤60 s) | Acts as the registered worker identity: claim → render → store → `complete_job` (stale results rejected by SpacetimeDB) |
| `/api/health` | Vercel function | Shows which secrets are configured, without revealing them |

The Python backend (`backend/`) is only for local development. It is excluded from the deployment by `.vercelignore`.

## One-time setup

```powershell
npx vercel login
npx vercel link                 # create/link the project (repo root; vercel.json sets build + output)
node scripts/vercel_env.mjs     # pushes XAI_API_KEY and SPACETIME_WORKER_TOKEN (values never printed)
```

Optional, but recommended: in the Vercel dashboard, open **Storage → Blob**, create a store, and connect it to the project. This adds `BLOB_READ_WRITE_TOKEN`, so Imagine renders are stored permanently. Without it, the app uses xAI's hosted image URL.

## Deploy

```powershell
npx vercel --prod
```

Then open `https://<your-project>.vercel.app/api/health` and check that `xai_configured` and `imagine_worker` are `true`.

## Multiplayer

Open the app and set your name. Click **Invite** at the top to copy an editor link; anyone who opens it joins the same live world. Each explorer then:

- sees the others as coloured avatars in the scene, and can click one to jump to their view;
- gets notifications when someone builds something;
- can follow a presenter across civilisations.

Every client's state comes from the same SpacetimeDB tables, scoped by row-level security to session members.

## Module changes

```powershell
npm run publish:module
spacetime generate --lang typescript -o apps/web/src/module_bindings -p ./spacetimedb --yes
npx vercel --prod
```
