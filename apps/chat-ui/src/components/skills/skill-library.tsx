import { isSkillName } from '@felix/client';
import { createSkillTemplate, isValidSkillName, validateSkillName } from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Textarea } from '@felix/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { createLibrarySkill } from '@/api';
import {
  CREATE_FORM,
  CreateToggle,
  PageSection,
  Panel,
  PanelBody,
  plural,
} from '@/components/harness/panel';
import { cn } from '@/lib/utils';
import { FeedbackInbox } from './feedback-panel';
import { LibraryList } from './library-list';
import { invalidateLibrary, useReviewQueue } from './queries';
import { QueryRoot } from './query-root';
import { RefusalNotice } from './refusal';
import { ReviewQueue } from './review-queue';
import { SkillNotFound, SkillPage } from './skill-page';
import { useSkillsAddress } from './skills-address';

/**
 * The library below the per-agent skills: what is waiting on a person first,
 * then everything, filterable by status and by who wrote it.
 */
/** The library, in the shared Query client — the lazy entry point `/harness/skills` loads. */
export function SkillLibraryEntry(props: { onPendingText?: (text: string | undefined) => void }) {
  return (
    <QueryRoot>
      <SkillLibrary {...props} />
    </QueryRoot>
  );
}

/** One skill's page, in the shared Query client. */
export function SkillLibraryPageEntry() {
  return (
    <QueryRoot>
      <SkillLibraryPage />
    </QueryRoot>
  );
}

/** The pending-draft count for a header, `50+` when the queue's first page was full. */
export function usePendingDraftCount(): { count: number | null; text: string | undefined } {
  const queue = useReviewQueue();
  const first = queue.data?.pages[0];
  if (!first) return { count: null, text: undefined };
  const n = (queue.data?.pages ?? []).reduce((sum, p) => sum + p.items.length, 0);
  const more = !!queue.data?.pages.at(-1)?.next_cursor;
  if (n === 0) return { count: 0, text: undefined };
  return { count: n, text: `${plural(n, 'draft', 'drafts', more ? n : undefined)} waiting` };
}

export function SkillLibrary({
  onPendingText,
}: {
  /** Reports the pending count up, for the page header drawn outside this lazy chunk. */
  onPendingText?: (text: string | undefined) => void;
} = {}) {
  const nav = useSkillsAddress();
  const pending = usePendingDraftCount();
  useEffect(() => onPendingText?.(pending.text), [onPendingText, pending.text]);
  const [creating, setCreating] = useState(false);
  const formId = useId();
  return (
    <>
      <PageSection
        title="Waiting for review"
        meta={pending.count != null ? (pending.count === 0 ? 'none' : pending.text) : undefined}
      >
        <ReviewQueue linkTo={nav.linkTo} />
      </PageSection>
      <PageSection title="Feedback waiting for a decision">
        <FeedbackInbox />
      </PageSection>
      <PageSection
        title="Library"
        actions={
          <CreateToggle open={creating} onToggle={() => setCreating((o) => !o)} controls={formId}>
            New skill
          </CreateToggle>
        }
      >
        {creating && (
          <div id={formId} className={CREATE_FORM}>
            <NewSkillForm onCancel={() => setCreating(false)} linkTo={nav.linkTo} />
          </div>
        )}
        <LibraryList filter={nav.filter} onFilter={nav.setFilter} linkTo={nav.linkTo} />
      </PageSection>
    </>
  );
}

/** One skill's page, at the address `useSkillsAddress` reads. */
export function SkillLibraryPage() {
  const nav = useSkillsAddress();
  if (!nav.skill) return null;
  // A name no library could hold is a broken link, answered without asking.
  if (!isSkillName(nav.skill)) {
    return (
      <Panel>
        <PanelBody>
          <SkillNotFound name={nav.skill} backTo={nav.backTo} />
        </PanelBody>
      </Panel>
    );
  }
  return (
    <SkillPage
      name={nav.skill}
      address={nav.address}
      onAddress={nav.setAddress}
      backTo={nav.backTo}
    />
  );
}

/**
 * A new skill from a name and a description: the template the harness's own
 * `create_skill_template` writes, saved as an operator draft at 0.1.0, then
 * opened in the editor. The name is checked here against the harness's rule so
 * the obvious refusal never makes a round trip.
 *
 * Create stays enabled while the form is incomplete: a disabled button cannot
 * say why, and an empty description had no message of its own. Pressing it
 * names what is missing under the field and moves focus there.
 */
function NewSkillForm({
  onCancel,
  linkTo,
}: {
  onCancel: () => void;
  linkTo: (name: string, version?: string) => string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [attempted, setAttempted] = useState(false);
  const nameId = useId();
  const descId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const nameIssue = useMemo(() => {
    if (name) return validateSkillName(name)[0]?.message ?? null;
    return attempted ? 'A name is required.' : null;
  }, [name, attempted]);
  const descIssue =
    attempted && !description.trim()
      ? 'A description is required — it is how an agent decides to use the skill.'
      : null;
  const create = useMutation({
    mutationFn: () => createLibrarySkill({ files: createSkillTemplate(name, description.trim()) }),
    onSuccess: (result) => {
      void invalidateLibrary(client);
      toast.success(`Created ${result.name} ${result.version} as a draft.`);
      const to = linkTo(result.name);
      navigate(`${to}${to.endsWith('?') ? '' : '&'}tab=edit`);
    },
  });
  const ready = isValidSkillName(name) && description.trim().length > 0;
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (create.isPending) return;
        if (!ready) {
          setAttempted(true);
          (isValidSkillName(name) ? descRef : nameRef).current?.focus();
          return;
        }
        create.mutate();
      }}
    >
      <div className="space-y-1">
        <label htmlFor={nameId} className="block text-xs font-medium text-muted-foreground">
          Name
        </label>
        <Input
          ref={nameRef}
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="font-mono text-sm"
          aria-invalid={nameIssue ? true : undefined}
          aria-describedby={`${nameId}-issue`}
          autoComplete="off"
        />
        {/* The format is a hint, not a placeholder: an example name in the field read as one
            already typed, beside a Create button that would not say why it refused. */}
        <p
          id={`${nameId}-issue`}
          className={cn('text-xs', nameIssue ? 'text-state-failed' : 'text-muted-foreground')}
        >
          {nameIssue ?? (
            <>
              Lowercase letters, digits and hyphens, e.g.{' '}
              <span className="font-mono">release-notes</span>.
            </>
          )}
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={descId} className="block text-xs font-medium text-muted-foreground">
          Description — what it does and when an agent should use it
        </label>
        <Textarea
          ref={descRef}
          id={descId}
          value={description}
          maxLength={1024}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-16 text-sm"
          aria-invalid={descIssue ? true : undefined}
          aria-describedby={descIssue ? `${descId}-issue` : undefined}
        />
        {descIssue && (
          <p id={`${descId}-issue`} className="text-xs text-state-failed">
            {descIssue}
          </p>
        )}
      </div>
      {create.error ? <RefusalNotice error={create.error} doing="create the skill" /> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create draft'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
