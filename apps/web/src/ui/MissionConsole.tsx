import { LEVELS, type LevelId } from '@cosmos/engine';
import { AnimatePresence, motion } from 'motion/react';
import {
  Atom, BookOpen, Database, GitBranch, Layers, SlidersHorizontal, Target, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { civilizationProfile } from '../content/civilizations';
import { STOP_BY_ID } from '../navigation/stops';
import { useScience } from '../state/science';
import { useBundle } from '../state/selectors';
import { useUi, type ConsoleTab } from '../state/ui';
import { useWorld } from '../state/world';
import { EvidenceChip, evidenceTitle, formatSpec, KScale, Section, SpecControl } from './controls';
import { LevelResults } from './panels/LevelResults';
import { DependencyGraph } from './panels/DependencyGraph';
import { InterventionsPanel } from './panels/InterventionsPanel';
import { DepthControls } from './panels/DepthControls';
import { SourcesPanel } from './panels/SourcesPanel';
import { WorldsPanel } from './panels/WorldsPanel';
import { ExplorePanel } from './panels/ExplorePanel';

const TABS: { id: ConsoleTab; label: string; icon: typeof Target }[] = [
  { id: 'mission', label: 'Mission', icon: Target },
  { id: 'results', label: 'Results', icon: Layers },
  { id: 'civilization', label: 'Civilisation', icon: BookOpen },
  { id: 'assumptions', label: 'Assumptions', icon: SlidersHorizontal },
  { id: 'sources', label: 'Sources', icon: Database },
  { id: 'worlds', label: 'Worlds', icon: GitBranch },
];

export function MissionConsole() {
  const open = useUi((s) => s.consoleOpen);
  const tab = useUi((s) => s.consoleTab);
  const setConsole = useUi((s) => s.setConsole);
  const stopId = useUi((s) => s.stop);
  const stop = STOP_BY_ID[stopId];
  const level = stop.level;
  const accent = stop.family === 'B' ? 'var(--violet)' : 'var(--amber)';

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="console"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          className="glass brackets"
          style={{
            position: 'absolute', top: 78, right: 18, bottom: 108, width: 392, display: 'flex', flexDirection: 'column',
            zIndex: 20, overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {stop.badge ? (
                <span className="display" style={{ fontSize: 11, padding: '4px 8px', borderRadius: 7, border: `1px solid ${accent}`, color: accent, boxShadow: `0 0 14px color-mix(in srgb, ${accent} 30%, transparent)` }}>
                  {stop.badge}
                </span>
              ) : (
                <Atom size={16} color="var(--cyan)" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="h-title" style={{ fontSize: 15 }}>{level ? LEVELS[level].title : stop.name}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{stop.subtitle}</div>
              </div>
              <button type="button" className="btn sm icon ghost" onClick={() => setConsole(false)} aria-label="Close console">
                <X size={15} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 2, marginTop: 12, overflowX: 'auto' }}>
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setConsole(true, t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', borderRadius: 8, border: 'none',
                      background: active ? 'rgba(92,225,255,0.12)' : 'transparent', color: active ? 'var(--cyan)' : 'var(--muted)',
                      fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap',
                    }}
                  >
                    <Icon size={13} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="scroll" style={{ flex: 1, padding: 16 }}>
            <AnimatePresence mode="wait">
              <motion.div key={`${tab}:${stopId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {tab === 'mission' ? (stop.civ ? <><DepthControls stop={stopId} /><InterventionsPanel level={level!} compact /></> : level ? <MissionPanel level={level} /> : <ExplorePanel stop={stopId} />) : null}
                {tab === 'results' ? (level ? <ResultsPanel level={level} /> : <ExplorePanel stop={stopId} />) : null}
                {tab === 'civilization' ? (level ? <CivilizationPanel level={level} /> : <ExplorePanel stop={stopId} />) : null}
                {tab === 'assumptions' ? (level ? <AssumptionsPanel level={level} /> : <EmptyNote text="This stop is exploration-only; its baseline has no editable model assumptions." />) : null}
                {tab === 'sources' ? <SourcesPanel stop={stopId} /> : null}
                {tab === 'worlds' ? <WorldsPanel /> : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>{text}</div>;
}

/* ============================================================ mission */
function MissionPanel({ level }: { level: LevelId }) {
  return <InterventionsPanel level={level} />;
}

/* ============================================================ results */
function ResultsPanel({ level }: { level: LevelId }) {
  const rendered = useWorld((s) => s.render[level]);
  const srv = useWorld((s) => s.outputs[level]);
  const render = useWorld((s) => s.render);
  const bundle = useBundle();
  const human = bundle ? (Math.log10(bundle.earth.primaryPowerW.value) - 6) / 10 : 0.73;
  const achieved = useMemo(() => {
    const ks = (['k1', 'k2', 'k3'] as LevelId[]).map((l) => render[l]?.output.summary.achievedK).filter((x): x is number => typeof x === 'number');
    return ks.length ? Math.max(...ks) : null;
  }, [render]);
  if (!srv) {
    return <EmptyNote text="No result at this level on this branch yet. Add an intervention in Mission — or ask COSMOS by voice or text." />;
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="chip simulated"><span className="dot" />computed in SpacetimeDB · rev {srv.revision}</span>
        {rendered ? <span className={`chip ${rendered.verified ? 'derived' : 'assumed'}`}>{rendered.verified ? 'render verified (hash match)' : 'render unverified'}</span> : null}
      </div>
      {level.startsWith('k') ? (
        <Section title="Kardashev scale">
          <KScale human={human} achieved={achieved} />
        </Section>
      ) : null}
      {rendered ? <LevelResults output={rendered.output} /> : null}
      {srv.warnings.length ? (
        <Section title="Warnings">
          {srv.warnings.map((w) => (
            <div key={w} style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 4 }}>⚠ {w}</div>
          ))}
        </Section>
      ) : null}
      <DependencyGraph level={level} />
      <Section title={`Model · ${srv.modelId}@${srv.modelVersion}`}>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.55 }} className="muted">
          {srv.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </Section>
    </div>
  );
}

/* ======================================================= civilisation */
function CivilizationPanel({ level }: { level: LevelId }) {
  const bundle = useBundle();
  const tables = useScience((s) => s.tables);
  const render = useWorld((s) => s.render);
  if (!bundle) return null;
  const c = civilizationProfile(level, bundle, tables, render);
  const accent = c.family === 'B' ? 'var(--violet)' : 'var(--amber)';
  return (
    <div>
      <div className="eyebrow" style={{ color: accent }}>{c.rank}</div>
      <div className="h-title" style={{ fontSize: 20, margin: '2px 0 4px' }}>{c.title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 6 }}>{c.tagline}</div>
      <div className="mono muted" style={{ fontSize: 11, marginBottom: 16 }}>{c.scale}</div>
      <Section title="How this civilisation works">
        {c.howItWorks.map((h, i) => (
          <div key={h.title} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, marginBottom: 10 }}>
            <span className="mono" style={{ color: accent, fontSize: 11, marginTop: 1 }}>0{i + 1}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{h.title}</div>
              <div className="muted" style={{ fontSize: 12.2, lineHeight: 1.55 }}>{h.body}</div>
            </div>
          </div>
        ))}
      </Section>
      <Section title="Grounded in the database">
        {c.grounding.map((g) => (
          <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12 }}>{g.label}</div>
              <div className="faint" style={{ fontSize: 10.5 }}>{g.source}</div>
            </div>
            <span className="mono" style={{ fontSize: 12, textAlign: 'right' }}>{g.value}</span>
            <EvidenceChip kind={g.kind} />
          </div>
        ))}
      </Section>
      <Section title="Model">
        {c.model.map((m) => (
          <div key={m} className="mono" style={{ fontSize: 11.5, padding: '5px 8px', marginBottom: 4, borderRadius: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)' }}>{m}</div>
        ))}
      </Section>
      <Section title="Observable signatures">
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }} className="muted">
          {c.signatures.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </Section>
      <Section title="Not modelled">
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6, color: 'var(--amber)' }}>
          {c.limits.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </Section>
    </div>
  );
}

/* ======================================================== assumptions */
function AssumptionsPanel({ level }: { level: LevelId }) {
  const world = useWorld((s) => s.world);
  const overrides = useWorld((s) => s.assumptions);
  const setAssumption = useWorld((s) => s.setAssumption);
  const toast = useUi((s) => s.toast);
  const specs = useMemo(() => world?.assumptionSpecs(level) ?? [], [world, level]);
  const [pending, setPending] = useState<Record<string, unknown>>({});
  if (!specs.length) return <EmptyNote text="This level's model takes all of its inputs from sourced data; there are no free assumptions to override." />;
  const commit = async (key: string, value: unknown) => {
    const r = await setAssumption(key, value);
    if (r.status !== 'applied') toast({ kind: 'error', title: `Assumption ${r.status}`, body: r.message });
    setPending((p) => {
      const n = { ...p };
      delete n[key];
      return n;
    });
  };
  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 12, lineHeight: 1.55 }}>
        Overrides are branch events: they recompute any committed scenario that depends on them, and undo removes them. The baseline itself never changes.
      </p>
      {specs.map((spec) => {
        const overridden = spec.key in overrides;
        const current = pending[spec.key] ?? (overridden ? overrides[spec.key] : spec.defaultValue);
        return (
          <div key={spec.key} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <EvidenceChip kind={overridden ? 'assumed' : spec.evidence.kind} title={evidenceTitle(spec.evidence)} />
              {overridden ? <span className="chip assumed">override</span> : null}
              <span className="faint" style={{ fontSize: 10.5, marginLeft: 'auto' }} title={evidenceTitle(spec.evidence)}>
                default {formatSpec(spec, spec.defaultValue)}
              </span>
            </div>
            <SpecControl spec={spec} value={current} onChange={(v) => setPending((p) => ({ ...p, [spec.key]: v }))} />
            <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>{spec.description} {spec.evidence.method ? `· ${spec.evidence.method}` : ''}</div>
            {spec.key in pending || overridden ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {spec.key in pending ? <button type="button" className="btn sm primary" onClick={() => void commit(spec.key, pending[spec.key])}>Apply override</button> : null}
                {overridden ? <button type="button" className="btn sm" onClick={() => void commit(spec.key, spec.defaultValue)}>Restore sourced value</button> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
