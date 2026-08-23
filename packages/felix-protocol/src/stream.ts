/**
 * The SSE reader both browser clients share.
 *
 * `POST /chat/stream` answers with bare `data: <json>` frames — the harness
 * sets no SSE `event:` field — terminated by a literal `data: [DONE]`. Network
 * chunk boundaries fall wherever they like, so the carry buffer is the whole
 * point: a frame split across two reads must not be dropped, and a multi-byte
 * character split across two reads must not be corrupted.
 *
 * This lived in duplicate in each app. A regression here loses events silently,
 * because `StreamEvent` ends in an open arm: an event that never arrives looks
 * exactly like an event nobody handles.
 */
import type { StreamEvent } from './types';

/**
 * Drain `res` into `onEvent`, one decoded frame at a time.
 *
 * Returns when the stream ends or `[DONE]` arrives. Unparseable frames are
 * skipped rather than tearing down the run — a single malformed frame should
 * not cost the user the rest of a reply.
 */
export async function readSseStream(
  res: Response,
  onEvent: (event: StreamEvent) => void | Promise<void>,
): Promise<void> {
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Drain whole `data: ...\n\n` frames; leave any partial tail in the buffer.
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const line = frame.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (payload === '[DONE]') return;

      try {
        await onEvent(JSON.parse(payload) as StreamEvent);
      } catch {
        // Ignore unparseable frames rather than tearing down the stream.
      }
    }
  }
}
