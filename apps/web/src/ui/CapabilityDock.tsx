import type { LevelId } from '@cosmos/engine';
import { useMemo } from 'react';
import { STOP_BY_ID, STOP_FOR_LEVEL } from '../navigation/stops';
import { useBundle } from '../state/selectors';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';
import { KScale } from './controls';

const K_LEVELS: { level: LevelId; label: string; k: 1 | 2 | 3; sub: string }[] = [
  { level: 'k1', label: 'K1', k: 1, sub: 'Planet' },
  { level: 'k2', label: 'K2', k: 2, sub: 'Star' },
  { level: 'k3', label: 'K3', k: 3, sub: 'Galaxy' },
];
const B_LEVELS: { level: LevelId; label: string; b: 2 | 4 | 6; sub: string }[] = [
  { level: 'b2', label: 'B2', b: 2, sub: 'Genes' },
  { level: 'b4', label: 'B4', b: 4, sub: 'Atoms' },
  { level: 'b6', label: 'B6', b: 6, sub: 'Particles' },
];

/**
 * Level selector: each button takes you to that civilisation. If the branch's
 * capability is below it, the capability is raised (a logged branch event) so you
 * can build there immediately.
 */
export function CapabilityDock() {
  const caps = useWorld((s) => s.capabilities);
  const pending = useWorld((s) => s.pending);
  const render = useWorld((s) => s.render);
  const stopId = useUi((s) => s.stop);
  const goTo = useUi((s) => s.goTo);
  const bundle = useBundle();
  const current = STOP_BY_ID[stopId].level;
  const human = bundle ? (Math.log10(bundle.earth.primaryPowerW.value) - 6) / 10 : 0.73;
  const achieved = useMemo(() => {
    const ks = (['k1', 'k2', 'k3'] as LevelId[]).map((l) => render[l]?.output.summary.achievedK).filter((x): x is number => typeof x === 'number');
    return ks.length ? Math.max(...ks) : null;
  }, [render]);

  const go = (level: LevelId, k?: 1 | 2 | 3, b?: 2 | 4 | 6) => {
    goTo(STOP_FOR_LEVEL[level]);
    const needK = k && caps.kardashevLevel < k ? k : undefined;
    const needB = b && caps.barrowLevel < b ? b : undefined;
    if (needK || needB) {
      void useWorld.getState().setCapabilities({ ...(needK ? { kardashevLevel: needK } : {}), ...(needB ? { barrowLevel: needB } : {}) }).then((r) => {
        if (r.status !== 'applied') useUi.getState().toast({ kind: 'error', title: `Capability change ${r.status}`, body: r.message });
      });
    }
  };

  const btn = (active: boolean, unlocked: boolean, color: string) => ({
    flex: 1, flexDirection: 'column' as const, height: 44, gap: 0, padding: 0,
    borderColor: active ? color : undefined, color: active ? color : unlocked ? 'var(--text)' : 'var(--muted)',
    boxShadow: active ? `0 0 14px color-mix(in srgb, ${color} 35%, transparent)` : undefined,
  });

  return (
    <div className="glass" style={{ position: 'absolute', left: 18, bottom: 22, width: 300, padding: 12, zIndex: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="eyebrow">Kardashev · energy{pending ? ' · saving…' : ''}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{achieved != null ? `achieved K ${achieved.toFixed(2)}` : `humanity K ${human.toFixed(2)}`}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {K_LEVELS.map((l) => (
          <button key={l.level} type="button" className="btn sm" style={btn(current === l.level, caps.kardashevLevel >= l.k, 'var(--amber)')} onClick={() => go(l.level, l.k)}>
            <span style={{ fontWeight: 700 }}>{l.label}</span>
            <span style={{ fontSize: 9.5, opacity: 0.7 }}>{l.sub}</span>
          </button>
        ))}
      </div>
      <KScale human={human} achieved={achieved} compact />
      <div className="eyebrow" style={{ marginTop: 6 }}>Barrow · manipulation depth</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {B_LEVELS.map((l) => (
          <button key={l.level} type="button" className="btn sm" style={btn(current === l.level, caps.barrowLevel >= l.b, 'var(--violet)')} onClick={() => go(l.level, undefined, l.b)}>
            <span style={{ fontWeight: 700 }}>{l.label}</span>
            <span style={{ fontSize: 9.5, opacity: 0.7 }}>{l.sub}</span>
          </button>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
        Branch capability K{caps.kardashevLevel} · B{caps.barrowLevel}. Going to a level raises it if needed (logged event).
      </div>
    </div>
  );
}
