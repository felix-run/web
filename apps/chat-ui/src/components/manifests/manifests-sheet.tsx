import { relativeTime } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { cn } from '@felix/ui/lib/utils';
import { SelectItem } from '@felix/ui/select';
import { Skeleton } from '@felix/ui/skeleton';
import { Textarea } from '@felix/ui/textarea';
import { GitBranchIcon, PencilIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  activateManifestVersion,
  clearManifestCanary,
  createManifestVersion,
  getResolvedManifest,
  listManifestVersions,
  listTenantManifests,
  setManifestCanary,
} from '@/api';
import { AgentSelect } from '@/components/agent-select';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import {
  CREATE_FORM,
  CreateToggle,
  PageEmpty,
  PageHeader,
  PageSection,
  Panel,
  PanelBody,
  plural,
} from '@/components/harness/panel';
import { ReadFailure, withAge } from '@/components/inspector/primitives';
import type { ManifestSummary, ManifestVersionMeta, ManifestVersionRow } from '@/types';

/**
 * Manifest lifecycle workbench — the `/manifests` surface as a `/harness` page.
 * Tenant-managed manifests are an append-only version log with an active
 * pointer and an optional weighted canary pointer. Here you can import the
 * current agent into the tenant version log, append edited versions, flip the
 * active pointer, and drive a weighted canary.
 *
 * The version log is `GET /manifests/{name}/versions`, newest first, and every
 * version is activated or canaried from its row. This page used to say the
 * harness had no such route — it has served one since v0.5.0 — and offered a
 * number field plus the versions this browser happened to have seen. Canary
 * routing is decided server-side by a deterministic hash, not by a request header.
 *
 * Writes need the `manifests:write` scope; with FELIX_AUTH_MODE=none the harness
 * skips scope checks, so the whole flow is drivable unauthenticated locally.
 */
/** The Select value that swaps the pick list for a typed name. */
const OTHER = '__other__';

