import type { K3Output, ScienceStar, StructureView } from '@cosmos/engine';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { si } from '../../lib/format';
import { useUi } from '../../state/ui';
import { cameraRef } from '../Stage';
import { Label } from '../common/Label';

/**
 * Kardashev III detail layer. The expansion is computed on real Gaia positions, so
 * at galaxy scale it is tiny; these layers make its structure readable:
 *  - colony ships travelling parent → child along the arrival tree (in transit now),
 *  - Dyson swarms drawn around settled stars near the camera (level of detail),
 *  - user-built megastructures at any star,
 *  - the selected star.
 * Sizes of swarms/ships are exaggerated for visibility (labelled), positions are not.
 */

const PC_PER_UNIT = 100;
const LY_PER_PC = 3.2615637769;
type V3 = [number, number, number];

export interface CivProps {
  k3: K3Output | null;
  stars: ScienceStar[];
  positions: V3[];
  playheadYr: { current: number };
}

/** Ships currently in flight: departure = arrival − travel time along the parent edge. */
export function ColonyShips({ k3, positions, playheadYr }: CivProps) {
  const MAX = 4000;
  const edges = useMemo(() => {
    if (!k3) return [];
    const c = Math.max(1e-6, k3.travelSpeedFractionC);
    const out: { a: V3; b: V3; arrive: number; travel: number }[] = [];
    for (let i = 0; i < k3.arrivalSeconds.length; i++) {
      const t = k3.arrivalSeconds[i]!;
      const p = k3.parentIndex[i] ?? -1;
      if (p < 0 || !Number.isFinite(t)) continue;
      const a = positions[p]!;
      const b = positions[i]!;
      const ly = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * PC_PER_UNIT * LY_PER_PC;
      out.push({ a, b, arrive: t / (365.25 * 86400), travel: ly / c });
    }
    return out.sort((x, y) => x.arrive - y.arrive);
  }, [k3, positions]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp(0.02/-mv.z*900.0, 2.0, 7.0); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `void main(){ float r = length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard; gl_FragColor = vec4(vec3(1.0,0.86,0.45)*(1.2-r)*2.0, 1.0-r); }`,
      }),
    [],
  );
  useFrame(() => {
    const now = playheadYr.current;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    let n = 0;
    // Edges are sorted by arrival; ships in flight have arrive − travel < now < arrive.
    for (let i = edges.length - 1; i >= 0 && n < MAX; i--) {
      const e = edges[i]!;
      if (e.arrive <= now) continue;
      const dep = e.arrive - e.travel;
      if (dep > now) continue;
      const f = (now - dep) / e.travel;
      pos.setXYZ(n++, e.a[0] + (e.b[0] - e.a[0]) * f, e.a[1] + (e.b[1] - e.a[1]) * f, e.a[2] + (e.b[2] - e.a[2]) * f);
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
  });
  return k3 ? <points geometry={geo} material={mat} frustumCulled={false} renderOrder={6} /> : null;
}

/** Swarm rings around settled stars close to the camera target (LOD; exaggerated size). */
export function NearbySwarms({ k3, positions, playheadYr }: CivProps) {
  const MAX = 240;
  const camera = useThree((s) => s.camera);
  const ringGeo = useMemo(() => new THREE.TorusGeometry(1, 0.035, 6, 48), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(1.8), transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a3a').multiplyScalar(0.9), transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const rings = useRef<THREE.InstancedMesh>(null);
  const glows = useRef<THREE.InstancedMesh>(null);
  const last = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    if (!k3 || !rings.current || !glows.current) return;
    const t = state.clock.elapsedTime;
    const cam = camera.position;
    const c = cameraRef.current;
    const dist = c?.distance ?? cam.length();
    c?.getTarget(target);
    // Recompute the candidate set a few times per second.
    if (t - last.current > 0.25) {
      last.current = t;
      const now = playheadYr.current;
      const radius = Math.max(0.02, dist * 1.5);
      const cand: [number, number][] = [];
      for (let i = 0; i < k3.arrivalSeconds.length; i++) {
        const a = k3.arrivalSeconds[i]!;
        if (!(a / (365.25 * 86400) <= now)) continue;
        const p = positions[i]!;
        const d = Math.hypot(p[0] - target.x, p[1] - target.y, p[2] - target.z);
        if (d < radius) cand.push([d, i]);
      }
      cand.sort((x, y) => x[0] - y[0]);
      const s = Math.min(0.01, dist * 0.012);
      let n = 0;
      for (const [, i] of cand.slice(0, MAX / 3)) {
        const p = positions[i]!;
        for (let k = 0; k < 3; k++) {
          dummy.position.set(p[0], p[1], p[2]);
          dummy.rotation.set(0.4 + k * 1.05 + i, i * 0.37 + k * 0.6, 0);
          dummy.scale.setScalar(s * (1 + k * 0.18));
          dummy.updateMatrix();
          rings.current.setMatrixAt(n, dummy.matrix);
          n++;
        }
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(s * 1.6);
        dummy.updateMatrix();
        glows.current.setMatrixAt(n / 3 - 1, dummy.matrix);
      }
      rings.current.count = n;
      glows.current.count = n / 3;
      rings.current.instanceMatrix.needsUpdate = true;
      glows.current.instanceMatrix.needsUpdate = true;
    }
    rings.current.rotation.set(0, 0, 0);
  });
  if (!k3) return null;
  return (
    <>
      <instancedMesh ref={rings} args={[ringGeo, ringMat, MAX]} frustumCulled={false} renderOrder={7} />
      <instancedMesh ref={glows} args={[undefined, glowMat, MAX / 3]} frustumCulled={false} renderOrder={5}>
        <sphereGeometry args={[1, 16, 12]} />
      </instancedMesh>
    </>
  );
}

