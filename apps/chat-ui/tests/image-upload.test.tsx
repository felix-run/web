// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Message } from '../src/components/chat/message';
import { fitImage, ImageUploadError, uploadImages } from '../src/lib/image-upload';

/**
 * Images reach the harness as stored uploads referenced by `felix-file://<id>`,
 * not as inline `data:` URLs, which the harness saves into the session log and
 * re-sends to the model on every later turn.
 */

/** A real 1×1 PNG, small enough to send untouched. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngUrl = `data:image/png;base64,${PNG}`;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('fitImage', () => {
  it('sends an image already within the harness limits untouched', async () => {
    expect(await fitImage(pngUrl)).toEqual({ data: PNG, mediaType: 'image/png' });
  });

  it('refuses a GIF over the limit rather than flattening the animation', async () => {
    const big = btoa('GIF89a'.padEnd(700 * 1024, 'x'));
    await expect(fitImage(`data:image/gif;base64,${big}`, 'party.gif')).rejects.toBeInstanceOf(
      ImageUploadError,
    );
  });
});

describe('uploadImages', () => {
  it('uploads the bytes and returns a reference, not the data URL', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ file_id: 'f1', media_type: 'image/png', size_bytes: 70 }),
    );
    vi.stubGlobal('fetch', fetch);

    const out = await uploadImages([{ url: pngUrl, mediaType: 'image/png', filename: 'dot.png' }]);

    expect(out).toEqual([{ url: 'felix-file://f1', media_type: 'image/png', filename: 'dot.png' }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/files');
    expect(JSON.parse(String(init.body)).data).toBe(PNG);
  });
});

describe('a refused upload', () => {
  it('says storage is full on a 409, not that something is no longer pending', async () => {
    // The shared translator reads every 409 as an approval someone else decided.
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"detail":"attachment quota exceeded"}', { status: 409 }),
    );
    const err = await uploadImages([{ url: pngUrl, mediaType: 'image/png' }]).catch((e) => e);
    expect(err).toBeInstanceOf(ImageUploadError);
    expect(err.message).toMatch(/storage on this harness is full/);
    expect(err.message).not.toMatch(/pending/);
    expect(err.detail).toMatch(/^files: 409/);
  });

  it('leaves statuses with no files-specific meaning to the shared translator', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"missing scope"}', { status: 403 }));
    const err = await uploadImages([{ url: pngUrl, mediaType: 'image/png' }]).catch((e) => e);
    expect(err).not.toBeInstanceOf(ImageUploadError);
    expect(String(err.message)).toMatch(/^files: 403/);
  });
});

const turnWith = (url: string) => ({
  id: 'u1',
  role: 'user' as const,
  content: 'what is this?',
  attachments: [{ url, media_type: 'image/png', filename: 'dot.png' }],
});

const mount = (url: string) =>
  render(
    <TooltipProvider>
      <Message turn={turnWith(url)} />
    </TooltipProvider>,
  );

describe('drawing a referenced image', () => {
  it('fetches a reference once and draws it from the bytes', async () => {
    const fetch = vi.fn(async (_url: unknown) =>
      Response.json({ file_id: 'f2', size_bytes: 70, data: PNG }),
    );
    vi.stubGlobal('fetch', fetch);

    mount('felix-file://f2');

    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe(pngUrl));
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['/api/files/f2']);
  });

  it('says the upload is gone instead of drawing a broken image', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"not_found"}', { status: 404 }));

    mount('felix-file://gone');

    await waitFor(() => expect(document.body.textContent).toContain('Image no longer stored'));
    expect(document.querySelector('img')).toBeNull();
  });

  it('draws an image just uploaded without fetching it back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ file_id: 'f3', media_type: 'image/png', size_bytes: 70 })),
    );
    const [ref] = await uploadImages([{ url: pngUrl, mediaType: 'image/png' }]);
    const after = vi.fn();
    vi.stubGlobal('fetch', after);

    mount(ref!.url);

    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe(pngUrl));
    expect(after).not.toHaveBeenCalled();
  });
});
