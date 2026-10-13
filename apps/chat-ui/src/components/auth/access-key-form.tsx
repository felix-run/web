/**
 * The access-key card. Presentational: it owns the field and the focus, never the fetch.
 */

import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Loader2Icon } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef } from 'react';
import { AuthCard } from './auth-card';

export function AccessKeyForm({
  busy,
  value,
  error,
  onValueChange,
  onSubmit,
  footer,
}: {
  busy: boolean;
  value: string;
  error: string | null;
  onValueChange: (next: string) => void;
  onSubmit: (e: FormEvent) => void;
  /** The way back to GitHub sign-in, when the harness offers it. */
  footer?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // A refusal arrives after a check the person may have started from the button, which was
  // disabled while it ran and so dropped focus. Back to the field, selected, to retype.
  useEffect(() => {
    if (!error) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [error]);

  return (
    // The form only mounts once the gate has decided to ask — a missing key, a stored key that
    // failed its check, or a 401 mid-session — so mount is the one moment the person has to type
    // into it, and the card hands the field focus then. Always, not only after a switch.
    <AuthCard
      focusOnMount
      onSubmit={onSubmit}
      description="Enter your access key to open the chat."
      footer={footer}
    >
      <div className="space-y-2">
        {/* The placeholder disappears on the first keystroke, so the field has a label too. */}
        <label htmlFor="gate-key" className="sr-only">
          Access key
        </label>
        <Input
          ref={inputRef}
          id="gate-key"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="Access key"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'gate-error' : undefined}
          // Read-only rather than disabled while the key is checked: a disabled field drops
          // focus, and a rejected key would leave the person tabbing back from the top.
          readOnly={busy}
          aria-busy={busy || undefined}
          className="h-10"
        />
        {error && (
          <p id="gate-error" role="alert" className="text-sm text-state-failed">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-2">
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
        <p className="text-xs text-muted-foreground">
          The key is set by whoever deployed this app (<code>CHAT_UI_KEY</code>). It is stored in
          this browser.
        </p>
      </div>
    </AuthCard>
  );
}
