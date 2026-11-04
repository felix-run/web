import { relativeTime } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Textarea } from '@felix/ui/textarea';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  clearJobState,
  deleteJobPreferences,
  deleteJobStateKey,
  getJobPreferences,
  getJobState,
  putJobPreferences,
} from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import type { JobPreferences, JobStateEntry } from '@/types';

/**
 * A job's two writer-only parts (`felix-run/felix` 0.19): the reader's preferences every firing
 * reads whole, and the state its runs keep for themselves. Both are the job's writer's or an
 * operator's — a holder of `jobs:read` gets 403 — because the text may be personal, so each
 * section is read only when the job is opened, and a refusal is said as who may, not as an error.
 */

/** The harness's cap on a preferences document (`PREFERENCES_MAX_BYTES`). */
export const PREFERENCES_MAX_BYTES = 8 * 1024;

/** `jobsFetch` puts the status in its message: `jobs /x/state: 403 …`. */
function isForbidden(err: unknown): boolean {
  return /: 403\b/.test(String((err as Error)?.message ?? err));
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

function NotYours({ what }: { what: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Only the person this job runs for, or an operator, can see its {what}.
    </p>
  );
}

export function JobPreferencesSection({
  jobName,
  onChanged,
}: {
  jobName: string;
  /** The list's `preferences_set` moves with a save or a clear. */
  onChanged: () => void;
}) {
  const [prefs, setPrefs] = useState<JobPreferences | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setPrefs(null);
    setReadError(null);
    getJobPreferences(jobName).then(
      (p) => {
        if (!live) return;
        setPrefs(p);
        setDraft(p.preferences ?? '');
      },
      (err: unknown) => live && setReadError(err),
    );
    return () => {
      live = false;
    };
  }, [jobName]);

  async function write(text: string | null) {
    setSaving(true);
    setWriteError(null);
    try {
      const next =
        text === null
          ? await deleteJobPreferences(jobName)
          : await putJobPreferences(jobName, text);
      setPrefs(next);
      setDraft(next.preferences ?? '');
      onChanged();
    } catch (err) {
      setWriteError(err);
    } finally {
      setSaving(false);
    }
  }

  if (readError != null) {
    return isForbidden(readError) ? (
      <NotYours what="preferences" />
    ) : (
      <ErrorNotice error={readError} doing="read this job's preferences" />
    );
  }
  if (!prefs) return <p className="text-xs text-muted-foreground">Loading preferences…</p>;

  const bytes = byteLength(draft);
  const over = bytes > PREFERENCES_MAX_BYTES;
  const unchanged = draft === (prefs.preferences ?? '');
  const fieldId = `job-preferences-${jobName}`;
  return (
    <div className="space-y-1.5">
      <Textarea
        id={fieldId}
        aria-label={`Preferences for ${jobName}`}
        aria-describedby={`${fieldId}-help`}
        aria-invalid={over || undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder="What to cover, what to skip, tone and length."
        className="resize-y"
      />
      <p id={`${fieldId}-help`} className="max-w-[64ch] text-xs text-muted-foreground">
        {prefs.required && !prefs.preferences ? (
          // The one state in which this field decides whether the job runs at all.
          <span className="font-medium text-state-blocked">
            Runs are skipped until these are written.{' '}
          </span>
        ) : null}
        Every run reads them whole, as the reader's words. They cannot grant a tool or change where
        the output goes. Saving the job as someone else clears them.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={saving || unchanged || over || !draft.trim()}
          onClick={() => write(draft)}
        >
          Save preferences
        </Button>
        {prefs.preferences && (
          <ConfirmButton
            size="xs"
            variant="ghost"
            destructive
            disabled={saving}
            question={
              prefs.required
                ? `Clear them? ${jobName} requires preferences, so its runs are skipped until new ones are written.`
                : 'Clear these preferences?'
            }
            confirmLabel="Clear preferences"
            onConfirm={() => write(null)}
          >
            Clear
          </ConfirmButton>
        )}
        <span
          className={`text-xs tabular-nums ${over ? 'text-state-failed' : 'text-muted-foreground'}`}
        >
          {bytes.toLocaleString()} / {PREFERENCES_MAX_BYTES.toLocaleString()} bytes
        </span>
        {prefs.updated_at != null && (
          <span
            className="text-xs text-muted-foreground"
            title={new Date(prefs.updated_at).toLocaleString()}
          >
            {prefs.preferences ? 'saved' : 'cleared'} {relativeTime(prefs.updated_at)}
            {prefs.updated_by ? ` by ${prefs.updated_by}` : ''}
          </span>
        )}
      </div>
      {writeError != null && <ErrorNotice error={writeError} doing="save these preferences" />}
    </div>
  );
}

export function JobStateSection({ jobName }: { jobName: string }) {
  const [items, setItems] = useState<JobStateEntry[] | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    setReadError(null);
    getJobState(jobName).then(
      (rows) => live && setItems(rows),
      (err: unknown) => live && setReadError(err),
    );
    return () => {
      live = false;
    };
  }, [jobName]);

  async function act(
    run: () => Promise<unknown>,
    after: (rows: JobStateEntry[]) => JobStateEntry[],
  ) {
    setBusy(true);
    setWriteError(null);
    try {
      await run();
      setItems((rows) => after(rows ?? []));
    } catch (err) {
      setWriteError(err);
    } finally {
      setBusy(false);
    }
  }

  if (readError != null) {
    return isForbidden(readError) ? (
      <NotYours what="saved state" />
    ) : (
      <ErrorNotice error={readError} doing="read this job's saved state" />
    );
  }
  if (!items) return <p className="text-xs text-muted-foreground">Loading saved state…</p>;
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Its runs have saved nothing. An agent with <code>spec.state</code> keeps a bookmark here
        between runs.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <ul className="space-y-0.5">
        {items.map((entry) => (
          <li
            key={entry.key}
            className="grid grid-cols-[minmax(6rem,12rem)_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs text-muted-foreground"
          >
            {/* Mono: the agent named it. */}
            <span className="truncate font-mono text-foreground/90" title={entry.key}>
              {entry.key}
            </span>
            {/* Agent-written, and may hold text it copied from a source: drawn as text only. */}
            <span className="truncate font-mono" title={entry.value}>
              {entry.value}
            </span>
            <span title={new Date(entry.updated_at).toLocaleString()}>
              {relativeTime(entry.updated_at)}
            </span>
            <ConfirmButton
              size="xs"
              variant="ghost"
              destructive
              disabled={busy}
              className="text-muted-foreground hover:text-state-failed"
              question={`Remove ${entry.key}? The next run will not see it.`}
              confirmLabel="Remove key"
              onConfirm={() =>
                act(
                  () => deleteJobStateKey(jobName, entry.key),
                  (rows) => rows.filter((r) => r.key !== entry.key),
                )
              }
            >
              <Trash2Icon className="size-3" />
              <span className="sr-only">Remove {entry.key}</span>
            </ConfirmButton>
          </li>
        ))}
      </ul>
      <ConfirmButton
        size="xs"
        variant="outline"
        destructive
        disabled={busy}
        question={`Clear all ${items.length} ${items.length === 1 ? 'key' : 'keys'}? The next run starts from nothing.`}
        confirmLabel="Clear saved state"
        onConfirm={() =>
          act(
            () => clearJobState(jobName),
            () => [],
          )
        }
      >
        Clear all
      </ConfirmButton>
      {writeError != null && (
        <ErrorNotice error={writeError} doing="change this job's saved state" />
      )}
    </div>
  );
}
