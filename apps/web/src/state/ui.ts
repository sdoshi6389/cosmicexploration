import { create } from 'zustand';
import { STOP_BY_ID, type StopId } from '../navigation/stops';

export type ConsoleTab = 'mission' | 'results' | 'civilization' | 'assumptions' | 'sources' | 'worlds';
export type VoiceStatus = 'off' | 'connecting' | 'live' | 'listening' | 'thinking' | 'speaking' | 'offline' | 'error';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warn';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

export interface TranscriptLine {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  at: number;
  /** Streaming lines are updated in place instead of appended. */
  streaming?: boolean;
}

export interface ConceptState {
  jobId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  url: string | null;
  branchId: string | null;
  revision: number | null;
  level: string | null;
  prompt: string | null;
  model: string | null;
  error: string | null;
  cached: boolean;
}

/** Something the user (or a presenter) has picked: an intervention, region, body, star, model node, source... */
export interface Selection {
  kind: string;
  id: string;
  label: string;
  level?: string;
}

export type CellStation = 'overview' | 'dna' | 'protein' | 'cells';

export interface Transition {
  from: StopId;
  to: StopId;
  phase: 'out' | 'in';
  startedAt: number;
  direction: 'inward' | 'outward';
}

interface UiState {
  stop: StopId;
  /** The stop whose scene is mounted (lags `stop` during the outbound half of a warp). */
  displayedStop: StopId;
  transition: Transition | null;
  arrivalId: number;
  consoleOpen: boolean;
  consoleTab: ConsoleTab;
  helpOpen: boolean;
  toasts: Toast[];
  transcript: TranscriptLine[];
  voice: VoiceStatus;
  micLevel: number;
  concept: ConceptState;
  quality: 'high' | 'medium' | 'low';
  trueScale: boolean;
  earthLayer: 'none' | 'lst' | 'ndvi' | 'quakes';
  showLabels: boolean;
  /** Increments whenever a scenario is committed; scenes replay their build animation. */
  commitPulse: Record<string, number>;
  cellStation: CellStation;
  selection: Selection | null;
  /** Camera focus request (entity id); `nonce` re-triggers the same target. */
  focus: { id: string; nonce: number } | null;
  /** Selected base (c. position) in the gene editor. */
  geneCursor: number;
  setGeneCursor: (pos: number) => void;
  focusOn: (id: string) => void;
  /** Fly the camera to an exact pose (e.g. another explorer's view). */
  cameraJump: { stop: string; position: [number, number, number]; target: [number, number, number]; nonce: number } | null;
  jumpTo: (stop: string, position: [number, number, number], target: [number, number, number]) => void;
  /** Most recent first — lets voice/chat resolve "that", "it", "the previous one". */
  recentSelections: Selection[];
  select: (sel: Selection | null) => void;
  setCellStation: (s: CellStation) => void;
  /** PubChem CID shown in the molecular scene; null = crystallographic heme + O₂. */
  moleculeCid: number | null;
  setMoleculeCid: (cid: number | null) => void;
  goTo: (stop: StopId) => void;
  advanceTransition: (phase: 'in' | 'done') => void;
  setConsole: (open: boolean, tab?: ConsoleTab) => void;
  setHelp: (open: boolean) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  say: (role: TranscriptLine['role'], text: string, opts?: { streaming?: boolean; id?: string }) => string;
  updateLine: (id: string, text: string, done?: boolean) => void;
  setVoice: (v: VoiceStatus) => void;
  setMicLevel: (v: number) => void;
  setConcept: (c: Partial<ConceptState>) => void;
  setQuality: (q: UiState['quality']) => void;
  setTrueScale: (v: boolean) => void;
  setEarthLayer: (l: UiState['earthLayer']) => void;
  setShowLabels: (v: boolean) => void;
  pulse: (level: string) => void;
}

const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));

