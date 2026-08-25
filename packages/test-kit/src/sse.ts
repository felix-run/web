/**
 * Behavioral suite for the SSE reader in `@felix/protocol`, parameterized on the
 * caller's own `streamChat` wrapper so the reader's contract is stated
 * independently of who invokes it.
 *
 * The reader's job is to turn an arbitrarily chunked byte stream into whole
 * `data: <json>` frames. Network chunk boundaries fall wherever they like, so
 * the carry buffer is the whole point: a frame split across two reads must not
 * be dropped, and a multi-byte character split across two reads must not be
 * corrupted. Nothing else in the repo checks this, and a regression here loses
 * events silently — the `StreamEvent` union's open arm means an event that
 * never arrives looks exactly like an event nobody handles.
 */
import { describe, expect, it, vi } from 'vitest';

export interface SseAdapter {
  /**
   * Invoke the app's streamChat, collecting every event it dispatches and — if
   * the caller wires it — every `id:` cursor the stream stamps.
   */
  run(
    collect: (event: unknown) => void | Promise<void>,
    onCursor?: (lastEventId: string) => void,
  ): Promise<void>;
}

/** A Response whose body yields exactly these chunks, in order. */
function streamResponse(chunks: Array<string | Uint8Array>, init: ResponseInit = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(body, init);
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Install a global fetch that returns `response` and records the call. */
function stubFetch(response: Response) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function describeSseReader(label: string, adapter: SseAdapter): void {
  const collectFrom = async (chunks: Array<string | Uint8Array>, init?: ResponseInit) => {
    stubFetch(streamResponse(chunks, init ?? { status: 200 }));
    const events: unknown[] = [];
    await adapter.run((e) => {
      events.push(e);
    });
    return events;
  };

  const collectCursorsFrom = async (chunks: Array<string | Uint8Array>) => {
    stubFetch(streamResponse(chunks, { status: 200 }));
    const cursors: string[] = [];
    await adapter.run(
      () => {},
      (id) => {
        cursors.push(id);
      },
    );
    return cursors;
  };

  describe(`${label} SSE reader`, () => {
    it('reads a single frame', async () => {
      expect(await collectFrom([frame({ event: 'a', data: {} })])).toEqual([
        { event: 'a', data: {} },
      ]);
    });

    it('reads several frames arriving in one chunk', async () => {
      const chunk = frame({ event: 'a', data: {} }) + frame({ event: 'b', data: {} });
      expect(await collectFrom([chunk])).toEqual([
        { event: 'a', data: {} },
        { event: 'b', data: {} },
      ]);
    });

    // The carry buffer. Each split lands somewhere a naive per-chunk parser breaks.
    const whole = frame({ event: 'split', data: { n: 1 } });
    const splits: Array<[string, number]> = [
      ['mid-JSON', whole.indexOf('{"event') + 8],
      ['immediately after "data:"', 'data:'.length],
      ['between the two newlines', whole.length - 1],
      ['one byte in', 1],
      ['one byte from the end', whole.length - 1],
    ];
    for (const [where, at] of splits) {
      it(`reassembles a frame split ${where}`, async () => {
        const events = await collectFrom([whole.slice(0, at), whole.slice(at)]);
        expect(events).toEqual([{ event: 'split', data: { n: 1 } }]);
      });
    }

    it('reassembles a frame split across many one-byte chunks', async () => {
      const events = await collectFrom(whole.split(''));
      expect(events).toEqual([{ event: 'split', data: { n: 1 } }]);
    });

    it('does not corrupt a multi-byte character split across chunks', async () => {
      const text = frame({ event: 'text', data: { delta: '🙂é中' } });
      const bytes = new TextEncoder().encode(text);
      // Slice inside the emoji's 4-byte sequence.
      const cut = bytes.indexOf(0xf0) + 2;
      const events = await collectFrom([bytes.slice(0, cut), bytes.slice(cut)]);
      expect(events).toEqual([{ event: 'text', data: { delta: '🙂é中' } }]);
    });

    it('stops at [DONE] and ignores anything after it', async () => {
      const events = await collectFrom([
        frame({ event: 'before', data: {} }),
        'data: [DONE]\n\n',
        frame({ event: 'after', data: {} }),
      ]);
      expect(events).toEqual([{ event: 'before', data: {} }]);
    });

    it('skips a malformed frame without tearing down the stream', async () => {
      const events = await collectFrom([
        'data: {not json\n\n',
        frame({ event: 'survivor', data: {} }),
      ]);
      expect(events).toEqual([{ event: 'survivor', data: {} }]);
    });

    it('ignores frames carrying no data line', async () => {
      // A comment-only heartbeat and a field-only frame are both undispatchable
      // per the SSE spec — but note that having *fields* is not the same as
      // having no data, which is what `event: error` below turns on.
      const events = await collectFrom([
        ': heartbeat\n\n',
        'event: ping\n\n',
        frame({ event: 'real', data: {} }),
      ]);
      expect(events).toEqual([{ event: 'real', data: {} }]);
    });

    // --- SSE fields other than `data:` ---
    //
    // The harness uses two, and a reader that matched whole frames against
    // `data:` dropped both. `event: error` is the only way a stream reports a
    // failure that happened after its 200 was sent, so losing it meant a failed
    // run reached [DONE] and returned cleanly — indistinguishable from a short
    // reply, with nothing logged and nothing shown.

    it('surfaces the harness error frame as on_error', async () => {
      const events = await collectFrom([
        'event: error\ndata: {"error":{"message":"upstream exploded","type":"stream_error"}}\n\n',
        'data: [DONE]\n\n',
      ]);
      expect(events).toEqual([
        { event: 'on_error', data: { message: 'upstream exploded', type: 'stream_error' } },
      ]);
    });

    it('still reports an error frame whose payload is missing fields', async () => {
      // The failure path is the worst place to lose the reason to a shape change.
      const events = await collectFrom(['event: error\ndata: {}\n\n']);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'on_error',
        data: { message: expect.stringMatching(/\S/), type: 'stream_error' },
      });
    });

    it('reassembles an error frame split between its event and data lines', async () => {
      const whole = 'event: error\ndata: {"error":{"message":"late","type":"run_error"}}\n\n';
      const at = whole.indexOf('\ndata:') + 3;
      const events = await collectFrom([whole.slice(0, at), whole.slice(at)]);
      expect(events).toEqual([{ event: 'on_error', data: { message: 'late', type: 'run_error' } }]);
    });

    it('reports each id: to onCursor, and leaves it standing for frames without one', async () => {
      // `id:` is the thread's next session sequence, stamped on structural
      // frames only. Handed back as Last-Event-ID it reattaches a dropped
      // connection; a token-rate frame carries none and must not clear it.
      const cursors = await collectCursorsFrom([
        'id: 12\ndata: {"event":"tool_start","data":{"name":"read"}}\n\n',
        frame({ event: 'text_delta', data: { delta: 'hi' } }),
        'id: 15\ndata: {"event":"done","data":{}}\n\n',
      ]);
      expect(cursors).toEqual(['12', '15']);
    });

    it('does not mistake an id: line for the payload', async () => {
      const events = await collectFrom([
        'id: 7\ndata: {"event":"tool_end","data":{"name":"read"}}\n\n',
      ]);
      expect(events).toEqual([{ event: 'tool_end', data: { name: 'read' } }]);
    });

    it('reads a stream that uses CRLF line endings', async () => {
      const events = await collectFrom([
        'event: error\r\ndata: {"error":{"message":"crlf","type":"stream_error"}}\r\n\r\n',
      ]);
      expect(events).toEqual([
        { event: 'on_error', data: { message: 'crlf', type: 'stream_error' } },
      ]);
    });

    it('does not invent a frame boundary from a CRLF split across chunks', async () => {
      // The \r ends one read and the \n begins the next. Normalising eagerly
      // turns that pair into a blank line and cuts the frame in half.
      const whole = 'data: {"event":"split","data":{"n":1}}\r\n\r\n';
      const at = whole.indexOf('\r\n\r\n') + 3;
      const events = await collectFrom([whole.slice(0, at), whole.slice(at)]);
      expect(events).toEqual([{ event: 'split', data: { n: 1 } }]);
    });

    it('drops a trailing frame that never terminates', async () => {
      // No closing \n\n: the harness never finished sending it.
      const events = await collectFrom([frame({ event: 'complete', data: {} }), 'data: {"ev']);
      expect(events).toEqual([{ event: 'complete', data: {} }]);
    });

    it('preserves order across an async handler', async () => {
      stubFetch(
        streamResponse([frame({ event: '1', data: {} }), frame({ event: '2', data: {} })], {
          status: 200,
        }),
      );
      const seen: string[] = [];
      await adapter.run(async (e) => {
        const { event } = e as { event: string };
        await new Promise((r) => setTimeout(r, event === '1' ? 10 : 0));
        seen.push(event);
      });
      expect(seen).toEqual(['1', '2']);
    });

    // The reader must not swallow a handler rejection. `tool_request` is
    // answered by POST /chat/tool_result inside the handler; if that failure is
    // hidden, no result is posted and the run hangs forever with nothing shown.
    it('lets a handler rejection propagate instead of swallowing it', async () => {
      stubFetch(
        streamResponse([frame({ event: '1', data: {} }), frame({ event: '2', data: {} })], {
          status: 200,
        }),
      );
      const seen: string[] = [];
      await expect(
        adapter.run(async (e) => {
          seen.push((e as { event: string }).event);
          throw new Error('handler exploded');
        }),
      ).rejects.toThrow(/handler exploded/);
      // And it stops there rather than draining the rest of the stream.
      expect(seen).toEqual(['1']);
    });

    it('throws with the status when the response is not ok', async () => {
      stubFetch(new Response('upstream exploded', { status: 502 }));
      await expect(adapter.run(() => {})).rejects.toThrow(/502/);
    });
  });
}
