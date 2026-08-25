/**
 * Shared-key gate. Wraps the app: until a valid access key is entered, the
 * chat UI is replaced by a key prompt. The key is checked against the proxy
 * Worker's `CHAT_UI_KEY` secret (via the `x-chat-key` header) by issuing a
 * cheap `GET /api/v1/models` — 200 unlocks, 401 shows an error.
 *
 * Skipped in `vite dev`: there the Vite proxy talks to Felix directly, the
 * proxy Worker (and its secret) isn't in the loop, so there's nothing to gate.
 * That branch lives in main.tsx (so this component's hooks stay unconditional).
 */

import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Loader2Icon } from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { getApiKey, setApiKey, setUnauthorizedHandler } from '@/lib/auth';

type Phase = 'checking' | 'locked' | 'open';

async function keyWorks(): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/models', {
      headers: { ...(getApiKey() ? { 'x-chat-key': getApiKey() as string } : {}) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function Gate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(getApiKey() ? 'checking' : 'locked');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setError('That key was rejected. Try again.');
      setPhase('locked');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (phase !== 'checking') return;
    let alive = true;
    keyWorks().then((ok) => {
      if (alive) setPhase(ok ? 'open' : 'locked');
    });
    return () => {
      alive = false;
    };
  }, [phase]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const key = value.trim();
      if (!key || submitting) return;
      setSubmitting(true);
      setError(null);
      setApiKey(key);
      const ok = await keyWorks();
      setSubmitting(false);
      if (ok) {
        setValue('');
        setPhase('open');
      } else {
        setError('That key was rejected. Try again.');
      }
    },
    [value, submitting],
  );

  if (phase === 'open') return <>{children}</>;

  const busy = submitting || phase === 'checking';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-composer)]"
      >
        <div className="space-y-1.5">
          {/* Only the wordmark is set in caps, and via CSS — the heading's text
              content stays "Felix chat" for the accessible name. */}
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="uppercase tracking-wider">Felix</span> chat
          </h1>
          <p className="text-sm text-muted-foreground">
            {phase === 'checking'
              ? 'Checking your access key…'
              : 'Enter your access key to open the chat.'}
          </p>
        </div>
        <div className="space-y-2">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Access key"
            autoFocus={phase === 'locked'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'gate-error' : undefined}
            disabled={busy}
            className="h-10"
          />
          {error && (
            <p id="gate-error" className="text-sm text-state-failed">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" className="h-10 w-full" disabled={busy || !value.trim()}>
          {busy ? (
            <>
              <Loader2Icon className="size-4 animate-spin" />
              Checking…
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </form>
    </div>
  );
}
