import { interventionKind, type B2BodyView, type LevelId } from '@cosmos/engine';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STOP_BY_ID, type StopId } from '../../navigation/stops';
import { useBundle } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { toastRejection, useWorld } from '../../state/world';
import { Section, SpecControl } from '../controls';

/**
 * Controls for the depth you are looking at. Each control edits the intervention
 * parameter that physically lives at this scale; changes preview instantly and are
 * committed (validated + computed in SpacetimeDB) a moment after you stop dragging.
 */
const DEPTH: Partial<Record<StopId, { title: string; hint: string; controls: [string, string[]][]; assumptions?: string[] }>> = {
  town: { title: 'Population', hint: 'Who carries the edited genome. Scroll in on a person to reach their genes.', controls: [['b2.population', ['size', 'editedFraction']]], assumptions: ['zygosity'] },
  body: { title: 'Physiology', hint: 'How this body compensates for its haemoglobin.', controls: [], assumptions: ['compensationMax', 'hbNormal', 'hbSevere'] },
  cell: { title: 'Red cells', hint: 'How haemoglobin variants change red-cell behaviour (declared rules).', controls: [], assumptions: ['sicklingThreshold', 'maxSickledFraction', 'occlusionFactor'] },
  protein: { title: 'β-globin', hint: 'The protein translated from the edited codons; residue changes are listed below.', controls: [], assumptions: ['mechanismRule'] },
  city: { title: 'City', hint: 'How many rooms share this window design. Click a building to enter a room.', controls: [['b4.city', ['buildings', 'roomsPerBuilding']]], assumptions: ['outdoorLux'] },
  room: { title: 'Room', hint: 'Window size, room size and film material.', controls: [['b4.window', ['material', 'windowArea_m2', 'floorArea_m2']]], assumptions: ['daylightCoupling'] },
  lattice: { title: 'Lattice', hint: 'Click sites in the lattice to insert/remove ions, or set x directly. Thickness stacks unit cells.', controls: [['b4.window', ['material', 'insertion_x', 'thickness_nm']]] },
  atom: { title: 'Electron states', hint: 'Move an electron between NIST hydrogen levels and see the photon.', controls: [['b4.transition', ['nInitial', 'lInitial', 'nFinal', 'lFinal', 'mFinal']]], assumptions: ['useNist'] },
  grid: { title: 'City grid', hint: 'Households, their demand and how many reactors feed them. Click a reactor to go inside.', controls: [['b6.city', ['households', 'demandPerHousehold_W']], ['b6.device', ['units']]] },
  device: { title: 'Reactor', hint: 'Capture, conversion and the cost of making the antimatter.', controls: [['b6.device', ['captureFraction', 'conversionEfficiency', 'lightCount', 'lightPower_W']]], assumptions: ['supplyEfficiency'] },
  particle: { title: 'Collision', hint: 'Which particles annihilate, how fast, and how often.', controls: [['b6.device', ['species', 'kineticEnergy_MeV', 'eventRate_per_s']]], assumptions: ['electronMass_MeV'] },
};

export function DepthControls({ stop }: { stop: StopId }) {
  const s = STOP_BY_ID[stop];
  const cfg = DEPTH[stop];
  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.55 }}>{s.blurb}</p>
      {stop === 'gene' ? <GeneEditor /> : null}
      {stop === 'protein' ? <ProteinChanges /> : null}
      {stop === 'grid' || stop === 'device' || stop === 'particle' ? <RequiredRate /> : null}
      {cfg ? (
        <Section title={`${cfg.title} · controls at this scale`}>
          <div className="faint" style={{ fontSize: 11, marginBottom: 10 }}>{cfg.hint}</div>
          {cfg.controls.map(([kind, keys]) => <ParamEditor key={kind + keys.join()} kind={kind} keys={keys} level={s.level!} />)}
          {(cfg.assumptions ?? []).map((k) => <AssumptionEditor key={k} k={k} level={s.level!} />)}
        </Section>
      ) : null}
    </div>
  );
}

