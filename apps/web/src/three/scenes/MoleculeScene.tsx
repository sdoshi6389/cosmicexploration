import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useTable } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';

const CPK: Record<string, string> = {
  H: '#f2f6ff', C: '#8c97aa', N: '#4f7dff', O: '#ff4f5e', P: '#ff9a3c', S: '#ffd84a', FE: '#ff9a3c', Fe: '#ff9a3c',
};
const RADIUS: Record<string, number> = { H: 0.22, C: 0.36, N: 0.34, O: 0.33, P: 0.42, S: 0.42, FE: 0.5, Fe: 0.5 };

interface Atom {
  el: string;
  p: THREE.Vector3;
}

function BallStick({ atoms, bonds, glowFe = true }: { atoms: Atom[]; bonds: [number, number, number][]; glowFe?: boolean }) {
  return (
    <group>
      {atoms.map((a, i) => {
        const fe = a.el.toUpperCase() === 'FE';
        return (
          <mesh key={i} position={a.p}>
            <sphereGeometry args={[RADIUS[a.el] ?? 0.35, 24, 24]} />
            {fe && glowFe ? (
              <meshBasicMaterial color={new THREE.Color('#ff9a3c').multiplyScalar(2.6)} toneMapped={false} />
            ) : (
              <meshPhysicalMaterial color={CPK[a.el] ?? '#c9c9c9'} roughness={0.28} metalness={0.05} clearcoat={0.6} clearcoatRoughness={0.2} />
            )}
          </mesh>
        );
      })}
      {bonds.map(([i, j, order], k) => {
        const a = atoms[i];
        const b = atoms[j];
        if (!a || !b) return null;
        return <Bond key={k} a={a.p} b={b.p} order={order} />;
      })}
    </group>
  );
}

function Bond({ a, b, order }: { a: THREE.Vector3; b: THREE.Vector3; order: number }) {
  const { pos, quat, len } = useMemo(() => {
    const d = b.clone().sub(a);
    return { pos: a.clone().add(d.clone().multiplyScalar(0.5)), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), len: d.length() };
  }, [a, b]);
  const offsets = order >= 2 ? [-0.08, 0.08] : [0];
  return (
    <group position={pos} quaternion={quat}>
      {offsets.map((o) => (
        <mesh key={o} position={[o, 0, 0]}>
          <cylinderGeometry args={[order >= 2 ? 0.055 : 0.08, order >= 2 ? 0.055 : 0.08, len, 10]} />
          <meshStandardMaterial color="#c8d2e6" roughness={0.35} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function distanceBonds(atoms: Atom[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const fe = atoms[i]!.el.toUpperCase() === 'FE' || atoms[j]!.el.toUpperCase() === 'FE';
      if (atoms[i]!.p.distanceTo(atoms[j]!.p) < (fe ? 2.15 : 1.9)) out.push([i, j, 1]);
    }
  }
  return out;
}

export function MoleculeScene() {
  const cid = useUi((s) => s.moleculeCid);
  const pdb = useTable('pdb_atom');
  const mols = useTable('molecule');
  const matoms = useTable('molecule_atom');
  const mbonds = useTable('molecule_bond');

  const heme = useMemo(() => {
    const rows = pdb.filter((a) => a.entryId === '4HHB' && a.resName === 'HEM' && a.chain === 'A');
    const c = new THREE.Vector3();
    rows.forEach((r) => c.add(new THREE.Vector3(r.x, r.y, r.z)));
    if (rows.length) c.divideScalar(rows.length);
    const atoms = rows.map((r) => ({ el: r.element, p: new THREE.Vector3(r.x, r.y, r.z).sub(c) }));
    const fe = atoms.find((a) => a.el === 'FE');
    // Orient so the porphyrin plane faces the camera (normal from three ring nitrogens).
    const ns = atoms.filter((a) => a.el === 'N').slice(0, 3);
    if (ns.length === 3) {
      const n = ns[1]!.p.clone().sub(ns[0]!.p).cross(ns[2]!.p.clone().sub(ns[0]!.p)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, 1));
      atoms.forEach((a) => a.p.applyQuaternion(q));
    }
    return { atoms, bonds: distanceBonds(atoms), fe: fe?.p ?? new THREE.Vector3() };
  }, [pdb]);

  const conformer = (id: number) => {
    const atoms = matoms.filter((a) => a.cid === id).sort((a, b) => a.idx - b.idx).map((a) => ({ el: a.element, p: new THREE.Vector3(a.x, a.y, a.z) }));
    const c = new THREE.Vector3();
    atoms.forEach((a) => c.add(a.p));
    if (atoms.length) c.divideScalar(atoms.length);
    atoms.forEach((a) => a.p.sub(c));
    const bonds = mbonds.filter((b) => b.cid === id).map((b) => [b.a1, b.a2, b.order] as [number, number, number]);
    return { atoms, bonds };
  };
  const o2 = useMemo(() => conformer(977), [matoms, mbonds]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = useMemo(() => (cid ? conformer(cid) : null), [cid, matoms, mbonds]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = mols.find((m) => m.cid === cid);

  const spin = useRef<THREE.Group>(null);
  const o2Ref = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.12;
    if (o2Ref.current) {
      const t = (state.clock.elapsedTime % 9) / 9;
      const approach = t < 0.5 ? 1 - t / 0.5 : t < 0.8 ? 0 : (t - 0.8) / 0.2;
      o2Ref.current.position.set(heme.fe.x, heme.fe.y, heme.fe.z + 1.95 + approach * 7);
      o2Ref.current.rotation.set(state.clock.elapsedTime * 0.7 * approach, 0.6, Math.PI / 2 - 0.5 + approach);
    }
  });

  return (
    <group>
      <ambientLight intensity={0.4} />
      <directionalLight position={[6, 8, 10]} intensity={2.6} />
      <directionalLight position={[-8, -4, -6]} intensity={0.8} color="#7ea8ff" />
      <pointLight position={[0, 0, 4]} intensity={30} color="#ffb070" />
      <group ref={spin}>
        {selected ? (
          <BallStick atoms={selected.atoms} bonds={selected.bonds} />
        ) : (
          <>
            <BallStick atoms={heme.atoms} bonds={heme.bonds} />
            {o2.atoms.length ? (
              <group ref={o2Ref}>
                <BallStick atoms={o2.atoms} bonds={o2.bonds} />
              </group>
            ) : null}
            <Label position={[heme.fe.x, heme.fe.y + 0.9, heme.fe.z]} tone="amber" size="md" force>Fe²⁺</Label>
          </>
        )}
      </group>
      <Label position={[0, 7.2, 0]} tone="accent" size="md" force>
        {selected
          ? `${meta?.name ?? 'Molecule'} · ${meta?.formula ?? ''} · PubChem CID ${cid} · computed conformer`
          : 'Heme b · 4HHB chain A (crystallographic) · O₂ from PubChem CID 977 · binding motion illustrative'}
      </Label>
    </group>
  );
}
