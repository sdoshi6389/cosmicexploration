import { motion } from 'motion/react';
import { sup } from '../lib/format';
import { RAIL_STOPS as STOPS, STOP_BY_ID } from '../navigation/stops';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';

/** Vertical powers-of-ten rail: every stop, its scale, and whether its level has a committed scenario. */
export function ScaleRail() {
  const stop = useUi((s) => s.stop);
  const goTo = useUi((s) => s.goTo);
  const scenarios = useWorld((s) => s.outputs);
  const cur = STOP_BY_ID[stop];
  const activeId = cur.civ ? STOPS.find((s) => s.civ === cur.civ)!.id : stop;
  const activeIdx = STOPS.findIndex((s) => s.id === activeId);
  return (
    <nav
      aria-label="Scale journey"
      style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', zIndex: 20, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ position: 'absolute', left: 17, top: 14, bottom: 14, width: 1, background: 'linear-gradient(180deg, transparent, var(--line-strong), transparent)' }} />
      <motion.div
        animate={{ top: activeIdx * 40 + 8 }}
        transition={{ type: 'spring', stiffness: 160, damping: 22 }}
        style={{ position: 'absolute', left: 8, width: 20, height: 20, borderRadius: 20, border: '1px solid var(--cyan)', boxShadow: '0 0 18px rgba(92,225,255,0.6)' }}
      />
      {STOPS.map((s, i) => {
        const active = s.id === activeId;
        const done = s.level ? Boolean(scenarios?.[s.level]) : false;
        const color = s.family === 'B' ? 'var(--violet)' : s.family === 'K' ? 'var(--amber)' : 'var(--cyan)';
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => goTo(s.id)}
            title={`${s.name} · ${s.subtitle} (key ${i + 1})`}
            style={{ display: 'flex', alignItems: 'center', gap: 12, height: 36, background: 'none', border: 'none', padding: 0, color: 'inherit', textAlign: 'left' }}
          >
            <span
              style={{
                position: 'relative', width: 36, height: 36, display: 'grid', placeItems: 'center',
              }}
            >
              <span
                style={{
                  width: active ? 9 : 6, height: active ? 9 : 6, borderRadius: 9, background: active ? 'var(--cyan)' : done ? color : 'var(--faint)',
                  boxShadow: active ? '0 0 14px var(--cyan)' : done ? `0 0 10px ${color}` : 'none', transition: 'all .2s',
                }}
              />
            </span>
            <span style={{ opacity: active ? 1 : 0.62, transition: 'opacity .2s' }}>
              <span className="mono" style={{ fontSize: 10, color: active ? 'var(--cyan)' : 'var(--muted)', display: 'block', lineHeight: 1 }}>
                10{sup(s.exp)} m
              </span>
              <span style={{ fontSize: 12.5, fontWeight: active ? 600 : 500, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                {s.name}
                {s.badge ? (
                  <span className="mono" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 5, border: `1px solid ${color}`, color, opacity: done || active ? 1 : 0.6 }}>
                    {s.badge}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
