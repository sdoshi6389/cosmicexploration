import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useTable } from '../../state/selectors';
import { Label } from '../common/Label';
import { icrfToScene } from '../common/util';

const MPC_PER_UNIT = 4;

export function CosmicWebScene() {
  const gals = useTable('sdss_galaxy');
  const geo = useMemo(() => {
    const n = gals.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const near = new THREE.Color('#9fd8ff');
    const far = new THREE.Color('#ff9a6a');
    let zmax = 0;
    for (const g of gals) zmax = Math.max(zmax, g.redshift);
    gals.forEach((g, i) => {
      const [x, y, z] = icrfToScene(g.xMpc, g.yMpc, g.zMpc);
      pos.set([x / MPC_PER_UNIT, y / MPC_PER_UNIT, z / MPC_PER_UNIT], i * 3);
      const c = near.clone().lerp(far, g.redshift / (zmax || 1));
      col.set([c.r, c.g, c.b], i * 3);
      const mag = g.petroMagR ?? 17.5;
      size[i] = 1.2 + Math.max(0, 18 - mag) * 0.55;
    });
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    b.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    return b;
  }, [gals]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aSize; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = clamp(aSize*(70.0/-mv.z), 1.0, 9.0); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vC; void main(){ float r = length(gl_PointCoord-0.5)*2.0; if(r>1.0) discard; float a = exp(-r*r*5.0);
          gl_FragColor = vec4(vC*a*1.3, a*0.85); }`,
      }),
    [],
  );
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.012;
  });
  const shells = [100, 200, 300, 400, 500];
  return (
    <group ref={group}>
      <points geometry={geo} material={mat} frustumCulled={false} />
      {shells.map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r / MPC_PER_UNIT - 0.08, r / MPC_PER_UNIT + 0.08, 160]} />
          <meshBasicMaterial color="#5ce1ff" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {shells.map((r) => (
        <Label key={`l${r}`} position={[r / MPC_PER_UNIT, 0, 0]} tone="muted">{r} Mpc</Label>
      ))}
      <mesh>
        <sphereGeometry args={[0.6, 24, 24]} />
        <meshBasicMaterial color={new THREE.Color('#5ce1ff').multiplyScalar(3)} toneMapped={false} />
      </mesh>
      <Label position={[0, 0.8, 0]} tone="accent" size="md" force>Milky Way (you are here)</Label>
      <Label position={[0, -6, 0]} tone="muted" force>
        SDSS DR18 · {gals.length.toLocaleString()} spectroscopic galaxies · distance from redshift (Planck18, derived)
      </Label>
    </group>
  );
}
