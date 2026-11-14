import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router';
import { clearNotification, setPresence } from '@/lib/conversation/presence';
import { resyncPush } from '@/lib/push';

export function useShellPresence(blockedAnywhere: boolean, workingAnywhere: boolean) {
  useEffect(() => {
    if (blockedAnywhere) setPresence('blocked');
    else if (workingAnywhere) setPresence('working');
    else setPresence('idle');
  }, [blockedAnywhere, workingAnywhere]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') clearNotification();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

export function usePushNavigation(navigate: NavigateFunction) {
  /**
   * A tapped push notification, routed by the router rather than by a reload.
   *
   * `sw.js` asks an open window to move instead of navigating it, because a reload drops the
   * connection of a run in flight. Only same-app paths are followed. And on load, tell the
   * harness about a subscription this device already holds (`resyncPush` says why).
   */
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: unknown } | null;
      if (data?.type !== 'felix:open' || typeof data.path !== 'string') return;
      if (!data.path.startsWith('/') || data.path.startsWith('//')) return;
      event.ports[0]?.postMessage('ok');
      navigate(data.path);
    };
    sw.addEventListener('message', onMessage);
    void resyncPush();
    return () => sw.removeEventListener('message', onMessage);
  }, [navigate]);
}
