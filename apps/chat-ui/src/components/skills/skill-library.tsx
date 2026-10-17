import { isSkillLibraryError, isSkillName } from '@felix/client';
import { createSkillTemplate, isValidSkillName, validateSkillName } from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Skeleton } from '@felix/ui/skeleton';
import { Textarea } from '@felix/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
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
import { ReadFailure, TransientRead } from '@/components/inspector/primitives';
import { isTransientFailure } from '@/lib/harness-health';
import { cn } from '@/lib/utils';
import { FeedbackInbox } from './feedback-panel';
import { LibraryList } from './library-list';
import { useOpenSkillEditor } from './open-skill-editor';
import { PolicyEditor } from './policy-form';
import {
  invalidateLibrary,
  ownerParts,
  SkillLibraryContext,
  useFeedbackInbox,
  useKnownLibraryOwner,
  useLibraryId,
  usePersonalLibraries,
  usePublishPolicy,
  useReviewQueue,
} from './queries';
import { QueryRoot } from './query-root';
import { isForbidden, policySentence, RefusalNotice } from './refusal';
import { ReviewQueue } from './review-queue';
import { ImportSection, UpdatesSection } from './skill-import';
import { SkillNotFound, SkillPage } from './skill-page';
import { type ManageSection, useSkillsAddress } from './skills-address';

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
export function usePendingDraftCount(enabled = true): {
  count: number | null;
  text: string | undefined;
} {
  const queue = useReviewQueue(enabled);
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
  // The team's queue: not asked for while showing someone's own library, which has none.
  const pending = usePendingDraftCount(!nav.lib);
  useEffect(() => onPendingText?.(pending.text), [onPendingText, pending.text]);
  const [creating, setCreating] = useState(false);
  const formId = useId();
  const owner = useKnownLibraryOwner(nav.lib);
  const who = owner ? ownerParts(owner) : undefined;
  if (nav.lib && nav.lib !== 'me') {
    // Someone else's library, opened by an administrator: readable, archivable, nothing more.
    return (
      <SkillLibraryContext.Provider value={nav.lib}>
        <LibrarySwitch current={nav.lib} to={nav.libraryTo} />
        <PageSection
          title={who ? `${who.subject}’s skills` : 'A personal library'}
          meta={who?.issuer ? `read-only · ${who.issuer}` : 'read-only'}
        >
          <p className="mb-3 max-w-[60ch] text-sm text-muted-foreground">
            {who ? 'Their own skills' : 'Someone’s own skills'}, which only they and administrators
            can see. You can read them and archive one; editing, publishing and promoting are the
            owner’s. Each look is recorded in the audit log.
          </p>
          <LibraryList filter={nav.filter} onFilter={nav.setFilter} linkTo={nav.linkTo} />
        </PageSection>
      </SkillLibraryContext.Provider>
    );
  }
  if (nav.lib) {
    // The caller's own library: their skills, written and published by them through the same
    // gate, with no review queue, feedback, evaluations or tenant policy — those are the team's.
    return (
      <SkillLibraryContext.Provider value={nav.lib}>
        <LibrarySwitch current="me" to={nav.libraryTo} />
        <PageSection
          title="My skills"
          meta="only you can see these"
          actions={
            <CreateToggle open={creating} onToggle={() => setCreating((o) => !o)} controls={formId}>
              New skill
            </CreateToggle>
          }
        >
          <p className="mb-3 max-w-[60ch] text-sm text-muted-foreground">
            Skills you keep for yourself. You publish your own drafts, through the same publish gate
            as the team library; promote a version you have published to offer it to the team.
          </p>
          {creating && (
            <div id={formId} className={CREATE_FORM}>
              <NewSkillForm onCancel={() => setCreating(false)} linkTo={nav.linkTo} />
            </div>
          )}
          <LibraryList filter={nav.filter} onFilter={nav.setFilter} linkTo={nav.linkTo} />
        </PageSection>
      </SkillLibraryContext.Provider>
    );
  }
  return (
    <TeamLibrary
      nav={nav}
      pending={pending}
      creating={creating}
      onCreating={setCreating}
      formId={formId}
    />
  );
}

/**
 * The team library. What waits on a person leads — but only when something does: an empty
 * queue and an empty inbox were two headed sections saying "nothing" above the list an operator
 * came for, so empty they are one quiet line in the library's heading. Below the list, the
 * page's occasional business sits behind one Manage disclosure.
 */
