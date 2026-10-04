import type { B4Output } from '@cosmos/engine';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { wavelength } from '../../lib/format';
import { sampleOrbital } from '../../lib/hydrogen';
import { useLevelView } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { cameraRef } from '../Stage';
import { Label } from '../common/Label';
import { radialTexture } from './EarthScene';

const SCALE = 0.36; // scene units per Bohr radius

const cloudVert = /* glsl */ `
attribute vec3 aFrom; attribute float aSignFrom; attribute float aSign;
uniform float uMix; uniform float uTime;
varying vec3 vColor; varying float vA;
void main(){
  float m = smoothstep(0.0, 1.0, uMix);
  vec3 p = mix(aFrom, position, m);
  float s = mix(aSignFrom, aSign, step(0.5, m));
  vColor = s > 0.0 ? vec3(0.32, 0.86, 1.0) : vec3(1.0, 0.6, 0.25);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(34.0 / -mv.z, 1.0, 4.5);
  vA = 0.55 + 0.45 * sin(uTime * 1.3 + p.x * 0.7 + p.y * 0.5);
  gl_Position = projectionMatrix * mv;
}
`;
const cloudFrag = /* glsl */ `
varying vec3 vColor; varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = exp(-r * r * 3.5) * 0.55 * vA;
  gl_FragColor = vec4(vColor * a * 1.4, a);
}
`;

function photonColor(b4: B4Output): THREE.Color {
  if (b4.visibleColorHex) return new THREE.Color(b4.visibleColorHex);
  if (b4.band === 'uv' || b4.band === 'x-ray') return new THREE.Color('#a46bff');
  return new THREE.Color('#ff3b3b');
}