export function ManifestsSheet({
  manifest,
  bundled = [],
  providerModels,
}: {
  manifest: string;
  /**
   * The manifests the harness ships as files (`/v1/models` lists `list_bundled()`),
   * which is what Import copies into the tenant's version log.
   */
  bundled?: string[];
  /** Provider model by name, so the list can say what each would run on. */
  providerModels?: Map<string, string | undefined>;
}) {
  const [rows, setRows] = useState<ManifestSummary[]>([]);
  /** Whether `rows` is an answer yet: `0 manifests` before the first list is a claim. */
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Empty, not the active agent's name. Prefilled, the page opened one confirm
  // away from making `cowork` tenant-managed — the heaviest consequence here,
  // staged by default on every visit.
  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);
  // Typing is the fallback, not the default: a manifest can also resolve from an
  // object store the harness does not list, and that one still has to be named.
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  // The error and the verb that produced it travel together. This slot used to be a
  // bare error rendered with one hardcoded phrase, so a failed *activation* — the
  // highest-stakes action here — reported "Could not reach the manifest registry".
  const [failure, setFailure] = useState<{ err: unknown; doing: string } | null>(null);
  /** Per manifest: what the harness warned about the version this tab last stored. */
  const [warned, setWarned] = useState<Record<string, SavedWarnings | null>>({});
  // The list's own read, apart from the actions. Sharing one slot meant a failed
  // reload was drawn exactly like a failed activation, and a failed activation
  // offered "Try again" that only reloaded the list.
  const [listError, setListError] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listTenantManifests();
      setRows(r);
      setLoaded(true);
      setListError(null);
      setLastOkAt(Date.now());
      setSelected((cur) => cur ?? r[0]?.name ?? null);
    } catch (err) {
      // `rows` is left as it was: the last list the harness answered stays on
      // screen, under a line saying how old it is.
      setListError(err);
    }
  }, []);

  useEffect(() => {
    // No `open` guard: a route mounts this only while it is the address, so being
    // rendered *is* being open. Left in place, `open` silently resolved to
    // `window.open` — always truthy, and a condition that reads as a gate while
    // gating nothing.
    void refresh();
  }, [refresh]);

  // Import any resolvable manifest (e.g. the bundled chat-ui-demo) into the
  // tenant version log as v1 so the lifecycle has something to act on.
  async function importManifest() {
    const name = importName.trim();
    if (!name) return;
    setBusy(true);
    setFailure(null);
    try {
      const resolved = await getResolvedManifest(name);
      const created = await createManifestVersion(
        name,
        resolved.manifest,
        // `source` is typed but never sent, so this recorded "imported from
        // undefined" on every import. The version is what the route answers.
        resolved.version != null
          ? `imported from v${resolved.version}`
          : 'imported from its resolved spec',
      );
      setWarned((w) => ({ ...w, [name]: warningsOf(created) }));
      await refresh();
      setSelected(name);
      setImporting(false);
    } catch (err) {
      setFailure({ err, doing: `import ${name} as a new version` });
    } finally {
      setBusy(false);
    }
  }

  const selectedRow = rows.find((r) => r.name === selected) ?? null;
  // What Import can copy: the bundled manifests this tenant does not manage yet.
  const managed = new Set(rows.map((r) => r.name));
  const candidates = bundled.filter((m) => !managed.has(m));
  // The same test the picker uses to draw `v3 · 10%`, so the header and the
  // buttons below it never disagree about what is rolling out.
  const canaries = rows.filter(
    (r) => r.canary_version != null && (r.canary_weight ?? 0) > 0,
  ).length;

  return (
    <Panel>
      {/* Named as the nav names it. The value counts what this tenant manages
          and, when any is mid-rollout, how many — the one fact on this page that
          changes what the next chat turn runs. */}
      <PageHeader
        icon={<GitBranchIcon />}
        title="Manifests"
        // Aged when the latest read failed: the count is the last list's.
        value={withAge(
          loaded
            ? // *Tenant* manifests: "0 manifests" beside an Agent page running
              // `cowork` read as a contradiction, when it counts only the ones
              // with a version log here.
              [
                plural(rows.length, 'tenant manifest'),
                canaries > 0 ? `${canaries} in canary` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined,
          listError != null ? lastOkAt : undefined,
        )}
        controls={
          <CreateToggle
            open={importing}
            onToggle={() => setImporting((v) => !v)}
            controls="manifest-import"
          >
            Import
          </CreateToggle>
        }
      />

      <PanelBody>
        {listError != null && (
          <ReadFailure
            error={listError}
            doing="list tenant manifests"
            lastOkAt={lastOkAt}
            onRetry={() => void refresh()}
          />
        )}
        {/* An action's failure: no retry, because re-running a write is not
            something to offer with one click — the form it came from is still
            there to do it again deliberately. */}
        {failure && (
          <div className="mb-4">
            <ErrorNotice error={failure.err} doing={failure.doing} />
          </div>
        )}

        {/*
            Behind the header's toggle, and opening as the page's first section,
            as every page's create does. It led the page as its heaviest control
            once — a filled button ~1100px from its label — while being the action
            taken least: once per manifest, ever. And for a name the tenant does
            not yet manage it is not a quiet write: the harness makes a first
            version active, so from then on the name resolves to the tenant copy
            instead of the file. Hence the confirmation that says which case.
          */}
        {importing && (
          <div id="manifest-import" className={CREATE_FORM}>
            <PageSection title="From a file">
              <p className="mb-2 text-sm text-muted-foreground">
                Copy a manifest the harness resolves from a file into this tenant's version log.
              </p>
              {/*
                  A pick list of what can be imported, rather than a name typed
                  from memory: this is the heaviest write on the page, and a typo
                  here was a failed request at best — at worst, one letter off a
                  real name, an import of the wrong manifest. The list is the
                  bundled manifests not already tenant-managed; anything else is
                  still reachable by name.
                */}
              <div className="flex max-w-md items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="manifest-import-name">Manifest</Label>
                  {candidates.length > 0 && !typing ? (
                    <AgentSelect
                      id="manifest-import-name"
                      value={importName}
                      options={candidates}
                      onValueChange={(v) => {
                        if (v === OTHER) {
                          setTyping(true);
                          setImportName('');
                        } else setImportName(v);
                      }}
                      placeholder="Choose a manifest"
                      providerModels={providerModels}
                      className="mt-1 w-full"
                      trailing={<SelectItem value={OTHER}>Another name…</SelectItem>}
                    />
                  ) : (
                    <Input
                      id="manifest-import-name"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      aria-describedby="manifest-import-help"
                      placeholder={`e.g. ${manifest}`}
                      className="mt-1 font-mono placeholder:font-sans"
                    />
                  )}
                </div>
                <ConfirmButton
                  size="sm"
                  variant="outline"
                  className="whitespace-nowrap"
                  disabled={busy || !importName.trim()}
                  question={
                    rows.some((r) => r.name === importName.trim())
                      ? `Appends ${importName.trim()} as a new version. The active version does not change.`
                      : `${importName.trim()} becomes tenant-managed, and its v1 is what the name resolves to from now on.`
                  }
                  confirmLabel={`Import ${importName.trim()}`}
                  onConfirm={importManifest}
                >
                  Import as version
                </ConfirmButton>
              </div>
              {/* Said, so an empty list or a typed name is not a mystery. */}
              {(typing || candidates.length === 0) && (
                <p id="manifest-import-help" className="mt-1 text-xs text-muted-foreground">
                  {candidates.length === 0
                    ? bundled.length > 0
                      ? 'Every manifest the harness ships is already tenant-managed. Name another one it can resolve.'
                      : 'Name a manifest the harness can resolve.'
                    : 'A manifest the harness resolves but does not list, by name. '}
                  {typing && candidates.length > 0 && (
                    <button
                      type="button"
                      className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                      onClick={() => {
                        setTyping(false);
                        setImportName('');
                      }}
                    >
                      Back to the list
                    </button>
                  )}
                </p>
              )}
            </PageSection>
          </div>
        )}

        {/*
            Capped and scrollable. It wrapped without a height, so twenty of
            these pushed the panel they select *for* off the bottom of the sheet
            — the control growing until the thing it controls is unreachable.
            Read from the code rather than measured: the local harness has one.
          */}
        {rows.length > 0 ? (
          <div
            role="group"
            aria-label="Tenant manifests"
            className="mb-5 flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto"
          >
            {rows.map((r) => (
              <Button
                key={r.name}
                size="sm"
                variant={selected === r.name ? 'secondary' : 'ghost'}
                className="gap-1 font-mono text-sm"
                // Selection was carried by the `secondary` fill alone, which is colour
                // as the only channel and inaudible to a screen reader.
                aria-pressed={selected === r.name}
                onClick={() => setSelected(r.name)}
              >
                {r.name}
                {r.canary_version != null && (r.canary_weight ?? 0) > 0 && (
                  // The numbers, not a diamond that only a mouse could decode.
                  // The version and the weight were in a `title` — invisible to
                  // touch and to a keyboard — while the `aria-label` said only
                  // "has a canary rollout", so the two facts that decide whether
                  // to care reached nobody who was not hovering. They are short
                  // enough to render, and `v3 · 10%` is the whole message.
                  <span className="font-mono text-xs text-foreground">
                    v{r.canary_version} · {r.canary_weight}%
                  </span>
                )}
              </Button>
            ))}
          </div>
        ) : loaded ? (
          // Names what is running anyway. "0 manifests" beside a chat plainly
          // running `contributor` read as the agents having gone missing; they
          // are bundled files, which this page does not version until imported.
          <div className="mb-5">
            <PageEmpty>
              No tenant-managed manifests yet.{' '}
              {candidates.length > 0 ? (
                <>
                  <span className="font-mono">{candidates.join(', ')}</span>{' '}
                  {candidates.length === 1 ? 'serves' : 'serve'} chat as bundled{' '}
                  {candidates.length === 1 ? 'file' : 'files'}; import one to start its version log.
                </>
              ) : (
                'Import one to start its version log.'
              )}
            </PageEmpty>
          </div>
        ) : listError ? null : (
          // It drew nothing at all until the first read answered. A first read
          // that failed has its own line above, and a skeleton under it would
          // say the answer is still coming.
          <div className="mb-5 space-y-1.5">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        )}

        {selectedRow ? (
          <VersionsPanel
            key={selectedRow.name}
            summary={selectedRow}
            {...(warned[selectedRow.name] ? { warned: warned[selectedRow.name] } : {})}
            onWarned={(v) => setWarned((w) => ({ ...w, [selectedRow.name]: v }))}
            onChanged={refresh}
            onError={(err, doing) => setFailure({ err, doing })}
          />
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** The harness's warnings about one stored version: shown until dismissed or saved over. */
interface SavedWarnings {
  version: number;
  warnings: string[];
}

function warningsOf(created: ManifestVersionRow): SavedWarnings | null {
  const warnings = (created.warnings ?? []).filter((w) => typeof w === 'string' && w.trim());
  return warnings.length ? { version: created.version, warnings } : null;
}

/**
 * What the harness stored but would not stay quiet about — today, an approval
 * rule that gates writes while deletes go ungated. The harness warns rather
 * than refuses so an upgrade cannot take an agent down, which is why the
 * operator has to be told here, where the save was made. A save appends a
 * version without activating it, so the note says which: a live version with a
 * warning, or one that should not be activated until the warning is dealt with.
 */
function SavedWarningsNote({
  warned,
  activeVersion,
  onDismiss,
}: {
  warned: SavedWarnings;
  /** The version serving now: a save appends without activating. */
  activeVersion: number | null;
  onDismiss: () => void;
}) {
  const live = activeVersion === warned.version;
  const count = warned.warnings.length === 1 ? 'a warning' : `${warned.warnings.length} warnings`;
  return (
    <div
      role="status"
      data-slot="manifest-warnings"
      className="mb-4 flex items-start gap-3 rounded-xl bg-ground px-4 py-3"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-state-blocked" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">
          {live
            ? `v${warned.version} is saved and active, with ${count}`
            : `v${warned.version} is saved, with ${count}. It is not active: deal with ${warned.warnings.length === 1 ? 'it' : 'them'} before activating it.`}
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {warned.warnings.map((w) => (
            <li key={w} className="wrap-anywhere">
              {w}
            </li>
          ))}
        </ul>
      </div>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

/** A page of the version log: enough to roll back a few steps without scrolling past it. */
const VERSIONS_PAGE = 10;

/**
 * The version log, newest first, each row acting on itself. Activate is
 * confirmed — it moves every request for the manifest — and Canary only fills
 * the canary field below, so the weight is still chosen before anything moves.
 * The marks are read off the pointer the page already holds, not the rows' own
 * `active`/`canary`, so the list and the header never disagree about what serves.
 */
function VersionList({
  name,
  versions,
  error,
  activeV,
  canaryV,
  canaryWeight,
  busy,
  hasOlder,
  loadingOlder,
  onOlder,
  onRetry,
  onActivate,
  onCanary,
}: {
  name: string;
  versions: ManifestVersionMeta[] | null;
  error: unknown;
  activeV: number | null;
  canaryV: number | null;
  canaryWeight: number;
  busy: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onOlder: () => void;
  onRetry: () => void;
  onActivate: (version: number) => Promise<void>;
  onCanary: (version: number) => void;
}) {
  return (
    <div>
      {error != null && (
        <ReadFailure
          error={error}
          doing={`list the versions of ${name}`}
          lastOkAt={null}
          onRetry={onRetry}
        />
      )}
      {versions == null ? (
        error == null && (
          <div className="space-y-1.5">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        )
      ) : versions.length === 0 ? (
        // Bundled-only deployments store no versions, so the route answers empty.
        <p className="text-sm text-muted-foreground">
          The harness lists no stored versions of {name}.
        </p>
      ) : (
        <ul aria-label={`Versions of ${name}`} className="text-sm">
          {versions.map((v) => {
            const active = v.version === activeV;
            const canary = v.version === canaryV;
            return (
              <li
                key={v.version}
                data-slot="manifest-version"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 py-1.5 first:border-t"
              >
                <span className="w-10 shrink-0 font-mono font-medium">v{v.version}</span>
                {active && (
                  <Badge variant="secondary" className="py-0 text-xs">
                    active
                  </Badge>
                )}
                {canary && (
                  <Badge
                    variant={canaryWeight > 0 ? 'default' : 'secondary'}
                    className="py-0 text-xs"
                  >
                    {canaryWeight > 0 ? `canary · ${canaryWeight}%` : 'canary · no traffic'}
                  </Badge>
                )}
                <span
                  className={cn(
                    // Its own line on a phone, under the number: squeezed beside the
                    // meta and the buttons at 390px it read "raise…" on every row, and the
                    // comment is what tells one version from the next.
                    'order-last min-w-0 basis-full truncate pl-13 sm:order-none sm:flex-1 sm:basis-0 sm:pl-0',
                    v.comment ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  title={v.comment || undefined}
                >
                  {v.comment || 'no comment'}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {[
                    v.created_by ? `by ${v.created_by}` : null,
                    v.created_at != null ? relativeTime(v.created_at) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {!active && (
                  <span className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy || canary}
                      aria-label={`Canary v${v.version}`}
                      onClick={() => onCanary(v.version)}
                    >
                      Canary
                    </Button>
                    <ConfirmButton
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      question={`v${v.version} will serve all traffic for ${name}.`}
                      confirmLabel={`Activate v${v.version}`}
                      onConfirm={() => onActivate(v.version)}
                    >
                      Activate
                    </ConfirmButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasOlder && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1"
          disabled={loadingOlder}
          onClick={onOlder}
        >
          {loadingOlder ? 'Loading…' : 'Show older versions'}
        </Button>
      )}
    </div>
  );
}

function VersionsPanel({
  summary,
  warned,
  onWarned,
  onChanged,
  onError,
}: {
  summary: ManifestSummary;
  /** What the harness said about the version this tab last stored, if anything. */
  warned?: SavedWarnings | null;
  onWarned: (warned: SavedWarnings | null) => void;
  onChanged: () => void;
  onError: (err: unknown, doing: string) => void;
}) {
  const name = summary.name;
  const activeV = summary.version;
  const liveCanaryV = summary.canary_version ?? null;
  const liveWeight = summary.canary_weight ?? 0;

  const [weight, setWeight] = useState(liveWeight || 25);
  const [canaryVersion, setCanaryVersion] = useState<string>(
    liveCanaryV != null ? String(liveCanaryV) : '',
  );
  const [busy, setBusy] = useState(false);
  // The version log, newest first. `null` until the first page answers, so an empty
  // list is never drawn while it is still coming.
  const [versions, setVersions] = useState<ManifestVersionMeta[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [versionsError, setVersionsError] = useState<unknown>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [editor, setEditor] = useState<string | null>(null);
  // A syntax error in the textarea is a field problem, not a failed request, so it
  // belongs next to the textarea rather than in the sheet-level error slot.
  const [editorError, setEditorError] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const loadVersions = useCallback(async () => {
    try {
      const page = await listManifestVersions(name, { limit: VERSIONS_PAGE });
      setVersions(page.items);
      setNextBefore(page.next_before);
      setVersionsError(null);
    } catch (err) {
      setVersionsError(err);
    }
  }, [name]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  async function loadOlder() {
    if (nextBefore == null) return;
    setLoadingOlder(true);
    try {
      const page = await listManifestVersions(name, { limit: VERSIONS_PAGE, before: nextBefore });
      setVersions((cur) => [...(cur ?? []), ...page.items]);
      setNextBefore(page.next_before);
      setVersionsError(null);
    } catch (err) {
      setVersionsError(err);
    } finally {
      setLoadingOlder(false);
    }
  }

  /** @param doing verb phrase completing "Could not …", e.g. `activate v13 of quick`. */
  async function act(fn: () => Promise<unknown>, doing: string) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      // A save adds a row; the others move the marks, which are read off the pointer.
      void loadVersions();
    } catch (err) {
      onError(err, doing);
    } finally {
      setBusy(false);
    }
  }

  // Seed the JSON editor with the current resolved manifest so a new version is
  // an edit of the live one rather than authored from scratch.
  async function openEditor() {
    try {
      const resolved = await getResolvedManifest(name);
      setEditor(JSON.stringify(resolved.manifest, null, 2));
      setComment('');
    } catch (err) {
      onError(err, `open ${name} for editing`);
    }
  }

  async function saveVersion() {
    if (!editor) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor);
      setEditorError(null);
    } catch (err) {
      // The parser says *where* it gave up, which is the only useful part.
      setEditorError(String((err as Error)?.message ?? 'Editor content is not valid JSON.'));
      return;
    }
    const note = comment.trim() || 'edited in chat-ui';
    await act(async () => {
      const created = await createManifestVersion(name, parsed, note);
      onWarned(warningsOf(created));
      setEditor(null);
    }, `save a new version of ${name}`);
  }

  const canaryN = Number(canaryVersion);
  const canaryValid = canaryVersion.trim() !== '' && Number.isInteger(canaryN) && canaryN > 0;
  // Versions are numbered densely from 1 and never rewritten, so the newest
  // number bounds every version that exists — even ones on a page not loaded yet.
  const newest = versions?.[0]?.version ?? null;

  /**
   * Why the canary refuses, in a sentence. It used to be a silent disable —
   * type the version already active and the button simply died.
   */
  function canaryReason(): string | null {
    if (canaryVersion.trim() === '') return null;
    if (!Number.isInteger(canaryN) || canaryN <= 0) return 'Version must be a whole number.';
    if (canaryN === activeV) return `v${canaryN} is already serving all traffic.`;
    if (newest != null && canaryN > newest) {
      return `There is no v${canaryN}: the newest version of ${name} is v${newest}.`;
    }
    return null;
  }

  return (
    <>
      {warned && (
        <SavedWarningsNote
          warned={warned}
          activeVersion={activeV ?? null}
          onDismiss={() => onWarned(null)}
        />
      )}
      <PageSection
        title="Versions"
        meta={
          // Who moved this pointer and when. Both are on the wire and neither was
          // rendered — it is the first thing worth knowing before moving it again.
          summary.updated_at != null
            ? `changed ${relativeTime(summary.updated_at)}${
                summary.updated_by ? ` by ${summary.updated_by}` : ''
              }`
            : undefined
        }
        actions={
          activeV != null ? (
            <Badge variant="secondary" className="py-0 font-mono text-xs">
              v{activeV} active
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">no tenant version</span>
          )
        }
      >
        <VersionList
          name={name}
          versions={versions}
          error={versionsError}
          activeV={activeV ?? null}
          canaryV={liveCanaryV}
          canaryWeight={liveWeight}
          busy={busy}
          hasOlder={nextBefore != null}
          loadingOlder={loadingOlder}
          onOlder={() => void loadOlder()}
          onRetry={() => void loadVersions()}
          onActivate={(v) =>
            act(() => activateManifestVersion(name, v), `activate v${v} of ${name}`)
          }
          onCanary={(v) => setCanaryVersion(String(v))}
        />
      </PageSection>

      <PageSection
        title="Canary"
        actions={
          /*
            Three states, not two. Reading "in flight" as `version && weight > 0`
            here while the Clear button reads it as `version != null` meant a
            canary pinned at 0% reported itself absent *and* offered a button to
            clear it. Naming the middle state fixes the contradiction without
            having to pick which of the two readings was right — both were, about
            different things: one about traffic, one about what is set.
          */
          liveCanaryV == null ? (
            <span className="text-xs text-muted-foreground">none set</span>
          ) : liveWeight > 0 ? (
            <Badge className="py-0 text-xs">
              v{liveCanaryV} @ {liveWeight}%
            </Badge>
          ) : (
            <Badge variant="secondary" className="py-0 text-xs">
              v{liveCanaryV} · no traffic
            </Badge>
          )
        }
      >
        <div className="flex max-w-md items-end gap-2">
          <div>
            <Label htmlFor={`manifest-canary-${name}`}>Version</Label>
            <Input
              id={`manifest-canary-${name}`}
              value={canaryVersion}
              onChange={(e) => setCanaryVersion(e.target.value)}
              inputMode="numeric"
              className="mt-1 w-24 font-mono"
            />
          </div>
          {/* This slider decides what share of live traffic moves to the canary, and
              announced as "slider, 25" — no name at all. `aria-valuetext` makes the
              value a percentage rather than a bare number. */}
          <input
            type="range"
            min={0}
            max={100}
            value={weight}
            aria-label={`Canary traffic weight for ${name}`}
            aria-valuetext={`${weight} percent`}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="h-6 min-w-0 flex-1 accent-primary"
          />
          <span className="w-9 text-right font-mono text-sm">{weight}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <ConfirmButton
            size="sm"
            disabled={busy || !canaryValid}
            question={`v${canaryN} will take ${weight}% of traffic for ${name}.`}
            confirmLabel={`Send ${weight}% to v${canaryN}`}
            onConfirm={() =>
              act(
                () => setManifestCanary(name, canaryN, weight),
                `send ${weight}% of traffic to v${canaryN} of ${name}`,
              )
            }
          >
            Apply canary
          </ConfirmButton>
          {/*
            Deliberately not confirmed, unlike its two neighbours. Clearing a canary
            is the rollback: it sends every request back to the version that was
            already active. It is the control an operator reaches for when a rollout
            is going wrong, and putting a confirmation step in front of the recovery
            path buys nothing and costs seconds when they matter most.
          */}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || liveCanaryV == null}
            onClick={() =>
              act(async () => {
                await clearManifestCanary(name);
                setCanaryVersion('');
              }, `clear the canary on ${name}`)
            }
            title="Drop the canary version and zero its weight"
          >
            Clear canary
          </Button>
        </div>
        {canaryReason() && <p className="mt-1 text-xs text-muted-foreground">{canaryReason()}</p>}
        <p className="mt-2 text-sm text-muted-foreground">
          Routing is a deterministic hash of tenant, thread and both versions, so a thread stays on
          one side for the whole rollout.
        </p>
      </PageSection>

      <PageSection
        title="New version"
        actions={
          editor == null ? (
            <Button size="sm" variant="outline" className="gap-1" onClick={openEditor}>
              <PencilIcon className="size-3.5" /> Edit current
            </Button>
          ) : null
        }
      >
        {/*
            Said as the harness does it. This read "Publishing appends a new
            version and activates it", which is true exactly once: `put_version`
            points the name at the new version only when nothing is active yet,
            and leaves the pointer alone every time after.
          */}
        {editor == null && (
          <p className="text-sm text-muted-foreground">
            Saving appends a version and leaves the active one where it is; activate it from
            Versions.
          </p>
        )}
        {editor != null && (
          <div className="space-y-2">
            <div>
              <Label htmlFor="manifest-version-comment">Change comment</Label>
              <Input
                id="manifest-version-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="what changed, e.g. raised max_tool_calls"
                className="mt-1"
              />
            </div>
            <div>
              {/* This carried `aria-describedby` while having no accessible name to
                  describe: a description is not a name. */}
              <Label htmlFor="manifest-editor">Manifest JSON for {name}</Label>
              <Textarea
                id="manifest-editor"
                value={editor}
                onChange={(e) => setEditor(e.target.value)}
                spellCheck={false}
                rows={16}
                aria-invalid={editorError != null}
                aria-describedby={editorError != null ? 'manifest-editor-error' : undefined}
                className="mt-1 resize-y font-mono leading-snug"
              />
            </div>
            {editorError && (
              <p id="manifest-editor-error" role="alert" className="text-sm text-state-failed">
                Not valid JSON: {editorError}
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={saveVersion}>
                Save new version
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditor(null);
                  setEditorError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </PageSection>
    </>
  );
}
