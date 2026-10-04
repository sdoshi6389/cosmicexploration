import { createRng, type B2BodyView, type B2Output, type PdbAtomRow } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useBundle, useLevelView, useTable } from '../../state/selectors';
import { useUi, type CellStation } from '../../state/ui';
import { cameraRef } from '../Stage';
import { Label } from '../common/Label';
import { dedupePoints, sanitizeGeometry } from '../common/util';

const DNA_X = -18;
const CELL_X = 20;
const A_PER_UNIT = 3.6;

const STATIONS: Record<CellStation, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [0, 9, 46], target: [0, 0, 0] },
  dna: { pos: [DNA_X + 2, 2.5, 13], target: [DNA_X, 0, 0] },
  protein: { pos: [4, 4, 24], target: [0, 0, 0] },
  cells: { pos: [CELL_X + 7, 3.5, 12], target: [CELL_X, 0, 0] },
};

const BASE_COLOR: Record<string, string> = { A: '#3fe08a', T: '#ff5f7a', G: '#ffcf5c', C: '#5c9dff' };
const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
const ELEMENT_COLOR: Record<string, string> = { C: '#9aa6b8', N: '#5c8dff', O: '#ff4f5e', FE: '#ff9a3c', S: '#ffd84a' };

export function CellScene() {
  const stop = useUi((s) => s.stop);
  const station: CellStation = stop === 'gene' ? 'dna' : stop === 'protein' ? 'protein' : stop === 'cell' ? 'cells' : 'overview';
  const { output: body, pulse } = useLevelView<B2BodyView>('b2');
  const b2 = useMemo(() => cellStateFrom(body), [body]);

  useEffect(() => {
    const st = STATIONS[station];
    void cameraRef.current?.setLookAt(...st.pos, ...st.target, true);
  }, [station]);

  return (
    <group>
      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 14, 12]} intensity={2.4} />
      <directionalLight position={[-14, -6, -8]} intensity={0.6} color="#7ea8ff" />
      <Dna body={body} pulse={pulse} />
      <Protein entry={b2?.structureEntry ?? '4HHB'} b2={b2} />
      <BloodVessel b2={b2} />
      <BackdropMotes />
    </group>
  );
}

/** Cell/protein state derived from the whole edited genome (variant and free base edits). */
function cellStateFrom(body: B2BodyView | null): B2Output | null {
  if (!body) return null;
  const ph = body.phenotype;
  const last = body.mutations.at(-1);
  return {
    ...(body.edit ?? ({} as B2Output)),
    phenotype: ph,
    polymerisationTendency: body.edit?.polymerisationTendency ?? (ph === 'sickle' ? 0.85 : ph === 'crystal' ? 0.3 : 0.05),
    structureEntry: ph === 'sickle' ? '2HBS' : '4HHB',
    structureResidue: last ? last.codon - 1 : body.edit?.structureResidue ?? 6,
    structureMappingValidated: true,
    cdsPosition: last?.position ?? body.edit?.cdsPosition ?? 20,
  } as B2Output;
}

/* --------------------------------------------------------------- DNA */
/**
 * A 42-base window of the (edited) HBB coding sequence around the editor cursor.
 * Click any base pair to select it; edited bases glow. Edits are made in the
 * gene editor panel and flow back up to protein → cells → body → population.
 */
