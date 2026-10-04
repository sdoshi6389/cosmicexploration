import type { BarrowLevel } from '../types.js';

export const BARROW_LABELS: Record<BarrowLevel, string> = {
  1: 'B1 — Macroscopic',
  2: 'B2 — Genetic',
  3: 'B3 — Molecular',
  4: 'B4 — Atomic',
  5: 'B5 — Nuclear',
  6: 'B6 — Particle',
};

export function barrowLabel(level: BarrowLevel): string {
  return BARROW_LABELS[level];
}
