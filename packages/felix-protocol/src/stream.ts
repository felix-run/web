/**
 * The SSE reader both browser clients share.
 *
 * `POST /chat/stream` answers with `data: <json>` frames terminated by a literal
 * `data: [DONE]`. Two other SSE fields carry meaning and must not be discarded:
 *
 * - **`event: error`** is the harness's one typed frame — the only way a stream
 *   reports failure once the 200 has already been sent. It is emitted by the
 *   `/chat/stream` exception handler, by the reconnect stream, and by every
 *   durable-run failure. Its payload is `{error: {message, type}}` rather than
 *   the usual envelope, so it is normalised into an `on_error` event here at the
 *   reader boundary; handlers see one shape.
 * - **`id:`** stamps structural frames with the thread's next session sequence
 *   (everything except `text_delta`, `on_chat_model_stream` and
 *   `session_progress`). Handed back as `Last-Event-ID` it reattaches a dropped
 *   connection via `GET /chat/stream/{thread_id}` — see `onCursor`.
 *
 * A reader that only matched whole frames against `data:` dropped both, which is
 * the worst available failure: the stream still reached `[DONE]` and returned
 * cleanly, so a failed run was indistinguishable from a short one.
 *
 * Network chunk boundaries fall wherever they like, so the carry buffer is the
 * whole point: a frame split across two reads must not be dropped, and a
 * multi-byte character split across two reads must not be corrupted.
 *
 * This lived in duplicate in each app. A regression here loses events silently,
 * because `StreamEvent` ends in an open arm: an event that never arrives looks
 * exactly like an event nobody handles.
 */
import type { StreamEvent } from './types';

export interface ReadSseOptions {
  /**
   * Called with each `id:` the stream stamps, newest last.
   *
   * A callback rather than a return value on purpose: the cursor matters most
   * when the stream *fails*, and a value returned from this function is lost on
   * the throw. Per the SSE spec a frame without an `id:` leaves the last one
   * standing, so the callback fires only on frames that actually carry one.
   */
  onCursor?: (lastEventId: string) => void;
}

/** One dispatchable SSE frame: its fields, before the payload is parsed. */
interface SseFrame {
  event?: string;
  id?: string;
  data: string;
}

/**
 * Split one frame into SSE fields.
 *
 * Returns null for anything with no `data:` line — a comment-only heartbeat
 * (`: keep-alive`), or a field-only frame — which the spec says is not
 * dispatched at all.
 */
function parseFrame(raw: string): SseFrame | null {
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank or comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    // A single space after the colon is part of the delimiter, not the value.
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') dataLines.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    // `retry` and unknown fields are ignored, per spec.
  }

  if (!dataLines.length) return null;
  return { event, id, data: dataLines.join('\n') };
}

/**
 * Fold the harness's `event: error` payload into the event union.
 *
 * Defensive about the shape because this is the failure path: a frame that
 * arrives here has already told us something went wrong, and losing the reason
 * to a missing field would put us back where we started.
 */
function toErrorEvent(payload: unknown): StreamEvent {
  const body = payload as { error?: { message?: string; type?: string } } | null;
  const detail = body?.error;
  return {
    event: 'on_error',
    data: {
      message: String(detail?.message ?? 'the stream failed after it had started'),
      type: String(detail?.type ?? 'stream_error'),
    },
  };
}

/**
 * Drain `res` into `onEvent`, one decoded frame at a time.
 *
 * Returns when the stream ends or `[DONE]` arrives. Unparseable frames are
 * skipped rather than tearing down the run — a single malformed frame should
 * not cost the user the rest of a reply.
 *
 * A rejection from `onEvent` is NOT swallowed: it propagates out of this
 * function. The frames the model loop blocks on — `tool_request` above all —
 * are answered by an HTTP round trip inside the handler, and a swallowed
 * failure there means the result is never posted and the run hangs forever
 * with nothing shown to the user. A torn-down stream is a far better outcome
 * than an invisible deadlock, so handlers must guard whatever they consider
 * cosmetic themselves.
 */
export async function readSseStream(
  res: Response,
  onEvent: (event: StreamEvent) => void | Promise<void>,
  opts: ReadSseOptions = {},
): Promise<void> {
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // A lone `\r` at the end of a read may be the first half of a `\r\n` split
  // across chunks. Hold it back rather than normalising it into a `\n`, which
  // would invent a frame boundary that is not there.
  let heldCr = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    let chunk = decoder.decode(value, { stream: true });
    if (heldCr) {
      chunk = `\r${chunk}`;
      heldCr = false;
    }
    if (chunk.endsWith('\r')) {
      chunk = chunk.slice(0, -1);
      heldCr = true;
    }
    buffer += chunk.replace(/\r\n?/g, '\n');

    // Drain whole frames; leave any partial tail in the buffer.
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const frame = parseFrame(raw);
      if (!frame) continue;
      if (frame.data === '[DONE]') return;

      if (frame.id !== undefined) opts.onCursor?.(frame.id);

      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        // Ignore an unparseable frame rather than tearing down the stream.
        continue;
      }

      await onEvent(frame.event === 'error' ? toErrorEvent(payload) : (payload as StreamEvent));
    }
  }
}
