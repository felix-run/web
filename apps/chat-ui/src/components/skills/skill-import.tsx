import {
  isSkillLibraryError,
  type SkillDiff,
  type SkillImportResult,
  type SkillSourceItem,
  type SkillSourceListing,
  type SkillVersion,
} from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { DownloadIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { browseSkillSource } from '@/api';
import { PageSection } from '@/components/harness/panel';
import { tsToMs } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';
import { useImportActions, useOutdatedSkills, useSourceCheck } from './queries';
import { RefusalNotice } from './refusal';
import { ago } from './skill-status';

const day = (ts: number) => new Date(tsToMs(ts)).toLocaleDateString();

/**
 * What an import moved, said beside what it left out: a folder the bundle has no place for is
 * kept under `references/`, and a reviewer reading the draft should know why its files sit there.
 * Named by folder when every move came from one or two, counted otherwise.
 */
export function movedLine(moved: Record<string, string> | undefined): string {
  const sources = Object.keys(moved ?? {});
  if (sources.length === 0) return '';
  const folders = [...new Set(sources.map((p) => (p.includes('/') ? `${p.split('/')[0]}/` : p)))];
  const n = sources.length;
  const files = `${n} ${n === 1 ? 'file' : 'files'}`;
  // Text goes under references/, a binary asset under assets/: name where they actually went.
  const into = [...new Set(Object.values(moved ?? {}).map((p) => `${p.split('/')[0]}/`))]
    .sort()
    .reverse()
    .join(' and ');
  return folders.length <= 2
    ? ` · moved ${folders.join(' and ')} (${files}) under ${into}`
    : ` · moved ${files} under ${into}`;
}

/**
 * Import a skill from GitHub: name a source, see what it offers, import one as a draft.
 *
 * Browsing is read-only but not free — each is a GitHub request against the tenant's hourly
 * budget, and it starts the clock on the import age for the files it sees — so it is a button.
 * An import is always a draft: the gate judges imported text as an import, and a person reads
 * it before anything is published.
 */
export function ImportSection({ linkTo }: { linkTo: (name: string, version?: string) => string }) {
  const [source, setSource] = useState('');
  const [ref, setRef] = useState('');
  const [listing, setListing] = useState<SkillSourceListing | null>(null);
  const [browseError, setBrowseError] = useState<unknown>(null);
  const [browsing, setBrowsing] = useState(false);
  const { importOne } = useImportActions();
  const [imported, setImported] = useState<Record<string, SkillImportResult>>({});
  const sourceId = useId();
  const refId = useId();

  async function browse() {
    setBrowsing(true);
    setBrowseError(null);
    try {
      setListing(await browseSkillSource(source.trim(), ref.trim() || undefined));
    } catch (err) {
      setListing(null);
      setBrowseError(err);
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <PageSection title="Import from GitHub">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (source.trim()) void browse();
        }}
      >
        <div className="min-w-[16rem] flex-1 space-y-1">
          <label htmlFor={sourceId} className="block text-xs text-muted-foreground">
            Source — <span className="font-mono">github:owner/repo</span>, optionally{' '}
            <span className="font-mono">/path</span>
          </label>
          <Input
            id={sourceId}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="font-mono"
            autoComplete="off"
          />
        </div>
        <div className="w-36 space-y-1">
          <label htmlFor={refId} className="block text-xs text-muted-foreground">
            Branch, tag or commit
          </label>
          <Input
            id={refId}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="default"
            className="font-mono"
            autoComplete="off"
          />
        </div>
        <Button type="submit" size="sm" disabled={browsing || !source.trim()}>
          {browsing ? 'Looking…' : 'Browse'}
        </Button>
      </form>
      {browseError ? (
        <div className="mt-2">
          <RefusalNotice error={browseError} doing="read that source" />
        </div>
      ) : null}
      {listing && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {listing.found} {listing.found === 1 ? 'skill' : 'skills'} at{' '}
            <span className="font-mono">{listing.ref}</span>{' '}
            <span className="font-mono" title={listing.commit}>
              ({listing.commit.slice(0, 7)})
            </span>
            {listing.license ? ` · ${listing.license}` : ' · no license declared'}
            {listing.truncated ? ` · the first ${listing.items.length} shown` : ''}
            {listing.min_age_days > 0
              ? ` · files must have been seen for ${listing.min_age_days} days before import`
              : ''}
          </p>
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {listing.items.map((item) => (
              <SourceRow
                key={item.source}
                item={item}
                result={imported[item.source]}
                pending={importOne.isPending && importOne.variables?.source === item.source}
                onImport={() =>
                  importOne.mutate(
                    { source: item.source, ...(ref.trim() ? { ref: ref.trim() } : {}) },
                    { onSuccess: (r) => setImported((was) => ({ ...was, [item.source]: r })) },
                  )
                }
                linkTo={linkTo}
              />
            ))}
          </ul>
          {importOne.error ? (
            <RefusalNotice error={importOne.error} doing="import that skill" />
          ) : null}
        </div>
      )}
    </PageSection>
  );
}

