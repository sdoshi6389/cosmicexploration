import type { LevelId } from '@cosmos/engine';
import { useWorld, type Receipt, type Source } from '../../state/world';

/**
 * Scenario presets are short command sequences through the same validated path as
 * the editor and the voice agent. Singletons are updated when they already exist.
 */
export interface ScenarioPreset {
  label: string;
  hint: string;
  steps: { kind: string; params: Record<string, unknown>; label?: string }[];
}

export const PRESETS: Record<LevelId, ScenarioPreset[]> = {
  k1: [
    { label: 'Global solar network', hint: 'Solar farms in every region (5 TW each)', steps: [{ kind: 'k1.network', params: { technology: 'solar', regions: 'all', capacityPerRegion_W: 5e12 }, label: 'Global solar network' }] },
    { label: 'Scale solar ×4', hint: 'Raise the existing network to 20 TW per region', steps: [{ kind: 'k1.network', params: { technology: 'solar', regions: 'all', capacityPerRegion_W: 2e13 }, label: 'Global solar network' }] },
    { label: 'Fusion backbone', hint: 'Fusion in every region (3 TW each)', steps: [{ kind: 'k1.network', params: { technology: 'fusion', regions: 'all', capacityPerRegion_W: 3e12 }, label: 'Fusion backbone' }] },
    { label: 'L1 sunshade', hint: 'Climate lever: 1.5% shade at Sun–Earth L1', steps: [{ kind: 'k1.climate', params: { kind: 'orbital_shade', magnitude: 0.015 } }] },
  ],
  k2: [
    { label: 'Swarm 30% + Mars habitat', hint: 'Dyson swarm capturing 30% of L☉, power to a Mars habitat', steps: [
      { kind: 'k2.swarm', params: { captureFraction: 0.3 }, label: 'Dyson swarm' },
      { kind: 'k2.habitat', params: { bodyId: 'body.mars', kind: 'habitat', demand_W: 1e17 }, label: 'Mars habitat' },
    ] },
    { label: 'Polar swarm 5%', hint: 'Polar band layout, 5% capture', steps: [{ kind: 'k2.swarm', params: { captureFraction: 0.05, layout: 'polar' }, label: 'Polar swarm' }] },
    { label: 'Jupiter station', hint: 'Industrial station at Jupiter (10²⁰ W)', steps: [{ kind: 'k2.habitat', params: { bodyId: 'body.jupiter', kind: 'station', demand_W: 1e20, priority: 2 }, label: 'Jupiter station' }] },
  ],
  k3: [
    { label: '0.1c · settle 50 yr · swarms', hint: 'Expand from Sol at 10% c, 50-year settlement delay, swarms at each star', steps: [{ kind: 'k3.expansion', params: { speed_c: 0.1, settlementDelay_yr: 50, buildSwarms: true, originStarId: 'star.sol' } }] },
    { label: 'Slow arks 0.01c', hint: '1% c, 500-year settlement', steps: [{ kind: 'k3.expansion', params: { speed_c: 0.01, settlementDelay_yr: 500 } }] },
    { label: 'Planet hosts only', hint: 'Target confirmed exoplanet hosts', steps: [{ kind: 'k3.expansion', params: { targets: 'exoplanet_hosts' } }] },
  ],
  b2: [
    { label: 'Show HbS mutation', hint: 'Introduce rs334 (c.20A>T, Glu6Val)', steps: [{ kind: 'b2.edit', params: { variantRsId: 'rs334', operation: 'introduce' }, label: 'Introduce HbS (rs334)' }] },
    { label: 'Apply reference sequence', hint: 'Restore the reference base at c.20', steps: [{ kind: 'b2.edit', params: { variantRsId: 'rs334', operation: 'repair' }, label: 'Apply reference (rs334)' }] },
  ],
  b4: [
    { label: 'Clear window', hint: 'WO₃, x = 0.02 (bleached)', steps: [{ kind: 'b4.window', params: { material: 'WO3', insertion_x: 0.02 } }] },
    { label: 'Tinted window', hint: 'WO₃, x = 0.35 (coloured)', steps: [{ kind: 'b4.window', params: { material: 'WO3', insertion_x: 0.35 } }] },
    { label: 'H 1s → 3p', hint: 'Retained hydrogen transition', steps: [{ kind: 'b4.transition', params: { nInitial: 1, lInitial: 0, nFinal: 3, lFinal: 1 } }] },
  ],
  b5: [{ label: 'Na-22 β⁺ decay', hint: 'Positron source kinematics', steps: [{ kind: 'b5.decay', params: {} }] }],
  b6: [
    { label: 'Power the lights', hint: 'Device at 10¹⁴ events/s driving 8 lamps', steps: [{ kind: 'b6.device', params: { eventRate_per_s: 1e14, lightCount: 8, lightPower_W: 60 } }] },
    { label: 'Rate ×100', hint: '10¹⁶ events/s', steps: [{ kind: 'b6.device', params: { eventRate_per_s: 1e16 } }] },
    { label: 'Single collision', hint: 'One e⁺e⁻ → γγ event at 0.5 MeV', steps: [{ kind: 'b6.collision', params: { kineticEnergy_MeV: 0.5 } }] },
  ],
};

/** Create (or update the matching existing) interventions for a preset. */
export async function applyPreset(p: ScenarioPreset, source: Source = 'ui'): Promise<Receipt[]> {
  const out: Receipt[] = [];
  for (const step of p.steps) {
    const w = useWorld.getState();
    const existing = w.interventions.find((i) => i.kind === step.kind && (step.label ? i.label === step.label : true));
    const r = existing
      ? await w.updateIntervention(existing.id, step.params, { source })
      : await w.createIntervention(step.kind, step.params, { source, label: step.label });
    out.push(r);
    if (r.status !== 'applied') break;
  }
  return out;
}
