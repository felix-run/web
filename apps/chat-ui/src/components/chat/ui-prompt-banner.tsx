import { Button } from '@felix/ui/button';
import type { PendingUiRequest } from '@/types';

export function UiPromptBanner({
  pending,
  resolving,
  onRespond,
  onCancel,
}: {
  pending: PendingUiRequest;
  resolving: boolean;
  onRespond: (value: unknown) => void;
  onCancel: () => void;
}) {
  const kindLabel =
    pending.kind === 'confirm' ? 'Confirm' : pending.kind === 'select' ? 'Select' : 'Input';

  return (
    <div className="mx-auto mb-3 w-full max-w-2xl rounded-xl border border-primary/40 bg-accent/40 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {kindLabel} required
      </p>
      <h2 className="mt-1 text-sm font-semibold">{pending.prompt}</h2>

      {pending.kind === 'confirm' ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={resolving} onClick={() => onRespond(true)}>
            Yes
          </Button>
          <Button size="sm" variant="outline" disabled={resolving} onClick={() => onRespond(false)}>
            No
          </Button>
          <Button size="sm" variant="ghost" disabled={resolving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}

      {pending.kind === 'select' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {pending.options.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant="outline"
              disabled={resolving}
              onClick={() => onRespond(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" disabled={resolving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}

      {pending.kind === 'input' ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onRespond(String(fd.get('value') ?? ''));
          }}
        >
          <input
            name="value"
            defaultValue={typeof pending.defaultValue === 'string' ? pending.defaultValue : ''}
            disabled={resolving}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            placeholder="Type a response…"
            // biome-ignore lint/a11y/noAutofocus: prompt should grab focus when shown
            autoFocus
          />
          <Button size="sm" type="submit" disabled={resolving}>
            Send
          </Button>
          <Button size="sm" type="button" variant="ghost" disabled={resolving} onClick={onCancel}>
            Cancel
          </Button>
        </form>
      ) : null}
    </div>
  );
}