function SourceRow({
  item,
  result,
  pending,
  onImport,
  linkTo,
}: {
  item: SkillSourceItem;
  result?: SkillImportResult;
  pending: boolean;
  onImport: () => void;
  linkTo: (name: string, version?: string) => string;
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-mono font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">{item.description}</p>
        <p className="font-mono text-xs text-muted-foreground">{item.path}</p>
      </div>
      {result ? (
        <p className="text-xs text-muted-foreground" role="status">
          {result.unchanged ? 'Already the newest version, ' : 'Imported as draft '}
          <Link className="underline underline-offset-2" to={linkTo(result.name, result.version)}>
            {result.version}
          </Link>
          {movedLine(result.relocated_files)}
          {result.dropped_files.length
            ? ` · left out ${result.dropped_files.length} ${result.dropped_files.length === 1 ? 'file' : 'files'}`
            : ''}
        </p>
      ) : item.eligible ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={onImport}>
          <DownloadIcon className="size-3.5" /> {pending ? 'Importing…' : 'Import as draft'}
        </Button>
      ) : (
        // Said, not refused on click: the harness would answer 403 `too_recent` and save nothing.
        <p className="text-xs text-muted-foreground">
          Can be imported from {day(item.eligible_at)}
        </p>
      )}
    </li>
  );
}

/**
 * Imported skills and whether their sources moved. Read from what the harness last recorded;
 * Check now re-asks GitHub for every listed skill, which spends the hourly budget, so it is
 * never automatic.
 */
