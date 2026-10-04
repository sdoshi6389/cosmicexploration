import { chat, fail, json } from './_lib/xai';

/** One Grok planning step: returns text and/or tool calls; the browser executes tools. */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { system?: string; messages?: unknown[]; tools?: unknown[] };
    if (typeof body.system !== 'string') return json({ detail: 'system is required' }, 422);
    const messages = body.messages ?? [];
    if (messages.length > 60) return json({ detail: 'conversation too long' }, 413);
    const m = await chat(body.system.slice(0, 24000), messages, body.tools ?? null);
    return json({ message: { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls ?? null } });
  } catch (e) {
    return fail(e);
  }
}
