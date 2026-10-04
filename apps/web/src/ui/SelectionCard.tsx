import { resolveEntity, STRUCTURE_TYPES } from '@cosmos/engine';
import { Crosshair, Hammer, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { si } from '../lib/format';
import { useUi } from '../state/ui';
import { toastRejection, useWorld } from '../state/world';

const GIANTS = new Set(['body.jupiter', 'body.saturn', 'body.uranus', 'body.neptune']);

/**
 * Free building from the scene: select any planet, moon or star, then build on it.
 * Every button goes through the same validated command as voice and chat.
 */
export function SelectionCard() {
  const sel = useUi((s) => s.selection);
  const select = useUi((s) => s.select);
  const focusOn = useUi((s) => s.focusOn);
  const toast = useUi((s) => s.toast);
  const world = useWorld((s) => s.world);
  const role = useWorld((s) => s.role);
  const pending = useWorld((s) => s.pending);
  const k2v = useWorld((s) => s.outputs.k2?.view) as { structures?: { hostId: string; label: string; usefulW: number; type: string }[] } | null | undefined;
  const k3v = useWorld((s) => s.outputs.k3?.view) as { structures?: { hostId: string; label: string; usefulW: number; type: string }[] } | null | undefined;
  const structures = useMemo(() => [...(k2v?.structures ?? []), ...(k3v?.structures ?? [])], [k2v, k3v]);
  const [coverage, setCoverage] = useState(0.1);
  const consoleOpen = useUi((s) => s.consoleOpen);
  const stop = useUi((s) => s.stop);
  if (!sel || (sel.kind !== 'body' && sel.kind !== 'star') || !world) return null;
  const e = resolveEntity(world.ctx.science, sel.id);
  if (!e) return null;
  // Only offer builds inside the civilisation that owns this object.
  if (!((stop === 'galaxy') || (stop === 'solar' && e.system === 'sol'))) return null;
  const isStar = e.kind === 'star';
  const types = STRUCTURE_TYPES.filter((t) => t.hosts === 'any' || (isStar ? t.hosts === 'star' : t.hosts === 'body' ? !(t.value === 'surface_collectors' && GIANTS.has(e.id)) : t.hosts === 'giant' && GIANTS.has(e.id)));
  const here = structures.filter((s) => s.hostId === e.id);
  const build = async (type: string) => {
    const r = await useWorld.getState().createIntervention('build.structure', { hostId: e.id, type, coverage }, { source: 'ui' });
    if (r.status === 'applied') {
      toast({ kind: 'success', title: `Building at ${e.name}`, body: `${type.replace('_', ' ')} · computed in SpacetimeDB` });
      focusOn(e.id);
    } else toastRejection(`Can't build at ${e.name}`, r);
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass" style={{ position: 'absolute', right: consoleOpen ? 424 : 18, bottom: 112, width: 300, padding: 12, zIndex: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="eyebrow" style={{ color: 'var(--cyan)', flex: 1 }}>{e.kind} · {e.system === 'sol' ? 'Solar System' : 'interstellar'}</span>
        <button type="button" className="btn sm icon ghost" onClick={() => focusOn(e.id)} title="Fly to"><Crosshair size={13} /></button>
        <button type="button" className="btn sm icon ghost" onClick={() => select(null)} aria-label="Close"><X size={13} /></button>
      </div>
      <div className="h-title" style={{ fontSize: 16 }}>{e.name}</div>
      <div className="mono muted" style={{ fontSize: 10.5, marginBottom: 8 }}>
        {e.distance.toFixed(e.distanceUnit === 'AU' ? 2 : 1)} {e.distanceUnit} from the Sun
        {e.radiusKm ? ` · R ${Math.round(e.radiusKm).toLocaleString()} km` : ''}
        {e.luminosityW ? ` · L ${si(e.luminosityW, 'W', 2)}` : ''}
      </div>
      {here.length ? (
        <div style={{ marginBottom: 8 }}>
          {here.map((s) => <div key={s.label} className="mono" style={{ fontSize: 11 }}>▸ {s.label} · {si(s.usefulW, 'W', 2)}</div>)}
        </div>
      ) : null}
      {role !== 'viewer' ? (
        <>
          <div className="field-label" style={{ fontSize: 10.5, marginBottom: 4 }}>Coverage {coverage < 0.01 ? coverage.toExponential(0) : `${Math.round(coverage * 100)}%`}</div>
          <input type="range" min={-4} max={0} step={0.05} value={Math.log10(coverage)} onChange={(ev) => setCoverage(10 ** Number(ev.target.value))} style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {types.map((t) => (
              <button key={t.value} type="button" className="btn sm amber" disabled={pending > 0} onClick={() => void build(t.value)} title={t.label}>
                <Hammer size={12} /> {t.label.split(' (')[0]}
              </button>
            ))}
          </div>
          {e.system !== 'sol' ? <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>Building at another star raises the branch to Kardashev III (logged).</div> : null}
        </>
      ) : null}
    </motion.div>
  );
}
