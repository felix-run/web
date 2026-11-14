import type { ManifestEntry } from '@felix/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getResolvedManifest, listManifestEntries, listTenantManifests } from '@/api/client';
import type { ManifestSummary } from '@/api/types';
import { DEFAULT_MANIFEST } from '@/lib/harness/manifests';

const MANIFEST_KEY = 'felix.manifest';
/** How long the tenant's manifest rows serve the canary check before it reads them again. */
const CANARY_ROWS_MS = 5 * 60_000;
export function useManifestSelection() {
  const [manifestEntries, setManifestEntries] = useState<ManifestEntry[]>([]);
  const manifests = useMemo(() => manifestEntries.map((m) => m.id), [manifestEntries]);
  const [manifest, setManifest] = useState(() => {
    const stored = localStorage.getItem(MANIFEST_KEY)?.trim();
    return stored || DEFAULT_MANIFEST;
  });
  useEffect(() => localStorage.setItem(MANIFEST_KEY, manifest), [manifest]);
  useEffect(() => {
    const ctrl = new AbortController();
    listManifestEntries(ctrl.signal)
      .then((entries) => {
        if (!entries.length) return;
        const names = entries.map((m) => m.id);
        setManifestEntries(entries);
        // Drop stale localStorage (e.g. chat-ui-demo) that isn't on this harness.
        setManifest((cur) =>
          names.includes(cur)
            ? cur
            : names.includes(DEFAULT_MANIFEST)
              ? DEFAULT_MANIFEST
              : names[0]!,
        );
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return { manifestEntries, manifests, manifest, setManifest };
}

export function useManifestCanary(manifest: string, threadId: string) {
  // Canary rollout state for the selected manifest, from the `/manifests`
  // active pointer. Deliberately *not* "which side served this thread": that
  // assignment is a server-side hash the harness does not report to clients,
  // and `GET /manifests/{name}` answers `stable` for any partial rollout
  // because it resolves without a thread id.
  const [canary, setCanary] = useState<{
    version: number;
    weight: number;
    onCanary: boolean;
  } | null>(null);
  // Canary state for the selected manifest on *this* thread. Two questions, two
  // sources: whether a rollout exists at all comes from the active pointer, and
  // which side serves this thread comes from resolving the manifest with the
  // thread id — the assignment is a server-side hash the client cannot compute.
  //
  // Only tenant-managed manifests have a pointer, so a bundled one has no
  // rollout and no badge, and the second call is skipped entirely.
  //
  // The tenant's rows are read once and reused for `CANARY_ROWS_MS`: a thread switch changes
  // which side serves the thread, not whether a rollout exists, and it used to re-read the
  // whole list each time (twice at startup, once with the stored agent and once corrected).
  // `fresh` re-reads them — what leaving the Manifests page asks for, since it can change them.
  const tenantRows = useRef<{ at: number; rows: Promise<ManifestSummary[]> } | null>(null);
  const refreshCanary = useCallback(
    async (fresh = false) => {
      try {
        const cached = tenantRows.current;
        let read = cached?.rows;
        if (fresh || !cached || !read || Date.now() - cached.at >= CANARY_ROWS_MS) {
          const next = listTenantManifests();
          tenantRows.current = { at: Date.now(), rows: next };
          // A failed read is not kept: the next ask tries again.
          next.catch(() => {
            if (tenantRows.current?.rows === next) tenantRows.current = null;
          });
          read = next;
        }
        const rows = await read;
        const row = rows.find((r) => r.name === manifest);
        const weight = row?.canary_weight ?? 0;
        const version = row?.canary_version ?? null;
        if (version == null || weight <= 0) {
          setCanary(null);
          return;
        }
        // Only a `canary` answer is treated as one. A harness that does not yet
        // take `thread_id` replies `stable` for every thread, and reporting that
        // as "this thread is on stable" would be a confident guess — so an
        // unconfirmed thread shows the rollout, and claims nothing about itself.
        let onCanary = false;
        try {
          const resolved = await getResolvedManifest(manifest, { threadId });
          onCanary = resolved.variant === 'canary';
        } catch {
          // Resolution is best-effort; the rollout badge still stands without it.
        }
        setCanary({ version, weight, onCanary });
      } catch {
        // The tenant store is optional and the route needs `manifests:read`;
        // a badge is not worth surfacing an error for.
        setCanary(null);
      }
    },
    [manifest, threadId],
  );

  useEffect(() => {
    void refreshCanary();
  }, [refreshCanary]);
  /**
   * Re-read the rollout, the tenant's rows included. Stable between thread and agent changes:
   * the Manifests page calls it from an effect's cleanup, and the inline closure this replaced
   * was new on every shell render, so that cleanup re-checked the canary — two requests —
   * on every render while the page was open.
   */
  const recheckCanary = useCallback(() => void refreshCanary(true), [refreshCanary]);

  return { canary, recheckCanary };
}