/** Live-editing of a singleton intervention's parameters (created on first change). */
export function ParamEditor({ kind, keys, level }: { kind: string; keys: string[]; level: LevelId }) {
  const world = useWorld((st) => st.world);
  const ivs = useWorld((st) => st.interventions);
  const role = useWorld((st) => st.role);
  const iv = ivs.find((i) => i.kind === kind);
  const k = interventionKind(kind);
  const specs = useMemo(() => (world && k ? k.params(world.ctx).filter((p) => keys.includes(p.key)) : []), [world, k, keys]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft({}), [iv?.updatedSeq]);
  if (!k || !world) return null;
  const commit = (params: Record<string, unknown>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const w = useWorld.getState();
      const cur = w.interventions.find((i) => i.kind === kind);
      const r = cur ? await w.updateIntervention(cur.id, params) : await w.createIntervention(kind, params);
      w.preview(level, null);
      if (r.status !== 'applied') toastRejection(`Change ${r.status}`, r);
    }, 450);
  };
  const change = (key: string, v: unknown) => {
    const next = { ...draft, [key]: v };
    if (kind === 'b4.window' && key === 'insertion_x') next.occupiedSites = '';
    setDraft(next);
    const w = useWorld.getState();
    w.preview(level, iv ? { update: { id: iv.id, params: next } } : { create: { kind, params: next } });
    commit(next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
      {specs.map((sp) => (
        <SpecControl key={sp.key} spec={sp} accent="var(--violet)" value={draft[sp.key] ?? iv?.params[sp.key] ?? sp.defaultValue} modified={sp.key in draft} onChange={(v) => role !== 'viewer' && change(sp.key, v)} />
      ))}
    </div>
  );
}

