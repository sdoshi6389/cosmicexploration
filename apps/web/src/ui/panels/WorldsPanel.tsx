import { LEVELS } from '@cosmos/engine';
import { Check, Copy, Eye, GitBranch, GitCompare, Pencil, Radio, Users } from 'lucide-react';
import { useState } from 'react';
import { useUi } from '../../state/ui';
import { useWorld } from '../../state/world';
import { Section } from '../controls';

function fmtSummary(v: number | string | boolean): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '∞';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-2)) return v.toExponential(3);
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  return String(v);
}

const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${(s / 60).toFixed(0)}m` : `${(s / 3600).toFixed(0)}h`;
};

export function WorldsPanel() {
  return (
    <div>
      <SessionSection />
      <BranchSection />
      <CompareSection />
      <HistorySection />
    </div>
  );
}

function SessionSection() {
  const mode = useWorld((s) => s.mode);
  const sessionName = useWorld((s) => s.sessionName);
  const role = useWorld((s) => s.role);
  const invites = useWorld((s) => s.invites);
  const members = useWorld((s) => s.members);
  const presenterHex = useWorld((s) => s.presenterHex);
  const identityHex = useWorld((s) => s.identityHex);
  const following = useWorld((s) => s.following);
  const toast = useUi((s) => s.toast);
  const [code, setCode] = useState('');
  if (mode === 'offline') {
    return (
      <Section title="Session">
        <div className="muted" style={{ fontSize: 12 }}>Offline — the engine runs locally. Sharing, presence and authoritative sync need SpacetimeDB.</div>
      </Section>
    );
  }
  const presenting = presenterHex === identityHex;
  const presenter = members.find((m) => m.identityHex === presenterHex);
  const link = (c: string) => `${window.location.origin}${window.location.pathname}?join=${c}`;
  return (
    <Section title={`Session · ${sessionName}`} right={<span className="chip simulated"><Users size={11} /> {role}</span>}>
      {invites.length ? (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {invites.map((i) => (
            <div key={i.code} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="eyebrow" style={{ width: 50 }}>{i.role}</span>
              <span className="mono" style={{ fontSize: 11.5, flex: 1 }}>{i.code}</span>
              <button type="button" className="btn sm" onClick={() => { void navigator.clipboard?.writeText(link(i.code)); toast({ kind: 'success', title: `${i.role} link copied` }); }}><Copy size={12} /> link</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>People</div>
      {members.map((m) => (
        <div key={m.identityHex} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 0' }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: m.online ? 'var(--green)' : 'var(--faint)' }} />
          <span style={{ flex: 1 }}>{m.displayName}{m.identityHex === identityHex ? ' (you)' : ''}{m.identityHex === presenterHex ? ' · presenting' : ''}{m.following ? ' · following' : ''}</span>
          <span className="mono faint" style={{ fontSize: 10 }}>{m.role} · {m.stop || '—'}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {role !== 'viewer' ? (
          <button type="button" className={`btn sm ${presenting ? 'primary' : ''}`} style={{ flex: 1 }} onClick={() => useWorld.getState().setPresenter(!presenting)}>
            <Radio size={12} /> {presenting ? 'Stop presenting' : 'Present'}
          </button>
        ) : null}
        <button type="button" className={`btn sm ${following ? 'primary' : ''}`} style={{ flex: 1 }} disabled={!presenter || presenting} onClick={() => useWorld.getState().setFollowing(!following)}>
          <Eye size={12} /> {following ? 'Following' : presenter ? `Follow ${presenter.displayName}` : 'No presenter'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input className="text-input" placeholder="Join code (E-… or V-…)" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="btn sm" disabled={!code.trim()} onClick={async () => {
          const r = await useWorld.getState().joinSession(code);
          toast({ kind: r.ok ? 'success' : 'error', title: r.ok ? 'Joined session' : 'Join failed', body: r.message });
          if (r.ok) setCode('');
        }}>Join</button>
        <button type="button" className="btn sm ghost" onClick={() => void useWorld.getState().newSession()}>New</button>
      </div>
    </Section>
  );
}

function BranchSection() {
  const branches = useWorld((s) => s.branches);
  const branchId = useWorld((s) => s.branchId);
  const compareId = useWorld((s) => s.compareId);
  const role = useWorld((s) => s.role);
  const members = useWorld((s) => s.members);
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const active = branches.find((w) => w.id === branchId);
  const [name, setName] = useState(active?.name ?? '');
  const { switchTo, fork, rename, compareWith } = useWorld.getState();
  return (
    <Section title={`Branches (${branches.length})`}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        {editing ? (
          <>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && (rename(name), setEditing(false))} />
            <button type="button" className="btn icon" onClick={() => { rename(name); setEditing(false); }}><Check size={14} /></button>
          </>
        ) : (
          <>
            <div style={{ flex: 1, fontWeight: 600 }}>{active?.name ?? '—'}</div>
            {role !== 'viewer' ? <button type="button" className="btn sm icon ghost" onClick={() => { setName(active?.name ?? ''); setEditing(true); }} aria-label="Rename"><Pencil size={13} /></button> : null}
          </>
        )}
      </div>
      <div className="mono muted" style={{ fontSize: 11, marginBottom: 8 }}>
        rev {active?.revision ?? 0} · {active?.cursor ?? 0}/{active?.head ?? 0} events active · seed {active?.seed} · K{active?.kardashevLevel} B{active?.barrowLevel}
      </div>
      {role !== 'viewer' ? (
        <button type="button" className="btn sm primary" style={{ width: '100%', marginBottom: 8 }} onClick={async () => {
          const id = await fork();
          if (id) toast({ kind: 'success', title: 'Branch forked', body: 'Now editing the fork; the parent is set as the comparison.' });
        }}>
          <GitBranch size={13} /> Fork this branch
        </button>
      ) : null}
      {branches.map((w) => {
        const here = members.filter((m) => m.online && m.branchId === w.id).length;
        return (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 9, background: w.id === branchId ? 'rgba(92,225,255,0.08)' : 'transparent', border: `1px solid ${w.id === branchId ? 'rgba(92,225,255,0.3)' : 'transparent'}` }}>
            <button type="button" onClick={() => switchTo(w.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, minWidth: 0, color: 'inherit' }}>
              <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</div>
              <div className="mono faint" style={{ fontSize: 10 }}>rev {w.revision} · {w.cursor}/{w.head}{here ? ` · ${here} here` : ''}</div>
            </button>
            {w.id !== branchId ? (
              <button type="button" className={`btn sm ${compareId === w.id ? 'primary' : ''}`} onClick={() => compareWith(compareId === w.id ? null : w.id)}>
                <GitCompare size={12} /> {compareId === w.id ? 'comparing' : 'compare'}
              </button>
            ) : null}
          </div>
        );
      })}
    </Section>
  );
}

function CompareSection() {
  const comparison = useWorld((s) => s.comparison);
  const branches = useWorld((s) => s.branches);
  if (!comparison) return null;
  const n = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  return (
    <Section title={`Compare · ${n(comparison.aId)} vs ${n(comparison.bId)}`}>
      {comparison.levels.filter((l) => l.a || l.b).map((l) => {
        const keys = [...new Set([...Object.keys(l.a ?? {}), ...Object.keys(l.b ?? {})])];
        return (
          <div key={l.level} style={{ marginBottom: 10, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: 12, fontWeight: 600 }}>{LEVELS[l.level].title}</div>
            {keys.map((k) => {
              const a = l.a?.[k];
              const b = l.b?.[k];
              const diff = JSON.stringify(a) !== JSON.stringify(b);
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '4px 10px', fontSize: 11.5, borderTop: '1px solid var(--line)' }}>
                  <span className="muted">{k}</span>
                  <span className="mono" style={{ color: diff ? 'var(--cyan)' : undefined }}>{a === undefined ? '—' : fmtSummary(a)}</span>
                  <span className="mono" style={{ color: diff ? 'var(--amber)' : undefined }}>{b === undefined ? '—' : fmtSummary(b)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {comparison.interventionDiff.onlyA.length || comparison.interventionDiff.onlyB.length || comparison.interventionDiff.changed.length ? (
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          {comparison.interventionDiff.onlyA.length ? <div>Only here: {comparison.interventionDiff.onlyA.join(', ')}</div> : null}
          {comparison.interventionDiff.onlyB.length ? <div>Only there: {comparison.interventionDiff.onlyB.join(', ')}</div> : null}
          {comparison.interventionDiff.changed.length ? <div>Different parameters: {comparison.interventionDiff.changed.join(', ')}</div> : null}
        </div>
      ) : null}
      {comparison.assumptionDiffs.length ? <div className="muted" style={{ fontSize: 11.5 }}>Assumption differences: {comparison.assumptionDiffs.map((d) => d.key).join(', ')}</div> : null}
    </Section>
  );
}

function HistorySection() {
  const events = useWorld((s) => s.events);
  const receipts = useWorld((s) => s.receipts);
  const branch = useWorld((s) => s.branches.find((b) => b.id === s.branchId));
  const members = useWorld((s) => s.members);
  const who = (hex: string) => members.find((m) => m.identityHex === hex)?.displayName ?? hex.slice(0, 6);
  const cursor = branch?.cursor ?? 0;
  return (
    <>
      <Section title="Event log (authoritative)">
        {events.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No events yet — this branch equals the baseline.</div> : null}
        {events.map((e) => {
          const on = e.seq <= cursor;
          return (
            <div key={e.seq} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 6, padding: '4px 0', opacity: on ? 1 : 0.35 }}>
              <span className="mono faint" style={{ fontSize: 10.5 }}>#{e.seq}</span>
              <div>
                <div className="mono" style={{ fontSize: 11.5 }}>{e.action} {e.targetId ? <span className="faint">{e.targetId}</span> : null}</div>
                <div className="faint" style={{ fontSize: 10.5, wordBreak: 'break-word' }}>{who(e.authorHex)} · via {e.source} · {JSON.stringify(e.parameters).slice(0, 120)}</div>
              </div>
            </div>
          );
        })}
      </Section>
      <Section title="Command receipts">
        {receipts.slice(0, 20).map((r) => (
          <div key={r.commandId} style={{ display: 'flex', gap: 6, fontSize: 11, padding: '2px 0' }}>
            <span className="mono" style={{ color: r.status === 'applied' ? 'var(--green)' : 'var(--red)', width: 58 }}>{r.status}</span>
            <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.message}>{r.message}</span>
            <span className="faint">{r.source} · {ago(r.createdAt)}</span>
          </div>
        ))}
      </Section>
    </>
  );
}
