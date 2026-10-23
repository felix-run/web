import { InfoIcon } from 'lucide-react';
import { Fact } from '@/components/harness/panel';

/**
 * Who a workflow is an agent's for, read from what the harness records on it
 * (`created_by`, `authored_via`; felix-run/felix#667, #671).
 *
 * An agent with `spec.workflow_authoring` saves a workflow for the person it is talking to:
 * `authored_via` is `agent:<manifest>` and `created_by` that person's issuer-qualified key,
 * `<issuer>|<subject>`. A save through `PUT /workflows/{id}` — this editor — takes it over:
 * by that person it becomes `owner:agent:<manifest>`, which the agent may still run but not
 * change; by anyone else `authored_via` is cleared and the agent may do neither.
 */

const AGENT = 'agent:';
const OWNER_EDITED = 'owner:agent:';

export interface Authorship {
  /** The manifest whose agent wrote it. */
  agent: string;
  /** Who it was written for: the subject of `created_by`, without its issuer. */
  person: string;
  /** The person has since saved it themselves: the agent may run it, not change it. */
  ownerEdited: boolean;
}

/** The agent a workflow belongs to and for whom, or null for one a person made (or took over). */
export function authorshipOf(w: { created_by?: string; authored_via?: string }): Authorship | null {
  const via = w.authored_via ?? '';
  const ownerEdited = via.startsWith(OWNER_EDITED);
  if (!ownerEdited && !via.startsWith(AGENT)) return null;
  const agent = via.slice(ownerEdited ? OWNER_EDITED.length : AGENT.length);
  if (!agent) return null;
  const by = w.created_by ?? '';
  // An issuer never contains `|` (the harness refuses one that does), so the first one splits it.
  const cut = by.indexOf('|');
  return { agent, person: cut >= 0 ? by.slice(cut + 1) : by, ownerEdited };
}

/** What saving this workflow here does to the agent that wrote it, or null when it is not one's. */
export function takeoverNote(a: Authorship | null): string | null {
  if (!a || a.ownerEdited) return null;
  return (
    `Agent ${a.agent} wrote this for ${a.person || 'someone'}. Saving it here takes it over: ` +
    `the agent will no longer change it, and will still run it only if you are ${a.person || 'that person'}.`
  );
}

/** The `Facts` row saying which agent wrote a workflow and for whom; nothing for a person's own. */
export function AuthorshipFact({
  workflow,
}: {
  workflow: { created_by?: string; authored_via?: string };
}) {
  const a = authorshipOf(workflow);
  if (!a) return null;
  return (
    <Fact label="Written by">
      agent <span className="font-mono">{a.agent}</span>
      {a.person ? (
        <>
          {' '}
          for <span className="font-mono">{a.person}</span>
        </>
      ) : null}
      {a.ownerEdited ? (
        <span className="text-muted-foreground">
          {' '}
          · since edited by them: it runs, no longer changes
        </span>
      ) : null}
    </Fact>
  );
}

/** Shown while editing an agent's workflow: what a save here does to that agent. */
export function TakeoverNote({
  workflow,
}: {
  workflow: { created_by?: string; authored_via?: string };
}) {
  const note = takeoverNote(authorshipOf(workflow));
  if (!note) return null;
  return (
    <p className="mb-4 flex gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground">
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{note}</span>
    </p>
  );
}
