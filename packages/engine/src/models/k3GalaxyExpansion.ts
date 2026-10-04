import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import { LIGHT_YEAR_M, LSUN_W, PARSEC_M, type ScienceStar } from '../science.js';
import { MinHeap } from '../util/heap.js';
import { KdTree } from '../util/kdtree.js';
import { createRng } from '../util/rng.js';
import { SPEED_OF_LIGHT_MPS } from './constants.js';
import type { K3Output } from './outputs.js';

export const K3_MODEL_ID = 'k3-galaxy-expansion';
export const K3_MODEL_VERSION = '2.0.0';

export const K3_ASSUMPTIONS = [
  'Stars are linked to their k nearest neighbours (k-d tree), edges longer than the maximum hop are cut.',
  'Earliest arrival via Dijkstra: each hop costs distance / speed + settlement delay.',
  'Ordinary speed is capped at c; faster-than-light is a separately labelled speculative mode.',
  'Captured power per settled star = L × f × η; L is Gaia FLAME luminosity, else a photometric estimate (no bolometric/extinction correction), else the declared default.',
  'Coverage and power describe the Gaia/SIMBAD sample only — it is a selection, not a census.',
  'Galaxy-wide power is an explicit extrapolation: an exponential disk (declared scale length/height) gives the fraction of all stars inside the causal front.',
];

export interface K3Inputs {
  stars: ScienceStar[];
  originIndex: number;
  scenarioTimeSeconds: number;
  travelSpeedMps: number;
  settlementDelaySeconds: number;
  maxHopLy: number;
  neighborK: number;
  captureFraction: number;
  efficiency: number;
  speculativeFTL: boolean;
  defaultLuminosityLsun: number;
  assumedStarCount: number;
  assumedMeanLuminosityLsun: number;
  diskScaleLengthKpc: number;
  diskScaleHeightKpc: number;
  sunGalactocentricKpc: number;
}

interface Graph {
  offsets: Int32Array;
  targets: Int32Array;
  dists: Float64Array;
}

const graphCache = new WeakMap<ScienceStar[], Map<string, Graph>>();
const arrivalCache = new WeakMap<ScienceStar[], Map<string, { time: Float64Array; parent: Int32Array }>>();

export function computeK3GalaxyExpansion(inputs: K3Inputs): K3Output {
  const n = inputs.stars.length;
  const speed = inputs.speculativeFTL
    ? Math.max(inputs.travelSpeedMps, 0)
    : Math.min(Math.max(inputs.travelSpeedMps, 0), SPEED_OF_LIGHT_MPS);
  const k = Math.max(2, Math.min(24, Math.round(inputs.neighborK)));
  const maxHopM = Math.max(1, inputs.maxHopLy) * LIGHT_YEAR_M;
  const graph = getGraph(inputs.stars, k, maxHopM);
  const { time, parent } = getArrivals(inputs.stars, graph, inputs.originIndex, speed, inputs.settlementDelaySeconds);

  const f = clamp(inputs.captureFraction, 0, 1);
  const eta = clamp(inputs.efficiency, 0, 1);
  const T = Math.max(0, inputs.scenarioTimeSeconds);
  const origin = inputs.stars[inputs.originIndex];
  let settled = 0;
  let reachable = 0;
  let power = 0;
  let extent = 0;
  const finite: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = time[i]!;
    if (!Number.isFinite(t)) continue;
    reachable++;
    finite.push(t);
    if (t <= T) {
      settled++;
      const s = inputs.stars[i]!;
      const lum = s.luminosityLsun ?? inputs.defaultLuminosityLsun;
      power += lum * LSUN_W * f * eta;
      if (origin) {
        const d = Math.hypot(
          s.positionM[0] - origin.positionM[0],
          s.positionM[1] - origin.positionM[1],
          s.positionM[2] - origin.positionM[2],
        );
        if (d > extent) extent = d;
      }
    }
  }
  finite.sort((a, b) => a - b);
  const milestones = [0.1, 0.5, 0.9].map((fraction) => ({
    fraction,
    seconds: finite.length ? finite[Math.min(finite.length - 1, Math.floor(fraction * finite.length))]! : Infinity,
  }));

  const front = speed * T;
  const insideFraction = diskFractionInside(
    front / PARSEC_M,
    inputs.diskScaleLengthKpc,
    inputs.diskScaleHeightKpc,
    inputs.sunGalactocentricKpc,
  );
  const extrapolated = inputs.assumedStarCount * inputs.assumedMeanLuminosityLsun * LSUN_W * f * eta * insideFraction;

  return {
    travelSpeedMps: speed,
    travelSpeedFractionC: speed / SPEED_OF_LIGHT_MPS,
    settlementDelaySeconds: inputs.settlementDelaySeconds,
    scenarioTimeSeconds: T,
    maxHopLy: inputs.maxHopLy,
    captureFraction: f,
    conversionEfficiency: eta,
    sampleSize: n,
    reachableCount: reachable,
    settledCount: settled,
    coverageFraction: n > 0 ? settled / n : 0,
    frontRadiusM: front,
    settledExtentM: extent,
    sampleUsefulPowerW: power,
    achievedK: kardashevFromPowerW(power),
    speculativeFtl: inputs.speculativeFTL,
    originStarId: origin?.id ?? '',
    arrivalSeconds: time,
    parentIndex: parent,
    milestones,
    galaxyExtrapolation: {
      modelLabel:
        'Exponential-disk extrapolation (declared assumption): fraction of the Milky Way\'s stars inside the causal front × assumed star count × assumed mean luminosity × f × η. Not a census.',
      disk: {
        scaleLengthKpc: inputs.diskScaleLengthKpc,
        scaleHeightKpc: inputs.diskScaleHeightKpc,
        sunRadiusKpc: inputs.sunGalactocentricKpc,
      },
      assumedStarCount: inputs.assumedStarCount,
      assumedMeanLuminosityLsun: inputs.assumedMeanLuminosityLsun,
      fractionOfGalaxyInsideFront: insideFraction,
      extrapolatedPowerW: extrapolated,
      extrapolatedK: kardashevFromPowerW(extrapolated),
    },
  };
}

