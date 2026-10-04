import { interventionKind, kindsForLevel, LEVELS, type Intervention, type LevelId, type ParamSpec } from '@cosmos/engine';
import { Check, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { STOP_BY_ID, STOP_FOR_LEVEL } from '../../navigation/stops';
import { useUi } from '../../state/ui';
import { levelOutput, toastRejection, useWorld } from '../../state/world';
import { formatSpec, Section, SpecControl } from '../controls';
import { LevelResults } from './LevelResults';
import { applyPreset, PRESETS } from './presets';

type Draft = { mode: 'create'; kind: string; params: Record<string, unknown> } | { mode: 'edit'; id: string; kind: string; params: Record<string, unknown> };

export function InterventionsPanel({ level, compact }: { level: LevelId; compact?: boolean }) {
  const world = useWorld((s) => s.world);
  const interventions = useWorld((s) => s.interventions);
  const role = useWorld((s) => s.role);
  const pending = useWorld((s) => s.pending);
  const preview = useWorld((s) => s.previews[level]);
  const committed = useWorld((s) => s.render[level]?.output ?? null);
  const setPreview = useWorld((s) => s.preview);
  const selection = useUi((s) => s.selection);
  const select = useUi((s) => s.select);
  const toast = useUi((s) => s.toast);
  const [draft, setDraft] = useState<Draft | null>(null);
  const stop = STOP_BY_ID[STOP_FOR_LEVEL[level]];
  const accent = stop.family === 'B' ? 'var(--violet)' : 'var(--amber)';
  const mine = interventions.filter((i) => i.level === level);
  const kinds = kindsForLevel(level);
  const readOnly = role === 'viewer';

  // Selecting an intervention elsewhere (scene, voice) opens it for editing.
  useEffect(() => {
    if (selection?.kind !== 'intervention') return;
    const iv = mine.find((i) => i.id === selection.id);
    if (iv && (draft?.mode !== 'edit' || draft.id !== iv.id)) setDraft({ mode: 'edit', id: iv.id, kind: iv.kind, params: {} });
  }, [selection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview of the draft (local what-if; never committed).
  useEffect(() => {
    if (!draft || !Object.keys(draft.params).length) {
      setPreview(level, null);
      return;
    }
    const t = setTimeout(() => setPreview(level, draft.mode === 'create' ? { create: { kind: draft.kind, params: draft.params } } : { update: { id: draft.id, params: draft.params } }), level === 'k3' ? 120 : 30);
    return () => clearTimeout(t);
  }, [draft, level, setPreview]);
  useEffect(() => () => setPreview(level, null), [level, setPreview]);

  const commit = async () => {
    if (!draft) return;
    const w = useWorld.getState();
    const r = draft.mode === 'create' ? await w.createIntervention(draft.kind, draft.params) : await w.updateIntervention(draft.id, draft.params);
    if (r.status === 'applied') {
      toast({ kind: 'success', title: draft.mode === 'create' ? 'Intervention created' : 'Intervention updated', body: `Validated and computed in SpacetimeDB · revision ${r.revision}` });
      if (r.interventionId) select({ kind: 'intervention', id: r.interventionId, label: interventionKind(draft.kind)?.label ?? draft.kind, level });
      setDraft(null);
    } else toastRejection(`Command ${r.status}`, r);
  };

  const remove = async (iv: Intervention) => {
    const r = await useWorld.getState().removeIntervention(iv.id);
    if (r.status !== 'applied') toast({ kind: 'error', title: 'Remove rejected', body: r.message });
    else if (draft?.mode === 'edit' && draft.id === iv.id) setDraft(null);
  };

  const runPreset = async (i: number) => {
    const rs = await applyPreset(PRESETS[level][i]!);
    const bad = rs.find((r) => r.status !== 'applied');
    if (bad) toast({ kind: 'error', title: `Preset step ${bad.status}`, body: bad.message });
  };

  return (
    <div>
      {!compact ? <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.55 }}>{stop.blurb}</p> : null}
      {readOnly ? <div className="chip assumed" style={{ marginBottom: 10 }}>Viewer — read only. Ask the owner for an editor code.</div> : null}
      {!compact && level.startsWith('k') ? <Section title="Scenarios">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS[level].map((p, i) => (
            <button key={p.label} type="button" className="btn sm" title={p.hint} disabled={readOnly || pending > 0} onClick={() => void runPreset(i)}>{p.label}</button>
          ))}
        </div>
      </Section> : null}

      <Section title={`${compact ? 'Everything built at this level' : 'Interventions'} · ${mine.length}`} right={
        !readOnly ? (
          <select className="btn sm" value="" onChange={(e) => e.target.value && setDraft({ mode: 'create', kind: e.target.value, params: {} })} style={{ maxWidth: 170 }}>
            <option value="">+ add…</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind} disabled={k.singleton && mine.some((i) => i.kind === k.kind)}>{k.label}</option>
            ))}
          </select>
        ) : null
      }>
        {!mine.length && !draft ? <div className="muted" style={{ fontSize: 12 }}>None yet on this branch. Pick a scenario, add one, or ask COSMOS.</div> : null}
        {mine.map((iv) => (
          <InterventionCard
            key={iv.id} iv={iv} specs={world ? interventionKind(iv.kind)?.params(world.ctx) ?? [] : []} accent={accent} readOnly={readOnly}
            selected={selection?.id === iv.id}
            onSelect={() => select({ kind: 'intervention', id: iv.id, label: iv.label, level })}
            onEdit={() => setDraft({ mode: 'edit', id: iv.id, kind: iv.kind, params: {} })}
            onRemove={() => void remove(iv)}
          />
        ))}
      </Section>

      {draft && world ? (
        <DraftEditor
          draft={draft} accent={accent} specs={interventionKind(draft.kind)?.params(world.ctx) ?? []}
          base={draft.mode === 'edit' ? mine.find((i) => i.id === draft.id)?.params ?? {} : {}}
          onChange={(k, v) => setDraft((d) => (d ? { ...d, params: { ...d.params, [k]: v } } : d))}
          onCancel={() => setDraft(null)} onCommit={() => void commit()} busy={pending > 0}
        />
      ) : null}

      {preview?.errors?.length ? <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{preview.errors.join(' · ')}</div> : null}
      {preview?.output ? (
        <Section title="Live preview" right={<span className="chip simulated"><span className="dot" />not committed</span>}>
          <LevelResults output={preview.output} committed={committed} />
        </Section>
      ) : null}
      <ImagineBlock level={level} />
    </div>
  );
}

