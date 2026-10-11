import type { SkillDetail, SkillVersion } from '@felix/client';
import { useId } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { PageSection } from '@/components/harness/panel';
import { cn } from '@/lib/utils';
import { BundleChanges } from './bundle-changes';
import { DiffView } from './diff-view';
import { GateLine } from './gate-line';
import { PromoteButton } from './promote-button';
import {
  useArchiveSkill,
  useLibraryId,
  useLibraryReadOnly,
  usePublishPolicy,
  useSkillFile,
} from './queries';
import { RefusalNotice } from './refusal';
import { ScoreReadout } from './score-readout';
import { SkillBundleBrowser } from './skill-bundle-browser';
import { AdoptButton } from './skill-import';
import {
  ago,
  ownReason,
  SourceLabel,
  VersionProvenance,
  VersionStateBadge,
  versionState,
} from './skill-status';
import { RollbackButton, VersionDecision } from './version-actions';
import { versionOptionLabel } from './version-picker';

/**
 * Every version of one skill, newest first, with what can be done to each:
 * a draft is published or rejected, a once-live version rolled back to, the
 * live one left alone, and each draft says what the gate would make of it
 * beside its decision. Above the list, a diff of any version against the
 * editor's working copy or against any other version — both sides named, both
 * in the address, so a comparison is a link. Below it, the selected version's
 * files.
 */
export function VersionsPanel({
  detail,
  selected,
  against,
  onCompare,
}: {
  detail: SkillDetail;
  selected: string;
  against: string;
  onCompare: (selected: string, against: string) => void;
}) {
  const name = detail.name;
  const left = useSkillFile(name, against);
  const right = useSkillFile(name, selected);
  const leftId = useId();
  const rightId = useId();

  const leftText = left.data?.content ?? null;
  const rightText = right.data?.content ?? null;
  const error = left.error ?? right.error;

  return (
    <div className="space-y-1">
      <PageSection title="Compare SKILL.md">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor={leftId} className="text-muted-foreground">
            From
          </label>
          <select
            id={leftId}
            value={against}
            onChange={(e) => onCompare(selected, e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
          >
            {detail.versions.map((v) => (
              <option key={v.version} value={v.version}>
                {versionOptionLabel(v, detail.live_version)}
              </option>
            ))}
          </select>
          <label htmlFor={rightId} className="text-muted-foreground">
            to
          </label>
          <select
            id={rightId}
            value={selected}
            onChange={(e) => onCompare(e.target.value, against)}
            className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
          >
            {detail.versions.map((v) => (
              <option key={v.version} value={v.version}>
                {versionOptionLabel(v, detail.live_version)}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <RefusalNotice error={error} doing="read the versions to compare" />
        ) : leftText === null || rightText === null ? (
          <p className="text-sm text-muted-foreground">Reading both sides…</p>
        ) : (
          <div className="space-y-2">
            <DiffView
              before={leftText}
              after={rightText}
              beforeLabel={against}
              afterLabel={selected}
            />
            <BundleChanges name={name} before={against} after={selected} skipSkillMd />
          </div>
        )}
      </PageSection>

      <PageSection title="Versions" meta={`${detail.versions.length}, newest first`}>
        <ul aria-label={`Versions of ${name}`} className="divide-y divide-border/60">
          {detail.versions.map((v) => (
            <VersionRow
              key={v.version}
              version={v}
              liveVersion={detail.live_version}
              selected={v.version === selected}
              onSelect={() => onCompare(v.version, against)}
            />
          ))}
        </ul>
      </PageSection>

      <PageSection title={`Files in ${selected}`}>
        <SkillBundleBrowser name={name} version={selected} />
      </PageSection>

      <ArchiveSkill name={name} liveVersion={detail.live_version} />
    </div>
  );
}

function VersionRow({
  version: v,
  liveVersion,
  selected,
  onSelect,
}: {
  version: SkillVersion;
  liveVersion: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = versionState(v, liveVersion);
  const policy = usePublishPolicy().data;
  // Your own library: a version once published can be offered to the team.
  const personal = useLibraryId() === 'me';
  const readOnly = useLibraryReadOnly();
  return (
    <li className={cn('space-y-1.5 py-3', selected && 'bg-accent/40 -mx-2 rounded-md px-2')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="rounded-sm font-mono text-sm font-medium underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          {v.version}
        </button>
        <VersionStateBadge state={state} />
        <SourceLabel source={v.source} author={v.author} />
        <span className="text-xs text-muted-foreground">{ago(v.created_at)}</span>
        {v.parent_version && (
          <span className="text-xs text-muted-foreground">
            from <span className="font-mono">{v.parent_version}</span>
          </span>
        )}
      </div>
      <VersionProvenance version={v} />
      {ownReason(v) && <p className="text-sm whitespace-pre-wrap break-words">{ownReason(v)}</p>}
      <ScoreReadout quality={v.quality_score} security={v.security_status} policy={policy} />
      {v.decided_by && (
        <p className="text-xs text-muted-foreground">
          {state === 'rejected' ? 'Rejected' : 'Decided'} by{' '}
          <span className="font-mono">{v.decided_by}</span> {ago(v.decided_at)}
          {v.decision_note ? (
            <>
              : <span className="whitespace-pre-wrap text-foreground">{v.decision_note}</span>
            </>
          ) : null}
        </p>
      )}
      {state === 'draft' && <GateLine name={v.name} version={v.version} />}
      {state === 'draft' && (
        <VersionDecision
          name={v.name}
          version={v.version}
          liveVersion={liveVersion}
          parentVersion={v.parent_version}
          showsVerdict
        />
      )}
      {state === 'superseded' && <RollbackButton name={v.name} version={v.version} />}
      {personal && v.published_at != null && <PromoteButton name={v.name} version={v.version} />}
      {!personal &&
        !readOnly &&
        v.lineage_import &&
        v.source !== 'agent' &&
        state !== 'rejected' && <AdoptButton version={v} />}
    </li>
  );
}

/**
 * Taking a skill out of every catalog. Its versions and their bytes are kept
 * — the harness's `DELETE` archives rather than erases — so the copy says
 * "archive" and names the way back.
 */
function ArchiveSkill({ name, liveVersion }: { name: string; liveVersion: string | null }) {
  const archive = useArchiveSkill();
  // In someone else's library the administrator can archive but not roll back: the way back is
  // the owner's.
  const readOnly = useLibraryReadOnly();
  return (
    <PageSection title="Archive">
      <p className="mb-2 max-w-[48ch] text-sm text-muted-foreground">
        Takes <span className="font-mono">{name}</span> out of every catalog. Every version is kept,
        and{' '}
        {readOnly
          ? 'the owner can bring the skill back'
          : 'rolling back to one brings the skill back'}
        .
      </p>
      <ConfirmButton
        variant="outline"
        destructive
        disabled={archive.isPending || !liveVersion}
        question={`${name} leaves every catalog${liveVersion ? `; ${liveVersion} stops being live` : ''}.`}
        confirmLabel={`Archive ${name}`}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(name);
            toast.success(`Archived ${name}.`);
          } catch {
            // Drawn below.
          }
        }}
      >
        Archive skill
      </ConfirmButton>
      {!liveVersion && (
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing is live, so there is nothing to archive.
        </p>
      )}
      {archive.error ? <RefusalNotice error={archive.error} doing={`archive ${name}`} /> : null}
    </PageSection>
  );
}
