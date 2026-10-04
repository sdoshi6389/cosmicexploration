/**
 * Server-side xAI client for the Vercel functions. The API key lives only in the
 * Vercel environment (XAI_API_KEY) — never in the browser bundle.
 */
const BASE = process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1';
export const TEXT_MODEL = process.env.XAI_TEXT_MODEL ?? 'grok-4-1-fast-reasoning';
export const IMAGE_MODEL = process.env.XAI_IMAGE_MODEL ?? 'grok-imagine-image-2.0';
export const VOICE_MODEL = process.env.XAI_VOICE_MODEL ?? 'grok-voice-latest';
export const VOICE = process.env.XAI_VOICE ?? 'eve';

export class XaiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new XaiError(503, 'XAI_API_KEY is not configured on the server');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export async function chat(system: string, messages: unknown[], tools: unknown[] | null): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { model: TEXT_MODEL, messages: [{ role: 'system', content: system }, ...messages], temperature: 0.3 };
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }
  const r = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
  if (!r.ok) throw new XaiError(r.status, `chat completion failed: ${(await r.text()).slice(0, 400)}`);
  const data = (await r.json()) as { choices: { message: Record<string, unknown> }[] };
  return data.choices[0]!.message;
}

export async function image(prompt: string, format: 'b64_json' | 'url'): Promise<{ bytes?: Uint8Array; url?: string; model: string }> {
  const r = await fetch(`${BASE}/images/generations`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, aspect_ratio: '16:9', resolution: '1k', response_format: format }),
  });
  if (!r.ok) throw new XaiError(r.status, `image generation failed: ${(await r.text()).slice(0, 400)}`);
  const data = (await r.json()) as { model?: string; data?: { b64_json?: string; url?: string }[] };
  const item = data.data?.[0] ?? {};
  const model = data.model ?? IMAGE_MODEL;
  if (item.b64_json) return { bytes: Uint8Array.from(Buffer.from(item.b64_json, 'base64')), model };
  if (item.url) return { url: item.url, model };
  throw new XaiError(502, 'image response contained no image data');
}

export async function clientSecret(expiresSeconds = 600): Promise<{ clientSecret: string; expiresAt: unknown }> {
  const r = await fetch(`${BASE}/realtime/client_secrets`, { method: 'POST', headers: headers(), body: JSON.stringify({ expires_after: { seconds: expiresSeconds } }) });
  if (!r.ok) throw new XaiError(r.status, `client secret request failed: ${(await r.text()).slice(0, 400)}`);
  const data = (await r.json()) as Record<string, unknown>;
  let secret = data.value ?? data.client_secret ?? data.clientSecret ?? data.token;
  let expires = data.expires_at ?? data.expiresAt;
  if (secret && typeof secret === 'object') {
    expires = expires ?? (secret as Record<string, unknown>).expires_at;
    secret = (secret as Record<string, unknown>).value;
  }
  if (typeof secret !== 'string') throw new XaiError(502, `unexpected client secret response keys: ${Object.keys(data).join(',')}`);
  return { clientSecret: secret, expiresAt: expires };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export function fail(e: unknown): Response {
  if (e instanceof XaiError) return json({ detail: e.message }, e.status < 600 ? e.status : 502);
  return json({ detail: e instanceof Error ? e.message : String(e) }, 500);
}
