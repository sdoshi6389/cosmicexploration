import { useUi } from '../state/ui';
import { parseIntent } from './intent';
import { activeCiv, CIV_NAME, contextSnapshot, executeTool, SYSTEM_INSTRUCTIONS, TOOLS, toolCatalog } from './tools';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const history: ChatMessage[] = [];
let lastCiv: string | null | undefined;
let busy = false;

function toolChip(name: string, args: Record<string, unknown>, result: Record<string, unknown>): string {
  const a = Object.keys(args).length ? ` ${JSON.stringify(args).slice(0, 120)}` : '';
  return `${result.ok === false ? '✗' : '▶'} ${name}${a}${result.ok === false ? ` — ${String(result.error ?? (result.errors as string[] | undefined)?.join('; '))}` : ''}`;
}

/** Send a text command: Grok tool loop via the backend, falling back to the offline parser. */
export async function sendCommand(text: string): Promise<void> {
  const ui = useUi.getState();
  const trimmed = text.trim();
  if (!trimmed || busy) return;
  busy = true;
  ui.say('user', trimmed);
  // Tell the model explicitly when the user has moved to another civilisation.
  const civ = activeCiv();
  const tag = `[Now in: ${civ ? CIV_NAME[civ] : 'exploration view (no civilisation)'}]`;
  if (civ !== lastCiv && lastCiv !== undefined) history.push({ role: 'system', content: `Context update: the user switched civilisation. ${tag} Earlier refusals no longer apply; re-check with tools.` });
  lastCiv = civ;
  history.push({ role: 'user', content: `${tag} ${trimmed}` });
  try {
    const ok = await grokLoop();
    if (!ok) await offline(trimmed);
  } finally {
    busy = false;
  }
}

async function grokLoop(): Promise<boolean> {
  const ui = useUi.getState();
  const tools = TOOLS.map((t) => ({ type: 'function', function: t }));
  for (let round = 0; round < 5; round++) {
    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `${SYSTEM_INSTRUCTIONS}\n\nCATALOG\n${toolCatalog()}\n\nCURRENT CONTEXT\n${JSON.stringify(contextSnapshot())}`,
          messages: history.slice(-24),
          tools,
        }),
      });
    } catch (e) {
      ui.say('system', `Grok unreachable (${e instanceof Error ? e.message : 'network error'}) — using the offline command parser.`);
      return false;
    }
    if (!res.ok) {
      if (round === 0) {
        const detail = (await res.json().catch(() => ({}))) as { detail?: string };
        ui.say('system', `Grok request failed (HTTP ${res.status}${detail.detail ? `: ${detail.detail}` : ''}) — using the offline command parser. Check /api/health and the XAI_API_KEY environment variable.`);
        return false;
      }
      ui.say('system', `Grok request failed (${res.status}).`);
      return true;
    }
    const body = (await res.json()) as { message?: ChatMessage };
    const msg = body.message;
    if (!msg) return round > 0;
    history.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await executeTool(call.function.name, args, 'chat');
        ui.say('tool', toolChip(call.function.name, args, result));
        history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
      continue;
    }
    if (msg.content) ui.say('assistant', msg.content);
    return true;
  }
  return true;
}

async function offline(text: string): Promise<void> {
  const ui = useUi.getState();
  const intents = parseIntent(text);
  if (!intents.length) {
    ui.say('assistant', 'Grok is offline and I could not map that locally. Try "build a Dyson swarm capturing 40%", "expand across the galaxy at 0.2c", "repair the HBB gene", "Balmer alpha", "annihilate at 1 GeV", "undo" or "go to the atom".');
    return;
  }
  for (const it of intents) {
    const result = await executeTool(it.tool, it.args, 'chat');
    ui.say('tool', toolChip(it.tool, it.args, result));
    const summary = result.summary ? ` ${Object.entries(result.summary as Record<string, unknown>).map(([k, v]) => `${k} ${typeof v === 'number' ? Number(v.toPrecision(4)) : v}`).join(' · ')}` : '';
    ui.say('assistant', result.ok === false ? `Couldn't do that: ${String(result.error ?? (result.errors as string[] | undefined)?.join('; '))}` : `Done (offline parser).${summary}`);
  }
}
