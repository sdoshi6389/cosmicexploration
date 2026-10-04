import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { STOP_BY_ID } from '../navigation/stops';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';

const YEAR = 365.25 * 86400;
const RATES = [1, 10, 50, 200, 1000, 5000];

/**
 * Shared simulation clock. SpacetimeDB owns it (a scheduled reducer advances it);
 * between ticks the bar interpolates so the playhead moves smoothly. Seeking
 * recomputes time-dependent outputs (K3 fronts) on the server.
 */
export function ClockBar() {
  const clock = useWorld((s) => s.clock);
  const role = useWorld((s) => s.role);
  const hasTime = useWorld((s) => s.interventions.some((i) => i.level === 'k3'));
  const stop = useUi((s) => s.stop);
  const toast = useUi((s) => s.toast);
  const [now, setNow] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const k3 = useWorld((s) => s.outputs.k3?.summary);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(useWorld.getState().simNow());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  // The shared clock drives the K3 galactic expansion — shown only in that civilisation.
  if (STOP_BY_ID[stop].level !== 'k3') return null;
  void hasTime;
  const years = (drag ?? now) / YEAR;
  // √-scaled slider: fine control over early centuries, still reaches galaxy-scale times.
  const maxYears = 316_000;
  const toSlider = (y: number) => Math.sqrt(Math.min(1, y / maxYears)) * 1000;
  const fromSlider = (v: number) => (v / 1000) ** 2 * maxYears;
  const act = async (p: Promise<{ status: string; message: string }>) => {
    const r = await p;
    if (r.status !== 'applied') toast({ kind: 'error', title: `Clock ${r.status}`, body: r.message });
  };
  const ro = role === 'viewer';
  const { clockControl } = useWorld.getState();
  return (
    <div className="glass" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 72, zIndex: 24, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', width: 'min(620px, calc(100vw - 32px))' }}>
      <button type="button" className="btn sm icon" disabled={ro} title={clock.running ? 'Pause' : 'Play'} onClick={() => void act(clockControl(clock.running ? 'pause' : 'play'))}>
        {clock.running ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          type="range" min={0} max={1000} step={1} value={toSlider(years)} disabled={ro}
          onChange={(e) => setDrag(fromSlider(Number(e.target.value)) * YEAR)}
          onPointerUp={() => {
            if (drag !== null) void act(clockControl('seek', drag)).finally(() => setDrag(null));
          }}
          style={{ width: '100%' }}
          aria-label="Simulation time"
        />
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
          <span style={{ color: 'var(--cyan)' }}>t = {years.toLocaleString('en-US', { maximumFractionDigits: 0 })} yr</span>
          {k3 ? <span className="muted">{Number(k3.settledCount ?? 0).toLocaleString()} systems settled · front {Number(k3.frontLy ?? 0).toFixed(0)} ly</span> : <span className="faint">server clock</span>}
        </div>
      </div>
      <select className="btn sm" disabled={ro} value={RATES.reduce((b, r) => (Math.abs(r - clock.rate / YEAR) < Math.abs(b - clock.rate / YEAR) ? r : b), 50)} onChange={(e) => void act(clockControl('set_rate', Number(e.target.value) * YEAR))} title="Simulated years per second">
        {RATES.map((r) => <option key={r} value={r}>{r} yr/s</option>)}
      </select>
    </div>
  );
}

/** Report this viewer's stop/selection to presence (followers mirror the presenter). */
export function usePresenceReporter() {
  const stop = useUi((s) => s.stop);
  const sel = useUi((s) => s.selection?.id ?? '');
  const sessionId = useWorld((s) => s.sessionId);
  useEffect(() => {
    useWorld.getState().reportPresence(stop, sel);
  }, [stop, sel, sessionId]);
}