function Dna({ body, pulse }: { body: B2BodyView | null; pulse: number }) {
  const bundle = useBundle();
  const cursor = useUi((s) => s.geneCursor);
  const setCursor = useUi((s) => s.setGeneCursor);
  const ref = bundle?.hbb.cds.value ?? '';
  const seq = body?.cds ?? ref;
  const N = Math.min(42, seq.length);
  const start = Math.max(0, Math.min(seq.length - N, cursor - 1 - Math.floor(N / 2)));
  const edited = useMemo(() => new Set((body?.mutations ?? []).map((m) => m.position)), [body]);
  const rise = 0.42;
  const radius = 1.05;
  const twist = (2 * Math.PI) / 10.5;
  const t0 = useRef(performance.now());
  useEffect(() => {
    t0.current = performance.now();
  }, [pulse]);

  const { strandA, strandB, rungs } = useMemo(() => {
    const ptsA: THREE.Vector3[] = [];
    const ptsB: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const y = (i - N / 2) * rise;
      const a = i * twist;
      ptsA.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
      ptsB.push(new THREE.Vector3(Math.cos(a + 2.4) * radius, y, Math.sin(a + 2.4) * radius));
    }
    return {
      strandA: sanitizeGeometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsA), N * 6, 0.11, 8, false)),
      strandB: sanitizeGeometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ptsB), N * 6, 0.11, 8, false)),
      rungs: ptsA.map((p, i) => ({ a: p, b: ptsB[i]! })),
    };
  }, [N, rise, twist]);

  const flash = useRef<THREE.Mesh>(null);
  const cursorIdx = cursor - 1 - start;
  useFrame((s) => {
    if (!flash.current) return;
    const e = (performance.now() - t0.current) / 1000;
    const burst = Math.max(0, 1 - Math.abs(e - 0.6) / 0.6);
    flash.current.scale.setScalar(0.5 + 0.15 * Math.sin(s.clock.elapsedTime * 4) + burst * 1.5);
  });
  const codonIdx = Math.floor((cursor - 1) / 3);
  const codon = seq.slice(codonIdx * 3, codonIdx * 3 + 3);

  return (
    <group position={[DNA_X, 0, 0]} rotation={[0, 0, -0.18]}>
      <mesh geometry={strandA}>
        <meshStandardMaterial color="#7ea8ff" roughness={0.35} metalness={0.2} emissive="#1a2a55" />
      </mesh>
      <mesh geometry={strandB}>
        <meshStandardMaterial color="#b48cff" roughness={0.35} metalness={0.2} emissive="#2a1a55" />
      </mesh>
      {rungs.map(({ a, b }, i) => {
        const pos = start + i + 1;
        const base = seq[pos - 1] ?? 'A';
        const glow = edited.has(pos) || pos === cursor;
        const mid = a.clone().lerp(b, 0.5);
        return (
          <group key={i} onClick={(e) => { e.stopPropagation(); setCursor(pos); }}>
            <Rung from={a} to={mid} color={BASE_COLOR[base] ?? '#ffffff'} glow={glow} />
            <Rung from={mid} to={b} color={BASE_COLOR[COMP[base] ?? 'A'] ?? '#ffffff'} glow={glow} />
            {i % 3 === 0 ? (
              <Label position={[a.x * 1.7, a.y, a.z * 1.7]} tone={edited.has(pos) ? 'violet' : 'muted'}>c.{pos}</Label>
            ) : null}
          </group>
        );
      })}
      {cursorIdx >= 0 && rungs[cursorIdx] ? (
        <>
          <mesh ref={flash} position={rungs[cursorIdx]!.a.clone().lerp(rungs[cursorIdx]!.b, 0.5)}>
            <torusGeometry args={[0.9, 0.04, 8, 48]} />
            <meshBasicMaterial color={new THREE.Color('#5ce1ff').multiplyScalar(2.5)} toneMapped={false} />
          </mesh>
          <Label position={rungs[cursorIdx]!.b.clone().multiplyScalar(1.9).toArray() as [number, number, number]} tone="accent" size="md" force>
            c.{cursor} {seq[cursor - 1]}{ref[cursor - 1] !== seq[cursor - 1] ? ` (ref ${ref[cursor - 1]})` : ''} · codon {codonIdx + 1} {codon}
          </Label>
        </>
      ) : null}
      <Label position={[0, (N / 2) * rise + 1.2, 0]} tone="accent" size="md" force>
        HBB coding sequence · {bundle?.hbb.transcript ?? 'NM_000518'} · click a base, edit it in the panel
      </Label>
      {body?.mutations.length ? (
        <Label position={[0, -(N / 2) * rise - 1.2, 0]} tone="violet" force>
          {body.mutations.map((m) => m.label).join(' · ')}
        </Label>
      ) : null}
    </group>
  );
}