/** Arrival time at a star for a given scenario configuration (scenes use this to animate settlement). */
export function k3SettledAt(arrivalSeconds: ArrayLike<number>, i: number, t: number): boolean {
  const a = arrivalSeconds[i];
  return a !== undefined && Number.isFinite(a) && a <= t;
}

function getGraph(stars: ScienceStar[], k: number, maxHopM: number): Graph {
  let byKey = graphCache.get(stars);
  if (!byKey) {
    byKey = new Map();
    graphCache.set(stars, byKey);
  }
  const key = `${k}:${maxHopM.toExponential(6)}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const n = stars.length;
  const pts = new Float64Array(n * 3);
  stars.forEach((s, i) => {
    pts[i * 3] = s.positionM[0];
    pts[i * 3 + 1] = s.positionM[1];
    pts[i * 3 + 2] = s.positionM[2];
  });
  const tree = new KdTree(pts);
  const adj: { to: number; d: number }[][] = Array.from({ length: n }, () => []);
  const max2 = maxHopM * maxHopM;
  for (let i = 0; i < n; i++) {
    for (const [j, d2] of tree.knn(i, k, max2)) {
      const d = Math.sqrt(d2);
      adj[i]!.push({ to: j, d });
      adj[j]!.push({ to: i, d }); // undirected; duplicates are harmless for Dijkstra
    }
  }
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + adj[i]!.length;
  const targets = new Int32Array(offsets[n]!);
  const dists = new Float64Array(offsets[n]!);
  for (let i = 0; i < n; i++) {
    let o = offsets[i]!;
    for (const e of adj[i]!) {
      targets[o] = e.to;
      dists[o] = e.d;
      o++;
    }
  }
  const g = { offsets, targets, dists };
  byKey.set(key, g);
  return g;
}

function getArrivals(
  stars: ScienceStar[],
  g: Graph,
  origin: number,
  speed: number,
  delay: number,
): { time: Float64Array; parent: Int32Array } {
  let byKey = arrivalCache.get(stars);
  if (!byKey) {
    byKey = new Map();
    arrivalCache.set(stars, byKey);
  }
  const key = `${g.targets.length}:${origin}:${speed}:${delay}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const n = stars.length;
  const time = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  if (origin >= 0 && origin < n && speed > 0) {
    time[origin] = 0;
    const heap = new MinHeap();
    heap.push(0, origin);
    while (heap.size) {
      const [t, u] = heap.pop();
      if (t > time[u]!) continue;
      for (let o = g.offsets[u]!; o < g.offsets[u + 1]!; o++) {
        const v = g.targets[o]!;
        const alt = t + g.dists[o]! / speed + delay;
        if (alt < time[v]!) {
          time[v] = alt;
          parent[v] = u;
          heap.push(alt, v);
        }
      }
    }
  }
  if (byKey.size > 24) byKey.clear();
  const out = { time, parent };
  byKey.set(key, out);
  return out;
}

const diskCache = new Map<string, Float64Array>();

/**
 * Fraction of an exponential disk's stars within `radiusPc` of the Sun.
 * Deterministic Monte-Carlo CDF (seeded), computed once per disk parameter set.
 */
export function diskFractionInside(radiusPc: number, hR: number, hz: number, r0: number): number {
  if (radiusPc <= 0) return 0;
  const key = `${hR}:${hz}:${r0}`;
  let cdf = diskCache.get(key);
  if (!cdf) {
    const N = 120_000;
    const rng = createRng(20260403);
    const d = new Float64Array(N);
    const sunX = r0 * 1000;
    const sunZ = 20.8;
    for (let i = 0; i < N; i++) {
      const R = -hR * 1000 * Math.log(Math.max(1e-12, rng() * rng())); // Gamma(2, hR): R·e^(−R/hR)
      const phi = rng() * Math.PI * 2;
      const u = rng() - 0.5;
      const z = -hz * 1000 * Math.sign(u) * Math.log(Math.max(1e-12, 1 - 2 * Math.abs(u)));
      const x = R * Math.cos(phi) - sunX;
      const y = R * Math.sin(phi);
      d[i] = Math.hypot(x, y, z - sunZ);
    }
    cdf = d.sort();
    diskCache.set(key, cdf);
  }
  let lo = 0;
  let hi = cdf.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid]! <= radiusPc) lo = mid + 1;
    else hi = mid;
  }
  return lo / cdf.length;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
