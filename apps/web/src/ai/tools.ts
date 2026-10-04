import { assessFeasibility, interventionKind, INTERVENTION_KINDS, LEVELS, levelOfKind, searchEntities, STRUCTURE_TYPES, type EntityRef, type Intervention, type LevelId } from '@cosmos/engine';
import { deeper, shallower, STOP_BY_ID, STOPS, type StopId } from '../navigation/stops';
import { useUi, type ConsoleTab } from '../state/ui';
import { useWorld, type Receipt, type Source } from '../state/world';
import { generateConcept } from './imagine';

const LEVEL_IDS = Object.keys(LEVELS) as LevelId[];
const STOP_IDS = STOPS.map((s) => s.id);
const YEAR = 365.25 * 86400;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });

export const TOOLS: ToolSpec[] = [
  { name: 'get_context', description: 'Current stop, level, branch/revision, role, capabilities, active interventions (ids, params), the selected object and recent selections, clock, latest results and recent command receipts. Call before resolving "that/it/the last one".', parameters: obj() },
  { name: 'get_results', description: 'Full authoritative results for a level: summary numbers, the micro→macro model chain (inputs/outputs with units, model ids/versions), warnings and assumptions. Use to explain results.', parameters: obj({ level: { type: 'string', enum: LEVEL_IDS } }) },
  { name: 'focus', description: 'Fly the camera to ANY object: a planet, moon, dwarf planet, the Sun, any catalogued star (e.g. "Vega", "Alpha Centauri", "Betelgeuse"), a K1 region ("Africa") or a built structure. Also selects it. Use for "take me to / show me".', parameters: obj({ target: { type: 'string' } }, ['target']) },
  { name: 'find', description: 'Search bodies and stars by name; returns ids, kinds and distances. Use when unsure what exists.', parameters: obj({ query: { type: 'string' } }, ['query']) },
  {
    name: 'build',
    description: 'FREE BUILDING: construct a structure on or around any body or star. Types: dyson_swarm or dyson_sphere (stars only: the Sun or any other star), surface_collectors (rocky planets and moons), orbital_ring (any planet or moon), gas_harvester (Jupiter, Saturn, Uranus, Neptune fusion fuel), habitat (anywhere; consumes power). "Harness the power of X" means pick the type that fits X. Other stars need K3 (raised automatically).',
    parameters: obj({
      host: { type: 'string', description: 'body or star name or id, e.g. "moon", "Jupiter", "Vega"' },
      type: { type: 'string', enum: STRUCTURE_TYPES.map((t) => t.value) },
      coverage: { type: 'number', description: 'fraction 0-1 of the star output or sunlit disc captured' },
      efficiency: { type: 'number' }, construction: { type: 'number' }, orbitRadius_AU: { type: 'number' },
      harvestRate_kgps: { type: 'number' }, demand_W: { type: 'number' }, population: { type: 'number' }, label: { type: 'string' },
    }, ['host', 'type']),
  },
  { name: 'navigate', description: 'Fly to a scale stop. Barrow civilisations are zoom stacks: B2 town → body → cell → protein → gene; B4 city → room → lattice → atom; B6 grid → device → particle.', parameters: obj({ stop: { type: 'string', enum: STOP_IDS } }, ['stop']) },
  { name: 'zoom', description: 'Semantic zoom inside a Barrow civilisation: "in" goes one level smaller (town→person→blood→haemoglobin→gene; city→room→lattice→atom; grid→reactor→collision), "out" one level larger.', parameters: obj({ direction: { type: 'string', enum: ['in', 'out'] } }, ['direction']) },
  { name: 'select', description: 'Select an object by id or name: an intervention, a region (e.g. "africa"), or a model node. Selection makes later "it/that" references unambiguous.', parameters: obj({ target: { type: 'string' } }, ['target']) },
  {
    name: 'create_intervention',
    description: 'Create an intervention (see catalog for kinds and parameter keys, SI units). Capability is raised automatically as a logged event if needed. Singleton kinds (k1.climate, k3.expansion, b4.window, b4.transition, b5.decay, b6.device, b6.collision) must be updated instead if they already exist.',
    parameters: obj({ kind: { type: 'string', enum: INTERVENTION_KINDS.map((k) => k.kind) }, params: { type: 'object', additionalProperties: true }, label: { type: 'string' } }, ['kind']),
  },
  {
    name: 'update_intervention',
    description: 'Change parameters of an existing intervention. Omit `target` to mean the selected/most relevant one ("increase that", "change its material"); if ambiguous the tool returns candidates — then ask the user which one.',
    parameters: obj({ target: { type: 'string', description: 'intervention id, label, or kind' }, params: { type: 'object', additionalProperties: true }, label: { type: 'string' } }, ['params']),
  },
  { name: 'remove_intervention', description: 'Remove an intervention (omit target for the selected one; ambiguous → candidates).', parameters: obj({ target: { type: 'string' } }) },
  { name: 'set_assumption', description: 'Override a declared model assumption on this branch (catalog keys).', parameters: obj({ key: { type: 'string' }, value: { description: 'number, boolean or choice string' } }, ['key', 'value']) },
  { name: 'set_capabilities', description: 'Advance (or change) the civilisation level of this branch: Kardashev 1–3, Barrow 2/4/6. ONLY when the user explicitly asks to advance/switch civilisation level — never to get around a "not possible" result on your own.', parameters: obj({ kardashev: { type: 'integer', minimum: 1, maximum: 3 }, barrow: { type: 'integer', minimum: 1, maximum: 6 } }) },
  { name: 'switch_civilisation', description: 'Move the user into another civilisation (K1, K2, K3, B2, B4, B6), raising the branch capability if needed. ONLY when the user explicitly asks to switch/go to that civilisation — never to make a refused request work.', parameters: obj({ civilisation: { type: 'string', enum: ['K1', 'K2', 'K3', 'B2', 'B4', 'B6'] } }, ['civilisation']) },
  { name: 'undo', description: 'Undo the last change on this branch ("undo the last change").', parameters: obj() },
  { name: 'redo', description: 'Redo the next undone change.', parameters: obj() },
  { name: 'reset', description: 'Reset this branch to the immutable baseline (events stay redo-able).', parameters: obj() },
  { name: 'set_clock', description: 'Control simulated time (shared, server-driven): play, pause, set_rate (years per real second) or seek (to a year).', parameters: obj({ action: { type: 'string', enum: ['play', 'pause', 'set_rate', 'seek'] }, years: { type: 'number' } }, ['action']) },
  { name: 'fork_branch', description: 'Fork the current branch into a new one (the parent becomes the comparison).', parameters: obj({ name: { type: 'string' } }) },
  { name: 'switch_branch', description: 'Switch to another branch by name or id.', parameters: obj({ branch: { type: 'string' } }, ['branch']) },
  { name: 'compare_branches', description: 'Compare the current branch with another ("parent" = fork parent) and return per-level differences.', parameters: obj({ with: { type: 'string' } }, ['with']) },
  { name: 'request_imagine', description: 'Queue a Grok Imagine concept render of a level\'s current authoritative state (labelled illustrative; stale results are rejected).', parameters: obj({ level: { type: 'string', enum: LEVEL_IDS } }) },
  { name: 'show_panel', description: 'Open a console tab.', parameters: obj({ tab: { type: 'string', enum: ['mission', 'results', 'civilization', 'assumptions', 'sources', 'worlds'] } }, ['tab']) },
];

