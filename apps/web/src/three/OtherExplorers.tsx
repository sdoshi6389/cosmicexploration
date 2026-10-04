import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUi } from '../state/ui';
import { useWorld, type Pose } from '../state/world';

/**
 * Multiplayer: every other explorer in the same scene appears where their camera
 * is, with a view cone pointing at what they are looking at and their name.
 * Poses stream through SpacetimeDB (presence_pose) and are smoothed here.
 */
export function OtherExplorers() {
  const poses = useWorld((s) => s.poses);
  const stop = useUi((s) => s.displayedStop);
  const here = poses.filter((p) => p.stop === stop && p.online && Date.now() - p.updatedAt < 120_000);
  return (
    <>
      {here.map((p) => <Explorer key={p.identityHex} pose={p} />)}
    </>
  );
}

function Explorer({ pose }: { pose: Pose }) {
  const group = useRef<THREE.Group>(null);
  const cone = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const cur = useRef({ p: new THREE.Vector3(...pose.position), t: new THREE.Vector3(...pose.target) });
  const goal = useMemo(() => ({ p: new THREE.Vector3(...pose.position), t: new THREE.Vector3(...pose.target) }), [pose.position, pose.target]);
  const color = useMemo(() => new THREE.Color(pose.color), [pose.color]);
  const jumpTo = useUi((s) => s.jumpTo);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 6);
    cur.current.p.lerp(goal.p, k);
    cur.current.t.lerp(goal.t, k);
    g.position.copy(cur.current.p);
    g.lookAt(cur.current.t);
    // Constant apparent size regardless of scene scale.
    const d = camera.position.distanceTo(cur.current.p);
    g.scale.setScalar(Math.max(1e-6, d * 0.035));
    if (cone.current) cone.current.scale.z = Math.min(6, Math.max(1, cur.current.p.distanceTo(cur.current.t) / (d * 0.035 + 1e-9) * 0.25));
  });
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.35, 24, 16]} />
        <meshBasicMaterial color={color.clone().multiplyScalar(1.8)} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.7, 24, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* view cone: points along the explorer's line of sight (+z after lookAt) */}
      <mesh ref={cone} position={[0, 0, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.45, 1.6, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <Html center position={[0, 1.1, 0]} zIndexRange={[40, 0]}>
        <button
          type="button"
          onClick={() => jumpTo(pose.stop, pose.position, pose.target)}
          title="Jump to their view"
          style={{ all: 'unset', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, padding: '2px 7px', borderRadius: 6, color: pose.color, background: 'rgba(4,8,18,0.75)', border: `1px solid ${pose.color}`, whiteSpace: 'nowrap' }}
        >
          {pose.displayName}
        </button>
      </Html>
    </group>
  );
}
