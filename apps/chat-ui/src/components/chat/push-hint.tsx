import { Button } from '@felix/ui/button';
import { BellIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isStandalone } from '@/lib/platform';
import { currentSubscription, enablePush, loadPushKey, pushCapability } from '@/lib/push';

/**
 * One line, inside the installed app, offering a notification when a run is waiting on you.
 *
 * The install line's other half: on iOS a push can reach only a web app on the Home Screen,
 * so this appears once the app is installed and never in a tab, which also keeps the two
 * lines from showing together. It offers only what will work: the deployment pushes (its key
 * loaded), the device can subscribe, permission has not been decided either way, and this
 * device is not already subscribed. Turning it off afterwards is the system's notification
 * setting for the app; the push service then refuses the next send and the harness forgets
 * the device. Gone for good once dismissed.
 */

const DISMISSED_KEY = 'felix.pushHint';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function PushHint() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [key, setKey] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'asking' | 'denied' | 'failed'>('idle');

  const eligible =
    !dismissed &&
    isStandalone() &&
    pushCapability() === 'available' &&
    Notification.permission === 'default';

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    void (async () => {
      if (await currentSubscription().catch(() => null)) return;
      const loaded = await loadPushKey();
      if (!cancelled) setKey(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  if (!eligible || !key || state === 'denied') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: it comes back next visit, which is the honest outcome.
    }
    setDismissed(true);
  };

  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-4 text-xs text-muted-foreground">
      <BellIcon aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1" role="status">
        {state === 'failed'
          ? "Couldn't turn on notifications. Try again in a moment."
          : 'Get a notification when a run is waiting on you, even with Felix closed.'}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={state === 'asking'}
        onClick={() => {
          setState('asking');
          // Straight from the click: the key is already loaded, so nothing awaits the network
          // before the browser asks.
          void enablePush(key).then((result) => {
            if (result === 'on') dismiss();
            else setState(result);
          });
        }}
      >
        Turn on
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="coarse:size-10"
        aria-label="Dismiss notification suggestion"
        onClick={dismiss}
      >
        <XIcon />
      </Button>
    </div>
  );
}
