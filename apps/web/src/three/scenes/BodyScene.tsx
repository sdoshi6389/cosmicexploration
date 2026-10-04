import type { B2BodyView } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { useWorld } from '../../state/world';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';

/**
 * Everyday scale for B2: a translucent body whose circulation is driven by the
 * authoritative oxygen-delivery model (heart rate ∝ cardiac compensation, flow
 * colour ∝ oxygen saturation, tissue glow ∝ delivery, sickled cells as jagged particles).
 */

const glassMat = () =>
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: new THREE.Color('#7fb8ff') }, glow: { value: 0.6 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 tint; uniform float glow; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 2.2); gl_FragColor = vec4(tint*(0.05+f*glow*1.6), 0.05+f*0.55); }`,
  });

/** Simplified body parts (centre, radius, half-length, rotation z). */
const PARTS: [number, number, number, number, number, number][] = [
  [0, 2.55, 0, 0.32, 0.05, 0], // head
  [0, 1.65, 0, 0.42, 0.42, 0], // torso
  [0, 0.95, 0, 0.36, 0.18, 0], // pelvis
  [-0.62, 1.7, 0, 0.11, 0.42, 0.18], [0.62, 1.7, 0, 0.11, 0.42, -0.18], // upper arms
  [-0.8, 0.95, 0, 0.09, 0.38, 0.08], [0.8, 0.95, 0, 0.09, 0.38, -0.08], // forearms
  [-0.22, 0.25, 0, 0.14, 0.45, 0.02], [0.22, 0.25, 0, 0.14, 0.45, -0.02], // thighs
  [-0.25, -0.75, 0, 0.11, 0.45, 0], [0.25, -0.75, 0, 0.11, 0.45, 0], // shins
];

const HEART = new THREE.Vector3(0.1, 1.85, 0.12);

/** Main vessel paths from the heart (arteries) — flow particles travel along them. */
function vesselCurves(): THREE.CatmullRomCurve3[] {
  const P = (x: number, y: number, z = 0.05) => new THREE.Vector3(x, y, z);
  const paths = [
    [HEART, P(0, 2.2), P(0, 2.55, 0.1)], // carotid → head
    [HEART, P(-0.35, 2.05), P(-0.62, 1.9), P(-0.78, 1.25), P(-0.86, 0.6)], // left arm
    [HEART, P(0.35, 2.05), P(0.62, 1.9), P(0.78, 1.25), P(0.86, 0.6)], // right arm
    [HEART, P(0, 1.4), P(-0.05, 0.95), P(-0.22, 0.3), P(-0.25, -0.6), P(-0.27, -1.15)], // left leg
    [HEART, P(0, 1.4), P(0.05, 0.95), P(0.22, 0.3), P(0.25, -0.6), P(0.27, -1.15)], // right leg
    [HEART, P(-0.2, 1.6), P(-0.25, 1.75, 0.15), HEART], // lung loop L
    [HEART, P(0.28, 1.6), P(0.3, 1.78, 0.15), HEART], // lung loop R
  ];
  return paths.map((p) => new THREE.CatmullRomCurve3(p, false, 'catmullrom', 0.4));
}

export function BodyScene() {
  const { output: body, pulse } = useLevelView<B2BodyView>('b2');
  const select = useUi((s) => s.select);
  const goTo = useUi((s) => s.goTo);
  const allIvs = useWorld((s) => s.interventions);
  const ivs = useMemo(() => allIvs.filter((i) => i.level === 'b2'), [allIvs]);
  const delivery = body?.oxygenDeliveryRelative ?? 1;
  const sickled = body?.sickledFraction ?? 0;
  const cardiac = body?.cardiacOutputFactor ?? 1;
  const tissue = body?.tissueOxygenation ?? 1;

  const glass = useMemo(glassMat, []);
  const curves = useMemo(vesselCurves, []);
  const vesselGeo = useMemo(() => curves.map((c) => new THREE.TubeGeometry(c, 48, 0.018, 6, false)), [curves]);
  const vesselMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff4a5c', transparent: true, opacity: 0.55, toneMapped: false }), []);

  // Flow particles: N per curve, colour by saturation, jagged (sickled) fraction rendered larger/darker.
  const N = 70;
  const total = N * curves.length;
  const flowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: total }, (_, i) => (i * 0.61803) % 1), 1));
    return g;
  }, [total]);
  const flowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { sat: { value: 1 }, sick: { value: 0 } },
        vertexShader: `attribute float aSeed; uniform float sick; varying float vS; void main(){ vS = step(aSeed, sick); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = (vS > 0.5 ? 10.0 : 7.0) * (6.0 / -mv.z); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float sat; varying float vS; void main(){ vec2 p = gl_PointCoord-0.5; float r = length(p)*2.0; if(vS > 0.5){ float a = atan(p.y,p.x); r *= 1.0 + 0.45*abs(sin(a*1.5)); } if(r>1.0) discard;
          vec3 oxy = vec3(1.0,0.16,0.22); vec3 deo = vec3(0.35,0.18,0.75); vec3 c = mix(deo, oxy, sat); if(vS > 0.5) c *= 0.55; gl_FragColor = vec4(c*(1.4-r), 1.0-r); }`,
      }),
    [],
  );

  const heart = useRef<THREE.Mesh>(null);
  const tissueRef = useRef<THREE.ShaderMaterial>(glass);
  const t0 = useRef(0);
  const build = useRef(0);
  useEffect(() => {
    build.current = 0;
  }, [pulse]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    t0.current += dt * (1.1 * cardiac);
    build.current = Math.min(1, build.current + dt * 0.8);
    const beat = Math.pow(Math.max(0, Math.sin(t0.current * Math.PI * 2)), 6);
    heart.current?.scale.setScalar(1 + 0.18 * beat);
    const pos = flowGeo.getAttribute('position') as THREE.BufferAttribute;
    const speed = 0.12 * cardiac * Math.max(0.25, delivery);
    for (let c = 0; c < curves.length; c++) {
      for (let i = 0; i < N; i++) {
        const k = c * N + i;
        const u = (i / N + t * speed * (1 + (k % 5) * 0.03)) % 1;
        const p = curves[c]!.getPointAt(u);
        pos.setXYZ(k, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    flowMat.uniforms.sat!.value += (Math.min(1, delivery) - flowMat.uniforms.sat!.value) * Math.min(1, dt * 2);
    flowMat.uniforms.sick!.value += (sickled - flowMat.uniforms.sick!.value) * Math.min(1, dt * 2);
    const u = tissueRef.current.uniforms;
    (u.tint!.value as THREE.Color).lerp(new THREE.Color().setHSL(0.58 + (1 - Math.min(1, tissue)) * 0.15, 0.7, 0.55), Math.min(1, dt * 2));
    u.glow!.value = 0.35 + 0.65 * Math.min(1, tissue);
  });

  const selectEdit = () => {
    const iv = ivs.at(-1);
    if (iv) select({ kind: 'intervention', id: iv.id, label: iv.label, level: 'b2' });
  };

  return (
    <group>
      <SkySphere brightness={0.25} />
      <ambientLight intensity={0.3} />
      <pointLight position={[2, 4, 4]} intensity={30} color="#bcd7ff" />
      <group position={[0, -0.6, 0]}>
        {PARTS.map(([x, y, z, r, h, rz], i) => (
          <mesh key={i} position={[x, y, z]} rotation={[0, 0, rz]} material={glass}>
            {h > 0.06 ? <capsuleGeometry args={[r, h * 2, 8, 24]} /> : <sphereGeometry args={[r, 32, 24]} />}
          </mesh>
        ))}
        {vesselGeo.map((g, i) => <mesh key={i} geometry={g} material={vesselMat} />)}
        <points geometry={flowGeo} material={flowMat} />
        <mesh ref={heart} position={HEART} onClick={(e) => { e.stopPropagation(); selectEdit(); }}>
          <sphereGeometry args={[0.12, 32, 24]} />
          <meshBasicMaterial color={new THREE.Color('#ff3b55').multiplyScalar(1.6)} toneMapped={false} />
        </mesh>
        <Label position={[0.9, 2.3, 0]} tone={delivery < 0.9 ? 'amber' : 'accent'} size="md" force>
          O₂ delivery {(delivery * 100).toFixed(0)}% · Hb {(body?.hemoglobinGdl ?? 14).toFixed(1)} g/dL
        </Label>
        <Label position={[0.9, 2.05, 0]} tone="muted" force>
          {body ? `${body.phenotype.replace('_', ' ')} · sickled ${(sickled * 100).toFixed(0)}% · heart ${cardiac.toFixed(2)}×` : 'reference HBB · no edit on this branch'}
        </Label>
        <mesh position={[-1.25, 1.0, 0]} onClick={(e) => { e.stopPropagation(); goTo('cell'); }}>
          <circleGeometry args={[0.16, 32]} />
          <meshBasicMaterial color="#b48cff" transparent opacity={0.35} />
        </mesh>
        <Label position={[-1.25, 1.0, 0]} tone="violet" force>⊕ zoom into blood → cell → gene</Label>
      </group>
    </group>
  );
}
