import type { SkillSource, SkillUpstreamState, SkillVersion } from '@felix/client';
import { relativeTime } from '@felix/client';
import {
  ArchiveIcon,
  ArrowUpFromLineIcon,
  BotIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  DownloadIcon,
  TriangleAlertIcon,
  UserIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { tsToMs } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';

/**
 * What a version *is*, in a word. The harness stores three statuses; a reader
 * needs five, and the extra two are already in the row:
 *
 * - `draft`, waiting on a person — the only one that asks for anything, so the
 *   only one in amber;
 * - `live`, the version every unpinned ref reads;
 * - `rejected`, archived by a decision before it was ever published;
 * - `superseded`, archived after being live — what a rollback can bring back;
 * - `archived`, the rest.
 *
 * Each has its own icon *shape* and its word, so none is told apart by colour.
 */
export type VersionState = 'draft' | 'live' | 'rejected' | 'superseded' | 'archived';

export function versionState(
  v: Pick<SkillVersion, 'status' | 'version' | 'published_at' | 'decided_at'>,
  liveVersion: string | null | undefined,
): VersionState {
  if (v.status === 'draft') return 'draft';
  if (v.status === 'published' || v.version === liveVersion) return 'live';
  if (v.published_at != null) return 'superseded';
  if (v.decided_at != null) return 'rejected';
  return 'archived';
}

const STATE = {
  draft: { icon: CircleDashedIcon, tone: 'bg-state-blocked/15 text-state-blocked', word: 'draft' },
  live: { icon: CircleCheckIcon, tone: 'bg-muted text-foreground', word: 'live' },
  rejected: { icon: CircleSlashIcon, tone: 'bg-muted text-muted-foreground', word: 'rejected' },
  superseded: { icon: ArchiveIcon, tone: 'bg-muted text-muted-foreground', word: 'superseded' },
  archived: { icon: ArchiveIcon, tone: 'bg-muted text-muted-foreground', word: 'archived' },
} as const;

export function VersionStateBadge({ state }: { state: VersionState }) {
  const s = STATE[state];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium',
        s.tone,
      )}
    >
      <s.icon aria-hidden className="size-3" />
      {s.word}
    </span>
  );
}

const SOURCE_ICON: Record<string, typeof UserIcon> = {
  agent: BotIcon,
  operator: UserIcon,
  import: DownloadIcon,
  promoted: ArrowUpFromLineIcon,
};

/**
 * Who wrote a version: an agent (`create_skill`/`update_skill`), an operator, an import from a
 * GitHub source, or a promotion of someone's personal skill into this library.
 */
export function SourceLabel({ source, author }: { source: SkillSource; author?: string }) {
  const Icon = SOURCE_ICON[source] ?? UserIcon;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span>{source}</span>
      {author ? (
        <span className="truncate font-mono" title={author}>
          {author}
        </span>
      ) : null}
    </span>
  );
}

export function ago(ts: number | null | undefined): string {
  return ts == null ? '' : relativeTime(tsToMs(ts));
}

/**
 * An age with the moment it counts from: `9h` on screen, the date and time on
 * hover and to a reader, so "waiting 9h" the next morning can be placed
 * against the night it was written.
 */
export function Since({ ts, bare = false }: { ts: number; bare?: boolean }) {
  const at = new Date(tsToMs(ts));
  const text = ago(ts);
  return (
    <time dateTime={at.toISOString()} title={at.toLocaleString()}>
      {bare ? text.replace(' ago', '') : text}
    </time>
  );
}

/**
 * The warning `shadows_operator_upload` asks for, everywhere it is set.
 *
 * An operator uploaded a skill of this name to the object store, at a key a
 * manifest ref reads. Refs that pin no version now get the library's live
 * version; a ref that pins the upload's version still gets the upload. Two
 * skills answer to one name, and which one a run gets depends on the ref.
 */
export function ShadowsUploadNotice({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <div
      role="note"
      // How refs resolve, not a request: neutral, with the warning shape.
      className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 text-sm text-foreground"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <p className="min-w-0">
        {compact ? (
          <>
            Shadows an uploaded <span className="font-mono">{name}</span>.
          </>
        ) : (
          <>
            An operator upload is also named <span className="font-mono">{name}</span>. Manifest
            refs that pin no version now get this library skill; a ref that pins the upload's
            version still gets the upload.
          </>
        )}
      </p>
    </div>
  );
}

/** A short commit id, as git prints one. */
function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Where a version came from beyond its author: the GitHub source an import was taken from,
 * that it still counts as an import (`lineage_import` — the gate judges it as one and an
 * agent's use of it is screened), and what an adoption or a promotion copied. Nothing for a
 * version written here, which is most of them.
 */
export function VersionProvenance({ version: v }: { version: SkillVersion }) {
  const lines: ReactNode[] = [];
  if (v.origin_source) {
    lines.push(
      <span key="origin">
        from <span className="font-mono">{v.origin_source}</span>
        {v.origin_ref ? (
          <>
            {' '}
            at <span className="font-mono">{v.origin_ref}</span>
          </>
        ) : null}
        {v.origin_commit ? (
          <span className="font-mono" title={v.origin_commit}>
            {' '}
            ({shortCommit(v.origin_commit)})
          </span>
        ) : null}
        {v.origin_license ? <> · {v.origin_license}</> : null}
      </span>,
    );
  }
  if (v.adopted_from) {
    lines.push(
      <span key="adopted">
        adopted from <span className="font-mono">{v.adopted_from}</span>, vouched for by its author
      </span>,
    );
  }
  if (v.promoted_from) {
    lines.push(
      <span key="promoted">
        promoted from <span className="font-mono">{v.promoted_from}</span> of its author's personal
        library
      </span>,
    );
  }
  if (!lines.length && !v.lineage_import) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {v.lineage_import && (
        <span
          className="rounded-full border border-state-blocked/40 px-1.5 text-state-blocked"
          title="Imported, or built on an import: the publish gate judges it as one, and an agent's use of it is screened as untrusted. An operator's adoption clears it."
        >
          import lineage
        </span>
      )}
      {lines}
    </p>
  );
}

/**
 * An imported skill's origin, as the harness last checked it (`SkillDetail.upstream`): whether
 * its source has changed since the newest version, when that was checked, and why the last
 * check failed if it did. Nothing for a skill that was never imported.
 */
export function UpstreamLine({ upstream }: { upstream: SkillUpstreamState | null | undefined }) {
  if (!upstream) return null;
  const checked = upstream.checked_at ? ` · checked ${ago(upstream.checked_at)}` : '';
  if (upstream.error) {
    return (
      <p className="text-xs text-state-failed">
        Its source could not be checked: <span className="font-mono">{upstream.error}</span>
        {checked}
      </p>
    );
  }
  if (upstream.update_available) {
    const waiting =
      upstream.eligible === false && upstream.eligible_at
        ? ` It can be taken from ${new Date(tsToMs(upstream.eligible_at)).toLocaleDateString()}.`
        : '';
    return (
      <p className="text-xs text-state-blocked">
        Its source has changed since the newest version
        {upstream.upstream_commit ? (
          <span className="font-mono"> ({upstream.upstream_commit.slice(0, 7)})</span>
        ) : null}
        .{waiting}
        <span className="text-muted-foreground">{checked}</span>
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Up to date with its source{checked}.</p>;
}
