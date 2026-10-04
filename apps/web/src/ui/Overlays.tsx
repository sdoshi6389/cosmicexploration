import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, Sparkles, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sup } from '../lib/format';
import { deeper, RAIL_STOPS as STOPS, shallower, STOP_BY_ID } from '../navigation/stops';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';
import { IN_MS, OUT_MS } from '../three/Stage';

/** Cinematic arrival title. */
export function StopTitle() {
  const displayed = useUi((s) => s.displayedStop);
  const arrival = useUi((s) => s.arrivalId);
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const t = setTimeout(() => setShow(false), 3000);
    return () => clearTimeout(t);
  }, [arrival, displayed]);
  const stop = STOP_BY_ID[displayed];
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key={`${displayed}:${arrival}`}
          initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(8px)' }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ position: 'absolute', left: 0, right: 0, top: '15%', textAlign: 'center', pointerEvents: 'none', zIndex: 15 }}
        >
          <div className="mono" style={{ fontSize: 12, letterSpacing: '0.5em', color: 'var(--cyan)', marginBottom: 10 }}>
            10{sup(stop.exp)} METRES {stop.badge ? `· ${stop.badge}` : ''}
          </div>
          <div className="display" style={{ fontSize: 'clamp(30px, 5vw, 60px)', fontWeight: 800, letterSpacing: '0.18em', textShadow: '0 0 40px rgba(92,225,255,0.35)' }}>
            {stop.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 10, letterSpacing: '0.04em' }}>{stop.blurb}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Rolling scale counter shown during a warp. */
