import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listTenantManifests();
      setRows(r);
      setError(null);
      setSelected((cur) => cur ?? r[0]?.name ?? null);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
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
    try {
      const resolved = await getResolvedManifest(name);
      await createManifestVersion(name, resolved.manifest, `imported from ${resolved.source}`);
      await refresh();
      setSelected(name);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
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
          {error && <p className="text-xs text-destructive">⚠ {error}</p>}

          <div className="flex flex-wrap items-center gap-1.5">
            {rows.map((r) => (
              <Button
                key={r.name}
                size="sm"
                variant={selected === r.name ? 'secondary' : 'ghost'}
                className="h-7 gap-1 font-mono text-xs"
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
              <span className="text-xs text-muted-foreground">
                No tenant-managed manifests yet — import one below.
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Input
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
              onError={setError}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VersionsPanel({
  summary,
  onChanged,
  onError,
}: {
  summary: ManifestSummary;
  onChanged: () => void;
  onError: (msg: string) => void;
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
  const [comment, setComment] = useState('');

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err) {
      onError(String((err as Error)?.message ?? err));
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
      onError(String((err as Error)?.message ?? err));
    }
  }

  async function saveVersion() {
    if (!editor) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor);
    } catch {
      onError('Editor content is not valid JSON.');
      return;
    }
    await act(async () => {
      await createManifestVersion(name, parsed, comment.trim() || 'edited in chat-ui');
      setEditor(null);
    });
  }

  const canaryN = Number(canaryVersion);
  const canaryValid = canaryVersion.trim() !== '' && Number.isInteger(canaryN) && canaryN > 0;
  const targetN = Number(targetVersion);
  const targetValid =
    targetVersion.trim() !== '' && Number.isInteger(targetN) && targetN > 0 && targetN !== activeV;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Active pointer */}
      <div className="rounded-md border bg-card/40 p-2.5 text-xs">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-medium">Active</span>
          {activeV != null ? (
            <Badge variant="secondary" className="py-0 font-mono text-xs">
              v{activeV}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">no tenant version</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
            inputMode="numeric"
            placeholder="version number"
            className="h-7 flex-1 font-mono text-xs"
          />
          <Button
            size="sm"
            className="h-7 gap-1"
            disabled={busy || !targetValid}
            onClick={() =>
              act(async () => {
                await activateManifestVersion(name, targetN);
                setTargetVersion('');
              })
            }
            title="Flip the active pointer to this version"
          >
            <RotateCcwIcon className="size-3.5" /> Activate
          </Button>
        </div>
      </div>

      {/* Canary control */}
      <div className="rounded-md border bg-card/40 p-2.5 text-xs">
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
            value={canaryVersion}
            onChange={(e) => setCanaryVersion(e.target.value)}
            inputMode="numeric"
            placeholder="version"
            className="h-7 w-24 font-mono text-xs"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="flex-1 accent-amber-500"
          />
          <span className="w-9 text-right font-mono">{weight}%</span>
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            className="h-7 flex-1"
            disabled={busy || !canaryValid}
            onClick={() => act(() => setManifestCanary(name, canaryN, weight))}
          >
            Apply canary
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy || liveCanaryV == null}
            onClick={() =>
              act(async () => {
                await clearManifestCanary(name);
                setCanaryVersion('');
              })
            }
            title="Drop the canary version and zero its weight"
          >
            Clear canary
          </Button>
        </div>
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          Routing is a deterministic hash of tenant, thread and both versions, so a thread stays on
          one side for the whole rollout.
        </p>
      </div>

      {/* Editor */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          New version
        </span>
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1" onClick={openEditor}>
          <SaveIcon className="size-3.5" /> Edit current
        </Button>
      </div>

      {editor != null && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="change comment"
            className="h-7 text-xs"
          />
          <textarea
            value={editor}
            onChange={(e) => setEditor(e.target.value)}
            spellCheck={false}
            rows={12}
            className="w-full resize-y rounded-md border bg-transparent p-2 font-mono text-xs leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 flex-1" disabled={busy} onClick={saveVersion}>
              Save new version
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {editor == null && (
        <ScrollArea className="min-h-0 flex-1">
          <p className="pr-3 text-xs text-muted-foreground">
            Publishing appends a new version and activates it. The harness does not expose a version
            history endpoint, so activate an earlier version by number above.
          </p>
        </ScrollArea>
      )}
    </div>
  );
}
