import { relativeTime } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Skeleton } from '@felix/ui/skeleton';
import { Textarea } from '@felix/ui/textarea';
import { GitBranchIcon, PencilIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  activateManifestVersion,
  clearManifestCanary,
  createManifestVersion,
  getResolvedManifest,
  listTenantManifests,
  setManifestCanary,
} from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import { ManifestItem } from '@/components/harness/harness-agent';
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
import {
  type KnownVersion,
  knownVersions,
  recordFromPointer,
  recordVersion,
} from '@/lib/manifest-versions';
import type { ManifestSummary } from '@/types';

/**
 * Manifest lifecycle workbench — the `/manifests` surface as a `/harness` page.
 * Tenant-managed manifests are an append-only version log with an active
 * pointer and an optional weighted canary pointer. Here you can import the
 * current agent into the tenant version log, append edited versions, flip the
 * active pointer, and drive a weighted canary.
 *
 * The harness exposes no version *list* route, so there is no version log to
 * render: `GET /manifests` returns active pointers only, and a version is acted
 * on by number. Canary routing is decided server-side by a deterministic hash,
 * not by a request header.
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
  // The list's own read, apart from the actions. Sharing one slot meant a failed
  // reload was drawn exactly like a failed activation, and a failed activation
  // offered "Try again" that only reloaded the list.
  const [listError, setListError] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listTenantManifests();
      for (const row of r) recordFromPointer(row.name, row);
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
      recordVersion(name, {
        version: created.version,
        comment: created.comment,
        via: 'created',
      });
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
                    <Select
                      value={importName || undefined}
                      onValueChange={(v) => {
                        if (v === OTHER) {
                          setTyping(true);
                          setImportName('');
                        } else setImportName(v);
                      }}
                    >
                      <SelectTrigger
                        id="manifest-import-name"
                        size="sm"
                        className="mt-1 h-8 w-full font-mono text-sm data-[placeholder]:font-sans"
                      >
                        {/* The name alone once chosen; the item carries the model too. */}
                        <SelectValue placeholder="Choose a manifest">
                          {importName || undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((m) => (
                          <ManifestItem key={m} id={m} providerModel={providerModels?.get(m)} />
                        ))}
                        <SelectItem value={OTHER} className="text-sm">
                          Another name…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="manifest-import-name"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      aria-describedby="manifest-import-help"
                      placeholder={`e.g. ${manifest}`}
                      className="mt-1 h-8 font-mono text-sm placeholder:font-sans"
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
            onChanged={refresh}
            onError={(err, doing) => setFailure({ err, doing })}
          />
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/**
 * Versions this browser has seen, as something to click.
 *
 * Labelled honestly: a version created elsewhere will not appear, so this is offered
 * as a shortcut rather than as the version log. Picking one fills the activate field
 * instead of acting directly — the confirmation step still stands between a click
 * here and production traffic moving.
 */
