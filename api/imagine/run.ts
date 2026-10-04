import { put } from '@vercel/blob';
import { fail, image, json } from '../_lib/xai.js';

/**
 * On-demand Grok Imagine worker (serverless replacement for the polling worker).
 * The browser pings this after queueing a job. It acts as the registered worker
 * identity (SPACETIME_WORKER_TOKEN): leases queued jobs with `claim_job`, renders
 * the server-built prompt, stores the image (Vercel Blob, or xAI's hosted URL),
 * and calls `complete_job` — which SpacetimeDB rejects as stale if the state changed.
 */
const HOST = process.env.SPACETIME_HOST ?? 'https://maincloud.spacetimedb.com';
const DB = process.env.SPACETIME_DB ?? 'cosmicexploration-dejjt';

function auth(): Record<string, string> {
  const token = process.env.SPACETIME_WORKER_TOKEN;
  if (!token) throw new Error('SPACETIME_WORKER_TOKEN is not configured');
  return { Authorization: `Bearer ${token}` };
}

async function sql(query: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${HOST}/v1/database/${DB}/sql`, { method: 'POST', headers: auth(), body: query });
  if (!r.ok) throw new Error(`SpacetimeDB SQL ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out: Record<string, unknown>[] = [];
  for (const stmt of (await r.json()) as { schema: { elements: { name: unknown }[] }; rows: unknown[][] }[]) {
    const names = stmt.schema.elements.map((e) => (e.name && typeof e.name === 'object' ? (e.name as { some: string }).some : String(e.name)));
    for (const row of stmt.rows) out.push(Object.fromEntries(names.map((n, i) => [n, row[i]])));
  }
  return out;
}

async function call(reducer: string, ...args: unknown[]): Promise<[boolean, string]> {
  const r = await fetch(`${HOST}/v1/database/${DB}/call/${reducer}`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  return [r.ok, await r.text()];
}

async function processJob(job: Record<string, unknown>): Promise<string> {
  const id = String(job.id);
  const [claimed, msg] = await call('claim_job', id, 120);
  if (!claimed) return `claim refused: ${msg.slice(0, 120)}`;
  try {
    const prompt = String((JSON.parse(String(job.payload_json || '{}')) as { prompt?: string }).prompt ?? '').slice(0, 3800);
    const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
    const img = await image(prompt, useBlob ? 'b64_json' : 'url');
    let url = img.url ?? '';
    if (img.bytes) {
      const blob = await put(`cosmos/imagine/${id.replace(/[^a-zA-Z0-9-]/g, '_')}.png`, Buffer.from(img.bytes), { access: 'public', contentType: 'image/png', addRandomSuffix: true });
      url = blob.url;
    }
    const label = `Illustrative concept (Grok Imagine) · ${String(job.level).toUpperCase()} rev ${String(job.revision)} · not a simulation output`;
    const [ok, m] = await call('complete_job', id, url, img.model, label);
    return ok ? 'completed' : `complete refused: ${m.slice(0, 120)}`;
  } catch (e) {
    await call('fail_job', id, String(e instanceof Error ? e.message : e).slice(0, 400));
    return `failed: ${e instanceof Error ? e.message : e}`;
  }
}

export async function POST(): Promise<Response> {
  try {
    const jobs = (await sql("SELECT * FROM calculation_job WHERE status = 'queued'")).filter((j) => j.kind === 'imagine').slice(0, 2);
    const results: Record<string, string> = {};
    for (const j of jobs) results[String(j.id)] = await processJob(j);
    return json({ processed: jobs.length, results });
  } catch (e) {
    return fail(e);
  }
}

export const GET = POST;
