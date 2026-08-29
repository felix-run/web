/**
 * The access-key card — the right rail of <AuthLayout />. Presentational: it
 * owns the field and the focus, never the fetch.
 *
 * The card treatment is a deliberate divergence from the client this was
 * ported from, where the form sits directly on the page background because
 * the hero photo's edge supplies the boundary. With no photo — and below
 * `lg` no panel at all — the border and shadow are what give the form an
 * edge at every width.
 */

import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Loader2Icon } from 'lucide-react';
import { type FormEvent, useEffect, useRef } from 'react';

export function AccessKeyForm({
  checking,
  busy,
  value,
  error,
  onValueChange,
  onSubmit,
}: {
  checking: boolean;
  busy: boolean;
  value: string;
  error: string | null;
  onValueChange: (next: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus from an effect rather than the `autoFocus` prop. React only honours
  // `autoFocus` at mount, and the input is already mounted through the
  // `checking` phase — so a stored key that fails its check left the field
  // unfocused, which is the one moment the user has to type into it.
  useEffect(() => {
    if (!checking) inputRef.current?.focus();
  }, [checking]);

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-6 rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-composer)]"
    >
      <div className="space-y-1.5">
        {/* Only the wordmark is set in caps, and via CSS — the heading's text
            content stays "Felix chat" for the accessible name. */}
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="uppercase tracking-wider">Felix</span> chat
        </h1>
        <p className="text-sm text-muted-foreground">
          {checking ? 'Checking your access key…' : 'Enter your access key to open the chat.'}
        </p>
      </div>

      <div className="space-y-2">
        <Input
          ref={inputRef}
          type="password"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="Access key"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'gate-error' : undefined}
          disabled={busy}
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
    </form>
  );
}