/** User-built structures at other stars (from the authoritative K3 view). */
export function StarStructures({ structures, positionOf }: { structures: StructureView[]; positionOf: (id: string) => V3 | null }) {
  const select = useUi((s) => s.select);
  const byHost = new Map<string, StructureView[]>();
  for (const s of structures) byHost.set(s.hostId, [...(byHost.get(s.hostId) ?? []), s]);
  return (
    <>
      {[...byHost].map(([hostId, items]) => {
        const p = positionOf(hostId);
        if (!p) return null;
        const sphere = items.some((i) => i.type === 'dyson_sphere');
        const total = items.reduce((m, i) => m + i.usefulW, 0);
        return (
          <group key={hostId} position={p}>
            <StructureHalo sphere={sphere} onClick={() => select({ kind: 'intervention', id: items[0]!.interventionId, label: items[0]!.label, level: 'k3' })} />
            <Label position={[0, 0.012, 0]} tone="amber" force>
              {items.map((i) => i.type.replace('_', ' ')).join(' + ')} · {items[0]!.hostName} · {si(total, 'W', 2)}
            </Label>
          </group>
        );
      })}
    </>
  );
}

function StructureHalo({ sphere, onClick }: { sphere: boolean; onClick: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame((state) => {
    if (!ref.current) return;
    const d = camera.position.distanceTo(ref.current.getWorldPosition(new THREE.Vector3()));
    ref.current.scale.setScalar(Math.max(0.0015, d * 0.025));
    ref.current.rotation.y = state.clock.elapsedTime * 0.4;
  });
  return (
    <group ref={ref} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {sphere ? (
        <mesh>
          <icosahedronGeometry args={[1, 2]} />
          <meshBasicMaterial color={new THREE.Color('#ff7a3a').multiplyScalar(1.6)} wireframe transparent opacity={0.8} toneMapped={false} />
        </mesh>
      ) : (
        [0, 1, 2, 3].map((k) => (
          <mesh key={k} rotation={[0.5 + k * 0.8, k * 0.9, 0]}>
            <torusGeometry args={[1, 0.04, 6, 64]} />
            <meshBasicMaterial color={new THREE.Color('#ffc46b').multiplyScalar(2)} transparent opacity={0.85} toneMapped={false} />
          </mesh>
        ))
      )}
      <mesh>
        <sphereGeometry args={[1.5, 16, 12]} />
        <meshBasicMaterial color="#ff5a3a" transparent opacity={0.12} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Highlight ring around the selected star. */
export function SelectedMarker({ position }: { position: V3 | null }) {
  const ref = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  useFrame((state) => {
    if (!ref.current || !position) return;
    const d = camera.position.distanceTo(new THREE.Vector3(...position));
    ref.current.scale.setScalar(Math.max(0.0008, d * 0.02) * (1 + 0.1 * Math.sin(state.clock.elapsedTime * 4)));
    ref.current.quaternion.copy(camera.quaternion);
  });
  if (!position) return null;
  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[1, 1.15, 48]} />
      <meshBasicMaterial color="#5ce1ff" transparent opacity={0.9} toneMapped={false} depthTest={false} />
    </mesh>
  );
}
