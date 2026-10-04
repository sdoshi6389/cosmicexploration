import type { B6DeviceView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { si } from '../../lib/format';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { useWorld } from '../../state/world';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';

/**
 * Everyday scale for B6: positron trap → annihilation calorimeter → converter →
 * lamps. Calorimeter glow follows heat, cable flow follows electrical power, and the
 * number of lamps lit is the model's lit fraction. Gross vs net is shown explicitly.
 */
export function DeviceScene() {
  const { output: v } = useLevelView<{ device: B6DeviceView | null }>('b6');
  const select = useUi((s) => s.select);
  const goTo = useUi((s) => s.goTo);
  const ivs = useWorld((s) => s.interventions);
  const d = v?.device ?? null;
  const lights = d?.lightCount ?? 8;
  const lit = d ? Math.round(d.litFraction * d.lightCount) : 0;
  const heat = d ? Math.min(1, Math.log10(1 + d.heatW) / 6) : 0;
  const flow = d ? Math.min(1, Math.log10(1 + d.electricalW) / 5) : 0;
  const rate = d ? Math.min(1, Math.log10(d.eventRatePerS) / 18) : 0.2;

  const coreMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2f3a', emissive: new THREE.Color('#ff5a2a'), emissiveIntensity: 0, roughness: 0.4, metalness: 0.6 }), []);
  const cable = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(0.9, 0.5, 0), new THREE.Vector3(1.8, 0.1, 0.2), new THREE.Vector3(2.4, 0.05, 0.6), new THREE.Vector3(2.6, 0.05, 1.6)]), []);
  const cableGeo = useMemo(() => new THREE.TubeGeometry(cable, 40, 0.035, 8, false), [cable]);
  const flowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    return g;
  }, []);
  // Annihilation flashes inside the calorimeter (rate-scaled, purely illustrative sampling).
  const flashGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(60), 1));
    return g;
  }, []);
  const flashMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aLife; varying float vL; void main(){ vL = aLife; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = 26.0*aLife*(6.0/-mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying float vL; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard; gl_FragColor = vec4(vec3(0.75,0.85,1.0)*(1.0-r)*2.0*vL, (1.0-r)*vL); }`,
      }),
    [],
  );
  const flashes = useMemo(() => Array.from({ length: 60 }, () => ({ p: new THREE.Vector3(), life: 0 })), []);
  const ring = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    coreMat.emissiveIntensity += (heat * 3 - coreMat.emissiveIntensity) * Math.min(1, dt * 2);
    if (ring.current) ring.current.rotation.y += dt * (0.4 + rate * 2.5);
    const fp = flowGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 40; i++) {
      const u = (i / 40 + t * 0.25 * (0.2 + flow * 2)) % 1;
      const p = cable.getPointAt(u);
      fp.setXYZ(i, p.x, p.y + 0.05, p.z);
    }
    fp.needsUpdate = true;
    const pos = flashGeo.getAttribute('position') as THREE.BufferAttribute;
    const life = flashGeo.getAttribute('aLife') as THREE.BufferAttribute;
    flashes.forEach((f, i) => {
      f.life -= dt * 3;
      if (f.life <= 0 && Math.random() < rate * 0.35) {
        f.life = 1;
        f.p.set((Math.random() - 0.5) * 0.7, 0.5 + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7);
      }
      pos.setXYZ(i, f.p.x, f.p.y, f.p.z);
      life.setX(i, Math.max(0, f.life));
    });
    pos.needsUpdate = true;
    life.needsUpdate = true;
  });

  const deviceIv = ivs.find((i) => i.kind === 'b6.device');
  const pick = () => deviceIv && select({ kind: 'intervention', id: deviceIv.id, label: deviceIv.label, level: 'b6' });
  const cols = Math.min(8, lights);
  const lampPos = (i: number): [number, number, number] => [2.2 + (i % cols) * 0.42 - (cols * 0.42) / 2 + 0.8, 0.05, 1.9 + Math.floor(i / cols) * 0.5];

  return (
    <group>
      <SkySphere brightness={0.2} />
      <ambientLight intensity={0.25} />
      <pointLight position={[3, 5, 4]} intensity={60} color="#cfe0ff" />
      <pointLight position={[0, 0.6, 0]} intensity={heat * 25} color="#ff7a3a" distance={6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.8, 0, 0.8]}><planeGeometry args={[9, 7]} /><meshStandardMaterial color="#1a1f2a" roughness={0.9} /></mesh>
      {/* calorimeter core */}
      <mesh position={[0, 0.5, 0]} material={coreMat} onClick={(e) => { e.stopPropagation(); pick(); }}>
        <cylinderGeometry args={[0.55, 0.55, 1, 48, 1, true]} />
      </mesh>
      <mesh position={[0, 1.02, 0]}><cylinderGeometry args={[0.58, 0.58, 0.04, 48]} /><meshStandardMaterial color="#444b58" metalness={0.8} roughness={0.3} /></mesh>
      <points geometry={flashGeo} material={flashMat} />
      {/* positron trap: magnet rings feeding the core */}
      <group ref={ring} position={[-1.5, 0.5, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[i * 0.28 - 0.28, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.3, 0.06, 12, 40]} />
            <meshStandardMaterial color="#5ce1ff" emissive="#5ce1ff" emissiveIntensity={0.4 + rate} metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
      </group>
      <mesh position={[-0.75, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.06, 0.06, 0.9, 12]} /><meshStandardMaterial color="#7aa0c8" metalness={0.8} /></mesh>
      {/* converter → cable → lamps */}
      <mesh geometry={cableGeo}><meshStandardMaterial color="#20252e" /></mesh>
      <points geometry={flowGeo}><pointsMaterial size={0.09} color={new THREE.Color('#ffcf5c').multiplyScalar(2)} toneMapped={false} transparent opacity={0.3 + flow * 0.7} /></points>
      {Array.from({ length: lights }, (_, i) => {
        const on = i < lit;
        const p = lampPos(i);
        return (
          <group key={i} position={p}>
            <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.02, 0.02, 0.4, 8]} /><meshStandardMaterial color="#333" /></mesh>
            <mesh position={[0, 0.45, 0]}>
              <sphereGeometry args={[0.09, 20, 16]} />
              <meshBasicMaterial color={on ? new THREE.Color('#ffe2a0').multiplyScalar(2.5) : new THREE.Color('#2a2a2a')} toneMapped={!on} />
            </mesh>
            {on && i < 6 ? <pointLight position={[0, 0.45, 0]} intensity={2.5} distance={1.6} color="#ffd890" /> : null}
          </group>
        );
      })}
      <Label position={[0, 1.55, 0]} tone="accent" size="md" force>
        {d ? `gross ${si(d.grossW, 'W', 2)} · electric ${si(d.electricalW, 'W', 2)} · heat ${si(d.heatW, 'W', 2)}` : 'Idle cell · add a b6.device intervention'}
      </Label>
      <Label position={[0, 1.3, 0]} tone={d && d.netW < 0 ? 'amber' : 'muted'} force>
        {d ? `positron supply ${si(d.supplyInputW, 'W', 2)} → net ${si(d.netW, 'W', 2)} · ${d.eventRatePerS.toExponential(1)} events/s` : 'trap → calorimeter → converter → lamps'}
      </Label>
      <Label position={[2.6, 1.0, 2.0]} tone={lit === lights && lights > 0 ? 'accent' : 'amber'} force>
        {lit}/{lights} lamps lit{d ? ` · demand ${si(d.loadW, 'W', 2)}` : ''}
      </Label>
      <mesh position={[0, 0.5, 0.75]} onClick={(e) => { e.stopPropagation(); goTo('particle'); }}>
        <circleGeometry args={[0.12, 32]} />
        <meshBasicMaterial color="#b48cff" transparent opacity={0.45} />
      </mesh>
      <Label position={[0, 0.2, 0.75]} tone="violet" force>⊕ zoom into one annihilation</Label>
    </group>
  );
}
