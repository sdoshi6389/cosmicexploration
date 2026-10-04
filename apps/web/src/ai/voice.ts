import { useUi } from '../state/ui';
import { parseIntent } from './intent';
import { activeCiv, CIV_NAME, contextSnapshot, executeTool, SYSTEM_INSTRUCTIONS, TOOLS, toolCatalog } from './tools';

const RATE = 24000;

/** AudioWorklet: downmix + float→PCM16, posted in ~40 ms frames. */
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(960); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      peak = Math.max(peak, Math.abs(s));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) {
        this.port.postMessage({ pcm: this.buf.buffer.slice(0), peak });
        this.n = 0; peak = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

function b64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function bufferFromB64(b64: string): Int16Array {
  const raw = atob(b64);
  const out = new Int16Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
  return out;
}

class VoiceSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private playhead = 0;
  private sources: AudioBufferSourceNode[] = [];
  private userLine: string | null = null;
  private assistantLine: string | null = null;
  private assistantText = '';
  private pendingOutputs = 0;
  private unsubCiv: (() => void) | null = null;
  private inFlight = 0;
  private responseDone = false;
  private toolQueue: Promise<unknown> = Promise.resolve();
  private recognition: { stop: () => void } | null = null;

  get active(): boolean {
    return this.ws !== null || this.recognition !== null;
  }

  async start(): Promise<void> {
    const ui = useUi.getState();
    ui.setVoice('connecting');
    try {
      const res = await fetch('/api/voice/session', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { clientSecret?: string; model?: string; websocketUrl?: string; voice?: string; detail?: string };
      if (!res.ok || !body.clientSecret) throw new Error(body.detail ?? `voice session HTTP ${res.status}`);
      await this.openAudio();
      const url = `${body.websocketUrl ?? 'wss://api.x.ai/v1/realtime'}?model=${encodeURIComponent(body.model ?? 'grok-voice-latest')}`;
      const ws = new WebSocket(url, [`xai-client-secret.${body.clientSecret}`]);
      this.ws = ws;
      let lastCiv = activeCiv();
      this.unsubCiv?.();
      this.unsubCiv = useUi.subscribe((st, prev) => {
        if (st.stop === prev.stop) return;
        const civ = activeCiv();
        if (civ === lastCiv) return;
        lastCiv = civ;
        this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Context update: the user switched to the ${civ ? CIV_NAME[civ] : 'exploration view'}. Earlier refusals no longer apply; re-check with tools.` }] } });
      });
      ws.onopen = () => {
        this.send({
          type: 'session.update',
          session: {
            voice: body.voice ?? 'eve',
            instructions: `${SYSTEM_INSTRUCTIONS}\n\nCATALOG\n${toolCatalog()}\n\nCONTEXT AT CONNECT\n${JSON.stringify(contextSnapshot())}\nCall get_context whenever you need fresh state.`,
            turn_detection: { type: 'server_vad' },
            audio: {
              input: { format: { type: 'audio/pcm', rate: RATE }, transcription: { language_hint: 'en', keyterms: ['Kardashev', 'Barrow', 'Dyson', 'Gaia', 'haemoglobin', 'HBB', 'Lyman', 'Balmer', 'positron', 'annihilation'] } },
              output: { format: { type: 'audio/pcm', rate: RATE } },
            },
            tools: TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
          },
        });
        ui.setVoice('live');
        ui.say('system', 'Grok Voice connected — just speak. Tools execute against your world.');
      };
      ws.onmessage = (ev) => void this.onMessage(ev.data);
      ws.onerror = () => ui.toast({ kind: 'error', title: 'Voice connection error' });
      ws.onclose = () => {
        if (this.ws === ws) this.stop(false);
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ui.say('system', `Grok Voice unavailable (${msg}). Falling back to browser speech recognition + offline intents.`);
      this.startOffline();
    }
  }

  stop(announce = true): void {
    this.unsubCiv?.();
    this.unsubCiv = null;
    this.ws?.close();
    this.ws = null;
    this.recognition?.stop();
    this.recognition = null;
    this.stopPlayback();
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    useUi.getState().setVoice('off');
    useUi.getState().setMicLevel(0);
    if (announce) useUi.getState().say('system', 'Voice disconnected.');
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private async openAudio(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.ctx = new AudioContext({ sampleRate: RATE });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      useUi.getState().setMicLevel(e.data.peak);
      this.send({ type: 'input_audio_buffer.append', audio: b64FromBuffer(e.data.pcm) });
    };
    src.connect(this.node);
    this.playhead = this.ctx.currentTime;
  }

  private play(b64: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pcm = bufferFromB64(b64);
    const buf = ctx.createBuffer(1, pcm.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.playhead);
    src.start(at);
    this.playhead = at + buf.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      if (!this.sources.length && useUi.getState().voice === 'speaking') useUi.getState().setVoice('live');
    };
    useUi.getState().setVoice('speaking');
  }

  /** Barge-in: drop queued audio immediately (committed actions are not undone). */
  private stopPlayback(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (this.ctx) this.playhead = this.ctx.currentTime;
  }

  private async onMessage(data: unknown): Promise<void> {
    if (typeof data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const ui = useUi.getState();
    switch (msg.type) {
      case 'input_audio_buffer.speech_started':
        this.stopPlayback();
        ui.setVoice('listening');
        this.userLine = ui.say('user', '…', { streaming: true });
        break;
      case 'input_audio_buffer.speech_stopped':
        ui.setVoice('thinking');
        break;
      case 'conversation.item.input_audio_transcription.updated':
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(msg.transcript ?? '');
        if (!text) break;
        if (this.userLine) ui.updateLine(this.userLine, text, msg.type.endsWith('completed'));
        else this.userLine = ui.say('user', text);
        break;
      }
      case 'response.created':
        this.assistantText = '';
        this.assistantLine = null;
        break;
      case 'response.output_audio_transcript.delta': {
        this.assistantText += String(msg.delta ?? '');
        if (!this.assistantLine) this.assistantLine = ui.say('assistant', this.assistantText, { streaming: true });
        else ui.updateLine(this.assistantLine, this.assistantText);
        break;
      }
      case 'response.output_audio_transcript.done':
        if (this.assistantLine) ui.updateLine(this.assistantLine, this.assistantText, true);
        break;
      case 'response.output_audio.delta':
        if (typeof msg.delta === 'string') this.play(msg.delta);
        break;
      case 'response.function_call_arguments.done': {
        const name = String(msg.name ?? '');
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(msg.arguments ?? '{}')) as Record<string, unknown>;
        } catch {
          args = {};
        }
        // Serialize tool calls: each command must see the revision produced by the previous one.
        this.inFlight++;
        this.toolQueue = this.toolQueue.then(async () => {
          const result = await executeTool(name, args, 'voice');
          ui.say('tool', `${result.ok === false ? '✗' : '▶'} ${name} ${JSON.stringify(args).slice(0, 110)}`);
          this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: msg.call_id, output: JSON.stringify(result).slice(0, 6000) } });
          this.pendingOutputs++;
          this.inFlight--;
          if (this.inFlight === 0 && this.responseDone) {
            this.responseDone = false;
            this.pendingOutputs = 0;
            this.send({ type: 'response.create' });
          }
        });
        break;
      }
      case 'response.done':
        if (this.inFlight > 0) {
          this.responseDone = true;
        } else if (this.pendingOutputs > 0) {
          this.pendingOutputs = 0;
          this.send({ type: 'response.create' });
        } else if (ui.voice === 'thinking') {
          ui.setVoice('live');
        }
        this.userLine = null;
        break;
      case 'error': {
        const err = msg.error as { message?: string } | undefined;
        ui.toast({ kind: 'error', title: 'Grok Voice error', body: err?.message ?? 'unknown error' });
        break;
      }
      default:
        break;
    }
  }

  /** Dev/test: inject a user turn as text into the live realtime session (same model, instructions and tools). */
  sendText(text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    useUi.getState().say('user', text);
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.send({ type: 'response.create' });
    return true;
  }

  /** True while a response or tool call is in flight. */
  get busy(): boolean {
    return this.inFlight > 0 || useUi.getState().voice === 'thinking' || useUi.getState().voice === 'speaking';
  }

  /** Browser speech recognition → offline intent parser → same tools. */
  private startOffline(): void {
    const ui = useUi.getState();
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SR) {
      ui.setVoice('error');
      ui.toast({ kind: 'error', title: 'No speech recognition available', body: 'Use the command bar instead.' });
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const text = r?.[0]?.transcript ?? '';
      if (!text) return;
      ui.say('user', text);
      void (async () => {
        for (const it of parseIntent(text)) {
          const result = await executeTool(it.tool, it.args, 'voice');
          ui.say('tool', `${result.ok === false ? '✗' : '▶'} ${it.tool} ${JSON.stringify(it.args).slice(0, 110)}`);
        }
      })();
    };
    rec.onend = () => {
      if (this.recognition) rec.start();
    };
    rec.start();
    this.recognition = rec;
    ui.setVoice('offline');
  }
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

export const voice = new VoiceSession();
