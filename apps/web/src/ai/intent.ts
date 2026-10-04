import type { StopId } from '../navigation/stops';

export interface Intent {
  tool: string;
  args: Record<string, unknown>;
}

const STOP_WORDS: [RegExp, StopId][] = [
  [/\b(cosmic web|universe|sdss|galaxies)\b/, 'cosmic'],
  [/\b(milky way|galaxy|galactic|gaia)\b/, 'galaxy'],
  [/\b(sun|solar system|dyson|planets)\b/, 'solar'],
  [/\b(earth|planet|home)\b/, 'earth'],
  [/\b(town|population|community|people)\b/, 'town'],
  [/\b(body|person|human)\b/, 'body'],
  [/\b(gene|hbb|dna|sequence)\b/, 'gene'],
  [/\b(protein|hemoglobin|haemoglobin|heme)\b/, 'protein'],
  [/\b(cell|blood)\b/, 'cell'],
  [/\b(city|buildings)\b/, 'city'],
  [/\b(room|window)\b/, 'room'],
  [/\b(lattice|film|crystal)\b/, 'lattice'],
  [/\b(atom|hydrogen|electron cloud|orbital)\b/, 'atom'],
  [/\b(grid|districts|blackout)\b/, 'grid'],
  [/\b(device|reactor|power cell|lights|lamps)\b/, 'device'],
  [/\b(particle|annihilation|positron|antiproton|collider)\b/, 'particle'],
];

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Offline fallback (no Grok): map common phrases to the same tools Grok would call.
 * Multi-step phrases return several intents executed in order.
 */
