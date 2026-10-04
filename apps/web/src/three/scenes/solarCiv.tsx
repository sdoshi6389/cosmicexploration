import type { StructureView } from '@cosmos/engine';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { si } from '../../lib/format';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';

/**
 * Kardashev II "free build" layer: every structure the branch has built in the Solar
 * System, drawn on its actual host body. Visual sizes are scaled to the (enlarged)
 * bodies; power figures come from the authoritative model output.
 */

const AMBER = new THREE.Color('#ffc46b');
type Pos = Map<string, THREE.Vector3>;

export function SystemStructures({ structures, positions, sizes, swarmRadius }: {
  structures: StructureView[];
  positions: Pos;
  sizes: Map<string, number>;
  /** Scene radius for a given AU (compressed solar scale). */
  swarmRadius: (au: number) => number;
}) {
  const select = useUi((s) => s.select);
  const selected = useUi((s) => s.selection?.id);
  return (
    <>
      {structures.map((st, i) => {
        const p = st.hostId === 'body.sun' ? new THREE.Vector3() : positions.get(st.hostId);
        if (!p) return null;
        const size = st.hostId === 'body.sun' ? 2.2 : sizes.get(st.hostId) ?? 0.2;
        const pick = () => select({ kind: 'intervention', id: st.interventionId, label: st.label, level: 'k2' });
        const vis = Math.max(0.05, st.construction);
        return (
          <group key={st.interventionId} position={p} onClick={(e) => { e.stopPropagation(); pick(); }}>
            {st.type === 'surface_collectors' ? <CollectorShell size={size} coverage={st.coverage} construction={vis} /> : null}
            {st.type === 'orbital_ring' ? <CollectorRing size={size} coverage={st.coverage} construction={vis} seed={i} /> : null}
            {st.type === 'gas_harvester' ? <HarvesterFleet size={size} /> : null}
            {st.type === 'habitat' ? <Habitat size={size} served={st.servedFraction} seed={i} /> : null}
            {st.type === 'dyson_swarm' ? <StarSwarm radius={swarmRadius(st.orbitRadiusAU)} coverage={st.coverage * vis} /> : null}
            {st.type === 'dyson_sphere' ? <StarShell radius={swarmRadius(st.orbitRadiusAU)} coverage={Math.max(0.9, st.coverage) * vis} temp={st.radiatorTempK ?? 300} /> : null}
            {st.valid ? (
              <Label position={[0, size * (st.type === 'habitat' ? 3 : 2.1) + 0.2, 0]} tone={selected === st.interventionId ? 'accent' : 'amber'} force={selected === st.interventionId}>
                {st.label} · {st.type === 'habitat' ? `${si(st.servedW, 'W', 2)} of ${si(st.demandW, 'W', 2)}` : si(st.usefulW, 'W', 2)}
              </Label>
            ) : (
              <Label position={[0, size * 2 + 0.2, 0]} tone="amber" force>⚠ {st.label}: {st.note}</Label>
            )}
          </group>
        );
      })}
      <Traffic structures={structures} positions={positions} />
    </>
  );
}