function AssumptionEditor({ k, level }: { k: string; level: LevelId }) {
  const world = useWorld((st) => st.world);
  const overrides = useWorld((st) => st.assumptions);
  const spec = useMemo(() => world?.assumptionSpecs(level).find((a) => a.key === k), [world, level, k]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState<unknown>(undefined);
  if (!spec) return null;
  const value = draft ?? (k in overrides ? overrides[k] : spec.defaultValue);
  return (
    <div style={{ marginBottom: 12 }}>
      <SpecControl
        spec={spec} value={value} modified={k in overrides}
        onChange={(v) => {
          setDraft(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void useWorld.getState().setAssumption(k, v).then(() => setDraft(undefined)), 450);
        }}
      />
      <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>model assumption · {spec.evidence.method ?? spec.evidence.kind}</div>
    </div>
  );
}

const BASE_COLOR: Record<string, string> = { A: '#3fe08a', T: '#ff5f7a', G: '#ffcf5c', C: '#5c9dff' };
const CODE: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L', CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L', ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M', GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S', CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P', ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T', GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*', CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q', AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K', GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W', CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R', AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R', GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

/** Base-level editor for the HBB coding sequence: click a base, choose its replacement. */
function GeneEditor() {
  const bundle = useBundle();
  const view = useWorld((st) => st.render.b2?.output.view as B2BodyView | undefined);
  const ivs = useWorld((st) => st.interventions);
  const cursor = useUi((st) => st.geneCursor);
  const setCursor = useUi((st) => st.setGeneCursor);
  const ref = bundle?.hbb.cds.value ?? '';
  const cds = view?.cds ?? ref;
  const edited = new Set((view?.mutations ?? []).map((m) => m.position));
  const k = Math.floor((cursor - 1) / 3);
  const codon = cds.slice(k * 3, k * 3 + 3);
  const apply = async (alt: string) => {
    const r = await useWorld.getState().createIntervention('b2.base_edit', { position: cursor, alt }, { label: `c.${cursor}${cds[cursor - 1]}>${alt}` });
    if (r.status !== 'applied') toastRejection(`Edit ${r.status}`, r);
  };
  const variants = bundle?.hbb.variants ?? [];
  return (
    <>
      <Section title={`HBB coding sequence · ${bundle?.hbb.transcript ?? ''} · ${cds.length} nt`}>
        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 3, padding: 4, borderRadius: 8, background: 'rgba(0,0,0,0.25)' }}>
          {Array.from({ length: Math.ceil(cds.length / 3) }, (_, c) => (
            <div key={c} title={`codon ${c + 1} · ${CODE[cds.slice(c * 3, c * 3 + 3)] ?? '?'}`} style={{ display: 'flex', border: `1px solid ${c === k ? 'var(--cyan)' : 'transparent'}`, borderRadius: 4 }}>
              {[0, 1, 2].map((j) => {
                const pos = c * 3 + j + 1;
                const b = cds[pos - 1];
                if (!b) return null;
                return (
                  <button
                    key={j} type="button" onClick={() => setCursor(pos)}
                    style={{
                      all: 'unset', cursor: 'pointer', width: 11, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
                      color: BASE_COLOR[b], background: pos === cursor ? 'rgba(92,225,255,0.35)' : edited.has(pos) ? 'rgba(180,140,255,0.4)' : 'transparent',
                    }}
                  >{b}</button>
                );
              })}
            </div>
          ))}
        </div>
      </Section>
      <Section title={`Selected base · c.${cursor} · codon ${k + 1}`}>
        <div className="mono" style={{ fontSize: 12, marginBottom: 8 }}>
          {codon} → {CODE[codon] ?? '?'}{ref[cursor - 1] !== cds[cursor - 1] ? ` · reference ${ref[cursor - 1]}` : ''}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {['A', 'C', 'G', 'T'].map((b) => {
            const nc = codon.split('');
            nc[(cursor - 1) % 3] = b;
            const aa = CODE[nc.join('')] ?? '?';
            const same = b === cds[cursor - 1];
            return (
              <button key={b} type="button" className="btn sm" disabled={same} onClick={() => void apply(b)} style={{ borderColor: BASE_COLOR[b], flexDirection: 'column', height: 46 }}>
                <span className="mono" style={{ color: BASE_COLOR[b], fontSize: 15 }}>{b}</span>
                <span className="faint" style={{ fontSize: 9.5 }}>{same ? 'current' : `${CODE[codon]}${k + 1}${aa}${aa === '*' ? ' stop' : aa === CODE[codon] ? ' syn' : ''}`}</span>
              </button>
            );
          })}
        </div>
      </Section>
      {view?.mutations.length ? (
        <Section title={`Edits on this branch · ${view.mutations.length}`}>
          {view.mutations.map((m) => (
            <div key={m.interventionId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '3px 0' }}>
              <button type="button" className="btn sm ghost" style={{ padding: '0 6px' }} onClick={() => setCursor(m.position)}>{m.label}</button>
              <span className="faint" style={{ flex: 1 }}>{m.effect.replace('_', ' ')}</span>
              {ivs.some((i) => i.id === m.interventionId) ? (
                <button type="button" className="btn sm icon ghost" aria-label="Remove edit" onClick={() => void useWorld.getState().removeIntervention(m.interventionId)}><Trash2 size={12} /></button>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}
      <Section title="Known variants (ClinVar) — jump to position">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {variants.filter((v) => v.cdsPosition).map((v) => (
            <button key={v.rsId} type="button" className="btn sm ghost" title={`${v.hgvsC} ${v.hgvsP} · ${v.clinicalSignificance}`} onClick={() => setCursor(v.cdsPosition!)}>
              {v.label} · c.{v.cdsPosition}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

/** What it would take to light the whole city with the current particle choice. */
function RequiredRate() {
  const d = useWorld((st) => (st.render.b6?.output.view as { device?: { electricalW: number; eventRatePerS: number; units: number; species: string; city: { demandW: number; litFraction: number } | null } } | undefined)?.device);
  if (!d?.city || d.electricalW <= 0) return null;
  const perEvent = d.electricalW / (d.eventRatePerS * d.units);
  const need = d.city.demandW / perEvent / d.units;
  return (
    <div className="glass" style={{ padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 12 }}>
      <div className="eyebrow" style={{ fontSize: 9.5 }}>To light the whole city</div>
      <div className="mono">{need.toExponential(2)} {d.species === 'proton' ? 'p p̄' : 'e⁺e⁻'} events/s per reactor (now {d.eventRatePerS.toExponential(1)}) · {(d.city.litFraction * 100).toFixed(1)}% lit</div>
    </div>
  );
}

function ProteinChanges() {
  const view = useWorld((st) => st.render.b2?.output.view as B2BodyView | undefined);
  const muts = (view?.mutations ?? []).filter((m) => m.effect !== 'synonymous' && m.effect !== 'no_change');
  return (
    <Section title="Residue changes from your edits">
      {muts.length ? muts.map((m) => <div key={m.interventionId} className="mono" style={{ fontSize: 12 }}>p.{m.aaBefore}{m.codon}{m.aaAfter} · {m.effect}</div>) : <div className="muted" style={{ fontSize: 12 }}>No amino-acid changes — the protein matches the reference β-globin.</div>}
      {view ? <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Phenotype rule: {view.phenotype.replace('_', ' ')}</div> : null}
    </Section>
  );
}
