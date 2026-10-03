import { createSkillTemplate, isValidSkillName, validateSkillName } from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Textarea } from '@felix/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { createLibrarySkill } from '@/api';
import { CREATE_FORM, CreateToggle, PageSection } from '@/components/harness/panel';
import { LibraryList } from './library-list';
import { invalidateLibrary } from './queries';
import { RefusalNotice } from './refusal';
import { ReviewQueue } from './review-queue';
import { SkillPage } from './skill-page';
import { usePendingDraftCount, useSkillsAddress } from './skills-address';

/**
 * The library below the per-agent skills: what is waiting on a person first,
 * then everything, filterable by status and by who wrote it.
 */
export function SkillLibrary() {
  const nav = useSkillsAddress();
  const pending = usePendingDraftCount();
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
  const nameId = useId();
  const descId = useId();
  const nameIssue = useMemo(
    () => (name ? (validateSkillName(name)[0]?.message ?? null) : null),
    [name],
  );
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
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) create.mutate();
      }}
    >
      <div className="space-y-1">
        <label htmlFor={nameId} className="block text-xs font-medium text-muted-foreground">
          Name
        </label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="release-notes"
          className="font-mono text-sm"
          aria-invalid={nameIssue ? true : undefined}
          aria-describedby={nameIssue ? `${nameId}-issue` : undefined}
          autoComplete="off"
        />
        {nameIssue && (
          <p id={`${nameId}-issue`} className="text-xs text-state-failed">
            {nameIssue}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor={descId} className="block text-xs font-medium text-muted-foreground">
          Description — what it does and when an agent should use it
        </label>
        <Textarea
          id={descId}
          value={description}
          maxLength={1024}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-16 text-sm"
        />
      </div>
      {create.error ? <RefusalNotice error={create.error} doing="create the skill" /> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create draft'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
