import { Line } from '@react-three/drei';
import { createRng, type B6DeviceView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { si } from '../../lib/format';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';

/**
 * B6 human scale: a city at night powered by annihilation reactors. Districts light
 * up in order until reactor output meets demand; the rest black out. Reactors glow
 * with their event rate; power flows along the transmission lines.
 */
const SECTORS = 10;
const BLDG = 520;

export function GridScene() {
  const { output: v } = useLevelView<{ device: B6DeviceView | null }>('b6');
  const goTo = useUi((s) => s.goTo);
  const select = useUi((s) => s.select);
  const d = v?.device ?? null;
  const lit = d?.city ? d.city.litFraction : d ? Math.min(1, d.litFraction) : 0;
  const reactors = Math.min(8, d?.units ?? 1);
  const rate = d ? Math.min(1, Math.log10(d.eventRatePerS * d.units) / 22) : 0;

  const bldgs = useMemo(() => {
    const rnd = createRng(606);
    return Array.from({ length: BLDG }, () => {
      const r = 3 + Math.sqrt(rnd()) * 26;
      const a = rnd() * Math.PI * 2;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, h: 0.6 + rnd() * 3 + Math.max(0, 14 - r) * 0.35 * rnd(), w: 0.8 + rnd() * 0.9, sector: Math.floor(((a / (Math.PI * 2)) % 1) * SECTORS), seed: rnd() };
    });
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const o = new THREE.Object3D();
    bldgs.forEach((b, i) => {
      o.position.set(b.x, b.h / 2, b.z);
      o.scale.set(b.w, b.h, b.w);
      o.updateMatrix();
      ref.current?.setMatrixAt(i, o.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [bldgs]);
  // District colouring: sectors lit in order (index < lit × SECTORS).
  const shown = useRef(0);
  useFrame((s, dt) => {
    shown.current += (lit - shown.current) * Math.min(1, dt * 2);
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    bldgs.forEach((b, i) => {
      const on = b.sector < shown.current * SECTORS - 1e-6 || (b.sector < shown.current * SECTORS + 1 && b.seed < (shown.current * SECTORS) % 1);
      const flicker = on ? 0.85 + 0.15 * Math.sin(s.clock.elapsedTime * 3 + b.seed * 40) : 0;
      c.setRGB(1.0 * flicker + 0.03, 0.78 * flicker + 0.03, 0.45 * flicker + 0.05);
      m.setColorAt(i, c);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  const reactorPos = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    return new THREE.Vector3(Math.cos(a) * 36, 0, Math.sin(a) * 36);
  }), []);
  const cores = useRef<THREE.Group>(null);
  useFrame((s) => {
    cores.current?.children.forEach((c, i) => {
      const k = 0.6 + 0.4 * Math.sin(s.clock.elapsedTime * (2 + rate * 10) + i);
      c.scale.setScalar(0.8 + rate * 0.6 * k);
    });
  });

  return (
    <group>
      <SkySphere brightness={0.25} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[-20, 30, 10]} intensity={0.35} color="#7ea8ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[70, 96]} /><meshStandardMaterial color="#0b0f16" roughness={1} /></mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, BLDG]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <group ref={cores}>
        {reactorPos.slice(0, reactors).map((p, i) => (
          <group key={i} position={p} onClick={(e) => { e.stopPropagation(); select({ kind: 'reactor', id: `reactor.${i}`, label: `Reactor ${i + 1}`, level: 'b6' }); goTo('device'); }}>
            <mesh position={[0, 1.2, 0]}>
              <sphereGeometry args={[2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#3a4250" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh position={[0, 1.6, 0]}>
              <sphereGeometry args={[0.9, 24, 16]} />
              <meshBasicMaterial color={new THREE.Color('#b48cff').multiplyScalar(1.5 + rate * 2)} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>
      {reactorPos.slice(0, reactors).map((p, i) => (
        <Line key={i} points={[[p.x, 0.4, p.z], [p.x * 0.5, 2.5, p.z * 0.5], [0, 0.4, 0]]} color={lit > 0 ? '#ffcf5c' : '#334'} lineWidth={2} transparent opacity={0.6} dashed dashSize={0.8} gapSize={0.4} />
      ))}
      <Label position={[0, 16, 0]} tone="accent" size="lg" force>
        {d?.city ? `${d.city.households.toLocaleString()} households · ${(d.city.litFraction * 100).toFixed(0)}% of districts lit` : d ? 'Reactor running · add a city grid to connect households' : 'Dark city · zoom into a reactor to build it'}
      </Label>
      <Label position={[0, 13.8, 0]} tone={d && d.netW < 0 ? 'amber' : 'muted'} force>
        {d ? `${d.units} × ${d.species === 'proton' ? 'p p̄' : 'e⁺e⁻'} reactor · electric ${si(d.electricalW, 'W', 2)}${d.city ? ` vs demand ${si(d.city.demandW, 'W', 2)}` : ''} · antimatter production costs ${si(d.supplyInputW, 'W', 2)} → net ${si(d.netW, 'W', 2)}` : 'click a reactor dome (or scroll in) to go inside'}
      </Label>
    </group>
  );
}
