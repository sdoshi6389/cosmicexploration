import { useMemo } from 'react';
import * as THREE from 'three';
import { useTable } from '../../state/selectors';
import { useTex } from './util';

/** Panoramic Milky Way backdrop (illustrative, Solar System Scope 8k map), kept dim behind data. */
export function SkySphere({ brightness = 0.5, radius = 2500 }: { brightness?: number; radius?: number }) {
  const textures = useTable('planet_texture');
  const url = textures.find((t) => t.id === 'tex.sky.milky_way.albedo')?.path ?? '/textures/planets/8k_stars_milky_way.jpg';
  const map = useTex(url);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false }), []);
  mat.map = map;
  mat.color = new THREE.Color(brightness, brightness, brightness);
  mat.needsUpdate = true;
  if (!map) return null;
  return (
    <mesh material={mat} rotation={[0.35, 0, 1.05]} renderOrder={-10}>
      <sphereGeometry args={[radius, 64, 32]} />
    </mesh>
  );
}