/** Hex-tiled collector shell hugging the surface; coverage sets the tiled fraction. */
function CollectorShell({ size, coverage, construction }: { size: number; coverage: number; construction: number }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { cov: { value: 0 }, time: { value: 0 } },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float cov; uniform float time; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          void main(){ vec2 g = vUv*vec2(160.0, 80.0); vec2 c = floor(g); vec2 f = fract(g)-0.5;
            float lat = abs(vUv.y-0.5)*2.0; float on = step(h(c), cov) * step(lat, 0.92);
            float edge = smoothstep(0.42, 0.5, max(abs(f.x), abs(f.y)));
            float glint = 0.6 + 0.4*sin(time*2.0 + h(c)*30.0);
            float rim = pow(1.0-abs(dot(vN,vV)), 1.5);
            vec3 col = mix(vec3(0.18,0.32,0.75), vec3(1.0,0.78,0.38), edge) * glint;
            gl_FragColor = vec4(col*on*(0.55+rim), on*(0.35+0.5*edge)); }`,
      }),
    [],
  );
  useFrame((s) => {
    mat.uniforms.time!.value = s.clock.elapsedTime;
    // Small coverages are still visible (√ scaling) — the number shown is the model's.
    const target = Math.min(1, Math.sqrt(coverage)) * construction;
    mat.uniforms.cov!.value += (target - mat.uniforms.cov!.value) * 0.05;
  });
  return (
    <mesh material={mat}>
      <sphereGeometry args={[size * 1.012, 96, 64]} />
    </mesh>
  );
}

function CollectorRing({ size, coverage, construction, seed }: { size: number; coverage: number; construction: number; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.12;
  });
  const segs = Math.max(12, Math.round(160 * Math.min(1, Math.sqrt(coverage)) * construction));
  return (
    <group rotation={[0.25 + seed * 0.3, 0, 0.12]}>
      <group ref={ref}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[size * 1.9, size * 0.025, 8, 160]} />
          <meshBasicMaterial color={AMBER.clone().multiplyScalar(1.4)} toneMapped={false} />
        </mesh>
        {Array.from({ length: segs }, (_, k) => {
          const a = (k / segs) * Math.PI * 2;
          return (
            <mesh key={k} position={[Math.cos(a) * size * 1.9, 0, Math.sin(a) * size * 1.9]} rotation={[0, -a, 0]}>
              <boxGeometry args={[size * 0.02, size * 0.22, size * 0.07]} />
              <meshBasicMaterial color={new THREE.Color('#3b6bff').multiplyScalar(1.6)} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function HarvesterFleet({ size }: { size: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (!ref.current) return;
    ref.current.children.forEach((c, k) => {
      const t = s.clock.elapsedTime * (0.5 + k * 0.07) + k;
      const r = size * (1.12 + (k % 3) * 0.05);
      c.position.set(Math.cos(t) * r, Math.sin(t * 0.7 + k) * size * 0.4, Math.sin(t) * r);
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 10 }, (_, k) => (
        <mesh key={k}>
          <coneGeometry args={[size * 0.03, size * 0.09, 6]} />
          <meshBasicMaterial color={new THREE.Color('#9fe6ff').multiplyScalar(2)} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Paired O'Neill cylinders orbiting the host; windows glow by served fraction. */
function Habitat({ size, served, seed }: { size: number; served: number; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const s = Math.max(0.05, size * 0.22);
  useFrame((st, dt) => {
    if (!ref.current) return;
    const t = st.clock.elapsedTime * 0.15 + seed;
    ref.current.position.set(Math.cos(t) * size * 2.4, size * 0.3, Math.sin(t) * size * 2.4);
    ref.current.children.forEach((c) => (c.rotation.y += dt * 0.8));
  });
  const glow = new THREE.Color().setHSL(0.12 + 0.2 * served, 0.9, 0.6).multiplyScalar(0.6 + served * 1.6);
  return (
    <group ref={ref}>
      {[-1, 1].map((k) => (
        <group key={k} position={[k * s * 0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh>
            <cylinderGeometry args={[s * 0.32, s * 0.32, s * 1.6, 24, 1]} />
            <meshStandardMaterial color="#c9d3e6" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[s * 0.325, s * 0.325, s * 1.4, 24, 1, true]} />
            <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.55} wireframe />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function StarSwarm({ radius, coverage }: { radius: number; coverage: number }) {
  const n = Math.round(600 + Math.min(1, Math.sqrt(coverage)) * 5000);
  const ref = useRef<THREE.InstancedMesh>(null);
  const orbits = useMemo(() => Array.from({ length: n }, (_, i) => ({ inc: ((i * 37) % 180) * (Math.PI / 180), node: ((i * 61) % 360) * (Math.PI / 180), ph: (i * 2.399) % (Math.PI * 2), r: radius * (0.96 + ((i * 13) % 9) * 0.01) })), [n, radius]);
  const d = useMemo(() => new THREE.Object3D(), []);
  useFrame((s) => {
    const m = ref.current;
    if (!m) return;
    const t = s.clock.elapsedTime * 0.08;
    orbits.forEach((o, i) => {
      const a = o.ph + t * (1.2 / Math.sqrt(o.r));
      const x = Math.cos(a) * o.r;
      const z = Math.sin(a) * o.r;
      const y = z * Math.sin(o.inc);
      const zz = z * Math.cos(o.inc);
      d.position.set(x * Math.cos(o.node) - zz * Math.sin(o.node), y, x * Math.sin(o.node) + zz * Math.cos(o.node));
      d.lookAt(0, 0, 0);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} frustumCulled={false}>
      <planeGeometry args={[0.07, 0.07]} />
      <meshBasicMaterial color={AMBER.clone().multiplyScalar(1.8)} side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}

function StarShell({ radius, coverage, temp }: { radius: number; coverage: number; temp: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.02;
  });
  const heat = Math.min(1, temp / 600);
  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[radius, 5]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.7} roughness={0.4} transparent opacity={0.25 + 0.7 * coverage} emissive={new THREE.Color('#ff4a1a')} emissiveIntensity={heat * 0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[radius * 1.002, 5]} />
        <meshBasicMaterial color={AMBER.clone().multiplyScalar(1.3)} wireframe transparent opacity={0.45} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Ship traffic and power links between every pair of built-up hosts. */
function Traffic({ structures, positions }: { structures: StructureView[]; positions: Pos }) {
  const hosts = [...new Set(structures.filter((s) => s.valid).map((s) => s.hostId))].map((id) => (id === 'body.sun' ? new THREE.Vector3() : positions.get(id))).filter((p): p is THREE.Vector3 => Boolean(p));
  const routes = useMemo(() => {
    const out: THREE.QuadraticBezierCurve3[] = [];
    for (let i = 0; i < hosts.length; i++)
      for (let j = i + 1; j < hosts.length; j++) {
        const a = hosts[i]!;
        const b = hosts[j]!;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.y += a.distanceTo(b) * 0.15;
        out.push(new THREE.QuadraticBezierCurve3(a, mid, b));
      }
    return out;
  }, [hosts.map((h) => h.toArray().join()).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const per = 14;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, routes.length * per) * 3), 3));
    return g;
  }, [routes]);
  useFrame((s) => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    routes.forEach((r, ri) => {
      for (let k = 0; k < per; k++) {
        const u = (k / per + s.clock.elapsedTime * 0.03 * (k % 2 ? 1 : -1) + 10) % 1;
        const p = r.getPoint(u);
        pos.setXYZ(ri * per + k, p.x, p.y, p.z);
      }
    });
    pos.needsUpdate = true;
  });
  if (!routes.length) return null;
  return (
    <>
      {routes.map((r, i) => (
        <Line key={i} points={r.getPoints(40)} color="#5ce1ff" lineWidth={1} transparent opacity={0.25} />
      ))}
      <points geometry={geo}>
        <pointsMaterial size={0.08} color={new THREE.Color('#ffe2a0').multiplyScalar(2)} toneMapped={false} transparent opacity={0.9} />
      </points>
    </>
  );
}