export function UpdatesSection({ linkTo }: { linkTo: (name: string, version?: string) => string }) {
  const [refresh, setRefresh] = useState(0);
  const query = useOutdatedSkills(refresh);
  const items = [...(query.data?.items ?? [])].sort(
    (a, b) => Number(!!b.update_available) - Number(!!a.update_available),
  );
  // No imported skills, or a harness without the route: nothing to say.
  if (query.data && items.length === 0) return null;
  if (isSkillLibraryError(query.error) && query.error.status === 404) return null;
  const moved = items.filter((i) => i.update_available).length;
  return (
    <PageSection
      title="Imported skills"
      meta={query.data ? (moved ? `${moved} with changes at the source` : 'up to date') : undefined}
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCwIcon
            className={cn('size-3.5', query.isFetching && 'motion-safe:animate-spin')}
          />{' '}
          Check now
        </Button>
      }
    >
      {query.error ? <RefusalNotice error={query.error} doing="check the sources" /> : null}
      {query.data?.stopped && (
        <p className="mb-2 text-xs text-muted-foreground">
          {query.data.stopped === 'rate_limited'
            ? 'Stopped early: this tenant’s GitHub allowance for the hour is used up.'
            : 'Stopped early: the check took too long. The rest show what was last recorded.'}
        </p>
      )}
      <ul className="divide-y divide-border/60 border-y border-border/60">
        {items.map((s) => (
          <li key={s.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
            <Link
              className="font-mono font-medium underline-offset-2 hover:underline"
              to={linkTo(s.name)}
            >
              {s.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{s.origin_source}</span>
            <span
              className={cn(
                'ml-auto text-xs',
                s.error
                  ? 'text-state-failed'
                  : s.update_available
                    ? 'text-state-blocked'
                    : 'text-muted-foreground',
              )}
            >
              {s.error
                ? `check failed: ${s.error}`
                : s.update_available
                  ? s.eligible === false && s.eligible_at
                    ? `changed · can be taken from ${day(s.eligible_at)}`
                    : 'changed at the source'
                  : 'up to date'}
              {s.checked_at ? ` · checked ${ago(s.checked_at)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}

/**
 * An imported skill's source, checked on request against its newest version: the files that
 * differ, as diffs, and — when the source has moved and the import age allows — pulling it in
 * as a new draft. Third-party text, so it is drawn as text and nothing in it is rendered.
 */
export function SourceCheck({
  name,
  linkTo,
}: {
  name: string;
  linkTo: (name: string, version?: string) => string;
}) {
  const [asked, setAsked] = useState(false);
  const check = useSourceCheck(name, asked);
  const { update } = useImportActions();
  const data = check.data;
  if (!asked) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setAsked(true)}>
        <RefreshCwIcon className="size-3.5" /> Check the source
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3 text-sm">
      {check.isFetching && !data ? (
        <p className="text-xs text-muted-foreground">Checking…</p>
      ) : null}
      {check.error ? <RefusalNotice error={check.error} doing="check the source" /> : null}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{data.upstream.source}</span> at{' '}
            <span className="font-mono">{data.upstream.ref}</span>{' '}
            <span className="font-mono" title={data.upstream.commit}>
              ({data.upstream.commit.slice(0, 7)})
            </span>{' '}
            against <span className="font-mono">{data.current.version}</span>
          </p>
          {data.update_available ? (
            <>
              <FileChanges diff={data.diff} />
              {update.data ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {update.data.unchanged ? 'Nothing new to save.' : 'Saved as draft '}
                  {!update.data.unchanged && (
                    <Link
                      className="underline underline-offset-2"
                      to={linkTo(update.data.name, update.data.version)}
                    >
                      {update.data.version}
                    </Link>
                  )}
                </p>
              ) : data.upstream.eligible ? (
                <Button size="sm" disabled={update.isPending} onClick={() => update.mutate(name)}>
                  {update.isPending ? 'Saving…' : 'Save the source’s version as a draft'}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  These files can be taken from {day(data.upstream.eligible_at)}.
                </p>
              )}
              {update.error ? (
                <RefusalNotice error={update.error} doing="update from the source" />
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">The source has not changed.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The files a source changes, each a unified diff drawn as text with its lines tinted. */
export function FileChanges({ diff }: { diff: SkillDiff }) {
  return (
    <div className="space-y-2">
      {diff.files.map((f) => (
        <details
          key={f.path}
          className="rounded border border-border/60"
          open={diff.files.length <= 3}
        >
          <summary className="cursor-pointer px-2 py-1 font-mono text-xs">
            {f.path} <span className="text-muted-foreground">· {f.change}</span>
          </summary>
          {f.binary ? (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Binary: {f.old_size ?? 0} → {f.new_size ?? 0} bytes
            </p>
          ) : f.diff ? (
            <pre className="max-h-80 overflow-auto px-2 pb-2 font-mono text-xs leading-snug">
              {f.diff.split('\n').map((line, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                  key={i}
                  className={cn(
                    'block',
                    line.startsWith('+') && !line.startsWith('+++') && 'bg-state-done/10',
                    line.startsWith('-') && !line.startsWith('---') && 'bg-state-failed/10',
                  )}
                >
                  {line || ' '}
                </span>
              ))}
              {f.truncated ? (
                <span className="block text-muted-foreground">… cut short</span>
              ) : null}
            </pre>
          ) : (
            <p className="px-2 pb-2 text-xs text-muted-foreground">Too large to show as a diff.</p>
          )}
        </details>
      ))}
      {diff.diff_truncated ? (
        <p className="text-xs text-muted-foreground">More files differ than are shown.</p>
      ) : null}
    </div>
  );
}

/**
 * Vouch for an imported version: a new draft of the same files that no longer counts as an
 * import. The reason is required — it is recorded on the version and in the audit — and the
 * draft still waits to be published like any other.
 */
export function AdoptButton({ version: v }: { version: SkillVersion }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { adopt } = useImportActions();
  const reasonId = useId();
  if (adopt.data) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Adopted as draft <span className="font-mono">{adopt.data.version}</span>.
      </p>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <ShieldCheckIcon className="size-3.5" /> Adopt…
      </Button>
    );
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim())
          adopt.mutate({ name: v.name, version: v.version, reason: reason.trim() });
      }}
    >
      <label htmlFor={reasonId} className="block text-xs text-muted-foreground">
        Why you vouch for these files — recorded with the adoption. It becomes a draft that no
        longer counts as an import; nothing is published.
      </label>
      <Input size="sm" id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
      {adopt.error ? <RefusalNotice error={adopt.error} doing="adopt this version" /> : null}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={adopt.isPending || !reason.trim()}>
          {adopt.isPending ? 'Adopting…' : `Adopt ${v.version}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
