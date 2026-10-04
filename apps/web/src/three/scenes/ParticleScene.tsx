import type { B6Output } from '@cosmos/engine';
import { Trail } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { energyMeV } from '../../lib/format';
import { useLevelView } from '../../state/selectors';
import { Label } from '../common/Label';

const CAL_R = 5.4;
const PHI = 56;
const ZS = 22;
const LEN = 15;

export function ParticleScene() {
  const { output: b6, pulse } = useLevelView<B6Output>('b6', (v) => (v as { collision: B6Output | null }).collision);
  const t0 = useRef(performance.now() - 20000);
  useEffect(() => {
    if (b6) t0.current = performance.now();
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const photonDir = useMemo(() => {
    const p = b6?.outgoing[0]?.momentumMevC ?? [0, 1, 0];
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    return v.lengthSq() > 0 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  }, [b6]);
  const beta = b6?.incomingBetaFractionC ?? 0.86;
  const approachTime = 1.6 - 0.9 * beta;

  /* calorimeter */
  const cal = useRef<THREE.InstancedMesh>(null);
  const cellGeo = useMemo(() => new THREE.BoxGeometry(0.5, 0.5, 0.62), []);
  const cellMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 }), []);
  const cells = useMemo(() => {
    const out: { pos: THREE.Vector3; quat: THREE.Quaternion; dir: THREE.Vector3 }[] = [];
    for (let i = 0; i < PHI; i++) {
      const phi = (i / PHI) * Math.PI * 2;
      if (Math.sin(phi) > 0.3) continue; // cutaway facing the camera
      for (let j = 0; j < ZS; j++) {
        const x = -LEN / 2 + ((j + 0.5) / ZS) * LEN;
        const dir = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi));
        const pos = new THREE.Vector3(x, 0, 0).add(dir.clone().multiplyScalar(CAL_R));
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        out.push({ pos, quat, dir: pos.clone().normalize() });
      }
    }
    return out;
  }, []);
  useEffect(() => {
    const m = cal.current;
    if (!m) return;
    const d = new THREE.Object3D();
    cells.forEach((c, i) => {
      d.position.copy(c.pos);
      d.quaternion.copy(c.quat);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, new THREE.Color('#0d1626'));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells]);

  const eMinus = useRef<THREE.Mesh>(null);
  const ePlus = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const g1 = useRef<THREE.Mesh>(null);
  const g2 = useRef<THREE.Mesh>(null);
  const deposit = useMemo(() => Math.min(1, 0.35 + Math.log10(1 + (b6?.photonEnergyMev ?? 0.5)) * 0.28), [b6]);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const age = (performance.now() - t0.current) / 1000;
    const tc = approachTime;
    const a = Math.min(1, age / tc);
    const x = 7 * (1 - a);
    if (eMinus.current) {
      eMinus.current.visible = age < tc;
      eMinus.current.position.set(-x, 0, 0);
    }
    if (ePlus.current) {
      ePlus.current.visible = age < tc;
      ePlus.current.position.set(x, 0, 0);
    }
    const post = age - tc;
    if (flash.current) {
      const f = post > 0 && post < 0.9 ? Math.exp(-post * 4.5) : 0;
      flash.current.scale.setScalar(0.2 + (1 - Math.exp(-post * 6)) * 1.6);
      (flash.current.material as THREE.MeshBasicMaterial).opacity = f;
    }
    if (ring.current) {
      const r = post > 0 ? post * 9 : 0;
      ring.current.scale.setScalar(Math.max(0.001, r));
      (ring.current.material as THREE.MeshBasicMaterial).opacity = post > 0 && r < CAL_R ? 0.6 * (1 - r / CAL_R) : 0;
    }
    const reach = CAL_R / Math.max(0.2, Math.hypot(photonDir.y, photonDir.z) || 0.2);
    const travel = Math.min(reach, Math.max(0, post) * 11);
    for (const [ref, s] of [[g1, 1], [g2, -1]] as const) {
      if (!ref.current) continue;
      ref.current.visible = post > 0 && post < 3.2;
      ref.current.position.copy(photonDir).multiplyScalar(travel * s);
    }
    const hitAge = post - reach / 11;
    const m = cal.current;
    if (m) {
      cells.forEach((c, i) => {
        let e = 0;
        if (hitAge > 0) {
          const d1 = c.dir.dot(photonDir);
          const d2 = -d1;
          const near = Math.max(d1, d2);
          e = deposit * Math.exp(-(1 - near) * 140) * Math.exp(-hitAge * 0.35);
        }
        if (e > 0.02) tmpColor.setRGB(0.3 + 3.2 * e, 0.25 + 2.4 * e * e, 0.4 * (1 - e) + 0.2);
        else tmpColor.set('#0d1626');
        m.setColorAt(i, tmpColor);
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <ambientLight intensity={0.3} />
      {/* beam pipe + tracker */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, LEN + 4, 32, 1, true]} />
        <meshBasicMaterial color="#5ce1ff" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {[1.4, 2.4, 3.4, 4.4].map((r) => (
        <mesh key={r} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[r, r, LEN, 48, 4, true, Math.PI * 0.6, Math.PI * 1.4]} />
          <meshBasicMaterial color="#3a6ea8" wireframe transparent opacity={0.07} depthWrite={false} />
        </mesh>
      ))}
      <instancedMesh ref={cal} args={[cellGeo, cellMat, cells.length]} frustumCulled={false} />
      {/* incoming leptons */}
      <Trail width={1.2} length={5} color={new THREE.Color('#5c9dff').multiplyScalar(2.5)} attenuation={(w) => w * w}>
        <mesh ref={eMinus}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshBasicMaterial color={new THREE.Color('#8fc3ff').multiplyScalar(3)} toneMapped={false} />
        </mesh>
      </Trail>
      <Trail width={1.2} length={5} color={new THREE.Color('#ff5f7a').multiplyScalar(2.5)} attenuation={(w) => w * w}>
        <mesh ref={ePlus}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshBasicMaterial color={new THREE.Color('#ff9fb0').multiplyScalar(3)} toneMapped={false} />
        </mesh>
      </Trail>
      {/* annihilation */}
      <mesh ref={flash}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color={new THREE.Color('#ffffff').multiplyScalar(4)} transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[0, Math.PI / 2, 0]}>
        <ringGeometry args={[0.96, 1, 96]} />
        <meshBasicMaterial color={new THREE.Color('#ffe8a8').multiplyScalar(2)} transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
      {[g1, g2].map((r, i) => (
        <Trail key={i} width={1.8} length={7} color={new THREE.Color('#ffd84a').multiplyScalar(3)} attenuation={(w) => w}>
          <mesh ref={r} visible={false}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshBasicMaterial color={new THREE.Color('#fff2b0').multiplyScalar(3.5)} toneMapped={false} />
          </mesh>
        </Trail>
      ))}
      <Label position={[-7.6, 0.6, 0]} tone="accent">e⁻ {b6 ? energyMeV(b6.kineticEnergyPerParticleMev) : ''}</Label>
      <Label position={[7.6, 0.6, 0]} tone="violet">e⁺ {b6 ? energyMeV(b6.kineticEnergyPerParticleMev) : ''}</Label>
      {b6 ? (
        <Label position={photonDir.clone().multiplyScalar(CAL_R + 1.2).toArray() as [number, number, number]} tone="amber" size="md" force>
          γ {energyMeV(b6.photonEnergyMev)} each · ledger {b6.conservation.balanced ? 'balanced ✓' : 'residual!'}
        </Label>
      ) : null}
      <Label position={[0, -CAL_R - 1.4, 0]} tone="muted" force>
        Toy kinematics · electron mass from PDG 2025 · no cross-sections computed
      </Label>
    </group>
  );
}
