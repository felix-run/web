/**
 * Shared-key gate. Wraps the app: until a valid access key is entered, the
 * chat UI is replaced by a key prompt. The key is checked against the proxy
 * Worker's `CHAT_UI_KEY` secret (via the `x-chat-key` header) by issuing a
 * cheap `GET /api/v1/models` — 200 unlocks, anything else explains itself.
 *
 * This is an access gate, not user authentication: the harness has no user or
 * session concept, and every browser holding the key is the same principal
 * with the same tenant. Nothing here should read as an account.
 *
 * Skipped in `vite dev`: there the Vite proxy talks to Felix directly, the
 * proxy Worker (and its secret) isn't in the loop, so there's nothing to gate.
 * That branch lives in main.tsx (so this component's hooks stay unconditional).
 */

import { Spinner } from '@felix/ui/spinner';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { getApiKey, setApiKey, setUnauthorizedHandler } from '@/lib/auth';
import { AccessKeyForm } from './auth/access-key-form';
import { AuthLayout } from './auth/auth-layout';

/**
 * `checking` is a stored key being verified, and it must draw nothing that
 * looks like a decision. It used to render the key prompt with the field
 * disabled, so every returning visitor saw the login screen for one round
 * trip before the chat replaced it — a flash that read as "logged out" on a
 * page that was about to open. The prompt is only right once the key is known
 * to be missing or rejected.
 */
type Phase = 'checking' | 'locked' | 'open';

/**
 * How long the check may run before the holding surface admits it is waiting.
 * A probe that returns inside this shows nothing at all, which is the point:
 * a spinner that appears for 80ms and vanishes is itself a flash. Past it, a
 * slow proxy gets a "still working" signal rather than a blank page.
 */
const HOLDING_SPINNER_DELAY_MS = 400;

/**
 * The full-viewport surface drawn while a stored key is checked. Same box as
 * <AuthLayout /> (`min-h-svh bg-background`) so the swap to either the app or
 * the prompt does not shift the page behind it.
 */
function Holding() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(true), HOLDING_SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background">
      {waiting && <Spinner className="size-5 text-muted-foreground" />}
    </div>
  );
}

/**
 * Why the probe carries a reason rather than a boolean: a swallowed network
 * error and a rejected key both used to collapse into `false`, so a laptop
 * that woke up offline showed the prompt with no message at all — identical
 * to having forgotten the key, and wrong about whose fault it was.
 */
type Probe =
  | { ok: true }
  | { ok: false; reason: 'rejected' | 'offline' | 'unconfigured' | 'error'; status?: number };

async function probe(): Promise<Probe> {
  const key = getApiKey();
  let res: Response;
  try {
    res = await fetch('/api/v1/models', {
      headers: { ...(key ? { 'x-chat-key': key } : {}) },
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'rejected' };
  if (res.status === 502) {
    // The Worker's own "I have no upstream" reply. Worth separating: no key
    // will ever fix it, and the reader of this screen is the one who deploys.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'felix_origin_unset') return { ok: false, reason: 'unconfigured' };
  }
  return { ok: false, reason: 'error', status: res.status };
}

function probeMessage(result: Extract<Probe, { ok: false }>): string {
  switch (result.reason) {
    case 'rejected':
      return 'That key was rejected. Try again.';
    case 'offline':
      return 'Could not reach the server. Check your connection and try again.';
    case 'unconfigured':
      return 'The proxy is not configured — FELIX_ORIGIN is unset.';
    default:
      return `Could not verify the key (${result.status}).`;
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
    probe().then((result) => {
      if (!alive) return;
      if (result.ok) {
        setPhase('open');
      } else {
        setError(probeMessage(result));
        setPhase('locked');
      }
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
      const result = await probe();
      setSubmitting(false);
      if (result.ok) {
        setValue('');
        setPhase('open');
      } else {
        setError(probeMessage(result));
      }
    },
    [value, submitting],
  );

  if (phase === 'open') return <>{children}</>;
  if (phase === 'checking') return <Holding />;

  return (
    <AuthLayout>
      <AccessKeyForm
        busy={submitting}
        value={value}
        error={error}
        onValueChange={setValue}
        onSubmit={submit}
      />
    </AuthLayout>
  );
}
