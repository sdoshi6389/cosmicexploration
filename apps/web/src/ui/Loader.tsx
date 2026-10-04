import { AnimatePresence, motion } from 'motion/react';
import { useScience } from '../state/science';

export function Loader() {
  const phase = useScience((s) => s.phase);
  const log = useScience((s) => s.log);
  const error = useScience((s) => s.error);
  const show = phase !== 'ready';
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="loader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(12px)' }}
          transition={{ duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at 50% 40%, #0a1430 0%, #02040a 70%)' }}
        >
          <div style={{ width: 'min(560px, 90vw)' }}>
            <motion.div
              initial={{ opacity: 0, letterSpacing: '0.9em' }}
              animate={{ opacity: 1, letterSpacing: '0.42em' }}
              transition={{ duration: 1.6, ease: [0.2, 0.8, 0.2, 1] }}
              className="display"
              style={{ fontSize: 46, fontWeight: 800, textAlign: 'center', color: '#eef8ff', textShadow: '0 0 40px rgba(92,225,255,0.55)' }}
            >
              COSMOS
            </motion.div>
            <div className="mono" style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.35em', color: 'var(--cyan)', marginTop: 10 }}>
              MULTISCALE UNIVERSE SANDBOX
            </div>
            <div style={{ height: 2, margin: '28px 0 18px', borderRadius: 2, background: 'linear-gradient(90deg, transparent, rgba(92,225,255,0.9), transparent)', backgroundSize: '200% 100%', animation: 'shimmer 1.8s linear infinite', opacity: phase === 'error' ? 0.2 : 1 }} />
            <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.9, minHeight: 150 }}>
              {log.map((l, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} style={{ color: l.ok === false ? 'var(--red)' : l.ok ? 'var(--text-2)' : 'var(--muted)' }}>
                  <span style={{ color: l.ok === false ? 'var(--red)' : l.ok ? 'var(--green)' : 'var(--cyan)', marginRight: 10 }}>{l.ok === false ? '✗' : l.ok ? '✓' : '›'}</span>
                  {l.text}
                </motion.div>
              ))}
            </div>
            {error ? (
              <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 12.5 }}>
                The baseline could not be assembled: {error}. Run <span className="mono">python scripts/ingest/pipeline.py</span> to rebuild the cache.
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