/** Model-readable catalog generated from the engine's own specs. */
export function toolCatalog(): string {
  const world = useWorld.getState().world;
  if (!world) return '';
  const lines: string[] = [];
  for (const k of INTERVENTION_KINDS) {
    const params = k.params(world.ctx).map((p) => {
      const range = p.kind === 'number' ? `${p.min}..${p.max}` : p.kind === 'choice' ? (p.choices ?? []).slice(0, 8).map((c) => c.value).join('|') : 'true|false';
      return `${p.key} (${p.unit || p.kind}; ${range}; default ${String(p.defaultValue)})`;
    });
    lines.push(`- ${k.kind}${k.singleton ? ' [singleton]' : ''} · ${k.label} · level ${k.level} · needs ${k.minKardashev ? `K${k.minKardashev}` : `B${k.minBarrow}`}\n  params: ${params.join('; ')}`);
  }
  for (const id of LEVEL_IDS) {
    const asm = world.assumptionSpecs(id).map((a) => `${a.key}=${typeof a.defaultValue === 'number' ? Number(a.defaultValue.toPrecision(4)) : String(a.defaultValue)}${a.unit ? ` ${a.unit}` : ''}`);
    if (asm.length) lines.push(`- assumptions ${id}: ${asm.join('; ')}`);
  }
  return lines.join('\n');
}

export function contextSnapshot(): Record<string, unknown> {
  const w = useWorld.getState();
  const ui = useUi.getState();
  const branch = w.branches.find((b) => b.id === w.branchId);
  const stop = STOP_BY_ID[ui.stop];
  return {
    stop: ui.stop,
    stopTitle: stop.name,
    levelAtStop: stop.level,
    zoomIn: deeper(ui.stop),
    zoomOut: shallower(ui.stop),
    branch: branch?.name,
    branchId: w.branchId,
    revision: branch?.revision,
    role: w.role,
    mode: w.mode,
    capabilities: w.capabilities,
    activeCivilisation: { id: activeCiv(), name: activeCiv() ? CIV_NAME[activeCiv()!] : 'none (exploration view)', ...civAbilities(activeCiv()) },
    branchCapability: `K${w.capabilities.kardashevLevel} · B${w.capabilities.barrowLevel} (highest levels this branch has unlocked)`,
    selection: ui.selection,
    recentSelections: ui.recentSelections.slice(0, 4),
    interventions: w.interventions.map((i) => ({ id: i.id, kind: i.kind, level: i.level, label: i.label, params: i.params })),
    assumptionOverrides: w.assumptions,
    clock: { running: w.clock.running, years: +(w.simNow() / YEAR).toFixed(1), yearsPerSecond: +(w.clock.rate / YEAR).toFixed(2) },
    results: Object.fromEntries(Object.entries(w.outputs).map(([l, o]) => [l, { summary: o!.summary, warnings: o!.warnings.slice(0, 3) }])),
    lastCommands: w.receipts.slice(0, 3).map((r) => ({ action: r.action, status: r.status, message: r.message, source: r.source })),
    branches: w.branches.map((b) => b.name),
  };
}

function resolveBranch(q: string): string | undefined {
  const w = useWorld.getState();
  if (q === 'parent') return w.branches.find((x) => x.id === w.branchId)?.parentBranchId || undefined;
  const lower = q.toLowerCase();
  return w.branches.find((x) => x.id === q || x.name.toLowerCase() === lower)?.id ?? w.branches.find((x) => x.name.toLowerCase().includes(lower))?.id;
}

