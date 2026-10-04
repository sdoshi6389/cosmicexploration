import { Database, GitBranch, HelpCircle, PanelRight, Redo2, RotateCcw, Settings2, Undo2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { scaleLabel } from '../lib/format';
import { STOP_BY_ID } from '../navigation/stops';
import { useScience } from '../state/science';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';

export function TopBar() {
  const stop = STOP_BY_ID[useUi((s) => s.stop)];
  const consoleOpen = useUi((s) => s.consoleOpen);
  const setConsole = useUi((s) => s.setConsole);
  const setHelp = useUi((s) => s.setHelp);
  const connected = useScience((s) => s.connected);
  const origin = useScience((s) => s.origin);
  const branches = useWorld((s) => s.branches);
  const branchId = useWorld((s) => s.branchId);
  const status = useWorld((s) => s.status);
  const pending = useWorld((s) => s.pending);
  const role = useWorld((s) => s.role);
  const members = useWorld((s) => s.members);
  const undo = useWorld((s) => s.undo);
  const redo = useWorld((s) => s.redo);
  const reset = useWorld((s) => s.reset);
  const fork = useWorld((s) => s.fork);
  const toast = useUi((s) => s.toast);
  const world = branches.find((w) => w.id === branchId);
  const cursor = world?.cursor ?? 0;
  const head = world?.head ?? 0;
  const online = members.filter((m) => m.online).length;
  const sync = status === 'reconnecting' ? 'error' : pending > 0 ? 'pending' : 'synced';
  const act = async (p: Promise<{ status: string; message: string }>, ok?: () => void) => {
    const r = await p;
    if (r.status !== 'applied') toast({ kind: 'error', title: `Command ${r.status}`, body: r.message });
    else ok?.();
  };
  const [settings, setSettings] = useState(false);

  return (
    <div style={{ position: 'absolute', top: 16, left: 18, right: 18, display: 'flex', alignItems: 'flex-start', gap: 14, zIndex: 25, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, pointerEvents: 'auto' }}>
        <div className="display" style={{ fontSize: 19, fontWeight: 800, letterSpacing: '0.32em', color: '#eaf6ff', textShadow: '0 0 18px rgba(92,225,255,0.55)' }}>
          COSMOS
        </div>
        <div style={{ width: 1, height: 28, background: 'var(--line-strong)' }} />
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 }} className="muted">
            {stop.breadcrumb.map((b, i) => (
              <span key={b} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {i > 0 ? <span className="faint">›</span> : null}
                <span style={{ color: i === stop.breadcrumb.length - 1 ? 'var(--text)' : undefined }}>{b}</span>
              </span>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--cyan)', marginTop: 2 }}>
            {scaleLabel(stop.exp)} · {stop.subtitle}
          </div>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <motion.div className="glass" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, pointerEvents: 'auto' }}>
        <div style={{ padding: '0 8px', minWidth: 150 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GitBranch size={12} color="var(--cyan)" />
            <span style={{ fontSize: 12.5, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{world?.name ?? '—'}</span>
          </div>
          <div className="mono faint" style={{ fontSize: 10 }}>
            rev {world?.revision ?? 0} · {cursor}/{head} events · {role}{online > 1 ? ` · ${online} online` : ""}
          </div>
        </div>
        <button type="button" className="btn sm icon" title="Undo (Ctrl+Z)" disabled={cursor === 0} onClick={() => void act(undo())}><Undo2 size={14} /></button>
        <button type="button" className="btn sm icon" title="Redo (Ctrl+Y)" disabled={cursor >= head} onClick={() => void act(redo())}><Redo2 size={14} /></button>
        <button type="button" className="btn sm icon" title="Reset to baseline" disabled={cursor === 0} onClick={() => void act(reset(), () => toast({ kind: 'info', title: 'Reset to reality', body: 'Projection equals the immutable baseline; redo restores events.' }))}><RotateCcw size={14} /></button>
        <button type="button" className="btn sm" title="Fork world" onClick={() => void fork().then((id) => id && setConsole(true, 'worlds'))}><GitBranch size={13} /> Fork</button>
        <div style={{ width: 1, height: 22, background: 'var(--line)' }} />
        <div title={`SpacetimeDB ${connected ? 'connected' : 'offline'} · baseline from ${origin ?? '—'} · sync ${sync}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px' }}>
          <Database size={13} color={connected ? 'var(--green)' : 'var(--amber)'} />
          <span className="mono" style={{ fontSize: 10, color: sync === 'error' ? 'var(--red)' : sync === 'pending' ? 'var(--amber)' : 'var(--muted)' }}>
            {status === 'reconnecting' ? 'reconnecting' : connected ? (sync === 'pending' ? 'computing' : 'live') : 'offline'}
          </span>
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" className="btn sm icon" title="Display settings" onClick={() => setSettings((v) => !v)}><Settings2 size={14} /></button>
          {settings ? <SettingsMenu onClose={() => setSettings(false)} /> : null}
        </div>
        <button type="button" className="btn sm icon" title="Help (?)" onClick={() => setHelp(true)}><HelpCircle size={14} /></button>
        <button type="button" className={`btn sm icon ${consoleOpen ? 'primary' : ''}`} title="Mission console (C)" onClick={() => setConsole(!consoleOpen)}><PanelRight size={14} /></button>
      </motion.div>
    </div>
  );
}

function SettingsMenu({ onClose }: { onClose: () => void }) {
  const quality = useUi((s) => s.quality);
  const setQuality = useUi((s) => s.setQuality);
  const trueScale = useUi((s) => s.trueScale);
  const setTrueScale = useUi((s) => s.setTrueScale);
  const showLabels = useUi((s) => s.showLabels);
  const setShowLabels = useUi((s) => s.setShowLabels);
  const earthLayer = useUi((s) => s.earthLayer);
  const setEarthLayer = useUi((s) => s.setEarthLayer);
  return (
    <div className="glass" style={{ position: 'absolute', right: 0, top: 40, width: 250, padding: 14, zIndex: 40 }} onMouseLeave={onClose}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Render quality</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['low', 'medium', 'high'] as const).map((q) => (
          <button key={q} type="button" className={`btn sm ${quality === q ? 'primary' : ''}`} style={{ flex: 1 }} onClick={() => setQuality(q)}>{q}</button>
        ))}
      </div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Earth data layer</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 12 }}>
        {([['none', 'None'], ['lst', 'Land temp'], ['ndvi', 'Vegetation'], ['quakes', 'Earthquakes']] as const).map(([v, l]) => (
          <button key={v} type="button" className={`btn sm ${earthLayer === v ? 'primary' : ''}`} onClick={() => setEarthLayer(v)}>{l}</button>
        ))}
      </div>
      <Row label="Linear solar-system distances" on={trueScale} set={setTrueScale} />
      <Row label="Labels" on={showLabels} set={setShowLabels} />
    </div>
  );
}

function Row({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
      <span className="muted">{label}</span>
      <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on} />
    </div>
  );
}
