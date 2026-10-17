import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { ArrowUpFromLineIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { usePromoteVersion } from './queries';
import { RefusalNotice } from './refusal';

/**
 * Offer a version of your own library to the team: the harness copies its files, byte for byte,
 * into the team library as a draft (`source: promoted`) for its review queue. It never publishes,
 * and your skill is unchanged. Only a version that was once published can be promoted.
 */
export function PromoteButton({ name, version }: { name: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const promote = usePromoteVersion();
  const reasonId = useId();
  const done = promote.data;

  if (done) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Promoted as draft <span className="font-mono">{done.version}</span> of the team’s{' '}
        <span className="font-mono">{done.name}</span>.{' '}
        <Link
          className="underline underline-offset-2"
          to={`?skill=${encodeURIComponent(done.name)}&v=${encodeURIComponent(done.version)}&tab=versions`}
        >
          Open it in the team library
        </Link>
      </p>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <ArrowUpFromLineIcon className="size-3.5" /> Promote to the team…
      </Button>
    );
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        promote.mutate({ name, version, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      }}
    >
      <label htmlFor={reasonId} className="block text-xs text-muted-foreground">
        Why the team should have it — the reviewer reads this. It becomes a draft in the team
        library; nothing is published.
      </label>
      <Input size="sm" id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
      {promote.error ? <RefusalNotice error={promote.error} doing="promote this version" /> : null}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={promote.isPending}>
          {promote.isPending ? 'Promoting…' : `Promote ${version}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