export function TransitionOverlay() {
  const t = useUi((s) => s.transition);
  const [exp, setExp] = useState<number | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!t) {
      setExp(null);
      return;
    }
    const from = STOP_BY_ID[t.from].exp;
    const to = STOP_BY_ID[t.to].exp;
    const total = OUT_MS + IN_MS * 0.6;
    const start = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / total);
      const e = 1 - (1 - p) ** 3;
      setExp(Math.round(from + (to - from) * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [t?.from, t?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AnimatePresence>
      {t && exp !== null ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 30 }}
        >
          <div style={{ textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 64, fontWeight: 800, letterSpacing: '0.06em', color: '#f2fbff', textShadow: '0 0 30px rgba(92,225,255,0.8)' }}>
              10<span style={{ fontSize: 34, verticalAlign: 'super' }}>{exp}</span>
              <span style={{ fontSize: 26, marginLeft: 10, opacity: 0.7 }}>m</span>
            </div>
            <div className="mono" style={{ fontSize: 12, letterSpacing: '0.4em', color: 'var(--cyan)', marginTop: 8 }}>
              {t.direction === 'inward' ? 'DESCENDING' : 'ASCENDING'} → {STOP_BY_ID[t.to].name.toUpperCase()}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const icon = { info: Info, success: CheckCircle2, error: XCircle, warn: AlertTriangle };
  const color = { info: 'var(--cyan)', success: 'var(--green)', error: 'var(--red)', warn: 'var(--amber)' };
  return (
    <div style={{ position: 'absolute', top: 84, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 50, width: 'min(440px, 90vw)' }}>
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icon[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className="glass"
              style={{ display: 'flex', gap: 10, padding: '10px 12px', borderColor: `color-mix(in srgb, ${color[t.kind]} 40%, transparent)` }}
            >
              <Icon size={16} color={color[t.kind]} style={{ marginTop: 1, flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{t.title}</div>
                {t.body ? <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{t.body}</div> : null}
                {t.action ? <button type="button" className="btn sm primary" style={{ marginTop: 6 }} onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button> : null}
              </div>
              <button type="button" className="btn sm icon ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={12} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Grok Imagine card — labelled speculative, tied to the revision that produced it. */
export function ConceptCard() {
  const c0 = useUi((s) => s.concept);
  const setConcept = useUi((s) => s.setConcept);
  const job = useWorld((s) => s.jobs.find((j) => j.id === c0.jobId));
  const asset = useWorld((s) => s.assets.find((a) => a.id === c0.jobId));
  const status = asset ? 'done' : job?.status === 'stale' || job?.status === 'failed' ? 'error' : c0.status;
  const c = {
    ...c0, status, url: asset?.url ?? null, model: asset?.model ?? c0.model, prompt: asset?.prompt ?? job?.prompt ?? c0.prompt,
    revision: asset?.revision ?? job?.revision ?? c0.revision,
    error: job?.status === 'stale' ? `Discarded: ${job.error}` : job?.status === 'failed' ? job.error : c0.error,
  };
  const [zoom, setZoom] = useState(false);
  if (c.status === 'idle') return null;
  const stale = Boolean(asset?.stale);
  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="glass"
        style={{ position: 'absolute', right: 424, bottom: 112, width: 300, padding: 10, zIndex: 22 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Sparkles size={13} color="var(--generated)" />
          <span className="eyebrow" style={{ color: 'var(--generated)' }}>Speculative concept · Grok Imagine</span>
          <button type="button" className="btn sm icon ghost" style={{ marginLeft: 'auto' }} onClick={() => setConcept({ status: 'idle' })} aria-label="Close"><X size={12} /></button>
        </div>
        {c.status === 'running' ? (
          <div style={{ height: 168, borderRadius: 9, background: 'linear-gradient(90deg, rgba(255,122,217,0.05), rgba(255,122,217,0.18), rgba(255,122,217,0.05))', backgroundSize: '200% 100%', animation: 'shimmer 1.6s linear infinite', display: 'grid', placeItems: 'center' }}>
            <span className="mono muted" style={{ fontSize: 11 }}>{job?.status === "leased" ? "worker rendering" : "queued"} · revision {c.revision}…</span>
          </div>
        ) : null}
        {c.status === 'done' && c.url ? (
          <button type="button" onClick={() => setZoom(true)} style={{ padding: 0, border: 'none', background: 'none', width: '100%', position: 'relative' }}>
            <img src={c.url} alt="Speculative concept rendering" style={{ width: '100%', borderRadius: 9, display: 'block', filter: stale ? 'grayscale(0.7) brightness(0.6)' : 'none' }} />
            <span className="chip generated" style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,0.55)' }}>generated</span>
            {stale ? <span className="chip assumed" style={{ position: 'absolute', left: 8, bottom: 8, background: 'rgba(0,0,0,0.6)' }}>stale · rev {c.revision}</span> : null}
          </button>
        ) : null}
        {c.status === 'error' ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{c.error}</div> : null}
        <div className="mono faint" style={{ fontSize: 10, marginTop: 6 }}>
          {c.level?.toUpperCase()} · rev {c.revision} · {c.model ?? 'grok-imagine'} · job {job?.status ?? 'queued'} · {asset?.label ?? 'illustrative, not evidence'}
        </div>
      </motion.div>
      <AnimatePresence>
        {zoom && c.url ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoom(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(2,4,10,0.85)', zIndex: 60, display: 'grid', placeItems: 'center', cursor: 'zoom-out' }}>
            <div style={{ maxWidth: '82vw', textAlign: 'center' }}>
              <img src={c.url} alt="Speculative concept rendering" style={{ maxWidth: '82vw', maxHeight: '78vh', borderRadius: 14, boxShadow: '0 30px 90px rgba(0,0,0,0.7)' }} />
              <div className="muted" style={{ fontSize: 12, marginTop: 12, maxWidth: 820 }}>{c.prompt}</div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export function HelpOverlay() {
  const open = useUi((s) => s.helpOpen);
  const setHelp = useUi((s) => s.setHelp);
  const rows: [string, string][] = [
    ['1 – 9', 'Jump between scale stops'],
    ['← / →', 'Previous / next stop on the journey'],
    ['Enter', 'Focus the command bar'],
    ['V', 'Toggle Grok Voice'],
    ['C', 'Toggle mission console'],
    ['Ctrl + Z / Ctrl + Y', 'Undo / redo in this world'],
    ['?', 'This help'],
  ];
  return (
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHelp(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(2,4,10,0.7)', zIndex: 70, display: 'grid', placeItems: 'center' }}>
          <motion.div initial={{ y: 10 }} animate={{ y: 0 }} className="glass brackets" style={{ width: 'min(560px, 92vw)', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div className="display" style={{ fontSize: 16, letterSpacing: '0.2em', marginBottom: 6 }}>COSMOS CONTROLS</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 16, lineHeight: 1.6 }}>
              Explore real datasets from galaxies to particles. Each K/B stop has an executable intervention: configure it in the Mission tab (sliders preview live), press Execute, then inspect Results, the Civilisation codex, editable Assumptions and Sources. Every action is a branch event persisted in SpacetimeDB — fork, compare, undo and reset freely. Speak or type commands; Grok executes them through the same validated tools.
            </div>
            {rows.map(([k, d]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
                <span className="muted">{d}</span>
                <span className="kbd">{k}</span>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 11, marginTop: 14 }}>
              Legend: <span style={{ color: 'var(--obs)' }}>observed</span> · <span style={{ color: 'var(--derived)' }}>derived</span> · <span style={{ color: 'var(--assumed)' }}>assumed</span> · <span style={{ color: 'var(--simulated)' }}>simulated</span> · <span style={{ color: 'var(--illustrative)' }}>illustrative</span> · <span style={{ color: 'var(--generated)' }}>generated</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function useJourneyKeys() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ui = useUi.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useWorld.getState().undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useWorld.getState().redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= STOPS.length) ui.goTo(STOPS[n - 1]!.id);
      const cur = STOP_BY_ID[ui.stop];
      if (cur.civ && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const to = e.key === 'ArrowDown' ? deeper(ui.stop) : shallower(ui.stop);
        if (to) ui.goTo(to);
        return;
      }
      const railId = cur.civ ? STOPS.find((s) => s.civ === cur.civ)!.id : ui.stop;
      const idx = STOPS.findIndex((s) => s.id === railId);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ui.goTo(STOPS[Math.min(STOPS.length - 1, idx + 1)]!.id);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ui.goTo(STOPS[Math.max(0, idx - 1)]!.id);
      if (e.key === '?') ui.setHelp(!ui.helpOpen);
      if (e.key.toLowerCase() === 'c') ui.setConsole(!ui.consoleOpen);
      if (e.key === 'Escape') ui.setHelp(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}