function VersionChips({
  known,
  activeV,
  canaryV,
  onPick,
}: {
  known: KnownVersion[];
  activeV: number | null;
  canaryV: number | null;
  onPick: (v: string) => void;
}) {
  if (known.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="mb-1 text-xs text-muted-foreground">Seen from this browser</div>
      <div className="flex flex-wrap gap-1">
        {known.map((k) => {
          const isActive = k.version === activeV;
          const isCanary = k.version === canaryV;
          return (
            <Button
              key={k.version}
              size="sm"
              variant={isActive ? 'secondary' : 'ghost'}
              className="gap-1 font-mono text-xs"
              disabled={isActive}
              title={k.comment ? `${k.comment} · seen ${relativeTime(k.seenAt)}` : undefined}
              onClick={() => onPick(String(k.version))}
            >
              v{k.version}
              {isActive && <span className="text-muted-foreground">active</span>}
              {isCanary && !isActive && <span className="text-muted-foreground">canary</span>}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function VersionsPanel({
  summary,
  onChanged,
  onError,
}: {
  summary: ManifestSummary;
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
  const [targetVersion, setTargetVersion] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<string | null>(null);
  // A syntax error in the textarea is a field problem, not a failed request, so it
  // belongs next to the textarea rather than in the sheet-level error slot.
  const [editorError, setEditorError] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  /** @param doing verb phrase completing "Could not …", e.g. `activate v13 of quick`. */
  async function act(fn: () => Promise<unknown>, doing: string) {
    setBusy(true);
    try {
      await fn();
      onChanged();
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
      recordVersion(name, {
        version: created.version,
        comment: created.comment ?? note,
        via: 'created',
      });
      setEditor(null);
    }, `save a new version of ${name}`);
  }

  const canaryN = Number(canaryVersion);
  const canaryValid = canaryVersion.trim() !== '' && Number.isInteger(canaryN) && canaryN > 0;
  const targetN = Number(targetVersion);
  const targetValid =
    targetVersion.trim() !== '' && Number.isInteger(targetN) && targetN > 0 && targetN !== activeV;

  // Versions seen from this browser. Re-read on every render rather than held in
  // state: the poll writes to it, and the list is a handful of integers.
  const known = knownVersions(name);

  /**
   * Why a control is refusing, in a sentence. Both of these used to be silent
   * disables — type the version already active and the button simply died.
   */
  function targetReason(): string | null {
    if (targetVersion.trim() === '') return null;
    if (!Number.isInteger(targetN) || targetN <= 0) return 'Version must be a whole number.';
    if (targetN === activeV) return `v${targetN} is already active.`;
    return null;
  }
  function canaryReason(): string | null {
    if (canaryVersion.trim() === '') return null;
    if (!Number.isInteger(canaryN) || canaryN <= 0) return 'Version must be a whole number.';
    if (canaryN === activeV) return `v${canaryN} is already serving all traffic.`;
    if (known.length > 0 && !known.some((k) => k.version === canaryN)) {
      return `This browser has not seen v${canaryN}. Check the number before rolling it out.`;
    }
    return null;
  }

  return (
    <>
      <PageSection
        title="Active"
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
              v{activeV}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">no tenant version</span>
          )
        }
      >
        <VersionChips
          known={known}
          activeV={activeV}
          canaryV={liveCanaryV}
          onPick={setTargetVersion}
        />
        {/* wraps so an armed confirmation gets its own line instead of squeezing the
            version field it is echoing */}
        {/* A visible label, and the reason the field is a number: this moves every
            request for the manifest, and a placeholder that vanished on the first
            digit was its only name. */}
        <Label htmlFor={`manifest-activate-${name}`}>Version to activate</Label>
        <div className="mt-1 flex max-w-md flex-wrap items-center gap-2">
          <Input
            id={`manifest-activate-${name}`}
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
            inputMode="numeric"
            aria-describedby={`manifest-activate-help-${name}`}
            className="h-8 min-w-0 flex-1 font-mono text-sm"
          />
          <ConfirmButton
            size="sm"
            className="gap-1"
            disabled={busy || !targetValid}
            question={`v${targetN} will serve all traffic for ${name}.`}
            confirmLabel={`Activate v${targetN}`}
            onConfirm={() =>
              act(async () => {
                await activateManifestVersion(name, targetN);
                setTargetVersion('');
              }, `activate v${targetN} of ${name}`)
            }
          >
            {/* No icon: it was a rollback arrow, on a control that as often
                moves forward. */}
            Activate
          </ConfirmButton>
        </div>
        <p id={`manifest-activate-help-${name}`} className="mt-1 text-xs text-muted-foreground">
          {targetReason() ??
            'The harness does not list versions, so this takes a number; the chips above are the ones this browser has seen.'}
        </p>
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
              className="mt-1 h-8 w-24 font-mono text-sm"
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
            Saving appends a version and leaves the active one where it is. There is no version
            history route, so activate it by number under Active.
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
                className="mt-1 h-8 text-sm"
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
                className="mt-1 resize-y bg-transparent p-2 font-mono text-sm leading-snug shadow-none aria-invalid:border-state-failed"
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
