import { Badge } from '@felix/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import {
  type SkillCallResult,
  type SkillSaved,
  skillCallArgs,
  skillLibraryHref,
} from '@/lib/skill-calls';
import { cn } from '@/lib/utils';
import { GateLine } from './gate-line';
import { useLibrarySkill } from './queries';
import { QueryRoot } from './query-root';
import { isForbidden } from './refusal';
import { ScoreReadout } from './score-readout';
import { VersionStateBadge, versionState } from './skill-status';
import { VersionDecision } from './version-actions';
import { VersionDiff } from './version-diff';

/**
 * A skill an agent just wrote, in the transcript, where it was proposed.
 *
 * `create_skill` and `update_skill` save a *draft*: nothing changes for any run
 * until a person publishes it. So the card is a decision, drawn in the
 * approval card's frame and grammar — what, why, the gate's verdict and the
 * diff one click open, then two equal-weight answers — and it says plainly when
 * there is nothing to decide: the call was refused, the version was published
 * or rejected since, or this key may read the library but not change it.
 *
 * The answer is *Publish*, as it is in the queue and on Versions, not
 * "Approve": the button makes the draft live for every ref that pins no
 * version, and the word on it should be the one that says so.
 *
 * The status shown is the library's *now*, read on render, not the result's
 * at save time; a draft published in another tab must not still offer Publish
 * here. When the library cannot be read, the card falls back to the result and
 * says that it has.
 */
/** The card in the shared Query client — the lazy entry point the tool card loads. */
export function SkillProposalCardEntry(props: Parameters<typeof SkillProposalCard>[0]) {
  return (
    <QueryRoot>
      <SkillProposalCard {...props} />
    </QueryRoot>
  );
}

export function SkillProposalCard({
  toolName,
  input,
  result,
}: {
  toolName: string;
  input: unknown;
  result: SkillCallResult;
}) {
  const { reason, parent } = skillCallArgs(input);
  if (result.kind === 'refused') {
    return <RefusedCall toolName={toolName} result={result} parent={parent} />;
  }
  return <SavedDraft toolName={toolName} result={result} reason={reason} parent={parent} />;
}

const FRAME = 'rounded-xl border p-3 text-sm';

function Header({ toolName, children }: { toolName: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant="secondary"
        className="max-w-full py-0 font-mono text-xs whitespace-normal wrap-anywhere"
      >
        {toolName}
      </Badge>
      {children}
    </div>
  );
}

function OpenInLibrary({ name, version }: { name: string; version?: string }) {
  return (
    <Link
      to={skillLibraryHref(name, version)}
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
    >
      Open in library
    </Link>
  );
}

