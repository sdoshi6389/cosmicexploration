import { useEffect, useState } from 'react';
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();

/** Load a texture once (shared cache); returns null until ready or if it fails. */
export function useTex(url: string | null | undefined, srgb = true): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let p = cache.get(url);
    if (!p) {
      p = new Promise<THREE.Texture>((resolve, reject) => loader.load(url, resolve, undefined, reject));
      cache.set(url, p);
    }
    p.then((t) => {
      if (!alive) return;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      setTex(t);
    }).catch(() => alive && setTex(null));
    return () => {
      alive = false;
    };
  }, [url, srgb]);
  return tex;
}

/** Approximate blackbody colour (Tanner Helland fit), 1,000–40,000 K. */
export function blackbody(tempK: number): THREE.Color {
  const t = Math.min(40000, Math.max(1000, tempK)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}

/**
 * Gaia BP−RP → approximate Teff for rendering colour only: B−V ≈ 0.79·(BP−RP), then
 * Ballesteros (2012) T = 4600 K [1/(0.92(B−V)+1.7) + 1/(0.92(B−V)+0.62)].
 */
export function bpRpToTeff(bpRp: number): number {
  const bv = Math.max(-0.35, Math.min(2.2, 0.79 * bpRp));
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** ICRF equatorial → ecliptic (J2000 obliquity), mapped to three.js with +Y = ecliptic north. */
const EPS = (23.4392911 * Math.PI) / 180;
const cosE = Math.cos(EPS);
const sinE = Math.sin(EPS);
export function icrfToScene(x: number, y: number, z: number): [number, number, number] {
  const ye = cosE * y + sinE * z;
  const ze = -sinE * y + cosE * z;
  return [x, ze, -ye];
}

/** Galactic (l, b, d in pc) → galactocentric scene units (1 unit = 100 pc), GC at origin, +Y = north galactic pole. */
export function galacticToScene(lDeg: number, bDeg: number, dPc: number, r0Pc = 8178, zSunPc = 20.8): [number, number, number] {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const xg = dPc * Math.cos(b) * Math.cos(l);
  const yg = dPc * Math.cos(b) * Math.sin(l);
  const zg = dPc * Math.sin(b);
  return [(r0Pc - xg) / 100, (zg + zSunPc) / 100, yg / 100];
}

export function latLonToVec3(lat: number, lon: number, r: number): THREE.Vector3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

/** Smooth step helpers for animation timelines. */
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOutCubic = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

export function hexColor(hex: string, mul = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(mul);
}

/**
 * Replace non-finite positions/normals (degenerate tube frames, lathe axis vertices).
 * A single NaN pixel is smeared across the whole frame by the bloom mip chain.
 */
export function sanitizeGeometry<T extends THREE.BufferGeometry>(g: T): T {
  const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (n) {
    const a = n.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i]!;
      const y = a[i + 1]!;
      const z = a[i + 2]!;
      const len = Math.hypot(x, y, z);
      if (!Number.isFinite(len) || len < 1e-6) {
        a[i] = 0;
        a[i + 1] = 1;
        a[i + 2] = 0;
      }
    }
    n.needsUpdate = true;
  }
  const p = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (p) {
    const a = p.array as Float32Array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) a[i] = 0;
    p.needsUpdate = true;
  }
  return g;
}

/** Drop consecutive near-duplicate points so spline tangents never vanish. */
export function dedupePoints(pts: THREE.Vector3[], eps = 1e-3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x + p.y + p.z)) continue;
    if (!out.length || out[out.length - 1]!.distanceToSquared(p) > eps * eps) out.push(p);
  }
  return out;
}
