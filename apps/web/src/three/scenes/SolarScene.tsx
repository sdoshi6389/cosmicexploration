import type { K2Output, K2StellarView } from '@cosmos/engine';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLevelView, useTable } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';
import { NOISE_GLSL } from '../common/glsl';
import { SkySphere } from '../common/SkySphere';
import { clamp01, easeOutCubic, icrfToScene, useTex } from '../common/util';
import { radialTexture } from './EarthScene';
import { SystemStructures } from './solarCiv';
import { useFocusResolver } from '../focus';
import { si } from '../../lib/format';

const AU = 1.495978707e11;
const SUN_R = 2.2;

export function compressAU(au: number, trueScale: boolean): number {
  return trueScale ? au * 12 : 12 * Math.pow(Math.max(au, 0), 0.42);
}

function scenePos(xM: number, yM: number, zM: number, trueScale: boolean): THREE.Vector3 {
  const [x, y, z] = icrfToScene(xM, yM, zM);
  const r = Math.hypot(x, y, z);
  if (r < 1) return new THREE.Vector3();
  const s = compressAU(r / AU, trueScale) / r;
  return new THREE.Vector3(x * s, y * s, z * s);
}

function planetSize(radiusKm: number | null, kind: string): number {
  if (kind === 'spacecraft') return 0.05;
  const r = radiusKm ?? 500;
  const s = 0.22 * Math.sqrt(r / 6371);
  return Math.max(kind === 'moon' ? 0.05 : 0.09, s);
}

