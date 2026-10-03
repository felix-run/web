import type { SkillSource, SkillVersion } from '@felix/client';
import { relativeTime } from '@felix/client';
import {
  ArchiveIcon,
  BotIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  TriangleAlertIcon,
  UserIcon,
} from 'lucide-react';
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

/** Who wrote a version: an agent through `create_skill`/`update_skill`, or an operator. */
export function SourceLabel({ source, author }: { source: SkillSource; author?: string }) {
  const Icon = source === 'agent' ? BotIcon : UserIcon;
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
      className="flex items-start gap-2 rounded-lg border border-state-blocked/30 bg-state-blocked/10 px-2.5 py-2 text-sm text-state-blocked"
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
