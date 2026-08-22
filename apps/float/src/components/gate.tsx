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

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Felix float</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter the access key to continue.</p>
        </div>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          type="password"
          autoComplete="off"
          placeholder="Access key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={submitting || phase === 'checking'}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={submitting || phase === 'checking' || !value.trim()}
        >
          {phase === 'checking' || submitting ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
