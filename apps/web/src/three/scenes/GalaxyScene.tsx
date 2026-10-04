import { icrsToGalactic, LIGHT_YEAR_M, PARSEC_M, type K3Output, type StructureView } from '@cosmos/engine';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useBundle, useLevelView, useTable } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { useWorld } from '../../state/world';
import { cameraRef } from '../Stage';
import { Label } from '../common/Label';
import { createRng } from '@cosmos/engine';
import { blackbody, bpRpToTeff, galacticToScene } from '../common/util';
import { useFocusResolver } from '../focus';
import { ColonyShips, NearbySwarms, SelectedMarker, StarStructures } from './galaxyCiv';
import { si } from '../../lib/format';

const SUN_POS = galacticToScene(0, 0, 0);
const YEAR_S = 365.25 * 86400;

/* ----------------------------------------------------- milky way model */
const galaxyVert = /* glsl */ `
attribute float aSize; attribute float aAlpha;
varying vec3 vColor; varying float vAlpha;
uniform float uScale; uniform vec3 uCivCenter; uniform float uCivRadius;
void main(){
  vColor = color; vAlpha = aAlpha;
  // Kardashev III: regions inside the expansion front glow with settled-civilisation light.
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float dc = distance(wp, uCivCenter);
  float inside = uCivRadius > 0.0 ? 1.0 - smoothstep(uCivRadius * 0.92, uCivRadius, dc) : 0.0;
  float rim = uCivRadius > 0.0 ? exp(-pow((dc - uCivRadius) / max(uCivRadius * 0.04, 0.2), 2.0)) : 0.0;
  vColor = mix(vColor, vec3(0.35, 1.0, 0.85), inside * 0.6) * (1.0 + inside * 0.6 + rim * 1.5);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale * (120.0 / -mv.z), 1.0, 22.0);
  gl_Position = projectionMatrix * mv;
}
`;
const galaxyFrag = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = exp(-r * r * 4.0) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
`;

export const civFront = { radius: 0 };

function MilkyWay({ count }: { count: number }) {
  const { geo, dust } = useMemo(() => buildMilkyWay(count), [count]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: galaxyVert, fragmentShader: galaxyFrag, vertexColors: true, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 1 }, uCivCenter: { value: new THREE.Vector3(...SUN_POS) }, uCivRadius: { value: 0 } },
      }),
    [],
  );
  const dustMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: galaxyVert,
        fragmentShader: `varying vec3 vColor; varying float vAlpha; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard; gl_FragColor = vec4(vColor, exp(-r*r*3.0)*vAlpha); }`,
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
        uniforms: { uScale: { value: 1.6 }, uCivCenter: { value: new THREE.Vector3(...SUN_POS) }, uCivRadius: { value: 0 } },
      }),
    [],
  );
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y -= dt * 0.004;
    mat.uniforms.uCivRadius!.value = civFront.radius;
  });
  return (
    <group ref={ref}>
      <points geometry={dust} material={dustMat} renderOrder={1} />
      <points geometry={geo} material={mat} renderOrder={2} />
    </group>
  );
}

function buildMilkyWay(count: number) {
  const rnd = createRng(8178);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  const pitch = Math.tan((12 * Math.PI) / 180);
  const arms = [0.25, 1.82, 3.39, 4.96]; // four principal arms
  const barAngle = (-27 * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const kind = rnd();
    let x: number;
    let y: number;
    let z: number;
    let c: [number, number, number];
    let s = 1.2 + rnd() * 1.6;
    let a = 0.07 + rnd() * 0.06;
    if (kind < 0.16) {
      // bar + bulge
      const along = gauss() * 26;
      const across = gauss() * 9;
      x = along * Math.cos(barAngle) - across * Math.sin(barAngle);
      z = along * Math.sin(barAngle) + across * Math.cos(barAngle);
      y = gauss() * 5.5;
      c = [1.0, 0.78, 0.52];
      a *= 1.6;
      s *= 1.1;
    } else {
      const r = -26 * Math.log(Math.max(1e-6, rnd() * rnd())) + 8;
      const inArm = rnd() < 0.68;
      let theta: number;
      if (inArm) {
        const arm = arms[Math.floor(rnd() * arms.length)]!;
        theta = Math.log(r / 22) / pitch + arm + gauss() * (0.09 + 3.5 / r);
      } else {
        theta = rnd() * Math.PI * 2;
      }
      x = r * Math.cos(theta);
      z = r * Math.sin(theta);
      y = gauss() * (1.6 + r * 0.012);
      if (inArm) {
        const hii = rnd() < 0.035;
        c = hii ? [1.0, 0.42, 0.62] : [0.66 + rnd() * 0.12, 0.78 + rnd() * 0.1, 1.0];
        if (hii) {
          s *= 1.8;
          a *= 1.4;
        }
      } else {
        c = [0.95, 0.88, 0.78];
        a *= 0.55;
      }
      if (r > 150) a *= Math.max(0, 1 - (r - 150) / 60);
    }
    pos.set([x, y, z], i * 3);
    col.set(c, i * 3);
    size[i] = s;
    alpha[i] = a;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));

  const nd = Math.floor(count * 0.22);
  const dpos = new Float32Array(nd * 3);
  const dcol = new Float32Array(nd * 3);
  const dsize = new Float32Array(nd);
  const dalpha = new Float32Array(nd);
  for (let i = 0; i < nd; i++) {
    const r = -22 * Math.log(Math.max(1e-6, rnd() * rnd())) + 18;
    const arm = arms[Math.floor(rnd() * arms.length)]!;
    const theta = Math.log(r / 22) / pitch + arm - 0.08 + gauss() * (0.05 + 2 / r);
    dpos.set([r * Math.cos(theta), gauss() * 0.9, r * Math.sin(theta)], i * 3);
    dcol.set([0.05, 0.03, 0.02], i * 3);
    dsize[i] = 2.5 + rnd() * 3;
    dalpha[i] = 0.08 + rnd() * 0.08;
  }
  const dust = new THREE.BufferGeometry();
  dust.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dust.setAttribute('color', new THREE.BufferAttribute(dcol, 3));
  dust.setAttribute('aSize', new THREE.BufferAttribute(dsize, 1));
  dust.setAttribute('aAlpha', new THREE.BufferAttribute(dalpha, 1));
  return { geo, dust };
}

/* --------------------------------------------------------- gaia stars */
const starVert = /* glsl */ `
attribute float aSize; attribute float aArrival;
uniform float uPlayhead; uniform float uSpan; uniform float uActive;
varying vec3 vColor; varying float vAlpha;
void main(){
  float settled = uActive * step(aArrival, uPlayhead);
  float flash = uActive * exp(-max(uPlayhead - aArrival, 0.0) / max(uSpan * 0.025, 1.0)) * settled;
  float dimmed = 1.0 - uActive * (1.0 - settled) * 0.45;
  vColor = mix(color, vec3(0.3, 1.0, 0.82), settled * 0.9) * (1.0 + flash * 4.0) * dimmed;
  vAlpha = 0.55 + settled * 0.4;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (1.0 + settled * 0.8 + flash * 2.5) * (14.0 / -mv.z), 1.0, 18.0);
  gl_Position = projectionMatrix * mv;
}
`;
const starFrag = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 10.0);
  float halo = exp(-r * r * 2.5) * 0.35;
  gl_FragColor = vec4(vColor * (core * 1.8 + halo), (core + halo) * vAlpha);
}
`;
const treeVert = /* glsl */ `
attribute float aArrival;
uniform float uPlayhead;
varying float vShow; varying float vFresh;
uniform float uSpan;
void main(){
  vShow = step(aArrival, uPlayhead);
  vFresh = exp(-max(uPlayhead - aArrival, 0.0) / max(uSpan * 0.04, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const treeFrag = /* glsl */ `
