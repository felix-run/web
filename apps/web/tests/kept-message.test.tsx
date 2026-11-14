// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type KeptMessage, MultimodalInput } from '../src/components/chat/multimodal-input';

/**
 * A message the harness refused on the lease, handed back to the composer.
 *
 * The shell end — the refusal, the takeover, the one send after it — is
 * `session-lease-watch.test.tsx`. This is the composer's half, which that cannot
 * reach: the images go back too, a draft typed since is kept beside it, and a
 * re-render with the same kept message does not paste it twice.
 */

/** A real 1×1 PNG, as `image-upload.test.tsx` uses. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngUrl = `data:image/png;base64,${PNG}`;

function composer(kept: KeptMessage | null, taken: () => void = () => {}) {
  return (
    <TooltipProvider>
      <MultimodalInput
        status="ready"
        isConnected
        readOnly="Watching read-only."
        onSubmit={() => {}}
        kept={kept}
        onKeptTaken={taken}
      />
    </TooltipProvider>
  );
}

const textarea = () => document.querySelector('textarea') as HTMLTextAreaElement;

afterEach(cleanup);

describe('a kept message', () => {
  it('restores its exact text and its images, and says it was taken', async () => {
    let taken = 0;
    const kept: KeptMessage = {
      text: 'line one\n  line two',
      files: [{ type: 'file', url: pngUrl, mediaType: 'image/png', filename: 'dot.png' }],
      n: 1,
    };
    render(composer(kept, () => taken++));
    await waitFor(() => expect(textarea().value).toBe('line one\n  line two'));
    await waitFor(() =>
      expect(document.querySelector('[aria-label="Attachments"] img')?.getAttribute('alt')).toBe(
        'dot.png',
      ),
    );
    expect(taken).toBe(1);
  });

  it('restores once per kept message, and a second one goes in front of the draft', async () => {
    const kept: KeptMessage = { text: 'first', files: [], n: 1 };
    const view = render(composer(kept));
    await waitFor(() => expect(textarea().value).toBe('first'));
    // The same message again — a re-render before the shell's clear lands.
    view.rerender(composer(kept));
    await new Promise((r) => setTimeout(r, 20));
    expect(textarea().value).toBe('first');
    // A second refusal: kept, with what is already there after it rather than lost.
    view.rerender(composer({ text: 'second', files: [], n: 2 }));
    await waitFor(() => expect(textarea().value).toBe('second\n\nfirst'));
  });
});
