import { fileRefUrl, sniffImageType, splitFileRef } from '@felix/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventsToTurns } from '../src/session-log';
import { createFelixClient } from '../src/transport';

/**
 * Stored image uploads (`POST /files`), referenced in a message as
 * `felix-file://<id>`. Uploading instead of inlining is what keeps an image out
 * of the session log, which the harness re-sends to the model on every turn.
 */

afterEach(() => vi.unstubAllGlobals());

const PNG = 'iVBORw0KGgoAAAANSUhEUg';
const WEBP = btoa('RIFF\x00\x00\x00\x00WEBPVP8 ');
const WAV = btoa('RIFF\x00\x00\x00\x00WAVEfmt ');

describe('references', () => {
  it('round-trips an id and ignores every other URL', () => {
    expect(splitFileRef(fileRefUrl('abc'))).toBe('abc');
    expect(splitFileRef('data:image/png;base64,xyz')).toBeUndefined();
    expect(splitFileRef('felix-file://')).toBeUndefined();
    expect(splitFileRef(undefined)).toBeUndefined();
  });
});

describe('sniffImageType', () => {
  it('reads the four types the harness stores off their bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType('/9j/4AAQ')).toBe('image/jpeg');
    expect(sniffImageType(btoa('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('does not take a RIFF container for WebP', () => {
    // `RIFF` alone is also WAV and AVI — the harness checks the format tag for the same reason.
    expect(sniffImageType(WAV)).toBeUndefined();
    expect(sniffImageType(btoa('%PDF-1.7'))).toBeUndefined();
  });
});

describe('the transport', () => {
  it('uploads in the harness spelling and maps the answer back', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ file_id: 'f1', media_type: 'image/png', size_bytes: 12, filename: 'a.png' }),
    );
    vi.stubGlobal('fetch', fetch);
    const client = createFelixClient({ baseUrl: '/api' });

    const out = await client.uploadFile({ data: PNG, mediaType: 'image/png', filename: 'a.png' });

    expect(out).toEqual({ fileId: 'f1', mediaType: 'image/png', sizeBytes: 12 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/files');
    expect(JSON.parse(String(init.body))).toEqual({
      data: PNG,
      media_type: 'image/png',
      filename: 'a.png',
    });
  });

  it('names the type a fetched file has, since the harness does not', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ file_id: 'f1', size_bytes: 12, data: PNG }));
    const client = createFelixClient({ baseUrl: '/api' });
    expect(await client.getFile('f1')).toEqual({ data: PNG, mediaType: 'image/png' });
  });

  it('carries the status in the error, where describeError reads it', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"quota"}', { status: 409 }));
    const client = createFelixClient({ baseUrl: '/api' });
    await expect(client.uploadFile({ data: PNG, mediaType: 'image/png' })).rejects.toThrow(
      /^files: 409/,
    );
  });
});

describe('hydration', () => {
  it('restores a user turn’s images from the session log', () => {
    // A reload used to drop every thumbnail: the snapshot had them, the rebuild did not look.
    const turns = eventsToTurns([
      {
        seq: 1,
        kind: 'message',
        role: 'user',
        content: 'what is this?',
        metadata: {
          attachments: [
            { url: 'felix-file://f1', media_type: 'image/png', filename: 'a.png', detail: null },
            { url: '', media_type: 'image/png' },
          ],
        },
      },
    ]);
    expect(turns[0]?.attachments).toEqual([
      { url: 'felix-file://f1', media_type: 'image/png', filename: 'a.png' },
    ]);
  });
});