export function AtomScene() {
  const { output: b4, pulse, preview } = useLevelView<B4Output>('b4', (v) => (v as { transition: B4Output | null }).transition);
  const quality = useUi((s) => s.quality);
  const count = quality === 'high' ? 60000 : quality === 'medium' ? 34000 : 16000;
  const orbital = b4?.orbital ?? { n: 1, l: 0, m: 0, label: '1s', meanRadiusBohr: 1.5 };
  const initial = b4?.initial ?? { n: 1, l: 0 };

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const empty = new Float32Array(count * 3);
    g.setAttribute('position', new THREE.BufferAttribute(empty.slice(), 3));
    g.setAttribute('aFrom', new THREE.BufferAttribute(empty.slice(), 3));
    g.setAttribute('aSign', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    g.setAttribute('aSignFrom', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    return g;
  }, [count]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, uniforms: { uMix: { value: 1 }, uTime: { value: 0 } },
      }),
    [],
  );

  const morphStart = useRef(0);
  const shown = useRef<string>('');
  // On every orbital change: current cloud becomes aFrom, new sample becomes the target.
  useEffect(() => {
    const key = `${orbital.n}:${orbital.l}:${orbital.m}`;
    const target = sampleOrbital(orbital.n, orbital.l, orbital.m, count);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const from = geo.getAttribute('aFrom') as THREE.BufferAttribute;
    const sign = geo.getAttribute('aSign') as THREE.BufferAttribute;
    const signFrom = geo.getAttribute('aSignFrom') as THREE.BufferAttribute;
    if (!shown.current) {
      const init = sampleOrbital(initial.n, Math.min(initial.l, initial.n - 1), 0, count);
      for (let i = 0; i < count * 3; i++) (from.array as Float32Array)[i] = init.pos[i]! * SCALE;
      (signFrom.array as Float32Array).set(init.sign);
    } else {
      (from.array as Float32Array).set(pos.array as Float32Array);
      (signFrom.array as Float32Array).set(sign.array as Float32Array);
    }
    for (let i = 0; i < count * 3; i++) (pos.array as Float32Array)[i] = target.pos[i]! * SCALE;
    (sign.array as Float32Array).set(target.sign);
    pos.needsUpdate = from.needsUpdate = sign.needsUpdate = signFrom.needsUpdate = true;
    morphStart.current = performance.now() + (b4?.process === 'absorption' && !preview ? 900 : 200);
    shown.current = key;
    const extent = Math.max(3.5, orbital.meanRadiusBohr * SCALE * 2.3);
    void cameraRef.current?.setLookAt(extent * 0.25, extent * 0.55, extent * 2.1 + 3, 0, 0, 0, true);
  }, [orbital.n, orbital.l, orbital.m, count, geo]); // eslint-disable-line react-hooks/exhaustive-deps

  const photonT0 = useRef(-1e9);
  useEffect(() => {
    if (b4 && !preview && b4.process !== 'none') photonT0.current = performance.now();
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const photon = useMemo(() => {
    const N = 220;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return { g, N };
  }, []);
  const photonMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false }), []);
  const photonLine = useMemo(() => {
    const l = new THREE.Line(photon.g, photonMat);
    l.frustumCulled = false;
    return l;
  }, [photon, photonMat]);

  useFrame((state) => {
    mat.uniforms.uTime!.value = state.clock.elapsedTime;
    mat.uniforms.uMix!.value = Math.min(1, Math.max(0, (performance.now() - morphStart.current) / 1600));
    if (!b4) return;
    const age = (performance.now() - photonT0.current) / 1000;
    const pos = photon.g.getAttribute('position') as THREE.BufferAttribute;
    const extent = Math.max(3, orbital.meanRadiusBohr * SCALE * 1.6);
    const absorb = b4.process === 'absorption';
    const travel = 26;
    const head = absorb ? -travel + age * 18 : extent * 0.4 + age * 18;
    const visible = age < (absorb ? 1.6 : 2.4);
    // Wave packet: visual wavelength compressed logarithmically from the real λ.
    const lam = 0.55 + Math.log10(Math.max(1, b4.photonWavelengthNm)) * 0.35;
    for (let i = 0; i < photon.N; i++) {
      const s = i / (photon.N - 1);
      const x = head - s * 7;
      const env = Math.exp(-((s - 0.5) ** 2) / 0.05);
      const clipped = absorb ? Math.min(x, -0.2) : Math.max(x, extent * 0.4);
      pos.setXYZ(i, clipped, Math.sin((x / lam) * Math.PI * 2 - state.clock.elapsedTime * 10) * 0.55 * env, 0);
    }
    pos.needsUpdate = true;
    photonMat.color.copy(photonColor(b4)).multiplyScalar(2.4);
    photonMat.opacity = visible ? Math.min(1, 1.4 - Math.abs(age - 0.8)) : 0;
  });

  const glow = useMemo(
    () => new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(2.4, 2.0, 1.6), blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  );

  return (
    <group>
      <points geometry={geo} material={mat} frustumCulled={false} />
      <mesh>
        <sphereGeometry args={[0.08, 24, 24]} />
        <meshBasicMaterial color={new THREE.Color('#ffe0b0').multiplyScalar(3)} toneMapped={false} />
      </mesh>
      <sprite material={glow} scale={[1.4, 1.4, 1]} />
      <primitive object={photonLine} />
      <Label position={[0, -0.6, 0]} tone="amber">proton</Label>
      {b4 ? (
        <Label position={[0, orbital.meanRadiusBohr * SCALE * 1.4 + 1.2, 0]} tone="accent" size="md" force>
          ψ {orbital.label}{orbital.l > 0 ? ` (m=${orbital.m})` : ''} · {b4.initial.configuration} → {b4.final.configuration} · {b4.process} ·{' '}
          {wavelength(b4.photonWavelengthNm)} {b4.visibleColorHex ? '' : `(${b4.band}, false colour)`}
        </Label>
      ) : (
        <Label position={[0, 2.6, 0]} tone="accent" size="md" force>ψ 1s · hydrogen ground state</Label>
      )}
      <Label position={[0, -orbital.meanRadiusBohr * SCALE * 1.4 - 1.6, 0]} tone="muted" force>
        Exact hydrogen |ψ|² samples · cyan/amber = wavefunction sign · 1 unit ≈ {(1 / SCALE).toFixed(1)} a₀
      </Label>
    </group>
  );
}