function Rung({ from, to, color, glow }: { from: THREE.Vector3; to: THREE.Vector3; color: string; glow: boolean }) {
  const { pos, quat, len } = useMemo(() => {
    const d = to.clone().sub(from);
    return {
      pos: from.clone().add(d.clone().multiplyScalar(0.5)),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
      len: d.length(),
    };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat}>
      <cylinderGeometry args={[0.075, 0.075, len, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow ? 2.4 : 0.35} roughness={0.4} toneMapped={!glow} />
    </mesh>
  );
}

/* ----------------------------------------------------------- protein */
function Protein({ entry, b2 }: { entry: string; b2: B2Output | null }) {
  const atoms = useTable('pdb_atom');
  const sse = useTable('pdb_secondary');
  const entries = useTable('pdb_entry');
  const meta = entries.find((e) => e.id === entry);
  const model = useMemo(() => buildProtein(atoms.filter((a) => a.entryId === entry), sse.filter((s) => s.entryId === entry), meta?.chains ?? ''), [atoms, sse, entry, meta]);
  const residue = b2?.structureResidue ?? 6;
  const betaChains = useMemo(() => model.beta, [model]);
  const highlight = useMemo(
    () => atoms.filter((a) => a.entryId === entry && betaChains.includes(a.chain) && a.resSeq === residue && !a.hetero),
    [atoms, entry, betaChains, residue],
  );
  const val = highlight[0]?.resName === 'VAL';
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.06;
  });
  const showHighlight = !b2 || b2.structureMappingValidated || entry === '2HBS';
  return (
    <group>
      <group ref={ref}>
        <group position={model.center.clone().multiplyScalar(-1)}>
          {model.tubes.map((t, i) => (
            <mesh key={i} geometry={t.geometry}>
              <meshStandardMaterial color={t.color} roughness={0.42} metalness={0.08} emissive={t.color} emissiveIntensity={0.12} transparent={t.helix} opacity={t.helix ? 0.92 : 1} />
            </mesh>
          ))}
          <Heme atoms={model.heme} />
          {showHighlight
            ? highlight.map((a) => (
                <mesh key={a.id} position={[a.x / A_PER_UNIT, a.y / A_PER_UNIT, a.z / A_PER_UNIT]}>
                  <sphereGeometry args={[0.32, 16, 16]} />
                  <meshBasicMaterial color={new THREE.Color(val ? '#b48cff' : '#ffb547').multiplyScalar(2.2)} toneMapped={false} />
                </mesh>
              ))
            : null}
          {showHighlight && highlight[0] ? (
            <Label position={[highlight[0].x / A_PER_UNIT, highlight[0].y / A_PER_UNIT + 1.2, highlight[0].z / A_PER_UNIT]} tone={val ? 'violet' : 'amber'} size="md" force>
              β{residue} {val ? 'Val' : highlight[0].resName.charAt(0) + highlight[0].resName.slice(1).toLowerCase()}
            </Label>
          ) : null}
        </group>
      </group>
      <Label position={[0, 13, 0]} tone="accent" size="md" force>
        {entry} · {entry === '2HBS' ? 'deoxy-HbS: β6 Val locks into the neighbouring tetramer' : 'deoxy-HbA reference structure'}
      </Label>
    </group>
  );
}

interface ProteinModel {
  tubes: { geometry: THREE.TubeGeometry; color: string; helix: boolean }[];
  heme: PdbAtomRow[];
  center: THREE.Vector3;
  beta: string[];
}

