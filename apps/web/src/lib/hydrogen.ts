import { createRng } from '@cosmos/engine';

/**
 * Exact hydrogen |ψ_nlm|² sampling (real orbital basis), in Bohr radii.
 *   ψ = R_nl(r) · Y_lm(θ, φ),  R_nl ∝ (2r/n)^l e^{-r/n} L_{n-l-1}^{2l+1}(2r/n)
 * Radial positions use inverse-CDF on r²R²; angles use rejection on |Y|².
 */

function laguerre(k: number, alpha: number, x: number): number {
  if (k === 0) return 1;
  let l0 = 1;
  let l1 = 1 + alpha - x;
  for (let i = 1; i < k; i++) {
    const l2 = ((2 * i + 1 + alpha - x) * l1 - (i + alpha) * l0) / (i + 1);
    l0 = l1;
    l1 = l2;
  }
  return l1;
}

function radial(n: number, l: number, r: number): number {
  const rho = (2 * r) / n;
  return rho ** l * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho);
}

/** Associated Legendre P_l^m(x) for m ≥ 0 (Condon–Shortley phase omitted; sign only affects colour). */
function legendre(l: number, m: number, x: number): number {
  let pmm = 1;
  if (m > 0) {
    const s = Math.sqrt(Math.max(0, (1 - x) * (1 + x)));
    let f = 1;
    for (let i = 1; i <= m; i++) {
      pmm *= f * s;
      f += 2;
    }
  }
  if (l === m) return pmm;
  let pmm1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return pmm1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pmm1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pmm1;
    pmm1 = pll;
  }
  return pll;
}

function realY(l: number, m: number, theta: number, phi: number): number {
  const p = legendre(l, Math.abs(m), Math.cos(theta));
  if (m > 0) return p * Math.cos(m * phi);
  if (m < 0) return p * Math.sin(-m * phi);
  return p;
}

const cache = new Map<string, { pos: Float32Array; sign: Float32Array; rmax: number }>();

export function sampleOrbital(n: number, l: number, m: number, count: number, seed = 1): { pos: Float32Array; sign: Float32Array; rmax: number } {
  const key = `${n}:${l}:${m}:${count}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = createRng(seed * 7919 + n * 131 + l * 17 + (m + 7));
  const rmax = 2 * n * n + 8 * n + 12;
  const G = 4096;
  const cdf = new Float64Array(G + 1);
  for (let i = 1; i <= G; i++) {
    const r = (i / G) * rmax;
    const R = radial(n, l, r);
    cdf[i] = cdf[i - 1]! + r * r * R * R;
  }
  const total = cdf[G]!;
  // Angular bound for rejection sampling.
  let ymax = 0;
  for (let i = 0; i <= 90; i++) {
    for (let j = 0; j <= 90; j++) {
      const v = realY(l, m, (i / 90) * Math.PI, (j / 90) * 2 * Math.PI) ** 2;
      if (v > ymax) ymax = v;
    }
  }
  ymax *= 1.05;
  const pos = new Float32Array(count * 3);
  const sign = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const u = rng() * total;
    let lo = 0;
    let hi = G;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid]! < u) lo = mid + 1;
      else hi = mid;
    }
    const r = ((lo - 1 + rng()) / G) * rmax;
    let theta = 0;
    let phi = 0;
    let y = 0;
    for (let tries = 0; tries < 200; tries++) {
      theta = Math.acos(2 * rng() - 1);
      phi = rng() * Math.PI * 2;
      y = realY(l, m, theta, phi);
      if (rng() * ymax <= y * y) break;
    }
    const st = Math.sin(theta);
    pos[k * 3] = r * st * Math.cos(phi);
    pos[k * 3 + 1] = r * Math.cos(theta);
    pos[k * 3 + 2] = r * st * Math.sin(phi);
    sign[k] = Math.sign(radial(n, l, r) * y) || 1;
  }
  const out = { pos, sign, rmax };
  cache.set(key, out);
  return out;
}
