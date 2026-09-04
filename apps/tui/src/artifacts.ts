/**
 * Tool output too large to inline, and how to refer to it.
 *
 * A manifest with `artifacts.enabled` replaces an oversized tool result with a
 * preview plus `[artifact:<id> key=… chars=N]`, and the rest lives in the object
 * store. In a browser that marker becomes a "Load full output" button on the
 * card. A terminal has no buttons, so the card gets a **handle** — `[a1]` — and
 * `/artifact 1` fetches it.
 *
 * The numbering is computed from the whole transcript in one place, because the
 * transcript and the command have to agree on what `1` means. A handle exists
 * only where there is something to fetch, so the numbers are dense.
 */

import type { ToolCall, Turn } from '@felix/client';
import { type ArtifactRef, parseArtifactMarker } from '@felix/protocol';

export interface Spill {
  /** 1-based, in transcript order — what `/artifact <n>` takes. */
  handle: number;
  ref: ArtifactRef;
  tool: ToolCall;
}

/**
 * The spilled outputs in this transcript, oldest first.
 *
 * `parseArtifactMarker` only matches at the **end** of an output, which is the
 * point: a tool that mentions an artifact mid-text is talking about one, not
 * returning one, and must not produce a handle.
 */
export function spills(turns: Turn[]): Spill[] {
  const found: Spill[] = [];
  for (const turn of turns) {
    for (const tool of turn.tools ?? []) {
      if (typeof tool.output !== 'string') continue;
      const ref = parseArtifactMarker(tool.output);
      if (ref) found.push({ handle: found.length + 1, ref, tool });
    }
  }
  return found;
}

/** The handle for each spilled call, by identity within one render pass. */
export function handlesByTool(turns: Turn[]): Map<ToolCall, Spill> {
  return new Map(spills(turns).map((s) => [s.tool, s]));
}

/** `48k` — a size that fits on a card that is already one dim line. */
export function sizeLabel(chars: number): string {
  if (chars < 1000) return `${chars}c`;
  if (chars < 1_000_000) return `${Math.round(chars / 1000)}k`;
  return `${(chars / 1_000_000).toFixed(1)}M`;
}
