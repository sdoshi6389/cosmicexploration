import { createRng, type B4WindowView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { si } from '../../lib/format';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';

/**
 * B4 human scale: a city whose every window carries the branch's film. Façade glass
 * takes the film tint and transmission; interiors glow when lamps are needed
 * (room below 300 lx); rooftop chillers pulse with the cooling load.
 */
const GRID = 14;
const SUN = new THREE.Vector3(0.5, 0.75, 0.35).normalize();

export function CityScene() {
  const { output: v } = useLevelView<{ window: B4WindowView | null }>('b4');
  const goTo = useUi((s) => s.goTo);
  const select = useUi((s) => s.select);
  const w = v?.window ?? null;
  const T = w?.transmission ?? 0.8;
  const lamps = w ? Math.max(0, 300 - w.roomLux) / 300 : 0;
  const cool = w ? Math.min(1, w.room.coolingW / 400) : 0.3;
  const tint = new THREE.Color(w?.material.tintHex ?? '#7fa8d8');

  const buildings = useMemo(() => {
    const rnd = createRng(77);
    const out: { x: number; z: number; w: number; d: number; h: number }[] = [];
    for (let i = 0; i < GRID; i++)
      for (let j = 0; j < GRID; j++) {
        const cx = (i - GRID / 2) * 4.2;
        const cz = (j - GRID / 2) * 4.2;
        const dist = Math.hypot(cx, cz);
        const h = 2 + rnd() * 6 + Math.max(0, 22 - dist) * 0.55 * rnd();
        out.push({ x: cx + (rnd() - 0.5), z: cz + (rnd() - 0.5), w: 2 + rnd() * 1.4, d: 2 + rnd() * 1.4, h });
      }
    return out;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { tint: { value: new THREE.Color() }, T: { value: 0.8 }, lamps: { value: 0 }, sun: { value: SUN }, time: { value: 0 } },
        vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `uniform vec3 tint; uniform float T; uniform float lamps; uniform vec3 sun; uniform float time; varying vec3 vW; varying vec3 vN;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
          void main(){
            float diff = max(dot(normalize(vN), sun), 0.0);
            vec3 wall = vec3(0.62,0.66,0.72) * (0.25 + 0.75*diff);
            if (abs(vN.y) > 0.5) { gl_FragColor = vec4(vec3(0.32,0.34,0.38)*(0.4+0.6*diff), 1.0); return; }
            vec2 f = vec2(abs(vN.x) > 0.5 ? vW.z : vW.x, vW.y) * vec2(1.6, 1.25);
            vec2 g = fract(f); vec2 cell = floor(f);
            float win = step(0.18, g.x) * step(g.x, 0.82) * step(0.22, g.y) * step(g.y, 0.86);
            // Glass: dark tinted film reflects sky; clear glass shows the bright interior.
            vec3 sky = vec3(0.45,0.62,0.85);
            vec3 glass = mix(tint * 0.25, sky * 0.9, T) * (0.55 + 0.45*diff);
            float lit = step(h(cell), 0.85) * lamps;
            glass += vec3(1.0,0.78,0.45) * lit * 1.6;
            gl_FragColor = vec4(mix(wall, glass, win), 1.0);
          }`,
      }),
    [],
  );

  const ref = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const d = new THREE.Object3D();
    buildings.forEach((b, i) => {
      d.position.set(b.x, b.h / 2, b.z);
      d.scale.set(b.w, b.h, b.d);
      d.updateMatrix();
      ref.current?.setMatrixAt(i, d.matrix);
      d.position.set(b.x, b.h + 0.18, b.z);
      d.scale.set(0.6, 0.35, 0.6);
      d.updateMatrix();
      roofs.current?.setMatrixAt(i, d.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
    if (roofs.current) roofs.current.instanceMatrix.needsUpdate = true;
  }, [buildings]);

  const chillMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#5ce1ff', toneMapped: false }), []);
  useFrame((s) => {
    const u = mat.uniforms;
    (u.tint!.value as THREE.Color).lerp(tint, 0.08);
    u.T!.value += (T - u.T!.value) * 0.08;
    u.lamps!.value += (lamps - u.lamps!.value) * 0.08;
    u.time!.value = s.clock.elapsedTime;
    // Chillers: brighter + faster pulse with cooling load.
    const k = 0.5 + 0.5 * Math.sin(s.clock.elapsedTime * (2 + cool * 8));
    chillMat.color.setRGB(0.2 + cool * k, 0.5 + 0.3 * (1 - cool), 1 - cool * 0.7).multiplyScalar(1 + cool * 1.5);
  });

  return (
    <group>
      <SkySphere brightness={0.5} />
      <ambientLight intensity={0.4} />
      <directionalLight position={SUN.clone().multiplyScalar(60)} intensity={2.4} color="#fff1d6" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[60, 96]} />
        <meshStandardMaterial color="#1c222c" roughness={0.95} />
      </mesh>
      <instancedMesh
        ref={ref} args={[undefined, mat, buildings.length]}
        onClick={(e) => {
          e.stopPropagation();
          select({ kind: 'building', id: `building.${e.instanceId}`, label: `Building #${e.instanceId}`, level: 'b4' });
          goTo('room');
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[undefined, chillMat, buildings.length]}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <Label position={[0, 30, 0]} tone="accent" size="lg" force>
        {w ? `${w.city.rooms.toLocaleString()} rooms · ${w.material.id} film · transmission ${(w.transmission * 100).toFixed(1)}%` : 'Ordinary glass city · zoom into a room to engineer the window film'}
      </Label>
      <Label position={[0, 27.5, 0]} tone={w && w.city.savingW < 0 ? 'amber' : 'muted'} force>
        {w ? `city lighting ${si(w.city.lightingW, 'W', 2)} + cooling ${si(w.city.coolingW, 'W', 2)} = ${si(w.city.totalW, 'W', 2)} · ${w.city.savingW >= 0 ? 'saves' : 'costs'} ${si(Math.abs(w.city.savingW), 'W', 2)} vs reference film` : 'click a building (or scroll in) to enter a room'}
      </Label>
      <Label position={[0, 25, 0]} tone="muted" force>
        {w ? `each room: ${Math.round(w.roomLux)} lx daylight${w.roomLux < 300 ? ' → lamps on' : ''} · ${si(w.room.heatGainW, 'W', 2)} solar heat in` : `${GRID * GRID} buildings shown`}
      </Label>
    </group>
  );
}