function TeamLibrary({
  nav,
  pending,
  creating,
  onCreating,
  formId,
}: {
  nav: ReturnType<typeof useSkillsAddress>;
  pending: ReturnType<typeof usePendingDraftCount>;
  creating: boolean;
  onCreating: (next: boolean | ((was: boolean) => boolean)) => void;
  formId: string;
}) {
  const queue = useReviewQueue();
  const inbox = useFeedbackInbox('pending');
  const feedbackCount = (inbox.data?.pages ?? []).reduce((sum, p) => sum + p.items.length, 0);
  // A section shows when it holds something or could not be read; "empty" is said only on an
  // answer, never on a failed or pending read.
  const queueTrouble = useStickyFailure(queue);
  const inboxTrouble = useStickyFailure(inbox);
  const showQueue = queueTrouble || (pending.count ?? 0) > 0;
  const showInbox = inboxTrouble || feedbackCount > 0;
  const queueEmpty = !queue.error && pending.count === 0;
  const inboxEmpty = !inbox.error && !!inbox.data && feedbackCount === 0;
  const quiet =
    queueEmpty && inboxEmpty
      ? 'No drafts or feedback waiting'
      : queueEmpty
        ? 'No drafts waiting'
        : inboxEmpty
          ? 'No feedback waiting'
          : undefined;
  return (
    <>
      <LibrarySwitch current={undefined} to={nav.libraryTo} />
      {showQueue && (
        <PageSection title="Waiting for review" meta={pending.count ? pending.text : undefined}>
          <ReviewQueue linkTo={nav.linkTo} />
        </PageSection>
      )}
      {showInbox && (
        <PageSection
          title="Feedback waiting for a decision"
          meta={feedbackCount ? plural(feedbackCount, 'item', 'items') : undefined}
        >
          <FeedbackInbox />
        </PageSection>
      )}
      <PageSection
        title="Library"
        meta={quiet ? <span role="status">{quiet}</span> : undefined}
        actions={
          <CreateToggle open={creating} onToggle={() => onCreating((o) => !o)} controls={formId}>
            New skill
          </CreateToggle>
        }
      >
        {creating && (
          <div id={formId} className={CREATE_FORM}>
            <NewSkillForm onCancel={() => onCreating(false)} linkTo={nav.linkTo} />
          </div>
        )}
        <LibraryList filter={nav.filter} onFilter={nav.setFilter} linkTo={nav.linkTo} />
      </PageSection>
      <UpdatesSection linkTo={nav.linkTo} />
      <ManageDisclosure nav={nav} />
    </>
  );
}

/**
 * Whether a read has failed and not since succeeded. Not `query.error` alone: the section a
 * failure shows mounts its own observer, whose retry-on-mount puts the query back to pending
 * with no error — which hid the section, which let the retry fail, which showed it, forever.
 */
function useStickyFailure(q: { error: unknown; isSuccess: boolean }): boolean {
  const failed = useRef(false);
  if (q.error) failed.current = true;
  else if (q.isSuccess) failed.current = false;
  return failed.current;
}

const MANAGE_OPEN_KEY = 'felix.skills.manageOpen';
const manageAnchor = (section: ManageSection) => `skills-manage-${section}`;

/**
 * Importing, other people's libraries and the tenant's publish policy: each is done now and
 * then, and none is why the page was opened, so they share one disclosure under the list,
 * closed by default and remembered for the tab. A link naming one (`?manage=policy`, from a
 * skill's Gate tab) opens it there. Closed, nothing inside is mounted — and the personal
 * libraries are listed only on Show even open, because every listing is audited.
 */
