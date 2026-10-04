import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, History, Mic, MicOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sendCommand } from '../ai/chat';
import { voice } from '../ai/voice';
import { useUi } from '../state/ui';

const SUGGESTIONS: Record<string, string[]> = {
  earth: ['Reach Kardashev I with an orbital sunshade', 'Build 500 terawatts of new capacity'],
  solar: ['Build a Dyson swarm capturing 40% at 0.7 AU', 'Move the swarm outside Earth\'s orbit'],
  galaxy: ['Expand across the galaxy at 0.2c for 60,000 years', 'Compare with slow generation ships'],
  cosmic: ['Take me back to the Milky Way'],
  cell: ['Introduce the sickle-cell variant', 'Repair the HBB gene'],
  molecule: ['Zoom into a hydrogen atom'],
  atom: ['Show the Balmer alpha transition', 'Excite the electron to a 4f orbital'],
  nucleus: ['Trigger a beta-plus decay'],
  particle: ['Annihilate at 1 GeV per beam', 'Collide at the muon threshold'],
};

export function CommandDeck() {
  const [text, setText] = useState('');
  const [history, setHistory] = useState(false);
  const transcript = useUi((s) => s.transcript);
  const status = useUi((s) => s.voice);
  const level = useUi((s) => s.micLevel);
  const stop = useUi((s) => s.stop);
  const input = useRef<HTMLInputElement>(null);
  const live = status !== 'off' && status !== 'error';

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) {
        if (voice.active) voice.stop();
        else void voice.start();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const recent = transcript.slice(-4);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void sendCommand(t);
  };
  const statusLabel: Record<string, string> = {
    off: 'Voice off', connecting: 'Connecting…', live: 'Listening', listening: 'Hearing you', thinking: 'Thinking', speaking: 'Speaking', offline: 'Browser speech (offline)', error: 'Voice error',
  };

  return (
    <div style={{ position: 'absolute', left: '50%', bottom: 22, transform: 'translateX(-50%)', width: 'min(720px, calc(100vw - 840px))', minWidth: 420, zIndex: 24 }}>
      <AnimatePresence>
        {(history ? transcript.slice(-18) : recent).length ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={history ? 'glass scroll' : ''} style={{ marginBottom: 10, maxHeight: history ? 340 : undefined, padding: history ? 12 : 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(history ? transcript.slice(-18) : recent).map((l) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  alignSelf: l.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '86%',
                  padding: l.role === 'tool' || l.role === 'system' ? '3px 9px' : '7px 11px',
                  borderRadius: 11,
                  fontSize: l.role === 'tool' || l.role === 'system' ? 11 : 12.8,
                  fontFamily: l.role === 'tool' ? 'var(--mono)' : undefined,
                  background: l.role === 'user' ? 'rgba(92,225,255,0.14)' : l.role === 'assistant' ? 'rgba(10,16,30,0.78)' : 'rgba(10,16,30,0.5)',
                  border: `1px solid ${l.role === 'user' ? 'rgba(92,225,255,0.3)' : l.role === 'tool' ? 'rgba(79,240,176,0.25)' : 'var(--line)'}`,
                  color: l.role === 'tool' ? 'var(--green)' : l.role === 'system' ? 'var(--muted)' : 'var(--text)',
                  backdropFilter: 'blur(14px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                {l.text}
                {l.streaming ? <span style={{ animation: 'blink 1s infinite', marginLeft: 2 }}>▍</span> : null}
              </motion.div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 18 }}>
        <button
          type="button"
          onClick={() => (voice.active ? voice.stop() : void voice.start())}
          title={live ? 'Stop Grok Voice (V)' : 'Talk to COSMOS with Grok Voice (V)'}
          style={{ position: 'relative', width: 46, height: 46, borderRadius: 46, border: 'none', flex: 'none', display: 'grid', placeItems: 'center', background: live ? 'radial-gradient(circle, rgba(92,225,255,0.55), rgba(92,225,255,0.12))' : 'rgba(255,255,255,0.05)', color: live ? '#eafcff' : 'var(--text-2)', boxShadow: live ? '0 0 26px rgba(92,225,255,0.5)' : 'inset 0 0 0 1px var(--line)' }}
        >
          {live ? (
            <>
              <span style={{ position: 'absolute', inset: -4, borderRadius: 60, border: '1px solid rgba(92,225,255,0.6)', transform: `scale(${1 + level * 0.9})`, transition: 'transform 80ms linear' }} />
              {status === 'speaking' ? <span style={{ position: 'absolute', inset: 0, borderRadius: 46, border: '1px solid rgba(92,225,255,0.8)', animation: 'pulse-ring 1.4s ease-out infinite' }} /> : null}
            </>
          ) : null}
          {live ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') input.current?.blur();
            }}
            placeholder={`Tell COSMOS what to do — e.g. "${SUGGESTIONS[stop]?.[0] ?? 'Go to the galaxy'}"`}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', overflow: 'hidden' }}>
            <span className="mono" style={{ fontSize: 10, color: live ? 'var(--cyan)' : 'var(--faint)', whiteSpace: 'nowrap' }}>{statusLabel[status]}</span>
            {(SUGGESTIONS[stop] ?? []).map((s) => (
              <button key={s} type="button" onClick={() => void sendCommand(s)} className="chip" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font)', fontSize: 10.5 }}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn icon" title="Conversation history" onClick={() => setHistory((v) => !v)}><History size={15} /></button>
        <button type="button" className="btn primary" onClick={submit} disabled={!text.trim()}><CornerDownLeft size={14} /> Send</button>
      </div>
    </div>
  );
}