function SavedDraft({
  toolName,
  result,
  reason,
  parent,
}: {
  toolName: string;
  result: SkillSaved;
  reason?: string;
  parent?: string;
}) {
  const skill = useLibrarySkill(result.name);
  const [forbidden, setForbidden] = useState(false);
  const [open, setOpen] = useState(false);
  const onForbidden = useCallback(() => setForbidden(true), []);
  const row = skill.data?.versions.find((v) => v.version === result.version);
  const live = skill.data?.live_version ?? null;
  // The library's word for it now; the result's, said as such, when the library is unreadable.
  const state = row ? versionState(row, live) : result.status === 'published' ? 'live' : 'draft';
  const readable = !!skill.data;
  const cannotRead = skill.error ? isForbidden(skill.error) : false;
  // Only on the library's own word that this version is still a draft: the
  // tool result is agent-relayed, and offering Publish on it would offer it on
  // a draft someone already decided — or on one the library does not hold.
  const decidable = !!row && state === 'draft' && !forbidden && !cannotRead;
  // What publishing replaces is the live version, so that is what the diff is
  // against — not the parent, which `VersionDecision` names when they differ.
  const before = live && live !== result.version ? live : null;
  // The library's record of the parent, over the call's argument naming it.
  const editedFrom = row ? row.parent_version : parent;

  return (
    <div
      className={cn(
        FRAME,
        state === 'draft' && decidable
          ? 'border-state-blocked/40 bg-state-blocked/5'
          : 'border-border/60 bg-solid-muted/30',
      )}
    >
      <Header toolName={toolName}>
        <span className="font-mono font-medium">{result.name}</span>
        <span className="font-mono text-muted-foreground">{result.version}</span>
        <VersionStateBadge state={state} />
        {!readable && skill.isFetched && (
          <span className="text-xs text-muted-foreground">
            as saved; the library could not be read
          </span>
        )}
      </Header>

      {reason && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-muted-foreground">{reason}</p>
      )}
      <p className="mt-1.5">
        {toolName === 'update_skill' && editedFrom ? (
          <>
            A new version of <span className="font-mono">{result.name}</span>, edited from{' '}
            <span className="font-mono">{editedFrom}</span>.
          </>
        ) : (
          <>
            A new skill, <span className="font-mono">{result.name}</span>.
          </>
        )}{' '}
        {state === 'draft'
          ? 'Saved as a draft: no run uses it until it is published.'
          : state === 'live'
            ? 'It is live: runs that pin no version use it.'
            : 'It was not published.'}
      </p>

      <ScoreReadout
        className="mt-2"
        quality={result.quality_score}
        security={result.security_status}
      />
      {result.review_hint && result.review_hint !== 'Every review check passed.' && (
        <p className="mt-1 text-xs text-muted-foreground">{result.review_hint}</p>
      )}
      {result.issues.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {result.issues.slice(0, 5).map((i) => (
            <li key={`${i.path}:${i.message}`}>
              <span className="font-mono">{i.severity}</span>{' '}
              <span className="font-mono">{i.path}</span> {i.message}
            </li>
          ))}
        </ul>
      )}
      {result.review_required && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          The agent's manifest publishes on its own, but not this one: {result.review_required}.
        </p>
      )}
      {result.publish_blocked && result.publish_blocked.length > 0 && (
        <div className="mt-1.5 text-xs">
          <p className="text-state-failed">The agent asked to publish it; the gate refused:</p>
          <ul className="list-disc pl-4 text-state-failed">
            {result.publish_blocked.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {!cannotRead && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
          <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
            />
            {before ? `Gate verdict and diff against live ${before}` : 'Gate verdict and SKILL.md'}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {open && (
              <>
                {decidable && <GateLine name={result.name} version={result.version} />}
                <VersionDiff name={result.name} before={before} after={result.version} />
              </>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="mt-3 space-y-2">
        {decidable && row && (
          <VersionDecision
            name={row.name}
            version={row.version}
            liveVersion={live}
            parentVersion={row.parent_version}
            onForbidden={onForbidden}
          />
        )}
        {(forbidden || cannotRead) && (
          <p className="text-xs text-muted-foreground">
            {cannotRead
              ? 'This key cannot read the skill library (it needs skills:read), so the card shows what the call returned and cannot be decided here.'
              : 'This key can read the skill library but not change it: approving or rejecting needs skills:write. Someone with that scope can decide it from the library.'}
          </p>
        )}
        <OpenInLibrary name={result.name} version={result.version} />
      </div>
    </div>
  );
}

/** The refusals `authoring.py` returns, each in words that say nothing was saved. */
function RefusedCall({
  toolName,
  result,
  parent,
}: {
  toolName: string;
  result: Extract<SkillCallResult, { kind: 'refused' }>;
  parent?: string;
}) {
  const name = result.name;
  const n = name ? <span className="font-mono">{name}</span> : 'the skill';
  const message = (() => {
    switch (result.error) {
      case 'parent_changed':
        return (
          <>
            The agent edited {n} from{' '}
            <span className="font-mono">{result.expected ?? parent ?? 'an older version'}</span>,
            but <span className="font-mono">{result.current ?? 'a newer version'}</span> was saved
            since. Nothing was saved; the agent has to start from the newer version.
          </>
        );
      case 'parent_rejected':
        return (
          <>
            The agent edited {n} from{' '}
            <span className="font-mono">{result.expected ?? parent ?? 'a version'}</span>, which a
            person rejected. Nothing was saved. An agent builds only on versions that were not
            rejected
            {result.current ? (
              <>
                {' '}
                — here <span className="font-mono">{result.current}</span>
              </>
            ) : null}
            , so a rejected draft's changes never ride into the next one.
          </>
        );
      case 'skill_exists':
        return (
          <>The library already has {n}. Nothing was saved; an edit goes through update_skill.</>
        );
      case 'unknown_skill':
        return <>The library has no skill called {n}, so there was nothing to update.</>;
      case 'invalid_bundle':
        return <>The harness refused the skill as written. Nothing was saved.</>;
      case 'publish_blocked':
        return <>The draft was saved, but the publish gate refused it.</>;
      case 'pending_cap_reached':
        return (
          <>
            Too many agent drafts are waiting for review, so this one was not saved. Deciding some
            lets the agent try again.
          </>
        );
      case 'name_shadows_host_skill':
        return <>{n} is the name of a skill the harness ships, so the library cannot take it.</>;
      default:
        return (
          <>
            The call was refused (<span className="font-mono">{result.error}</span>). Nothing was
            saved.
          </>
        );
    }
  })();
  return (
    <div className={cn(FRAME, 'border-state-failed/30 bg-state-failed/5')}>
      <Header toolName={toolName}>
        {name && <span className="font-mono font-medium">{name}</span>}
        <span className="rounded-full bg-state-failed/15 px-1.5 py-0.5 text-xs font-medium text-state-failed">
          not saved
        </span>
      </Header>
      <p className="mt-1.5">{message}</p>
      {result.detail && (
        <p className="mt-1 text-xs break-words text-muted-foreground">{result.detail}</p>
      )}
      {result.issues && result.issues.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {result.issues.map((i) => (
            <li key={`${i.path}:${i.message}`}>
              <span className="font-mono">{i.path}</span> {i.message}
            </li>
          ))}
        </ul>
      )}
      {name && result.error !== 'unknown_skill' && (
        <div className="mt-2">
          <OpenInLibrary name={name} version={result.current} />
        </div>
      )}
    </div>
  );
}
