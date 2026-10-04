import { CameraControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { sceneFocus } from './focus';
import { useWorld } from '../state/world';
import { OtherExplorers } from './OtherExplorers';
import { STOP_BY_ID, type StopId } from '../navigation/stops';
import { useUi } from '../state/ui';
import { warpEffect } from './effects/WarpEffect';
import { AtomScene } from './scenes/AtomScene';
import { BodyScene } from './scenes/BodyScene';
import { CityScene } from './scenes/CityScene';
import { GridScene } from './scenes/GridScene';
import { TownScene } from './scenes/TownScene';
import { DeviceScene } from './scenes/DeviceScene';
import { LatticeScene } from './scenes/LatticeScene';
import { RoomScene } from './scenes/RoomScene';
import { CellScene } from './scenes/CellScene';
import { CosmicWebScene } from './scenes/CosmicWebScene';
import { EarthScene } from './scenes/EarthScene';
import { GalaxyScene } from './scenes/GalaxyScene';
import { ParticleScene } from './scenes/ParticleScene';
import { SolarScene } from './scenes/SolarScene';

/** `?nofx` disables post-processing (debugging / low-end machines). */
const NO_FX = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nofx');

export const OUT_MS = 820;
export const IN_MS = 1350;

/** Shared camera-controls handle so scenes can request focus moves. */
export const cameraRef: { current: CameraControls | null } = { current: null };

function SceneRouter() {
  const stop = useUi((s) => s.displayedStop);
  const scenes: Record<StopId, JSX.Element> = {
    cosmic: <CosmicWebScene />,
    galaxy: <GalaxyScene />,
    solar: <SolarScene />,
    earth: <EarthScene />,
    town: <TownScene />,
    body: <BodyScene />,
    cell: <CellScene />,
    protein: <CellScene />,
    gene: <CellScene />,
    city: <CityScene />,
    room: <RoomScene />,
    lattice: <LatticeScene />,
    atom: <AtomScene />,
    grid: <GridScene />,
    device: <DeviceScene />,
    particle: <ParticleScene />,
  };
  return <Suspense fallback={null}>{scenes[stop]}</Suspense>;
}

/** Drives the two-phase warp: dolly through the outgoing scene, swap, fly into the new one. */
function CameraRig() {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const outStart = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const arrivalId = useUi((s) => s.arrivalId);
  const displayed = useUi((s) => s.displayedStop);

  // Place the camera on arrival: start far (inward) or near (outward), then glide to rest.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    cameraRef.current = c;
    const stop = STOP_BY_ID[displayed];
    const t = useUi.getState().transition;
    const [px, py, pz] = stop.camera.position;
    const [tx, ty, tz] = stop.camera.target;
    c.minDistance = stop.camera.minDistance;
    c.maxDistance = stop.camera.maxDistance;
    const rest = new THREE.Vector3(px, py, pz);
    const target = new THREE.Vector3(tx, ty, tz);
    const offset = rest.clone().sub(target);
    const factor = !t ? 1.25 : t.direction === 'inward' ? 7 : 0.08;
    const start = target.clone().add(offset.multiplyScalar(factor));
    c.minDistance = Math.min(stop.camera.minDistance, start.distanceTo(target) * 0.9);
    c.maxDistance = Math.max(stop.camera.maxDistance, start.distanceTo(target) * 1.1);
    c.setLookAt(start.x, start.y, start.z, tx, ty, tz, false);
    c.smoothTime = 0.95;
    void c.setLookAt(px, py, pz, tx, ty, tz, true).then(() => {
      c.smoothTime = 0.25;
      c.minDistance = stop.camera.minDistance;
      c.maxDistance = stop.camera.maxDistance;
    });
  }, [arrivalId, displayed]);

  const appliedFocus = useRef(0);
  const appliedJump = useRef(0);
  const lastPose = useRef({ t: 0, key: '' });
  useFrame(() => {
    const ui = useUi.getState();
    const t = ui.transition;
    const c = controls.current;
    // Dynamic clip planes so close-ups (a moon, a single star) and wide views both work.
    if (c) {
      const d = c.distance;
      const near = Math.min(0.01, Math.max(1e-6, d * 0.002));
      if (Math.abs((camera as THREE.PerspectiveCamera).near - near) / near > 0.25) {
        (camera as THREE.PerspectiveCamera).near = near;
        (camera as THREE.PerspectiveCamera).far = Math.max(8000, d * 4000);
        camera.updateProjectionMatrix();
      }
    }
    // Jump to another explorer's exact view once their scene is mounted.
    if (c && !t && ui.cameraJump && ui.cameraJump.nonce !== appliedJump.current && ui.displayedStop === ui.cameraJump.stop) {
      appliedJump.current = ui.cameraJump.nonce;
      const { position: p, target: q } = ui.cameraJump;
      c.minDistance = Math.min(c.minDistance, 1e-4);
      void c.setLookAt(p[0], p[1], p[2], q[0], q[1], q[2], true);
    }
    // Stream this explorer's pose (~4 Hz, only when it changed).
    if (c && !t) {
      const now = performance.now();
      if (now - lastPose.current.t > 250) {
        const pos = new THREE.Vector3();
        const tgt = new THREE.Vector3();
        c.getPosition(pos);
        c.getTarget(tgt);
        const key = `${ui.displayedStop}|${pos.toArray().map((v) => v.toPrecision(4)).join()}|${tgt.toArray().map((v) => v.toPrecision(4)).join()}`;
        if (key !== lastPose.current.key) {
          lastPose.current = { t: now, key };
          useWorld.getState().reportPose(ui.displayedStop, pos.toArray() as [number, number, number], tgt.toArray() as [number, number, number]);
        } else lastPose.current.t = now;
      }
    }
    // Fly to a focused entity once the scene that owns it is mounted.
    if (c && !t && ui.focus && ui.focus.nonce !== appliedFocus.current && sceneFocus.resolve) {
      const f = sceneFocus.resolve(ui.focus.id);
      if (f) {
        appliedFocus.current = ui.focus.nonce;
        const target = new THREE.Vector3(...f.position);
        const pos = new THREE.Vector3();
        c.getPosition(pos);
        const dir = pos.sub(target).normalize();
        if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.4, 0.3, 1).normalize();
        const dist = Math.max(f.radius * 6, 1e-4);
        c.minDistance = Math.min(c.minDistance, dist * 0.2);
        c.smoothTime = 0.8;
        const p2 = target.clone().add(dir.multiplyScalar(dist));
        void c.setLookAt(p2.x, p2.y, p2.z, target.x, target.y, target.z, true).then(() => {
          c.smoothTime = 0.25;
        });
      }
    }
    if (!t || !c) {
      warpEffect.strength = Math.max(0, (warpEffect.uniforms.get('strength')!.value as number) * 0.9);
      warpEffect.flash = 0;
      outStart.current = null;
      return;
    }
    const now = performance.now();
    if (t.phase === 'out') {
      const p = Math.min(1, (now - t.startedAt) / OUT_MS);
      if (!outStart.current) {
        const pos = new THREE.Vector3();
        const target = new THREE.Vector3();
        c.getPosition(pos);
        c.getTarget(target);
        outStart.current = { pos, target };
        c.minDistance = 1e-4;
        c.maxDistance = 1e7;
      }
      const { pos, target } = outStart.current;
      const off = pos.clone().sub(target);
      const k = t.direction === 'inward' ? Math.exp(-4.2 * p * p) : Math.exp(3.4 * p * p);
      const np = target.clone().add(off.multiplyScalar(k));
      c.setPosition(np.x, np.y, np.z, false);
      warpEffect.direction = t.direction === 'inward' ? 1 : -1;
      warpEffect.strength = p * p * 1.25;
      warpEffect.flash = Math.max(0, (p - 0.78) / 0.22) ** 2;
      if (p >= 1) ui.advanceTransition('in');
    } else {
      const p = Math.min(1, (now - t.startedAt) / IN_MS);
      warpEffect.strength = (1 - p) ** 2 * 1.1;
      warpEffect.flash = Math.max(0, 1 - p * 3.2) ** 2;
      if (p >= 1) ui.advanceTransition('done');
    }
    void camera;
  });

  return <CameraControls ref={controls} makeDefault smoothTime={0.25} draggingSmoothTime={0.12} dollySpeed={0.6} />;
}

