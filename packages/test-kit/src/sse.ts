/**
 * Shared behavioral suite for the SSE reader that chat-ui and float each keep
 * their own copy of.
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
  /** Invoke the app's streamChat, collecting every event it dispatches. */
  run(collect: (event: unknown) => void | Promise<void>): Promise<void>;
}

/** A Response whose body yields exactly these chunks, in order. */
export function streamResponse(chunks: Array<string | Uint8Array>, init: ResponseInit = {}) {
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

export function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Install a global fetch that returns `response` and records the call. */
export function stubFetch(response: Response) {
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

    it('ignores lines that are not data frames', async () => {
      const events = await collectFrom([
        ': heartbeat\n\n',
        'event: ping\n\n',
        frame({ event: 'real', data: {} }),
      ]);
      expect(events).toEqual([{ event: 'real', data: {} }]);
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

    it('throws with the status when the response is not ok', async () => {
      stubFetch(new Response('upstream exploded', { status: 502 }));
      await expect(adapter.run(() => {})).rejects.toThrow(/502/);
    });
  });
}
