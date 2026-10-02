import { Button } from '@felix/ui/button';
import { Share, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from '@/lib/platform';

/**
 * One line offering to install the app, on a phone or tablet, once.
 *
 * Installed, chat-ui opens full screen and survives the browser closing its
 * tab, and on iOS it is the only form that can ever receive a notification.
 * Safari has no install prompt a page can raise, so there the line says where
 * the menu item is; Chromium hands the page a prompt (`beforeinstallprompt`),
 * and the line becomes a button for it. Shown only to a touch-first device
 * that is not already installed, never on an empty thread — the first screen
 * is for the agent — and gone for good once dismissed.
 */

const DISMISSED_KEY = 'felix.installHint';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

// Captured at import, not on mount: Chromium fires this once, early, and a
// component that mounts later would never see it.
let deferredPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    for (const l of promptListeners) l();
  });
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallHint() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [prompt, setPrompt] = useState(deferredPrompt);

  useEffect(() => {
    const update = () => setPrompt(deferredPrompt);
    promptListeners.add(update);
    return () => {
      promptListeners.delete(update);
    };
  }, []);

  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  if (dismissed || !touch || isStandalone()) return null;
  const ios = isIOS();
  if (!ios && !prompt) return null;

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
      <p className="min-w-0 flex-1">
        {ios ? (
          <>
            Add Felix to your Home Screen to get a notification when a run is waiting on you: tap{' '}
            <Share aria-label="Share" className="inline size-3.5 align-text-bottom" />, then{' '}
            <span className="text-foreground">Add to Home Screen</span>.
          </>
        ) : (
          'Install Felix to open it full screen, outside the browser.'
        )}
      </p>
      {!ios && prompt && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            void prompt.prompt().finally(() => {
              deferredPrompt = null;
              setPrompt(null);
            });
          }}
        >
          Install
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="coarse:size-10"
        aria-label="Dismiss install suggestion"
        onClick={dismiss}
      >
        <XIcon />
      </Button>
    </div>
  );
}