function summarize(iv: Intervention, specs: ParamSpec[]): string {
  return specs.slice(0, 4).map((s) => `${s.label.split(' ')[0]} ${formatSpec(s, iv.params[s.key])}`).join(' · ');
}

function InterventionCard({ iv, specs, accent, selected, readOnly, onSelect, onEdit, onRemove }: {
  iv: Intervention; specs: ParamSpec[]; accent: string; selected: boolean; readOnly: boolean; onSelect: () => void; onEdit: () => void; onRemove: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 10, cursor: 'pointer', border: `1px solid ${selected ? accent : 'var(--line)'}`, background: selected ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{iv.label}</span>
        <span className="mono faint" style={{ fontSize: 10 }}>{iv.id}</span>
        {!readOnly ? (
          <>
            <button type="button" className="btn sm icon ghost" aria-label="Edit" onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={12} /></button>
            <button type="button" className="btn sm icon ghost" aria-label="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Trash2 size={12} /></button>
          </>
        ) : null}
      </div>
      <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>{summarize(iv, specs)}</div>
    </div>
  );
}

function DraftEditor({ draft, specs, base, accent, busy, onChange, onCancel, onCommit }: {
  draft: Draft; specs: ParamSpec[]; base: Record<string, unknown>; accent: string; busy: boolean;
  onChange: (k: string, v: unknown) => void; onCancel: () => void; onCommit: () => void;
}) {
  const kind = interventionKind(draft.kind);
  return (
    <div className="glass" style={{ padding: 12, borderRadius: 12, marginBottom: 14, border: `1px solid ${accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div className="eyebrow" style={{ color: accent, flex: 1 }}>{draft.mode === 'create' ? 'New' : 'Edit'} · {kind?.label}</div>
        <button type="button" className="btn sm icon ghost" onClick={onCancel} aria-label="Cancel"><X size={13} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {specs.map((s) => (
          <SpecControl key={s.key} spec={s} accent={accent} value={draft.params[s.key] ?? base[s.key] ?? s.defaultValue} modified={s.key in draft.params} onChange={(v) => onChange(s.key, v)} />
        ))}
      </div>
      <button type="button" className={`btn ${accent.includes('violet') ? 'violet' : 'amber'}`} disabled={busy} style={{ width: '100%', height: 40, marginTop: 12, fontWeight: 600 }} onClick={onCommit}>
        {draft.mode === 'create' ? <Plus size={14} /> : <Check size={14} />} {draft.mode === 'create' ? 'Create' : 'Apply changes'} · {LEVELS[kind?.level ?? 'k1'].title.split('·')[0]}
      </button>
      <div className="faint" style={{ fontSize: 10.5, marginTop: 6, textAlign: 'center' }}>Validated and computed by the SpacetimeDB module; preview above is a local what-if.</div>
    </div>
  );
}

function ImagineBlock({ level }: { level: LevelId }) {
  const has = useWorld((s) => Boolean(s.outputs[level]));
  const branchId = useWorld((s) => s.branchId);
  const jobs = useWorld((s) => s.jobs);
  const assets = useWorld((s) => s.assets);
  const toast = useUi((s) => s.toast);
  const job = useMemo(() => jobs.find((j) => j.branchId === branchId && j.level === level), [jobs, branchId, level]);
  const asset = useMemo(() => assets.find((a) => a.branchId === branchId && a.level === level), [assets, branchId, level]);
  if (!has) return null;
  const busy = job && (job.status === 'queued' || job.status === 'leased');
  return (
    <Section title="Grok Imagine">
      {asset ? (
        <div style={{ marginBottom: 8 }}>
          <img src={asset.url} alt={asset.label} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)', opacity: asset.stale ? 0.55 : 1 }} />
          <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
            {asset.label} · revision {asset.revision} · {asset.model}
            {asset.stale ? <span style={{ color: 'var(--amber)' }}> · stale: the state changed since this render</span> : null}
          </div>
        </div>
      ) : null}
      {job && job.status === 'stale' ? <div style={{ color: 'var(--amber)', fontSize: 11.5, marginBottom: 6 }}>Last job discarded: {job.error}</div> : null}
      {job && job.status === 'failed' ? <div style={{ color: 'var(--red)', fontSize: 11.5, marginBottom: 6 }}>Last job failed: {job.error}</div> : null}
      <button
        type="button" className="btn sm" style={{ width: '100%' }} disabled={Boolean(busy)}
        onClick={async () => {
          const r = await useWorld.getState().requestImagine(level);
          toast({ kind: r.ok ? 'info' : 'error', title: r.ok ? 'Imagine job queued' : 'Imagine unavailable', body: r.message });
        }}
      >
        <Sparkles size={13} /> {busy ? `Imagine ${job!.status}…` : 'Imagine this state'}
      </button>
    </Section>
  );
}

export { levelOutput };
