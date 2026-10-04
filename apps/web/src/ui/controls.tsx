import type { AssumptionSpec, Evidence, ParamSpec } from '@cosmos/engine';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { pct, sci, si, years } from '../lib/format';

/* ------------------------------------------------------------- format */
export function formatSpec(spec: ParamSpec | AssumptionSpec, v: unknown): string {
  if (spec.kind === 'boolean') return v ? 'On' : 'Off';
  if (spec.kind === 'choice') return spec.choices?.find((c) => c.value === v)?.label ?? String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (spec.unit === 'W') return si(n, 'W');
  if (spec.unit === 'yr') return years(n);
  if ('displayFactor' in spec && spec.displayFactor) return `${(n / spec.displayFactor).toLocaleString('en-US', { maximumSignificantDigits: 4 })} ${spec.unit}`;
  if (spec.unit === '' && spec.min === 0 && (spec.max === 1 || spec.max === 0.95)) return pct(n, 1);
  if (spec.unit === '' && (spec.max ?? 0) <= 1 && (spec.min ?? 0) >= 0.001) return pct(n, 1);
  if (spec.scale === 'log' && spec.unit === '') return sci(n, 2);
  const digits = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 10 ? 1 : 3;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })}${spec.unit ? ` ${spec.unit}` : ''}`;
}

/* ------------------------------------------------------------ slider */
function toSlider(spec: ParamSpec | AssumptionSpec, v: number): number {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  if (spec.scale === 'log') {
    const lo = Math.log10(min > 0 ? min : max * 1e-6);
    const hi = Math.log10(max);
    return ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * 1000;
  }
  return ((v - min) / (max - min)) * 1000;
}
function fromSlider(spec: ParamSpec | AssumptionSpec, s: number): number {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  if (spec.scale === 'log') {
    const lo = Math.log10(min > 0 ? min : max * 1e-6);
    const hi = Math.log10(max);
    const v = 10 ** (lo + (s / 1000) * (hi - lo));
    return s <= 0 && min === 0 ? 0 : Number(v.toPrecision(4));
  }
  const raw = min + (s / 1000) * (max - min);
  const step = spec.step ?? 0;
  return step ? Math.round(raw / step) * step : Number(raw.toPrecision(5));
}

export function SpecControl({
  spec, value, onChange, accent = 'var(--cyan)', modified,
}: {
  spec: ParamSpec | AssumptionSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  accent?: string;
  modified?: boolean;
}) {
  if (spec.kind === 'boolean') {
    return (
      <div className="field" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="field-label" title={spec.description}>{spec.label}</span>
        <button type="button" className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} aria-pressed={Boolean(value)} aria-label={spec.label} />
      </div>
    );
  }
  if (spec.kind === 'entity') {
    const id = `dl-${spec.key}`;
    return (
      <div className="field">
        <div className="field-head">
          <span className="field-label" title={spec.description}>{spec.label}</span>
        </div>
        <input className="text-input" list={id} defaultValue={String(value ?? '')} placeholder="planet, moon or star name" onBlur={(e) => e.target.value.trim() && onChange(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <datalist id={id}>
          {(spec.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </datalist>
      </div>
    );
  }
  if (spec.kind === 'choice') {
    const choices = spec.choices ?? [];
    return (
      <div className="field">
        <div className="field-head">
          <span className="field-label" title={spec.description}>{spec.label}</span>
        </div>
        {choices.length <= 3 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {choices.map((c) => (
              <button key={c.value} type="button" className={`btn sm ${value === c.value ? 'primary' : ''}`} style={{ flex: 1 }} onClick={() => onChange(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <select className="text-input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        )}
      </div>
    );
  }
  const n = Number(value ?? spec.defaultValue);
  const s = toSlider(spec, n);
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label" title={spec.description}>
          {spec.label}
          {modified ? <span style={{ color: 'var(--amber)', marginLeft: 6 }}>●</span> : null}
        </span>
        <NumberReadout spec={spec} value={n} onChange={onChange} />
      </div>
      <input
        className="slider"
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.max(0, Math.min(1000, s))}
        style={{ '--fill': `${Math.max(0, Math.min(100, s / 10))}%`, '--accent': accent } as CSSProperties}
        onChange={(e) => onChange(fromSlider(spec, Number(e.target.value)))}
        aria-label={spec.label}
      />
    </div>
  );
}

function NumberReadout({ spec, value, onChange }: { spec: ParamSpec | AssumptionSpec; value: number; onChange: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const factor = 'displayFactor' in spec && spec.displayFactor ? spec.displayFactor : 1;
  if (editing) {
    return (
      <input
        autoFocus
        className="text-input mono"
        style={{ height: 24, width: 120, fontSize: 12, textAlign: 'right' }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = Number(draft.replace(/[^0-9eE+.-]/g, '')) * factor;
            if (Number.isFinite(v)) onChange(Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v)));
            setEditing(false);
          }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="field-value"
      title="Click to type an exact value"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'text' }}
      onClick={() => {
        setDraft(String(Number((value / factor).toPrecision(6))));
        setEditing(true);
      }}
    >
      {formatSpec(spec, value)}
    </button>
  );
}

/* -------------------------------------------------------------- chips */
export function EvidenceChip({ kind, title }: { kind: string; title?: string }) {
  return (
    <span className={`chip ${kind}`} title={title}>
      <span className="dot" />
      {kind}
    </span>
  );
}

export function evidenceTitle(e: Evidence | undefined): string {
  if (!e) return '';
  return [e.sourceId, e.release, e.method, e.sourceRecordId, e.retrievedAt && `retrieved ${e.retrievedAt}`].filter(Boolean).join(' · ');
}

/* --------------------------------------------------------- metrics */
export function Metric({
  label, value, sub, tone = 'default', delta, big,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'cyan' | 'amber' | 'violet' | 'green' | 'red';
  delta?: string | null;
  big?: boolean;
}) {
  const color = { default: 'var(--text)', cyan: 'var(--cyan)', amber: 'var(--amber)', violet: 'var(--violet)', green: 'var(--green)', red: 'var(--red)' }[tone];
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 11,
        border: '1px solid var(--line)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))',
        minWidth: 0,
      }}
    >
      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>{label}</div>
      <AnimatedValue value={value} color={color} big={big} />
      {sub ? <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div> : null}
      {delta ? <div className="mono" style={{ fontSize: 10.5, marginTop: 3, color: delta.startsWith('−') || delta.startsWith('-') ? 'var(--red)' : 'var(--green)' }}>{delta}</div> : null}
    </div>
  );
}

function AnimatedValue({ value, color, big }: { value: ReactNode; color: string; big?: boolean }) {
  const key = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  return (
    <motion.div
      key={key}
      initial={{ opacity: 0.2, y: 4, filter: 'blur(3px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="mono"
      style={{ fontSize: big ? 22 : 16, fontWeight: 500, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}
    >
      {value}
    </motion.div>
  );
}

export function MetricGrid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8 }}>{children}</div>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="eyebrow">{title}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bar used for mixes and ledgers. */
export function Bar({ value, max, color = 'var(--cyan)', label, right }: { value: number; max: number; color?: string; label: string; right?: string }) {
  const w = max > 0 ? Math.max(0.5, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
        <span className="muted">{label}</span>
        <span className="mono" style={{ color: 'var(--text-2)' }}>{right}</span>
      </div>
      <div style={{ height: 5, borderRadius: 5, background: 'rgba(140,200,255,0.08)', overflow: 'hidden' }}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} style={{ height: '100%', background: color, boxShadow: `0 0 10px ${color}` }} />
      </div>
    </div>
  );
}

/** Logarithmic Kardashev scale 0–3 with humanity and branch markers. */
export function KScale({ human, achieved, compact }: { human: number; achieved: number | null; compact?: boolean }) {
  const pos = (k: number) => `${Math.max(0, Math.min(100, (k / 3.2) * 100))}%`;
  return (
    <div style={{ position: 'relative', height: compact ? 30 : 46, marginTop: 4 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: compact ? 12 : 18, height: 4, borderRadius: 4, background: 'linear-gradient(90deg, rgba(92,225,255,0.25), rgba(255,181,71,0.45), rgba(180,140,255,0.55))' }} />
      {[1, 2, 3].map((k) => (
        <div key={k} style={{ position: 'absolute', left: pos(k), top: compact ? 6 : 10, transform: 'translateX(-50%)', textAlign: 'center' }}>
          <div style={{ width: 1, height: 16, background: 'var(--line-strong)', margin: '0 auto' }} />
          {!compact ? <div className="mono faint" style={{ fontSize: 9.5, marginTop: 2 }}>K{['', 'I', 'II', 'III'][k]}</div> : null}
        </div>
      ))}
      <Marker left={pos(human)} color="var(--text-2)" label={compact ? '' : `Humanity ${human.toFixed(2)}`} top={compact ? 6 : 6} />
      {achieved != null ? <Marker left={pos(achieved)} color="var(--amber)" label={compact ? '' : `Branch ${achieved.toFixed(2)}`} top={compact ? 6 : 6} glow /> : null}
    </div>
  );
}

function Marker({ left, color, label, top, glow }: { left: string; color: string; label: string; top: number; glow?: boolean }) {
  return (
    <motion.div animate={{ left }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} style={{ position: 'absolute', top, transform: 'translateX(-50%)' }}>
      <div style={{ width: 10, height: 10, borderRadius: 10, margin: '0 auto', background: color, boxShadow: glow ? `0 0 14px ${color}` : 'none', border: '2px solid #02040a', marginTop: 5 }} />
      {label ? <div className="mono" style={{ fontSize: 9.5, color, whiteSpace: 'nowrap', marginTop: 14, transform: 'translateX(0)' }}>{label}</div> : null}
    </motion.div>
  );
}

export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === key || e.code === key) ref.current(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