type Resolved = { iv: Intervention } | { error: Record<string, unknown> };

/** Resolve "that / it / the window / iv_abc" to one intervention, or return candidates to clarify. */
function resolveIntervention(target: string | undefined): Resolved {
  const w = useWorld.getState();
  const ui = useUi.getState();
  const all = w.interventions;
  if (!all.length) return { error: { ok: false, error: 'There are no interventions on this branch yet.' } };
  const list = (c: Intervention[]) => c.map((i) => ({ id: i.id, label: i.label, kind: i.kind }));
  const t = target?.trim().toLowerCase();
  if (t && !['that', 'it', 'this', 'selected', 'the selected one'].includes(t)) {
    const exact = all.filter((i) => i.id.toLowerCase() === t || i.label.toLowerCase() === t || i.kind === t);
    const fuzzy = exact.length ? exact : all.filter((i) => i.label.toLowerCase().includes(t) || i.kind.includes(t) || i.level === t);
    if (fuzzy.length === 1) return { iv: fuzzy[0]! };
    if (fuzzy.length > 1) return { error: { ok: false, needs_clarification: true, question: `Which one do you mean?`, candidates: list(fuzzy) } };
    return { error: { ok: false, error: `No intervention matches "${target}".`, candidates: list(all) } };
  }
  const sel = ui.selection?.kind === 'intervention' ? all.find((i) => i.id === ui.selection!.id) : undefined;
  if (sel) return { iv: sel };
  for (const r of ui.recentSelections) {
    const iv = all.find((i) => i.id === r.id);
    if (iv) return { iv };
  }
  const level = STOP_BY_ID[ui.stop].level;
  const here = level ? all.filter((i) => i.level === level) : [];
  if (here.length === 1) return { iv: here[0]! };
  const recent = [...all].sort((a, b) => b.updatedSeq - a.updatedSeq);
  if (here.length === 0 && recent.length === 1) return { iv: recent[0]! };
  return { error: { ok: false, needs_clarification: true, question: 'Which intervention do you mean?', candidates: list(here.length ? here : recent.slice(0, 5)) } };
}

/** Rename ambiguous summary fields so they can't be narrated wrongly. */
function explainSummary(sum: Record<string, number | string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sum)) {
    if (k === 'achievedK') out.energyHarnessedAsKardashevIndex = v;
    else if (k === 'roomLux' && typeof v === 'number') out.roomLight = `${Math.round(v)} lx — ${v >= 500 ? 'bright (office level)' : v >= 300 ? 'enough to read (≥300 lx)' : v >= 100 ? 'dim: NOT enough to read (needs ~300 lx)' : 'dark'}`;
    else if (k === 'transmission' && typeof v === 'number') out.transmission = `${(v * 100).toFixed(1)}% (WO₃ clears as x falls; NiO clears as x rises)`;
    else if (k === 'cityLitFraction' && typeof v === 'number') out.cityDistrictsLit = `${(v * 100).toFixed(1)}%${v < 1 ? ' — demand NOT met' : ' — demand met'}`;
    else if (k === 'citySavingW' && typeof v === 'number') out.cityEnergyVsReferenceFilm = v >= 0 ? `uses ${v.toExponential(3)} W LESS than the reference film` : `uses ${(-v).toExponential(3)} W MORE than the reference film`;
    else out[k] = v;
  }
  return out;
}

function result(r: Receipt, level?: LevelId): Record<string, unknown> {
  if (r.status !== 'applied') {
    const m = r.message.match(/Possible for a (K\d)?(?: · )?(B\d)? civilisation/);
    return m
      ? { ok: false, status: 'not_possible_at_this_level', error: r.message, requires: [m[1], m[2]].filter(Boolean).join(' · '), currentCivilisation: `K${useWorld.getState().capabilities.kardashevLevel} · B${useWorld.getState().capabilities.barrowLevel}`, instruction: 'Explain why, name the civilisation level where it works, and ask whether to advance or fork. Do NOT call set_capabilities unless the user says yes.' }
      : { ok: false, status: r.status, error: r.message };
  }
  const w = useWorld.getState();
  const out = level ? w.outputs[level] : undefined;
  const VIEW: Record<string, string> = { k1: 'Earth view', k2: 'Solar System view', k3: 'Galaxy view', b2: 'genome civilisation', b4: 'materials civilisation', b5: 'nuclear view', b6: 'particle civilisation' };
  return {
    ok: true, revision: r.revision, message: r.message,
    civilisation: `${activeCiv() ?? 'none'} (unchanged — the user switches civilisations)`,
    ...(level ? { shownIn: VIEW[level] } : {}),
    note: 'energyHarnessedAsKardashevIndex is the energy these builds harness expressed on the Kardashev scale — it never changes which civilisation the user is in.',
    ...(r.interventionId ? { interventionId: r.interventionId } : {}),
    ...(out ? { summary: explainSummary(out.summary), warnings: out.warnings.slice(0, 3), computedBy: `${out.modelId}@${out.modelVersion} in SpacetimeDB` } : {}),
  };
}