function buildProtein(atoms: PdbAtomRow[], sse: { chain: string; kind: string; startResSeq: number; endResSeq: number }[], chainDesc: string): ProteinModel {
  const beta = (chainDesc.split('|').map((x) => x.trim()).find((x) => /BETA/i.test(x)) ?? '').split('=')[0]?.split(',').map((c) => c.trim()).filter(Boolean) ?? [];
  const ca = atoms.filter((a) => a.atomName === 'CA' && !a.hetero);
  const byChain = new Map<string, PdbAtomRow[]>();
  for (const a of ca) {
    const arr = byChain.get(a.chain);
    if (arr) arr.push(a);
    else byChain.set(a.chain, [a]);
  }
  const center = new THREE.Vector3();
  ca.forEach((a) => center.add(new THREE.Vector3(a.x, a.y, a.z)));
  if (ca.length) center.divideScalar(ca.length * A_PER_UNIT);
  const palette = (chain: string, idx: number) => {
    const isBeta = beta.includes(chain);
    const second = idx >= 4;
    if (isBeta) return second ? '#3d7fb8' : idx % 2 ? '#7ea8ff' : '#5ce1ff';
    return second ? '#a8445a' : idx % 2 ? '#ff8fa3' : '#ff5f7a';
  };
  const tubes: ProteinModel['tubes'] = [];
  [...byChain.keys()].sort().forEach((chain, ci) => {
    const res = byChain.get(chain)!.sort((a, b) => a.resSeq - b.resSeq);
    if (res.length < 4) return;
    const pts = res.map((a) => new THREE.Vector3(a.x / A_PER_UNIT, a.y / A_PER_UNIT, a.z / A_PER_UNIT));
    const clean = dedupePoints(pts);
    if (clean.length < 4) return;
    const curve = new THREE.CatmullRomCurve3(clean, false, 'catmullrom', 0.5);
    const color = palette(chain, ci);
    tubes.push({ geometry: sanitizeGeometry(new THREE.TubeGeometry(curve, clean.length * 4, 0.16, 6, false)), color, helix: false });
    for (const h of sse.filter((s) => s.chain === chain && s.kind === 'helix')) {
      const i0 = res.findIndex((r) => r.resSeq >= h.startResSeq);
      const i1 = res.findIndex((r) => r.resSeq >= h.endResSeq);
      if (i0 < 0 || i1 <= i0 + 2) continue;
      const seg = dedupePoints(pts.slice(i0, i1 + 1));
      if (seg.length < 3) continue;
      const sub = new THREE.CatmullRomCurve3(seg, false, 'catmullrom', 0.5);
      tubes.push({ geometry: sanitizeGeometry(new THREE.TubeGeometry(sub, (seg.length - 1) * 5, 0.42, 10, false)), color, helix: true });
    }
  });
  const heme = atoms.filter((a) => a.hetero && a.resName === 'HEM');
  return { tubes, heme, center, beta };
}

