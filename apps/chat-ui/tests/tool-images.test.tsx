/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Images a tool returned — a browser screenshot, an MCP server's image block —
 * drawn in the card. The harness stores each one and hands back a
 * `felix-file://` reference, fetched the way an uploaded image is. They sit
 * outside the fold, because a screenshot hidden behind a chevron made every
 * browser call read as a line of text.
 */

const getFile = vi.fn();

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
  getFile.mockReset();
  vi.doMock('../src/api', () => ({ getArtifact: vi.fn(), getFile, uploadFile: vi.fn() }));
});

const shot = (url = 'felix-file://shot1') => ({
  name: 'browser_screenshot',
  input: { url: 'https://example.com' },
  output: 'Screenshot of https://example.com',
  done: true,
  images: [{ url, media_type: 'image/png' }],
});

describe('a tool card with images', () => {
  it('draws a stored image without opening the card', async () => {
    getFile.mockResolvedValue({ mediaType: 'image/png', data: 'iVBORw0KGgo=' });
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={shot()} />);

    // First a placeholder that says it is loading, then the image itself.
    expect(screen.getByRole('img', { name: /, loading$/ })).toBeTruthy();
    const img = await waitFor(() => {
      const el = document.querySelector('img');
      if (!el) throw new Error('not drawn yet');
      return el;
    });
    expect(img.getAttribute('alt')).toBe('Image from https://example.com');
    expect(getFile).toHaveBeenCalledWith('shot1');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    // The card is still folded: the output is not on screen, the image is.
    expect(screen.queryByText('Screenshot of https://example.com')).toBeNull();
  });

  it('says an image the harness no longer holds is gone, in words', async () => {
    getFile.mockRejectedValue(new Error('404'));
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={shot('felix-file://gone')} />);
    expect(await screen.findByText('Image no longer stored')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /^Image from/ })).toBeNull();
  });

  it('opens to full size and back on a click', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={shot('data:image/png;base64,iVBORw0KGgo=')} />);
    const toggle = await screen.findByRole('button', { name: /^Image from/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('img').className).toContain('max-h-72');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('img').className).not.toContain('max-h-72');
    // Inline bytes need no fetch.
    expect(getFile).not.toHaveBeenCalled();
  });

  it('numbers the images when a call returned more than one', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{
          ...shot(),
          images: [
            { url: 'data:image/png;base64,AAAA', media_type: 'image/png' },
            { url: 'data:image/png;base64,BBBB', media_type: 'image/png' },
          ],
        }}
      />,
    );
    expect(await screen.findByRole('img', { name: /^Image 1 from/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Image 2 from/ })).toBeTruthy();
  });

  it('draws nothing extra for a call with no images', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={{ name: 'read_file', output: 'text', done: true }} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
