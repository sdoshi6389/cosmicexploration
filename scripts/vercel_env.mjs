// Push the server-side secrets to your Vercel project without printing them.
//   XAI_API_KEY             ← .env
//   SPACETIME_WORKER_TOKEN  ← backend/.worker_identity.json (the registered Imagine worker identity)
// Run after `npx vercel login` and `npx vercel link`:  node scripts/vercel_env.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const secrets = { XAI_API_KEY: env.XAI_API_KEY };
if (existsSync('backend/.worker_identity.json')) secrets.SPACETIME_WORKER_TOKEN = JSON.parse(readFileSync('backend/.worker_identity.json', 'utf8')).token;

for (const [name, value] of Object.entries(secrets)) {
  if (!value) {
    console.log(`skip ${name} (not found locally)`);
    continue;
  }
  for (const target of ['production', 'preview']) {
    try {
      execFileSync('npx', ['vercel', 'env', 'rm', name, target, '--yes'], { stdio: 'ignore', shell: true });
    } catch { /* not set yet */ }
    execFileSync('npx', ['vercel', 'env', 'add', name, target], { input: value, stdio: ['pipe', 'ignore', 'inherit'], shell: true });
    console.log(`set ${name} for ${target}`);
  }
}
console.log('Done. Optional: create a Blob store in the Vercel dashboard (Storage → Blob → connect to this project) so Imagine renders are stored permanently.');