export function parseIntent(text: string): Intent[] {
  const t = text.toLowerCase().trim();
  if (!t) return [];
  if (/\bundo\b/.test(t)) return [{ tool: 'undo', args: {} }];
  if (/\bredo\b/.test(t)) return [{ tool: 'redo', args: {} }];
  if (/\breset\b|back to (the )?baseline|back to reality/.test(t)) return [{ tool: 'reset', args: {} }];
  if (/\bfork\b|new (world|branch)/.test(t)) return [{ tool: 'fork_branch', args: {} }];
  if (/\bcompare\b/.test(t)) return [{ tool: 'compare_branches', args: { with: 'parent' } }];
  if (/\bpause\b/.test(t)) return [{ tool: 'set_clock', args: { action: 'pause' } }];
  if (/\b(play|resume|start the clock)\b/.test(t)) return [{ tool: 'set_clock', args: { action: 'play' } }];
  if (/\bzoom (in|into)\b/.test(t)) return [{ tool: 'zoom', args: { direction: 'in' } }];
  if (/\bzoom out\b/.test(t)) return [{ tool: 'zoom', args: { direction: 'out' } }];
  if (/\b(imagine|render|concept|picture)\b/.test(t)) {
    const lvl = /dyson|swarm|sun/.test(t) ? 'k2' : /galax/.test(t) ? 'k3' : /earth|grid/.test(t) ? 'k1' : /gene|cell|sickle|body/.test(t) ? 'b2' : /window|room|atom/.test(t) ? 'b4' : /nucle|decay/.test(t) ? 'b5' : /annihil|device|particle/.test(t) ? 'b6' : undefined;
    return [{ tool: 'request_imagine', args: lvl ? { level: lvl } : {} }];
  }

  const pctMatch = t.match(/(\d+(?:\.\d+)?)\s*(%|percent)/);
  const frac = pctMatch ? Math.min(1, Number(pctMatch[1]) / 100) : undefined;
  if (/(increase|raise|double|more)/.test(t) && /\b(that|it|its|capacity|rate)\b/.test(t)) {
    return [{ tool: 'get_context', args: {} }];
  }
  if (/dyson|swarm/.test(t) && /(build|make|create|construct|capture|deploy)/.test(t)) {
    const out: Intent[] = [{ tool: 'create_intervention', args: { kind: 'k2.swarm', params: { captureFraction: frac ?? 0.3 } } }];
    if (/mars/.test(t)) out.push({ tool: 'create_intervention', args: { kind: 'k2.habitat', params: { bodyId: 'body.mars', kind: 'habitat' }, label: 'Mars habitat' } });
    return out;
  }
  if (/solar/.test(t) && /(network|global|farm|grid)/.test(t)) {
    const tw = num(t.match(/(\d+(?:\.\d+)?)\s*(tw|terawatt)/)?.[1]);
    return [{ tool: 'create_intervention', args: { kind: 'k1.network', params: { technology: 'solar', regions: 'all', ...(tw ? { capacityPerRegion_W: tw * 1e12 } : {}) }, label: 'Global solar network' } }];
  }
  if (/(expand|colon|settle|spread)/.test(t) && /(galax|star|civili|solar system)/.test(t)) {
    const c = frac ?? num(t.match(/(\d*\.?\d+)\s*c\b/)?.[1]);
    const delay = num(t.match(/after\s+(\d+(?:\.\d+)?)\s*years?/)?.[1]);
    return [{ tool: 'create_intervention', args: { kind: 'k3.expansion', params: { ...(c ? { speed_c: Math.min(0.99, c) } : {}), ...(delay ? { settlementDelay_yr: delay } : {}), buildSwarms: /swarm/.test(t) || true } } }];
  }
  if (/(sickle|hbb|gene|mutation|variant|reference)/.test(t) && /(repair|fix|restore|correct|reference)/.test(t)) {
    return [{ tool: 'create_intervention', args: { kind: 'b2.edit', params: { operation: 'repair', variantRsId: 'rs334' } } }];
  }
  if (/(sickle|hbs|mutation|variant|edit)/.test(t)) {
    return [{ tool: 'create_intervention', args: { kind: 'b2.edit', params: { operation: 'introduce', variantRsId: /hbc/.test(t) ? 'rs33930165' : 'rs334' } } }];
  }
  if (/window/.test(t) && /(transparen|clear|bleach)/.test(t)) return [{ tool: 'create_intervention', args: { kind: 'b4.window', params: { insertion_x: 0.02 } } }];
  if (/window/.test(t) && /(tint|dark|colou?r)/.test(t)) return [{ tool: 'create_intervention', args: { kind: 'b4.window', params: { insertion_x: 0.35 } } }];
  if (/(lyman)/.test(t)) return [{ tool: 'create_intervention', args: { kind: 'b4.transition', params: { nInitial: 2, lInitial: 1, nFinal: 1, lFinal: 0, mFinal: 0 } } }];
  if (/(balmer|red line|h-?alpha)/.test(t)) return [{ tool: 'create_intervention', args: { kind: 'b4.transition', params: { nInitial: 3, lInitial: 2, nFinal: 2, lFinal: 1, mFinal: 1 } } }];
  if (/(excite|electron|jump|transition)/.test(t)) {
    const n = num(t.match(/n\s*=?\s*(\d)/)?.[1]) ?? 3;
    return [{ tool: 'create_intervention', args: { kind: 'b4.transition', params: { nInitial: 1, lInitial: 0, nFinal: n, lFinal: 1, mFinal: 0 } } }];
  }
  if (/(decay|beta|transmute)/.test(t)) return [{ tool: 'create_intervention', args: { kind: 'b5.decay', params: {} } }];
  if (/(device|lights|lamps|interaction rate)/.test(t)) {
    const rate = num(t.match(/1e(\d+)/)?.[1]);
    return [{ tool: 'create_intervention', args: { kind: 'b6.device', params: rate ? { eventRate_per_s: 10 ** rate } : {} } }];
  }
  if (/(annihilat|collide|smash)/.test(t)) {
    const mev = num(t.match(/(\d+(?:\.\d+)?)\s*mev/)?.[1]);
    const gev = num(t.match(/(\d+(?:\.\d+)?)\s*gev/)?.[1]);
    return [{ tool: 'create_intervention', args: { kind: 'b6.collision', params: { kineticEnergy_MeV: gev ? gev * 1000 : mev ?? 0.5 } } }];
  }
  for (const [re, stop] of STOP_WORDS) if (re.test(t)) return [{ tool: 'navigate', args: { stop } }];
  return [];
}
