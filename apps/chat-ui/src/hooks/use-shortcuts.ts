import { useEffect, useRef } from 'react';
import {
  isMacPlatform,
  isTypingTarget,
  openOverlay,
  route,
  type ShortcutAction,
  type ShortcutState,
} from '@/lib/shortcuts';

/**
 * The shell's one `keydown` listener.
 *
 * Subscribed once, for the life of the shell. The handlers are read through a
 * ref rather than listed as dependencies: they close over state that changes on
 * every render, and a listener re-bound per render is either churn or — if a
 * dependency is missed — a listener acting on state from several renders ago.
 * The same lesson `useSpeechRecognition` paid for.
 */
export function useShortcuts(
  surface: ShortcutState['surface'],
  handlers: Record<ShortcutAction, () => void>,
): void {
  const latest = useRef({ surface, handlers });
  latest.current = { surface, handlers };

  useEffect(() => {
    const mac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      const action = route(event, {
        mac,
        typing: isTypingTarget(event.target),
        overlay: openOverlay(),
        surface: latest.current.surface,
      });
      if (!action) return;
      event.preventDefault();
      latest.current.handlers[action]();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
