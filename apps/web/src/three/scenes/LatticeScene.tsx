import type { B4WindowView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createRng } from '@cosmos/engine';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { toastRejection, useWorld } from '../../state/world';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';

/**
 * Microscopic scale for B4: a cubic MO₃ (ReO₃-type) lattice. Metal sites sit on a
 * cubic grid with oxygen on the edges; inserted ions occupy the cube-centre (A) sites
 * with probability x, and each reduced metal site (fraction x) absorbs incoming
 * photons. Photons streak through and survive with the modelled transmission.
 */
const N = 6;
const A = 1.25;

export function LatticeScene() {
  const { output: v } = useLevelView<{ window: B4WindowView | null }>('b4');
  const goTo = useUi((s) => s.goTo);
  const win = v?.window ?? null;
  const x = win?.x ?? 0.0;
  const T = win?.transmission ?? 0.9;
  const metal = win?.material.id === 'NiO' ? 'Ni' : 'W';

  const off = ((N - 1) * A) / 2;
  const sites = useMemo(() => {
    const m: THREE.Vector3[] = [];
    const o: THREE.Vector3[] = [];
    const ion: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const p = new THREE.Vector3(i * A - off, j * A - off, k * A - off);
      m.push(p);
      if (i < N - 1) o.push(p.clone().add(new THREE.Vector3(A / 2, 0, 0)));
      if (j < N - 1) o.push(p.clone().add(new THREE.Vector3(0, A / 2, 0)));
      if (k < N - 1) o.push(p.clone().add(new THREE.Vector3(0, 0, A / 2)));
      if (i < N - 1 && j < N - 1 && k < N - 1) ion.push(p.clone().addScalar(A / 2));
    }
    return { m, o, ion };
  }, [off]);

  // Deterministic random order decides which sites are reduced / occupied as x changes.
  const order = useMemo(() => {
    const rng = createRng(7);
    return { m: sites.m.map(() => rng()), ion: sites.ion.map(() => rng()) };
  }, [sites]);

  // Occupied interstitial sites: the placed pattern if any, otherwise the first x·125 in a fixed order.
  const serverOccupied = useMemo(() => {
    if (win?.occupiedSites.length) return new Set(win.occupiedSites);
    const count = Math.round(x * 125);
    return new Set(sites.ion.map((_, i) => i).sort((a, b) => order.ion[a]! - order.ion[b]!).slice(0, count));
  }, [win?.occupiedSites, x, sites, order]);
  const [local, setLocal] = useState<Set<number> | null>(null);
  useEffect(() => setLocal(null), [serverOccupied]);
  const occupied = local ?? serverOccupied;
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggle = (i: number) => {
    const next = new Set(occupied);
    if (next.has(i)) next.delete(i);
    else if (next.size < 62) next.add(i);
    else {
      useUi.getState().toast({ kind: 'warn', title: 'Lattice saturated', body: 'x is capped at 0.5 e⁻ per site (62 of 125 sites) in this model.' });
      return;
    }
    setLocal(next);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(async () => {
      const w = useWorld.getState();
      const params = { occupiedSites: [...next].sort((a, b) => a - b).join(','), insertion_x: Math.min(0.5, next.size / 125) };
      const cur = w.interventions.find((iv) => iv.kind === 'b4.window');
      const r = cur ? await w.updateIntervention(cur.id, params) : await w.createIntervention('b4.window', params);
      if (r.status !== 'applied') toastRejection(`Lattice change ${r.status}`, r);
    }, 350);
  };
  // Each inserted ion donates an electron to its corner metal site (reduced, absorbing).
  const reducedMetal = useMemo(() => {
    const out = new Set<number>();
    for (const i of occupied) {
      const a = Math.floor(i / 25);
      const b = Math.floor((i % 25) / 5);
      const c = i % 5;
      out.add(a * 36 + b * 6 + c);
    }
    return out;
  }, [occupied]);

  const metalRef = useRef<THREE.InstancedMesh>(null);
  const ionRef = useRef<THREE.InstancedMesh>(null);
  const oRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    sites.m.forEach((p, i) => {
      d.position.copy(p);
      d.scale.setScalar(1);
      d.updateMatrix();
      metalRef.current?.setMatrixAt(i, d.matrix);
      const reduced = reducedMetal.has(i);
      metalRef.current?.setColorAt(i, reduced ? c.set(win?.material.tintHex ?? '#3f7dff').multiplyScalar(2.2) : c.set('#9aa6b8'));
    });
    sites.ion.forEach((p, i) => {
      const on = occupied.has(i);
      d.position.copy(p);
      d.scale.setScalar(on ? 1 : 0.45);
      d.updateMatrix();
      ionRef.current?.setMatrixAt(i, d.matrix);
      ionRef.current?.setColorAt(i, on ? c.set('#5ce1ff').multiplyScalar(1.8) : c.set('#2a3550'));
    });
    sites.o.forEach((p, i) => {
      d.position.copy(p);
      d.scale.setScalar(1);
      d.updateMatrix();
      oRef.current?.setMatrixAt(i, d.matrix);
    });
    for (const r of [metalRef, ionRef, oRef]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
    }
  }, [sites, occupied, reducedMetal, win?.material.id, win?.material.tintHex]);

  // Photons: streaks travelling +z; a photon is absorbed at depth with probability (1−T).
  const P = 90;
  const photonGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P * 3), 3));
    g.setAttribute('aAlive', new THREE.BufferAttribute(new Float32Array(P), 1));
    return g;
  }, []);
  const photonMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aAlive; varying float vA; void main(){ vA = aAlive; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = 9.0*(10.0/-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard; gl_FragColor = vec4(vec3(1.0,0.95,0.7)*(1.0-r)*1.8*vA, (1.0-r)*vA); }`,
      }),
    [],
  );
  const ph = useMemo(() => {
    const rng = createRng(11);
    return Array.from({ length: P }, () => ({ x: (rng() - 0.5) * N * A, y: (rng() - 0.5) * N * A, z: -off - 3 - rng() * 8, absorbAt: 0, roll: rng() }));
  }, [off]);
  const Tref = useRef(T);
  useFrame((_, dt) => {
    Tref.current += (T - Tref.current) * Math.min(1, dt * 2);
    const pos = photonGeo.getAttribute('position') as THREE.BufferAttribute;
    const alive = photonGeo.getAttribute('aAlive') as THREE.BufferAttribute;
    const depth = N * A;
    ph.forEach((p, i) => {
      p.z += dt * 6;
      const absorbed = p.roll > Tref.current;
      const zAbs = -off + p.roll * depth * 0.999;
      let a = 1;
      if (absorbed && p.z > zAbs) a = Math.max(0, 1 - (p.z - zAbs) * 2.5);
      if (p.z > off + 6) {
        p.z = -off - 3 - Math.random() * 3;
        p.roll = Math.random();
      }
      pos.setXYZ(i, p.x, p.y, p.z);
      alive.setX(i, a);
    });
    pos.needsUpdate = true;
    alive.needsUpdate = true;
  });

  return (
    <group>
      <SkySphere brightness={0.2} />
      <ambientLight intensity={0.35} />
      <pointLight position={[8, 10, 10]} intensity={140} color="#dfe8ff" />
      <instancedMesh ref={metalRef} args={[undefined, undefined, sites.m.length]}>
        <sphereGeometry args={[0.22, 20, 16]} />
        <meshStandardMaterial roughness={0.35} metalness={0.4} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={oRef} args={[undefined, undefined, sites.o.length]}>
        <sphereGeometry args={[0.11, 12, 10]} />
        <meshStandardMaterial color="#ff5b5b" roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={ionRef} args={[undefined, undefined, sites.ion.length]} onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined) toggle(e.instanceId); }}>
        <sphereGeometry args={[0.16, 14, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <points geometry={photonGeo} material={photonMat} />
      <Label position={[0, off + 1.4, 0]} tone="accent" size="md" force>
        {`${win?.material.id ?? 'WO3'} · ${occupied.size} ions placed of 125 sites · x = ${(occupied.size / 125).toFixed(3)} e⁻/${metal}${win ? ` · absorbers ${win.absorberDensityCm3.toExponential(2)} cm⁻³` : ''} · click sites to insert / remove`}
      </Label>
      <Label position={[0, off + 0.9, 0]} tone="muted" force>
        {win ? `α = ${win.alphaPerCm.toExponential(2)} cm⁻¹ · ${win.thicknessNm.toFixed(0)} nm → T = ${(win.transmission * 100).toFixed(1)}%` : 'grey: M⁶⁺ · blue: reduced M⁵⁺ (absorbs) · cyan: inserted ions · red: O'}
      </Label>
      <mesh position={[-off - 1.6, -off, 0]} onClick={(e) => { e.stopPropagation(); goTo('room'); }}>
        <circleGeometry args={[0.3, 32]} />
        <meshBasicMaterial color="#b48cff" transparent opacity={0.4} />
      </mesh>
      <Label position={[-off - 1.6, -off - 0.5, 0]} tone="violet" force>⊖ zoom out to the room</Label>
    </group>
  );
}