function describe(e: EntityRef) {
  return { id: e.id, name: e.name, kind: e.kind, system: e.system === 'sol' ? 'Solar System' : 'interstellar', distance: `${e.distance.toFixed(e.distanceUnit === 'AU' ? 2 : 1)} ${e.distanceUnit}`, luminosityW: e.luminosityW ?? undefined };
}

function buildOptions(e: EntityRef): string[] {
  if (e.kind === 'star') return ['dyson_swarm', 'dyson_sphere', 'habitat'];
  if (['body.jupiter', 'body.saturn', 'body.uranus', 'body.neptune'].includes(e.id)) return ['gas_harvester', 'orbital_ring', 'habitat'];
  return ['surface_collectors', 'orbital_ring', 'habitat'];
}

/* ------------------------------------------------ active civilisation gate
 * The civilisation the user is currently in is the one they are viewing (K1 Earth,
 * K2 Solar System, K3 galaxy, B2/B4/B6 Barrow civilisations). Requests outside it
 * are refused with the reason and the civilisation that could do it — the agent
 * never switches civilisation or navigates on its own.
 */
export type CivId = 'K1' | 'K2' | 'K3' | 'B2' | 'B4' | 'B6';
export const CIV_NAME: Record<CivId, string> = {
  K1: 'K1 planetary civilisation (Earth)', K2: 'K2 stellar civilisation (Solar System)', K3: 'K3 galactic civilisation',
  B2: 'B2 genome civilisation', B4: 'B4 materials (atomic) civilisation', B6: 'B6 particle civilisation',
};
const CIV_STOP: Record<CivId, StopId> = { K1: 'earth', K2: 'solar', K3: 'galaxy', B2: 'town', B4: 'city', B6: 'grid' };

export function activeCiv(): CivId | null {
  const lvl = STOP_BY_ID[useUi.getState().stop].level;
  if (!lvl || lvl === 'b5') return null;
  return lvl.toUpperCase() as CivId;
}

function civAbilities(civ: CivId | null): { can: string[]; cannot: string[] } {
  switch (civ) {
    case 'K1': return { can: ['Regional power networks and plants on Earth', 'Climate levers (sunshade, aerosols, albedo)', 'Structures on Earth and the Moon (collectors, orbital rings, habitats)', 'Up to ~2×10¹⁷ W in total'], cannot: ['Anything elsewhere in the Solar System or around the Sun → K2', 'Other stars → K3', 'Genes / atoms / antimatter → B2 / B4 / B6'] };
    case 'K2': return { can: ['Everything K1 can', 'Dyson swarms/spheres around the Sun', 'Collectors, rings, gas harvesters and habitats on any planet or moon', 'Up to the Sun’s 3.8×10²⁶ W'], cannot: ['Other stars, interstellar expansion → K3', 'Genes / atoms / antimatter → B2 / B4 / B6'] };
    case 'K3': return { can: ['Everything K1/K2 can', 'Interstellar expansion from any star', 'Dyson structures and habitats at any catalogued star', 'Up to ~10³⁷ W'], cannot: ['Genes / atoms / antimatter → B2 / B4 / B6', 'FTL, time travel, other universes (never)'] };
    case 'B2': return { can: ['Edit any base of the HBB gene', 'Choose who in the population carries the edit', 'Genome/physiology assumptions'], cannot: ['Atom-level materials (window films, ion placement) → B4', 'Antimatter / particles → B6', 'Energy megastructures (grids, Dyson spheres, other worlds) → K1/K2/K3'] };
    case 'B4': return { can: ['Everything B2 can (gene edits)', 'Window-film materials, ion placement, thickness', 'City buildings and rooms', 'Atomic transitions'], cannot: ['Antimatter / particles → B6', 'Energy megastructures → K1/K2/K3'] };
    case 'B6': return { can: ['Everything B2/B4 can', 'Matter–antimatter reactors (e⁺e⁻ or p p̄), single collisions', 'City grid supply'], cannot: ['Energy megastructures (Dyson spheres, other worlds, stars) → K1/K2/K3'] };
    default: return { can: ['Exploration only'], cannot: ['Building — enter a civilisation first (K1/K2/K3/B2/B4/B6)'] };
  }
}

