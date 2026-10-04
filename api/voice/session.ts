import { clientSecret, fail, json, VOICE, VOICE_MODEL } from '../_lib/xai.js';

/** Mint a short-lived client secret so the browser can open the Grok Voice WebSocket. */
export async function POST(): Promise<Response> {
  try {
    const s = await clientSecret(600);
    return json({ ...s, model: VOICE_MODEL, voice: VOICE, websocketUrl: 'wss://api.x.ai/v1/realtime' });
  } catch (e) {
    return fail(e);
  }
}
