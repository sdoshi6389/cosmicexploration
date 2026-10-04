import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { si } from '../lib/format';
import { deeper, depthChain, shallower, STOP_BY_ID } from '../navigation/stops';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';
import { cameraRef } from '../three/Stage';

/**
 * Barrow civilisation HUD: where you are in the zoom stack (human scale → atoms),
 * and the macro consequences of the micro configuration — always visible, at every
 * depth, straight from the authoritative output.
 */
export function CivHud() {
  const stopId = useUi((s) => s.stop);
  const goTo = useUi((s) => s.goTo);
  const stop = STOP_BY_ID[stopId];
  const out = useWorld((s) => (stop.civ ? s.outputs[stop.civ] : undefined));
  useDepthScroll();
  if (!stop.civ) return null;
  const chain = depthChain(stop.civ);
  const sum = out?.summary ?? {};
  const n = (k: string) => Number(sum[k] ?? 0);
  const metrics: [string, string, string?][] =
    stop.civ === 'b2'
      ? [
          ['population', out ? n('population').toLocaleString() : '—'],
          ['mean O₂ delivery', out ? `${(n('meanOxygenDelivery') * 100).toFixed(0)}%` : '100%', out && n('meanOxygenDelivery') < 0.95 ? 'var(--red)' : undefined],
          ['symptomatic', out ? n('symptomatic').toLocaleString() : '0'],
          ['phenotype', String(sum.phenotype ?? 'reference').replace('_', ' ')],
        ]
      : stop.civ === 'b4'
        ? [
            ['transmission', out ? `${(n('transmission') * 100).toFixed(1)}%` : '—'],
            ['room light', out ? `${Math.round(n('roomLux'))} lx` : '—', out && n('roomLux') < 300 ? 'var(--amber)' : undefined],
            ['city energy', out ? si(n('cityEnergyW'), 'W', 2) : '—'],
            ['vs reference', out ? `${n('citySavingW') >= 0 ? '−' : '+'}${si(Math.abs(n('citySavingW')), 'W', 2)}` : '—', out ? (n('citySavingW') >= 0 ? 'var(--green)' : 'var(--red)') : undefined],
          ]
        : [
            ['districts lit', out ? `${(n('cityLitFraction') * 100).toFixed(0)}%` : '0%', out && n('cityLitFraction') < 1 ? 'var(--amber)' : undefined],
            ['electric', out ? si(n('electricalW'), 'W', 2) : '—'],
            ['heat', out ? si(n('heatW'), 'W', 2) : '—'],
            ['net (after antimatter)', out ? si(n('netW'), 'W', 2) : '—', out && n('netW') < 0 ? 'var(--red)' : undefined],
          ];
  const inn = deeper(stopId);
  const outer = shallower(stopId);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 108, zIndex: 23, padding: '8px 12px', width: 'min(760px, calc(100vw - 32px))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="eyebrow" style={{ color: 'var(--violet)' }}>{stop.badge}</span>
        {chain.map((c, i) => (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 ? <span className="faint">›</span> : null}
            <button type="button" className={`btn sm ${c.id === stopId ? 'violet' : 'ghost'}`} style={{ padding: '2px 8px' }} onClick={() => goTo(c.id)}>
              {c.depthLabel}
            </button>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm icon" disabled={!outer} title="Zoom out (scroll out)" onClick={() => outer && goTo(outer)}><ChevronsUp size={14} /></button>
        <button type="button" className="btn sm icon" disabled={!inn} title="Zoom in (scroll in)" onClick={() => inn && goTo(inn)}><ChevronsDown size={14} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginTop: 6 }}>
        {metrics.map(([k, v, c]) => (
          <div key={k}>
            <div className="eyebrow" style={{ fontSize: 9 }}>{k}</div>
            <div className="mono" style={{ fontSize: 14, color: c ?? 'var(--text)' }}>{v}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/**
 * Scroll past the closest zoom to go one level smaller; past the farthest to go one
 * level larger (Barrow civilisations only).
 */
function useDepthScroll() {
  const acc = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const ui = useUi.getState();
      const stop = STOP_BY_ID[ui.stop];
      const c = cameraRef.current;
      if (!stop.civ || ui.transition || !c) return;
      const target = (e.target as HTMLElement | null)?.tagName;
      if (target !== 'CANVAS') return;
      const now = performance.now();
      if (now - last.current > 700) acc.current = 0;
      last.current = now;
      const atMin = c.distance <= stop.camera.minDistance * 1.08;
      const atMax = c.distance >= stop.camera.maxDistance * 0.92;
      if (e.deltaY < 0 && atMin) acc.current -= 1;
      else if (e.deltaY > 0 && atMax) acc.current += 1;
      else return;
      if (acc.current <= -4) {
        acc.current = 0;
        const to = deeper(ui.stop);
        if (to) ui.goTo(to);
      } else if (acc.current >= 4) {
        acc.current = 0;
        const to = shallower(ui.stop);
        if (to) ui.goTo(to);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
}
