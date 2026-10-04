import type { LevelId, ModelNode } from '@cosmos/engine';
import { ArrowDown } from 'lucide-react';
import { useState } from 'react';
import { useUi } from '../../state/ui';
import { useWorld } from '../../state/world';
import { EvidenceChip, Section } from '../controls';

const fmt = (v: number | string | boolean | null): string => {
  if (v === null) return '—';
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(3) : String(Math.round(v * 1e4) / 1e4);
};

/** Topological order: micro (no dependencies) first, macro last. */
function ordered(nodes: ModelNode[]): ModelNode[] {
  const depth = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const d = (n: ModelNode, seen = new Set<string>()): number => {
    if (depth.has(n.id)) return depth.get(n.id)!;
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    const v = n.dependsOn.length ? 1 + Math.max(...n.dependsOn.map((x) => (byId.get(x) ? d(byId.get(x)!, seen) : 0))) : 0;
    depth.set(n.id, v);
    return v;
  };
  return [...nodes].sort((a, b) => d(a) - d(b));
}

/**
 * Micro → intermediate → macro chain for a level: every node shows its model id and
 * version, inputs and outputs with units, evidence class and declared assumptions.
 * Edges come from the authoritative dependency_edge rows.
 */
export function DependencyGraph({ level }: { level: LevelId }) {
  const srv = useWorld((s) => s.outputs[level]);
  const edges = useWorld((s) => s.edges);
  const select = useUi((s) => s.select);
  const selected = useUi((s) => s.selection?.id);
  const [open, setOpen] = useState<string | null>(null);
  if (!srv?.nodes.length) return null;
  const nodes = ordered(srv.nodes);
  const lvlEdges = edges.filter((e) => e.level === level);
  return (
    <Section title={`Dependency graph · ${nodes.length} models · ${lvlEdges.length} edges`}>
      {nodes.map((n, i) => {
        const isOpen = open === n.id || selected === `node.${n.id}`;
        return (
          <div key={n.id}>
            {i > 0 ? (
              <div className="faint mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, margin: '3px 0 3px 10px' }}>
                <ArrowDown size={11} /> {n.dependsOn.join(' + ') || '—'}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(isOpen ? null : n.id);
                select({ kind: 'node', id: `node.${n.id}`, label: n.label, level });
              }}
              style={{
                all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', padding: '8px 10px', borderRadius: 9,
                border: `1px solid ${isOpen ? 'var(--cyan)' : 'var(--line)'}`, background: 'rgba(255,255,255,0.025)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{n.label}</span>
                <EvidenceChip kind={n.evidence} />
              </div>
              <div className="mono faint" style={{ fontSize: 10 }}>{n.modelId}@{n.version}</div>
              <div className="mono" style={{ fontSize: 11, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                {Object.entries(n.outputs).map(([k, q]) => (
                  <span key={k}><span className="muted">{k}</span> {fmt(q.value)} <span className="faint">{q.unit}</span></span>
                ))}
              </div>
              {isOpen ? (
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  <div className="eyebrow" style={{ fontSize: 9 }}>inputs</div>
                  <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                    {Object.entries(n.inputs).map(([k, q]) => (
                      <span key={k}><span className="muted">{k}</span> {fmt(q.value)} <span className="faint">{q.unit}</span></span>
                    ))}
                  </div>
                  {n.assumptions.length ? (
                    <>
                      <div className="eyebrow" style={{ fontSize: 9, marginTop: 6 }}>assumptions</div>
                      <ul className="muted" style={{ margin: 0, paddingLeft: 14, lineHeight: 1.5 }}>{n.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </button>
          </div>
        );
      })}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 8 }}>
        Output {srv.modelId}@{srv.modelVersion} · input hash {srv.inputHash} · computed in SpacetimeDB at revision {srv.revision}
      </div>
    </Section>
  );
}
