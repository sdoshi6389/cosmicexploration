/**
 * Camera focus on any entity. The mounted scene registers a resolver that maps an
 * entity id (body, star, region…) to its scene position and size; the camera rig
 * flies there whenever `useUi.focus` changes.
 */
export interface FocusTarget {
  position: [number, number, number];
  /** Visual radius of the object in scene units (sets the viewing distance). */
  radius: number;
}

export const sceneFocus: { resolve: ((id: string) => FocusTarget | null) | null } = { resolve: null };

import { useEffect } from 'react';

/** Register the mounted scene's resolver (cleared on unmount). */
export function useFocusResolver(resolve: (id: string) => FocusTarget | null, deps: unknown[]): void {
  useEffect(() => {
    sceneFocus.resolve = resolve;
    return () => {
      if (sceneFocus.resolve === resolve) sceneFocus.resolve = null;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
