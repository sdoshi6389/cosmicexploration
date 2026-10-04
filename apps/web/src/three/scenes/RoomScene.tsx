import type { B4WindowView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { useWorld } from '../../state/world';
import { Label } from '../common/Label';

/**
 * Everyday scale for B4: a room lit through an electrochromic window. Window tint
 * comes from the film material and the modelled transmission; the sunbeam, floor
 * light pool and room exposure scale with the authoritative room illuminance.
 */
const W = 6, H = 3, D = 5;
const WIN = { w: 2.4, h: 1.5, y: 1.6 };

export function RoomScene() {
  const { output: v, pulse } = useLevelView<{ window: B4WindowView | null }>('b4');
  const select = useUi((s) => s.select);
  const goTo = useUi((s) => s.goTo);
  const ivs = useWorld((s) => s.interventions);
  const win = v?.window ?? null;
  const T = win?.transmission ?? 0.8;
  const lux = win?.roomLux ?? 600;
  const tint = win?.material.tintHex ?? '#9fc4e8';

  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9dde6', roughness: 0.9 }), []);
  const floorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a7060', roughness: 0.7 }), []);
  const glassMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: tint, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0, transmission: 0 }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { k: { value: 0.5 }, time: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform float k; uniform float time; varying vec2 vUv; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
          void main(){ float edge = smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x); float fall = mix(1.0, 0.35, vUv.y);
          float dust = step(0.997, h(floor(vUv*vec2(140.0,90.0)) + floor(time*3.0))) * 0.8; gl_FragColor = vec4(vec3(1.0,0.93,0.78)*(edge*fall*0.18 + dust*edge)*k, edge*fall*0.25*k); }`,
      }),
    [],
  );
  const poolMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { k: { value: 0.5 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform float k; varying vec2 vUv; void main(){ vec2 p = abs(vUv-0.5)*2.0; float a = (1.0-smoothstep(0.75,1.0,p.x))*(1.0-smoothstep(0.7,1.0,p.y)); gl_FragColor = vec4(vec3(1.0,0.92,0.75)*a*k, a*k); }`,
      }),
    [],
  );

  const sun = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const cur = useRef({ T, exposure: 0.5 });
  useFrame((state, dt) => {
    const k = Math.min(1, dt * 2.5);
    cur.current.T += (T - cur.current.T) * k;
    const exposure = Math.min(1.4, Math.log10(1 + lux) / Math.log10(1 + 1500));
    cur.current.exposure += (exposure - cur.current.exposure) * k;
    glassMat.color.set(tint);
    glassMat.opacity = 0.12 + 0.75 * (1 - cur.current.T);
    beamMat.uniforms.k!.value = cur.current.T * 2.2;
    beamMat.uniforms.time!.value = state.clock.elapsedTime;
    poolMat.uniforms.k!.value = cur.current.exposure * 0.9;
    if (sun.current) sun.current.intensity = 6 * cur.current.T;
    if (amb.current) amb.current.intensity = 0.08 + 0.55 * cur.current.exposure;
  });
  void pulse;

  const windowIv = ivs.find((i) => i.kind === 'b4.window');
  const pickWindow = () => windowIv && select({ kind: 'intervention', id: windowIv.id, label: windowIv.label, level: 'b4' });
  // Sun enters through the back-wall window (z = -D/2) and lands on the floor.
  const beamGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const a = [-WIN.w / 2, WIN.y + WIN.h / 2, -D / 2], b = [WIN.w / 2, WIN.y + WIN.h / 2, -D / 2];
    const c = [WIN.w / 2 + 0.4, 0.01, 1.2], d = [-WIN.w / 2 + 0.4, 0.01, 1.2];
    const e = [-WIN.w / 2, WIN.y - WIN.h / 2, -D / 2], f = [WIN.w / 2, WIN.y - WIN.h / 2, -D / 2];
    const g2 = [WIN.w / 2 + 0.4, 0.01, 0.0], h2 = [-WIN.w / 2 + 0.4, 0.01, 0.0];
    const pos = [...a, ...b, ...c, ...a, ...c, ...d, ...e, ...f, ...g2, ...e, ...g2, ...h2];
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }, []);

  return (
    <group>
      <color attach="background" args={['#0a1020']} />
      <ambientLight ref={amb} intensity={0.3} color="#cfd8ff" />
      <directionalLight ref={sun} position={[0.6, 4.5, -8]} intensity={4} color="#fff1d6" />
      <hemisphereLight args={['#9fc4ff', '#2a1a10', 0.15]} />
      {/* floor, ceiling, walls (back wall with a window opening) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={floorMat}><planeGeometry args={[W, D]} /></mesh>
      <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]} material={wallMat}><planeGeometry args={[W, D]} /></mesh>
      <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={wallMat}><planeGeometry args={[D, H]} /></mesh>
      <mesh position={[0, (WIN.y - WIN.h / 2) / 2, -D / 2]} material={wallMat}><planeGeometry args={[W, WIN.y - WIN.h / 2]} /></mesh>
      <mesh position={[0, (H + WIN.y + WIN.h / 2) / 2, -D / 2]} material={wallMat}><planeGeometry args={[W, H - (WIN.y + WIN.h / 2)]} /></mesh>
      <mesh position={[-(W + WIN.w) / 4, WIN.y, -D / 2]} material={wallMat}><planeGeometry args={[(W - WIN.w) / 2, WIN.h]} /></mesh>
      <mesh position={[(W + WIN.w) / 4, WIN.y, -D / 2]} material={wallMat}><planeGeometry args={[(W - WIN.w) / 2, WIN.h]} /></mesh>
      {/* sky outside */}
      <mesh position={[0, WIN.y, -D / 2 - 3]}><planeGeometry args={[12, 7]} /><meshBasicMaterial color="#8ec5ff" toneMapped={false} /></mesh>
      {/* the electrochromic pane */}
      <mesh position={[0, WIN.y, -D / 2 + 0.01]} material={glassMat} onClick={(e) => { e.stopPropagation(); pickWindow(); }}>
        <planeGeometry args={[WIN.w, WIN.h]} />
      </mesh>
      <mesh geometry={beamGeo} material={beamMat} />
      <mesh position={[0.4, 0.012, 0.6]} rotation={[-Math.PI / 2, 0, 0]} material={poolMat}><planeGeometry args={[WIN.w + 0.6, 1.6]} /></mesh>
      {/* desk + book */}
      <group position={[1.4, 0, 0.4]}>
        <mesh position={[0, 0.74, 0]}><boxGeometry args={[1.4, 0.05, 0.7]} /><meshStandardMaterial color="#5a4030" /></mesh>
        {[[-0.62, -0.3], [0.62, -0.3], [-0.62, 0.3], [0.62, 0.3]].map(([x, z], i) => (
          <mesh key={i} position={[x!, 0.37, z!]}><boxGeometry args={[0.05, 0.74, 0.05]} /><meshStandardMaterial color="#3a2a20" /></mesh>
        ))}
        <mesh position={[0.1, 0.785, 0]} rotation={[0, 0.3, 0]}><boxGeometry args={[0.32, 0.03, 0.22]} /><meshStandardMaterial color="#e8e2d0" /></mesh>
      </group>
      <Label position={[0, WIN.y + WIN.h / 2 + 0.35, -D / 2 + 0.05]} tone="accent" size="md" force>
        {win ? `${win.material.id} film · x ${win.x.toFixed(3)} · transmission ${(win.transmission * 100).toFixed(1)}%` : 'Ordinary glass · add a b4.window intervention'}
      </Label>
      {/* ceiling lamp: on when daylight falls short of 300 lx (the model's lamp power) */}
      <mesh position={[0.8, H - 0.08, 0.4]}>
        <cylinderGeometry args={[0.35, 0.35, 0.05, 32]} />
        <meshBasicMaterial color={lux < 300 ? new THREE.Color('#ffe2a0').multiplyScalar(1.5 + (300 - lux) / 150) : new THREE.Color('#555')} toneMapped={lux >= 300} />
      </mesh>
      {lux < 300 ? <pointLight position={[0.8, H - 0.3, 0.4]} intensity={(300 - lux) / 40} distance={8} color="#ffd890" /> : null}
      {win ? (
        <Label position={[0.8, H - 0.35, 0.4]} tone="muted" force>
          lamps {Math.round(win.room.lightingW)} W · cooling {Math.round(win.room.coolingW)} W (solar gain {Math.round(win.room.heatGainW)} W)
        </Label>
      ) : null}
      <Label position={[1.4, 1.15, 0.4]} tone={lux >= 300 ? 'accent' : 'amber'} size="md" force>
        {Math.round(lux)} lx at the desk · {lux >= 300 ? 'enough to read' : lux >= 100 ? 'dim' : 'dark'}
      </Label>
      <mesh position={[-1.6, WIN.y, -D / 2 + 0.05]} onClick={(e) => { e.stopPropagation(); goTo('lattice'); }}>
        <circleGeometry args={[0.14, 32]} />
        <meshBasicMaterial color="#b48cff" transparent opacity={0.4} />
      </mesh>
      <Label position={[-1.6, WIN.y - 0.25, -D / 2 + 0.05]} tone="violet" force>⊕ zoom into the film lattice</Label>
    </group>
  );
}
