import type { SkillDetail, SkillVersion } from '@felix/client';
import { useId } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { PageSection } from '@/components/harness/panel';
import { cn } from '@/lib/utils';
import { BundleChanges } from './bundle-changes';
import { DiffView } from './diff-view';
import { useArchiveSkill, useSkillFile } from './queries';
import { RefusalNotice } from './refusal';
import { ScoreReadout } from './score-readout';
import { ago, SourceLabel, VersionStateBadge, versionState } from './skill-status';
import { EDITOR } from './skill-tabs';
import { RollbackButton, VersionDecision } from './version-actions';

/**
 * Every version of one skill, newest first, with what can be done to each:
 * a draft is published or rejected, a once-live version rolled back to, the
 * live one left alone. Above the list, a diff of any version against the
 * editor's working copy or against any other version — both sides named, both
 * in the address, so a comparison is a link.
 */
export function VersionsPanel({
  detail,
  selected,
  against,
  editorSkillMd,
  onCompare,
}: {
  detail: SkillDetail;
  selected: string;
  /** A version, or `EDITOR` for the working copy. */
  against: string;
  /** The working copy's SKILL.md, when the editor has one loaded. */
  editorSkillMd: string | null;
  onCompare: (selected: string, against: string) => void;
}) {
  const name = detail.name;
  const left = useSkillFile(name, against === EDITOR ? null : against);
  const right = useSkillFile(name, selected);
  const leftId = useId();
  const rightId = useId();
  const options = detail.versions.map((v) => v.version);

  const leftText = against === EDITOR ? editorSkillMd : (left.data?.content ?? null);
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
            <option value={EDITOR} disabled={editorSkillMd === null}>
              the editor
            </option>
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
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
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <RefusalNotice error={error} doing="read the versions to compare" />
        ) : leftText === null || rightText === null ? (
          <p className="text-sm text-muted-foreground">
            {against === EDITOR && editorSkillMd === null
              ? 'The editor has not loaded this skill yet. Open the Edit tab, or compare two versions.'
              : 'Reading both sides…'}
          </p>
        ) : (
          <div className="space-y-2">
            <DiffView
              before={leftText}
              after={rightText}
              beforeLabel={against === EDITOR ? 'editor' : against}
              afterLabel={selected}
            />
            {against !== EDITOR && (
              <BundleChanges name={name} before={against} after={selected} skipSkillMd />
            )}
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
  return (
    <li className={cn('space-y-1.5 py-3', selected && 'bg-accent/40 -mx-2 rounded-md px-2')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="rounded-sm font-mono text-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      {v.reason && <p className="text-sm whitespace-pre-wrap break-words">{v.reason}</p>}
      <ScoreReadout quality={v.quality_score} security={v.security_status} />
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
      {state === 'draft' && (
        <VersionDecision
          name={v.name}
          version={v.version}
          liveVersion={liveVersion}
          parentVersion={v.parent_version}
        />
      )}
      {state === 'superseded' && <RollbackButton name={v.name} version={v.version} />}
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
  return (
    <PageSection title="Archive">
      <p className="mb-2 text-sm text-muted-foreground">
        Takes <span className="font-mono">{name}</span> out of every catalog. Every version is kept,
        and rolling back to one brings the skill back.
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
