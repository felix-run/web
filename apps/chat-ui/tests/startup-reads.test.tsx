// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { listManifestEntries, primeManifestEntries } from '../src/api';
import { ThemeProvider } from '../src/components/theme-provider';

/** Every route answers empty; the test counts what was asked. */
function stubHarness() {
  const fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/v1/models')) return Response.json({ data: [{ id: 'quick' }] });
    return Response.json({ sessions: [], items: [], requests: [] });
  });
  vi.stubGlobal('fetch', fetch);
  return (part: string) => fetch.mock.calls.filter((c) => String(c[0]).includes(part)).length;
}

afterEach(() => vi.unstubAllGlobals());

describe('the agent list after the gate', () => {
  it("is the gate's answer, not a second request for it", async () => {
    const asked = stubHarness();
    primeManifestEntries(Response.json({ data: [{ id: 'quick' }, { id: 'cowork' }] }));
    expect((await listManifestEntries()).map((m) => m.id)).toEqual(['quick', 'cowork']);
    expect(asked('/v1/models')).toBe(0);
    // Taken once: the next reader asks the harness.
    await listManifestEntries();
    expect(asked('/v1/models')).toBe(1);
  });
});

describe('the canary check', () => {
  it('reads the tenant manifests once, not again on every thread change', async () => {
    const asked = stubHarness();
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(asked('/api/manifests')).toBeGreaterThan(0));
    const fresh = await screen.findAllByRole('button', { name: /new chat/i });
    await act(async () => void (await userEvent.click(fresh[0] as HTMLElement)));
    await new Promise((r) => setTimeout(r, 50));
    expect(asked('/api/manifests')).toBe(1);
  });
});
