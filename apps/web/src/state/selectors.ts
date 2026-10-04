import type { LevelId, LevelOutput, ScienceTables } from '@cosmos/engine';
import { useScience } from './science';
import { useUi } from './ui';
import { useWorld } from './world';

const identity = (v: unknown) => v;

/**
 * A level's view for rendering: the live what-if preview while the user edits an
 * intervention, otherwise the authoritative output (bulky render arrays re-derived
 * locally and checked against the server inputHash). `pick` selects the part of the
 * level view a scene draws (e.g. B4 → the hydrogen transition).
 */
export function useLevelView<T>(level: LevelId, pick: (view: unknown) => unknown = identity): {
  output: T | null;
  preview: boolean;
  verified: boolean;
  pulse: number;
  level: LevelOutput | null;
} {
  const previewOut = useWorld((s) => s.previews[level]?.output);
  const rendered = useWorld((s) => s.render[level]);
  const pulse = useUi((s) => s.commitPulse[level] ?? 0);
  const lo = previewOut ?? rendered?.output ?? null;
  const view = lo?.view ? (pick(lo.view) as T | null | undefined) : null;
  return { output: view ?? null, preview: Boolean(previewOut), verified: !previewOut && Boolean(rendered?.verified), pulse, level: lo };
}

export function useTable<K extends keyof ScienceTables>(name: K): ScienceTables[K] {
  return useScience((s) => (s.tables[name] ?? EMPTY) as ScienceTables[K]);
}

const EMPTY: never[] = [];

export function useBundle() {
  return useScience((s) => s.bundle);
}