/** Shift the projection centre so the subject sits in the space between the rail and the console. */
function ViewFraming() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const consoleOpen = useUi((s) => s.consoleOpen);
  useEffect(() => {
    const left = 200;
    const right = consoleOpen ? 420 : 30;
    const shift = Math.round((right - left) / 2);
    camera.setViewOffset(size.width, size.height, shift, 0, size.width, size.height);
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
    };
  }, [camera, size.width, size.height, consoleOpen]);
  return null;
}

function Effects() {
  const quality = useUi((s) => s.quality);
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        intensity={quality === 'low' ? 0.8 : 1.15}
        luminanceThreshold={0.22}
        luminanceSmoothing={0.35}
        radius={0.82}
      />
      <primitive object={warpEffect} dispose={null} />
      <Vignette eskil={false} offset={0.22} darkness={0.72} />
      <Noise premultiply opacity={0.32} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

export function Stage() {
  const quality = useUi((s) => s.quality);
  return (
    <Canvas
      flat
      dpr={quality === 'high' ? [1, 2] : quality === 'medium' ? [1, 1.5] : 1}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, logarithmicDepthBuffer: true }}
      camera={{ fov: 42, near: 0.01, far: 8000, position: [0, 2, 8] }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#02040a']} />
      <CameraRig />
      <ViewFraming />
      <SceneRouter />
      <OtherExplorers />
      {NO_FX ? null : <Effects />}
    </Canvas>
  );
}
