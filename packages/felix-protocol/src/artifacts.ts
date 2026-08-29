/**
 * Reading back an oversized tool output.
 *
 * A manifest with `artifacts.enabled` spills any tool result longer than its
 * threshold to the object store and hands the model a preview plus a marker:
 *
 *   …[artifact:<32 hex> key=artifacts/<tenant>/<manifest>/<id>.txt chars=N spilled_at=T]
 *
 * The preview is what the transcript shows, and until something parses that
 * marker it is *all* anyone can see — the rest of the output exists, addressed,
 * and unreachable from every interface at once. `GET /artifacts/{manifest_id}/
 * {artifact_id}` is the way back to it.
 *
 * The tenant is in the key and is deliberately **not** in the request: the
 * harness takes it from the caller's own credentials, so no spelling of a
 * reference reaches another tenant's data. Parsing it out here would be
 * building a parameter nothing accepts.
 */

/** What a spilled output looks like once the marker has been read off it. */
export interface ArtifactRef {
  artifactId: string;
  manifestId: string;
  /** Length of the *full* text, which is why this is worth fetching. */
  chars: number;
  /** Unix seconds, as the harness stamped it. */
  spilledAt: number;
  /** The preview: everything before the marker, trimmed of its separator. */
  preview: string;
}

/**
 * The same two patterns the harness validates a reference with, restated
 * because a client that builds a URL from a marker has the same problem: an id
 * that is not what it looks like addresses something other than what was named.
 * A marker that fails them is treated as absent rather than repaired.
 */
const ARTIFACT_ID = /^[0-9a-f]{32}$/;
const MANIFEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const MARKER = /\[artifact:([0-9a-f]{32}) key=(\S+?) chars=(\d+)(?: spilled_at=(\d+))?\]\s*$/;

/**
 * The reference at the end of a spilled tool output, or `null` for output that
 * was never spilled — which is almost all of it.
 *
 * Anchored to the end because that is where the harness writes it, and because
 * a marker anywhere else is text the tool itself produced: a transcript quoting
 * one is not an invitation to fetch it.
 */
export function parseArtifactMarker(output: string): ArtifactRef | null {
  const match = MARKER.exec(output);
  if (!match) return null;
  const [marker, artifactId, key, chars, spilledAt] = match as unknown as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];

  // artifacts/{tenant}/{manifest}/{id}.txt — the manifest is what the route
  // takes, and it is the only segment of the key a caller may name.
  const parts = key.split('/');
  const manifestId = parts.length === 4 && parts[0] === 'artifacts' ? (parts[2] ?? '') : '';
  if (!ARTIFACT_ID.test(artifactId) || !MANIFEST_ID.test(manifestId)) return null;

  return {
    artifactId,
    manifestId,
    chars: Number(chars),
    spilledAt: Number(spilledAt ?? 0),
    // The separator between preview and marker is the harness's, not the
    // tool's, so it goes with the marker.
    preview: output.slice(0, output.length - marker.length).replace(/\n*…?\s*$/, ''),
  };
}
