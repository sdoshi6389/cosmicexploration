import type { Intervention, LevelId, LevelOutput } from './types.js';

const SCENE: Record<LevelId, string> = {
  k1: 'orbital view of Earth at night and day terminator, continental power grids glowing along HVDC corridors, solar and wind farms visible as luminous fields',
  k2: 'wide view of the Sun wrapped in orbiting bands of mirror-like Dyson collectors, thin power beams reaching a habitat near Mars',
  k3: 'the Milky Way seen from above, a spherical frontier of settled star systems spreading outward from the Sun, each settled star haloed by a faint collector swarm',
  b2: 'macro-to-micro medical illustration: red blood cells flowing through a capillary, with an inset of the haemoglobin protein',
  b4: 'sunlit room behind a large electrochromic window, crystal lattice of the oxide film shown as a translucent inset',
  b5: 'stylised sodium-22 nucleus emitting a positron and a 1275 keV gamma ray',
  b6: 'compact laboratory annihilation power cell: magnetic positron trap, gamma calorimeter shielding glowing with heat, cables feeding a row of lamps',
};

const fmt = (v: number | string | boolean): string => {
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-2) ? v.toExponential(2) : String(Math.round(v * 1000) / 1000);
};

/**
 * Deterministic, state-linked Grok Imagine prompt for a level output. The prompt
 * names the actual model results so the render is tied to a specific revision.
 */
export function imaginePrompt(level: LevelId, output: Pick<LevelOutput, 'summary' | 'modelId' | 'modelVersion'>, interventions: Intervention[], style = 'cinematic'): string {
  const facts = Object.entries(output.summary).slice(0, 8).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
  const ivs = interventions.filter((i) => i.level === level).map((i) => i.label).slice(0, 6).join('; ');
  return [
    `Concept art (${style}, photoreal lighting, 16:9): ${SCENE[level]}.`,
    ivs ? `Depict these interventions: ${ivs}.` : '',
    `Reflect the simulated state (${output.modelId}@${output.modelVersion}): ${facts}.`,
    'Illustrative concept only; no text, labels or logos in the image.',
  ].filter(Boolean).join(' ');
}