function initialQuality(): UiState['quality'] {
  try {
    const q = localStorage.getItem('cosmos.quality');
    if (q === 'high' || q === 'medium' || q === 'low') return q;
  } catch {
    /* ignore */
  }
  return (navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high';
}

export const useUi = create<UiState>((set, get) => ({
  stop: 'earth',
  displayedStop: 'earth',
  transition: null,
  arrivalId: 0,
  consoleOpen: true,
  consoleTab: 'mission',
  helpOpen: false,
  toasts: [],
  transcript: [],
  voice: 'off',
  micLevel: 0,
  concept: { jobId: null, status: 'idle', url: null, branchId: null, revision: null, level: null, prompt: null, model: null, error: null, cached: false },
  quality: initialQuality(),
  trueScale: false,
  earthLayer: 'none',
  showLabels: true,
  commitPulse: {},
  cellStation: 'overview',
  setCellStation: (cellStation) => set({ cellStation }),
  selection: null,
  focus: null,
  geneCursor: 20,
  setGeneCursor: (geneCursor) => set({ geneCursor }),
  focusOn: (id) => set((s) => ({ focus: { id, nonce: (s.focus?.nonce ?? 0) + 1 } })),
  cameraJump: null,
  jumpTo: (stop, position, target) => set((s) => ({ cameraJump: { stop, position, target, nonce: (s.cameraJump?.nonce ?? 0) + 1 } })),
  recentSelections: [],
  select: (selection) =>
    set((s) => ({
      selection,
      recentSelections: selection ? [selection, ...s.recentSelections.filter((x) => x.id !== selection.id)].slice(0, 8) : s.recentSelections,
    })),
  moleculeCid: null,
  setMoleculeCid: (moleculeCid) => set({ moleculeCid }),

  goTo: (to) => {
    const { stop, transition } = get();
    if (to === stop && !transition) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      set({ stop: to, displayedStop: to, transition: null, arrivalId: get().arrivalId + 1 });
      return;
    }
    const from = transition ? transition.to : stop;
    set({
      stop: to,
      transition: {
        from,
        to,
        phase: 'out',
        startedAt: performance.now(),
        direction: STOP_BY_ID[to].exp < STOP_BY_ID[from].exp ? 'inward' : 'outward',
      },
    });
  },

  advanceTransition: (phase) => {
    const t = get().transition;
    if (!t) return;
    if (phase === 'in') {
      set({ displayedStop: t.to, transition: { ...t, phase: 'in', startedAt: performance.now() }, arrivalId: get().arrivalId + 1 });
    } else {
      set({ transition: null });
    }
  },

  setConsole: (open, tab) => set((s) => ({ consoleOpen: open, consoleTab: tab ?? s.consoleTab })),
  setHelp: (open) => set({ helpOpen: open }),

  toast: (t) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 7000 : 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),

  say: (role, text, opts) => {
    const id = opts?.id ?? uid();
    set((s) => ({
      transcript: [...s.transcript, { id, role, text, at: Date.now(), streaming: opts?.streaming }].slice(-120),
    }));
    return id;
  },
  updateLine: (id, text, done) =>
    set((s) => ({
      transcript: s.transcript.map((l) => (l.id === id ? { ...l, text, streaming: done ? false : l.streaming } : l)),
    })),

  setVoice: (voice) => set({ voice }),
  setMicLevel: (micLevel) => set({ micLevel }),
  setConcept: (c) => set((s) => ({ concept: { ...s.concept, ...c } })),
  setQuality: (quality) => {
    try {
      localStorage.setItem('cosmos.quality', quality);
    } catch {
      /* ignore */
    }
    set({ quality });
  },
  setTrueScale: (trueScale) => set({ trueScale }),
  setEarthLayer: (earthLayer) => set({ earthLayer }),
  setShowLabels: (showLabels) => set({ showLabels }),
  pulse: (level) => set((s) => ({ commitPulse: { ...s.commitPulse, [level]: (s.commitPulse[level] ?? 0) + 1 } })),
}));
