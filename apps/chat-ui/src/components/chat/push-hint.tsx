import { Button } from '@felix/ui/button';
import { BellIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isStandalone } from '@/lib/platform';
import {
  currentSubscription,
  enablePush,
  loadPushKey,
  PUSH_CHANGED,
  pushCapability,
} from '@/lib/push';

/**
 * One line, inside the installed app, offering a notification when a run is waiting on you.
 *
 * The install line's other half: on iOS a push can reach only a web app on the Home Screen,
 * so this appears once the app is installed and never in a tab, which also keeps the two
 * lines from showing together. It offers only what will work: the deployment pushes (its key
 * loaded), the device can subscribe, permission has not been refused, and this device holds
 * no subscription — including one just dropped because the deployment's key changed, which
 * is why "allowed" alone does not hide it. Turning it off afterwards is the system's notification
 * setting for the app; the push service then refuses the next send and the harness forgets
 * the device. Gone for good once dismissed with ×; turning it on only hides it while the
 * subscription lasts.
 */

// Not `felix.pushHint`: the first build wrote that on a successful Turn on as well as on ×, so on
// every device that turned notifications on it would hide the line for good — including after
// a key change dropped the subscription. A new name forgets those; a deliberate × costs the
// person seeing the line once more.
const DISMISSED_KEY = 'felix.pushHint.dismissed';

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
    Notification.permission !== 'denied';

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const check = async () => {
      if (await currentSubscription().catch(() => null)) {
        if (!cancelled) setKey(null);
        return;
      }
      const loaded = await loadPushKey();
      if (!cancelled) setKey(loaded);
    };
    void check();
    const onChange = () => void check();
    window.addEventListener(PUSH_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(PUSH_CHANGED, onChange);
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
            // On: the subscription now exists, which is what hides the line. Not a dismissal,
            // or a later key change could never offer it again.
            if (result === 'on') {
              setKey(null);
              setState('idle');
            } else setState(result);
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