/** Refuse anything the active civilisation cannot do; null when allowed. */
function civGate(kindName: string, params: Record<string, unknown>, verb: string): Record<string, unknown> | null {
  const w = useWorld.getState();
  const k = interventionKind(kindName);
  if (!k || !w.world) return null;
  const ctx = w.world.ctx;
  const defaults = Object.fromEntries(k.params(ctx).map((x) => [x.key, x.defaultValue]));
  const merged = { ...defaults, ...params };
  const lvl = levelOfKind(k, merged, ctx);
  const family = lvl.startsWith('k') ? 'K' : 'B';
  const proposed: Intervention = { id: 'proposed', level: lvl, kind: k.kind, label: k.label, params: merged, createdSeq: 1e9, updatedSeq: 1e9 };
  // Lowest civilisation that could do it.
  let needed: CivId;
  let why = '';
  if (family === 'K') {
    const f = assessFeasibility(ctx, { kardashevLevel: 3, barrowLevel: 6 }, [...w.interventions, proposed], proposed);
    const need = f.ok ? Math.max(1, f.requiredKardashev) : 4;
    if (need > 3) return { ok: false, status: 'impossible', error: f.reasons.join(' '), suggestion: f.suggestion };
    needed = `K${need}` as CivId;
  } else {
    const b = k.minBarrow ?? 2;
    needed = (b <= 2 ? 'B2' : b <= 4 ? 'B4' : 'B6') as CivId;
  }
  const civ = activeCiv();
  const what = k.kind === 'build.structure' ? `${String(merged.type).replace(/_/g, ' ')} at ${String(merged.hostId).replace(/^(body|star|gaia)\./, '')}` : k.label;
  let ok = false;
  if (civ && civ[0] === family) {
    const curN = Number(civ[1]);
    const needN = Number(needed[1]);
    if (needN <= curN) ok = true;
    else if (family === 'K') {
      const f = assessFeasibility(ctx, { kardashevLevel: curN as 1 | 2 | 3, barrowLevel: 6 }, [...w.interventions, proposed], proposed);
      why = f.reasons.join(' ');
    } else why = `${k.label} needs ${needed} manipulation depth.`;
  } else if (civ) {
    why = family === 'K'
      ? `You are in the ${CIV_NAME[civ]}, which engineers matter at small scales; energy megastructures belong to Kardashev civilisations.`
      : `You are in the ${CIV_NAME[civ]}, which works at energy/astronomical scales; ${needed === 'B2' ? 'gene editing' : needed === 'B4' ? 'atom-level materials engineering' : 'particle/antimatter engineering'} belongs to Barrow civilisations.`;
  } else why = 'This view is not a civilisation (exploration only).';
  if (ok) return null;
  return {
    ok: false, status: 'not_possible_in_this_civilisation', currentCivilisation: civ ? CIV_NAME[civ] : 'none (exploration view)',
    request: `${verb} ${what}`, reason: why, requiredCivilisation: CIV_NAME[needed], switchWith: `dock button ${needed} (or ask: "switch to the ${needed} civilisation")`,
    instruction: `Do NOT switch civilisation, navigate, or change capability. Tell the user plainly that this cannot be built in the ${civ ?? 'current view'} and why, that a ${needed} civilisation could, and that they can switch to ${needed} and ask again. Offer something this civilisation CAN do instead.`,
  };
}

