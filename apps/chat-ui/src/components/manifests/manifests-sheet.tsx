import { relativeTime } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@felix/ui/sheet';
import { GitBranchIcon, RotateCcwIcon, SaveIcon } from 'lucide-react';
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
import {
  type KnownVersion,
  knownVersions,
  recordFromPointer,
  recordVersion,
} from '@/lib/manifest-versions';
import type { ManifestSummary } from '@/types';

/**
 * Manifest lifecycle workbench — the `/manifests` surface as a slide-over.
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
export function ManifestsSheet({
  open,
  onOpenChange,
  manifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: string;
}) {
  const [rows, setRows] = useState<ManifestSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [importName, setImportName] = useState(manifest);
  const [busy, setBusy] = useState(false);
  // The error and the verb that produced it travel together. This slot used to be a
  // bare error rendered with one hardcoded phrase, so a failed *activation* — the
  // highest-stakes action here — reported "Could not reach the manifest registry".
  const [failure, setFailure] = useState<{ err: unknown; doing: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listTenantManifests();
      for (const row of r) recordFromPointer(row.name, row);
      setRows(r);
      setFailure(null);
      setSelected((cur) => cur ?? r[0]?.name ?? null);
    } catch (err) {
      setFailure({ err, doing: 'list tenant manifests' });
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

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
        `imported from ${resolved.source}`,
      );
      recordVersion(name, {
        version: created.version,
        comment: created.comment,
        via: 'created',
      });
      await refresh();
      setSelected(name);
    } catch (err) {
      setFailure({ err, doing: `import ${name} as a new version` });
    } finally {
      setBusy(false);
    }
  }

  const selectedRow = rows.find((r) => r.name === selected) ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <GitBranchIcon className="size-4" /> Manifest lifecycle
          </SheetTitle>
          <SheetDescription>
            Tenant-managed versions, active-pointer rollback, and weighted canary rollout.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {failure && (
            <ErrorNotice
              error={failure.err}
              doing={failure.doing}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 self-start text-xs"
                  onClick={refresh}
                >
                  Try again
                </Button>
              }
            />
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {rows.map((r) => (
              <Button
                key={r.name}
                size="sm"
                variant={selected === r.name ? 'secondary' : 'ghost'}
                className="h-7 gap-1 font-mono text-sm"
                // Selection was carried by the `secondary` fill alone, which is colour
                // as the only channel and inaudible to a screen reader.
                aria-pressed={selected === r.name}
                onClick={() => setSelected(r.name)}
              >
                {r.name}
                {r.canary_version != null && (r.canary_weight ?? 0) > 0 && (
                  <span
                    role="img"
                    title={`Canary v${r.canary_version} at ${r.canary_weight}%`}
                    aria-label="has a canary rollout"
                    className="text-xs text-foreground"
                  >
                    ◆
                  </span>
                )}
              </Button>
            ))}
            {rows.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No tenant-managed manifests yet. Import one below to start a version log.
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Input
              id="manifest-import-name"
              aria-label="Manifest name to import"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="manifest name to import"
              className="h-8 font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && importManifest()}
            />
            <Button
              size="sm"
              className="h-8 whitespace-nowrap"
              disabled={busy || !importName.trim()}
              onClick={importManifest}
            >
              Import as version
            </Button>
          </div>

          {selectedRow ? (
            <VersionsPanel
              key={selectedRow.name}
              summary={selectedRow}
              onChanged={refresh}
              onError={(err, doing) => setFailure({ err, doing })}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
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
              className="h-6 gap-1 px-2 font-mono text-xs"
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Active pointer */}
      <div className="rounded-md border bg-card/40 p-2.5 text-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">Active</span>
          {activeV != null ? (
            <Badge variant="secondary" className="py-0 font-mono text-xs">
              v{activeV}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">no tenant version</span>
          )}
          {/* Who moved this pointer and when. Both are on the wire and neither was
              rendered — it is the first thing worth knowing before moving it again. */}
          {summary.updated_at != null && (
            <span className="text-xs text-muted-foreground">
              changed {relativeTime(summary.updated_at)}
              {summary.updated_by ? ` by ${summary.updated_by}` : ''}
            </span>
          )}
        </div>

        <VersionChips
          known={known}
          activeV={activeV}
          canaryV={liveCanaryV}
          onPick={setTargetVersion}
        />
        {/* wraps so an armed confirmation gets its own line instead of squeezing the
            version field it is echoing */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`Version to activate for ${name}`}
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
            inputMode="numeric"
            placeholder="version number"
            className="h-7 flex-1 font-mono text-sm"
          />
          <ConfirmButton
            size="sm"
            className="h-7 gap-1"
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
            <RotateCcwIcon className="size-3.5" /> Activate
          </ConfirmButton>
        </div>
        {targetReason() && <p className="mt-1 text-xs text-muted-foreground">{targetReason()}</p>}
      </div>

      {/* Canary control */}
      <div className="rounded-md border bg-card/40 p-2.5 text-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-medium">Canary</span>
          {liveCanaryV != null && liveWeight > 0 ? (
            <Badge className="py-0 text-xs">
              v{liveCanaryV} @ {liveWeight}%
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">none in flight</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Canary version for ${name}`}
            value={canaryVersion}
            onChange={(e) => setCanaryVersion(e.target.value)}
            inputMode="numeric"
            placeholder="version"
            className="h-7 w-24 font-mono text-sm"
          />
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
            className="h-6 flex-1 accent-primary"
          />
          <span className="w-9 text-right font-mono">{weight}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <ConfirmButton
            size="sm"
            className="h-7 flex-1"
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
            className="h-7"
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
        <p className="mt-2 text-sm leading-snug text-muted-foreground">
          Routing is a deterministic hash of tenant, thread and both versions, so a thread stays on
          one side for the whole rollout.
        </p>
      </div>

      {/* Editor */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">New version</span>
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1" onClick={openEditor}>
          <SaveIcon className="size-3.5" /> Edit current
        </Button>
      </div>

      {editor != null && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <Label htmlFor="manifest-version-comment">Change comment</Label>
          <Input
            id="manifest-version-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="what changed, e.g. raised max_tool_calls"
            className="h-7 text-sm"
          />
          {/* This carried `aria-describedby` while having no accessible name to
              describe: a description is not a name. */}
          <Label htmlFor="manifest-editor">Manifest JSON for {name}</Label>
          <textarea
            id="manifest-editor"
            value={editor}
            onChange={(e) => setEditor(e.target.value)}
            spellCheck={false}
            rows={12}
            aria-invalid={editorError != null}
            aria-describedby={editorError != null ? 'manifest-editor-error' : undefined}
            className="w-full resize-y rounded-md border bg-transparent p-2 font-mono text-sm leading-snug outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-state-failed"
          />
          {editorError && (
            <p id="manifest-editor-error" role="alert" className="text-sm text-state-failed">
              Not valid JSON: {editorError}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="h-7 flex-1" disabled={busy} onClick={saveVersion}>
              Save new version
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
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

      {editor == null && (
        <ScrollArea className="min-h-0 flex-1">
          <p className="pr-3 text-sm text-muted-foreground">
            Publishing appends a new version and activates it. The harness does not expose a version
            history endpoint, so activate an earlier version by number above.
          </p>
        </ScrollArea>
      )}
    </div>
  );
}
