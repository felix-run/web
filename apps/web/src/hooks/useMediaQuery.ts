import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` so the first paint
 * already knows the answer. The rails switch between an inline column and an
 * overlay sheet on this value, and a wrong first render would mount the panel in
 * the wrong place and then move it, which for a sheet means an entrance animation
 * firing on load.
 *
 * The server snapshot reports `false`, so a non-browser render (tests under
 * happy-dom without `matchMedia`, or any future prerender) gets the narrow layout,
 * where every surface is still reachable.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia?.(query);
      if (!mq) return () => {};
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
