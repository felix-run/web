// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { leaseServer } from './lease-server';

/**
 * A first message the harness refuses is dropped from the transcript, and the
 * cache has to drop it too. The shell skipped writing an empty transcript, so
 * the cache kept the refused message and its empty reply, and a reload drew
 * both — above the message the operator then sent again.
 */

function mount(at: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

const MESSAGE = 'write the deploy checklist';
const textarea = () => document.querySelector('textarea') as HTMLTextAreaElement | null;
const transcriptShows = (text: string) =>
  [...document.querySelectorAll('main *')].some(
    (el) => el.children.length === 0 && el.textContent?.includes(text) && el.tagName !== 'TEXTAREA',
  );

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 120));
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('a refused first message', () => {
  it('leaves nothing in the cache for a reload to bring back', async () => {
    leaseServer({
      stream: () =>
        new Response(JSON.stringify({ detail: 'missing scopes: chat:write' }), { status: 403 }),
    });
    mount('/t/thread-refused');
    await waitFor(() => expect(textarea()).toBeTruthy());

    await act(async () => {
      await userEvent.type(textarea() as HTMLTextAreaElement, MESSAGE);
      await userEvent.keyboard('{Enter}');
    });
    // Refused: the text is handed back to the composer and the turn is gone.
    await waitFor(() => expect(textarea()?.value).toBe(MESSAGE));
    await waitFor(() => expect(transcriptShows(MESSAGE)).toBe(false));
    expect(localStorage.getItem('felix.turns:thread-refused')).toBeNull();

    // And a reload draws an empty thread, not the refused message.
    cleanup();
    mount('/t/thread-refused');
    await waitFor(() => expect(textarea()).toBeTruthy());
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(transcriptShows(MESSAGE)).toBe(false);
  });
});