/* ------------------------------------------------------------------ sun */
const sunVert = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vView;
void main(){ vN = normalize(normalMatrix*normal); vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }
`;
const sunFrag = /* glsl */ `
${NOISE_GLSL}
uniform float time; uniform float brightness;
varying vec3 vN; varying vec3 vP; varying vec3 vView;
void main(){
  vec3 p = normalize(vP) * 3.2;
  float g = fbm(p + vec3(0.0, time*0.035, time*0.02));
  float cells = snoise(p*6.0 + time*0.08)*0.5 + 0.5;
  float spots = smoothstep(0.62, 0.8, snoise(p*1.3 + vec3(time*0.01)));
  float mu = max(dot(normalize(vN), normalize(vView)), 0.0);
  float limb = 0.35 + 0.65*pow(mu, 0.55);
  vec3 hot = vec3(1.0, 0.86, 0.6);
  vec3 cool = vec3(1.0, 0.48, 0.14);
  vec3 c = mix(cool, hot, 0.55 + 0.45*g + 0.25*cells);
  c *= (1.0 - 0.65*spots);
  gl_FragColor = vec4(c * limb * brightness * 1.55, 1.0);
}
`;

function Sun({ transmitted, heat }: { transmitted: number; heat: number }) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: sunVert, fragmentShader: sunFrag, uniforms: { time: { value: 0 }, brightness: { value: 1 } } }),
    [],
  );
  const corona = useMemo(
    () => new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(2.2, 1.5, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    [],
  );
  const light = useRef<THREE.PointLight>(null);
  const tgt = useRef(1);
  tgt.current = transmitted;
  useFrame((s, dt) => {
    mat.uniforms.time!.value = s.clock.elapsedTime;
    const b = mat.uniforms.brightness!.value as number;
    const nb = b + (0.18 + 0.82 * tgt.current - b) * (1 - Math.exp(-dt * 2.5));
    mat.uniforms.brightness!.value = nb;
    corona.color.setRGB(2.0 * nb + heat * 1.2, 1.35 * nb + heat * 0.25, 0.7 * nb);
    if (light.current) light.current.intensity = 900 * (0.12 + 0.88 * tgt.current);
  });
  return (
    <group>
      <mesh material={mat}>
        <sphereGeometry args={[SUN_R, 96, 96]} />
      </mesh>
      <sprite material={corona} scale={[SUN_R * 6.5, SUN_R * 6.5, 1]} />
      <pointLight ref={light} intensity={900} decay={2} distance={0} color="#fff1d6" />
    </group>
  );
}

/* --------------------------------------------------------------- swarm */
const swarmVert = /* glsl */ `
attribute float aBand; attribute float aPhase; attribute float aOrder; attribute vec3 aJit;
uniform float uR[12]; uniform float uInc[12]; uniform float uNode[12]; uniform float uSpeed[12];
uniform float uTime; uniform float uBuild; uniform float uSize;
varying float vFront; varying float vFlash;
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
void main(){
  int b = int(aBand + 0.5);
  float build = clamp((uBuild - aOrder) * 6.0, 0.0, 1.0);
  float ang = aPhase + uTime * uSpeed[b] * (1.0 - aJit.z * 1.5);
  vec3 c = rotY(uNode[b] + aJit.y) * rotX(uInc[b] + aJit.x) * vec3(cos(ang), 0.0, sin(ang)) * uR[b] * (1.0 + aJit.z);
  vec3 n = normalize(-c);
  vec3 t = normalize(cross(n, abs(n.y) > 0.95 ? vec3(1.,0.,0.) : vec3(0.,1.,0.)));
  vec3 bt = cross(n, t);
  vec3 local = position * uSize * build;
  vec3 world = c + t*local.x + bt*local.y;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vFront = dot(normalize(-mv.xyz), (modelViewMatrix * vec4(n, 0.0)).xyz);
  vFlash = exp(-pow((uBuild - aOrder - 0.04) * 22.0, 2.0)) * step(uBuild, 0.999);
  gl_Position = projectionMatrix * mv;
}
`;
const swarmFrag = /* glsl */ `
uniform float uHeat; uniform float uSun;
varying float vFront; varying float vFlash;
void main(){
  vec3 lit = vec3(1.0, 0.82, 0.48) * (0.9 + 1.6 * uSun);
  vec3 back = mix(vec3(0.05, 0.07, 0.1), vec3(1.0, 0.32, 0.08) * 1.8, uHeat);
  vec3 c = vFront > 0.0 ? lit : back;
  c += vec3(0.6, 0.95, 1.0) * vFlash * 3.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

function DysonSwarm({ k2, trueScale, pulse, preview }: { k2: K2Output; trueScale: boolean; pulse: number; preview: boolean }) {
  const geo = useMemo(() => {
    const base = new THREE.CircleGeometry(1, 6);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    const n = k2.collectorSample.length;
    const band = new Float32Array(n);
    const phase = new Float32Array(n);
    const order = new Float32Array(n);
    const jit = new Float32Array(n * 3);
    const hash = (x: number) => {
      const v = Math.sin(x * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    k2.collectorSample.forEach((s, i) => {
      band[i] = s.bandIndex;
      phase[i] = s.phase;
      order[i] = (s.bandIndex / 12) * 0.55 + (i / n) * 0.45;
      // Render-only dispersion around each band (inclination, node, radius).
      jit[i * 3] = (hash(i + 0.1) - 0.5) * 0.5;
      jit[i * 3 + 1] = (hash(i + 0.7) - 0.5) * 0.9;
      jit[i * 3 + 2] = (hash(i + 0.3) - 0.5) * 0.09;
    });
    g.setAttribute('aJit', new THREE.InstancedBufferAttribute(jit, 3));
    g.setAttribute('aBand', new THREE.InstancedBufferAttribute(band, 1));
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aOrder', new THREE.InstancedBufferAttribute(order, 1));
    g.instanceCount = n;
    return g;
  }, [k2.collectorSample]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: swarmVert,
        fragmentShader: swarmFrag,
        side: THREE.DoubleSide,
        uniforms: {
          uR: { value: new Array(12).fill(10) }, uInc: { value: new Array(12).fill(0) }, uNode: { value: new Array(12).fill(0) },
          uSpeed: { value: new Array(12).fill(0.1) }, uTime: { value: 0 }, uBuild: { value: 0 }, uSize: { value: 0.12 },
          uHeat: { value: 0 }, uSun: { value: 1 },
        },
      }),
    [],
  );
  useEffect(() => {
    const u = mat.uniforms;
    u.uR!.value = k2.bands.map((b) => compressAU(b.radiusM / AU, trueScale));
    u.uInc!.value = k2.bands.map((b) => (b.inclinationDeg * Math.PI) / 180);
    u.uNode!.value = k2.bands.map((b) => (b.ascendingNodeDeg * Math.PI) / 180);
    u.uSpeed!.value = k2.bands.map((b) => (2 * Math.PI) / b.periodDays * 6);
    u.uSize!.value = 0.06 + 0.11 * Math.sqrt(k2.captureFraction);
    u.uHeat!.value = clamp01((k2.swarmRadiatorTempK - 150) / 450);
    u.uSun!.value = k2.transmittedFraction;
  }, [k2, trueScale, mat]);
  const t0 = useRef(performance.now());
  useEffect(() => {
    t0.current = performance.now();
  }, [pulse]);
  useFrame((s) => {
    mat.uniforms.uTime!.value = s.clock.elapsedTime;
    mat.uniforms.uBuild!.value = preview ? 1.05 : easeOutCubic((performance.now() - t0.current) / 4200) * 1.05;
  });
  const shellR = compressAU(k2.orbitalRadiusM / AU, trueScale);
  return (
    <group>
      <mesh geometry={geo} material={mat} frustumCulled={false} />
      <IRShell radius={shellR} heat={clamp01((k2.wasteHeatW / k2.starLuminosityW) * 1.6)} />
      <Label position={[0, shellR + 1.2, 0]} tone="amber" size="md">
        Dyson swarm · {(k2.captureFraction * 100).toFixed(1)}% of L☉ · r {(k2.orbitalRadiusM / AU).toFixed(2)} AU
      </Label>
    </group>
  );
}

function IRShell({ radius, heat }: { radius: number; heat: number }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        uniforms: { heat: { value: 0 } },
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float heat; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0-abs(dot(vN,vV)), 2.2); gl_FragColor = vec4(vec3(1.0,0.3,0.08)*rim*heat*0.9, rim*heat); }`,
      }),
    [],
  );
  mat.uniforms.heat!.value = heat;
  return (
    <mesh material={mat}>
      <sphereGeometry args={[radius * 1.02, 64, 48]} />
    </mesh>
  );
}

/* ------------------------------------------------------------- planets */
function Planet({ id, name, size, position, tilt, texture, ringTexture, dim, showLabel, au, kind }: {
  kind: string;
  id: string; name: string; size: number; position: THREE.Vector3; tilt: number; texture: string | null;
  ringTexture: string | null; dim: number; showLabel: boolean; au: number;
}) {
  const map = useTex(texture);
  const ring = useTex(ringTexture);
  const spin = useRef<THREE.Mesh>(null);
  const select = useUi((s) => s.select);
  const selected = useUi((s) => s.selection?.id === id);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.15;
  });
  const ringGeo = useMemo(() => {
    const g = new THREE.RingGeometry(size * 1.24, size * 2.27, 128, 1);
    const pos = g.attributes.position!;
    const uv = g.attributes.uv!;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - size * 1.24) / (size * 1.03), 0.5);
    }
    return g;
  }, [size]);
  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); select({ kind: 'body', id, label: name, level: 'k2' }); }}>
      {selected ? (
        <mesh>
          <ringGeometry args={[size * 1.5, size * 1.6, 64]} />
          <meshBasicMaterial color="#5ce1ff" transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ) : null}
      <group rotation={[0, 0, tilt]}>
        <mesh ref={spin}>
          <sphereGeometry args={[size, 64, 64]} />
          <meshStandardMaterial map={map ?? undefined} color={new THREE.Color(dim, dim, dim)} roughness={0.95} metalness={0} />
        </mesh>
        {ring ? (
          <mesh geometry={ringGeo} rotation={[Math.PI / 2, 0, 0]}>
            <meshStandardMaterial map={ring} alphaMap={ring} transparent side={THREE.DoubleSide} color={new THREE.Color(dim, dim, dim)} depthWrite={false} />
          </mesh>
        ) : null}
      </group>
      {showLabel || selected ? (
        <Label position={[0, size + 0.25, 0]} tone={id === 'body.earth' || selected ? 'accent' : 'default'} force={selected}>
          {name}{kind === 'moon' ? ' (moon)' : ''}
          <span style={{ opacity: 0.5 }}>{au.toFixed(2)} AU</span>
        </Label>
      ) : null}
    </group>
  );
}

/** Beamed power from the swarm to each habitat/station, coloured by how much of its demand is met. */
function PowerBeams({ stellar, positions, trueScale }: { stellar: K2StellarView; positions: Map<string, THREE.Vector3>; trueScale: boolean }) {
  const select = useUi((s) => s.select);
  const r = stellar.swarms[0] ? compressAU(stellar.swarms[0].orbitalRadiusM / AU, trueScale) : 2;
  return (
    <>
      {stellar.loads.map((l) => {
        const to = positions.get(l.bodyId);
        if (!to) return null;
        const from = to.clone().setY(0).normalize().multiplyScalar(r);
        const col = l.servedFraction > 0.99 ? '#7dffb6' : l.servedFraction > 0 ? '#ffcf5c' : '#ff6b7a';
        return (
          <group key={l.id}>
            <Line points={[from, to]} color={col} lineWidth={2} transparent opacity={0.85} dashed dashSize={0.25} gapSize={0.12} />
            <mesh position={to} onClick={(e) => { e.stopPropagation(); select({ kind: 'intervention', id: l.id, label: l.label, level: 'k2' }); }}>
              <torusGeometry args={[0.32, 0.03, 8, 40]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            <Label position={[to.x, to.y + 0.6, to.z]} tone={l.servedFraction > 0.99 ? 'accent' : 'amber'} force>
              {l.label} · {si(l.deliveredW, 'W', 2)} / {si(l.demandW, 'W', 2)} ({(l.servedFraction * 100).toFixed(0)}%)
            </Label>
          </group>
        );
      })}
    </>
  );
}

export function SolarScene() {
  const bodies = useTable('horizons_body');
  const samples = useTable('orbit_sample');
  const textures = useTable('planet_texture');
  const trueScale = useUi((s) => s.trueScale);
  const { output: stellar, pulse, preview } = useLevelView<K2StellarView>('k2');
  const k2 = stellar?.swarms[0] ?? null;

  const tex = (bodyId: string, kind = 'albedo') => textures.find((t) => t.bodyId === bodyId && t.kind === kind)?.path ?? null;

  const layout = useMemo(() => {
    const byId = new Map(bodies.map((b) => [b.id, b]));
    const pos = new Map<string, THREE.Vector3>();
    const size = new Map<string, number>();
    for (const b of bodies) {
      size.set(b.id, b.id === 'body.sun' ? SUN_R : planetSize(b.radiusKm, b.kind));
      if (b.kind !== 'moon') pos.set(b.id, scenePos(b.xM, b.yM, b.zM, trueScale));
    }
    for (const b of bodies) {
      if (b.kind !== 'moon') continue;
      const parent = byId.get(b.parentId);
      const pp = pos.get(b.parentId);
      if (!parent || !pp) continue;
      const [dx, dy, dz] = icrfToScene(b.xM - parent.xM, b.yM - parent.yM, b.zM - parent.zM);
      const d = Math.hypot(dx, dy, dz) || 1;
      const pr = (parent.radiusKm ?? 1000) * 1000;
      const ps = size.get(b.parentId)!;
      const k = (ps * (1.7 + 0.95 * Math.log10(1 + d / pr))) / d;
      pos.set(b.id, pp.clone().add(new THREE.Vector3(dx * k, dy * k, dz * k)));
    }
    return { pos, size, byId };
  }, [bodies, trueScale]);

  useFocusResolver((id) => {
    if (id === 'body.sun' || id === 'star.sol') return { position: [0, 0, 0], radius: SUN_R };
    const p = layout.pos.get(id);
    return p ? { position: p.toArray() as [number, number, number], radius: layout.size.get(id) ?? 0.2 } : null;
  }, [layout]);

  const orbits = useMemo(() => {
    const groups = new Map<string, typeof samples>();
    for (const s of samples) {
      const arr = groups.get(s.bodyId);
      if (arr) arr.push(s);
      else groups.set(s.bodyId, [s]);
    }
    const out: { id: string; points: THREE.Vector3[]; color: string; craft: boolean }[] = [];
    for (const [id, arr] of groups) {
      const b = layout.byId.get(id);
      if (!b) continue;
      arr.sort((a, c) => a.idx - c.idx);
      let pts: THREE.Vector3[];
      if (b.kind === 'moon') {
        const parent = layout.byId.get(b.parentId);
        const pp = layout.pos.get(b.parentId);
        if (!parent || !pp) continue;
        const pr = (parent.radiusKm ?? 1000) * 1000;
        const ps = layout.size.get(b.parentId)!;
        pts = arr.map((s) => {
          const [dx, dy, dz] = icrfToScene(s.xM, s.yM, s.zM);
          const d = Math.hypot(dx, dy, dz) || 1;
          const k = (ps * (1.7 + 0.95 * Math.log10(1 + d / pr))) / d;
          return pp.clone().add(new THREE.Vector3(dx * k, dy * k, dz * k));
        });
      } else {
        pts = arr.map((s) => scenePos(s.xM, s.yM, s.zM, trueScale));
      }
      if (b.kind !== 'spacecraft') pts.push(pts[0]!.clone());
      out.push({ id, points: pts, color: b.kind === 'spacecraft' ? '#ffb547' : b.id === 'body.earth' ? '#5ce1ff' : b.colorHex, craft: b.kind === 'spacecraft' });
    }
    return out;
  }, [samples, layout, trueScale]);

  const swarmAU = k2 ? k2.orbitalRadiusM / AU : 0;
  const structures = (stellar as unknown as { structures?: import('@cosmos/engine').StructureView[] } | null)?.structures ?? [];
  const sunBlock = structures.filter((st) => st.hostId === 'body.sun' && st.transmittedFraction != null).reduce((m, st) => Math.min(m, st.transmittedFraction!), 1);
  const transmitted = Math.min(stellar ? stellar.totals.transmittedFraction : 1, sunBlock);

  return (
    <group>
      <SkySphere brightness={0.4} />
      <ambientLight intensity={0.035} />
      <Sun transmitted={transmitted} heat={k2 ? clamp01(k2.captureFraction * (1 - k2.conversionEfficiency)) : 0} />
      {orbits.map((o) => (
        <Line
          key={o.id}
          points={o.points}
          color={o.color}
          lineWidth={o.craft ? 1 : o.id === 'body.earth' ? 1.4 : 0.8}
          transparent
          opacity={o.craft ? 0.28 : layout.byId.get(o.id)?.kind === 'moon' ? 0.22 : 0.35}
          dashed={o.craft}
          dashSize={0.6}
          gapSize={0.4}
        />
      ))}
      {bodies.filter((b) => b.id !== 'body.sun').map((b) => {
        const p = layout.pos.get(b.id);
        if (!p) return null;
        const au = Math.hypot(b.xM, b.yM, b.zM) / AU;
        const behindSwarm = k2 && au > swarmAU;
        const dim = behindSwarm ? 0.25 + 0.75 * transmitted : 1;
        if (b.kind === 'spacecraft') {
          return (
            <group key={b.id} position={p}>
              <mesh>
                <octahedronGeometry args={[0.09, 0]} />
                <meshBasicMaterial color={new THREE.Color('#ffd48a').multiplyScalar(2)} toneMapped={false} />
              </mesh>
              {au > 5 ? <Label position={[0, 0.3, 0]} tone="amber">{b.name} · {au.toFixed(0)} AU</Label> : null}
            </group>
          );
        }
        return (
          <Planet
            key={b.id}
            id={b.id}
            name={b.name}
            size={layout.size.get(b.id)!}
            position={p}
            tilt={((b.obliquityDeg ?? 0) * Math.PI) / 180}
            texture={tex(b.id)}
            ringTexture={b.id === 'body.saturn' ? tex(b.id, 'ring') : null}
            dim={dim}
            showLabel={b.kind === 'planet' || b.kind === 'dwarf'}
            au={au}
            kind={b.kind}
          />
        );
      })}
      {stellar?.swarms.map((sw) => <DysonSwarm key={sw.interventionId} k2={sw} trueScale={trueScale} pulse={pulse} preview={preview} />)}
      {stellar ? <PowerBeams stellar={stellar} positions={layout.pos} trueScale={trueScale} /> : null}
      <SystemStructures structures={structures} positions={layout.pos} sizes={layout.size} swarmRadius={(au) => compressAU(au, trueScale)} />
      {k2 && k2.earthShadowed && layout.pos.get('body.earth') ? (
        <Label position={layout.pos.get('body.earth')!.clone().add(new THREE.Vector3(0, 0.9, 0)).toArray() as [number, number, number]} tone="amber" force>
          Earth insolation −{(k2.captureFraction * 100).toFixed(0)}% · T_eq {k2.earthEquilibriumTempK.toFixed(0)} K
        </Label>
      ) : null}
      <Label position={[0, -14, 30]} tone="muted" force>
        Horizons epoch 2026-10-03 TDB · radial scale {trueScale ? 'linear' : 'compressed r^0.42'} · bodies enlarged
      </Label>
    </group>
  );
}
