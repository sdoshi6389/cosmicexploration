import type { K1GridView, K1InfrastructureKind, K1InfrastructureNode, K1Output } from '@cosmos/engine';
import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLevelView, useTable } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Label } from '../common/Label';
import { SkySphere } from '../common/SkySphere';
import { clamp01, easeOutCubic, latLonToVec3, useTex } from '../common/util';
import { si } from '../../lib/format';
import { useFocusResolver } from '../focus';
import { REGIONS } from '@cosmos/engine';

const formatPower = (w: number) => si(w, 'W', 2);

const R = 2;
const GEO_R = R * 1.85; // geostationary radius drawn compressed (true scale ≈ 6.6 R⊕)
const SUN_DIR = new THREE.Vector3(-0.35, 0.22, 0.92).normalize();
const TILT = (23.44 * Math.PI) / 180;

const KIND_COLOR: Record<K1InfrastructureKind, string> = {
  solar_farm: '#ffcf5c',
  wind_array: '#bff6ff',
  fusion_plant: '#d58cff',
  fission_plant: '#7dffb6',
  geothermal: '#ff8a4c',
  orbital_ring: '#7ec8ff',
  orbital_collector: '#9fe6ff',
  rectenna: '#5ce1ff',
  space_elevator: '#e8f0ff',
};

const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const earthFrag = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D waterMap;
uniform sampler2D layerMap;
uniform float layerMix;
uniform float nightBoost;
uniform float albedoBoost;
uniform float haze;
uniform vec3 sunDir;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float ndl = dot(n, sunDir);
  float day = smoothstep(-0.18, 0.28, ndl);
  vec3 dayCol = texture2D(dayMap, vUv).rgb;
  dayCol = mix(dayCol, vec3(0.92, 0.95, 1.0), albedoBoost);
  vec3 night = texture2D(nightMap, vUv).rgb;
  float lum = dot(night, vec3(0.299, 0.587, 0.114));
  float warm = smoothstep(0.02, 0.12, night.r - night.b * 0.6);
  vec3 lights = night * smoothstep(0.13, 0.55, lum) * mix(0.6, 1.0, warm) * vec3(1.15, 0.86, 0.56) * nightBoost;
  float water = texture2D(waterMap, vUv).a;
  vec3 h = normalize(sunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 70.0) * water * day;
  float diffuse = 0.035 + 1.05 * max(ndl, 0.0);
  vec3 col = dayCol * diffuse * day + lights * (1.0 - day) * (1.0 - haze * 0.5);
  col += spec * vec3(1.0, 0.9, 0.75) * 0.45;
  float twilight = smoothstep(-0.2, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.22, ndl));
  col += twilight * vec3(0.55, 0.22, 0.08) * 0.25;
  vec4 L = texture2D(layerMap, vUv);
  col = mix(col, L.rgb * (0.4 + 0.75 * day), L.a * layerMix);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  col += mix(vec3(0.25, 0.55, 1.0), vec3(0.85, 0.9, 1.0), haze) * fres * (0.18 + 0.9 * day) * 0.75;
  gl_FragColor = vec4(col, 1.0);
}
`;

const atmoFrag = /* glsl */ `
uniform vec3 sunDir;
uniform float haze;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 n = normalize(vNormalW);
  float rim = pow(1.0 - abs(dot(n, v)), 3.4);
  float lit = smoothstep(-0.35, 0.5, dot(n, sunDir));
  vec3 c = mix(vec3(0.18, 0.42, 1.0), vec3(0.9, 0.93, 1.0), haze) * rim * (0.25 + 1.6 * lit);
  gl_FragColor = vec4(c, rim);
}
`;

const cloudFrag = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  float a = texture2D(cloudMap, vUv).r;
  float ndl = dot(normalize(vNormalW), sunDir);
  float day = smoothstep(-0.15, 0.3, ndl);
  gl_FragColor = vec4(vec3(1.0) * (0.04 + 1.0 * max(ndl, 0.0)), a * 0.85 * (0.2 + 0.8 * day));
}
`;