varying float vShow; varying float vFresh;
void main(){
  if (vShow < 0.5) discard;
  gl_FragColor = vec4(vec3(0.25, 0.95, 0.8) * (0.35 + 2.0 * vFresh), 0.35 + 0.5 * vFresh);
}
`;

export function GalaxyScene() {
  const bundle = useBundle();
  const gaia = useTable('gaia_star');
  const exo = useTable('exoplanet_system');
  const quality = useUi((s) => s.quality);
  const { output: k3view, pulse, preview } = useLevelView<(K3Output & { structures?: StructureView[] }) | { structures: StructureView[]; structuresOnly: true }>('k3');
  const k3 = k3view && 'arrivalSeconds' in k3view ? k3view : null;
  const structures = k3view?.structures ?? [];
  const select = useUi((s) => s.select);
  const selection = useUi((s) => s.selection);
  const raycaster = useThree((s) => s.raycaster);

  const stars = bundle?.stars ?? [];
  const positions = useMemo(() => stars.map((s) => galacticToScene(s.lDeg, s.bDeg, s.distancePc)), [stars]);
  const indexById = useMemo(() => new Map(stars.map((s, i) => [s.id, i])), [stars]);
  const positionOf = (id: string): [number, number, number] | null => {
    if (id === 'body.sun' || id === 'star.sol') return SUN_POS as [number, number, number];
    const i = indexById.get(id);
    return i === undefined ? null : (positions[i] as [number, number, number]);
  };
  useFocusResolver((id) => {
    const p = positionOf(id);
    return p ? { position: p, radius: id === 'body.sun' || id === 'star.sol' ? 0.002 : 0.0015 } : null;
  }, [indexById, positions]);

  const starGeo = useMemo(() => {
    const color = new Map(gaia.map((g) => [`gaia.${g.sourceId}`, g.bpRp]));
    const n = stars.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const arrival = new Float32Array(n).fill(1e30);
    stars.forEach((s, i) => {
      pos.set(positions[i]!, i * 3);
      const bp = color.get(s.id);
      const teff = s.id === 'star.sol' ? 5772 : bp != null ? bpRpToTeff(bp) : 6500;
      const c = blackbody(teff);
      col.set([c.r, c.g, c.b], i * 3);
      const lum = Math.max(1e-3, s.luminosityLsun ?? 0.5);
      size[i] = s.id === 'star.sol' ? 5 : 0.9 + Math.min(4.5, Math.log10(1 + lum * 4) * 1.6) + (s.name ? 1.2 : 0);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aArrival', new THREE.BufferAttribute(arrival, 1));
    return g;
  }, [stars, positions, gaia]);

  const starMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: starVert, fragmentShader: starFrag, vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, uniforms: { uPlayhead: { value: 0 }, uSpan: { value: 1 }, uActive: { value: 0 } },
      }),
    [],
  );
  const treeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: treeVert, fragmentShader: treeFrag, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, uniforms: { uPlayhead: { value: 0 }, uSpan: { value: 1 } },
      }),
    [],
  );

  // Arrival times (years) → attribute + parent-link tree, whenever the scenario changes.
  const treeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const attr = starGeo.getAttribute('aArrival') as THREE.BufferAttribute;
    if (!k3) {
      (attr.array as Float32Array).fill(1e30);
      attr.needsUpdate = true;
      return g;
    }
    const arr = attr.array as Float32Array;
    const seg: number[] = [];
    const segT: number[] = [];
    for (let i = 0; i < stars.length; i++) {
      const t = k3.arrivalSeconds[i] ?? Infinity;
      arr[i] = Number.isFinite(t) ? t / YEAR_S : 1e30;
      const p = k3.parentIndex[i] ?? -1;
      if (p >= 0 && Number.isFinite(t)) {
        const a = positions[p]!;
        const b = positions[i]!;
        seg.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        segT.push(arr[i]!, arr[i]!);
      }
    }
    attr.needsUpdate = true;
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    g.setAttribute('aArrival', new THREE.Float32BufferAttribute(segT, 1));
    return g;
  }, [k3, stars, positions, starGeo]);

  // Exoplanet hosts (unique) placed from the archive's ICRS distance.
  const exoGeo = useMemo(() => {
    const seen = new Set<string>();
    const pts: number[] = [];
    for (const e of exo) {
      if (seen.has(e.hostname) || e.xPc == null || e.yPc == null || e.zPc == null || !e.distancePc) continue;
      seen.add(e.hostname);
      const d = e.distancePc;
      const { l, b } = icrsToGalactic(e.xPc / d, e.yPc / d, e.zPc / d);
      pts.push(...galacticToScene(l, b, d));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [exo]);
  const exoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp(40.0/-mv.z, 1.5, 7.0); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `void main(){ float r = length(gl_PointCoord-0.5)*2.0; float ring = smoothstep(0.62,0.78,r)*(1.0-smoothstep(0.86,1.0,r)); if(ring<0.01) discard; gl_FragColor = vec4(vec3(1.0,0.72,0.3)*ring*0.9, ring*0.45); }`,
      }),
    [],
  );

  // Playback: replay the expansion over ~7 s after each commit; previews jump straight to the end.
  const playhead = useRef(0);
  const t0 = useRef(performance.now());
  useEffect(() => {
    t0.current = performance.now();
    playhead.current = 0;
    if (k3 && !preview) {
      const [sx, sy, sz] = SUN_POS;
      const front = Math.min(60, Math.max(0.06, ((k3.frontRadiusM / PARSEC_M) / 100) * 1.4));
      void cameraRef.current?.setLookAt(sx + front * 1.6, sy + front * 1.1, sz + front * 1.9, sx, sy, sz, true);
    }
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const front = useRef<THREE.Mesh>(null);
  const disk = useRef<THREE.Mesh>(null);
  useFrame(() => {
    // Clock-driven playhead: the shared SpacetimeDB clock, interpolated between server ticks.
    const startYr = (k3 as { startTimeYr?: number } | null)?.startTimeYr ?? 0;
    const T = k3 ? k3.scenarioTimeSeconds / YEAR_S : 0;
    const live = Math.max(0, useWorld.getState().simNow() / YEAR_S - startYr);
    const intro = Math.min(1, (performance.now() - t0.current) / 1200);
    playhead.current = preview ? T : live * (0.2 + 0.8 * intro);
    for (const m of [starMat, treeMat]) {
      m.uniforms.uPlayhead!.value = playhead.current;
      m.uniforms.uSpan!.value = Math.max(T, 1);
    }
    starMat.uniforms.uActive!.value = k3 ? 1 : 0;
    const dist = cameraRef.current?.distance ?? 100;
    raycaster.params.Points = { threshold: Math.max(0.0005, dist * 0.006) };
    civFront.radius = 0;
    if (k3 && front.current && disk.current) {
      const rLy = k3.travelSpeedFractionC * playhead.current;
      const r = Math.max(0.0001, (rLy * LIGHT_YEAR_M) / PARSEC_M / 100);
      civFront.radius = r;
      front.current.scale.setScalar(r);
      disk.current.scale.setScalar(r);
    }
  });

  const named = useMemo(
    () => stars.map((s, i) => ({ s, p: positions[i]! })).filter((x) => x.s.name && x.s.distancePc < 120 && (x.s.luminosityLsun ?? 0) > 40).slice(0, 7),
    [stars, positions],
  );
  const count = quality === 'high' ? 160_000 : quality === 'medium' ? 90_000 : 45_000;

  return (
    <group>
      <MilkyWay count={count} />
      <points
        geometry={starGeo} material={starMat} frustumCulled={false} renderOrder={3}
        onClick={(e) => {
          if (e.index === undefined) return;
          e.stopPropagation();
          const s = stars[e.index];
          if (s) select({ kind: 'star', id: s.id === 'star.sol' ? 'body.sun' : s.id, label: s.name ?? `Gaia DR3 ${s.id.replace('gaia.', '')}`, level: 'k3' });
        }}
      />
      <ColonyShips k3={k3} stars={stars} positions={positions as [number, number, number][]} playheadYr={playhead} />
      <NearbySwarms k3={k3} stars={stars} positions={positions as [number, number, number][]} playheadYr={playhead} />
      <StarStructures structures={structures} positionOf={positionOf} />
      <SelectedMarker position={selection && (selection.kind === 'star' || selection.kind === 'body') ? positionOf(selection.id) : null} />
      {selection?.kind === 'star' && positionOf(selection.id) ? (
        <Label position={positionOf(selection.id)!} tone="accent" force offsetY={-10}>{selection.label} · selected</Label>
      ) : null}
      {k3 ? (
        <Label position={[SUN_POS[0], SUN_POS[1] + 3, SUN_POS[2]]} tone="accent" size="md" force>
          Type III civilisation · {k3.settledCount.toLocaleString()} systems · front {(k3.frontRadiusM / LIGHT_YEAR_M).toFixed(0)} ly · {si(k3.sampleUsefulPowerW, 'W', 2)} captured · extrapolated K {k3.galaxyExtrapolation.extrapolatedK.toFixed(2)}
        </Label>
      ) : null}
      {k3 ? <lineSegments geometry={treeGeo} material={treeMat} frustumCulled={false} renderOrder={4} /> : null}
      <points geometry={exoGeo} material={exoMat} frustumCulled={false} />
      {k3 ? (
        <group position={SUN_POS}>
          <mesh ref={front}>
            <sphereGeometry args={[1, 64, 48]} />
            <FrontMaterial />
          </mesh>
          <mesh ref={disk} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1, 128]} />
            <meshBasicMaterial color="#3ff0c8" transparent opacity={0.035} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ) : null}
      <Label position={SUN_POS} tone="accent" size="md" force>
        Sun
      </Label>
      <Label position={[0, 6, 0]} tone="amber" size="md">Galactic centre · Sgr A*</Label>
      {named.map(({ s, p }) => (
        <Label key={s.id} position={p} tone="muted">{s.name}</Label>
      ))}
      <Label position={[0, -10, 150]} tone="muted" force>
        Spiral morphology is illustrative · stars are Gaia DR3 measured positions (1 unit = 100 pc)
      </Label>
    </group>
  );
}

function FrontMaterial() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0-abs(dot(vN,vV)), 3.0); gl_FragColor = vec4(vec3(0.25,1.0,0.82)*rim*0.55, rim*0.4); }`,
      }),
    [],
  );
  return <primitive object={mat} attach="material" />;
}
