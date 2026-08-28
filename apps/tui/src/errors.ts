/**
 * Terminal wording for a failure, over `@felix/client`'s.
 *
 * `describeError` writes for the browser client, and one of its sentences does
 * not survive the move: a 401 there means the shared-key gate is about to
 * re-prompt, so "enter it again to continue" is a real instruction. Here there
 * is nothing to enter it into, and the actionable fact is whether a key was
 * configured at all — a first run with no key and a rotated key look identical
 * on the wire and need opposite advice.
 */
import { describeError } from '@felix/client';
import type { Config } from './config.js';

export function explainError(err: unknown, doing: string, config: Config): string {
  const described = describeError(err, doing);
  if (!/:\s*401\b/.test(described.detail)) return described.message;
  return config.apiKey
    ? `The harness rejected this key. Check it against the one it was started with (${config.origin}).`
    : `The harness at ${config.origin} needs a key. Pass --key, or set FELIX_API_KEY.`;
}
