import type { LevelId } from '@cosmos/engine';
import { useUi } from '../state/ui';
import { useWorld } from '../state/world';

/**
 * Request a Grok Imagine render of the current authoritative state. The prompt is
 * built server-side from the level's model output (state-linked); a registered worker
 * claims the job under a lease, and SpacetimeDB rejects the result if the state
 * changed in the meantime (stale-job protection).
 */
export async function generateConcept(level: LevelId, style = 'cinematic'): Promise<{ ok: boolean; message: string }> {
  const ui = useUi.getState();
  const w = useWorld.getState();
  const rev = w.branches.find((b) => b.id === w.branchId)?.revision ?? null;
  const r = await w.requestImagine(level, style);
  if (!r.ok) {
    ui.toast({ kind: 'warn', title: 'Imagine unavailable', body: r.message });
    return r;
  }
  ui.setConcept({ status: 'running', jobId: r.jobId ?? null, branchId: w.branchId, revision: rev, level, error: null, url: null, prompt: null, model: null, cached: false });
  return r;
}