/** Execute a tool call through the same validated reducers as the UI, under the user's identity. */
export async function executeTool(name: string, args: Record<string, unknown>, source: Source): Promise<Record<string, unknown>> {
  const w = useWorld.getState();
  const ui = useUi.getState();
  try {
    switch (name) {
      case 'get_context':
        return { ok: true, ...contextSnapshot() };
      case 'get_results': {
        const level = (String(args.level ?? STOP_BY_ID[ui.stop].level ?? '') || undefined) as LevelId | undefined;
        const out = level ? w.outputs[level] : undefined;
        if (!level || !out) return { ok: false, error: `No result for ${level ?? 'this stop'} on this branch yet.` };
        return {
          ok: true, level, model: `${out.modelId}@${out.modelVersion}`, revision: out.revision, inputHash: out.inputHash, summary: out.summary,
          chain: out.nodes.map((n) => ({ node: n.label, model: `${n.modelId}@${n.version}`, dependsOn: n.dependsOn, inputs: n.inputs, outputs: n.outputs, evidence: n.evidence })),
          warnings: out.warnings, assumptions: out.assumptions.slice(0, 6),
        };
      }
      case 'navigate': {
        const stop = String(args.stop) as StopId;
        if (!STOP_BY_ID[stop]) return { ok: false, error: `Unknown stop ${stop}. Options: ${STOP_IDS.join(', ')}` };
        const civNow = activeCiv();
        const lvl = STOP_BY_ID[stop].level;
        const targetCiv = lvl && lvl !== 'b5' ? (lvl.toUpperCase() as CivId) : null;
        if (civNow && targetCiv && civNow !== targetCiv) {
          return { ok: false, status: 'in_another_civilisation', currentCivilisation: CIV_NAME[civNow], target: STOP_BY_ID[stop].name, viewableIn: CIV_NAME[targetCiv], instruction: `Do not move the user. Use switch_civilisation only if THIS message explicitly asked to go to the ${targetCiv} civilisation.` };
        }
        ui.goTo(stop);
        return { ok: true, stop, title: STOP_BY_ID[stop].name };
      }
      case 'find': {
        const sci = w.world?.ctx.science;
        if (!sci) return { ok: false, error: 'not ready' };
        return { ok: true, results: searchEntities(sci, String(args.query), 8).map(describe) };
      }
      case 'focus': {
        const target = String(args.target ?? '');
        const t = target.toLowerCase().replace(/^the\s+/, '');
        const regions = [{ id: 'north_america', name: 'North America' }, { id: 'south_america', name: 'South America' }, { id: 'europe', name: 'Europe' }, { id: 'africa', name: 'Africa' }, { id: 'asia', name: 'Asia' }, { id: 'oceania', name: 'Oceania' }];
        const regionDef = regions.find((r) => r.name.toLowerCase() === t || r.id === t);
        if (regionDef) {
          ui.goTo('earth');
          ui.select({ kind: 'region', id: `region.${regionDef.id}`, label: regionDef.name, level: 'k1' });
          ui.focusOn(`region.${regionDef.id}`);
          return { ok: true, focused: regionDef.name, stop: 'earth' };
        }
        const iv = w.interventions.find((i) => i.id === target || i.label.toLowerCase().includes(t));
        const hostId = iv && typeof iv.params.hostId === 'string' ? iv.params.hostId : undefined;
        const sci = w.world?.ctx.science;
        if (!sci) return { ok: false, error: 'not ready' };
        const matches = hostId ? searchEntities(sci, hostId, 1) : searchEntities(sci, target, 6);
        if (!matches.length) return { ok: false, error: `Nothing called "${target}" in the Solar System or the star catalogue.` };
        const exact = matches.filter((m) => m.name.toLowerCase() === t || m.id === target);
        if (matches.length > 1 && !exact.length && !hostId && !matches[0]!.name.toLowerCase().startsWith(t)) {
          return { ok: false, needs_clarification: true, question: 'Which one?', candidates: matches.map(describe) };
        }
        const e = exact[0] ?? matches[0]!;
        const civNow = activeCiv();
        const stop: StopId = (e.id === 'body.earth' || (e.id === 'body.moon' && civNow === 'K1')) ? 'earth' : e.system === 'sol' ? 'solar' : 'galaxy';
        const targetCiv: CivId = stop === 'earth' ? 'K1' : stop === 'solar' ? 'K2' : 'K3';
        if (civNow && civNow !== targetCiv) {
          return {
            ok: false, status: 'in_another_civilisation', target: describe(e), currentCivilisation: CIV_NAME[civNow], viewableIn: CIV_NAME[targetCiv],
            instruction: `Do not move the user. Tell them ${e.name} is viewed in the ${targetCiv} civilisation and they can switch (dock ${targetCiv}, or ask). Only call switch_civilisation if THIS message explicitly asked to go/travel there.`,
          };
        }
        ui.goTo(stop);
        ui.select({ kind: e.kind === 'star' ? 'star' : 'body', id: e.id, label: e.name, level: e.system === 'sol' ? 'k2' : 'k3' });
        ui.focusOn(e.id);
        return { ok: true, focused: describe(e), stop, canBuild: buildOptions(e) };
      }
      case 'build': {
        const sci = w.world?.ctx.science;
        if (!sci) return { ok: false, error: 'not ready' };
        const host = searchEntities(sci, String(args.host ?? ''), 1)[0];
        if (!host) return { ok: false, error: `No body or star called "${args.host}".` };
        const kind = interventionKind('build.structure')!;
        const params: Record<string, unknown> = { hostId: host.id, type: String(args.type) };
        for (const k of ['coverage', 'efficiency', 'construction', 'orbitRadius_AU', 'harvestRate_kgps', 'demand_W', 'population']) if (typeof args[k] === 'number') params[k] = args[k];
        const level = levelOfKind(kind, params, w.world!.ctx);
        const gate = civGate('build.structure', params, 'build');
        if (gate) return { ...gate, host: describe(host) };
        const r = await w.createIntervention('build.structure', params, { source, label: typeof args.label === 'string' ? args.label : undefined });
        if (r.status === 'applied') {
          // Fly the camera only if the host is in the scene the user is already looking at.
          if ((ui.stop === 'solar' && host.system === 'sol') || ui.stop === 'galaxy' || (ui.stop === 'earth' && host.id === 'body.earth')) ui.focusOn(host.id);
          if (r.interventionId) ui.select({ kind: 'intervention', id: r.interventionId, label: host.name, level });
        }
        const out = result(r, level);
        const st = (useWorld.getState().outputs[level]?.view as { structures?: { interventionId: string; usefulW: number; valid: boolean; note: string }[] } | undefined)?.structures?.find((x) => x.interventionId === r.interventionId);
        return { ...out, host: describe(host), ...(st ? { structureUsefulW: st.usefulW, valid: st.valid, note: st.note } : {}) };
      }
      case 'zoom': {
        const s = STOP_BY_ID[ui.stop];
        const to = args.direction === 'in' ? deeper(ui.stop) : shallower(ui.stop);
        if (!to) return { ok: false, error: `No ${args.direction === 'in' ? 'microscopic' : 'macroscopic'} scene linked from ${s.name}.` };
        ui.goTo(to);
        return { ok: true, stop: to, title: STOP_BY_ID[to].name };
      }
      case 'select': {
        const t = String(args.target).toLowerCase();
        const iv = w.interventions.find((i) => i.id.toLowerCase() === t || i.label.toLowerCase().includes(t));
        if (iv) {
          ui.select({ kind: 'intervention', id: iv.id, label: iv.label, level: iv.level });
          return { ok: true, selected: { id: iv.id, label: iv.label } };
        }
        const k1 = w.render.k1?.output.view as { regions?: { id: string; name: string }[] } | undefined;
        const region = k1?.regions?.find((r) => r.id === t || r.name.toLowerCase().includes(t));
        if (region) {
          ui.select({ kind: 'region', id: `region.${region.id}`, label: region.name, level: 'k1' });
          return { ok: true, selected: region };
        }
        for (const o of Object.values(w.outputs)) {
          const n = o!.nodes.find((x) => x.id.toLowerCase() === t || x.label.toLowerCase().includes(t));
          if (n) {
            ui.select({ kind: 'node', id: `node.${n.id}`, label: n.label, level: o!.level });
            ui.setConsole(true, 'results');
            return { ok: true, selected: { id: n.id, label: n.label, outputs: n.outputs } };
          }
        }
        return { ok: false, error: `Nothing matches "${args.target}".` };
      }
      case 'create_intervention': {
        const kind = interventionKind(String(args.kind));
        if (!kind) return { ok: false, error: `Unknown kind ${args.kind}` };
        const existing = kind.singleton ? w.interventions.find((i) => i.kind === kind.kind) : undefined;
        const params = (args.params as Record<string, unknown>) ?? {};
        const gate = civGate(kind.kind, { ...(existing?.params ?? {}), ...params }, existing ? 'change' : 'build');
        if (gate) return gate;
        const r = existing
          ? await w.updateIntervention(existing.id, params, { source })
          : await w.createIntervention(kind.kind, params, { source, label: typeof args.label === 'string' ? args.label : undefined });
        const id = existing?.id ?? r.interventionId;
        if (r.status === 'applied' && id) ui.select({ kind: 'intervention', id, label: kind.label, level: kind.level });
        ui.setConsole(true, 'results');
        return { ...result(r, kind.level), ...(existing ? { note: `Singleton already existed; updated ${existing.id} instead.` } : {}) };
      }
      case 'update_intervention': {
        const res = resolveIntervention(typeof args.target === 'string' ? args.target : undefined);
        if ('error' in res) return res.error;
        const gate = civGate(res.iv.kind, { ...res.iv.params, ...((args.params as Record<string, unknown>) ?? {}) }, 'change');
        if (gate) return gate;
        const r = await w.updateIntervention(res.iv.id, (args.params as Record<string, unknown>) ?? {}, { source, label: typeof args.label === 'string' ? args.label : undefined });
        ui.select({ kind: 'intervention', id: res.iv.id, label: res.iv.label, level: res.iv.level });
        return { ...result(r, res.iv.level), target: { id: res.iv.id, label: res.iv.label }, before: res.iv.params };
      }
      case 'remove_intervention': {
        const res = resolveIntervention(typeof args.target === 'string' ? args.target : undefined);
        if ('error' in res) return res.error;
        const gate = civGate(res.iv.kind, res.iv.params, 'remove');
        if (gate) return gate;
        const r = await w.removeIntervention(res.iv.id, { source });
        if (ui.selection?.id === res.iv.id) ui.select(null);
        return { ...result(r, res.iv.level), removed: res.iv.label };
      }
      case 'switch_civilisation': {
        const c = String(args.civilisation).toUpperCase() as CivId;
        if (!CIV_STOP[c]) return { ok: false, error: 'Unknown civilisation' };
        ui.goTo(CIV_STOP[c]);
        const caps = w.capabilities;
        const n = Number(c[1]);
        if (c[0] === 'K' && caps.kardashevLevel < n) await w.setCapabilities({ kardashevLevel: n as 1 | 2 | 3 }, { source });
        if (c[0] === 'B' && caps.barrowLevel < n) await w.setCapabilities({ barrowLevel: n as 2 | 4 | 6 }, { source });
        return { ok: true, now: CIV_NAME[c], ...civAbilities(c) };
      }
      case 'set_assumption':
        return result(await w.setAssumption(String(args.key), args.value, { source }));
      case 'set_capabilities': {
        const caps: Record<string, number> = {};
        if (typeof args.kardashev === 'number') caps.kardashevLevel = args.kardashev;
        if (typeof args.barrow === 'number') caps.barrowLevel = args.barrow;
        const r = await w.setCapabilities(caps, { source });
        return { ...result(r), capabilities: useWorld.getState().capabilities };
      }
      case 'undo': {
        const last = w.events.filter((e) => e.seq <= (w.branches.find((b) => b.id === w.branchId)?.cursor ?? 0)).at(-1);
        return { ...result(await w.undo({ source })), undone: last ? `${last.action} ${last.targetId}` : null };
      }
      case 'redo':
        return result(await w.redo({ source }));
      case 'reset':
        return { ...result(await w.reset({ source })), note: 'Projection equals the baseline; events can be redone.' };
      case 'set_clock': {
        const action = String(args.action) as 'play' | 'pause' | 'set_rate' | 'seek';
        const years = typeof args.years === 'number' ? args.years : action === 'set_rate' ? 50 : 0;
        const r = await w.clockControl(action, action === 'set_rate' || action === 'seek' ? years * YEAR : 0, { source });
        return { ...result(r), clock: { running: useWorld.getState().clock.running, years: +(useWorld.getState().simNow() / YEAR).toFixed(1) } };
      }
      case 'fork_branch': {
        const id = await w.fork(typeof args.name === 'string' ? args.name : undefined);
        ui.setConsole(true, 'worlds');
        return id ? { ok: true, branch: useWorld.getState().branches.find((x) => x.id === id)?.name } : { ok: false, error: 'Fork failed' };
      }
      case 'switch_branch': {
        const id = resolveBranch(String(args.branch));
        if (!id) return { ok: false, error: `No branch matches "${args.branch}"`, branches: w.branches.map((b) => b.name) };
        w.switchTo(id);
        return { ok: true, branch: useWorld.getState().branches.find((x) => x.id === id)?.name };
      }
      case 'compare_branches': {
        const id = resolveBranch(String(args.with));
        if (!id) return { ok: false, error: `No branch matches "${args.with}"`, branches: w.branches.map((b) => b.name) };
        w.compareWith(id);
        ui.setConsole(true, 'worlds');
        const cmp = useWorld.getState().comparison;
        return { ok: true, levels: cmp?.levels.filter((l) => l.a || l.b), interventions: cmp?.interventionDiff, assumptionDiffs: cmp?.assumptionDiffs };
      }
      case 'request_imagine': {
        const level = (String(args.level ?? STOP_BY_ID[ui.stop].level ?? '') || 'k1') as LevelId;
        const r = await generateConcept(level);
        return { ok: r.ok, message: r.message, note: r.ok ? 'Render is illustrative, tied to this revision; it is discarded if the state changes before it finishes.' : undefined };
      }
      case 'show_panel':
        ui.setConsole(true, String(args.tab) as ConsoleTab);
        return { ok: true };
      default:
        return { ok: false, error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const SYSTEM_INSTRUCTIONS = `You are COSMOS, the voice and mission computer of a multiscale universe simulator grounded in real datasets (JPL Horizons, Gaia DR3, NASA Earthdata, OWID, NCBI/ClinVar/PDB, NIST, IAEA/ENSDF, PDG) stored in SpacetimeDB. SpacetimeDB is authoritative: your tools submit validated commands under the user's identity, and the module computes the results.
THE ACTIVE CIVILISATION is the one the user is currently in/viewing (get_context → activeCivilisation: K1 Earth, K2 Solar System, K3 galaxy, B2 genome, B4 materials, B6 particle). You act ONLY within it. If a request belongs to another civilisation, tools return status "not_possible_in_this_civilisation": say it can't be built here and why, name the civilisation that can (e.g. "switch to K2"), offer something possible here, and STOP. Never switch civilisation, navigate elsewhere, or change capability to make it work — the user switches (dock or by asking you with switch_civilisation) and asks again.
CIVILISATION LIMITS (also enforced by SpacetimeDB): see activeCivilisation.can / cannot.
- Kardashev = energy + reach. K1: Earth and the Moon only, at most ~2×10¹⁷ W total (all sunlight Earth intercepts). K2: anywhere in the Solar System, up to the Sun's 3.8×10²⁶ W (Dyson swarms/spheres, gas giants, other planets). K3: other stars and galactic expansion, up to ~10³⁷ W.
- Barrow = manipulation depth. B2: genes (edit HBB bases). B4: atoms/materials (place ions in films). B6: elementary particles (antimatter reactors). Each level includes the ones below.
- When a request exceeds the current civilisation, a tool returns status "not_possible_at_this_level" with "requires". Then: say plainly that a K?/B? civilisation can't do it and why (reach, energy budget or depth), say which level CAN, offer the closest thing that IS possible now, and ask whether to advance this branch or fork one. Never raise the level by yourself.
- Impossible at every level (refuse, explain briefly): faster-than-light travel, time travel, other universes / multiverse, creating energy from nothing (antimatter must be produced first), changing physical constants, exceeding a galaxy's total power. If the user is at the highest levels, nearly anything else physical is allowed.
- If asked "what can I do here?", answer from activeCivilisation.can / cannot.
- The user can switch civilisation at any moment (messages say "[Now in: …]"). ALWAYS re-check the current activeCivilisation and call the tool again — never repeat an earlier refusal from memory.
- When refusing (another civilisation, impossible physics), do NOT call any build/create/update tool at all.
- focus/navigate never cross civilisations on their own; a status "in_another_civilisation" means: tell the user where it can be seen and stop.
- When asked to power or supply something (a city, a habitat), size the build to meet the stated demand (pick rate/coverage/units accordingly), then report whether demand is met and what it costs (e.g. antimatter production energy). Expansion starts from the Sun unless the user names another catalogued star (originStarId accepts names).
This is a FREE-BUILDING sandbox, not a fixed script: the user can go anywhere (focus on any planet, moon or catalogued star) and build anything anywhere (build: Dyson swarms or spheres around any star, collectors on any moon or planet, orbital rings, gas-giant harvesters, habitats). Compose tools to satisfy arbitrary requests, e.g. "take me to the Moon and harness its power" = focus("moon") then build(host "moon", type "surface_collectors"). If something is physically invalid, say why and offer the closest valid build.
EXECUTE with tools — never just describe clicks. For multi-step requests, call tools in sequence (e.g. create the swarm, then the habitat, then report). After acting, narrate the ACTUAL numbers returned (with units) and what changed; never invent results. If a tool returns ok:false, explain the reason.
Follow-ups: "that/it/this" means the selected or most recent intervention — call update_intervention/remove_intervention without target; if the tool returns needs_clarification, ask the user to choose among the candidates (do not guess). "Undo the last change" → undo.
Kardashev (K1 planet grid, K2 star system, K3 galaxy with a shared clock) is energy scale. Barrow levels are civilisations you can zoom through, controlled at the microscopic scale with results at human scale: B2 genome civilisation (town → person → blood → haemoglobin → gene): edit ANY base with b2.base_edit {position, alt} and set who carries it with b2.population {size, editedFraction}; B4 materials civilisation (city → room → lattice → atom): film b4.window {material, insertion_x or occupiedSites, thickness_nm, areas}, city b4.city {buildings, roomsPerBuilding}; B6 particle civilisation (city grid → reactor → collision): b6.device {species electron|proton, eventRate_per_s, kineticEnergy_MeV, units, capture, efficiency}, grid b6.city {households, demandPerHousehold_W}. Use zoom in/out to move between depths and explain how the micro change propagated to the macro numbers.
Keep spoken replies to 1–3 sentences, precise, and label assumed or extrapolated values. Convert units: "30 percent" → 0.3, "10 percent of light speed" → 0.1, "100 terawatts" → 1e14 W, years for the clock.`;
