import { createRng, type B2BodyView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';

/**
 * B2 human scale: a community whose members carry the branch's edited HBB genome.
 * Each figure is one sampled person: the edited fraction comes from the population
 * intervention, colour/pace from the modelled phenotype and oxygen delivery.
 */
const HOUSES = 70;
const PEOPLE = 360;

export function TownScene() {
  const { output: v, pulse } = useLevelView<B2BodyView>('b2');
  const goTo = useUi((s) => s.goTo);
  const select = useUi((s) => s.select);
  const pop = v?.population;
  const f = pop?.editedFraction ?? 0;
  const delivery = v?.oxygenDeliveryRelative ?? 1;
  const severe = (pop?.symptomatic ?? 0) > 0;
  const carriers = (pop?.carriers ?? 0) > 0;
  const editedNormal = v && v.mutations.length > 0 && v.phenotype === 'normal';

  const layout = useMemo(() => {
    const rnd = createRng(2024);
    const houses = Array.from({ length: HOUSES }, (_, i) => {
      const ring = 8 + (i % 4) * 5 + rnd() * 2;
      const a = (i / HOUSES) * Math.PI * 2 * 4 + rnd() * 0.3;
      return { x: Math.cos(a) * ring, z: Math.sin(a) * ring, h: 1.2 + rnd() * 1.8, w: 1.6 + rnd() * 1.2, rot: a };
    });
    const people = Array.from({ length: PEOPLE }, () => ({ r: 4 + rnd() * 22, a: rnd() * Math.PI * 2, speed: 0.04 + rnd() * 0.06, dir: rnd() < 0.5 ? -1 : 1, order: rnd(), bob: rnd() * 10 }));
    return { houses, people };
  }, []);

  const houseRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const d = new THREE.Object3D();
    layout.houses.forEach((h, i) => {
      d.position.set(h.x, h.h / 2, h.z);
      d.rotation.set(0, -h.rot, 0);
      d.scale.set(h.w, h.h, h.w);
      d.updateMatrix();
      houseRef.current?.setMatrixAt(i, d.matrix);
      d.position.set(h.x, h.h + 0.55, h.z);
      d.scale.set(h.w * 0.78, 1.1, h.w * 0.78);
      d.rotation.set(0, -h.rot + Math.PI / 4, 0);
      d.updateMatrix();
      roofRef.current?.setMatrixAt(i, d.matrix);
    });
    if (houseRef.current) houseRef.current.instanceMatrix.needsUpdate = true;
    if (roofRef.current) roofRef.current.instanceMatrix.needsUpdate = true;
  }, [layout]);

  // Person state: edited people (by deterministic order) take the modelled phenotype.
  const peopleRef = useRef<THREE.InstancedMesh>(null);
  const colors = useMemo(() => {
    const c = new THREE.Color();
    return layout.people.map((p) => {
      const edited = p.order < f;
      if (!edited) return c.set('#5ce1ff').clone();
      if (severe) return c.set('#ff5f7a').clone();
      if (carriers) return c.set('#ffb547').clone();
      if (editedNormal) return c.set('#b48cff').clone();
      return c.set('#5ce1ff').clone();
    });
  }, [layout, f, severe, carriers, editedNormal]);
  useEffect(() => {
    const m = peopleRef.current;
    if (!m) return;
    colors.forEach((c, i) => m.setColorAt(i, c));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [colors]);

  const d = useMemo(() => new THREE.Object3D(), []);
  const flash = useRef(0);
  useEffect(() => {
    flash.current = 1;
  }, [pulse]);
  useFrame((state, dt) => {
    const m = peopleRef.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    flash.current = Math.max(0, flash.current - dt * 0.7);
    layout.people.forEach((p, i) => {
      const edited = p.order < f;
      // Pace follows oxygen delivery; severely affected people rest more often.
      const pace = edited ? Math.max(0.15, delivery) : 1;
      const resting = edited && severe && Math.sin(t * 0.3 + p.bob) > 0.4;
      if (!resting) p.a += dt * p.speed * pace * p.dir * (6 / p.r);
      const y = resting ? 0.25 : 0.55 + Math.abs(Math.sin(t * 6 * pace + p.bob)) * 0.08 * pace;
      d.position.set(Math.cos(p.a) * p.r, y, Math.sin(p.a) * p.r);
      d.rotation.set(resting ? Math.PI / 2.4 : 0, -p.a, 0);
      d.scale.setScalar(1 + flash.current * (edited ? 0.6 : 0));
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  const groundMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; void main(){ float r = length(vP.xy); vec2 g = abs(fract(vP.xy*0.25)-0.5); float line = smoothstep(0.48,0.5,max(g.x,g.y));
          vec3 c = mix(vec3(0.05,0.09,0.12), vec3(0.08,0.16,0.18), smoothstep(40.0, 0.0, r)) + line*0.04; float path = smoothstep(0.35,0.0,abs(fract(r/5.0)-0.5)-0.3)*0.05; gl_FragColor = vec4(c+path, 1.0); }`,
      }),
    [],
  );

  return (
    <group>
      <SkySphere brightness={0.35} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 30, 10]} intensity={2.2} color="#fff2dd" />
      <hemisphereLight args={['#9fc4ff', '#1a2a20', 0.5]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={groundMat}><circleGeometry args={[40, 96]} /></mesh>
      <instancedMesh ref={houseRef} args={[undefined, undefined, HOUSES]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#d8dde8" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={roofRef} args={[undefined, undefined, HOUSES]}>
        <coneGeometry args={[0.75, 1, 4]} />
        <meshStandardMaterial color="#8a4a3a" roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        ref={peopleRef} args={[undefined, undefined, PEOPLE]}
        onClick={(e) => {
          e.stopPropagation();
          select({ kind: 'person', id: `person.${e.instanceId}`, label: `Resident #${e.instanceId}`, level: 'b2' });
          goTo('body');
        }}
      >
        <capsuleGeometry args={[0.16, 0.5, 4, 8]} />
        <meshStandardMaterial roughness={0.5} emissive="#111" toneMapped={false} />
      </instancedMesh>
      <Label position={[0, 9, 0]} tone="accent" size="lg" force>
        {pop ? `${pop.size.toLocaleString()} people · ${(f * 100).toFixed(0)}% carry the edit` : 'Reference community · no genome edits on this branch'}
      </Label>
      <Label position={[0, 7.6, 0]} tone={severe ? 'amber' : 'muted'} force>
        {v ? `mean O₂ delivery ${(pop!.meanOxygenDelivery * 100).toFixed(0)}% · ${pop!.symptomatic.toLocaleString()} symptomatic · ${pop!.carriers.toLocaleString()} carriers · phenotype ${v.phenotype.replace('_', ' ')}` : 'cyan: reference HBB · scroll in (or click a person) to reach their genes'}
      </Label>
      <Label position={[0, 6.4, 0]} tone="muted" force>
        {PEOPLE} sampled residents shown · red = symptomatic · amber = carrier · violet = edited, no effect · cyan = reference
      </Label>
    </group>
  );
}
