import { createRng, type B5Output } from '@cosmos/engine';
import { Trail } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLevelView } from '../../state/selectors';
import { Label } from '../common/Label';

const NUCLEON_R = 0.5;

/** Deterministic relaxed packing of Z protons + N neutrons (illustrative arrangement). */
function packNucleons(total: number): THREE.Vector3[] {
  const rng = createRng(2211);
  const pts = Array.from({ length: total }, () => new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(2.4));
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < total; i++) {
      const pi = pts[i]!;
      pi.multiplyScalar(0.985);
      for (let j = i + 1; j < total; j++) {
        const pj = pts[j]!;
        const d = pi.clone().sub(pj);
        const len = d.length() || 1e-3;
        const overlap = 2 * NUCLEON_R * 0.96 - len;
        if (overlap > 0) {
          d.multiplyScalar((overlap / len) * 0.5);
          pi.add(d);
          pj.sub(d);
        }
      }
    }
  }
  return pts;
}

export function NucleusScene() {
  const { output: b5, pulse, preview } = useLevelView<B5Output>('b5');
  const pts = useMemo(() => packNucleons(22), []);
  const converting = useMemo(() => {
    let best = 0;
    pts.slice(0, 11).forEach((p, i) => {
      if (p.length() > pts[best]!.length()) best = i;
    });
    return best;
  }, [pts]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const t0 = useRef(-1e9);
  useEffect(() => {
    if (b5 && !preview) t0.current = performance.now();
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const positron = useRef<THREE.Mesh>(null);
  const neutrino = useRef<THREE.Mesh>(null);
  const gamma = useRef<THREE.Group>(null);
  const dirE = useMemo(() => new THREE.Vector3(1, 0.45, 0.2).normalize(), []);
  const dirNu = useMemo(() => new THREE.Vector3(-0.8, 0.3, -0.5).normalize(), []);
  const dirG = useMemo(() => new THREE.Vector3(-0.2, -0.6, 0.75).normalize(), []);
  const protonColor = useMemo(() => new THREE.Color('#ff5a4f'), []);
  const neutronColor = useMemo(() => new THREE.Color('#8fa8d6'), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const age = (performance.now() - t0.current) / 1000;
    const decayed = b5 && (preview || age > 0.8);
    pts.forEach((p, i) => {
      const m = meshes.current[i];
      if (!m) return;
      const j = 0.05 * Math.sin(t * 6 + i * 1.7);
      m.position.set(p.x + j, p.y + 0.05 * Math.cos(t * 5 + i), p.z + j * 0.6);
      const mat = m.material as THREE.MeshPhysicalMaterial;
      if (i === converting && b5) {
        const glow = Math.max(0, 1 - Math.abs(age - 0.8) / 0.5);
        mat.color.copy(decayed ? neutronColor : protonColor);
        mat.emissive.setRGB(0.3 + glow * 3, 0.9 * glow * 3, glow * 3);
      } else {
        mat.emissive.setRGB(0, 0, 0);
      }
    });
    const fly = Math.max(0, age - 0.8);
    if (positron.current) {
      positron.current.visible = Boolean(b5) && age > 0.8 && age < 5;
      positron.current.position.copy(dirE).multiplyScalar(1.8 + fly * 7);
    }
    if (neutrino.current) {
      neutrino.current.visible = Boolean(b5) && age > 0.8 && age < 3.5;
      neutrino.current.position.copy(dirNu).multiplyScalar(1.8 + fly * 12);
    }
    if (gamma.current) {
      const g = Math.max(0, age - 1.3);
      gamma.current.visible = Boolean(b5) && age > 1.3 && age < 4;
      gamma.current.position.copy(dirG).multiplyScalar(1.6 + g * 10);
    }
  });

  return (
    <group>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 6, 8]} intensity={2.8} />
      <directionalLight position={[-6, -3, -4]} intensity={0.7} color="#7ea8ff" />
      {pts.map((p, i) => (
        <mesh key={i} ref={(el) => { meshes.current[i] = el; }} position={p}>
          <sphereGeometry args={[NUCLEON_R, 32, 32]} />
          <meshPhysicalMaterial color={i < 11 ? '#ff5a4f' : '#8fa8d6'} roughness={0.32} clearcoat={0.7} clearcoatRoughness={0.25} sheen={0.4} />
        </mesh>
      ))}
      <Trail width={1.6} length={6} color={new THREE.Color('#5ce1ff').multiplyScalar(3)} attenuation={(w) => w * w}>
        <mesh ref={positron} visible={false}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshBasicMaterial color={new THREE.Color('#bff6ff').multiplyScalar(3)} toneMapped={false} />
        </mesh>
      </Trail>
      <mesh ref={neutrino} visible={false}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshBasicMaterial color={new THREE.Color('#ffffff').multiplyScalar(1.4)} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <group ref={gamma} visible={false}>
        <mesh>
          <sphereGeometry args={[0.14, 12, 12]} />
          <meshBasicMaterial color={new THREE.Color('#ffd84a').multiplyScalar(3.5)} toneMapped={false} />
        </mesh>
      </group>
      <Label position={[0, 3.6, 0]} tone="accent" size="md" force>
        {b5 ? `²²Na → ²²Ne* + e⁺ + νₑ → ²²Ne + γ (${b5.gammaKeV.toFixed(1)} keV)` : '²²Na · 11 protons · 11 neutrons · T½ from IAEA/ENSDF'}
      </Label>
      {b5 ? (
        <Label position={dirE.clone().multiplyScalar(4).toArray() as [number, number, number]} tone="accent">
          e⁺ {b5.positronKineticKeV.toFixed(0)} keV → feeds B6
        </Label>
      ) : null}
      <Label position={[0, -3.4, 0]} tone="muted" force>Nucleon arrangement illustrative · energies from ENSDF / AME2020</Label>
    </group>
  );
}