function Heme({ atoms }: { atoms: PdbAtomRow[] }) {
  const { spheres, bonds } = useMemo(() => {
    const byRes = new Map<string, PdbAtomRow[]>();
    for (const a of atoms) {
      const k = `${a.chain}:${a.resSeq}`;
      const arr = byRes.get(k);
      if (arr) arr.push(a);
      else byRes.set(k, [a]);
    }
    const bondsOut: [THREE.Vector3, THREE.Vector3][] = [];
    for (const group of byRes.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          const limit = a.element === 'FE' || b.element === 'FE' ? 2.15 : 1.9;
          if (d < limit) {
            bondsOut.push([
              new THREE.Vector3(a.x / A_PER_UNIT, a.y / A_PER_UNIT, a.z / A_PER_UNIT),
              new THREE.Vector3(b.x / A_PER_UNIT, b.y / A_PER_UNIT, b.z / A_PER_UNIT),
            ]);
          }
        }
      }
    }
    return { spheres: atoms, bonds: bondsOut };
  }, [atoms]);
  const bondGeo = useMemo(() => {
    const pos: number[] = [];
    for (const [a, b] of bonds) pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [bonds]);
  return (
    <group>
      <lineSegments geometry={bondGeo}>
        <lineBasicMaterial color="#ffd8a8" transparent opacity={0.85} />
      </lineSegments>
      {spheres.map((a) => (
        <mesh key={a.id} position={[a.x / A_PER_UNIT, a.y / A_PER_UNIT, a.z / A_PER_UNIT]}>
          <sphereGeometry args={[a.element === 'FE' ? 0.28 : 0.11, 10, 10]} />
          {a.element === 'FE' ? (
            <meshBasicMaterial color={new THREE.Color('#ff9a3c').multiplyScalar(2.5)} toneMapped={false} />
          ) : (
            <meshStandardMaterial color={ELEMENT_COLOR[a.element] ?? '#cccccc'} roughness={0.5} />
          )}
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------------------------------------- red cells */
const RBC_D = 7.82;
function rbcProfile(): THREE.Vector2[] {
  // Evans & Fung (1972) biconcave red-cell thickness profile.
  const C0 = 0.0518;
  const C2 = 2.0026;
  const C4 = -4.491;
  const pts: THREE.Vector2[] = [];
  const N = 28;
  const half = (x: number) => 0.5 * RBC_D * Math.sqrt(Math.max(0, 1 - x * x)) * (C0 + C2 * x * x + C4 * x ** 4);
  for (let i = 0; i <= N; i++) {
    const x = Math.max(0.004, Math.sin((i / N) * (Math.PI / 2)));
    pts.push(new THREE.Vector2(x * (RBC_D / 2), -Math.max(half(Math.min(x, 0.999)), 0.02)));
  }
  for (let i = N; i >= 0; i--) {
    const x = Math.max(0.004, Math.sin((i / N) * (Math.PI / 2)));
    pts.push(new THREE.Vector2(x * (RBC_D / 2), Math.max(half(Math.min(x, 0.999)), 0.02)));
  }
  return pts;
}

function rbcGeometry(): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(rbcProfile(), 48);
  g.computeVertexNormals();
  sanitizeGeometry(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const sick = new Float32Array(p.count * 3);
  const R = RBC_D / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const u = x / R;
    // Crescent: stretch along x, thin, bend, and pinch the horns.
    const pinch = 1 - 0.75 * u * u;
    sick[i * 3] = x * 1.75;
    sick[i * 3 + 1] = y * 0.7 * pinch + 0.0;
    sick[i * 3 + 2] = z * 0.42 * pinch + 1.4 * R * 0.32 * (u * u - 0.35);
  }
  g.setAttribute('aSickle', new THREE.BufferAttribute(sick, 3));
  return g;
}

const rbcVert = /* glsl */ `
attribute vec3 aSickle;
attribute float aSusc;
uniform float uMorph;
uniform float uShrink;
varying vec3 vN; varying vec3 vV; varying float vS;
void main(){
  float m = clamp(uMorph * aSusc, 0.0, 1.0);
  vec3 p = mix(position, aSickle, m) * (1.0 - uShrink * 0.28);
  vS = m;
  vec4 wp = instanceMatrix * vec4(p, 1.0);
  vec4 mv = modelViewMatrix * wp;
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const rbcFrag = /* glsl */ `
uniform float uPale;
varying vec3 vN; varying vec3 vV; varying float vS;
void main(){
  vec3 n = length(vN) > 1e-4 ? normalize(vN) : vec3(0.0, 1.0, 0.0);
  float d = max(dot(n, normalize(vec3(0.4, 0.8, 0.5))), 0.0);
  float rim = pow(clamp(1.0 - abs(dot(n, vV)), 0.0, 1.0), 2.5);
  vec3 base = mix(vec3(0.78, 0.07, 0.1), vec3(0.55, 0.12, 0.22), vS);
  base = mix(base, vec3(0.95, 0.6, 0.6), uPale * 0.55);
  vec3 c = base * (0.25 + 0.95 * d) + vec3(1.0, 0.45, 0.4) * rim * 0.55;
  gl_FragColor = vec4(c, 1.0);
}
`;

function BloodVessel({ b2 }: { b2: B2Output | null }) {
  const count = 260;
  const geo = useMemo(() => {
    const g = rbcGeometry();
    const susc = new Float32Array(count);
    const rnd = createRng(7);
    for (let i = 0; i < count; i++) susc[i] = 0.55 + rnd() * 0.6;
    g.setAttribute('aSusc', new THREE.InstancedBufferAttribute(susc, 1));
    return g;
  }, []);
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: rbcVert, fragmentShader: rbcFrag, uniforms: { uMorph: { value: 0 }, uPale: { value: 0 }, uShrink: { value: 0 } } }),
    [],
  );
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3([
      new THREE.Vector3(CELL_X - 16, -4, -6), new THREE.Vector3(CELL_X - 6, 1, -2), new THREE.Vector3(CELL_X + 4, -1, 1),
      new THREE.Vector3(CELL_X + 14, 2, -3), new THREE.Vector3(CELL_X + 26, -2, -8),
    ]),
    [],
  );
  const wallGeo = useMemo(() => sanitizeGeometry(new THREE.TubeGeometry(curve, 160, 4.2, 48, false)), [curve]);
  const wallMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0-abs(dot(vN,vV)), 2.0); gl_FragColor = vec4(vec3(0.9,0.18,0.22)*rim*0.6, rim*0.5); }`,
      }),
    [],
  );
  const inst = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => {
    const rnd = createRng(11);
    return Array.from({ length: count }, () => ({ u: rnd(), r: Math.sqrt(rnd()) * 2.9, a: rnd() * Math.PI * 2, spin: rnd() * 2 - 1, phase: rnd() * 6, speed: 0.015 + rnd() * 0.01 }));
  }, []);
  const target = useRef({ morph: 0, pale: 0, shrink: 0 });
  target.current = {
    morph: b2?.phenotype === 'sickle' ? 1 : b2?.phenotype === 'crystal' ? 0.18 : 0,
    pale: b2?.phenotype === 'absent_beta' ? 1 : b2?.phenotype === 'unstable' ? 0.3 : 0,
    shrink: b2?.phenotype === 'absent_beta' ? 1 : 0,
  };
  useFrame((state, dt) => {
    const u = mat.uniforms;
    const k = 1 - Math.exp(-dt * 1.6);
    u.uMorph!.value += (target.current.morph - u.uMorph!.value) * k;
    u.uPale!.value += (target.current.pale - u.uPale!.value) * k;
    u.uShrink!.value += (target.current.shrink - u.uShrink!.value) * k;
    const m = inst.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const t = state.clock.elapsedTime;
    const slow = 1 - 0.6 * (u.uMorph!.value as number); // sickled cells crowd and slow
    seeds.forEach((s, i) => {
      const uu = (s.u + t * s.speed * slow) % 1;
      const p = curve.getPointAt(uu);
      const tan = curve.getTangentAt(uu);
      const n = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
      const b = tan.clone().cross(n).normalize();
      p.add(n.multiplyScalar(Math.cos(s.a) * s.r)).add(b.multiplyScalar(Math.sin(s.a) * s.r));
      dummy.position.copy(p);
      dummy.rotation.set(s.phase + t * 0.4 * s.spin, s.phase * 1.7 + t * 0.3, s.phase * 0.6);
      dummy.scale.setScalar(0.32);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  const label =
    !b2 ? 'Normal red cells · biconcave (Evans–Fung profile)'
      : b2.phenotype === 'sickle' ? `Sickling rule active · polymerisation tendency ${(b2.polymerisationTendency * 100).toFixed(0)}% (qualitative)`
        : b2.phenotype === 'absent_beta' ? 'β⁰ rule: no β-globin — small, pale cells (qualitative)'
          : b2.phenotype === 'crystal' ? 'HbC rule: crystallising, dehydrated cells (qualitative)'
            : b2.phenotype === 'unstable' ? 'HbE rule: mildly unstable globin (qualitative)'
              : 'Biconcave red cells (reference behaviour)';
  return (
    <group>
      <mesh geometry={wallGeo} material={wallMat} />
      <instancedMesh ref={inst} args={[geo, mat, count]} frustumCulled={false} />
      <Label position={[CELL_X, 6.5, 0]} tone={b2?.phenotype === 'sickle' ? 'violet' : 'accent'} size="md" force>
        {label}
      </Label>
      <HcaNote />
    </group>
  );
}

function HcaNote() {
  const hca = useTable('hca_project');
  const cells = useMemo(() => hca.reduce((s, p) => s + (p.cellCount ?? 0), 0), [hca]);
  if (!hca.length) return null;
  return (
    <Label position={[CELL_X, -6, 0]} tone="muted" force>
      Human Cell Atlas context · {hca.length} blood/marrow projects · {Math.round(cells).toLocaleString()} catalogued cells
    </Label>
  );
}

function BackdropMotes() {
  const geo = useMemo(() => {
    const rnd = createRng(3);
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(rnd() - 0.5) * 120, (rnd() - 0.5) * 60, (rnd() - 0.5) * 80 - 20], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.12} color="#ff8fa3" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

