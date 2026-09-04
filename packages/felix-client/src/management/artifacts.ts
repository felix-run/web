/** Spilled tool outputs (`GET /artifacts/{manifest_id}/{artifact_id}`). */

import type { FelixHttp } from '../http';

/**
 * What `GET /artifacts/{manifest_id}/{artifact_id}` returns.
 *
 * Not in the `check-payload-shapes` guard, and the reason is worth stating: the
 * record it compares against is built from the harness's `store.py` serializers,
 * and this response is a dict literal in the route itself. A guarded entry
 * naming a serializer the record does not carry fails on purpose — a guard that
 * silently checks nothing is worse than none — so this shape is mirrored by hand
 * and every field is read defensively at the one call site.
 */
export interface ArtifactContent {
  artifact_id: string;
  manifest_id: string;
  chars: number;
  content: string;
}

/**
 * GET /artifacts/{manifest_id}/{artifact_id} → the full text behind a marker.
 *
 * A manifest with artifact spilling on replaces any oversized tool result with a
 * preview and a reference. The preview is what the transcript shows, so until
 * this is called the rest of that output is stored, addressed, and unreachable —
 * which is the state the harness route was added to end, and which no client
 * here had left it.
 *
 * The tenant is not a parameter. It comes from the caller's own credentials
 * upstream, which is what stops one tenant naming another's artifact however the
 * reference is spelled. Reads need the `artifacts:read` scope, so a 403 here is
 * a narrow key rather than a missing artifact — the same trap `/memory` sets.
 */

export function createArtifactsClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function getArtifact(manifestId: string, artifactId: string): Promise<ArtifactContent> {
    const res = await chatFetch(
      `/artifacts/${encodeURIComponent(manifestId)}/${encodeURIComponent(artifactId)}`,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`artifact: ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as ArtifactContent;
  }

  return {
    getArtifact,
  };
}
