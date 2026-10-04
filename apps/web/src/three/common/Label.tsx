import { Html } from '@react-three/drei';
import type { ReactNode } from 'react';
import { useUi } from '../../state/ui';

interface Props {
  position: [number, number, number];
  children: ReactNode;
  tone?: 'default' | 'accent' | 'amber' | 'violet' | 'muted';
  size?: 'sm' | 'md' | 'lg';
  /** Always show regardless of the global label toggle. */
  force?: boolean;
  offsetY?: number;
}

const COLORS = {
  default: '#e8f0ff',
  accent: '#5ce1ff',
  amber: '#ffb547',
  violet: '#b48cff',
  muted: '#8592b0',
};

/** HUD-styled world-space label (pointer-transparent, depth-independent). */
export function Label({ position, children, tone = 'default', size = 'sm', force, offsetY = 0 }: Props) {
  const show = useUi((s) => s.showLabels);
  if (!show && !force) return null;
  const fs = size === 'lg' ? 13 : size === 'md' ? 11.5 : 10;
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          transform: `translateY(${offsetY - 14}px)`,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: fs,
          letterSpacing: '0.06em',
          color: COLORS[tone],
          whiteSpace: 'nowrap',
          textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          opacity: 0.92,
        }}
      >
        <span style={{ width: 4, height: 4, borderRadius: 4, background: COLORS[tone], boxShadow: `0 0 6px ${COLORS[tone]}` }} />
        {children}
      </div>
    </Html>
  );
}