function ManageDisclosure({ nav }: { nav: ReturnType<typeof useSkillsAddress> }) {
  const [open, setOpen] = useState(() => !!nav.manage || readSession(MANAGE_OPEN_KEY) === '1');
  const contentId = useId();
  const headingId = useId();
  const target = nav.manage;
  useEffect(() => {
    if (!target) return;
    setOpen(true);
    // After the content has mounted: the section is not in the DOM until the disclosure opens.
    const frame = requestAnimationFrame(() =>
      document.getElementById(manageAnchor(target))?.scrollIntoView?.({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [target]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeSession(MANAGE_OPEN_KEY, next ? '1' : '0');
    if (!next && nav.manage) nav.clearManage();
  };
  return (
    <section
      aria-labelledby={headingId}
      className="border-t border-border/60 pt-3 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <h3 id={headingId} className="flex min-h-7 items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
          className="group -ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-base font-semibold focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              'size-4 text-muted-foreground transition-transform motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
          Manage
        </button>
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          Import from GitHub · personal libraries · publish policy
        </span>
      </h3>
      {open && (
        <div id={contentId} className="mt-2 border-l border-border/60 pl-4">
          <ImportSection linkTo={nav.linkTo} id={manageAnchor('import')} />
          <PersonalLibrariesSection libraryTo={nav.libraryTo} id={manageAnchor('personal')} />
          <PublishPolicySection id={manageAnchor('policy')} />
        </div>
      )}
    </section>
  );
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage refused (private mode, quota): the disclosure just is not remembered.
  }
}

/**
 * The tenant's publish policy, beside the library it governs rather than inside
 * one skill's gate: a change here re-decides every draft in the tenant, and it
 * is the one place on the page that says so.
 */
function PublishPolicySection({ id }: { id?: string }) {
  const policy = usePublishPolicy();
  return (
    <PageSection title="Publish policy" meta="every skill in this tenant" id={id}>
      {policy.data ? (
        <>
          <p className="max-w-[48ch] text-sm text-muted-foreground">
            {policySentence(policy.data)}
          </p>
          <PolicyEditor policy={policy.data} />
        </>
      ) : policy.error ? (
        <ReadFailure
          error={policy.error}
          doing="read the publish policy"
          lastOkAt={null}
          onRetry={() => void policy.refetch()}
        />
      ) : (
        <Skeleton className="h-24 w-full rounded-md" aria-label="Loading the publish policy" />
      )}
    </PageSection>
  );
}

/**
 * Everyone's personal libraries, for an administrator. Listed only on request, because the
 * harness records every listing in the audit log — opening the page must not count as a look.
 * A key that is not an administrator's is refused, and said so; a harness without the route
 * shows nothing.
 */
function PersonalLibrariesSection({
  libraryTo,
  id,
}: {
  libraryTo: (next: string) => string;
  id?: string;
}) {
  const [asked, setAsked] = useState(false);
  const query = usePersonalLibraries(asked);
  if (isSkillLibraryError(query.error) && query.error.status === 404) return null;
  const items = query.data?.items ?? [];
  return (
    <PageSection
      id={id}
      title="Personal libraries"
      meta={query.data ? `${items.length}${query.data.truncated ? '+' : ''}` : undefined}
      actions={
        !asked && (
          <Button size="sm" variant="ghost" onClick={() => setAsked(true)}>
            Show
          </Button>
        )
      }
    >
      {!asked ? (
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Each person’s own skills, which an administrator can read and archive. Listing them is
          recorded in the audit log.
        </p>
      ) : isForbidden(query.error) ? (
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Only an administrator can list personal libraries.
        </p>
      ) : query.error && isTransientFailure(query.error) ? (
        <TransientRead
          error={query.error}
          lastOkAt={query.dataUpdatedAt || null}
          onRetry={() => void query.refetch()}
        />
      ) : query.error ? (
        <RefusalNotice error={query.error} doing="list personal libraries" />
      ) : !query.data ? (
        <Skeleton className="h-16 w-full rounded-md" aria-label="Loading personal libraries" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one has a personal library yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {items.map((l) => {
              const { issuer, subject } = ownerParts(l.owner);
              return (
                <li key={l.library} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                  <Link
                    to={libraryTo(l.library)}
                    className="font-mono font-medium underline underline-offset-2"
                  >
                    {subject}
                  </Link>
                  {issuer && <span className="text-xs text-muted-foreground">{issuer}</span>}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {l.skills === 1 ? '1 skill' : `${l.skills} skills`}
                  </span>
                </li>
              );
            })}
          </ul>
          {query.data.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {items.length}; the harness stopped listing there.
            </p>
          )}
        </>
      )}
    </PageSection>
  );
}

/**
 * Team library or my skills: two addresses (`?lib=me`), so a link to either opens it. Links with
 * `aria-current`, not a toggle, because each is a different place rather than a setting.
 */
function LibrarySwitch({
  current,
  to,
}: {
  /** The library on screen; someone else's (a 32-hex id) marks neither link current. */
  current: string | undefined;
  to: (next: string | undefined) => string;
}) {
  const item = (label: string, value: 'me' | undefined) => {
    const here = current === value;
    return (
      <Link
        to={to(value)}
        aria-current={here ? 'page' : undefined}
        className={cn(
          'rounded-full px-3 py-1 text-sm transition-colors',
          here
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Skill library" className="mb-4 flex gap-1">
      {item('Team library', undefined)}
      {item('My skills', 'me')}
    </nav>
  );
}

/** One skill's page, at the address `useSkillsAddress` reads. */
export function SkillLibraryPage() {
  const nav = useSkillsAddress();
  return (
    <SkillLibraryContext.Provider value={nav.lib}>
      <SkillLibraryPageIn nav={nav} />
    </SkillLibraryContext.Provider>
  );
}

function SkillLibraryPageIn({ nav }: { nav: ReturnType<typeof useSkillsAddress> }) {
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
      policyTo={nav.manageTo('policy')}
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
  const lib = useLibraryId();
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
  const openEditor = useOpenSkillEditor();
  const create = useMutation({
    mutationFn: () =>
      createLibrarySkill({ files: createSkillTemplate(name, description.trim()) }, lib),
    onSuccess: (result) => {
      void invalidateLibrary(client);
      toast.success(`Created ${result.name} ${result.version} as a draft.`);
      // Straight into the editor, beside the conversation; without one, its page.
      if (openEditor) openEditor(result.name);
      else navigate(linkTo(result.name));
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
          className="font-mono"
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
          className="min-h-16"
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