/** Flowing energy pulses along grid arcs and power beams. */
const flowVert = /* glsl */ `
attribute float aT;
attribute float aPhase;
attribute float aBuild;
varying float vT;
varying float vPhase;
varying float vBuild;
void main() {
  vT = aT; vPhase = aPhase; vBuild = aBuild;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const flowFrag = /* glsl */ `
uniform float time;
uniform float progress;
uniform vec3 color;
uniform float speed;
varying float vT;
varying float vPhase;
varying float vBuild;
void main() {
  float shown = step(vT, clamp((progress - vBuild) * 3.0, 0.0, 1.0));
  if (shown < 0.5) discard;
  float pulse = pow(fract(vT * 3.0 - time * speed + vPhase), 10.0);
  gl_FragColor = vec4(color * (0.35 + 2.6 * pulse), 0.55 + 0.45 * pulse);
}
`;

function useEarthLayers() {
  const layers = useTable('earth_layer');
  const textures = useTable('planet_texture');
  const path = (id: string) => layers.find((l) => l.id === id)?.path ?? null;
  return {
    day: path('earth.day') ?? '/textures/earth/day.jpg',
    night: path('earth.night') ?? '/textures/earth/night.jpg',
    water: path('earth.land_water') ?? '/textures/earth/land_water.png',
    lst: path('earth.lst_day'),
    ndvi: path('earth.ndvi'),
    clouds: textures.find((t) => t.id === 'tex.body.earth.clouds')?.path ?? '/textures/planets/2k_earth_clouds.jpg',
    moon: textures.find((t) => t.id === 'tex.body.moon.albedo')?.path ?? '/textures/planets/2k_moon.jpg',
    moonBump: textures.find((t) => t.id === 'pds.moon.lola_ldem_4')?.path ?? null,
  };
}

export function EarthScene() {
  const L = useEarthLayers();
  const day = useTex(L.day);
  const night = useTex(L.night);
  const water = useTex(L.water, false);
  const clouds = useTex(L.clouds, false);
  const earthLayer = useUi((s) => s.earthLayer);
  const layerTex = useTex(earthLayer === 'lst' ? L.lst : earthLayer === 'ndvi' ? L.ndvi : null);
  const { output: grid, pulse, preview } = useLevelView<K1GridView>('k1');
  const k1 = useMemo(() => (grid ? gridToScene(grid) : null), [grid]);
  useFocusResolver((id) => {
    if (id === 'body.earth') return { position: [0, 0, 0], radius: R };
    if (id === 'body.moon') return { position: moonWorld.toArray() as [number, number, number], radius: 0.54 };
    const r = REGIONS.find((x) => `region.${x.id}` === id);
    if (!r) return null;
    const p = latLonToVec3(r.centroid[0], r.centroid[1], R).applyAxisAngle(new THREE.Vector3(0, 0, 1), TILT);
    return { position: [p.x, p.y, p.z], radius: R * 0.35 };
  }, []);

  const spin = useRef<THREE.Group>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const blank = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    t.needsUpdate = true;
    return t;
  }, []);

  const earthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: earthVert,
        fragmentShader: earthFrag,
        uniforms: {
          dayMap: { value: blank }, nightMap: { value: blank }, waterMap: { value: blank }, layerMap: { value: blank },
          layerMix: { value: 0 }, nightBoost: { value: 1 }, albedoBoost: { value: 0 }, haze: { value: 0 },
          sunDir: { value: SUN_DIR.clone() },
        },
      }),
    [blank],
  );
  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: earthVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: { sunDir: { value: SUN_DIR.clone() }, haze: { value: 0 } },
      }),
    [],
  );
  const cloudMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: earthVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false,
        uniforms: { cloudMap: { value: blank }, sunDir: { value: SUN_DIR.clone() } },
      }),
    [blank],
  );

  useEffect(() => {
    const u = earthMat.uniforms;
    if (day) u.dayMap!.value = day;
    if (night) u.nightMap!.value = night;
    if (water) u.waterMap!.value = water;
    u.layerMap!.value = layerTex ?? blank;
    if (clouds) cloudMat.uniforms.cloudMap!.value = clouds;
  }, [day, night, water, layerTex, clouds, earthMat, cloudMat, blank]);

  // Targets the shader eases toward (so slider previews feel continuous).
  const target = useRef({ night: 1, albedo: 0, haze: 0, layer: 0 });
  target.current = {
    night: k1 ? 1 + Math.log10(Math.max(1, k1.powerMultiple)) * 1.6 : 1,
    albedo: k1 ? clamp01((k1.albedo - k1.baselineAlbedo) * 5) : 0,
    haze: k1?.climate.kind === 'stratospheric_aerosol' ? k1.climate.magnitude * 0.6 : 0,
    layer: earthLayer === 'lst' || earthLayer === 'ndvi' ? 0.85 : 0,
  };

  useFrame((state, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.025;
    if (cloudRef.current) cloudRef.current.rotation.y += dt * 0.006;
    const u = earthMat.uniforms;
    const k = 1 - Math.exp(-dt * 3);
    u.nightBoost!.value += (target.current.night - u.nightBoost!.value) * k;
    u.albedoBoost!.value += (target.current.albedo - u.albedoBoost!.value) * k;
    u.haze!.value += (target.current.haze - u.haze!.value) * k;
    u.layerMix!.value += (target.current.layer - u.layerMix!.value) * k;
    atmoMat.uniforms.haze!.value = u.haze!.value;
    void state;
  });

  return (
    <group>
      <SkySphere brightness={0.55} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(50)} intensity={2.2} />
      <ambientLight intensity={0.06} />
      <SunGlare />
      <group rotation={[0, 0, TILT]}>
        <group ref={spin} rotation={[0, -1.2, 0]}>
          <mesh material={earthMat}>
            <sphereGeometry args={[R, 160, 160]} />
          </mesh>
          <mesh ref={cloudRef} material={cloudMat} scale={1.012}>
            <sphereGeometry args={[R, 96, 96]} />
          </mesh>
          {earthLayer === 'quakes' ? <Earthquakes /> : null}
          {k1 ? <Infrastructure k1={k1} pulse={pulse} preview={preview} /> : null}
          <CityLabels active={Boolean(k1)} />
          {grid ? <RegionBadges grid={grid} /> : null}
        </group>
      </group>
      <mesh material={atmoMat} scale={1.11}>
        <sphereGeometry args={[R, 96, 96]} />
      </mesh>
      {k1 && k1.climate.kind === 'orbital_shade' && k1.climate.magnitude > 0 ? <Sunshade magnitude={k1.climate.magnitude} /> : null}
      <Moon albedo={L.moon} bump={L.moonBump} />
    </group>
  );
}

function SunGlare() {
  const mat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: radialTexture(),
        color: new THREE.Color(4, 3.4, 2.6),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    [],
  );
  return <sprite material={mat} position={SUN_DIR.clone().multiplyScalar(400)} scale={[60, 60, 1]} />;
}

let radial: THREE.Texture | null = null;
export function radialTexture(): THREE.Texture {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  radial = new THREE.CanvasTexture(c);
  return radial;
}

/** World position of the Moon mesh (updated every frame) for camera focus. */
const moonWorld = new THREE.Vector3(13, 0.4, 0);

function Moon({ albedo, bump }: { albedo: string; bump: string | null }) {
  const map = useTex(albedo);
  const bumpMap = useTex(bump, false);
  const ref = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.012;
    mesh.current?.getWorldPosition(moonWorld);
  });
  return (
    <group ref={ref} rotation={[0.09, 0.7, 0]}>
      <mesh ref={mesh} position={[13, 0.4, 0]}>
        <sphereGeometry args={[0.54, 64, 64]} />
        <meshStandardMaterial map={map ?? undefined} bumpMap={bumpMap ?? undefined} bumpScale={0.6} roughness={1} metalness={0} color={map ? '#ffffff' : '#9a9a9a'} />
      </mesh>
      <Label position={[13, 1.15, 0]} tone="muted">Moon · LRO LOLA relief</Label>
    </group>
  );
}

function Earthquakes() {
  const quakes = useTable('earthquake');
  const geo = useMemo(() => {
    const pos = new Float32Array(quakes.length * 3);
    const size = new Float32Array(quakes.length);
    quakes.forEach((q, i) => {
      const p = latLonToVec3(q.latDeg, q.lonDeg, R * 1.004);
      pos.set([p.x, p.y, p.z], i * 3);
      size[i] = (q.magnitude - 4.5) * 2.2;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    return g;
  }, [quakes]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 } },
        vertexShader: `attribute float aSize; uniform float time; varying float vA;
          void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); float p = 0.6+0.4*sin(time*2.0+position.x*9.0);
          gl_PointSize = aSize*p*(26.0/-mv.z); vA = p; gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard;
          float ring = smoothstep(0.55,0.75,r)*(1.0-smoothstep(0.85,1.0,r)) + exp(-r*r*14.0);
          gl_FragColor = vec4(vec3(1.0,0.45,0.25)*ring*1.6, ring*vA); }`,
      }),
    [],
  );
  useFrame((s) => {
    mat.uniforms.time!.value = s.clock.elapsedTime;
  });
  return <points geometry={geo} material={mat} />;
}

function CityLabels({ active }: { active: boolean }) {
  const cities = useTable('earth_city');
  const top = useMemo(() => [...cities].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, active ? 10 : 6), [cities, active]);
  return (
    <>
      {top.map((c) => {
        const p = latLonToVec3(c.latDeg, c.lonDeg, R * 1.02);
        return (
          <Label key={c.id} position={[p.x, p.y, p.z]} tone="muted">
            {c.name}
          </Label>
        );
      })}
    </>
  );
}

/** Orbital elements sit at a compressed GEO radius; ground sites sit on real city coordinates. */
const TECH_KIND: Record<string, K1InfrastructureKind> = {
  solar: 'solar_farm', wind: 'wind_array', fusion: 'fusion_plant', fission: 'fission_plant', geothermal: 'geothermal', orbital_solar: 'orbital_collector',
};

/** Adapt the authoritative regional-grid view to the infrastructure renderer. */
function gridToScene(v: K1GridView): K1Output {
  const n = Math.max(1, v.facilities.length);
  const infrastructure: K1InfrastructureNode[] = v.facilities.map((f, i) => ({
    id: f.id, kind: TECH_KIND[f.technology] ?? 'solar_farm', label: f.label, latDeg: f.latDeg, lonDeg: f.lonDeg,
    altitudeM: f.technology === 'orbital_solar' ? 3.6e7 : 0, capacityW: f.capacityW * Math.max(0.05, f.construction), buildOrder: i / n,
  }));
  const gridNetwork: { fromId: string; toId: string }[] = [];
  for (const r of v.regions) {
    infrastructure.push({ id: `hub.${r.id}`, kind: 'rectenna', label: `${r.name} grid hub`, latDeg: r.centroid[0], lonDeg: r.centroid[1], altitudeM: 0, capacityW: 0, buildOrder: 0.9 });
  }
  for (const f of v.facilities) gridNetwork.push({ fromId: f.id, toId: `hub.${f.regionId}` });
  for (const l of v.links) gridNetwork.push({ fromId: `hub.${l.from}`, toId: `hub.${l.to}` });
  const t = v.totals;
  return {
    infrastructure, gridNetwork, powerMultiple: t.baselineW > 0 ? (t.baselineW + t.usefulW) / t.baselineW : 1,
    albedo: v.climate.albedo, baselineAlbedo: v.climate.baselineAlbedo, climate: { kind: v.climate.kind, magnitude: v.climate.magnitude },
  } as unknown as K1Output;
}

/** Regional supply/demand after HVDC trade: the K1 "who has a surplus" readout. */
function RegionBadges({ grid }: { grid: K1GridView }) {
  const select = useUi((s) => s.select);
  const selected = useUi((s) => s.selection?.id);
  return (
    <>
      {grid.regions.map((r) => {
        const p = latLonToVec3(r.centroid[0], r.centroid[1], R * 1.06);
        const col = r.status === 'surplus' ? '#7dffb6' : r.status === 'deficit' ? '#ff6b7a' : '#ffcf5c';
        const net = r.exportsW > 0 ? r.localBalanceW : r.balanceW;
        return (
          <Html key={r.id} position={[p.x, p.y, p.z]} center zIndexRange={[30, 0]}>
            <button
              onClick={() => select({ kind: 'region', id: `region.${r.id}`, label: r.name, level: 'k1' })}
              style={{
                all: 'unset', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.05em', whiteSpace: 'nowrap',
                padding: '3px 7px', borderRadius: 6, color: col, background: 'rgba(4,8,18,0.72)', border: `1px solid ${selected === `region.${r.id}` ? col : 'rgba(255,255,255,0.12)'}`,
                boxShadow: `0 0 12px ${col}33`,
              }}
            >
              {r.name} · {r.status === 'surplus' ? '▲' : r.status === 'deficit' ? '▼' : '='} {formatPower(Math.abs(net))}
              {r.exportsW > 0 ? ` · exports ${formatPower(r.exportsW)}` : r.importsW > 0 ? ` · imports ${formatPower(r.importsW)}` : ''}
            </button>
          </Html>
        );
      })}
    </>
  );
}

function nodePosition(n: K1InfrastructureNode): THREE.Vector3 {
  if (n.altitudeM > 1e6) return latLonToVec3(n.latDeg, n.lonDeg, GEO_R);
  return latLonToVec3(n.latDeg, n.lonDeg, R * 1.003);
}

function Infrastructure({ k1, pulse, preview }: { k1: K1Output; pulse: number; preview: boolean }) {
  const t0 = useRef(performance.now());
  useEffect(() => {
    t0.current = performance.now();
  }, [pulse]);
  const progress = useRef(preview ? 1 : 0);

  const ground = useMemo(() => k1.infrastructure.filter((n) => n.altitudeM < 1e6 && n.kind !== 'space_elevator'), [k1]);
  const orbital = useMemo(() => k1.infrastructure.filter((n) => n.kind === 'orbital_collector'), [k1]);
  const maxCap = useMemo(() => Math.max(1, ...ground.map((n) => n.capacityW)), [ground]);

  /* --- ground sites: instanced hex towers + glow points --- */
  const towers = useRef<THREE.InstancedMesh>(null);
  const towerGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.018, 0.026, 1, 6);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const towerMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const glowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(ground.length * 3);
    const col = new Float32Array(ground.length * 3);
    const size = new Float32Array(ground.length);
    const order = new Float32Array(ground.length);
    ground.forEach((n, i) => {
      const p = latLonToVec3(n.latDeg, n.lonDeg, R * 1.01);
      pos.set([p.x, p.y, p.z], i * 3);
      const c = new THREE.Color(KIND_COLOR[n.kind]);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 6 + 16 * Math.sqrt(n.capacityW / maxCap);
      order[i] = n.buildOrder;
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
    return g;
  }, [ground, maxCap]);
  const glowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
        uniforms: { progress: { value: 0 }, time: { value: 0 } },
        vertexShader: `attribute float aSize; attribute float aOrder; uniform float progress; uniform float time; varying vec3 vC; varying float vA;
          void main(){ vC = color; float s = clamp((progress - aOrder*0.7)*4.0, 0.0, 1.0); vA = s;
          float flare = 1.0 + 2.5*exp(-pow((progress - aOrder*0.7 - 0.12)*12.0, 2.0));
          vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*s*flare*(1.0+0.12*sin(time*3.0+aOrder*40.0))*(9.0/-mv.z);
          gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; void main(){ float r=length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard;
          float a = exp(-r*r*6.0); gl_FragColor = vec4(vC*a*2.2, a*vA); }`,
      }),
    [],
  );

  /* --- grid arcs + beams with flowing pulses --- */
  const byId = useMemo(() => new Map(k1.infrastructure.map((n) => [n.id, n])), [k1]);
  const arcGeo = useMemo(() => buildArcs(k1, byId, false), [k1, byId]);
  const beamGeo = useMemo(() => buildArcs(k1, byId, true), [k1, byId]);
  const arcMat = useMemo(() => flowMaterial('#5ce1ff', 0.55), []);
  const beamMat = useMemo(() => flowMaterial('#9fe6ff', 1.6), []);

  /* --- orbital collectors --- */
  const panels = useRef<THREE.InstancedMesh>(null);
  const panelGeo = useMemo(() => new THREE.BoxGeometry(0.1, 0.004, 0.055), []);
  const panelMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fe6ff').multiplyScalar(1.6), toneMapped: false }), []);
  const ring = k1.infrastructure.find((n) => n.kind === 'orbital_ring');
  const elevator = k1.infrastructure.find((n) => n.kind === 'space_elevator');
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ec8ff').multiplyScalar(1.4), transparent: true, opacity: 0.8, toneMapped: false }), []);

  useEffect(() => {
    const m = towers.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    ground.forEach((n, i) => {
      const p = latLonToVec3(n.latDeg, n.lonDeg, R * 1.001);
      dummy.position.copy(p);
      dummy.quaternion.setFromUnitVectors(up, p.clone().normalize());
      dummy.scale.set(1, 0.0001, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, new THREE.Color(KIND_COLOR[n.kind]).multiplyScalar(1.6));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [ground]);

  useFrame((state) => {
    const elapsed = (performance.now() - t0.current) / 1000;
    progress.current = preview ? 1 : easeOutCubic(elapsed / 3.2);
    const p = progress.current;
    glowMat.uniforms.progress!.value = p;
    glowMat.uniforms.time!.value = state.clock.elapsedTime;
    for (const m of [arcMat, beamMat]) {
      m.uniforms.time!.value = state.clock.elapsedTime;
      m.uniforms.progress!.value = p;
    }
    const tm = towers.current;
    if (tm) {
      const dummy = new THREE.Object3D();
      const up = new THREE.Vector3(0, 1, 0);
      ground.forEach((n, i) => {
        const s = clamp01((p - n.buildOrder * 0.7) * 4);
        const pos = latLonToVec3(n.latDeg, n.lonDeg, R * 1.001);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up, pos.clone().normalize());
        dummy.scale.set(0.75, Math.max(0.0001, s * (0.018 + 0.07 * Math.sqrt(n.capacityW / maxCap))), 0.75);
        dummy.updateMatrix();
        tm.setMatrixAt(i, dummy.matrix);
      });
      tm.instanceMatrix.needsUpdate = true;
    }
    const pm = panels.current;
    if (pm) {
      const dummy = new THREE.Object3D();
      orbital.forEach((n, i) => {
        const s = clamp01((p - n.buildOrder * 0.75) * 4);
        dummy.position.copy(nodePosition(n));
        dummy.lookAt(0, 0, 0);
        dummy.rotateX(Math.PI / 2);
        dummy.scale.setScalar(Math.max(0.0001, s));
        dummy.updateMatrix();
        pm.setMatrixAt(i, dummy.matrix);
      });
      pm.instanceMatrix.needsUpdate = true;
    }
    ringMat.opacity = clamp01((p - 0.6) * 2.5) * 0.85;
  });

  const elevatorTop = elevator ? latLonToVec3(elevator.latDeg, elevator.lonDeg, GEO_R) : null;
  const elevatorBase = elevator ? latLonToVec3(elevator.latDeg, elevator.lonDeg, R) : null;

  return (
    <group>
      <instancedMesh ref={towers} args={[towerGeo, towerMat, ground.length]} frustumCulled={false} />
      <points geometry={glowGeo} material={glowMat} frustumCulled={false} />
      <lineSegments geometry={arcGeo} material={arcMat} frustumCulled={false} />
      <lineSegments geometry={beamGeo} material={beamMat} frustumCulled={false} />
      <instancedMesh ref={panels} args={[panelGeo, panelMat, Math.max(1, orbital.length)]} frustumCulled={false} />
      {ring ? (
        <mesh rotation={[Math.PI / 2, 0, 0]} material={ringMat}>
          <torusGeometry args={[GEO_R, 0.006, 8, 256]} />
        </mesh>
      ) : null}
      {elevatorTop && elevatorBase ? (
        <Line points={[elevatorBase, elevatorTop]} color="#e8f0ff" lineWidth={1.4} transparent opacity={0.75} />
      ) : null}
      {ring ? <Label position={[GEO_R * 0.72, 0.08, -GEO_R * 0.72]} tone="accent">GEO power ring · not to scale</Label> : null}
    </group>
  );
}

function flowMaterial(color: string, speed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: flowVert,
    fragmentShader: flowFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, progress: { value: 0 }, color: { value: new THREE.Color(color) }, speed: { value: speed } },
  });
}

function buildArcs(k1: K1Output, byId: Map<string, K1InfrastructureNode>, beams: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const ts: number[] = [];
  const phase: number[] = [];
  const build: number[] = [];
  const SEG = 28;
  k1.gridNetwork.forEach((e, ei) => {
    const a = byId.get(e.fromId);
    const b = byId.get(e.toId);
    if (!a || !b) return;
    const isBeam = a.kind === 'orbital_collector' || b.kind === 'orbital_collector';
    if (isBeam !== beams) return;
    const pa = nodePosition(a);
    const pb = nodePosition(b);
    const pts: THREE.Vector3[] = [];
    if (isBeam) {
      for (let i = 0; i <= SEG; i++) pts.push(pa.clone().lerp(pb, i / SEG));
    } else {
      const ang = pa.angleTo(pb);
      const lift = 0.02 + ang * 0.22;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const v = pa.clone().normalize().lerp(pb.clone().normalize(), t).normalize();
        pts.push(v.multiplyScalar(R * (1.004 + lift * Math.sin(Math.PI * t))));
      }
    }
    for (let i = 0; i < SEG; i++) {
      pos.push(pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[i + 1]!.x, pts[i + 1]!.y, pts[i + 1]!.z);
      ts.push(i / SEG, (i + 1) / SEG);
      phase.push(ei * 0.137, ei * 0.137);
      const o = Math.min(a.buildOrder, b.buildOrder) * 0.7;
      build.push(o, o);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  g.setAttribute('aBuild', new THREE.Float32BufferAttribute(build, 1));
  return g;
}

function Sunshade({ magnitude }: { magnitude: number }) {
  const pos = SUN_DIR.clone().multiplyScalar(9);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), SUN_DIR);
  return (
    <group position={pos} quaternion={q}>
      <mesh>
        <circleGeometry args={[0.6 + 1.6 * magnitude, 64]} />
        <meshBasicMaterial color="#9fb6d8" transparent opacity={0.18 + 0.25 * magnitude} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.58 + 1.6 * magnitude, 0.62 + 1.6 * magnitude, 96]} />
        <meshBasicMaterial color="#5ce1ff" transparent opacity={0.8} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <Label position={[0, 1 + 1.6 * magnitude, 0]} tone="accent">L1 sunshade · scenario lever · not to scale</Label>
    </group>
  );
}
