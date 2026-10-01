import type { TokenUsage } from './types';

/** The whole prompt a call was sent, cached or not. */
export function promptTokens(u: TokenUsage): number {
  return u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
}

/**
 * A usage block off the wire, or `undefined` when it is not one. Shared by the
 * live `done` frame and the snapshot's `metadata.usage`, which carry the same
 * block, so the two cannot disagree about what a field means.
 */
export function readUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { input, output, cacheRead, cacheWrite } = raw as Record<string, unknown>;
  const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!count(input) || !count(output)) return undefined;
  return {
    input: input as number,
    output: output as number,
    ...(count(cacheRead) && (cacheRead as number) > 0 ? { cacheRead: cacheRead as number } : {}),
    ...(count(cacheWrite) && (cacheWrite as number) > 0
      ? { cacheWrite: cacheWrite as number }
      : {}),
  };
}
