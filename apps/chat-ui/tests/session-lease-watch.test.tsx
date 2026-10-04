// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { leaseServer } from './lease-server';

/**
 * Watching a thread another client drives, and taking it over when it is free —
 * the whole shell against `lease-server.ts`, which answers leases and guards the
 * driving routes the way the harness does since `felix-run/felix#479`.
 *
 * A tab is a page, and the keeper is the page's, so "a second tab" is this page
 * opening a thread the server already has held exclusively by another holder;
 * "the driving tab closes" is that holder's release landing on the server.
 *
 * The renewal interval is what a takeover waits for, and at its real 150s no test
 * could watch one. `VITE_LEASE_RENEW_MS` shortens it, which is why `App` is
 * imported only after the variable is set: the keeper reads it at module load.
 */

const RENEW_MS = 60;
let App: ComponentType;

beforeAll(async () => {
  vi.stubEnv('VITE_LEASE_RENEW_MS', String(RENEW_MS));
  App = (await import('../src/App')).default;
});

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const settle = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));
const composer = () => document.querySelector('textarea') as HTMLTextAreaElement | null;
const banner = () => screen.queryByTestId('watching-banner');

async function type(text: string) {
  await waitFor(() => expect(composer()).toBeTruthy());
  await act(async () => {
    await userEvent.type(composer() as HTMLTextAreaElement, text);
    await userEvent.keyboard('{Enter}');
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  cleanup();
  // The keeper is module state, as it is for the life of a page: let this test's
  // releases land against its own server before the next one stubs another.
  await new Promise((r) => setTimeout(r, 80));
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the driving tab', () => {
  it('sends its exclusive token on every driving request', async () => {
    // Listed by the harness, so the rail offers the actions that act on server state.
    const server = leaseServer({ sessions: [{ id: 'default:thread-d', sessionName: 'Driven' }] });
    mount('/t/thread-d');
    await waitFor(() => expect(server.leases.get('thread-d')?.mode).toBe('exclusive'));
    const token = server.leases.get('thread-d')?.token;
    expect(token).toBeTruthy();

    // The stream.
    await type('hi');
    await waitFor(() =>
      expect(server.drives.some((d) => d.path === '/api/chat/stream')).toBe(true),
    );

    // Thinking, from the composer's picker.
    const user = userEvent.setup({ delay: null });
    const picker = await screen.findByRole('combobox', { name: 'Thinking: off' });
    picker.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: /^high/ }));

    // Compact, from the thread's own actions in the sidebar.
    await act(async () =>
      user.click(await screen.findByRole('button', { name: /^Actions for Driven/ })),
    );
    await act(async () =>
      user.click(await screen.findByRole('menuitem', { name: 'Compact context' })),
    );

    await waitFor(() =>
      expect(server.drives.map((d) => d.path)).toEqual(
        expect.arrayContaining(['/api/chat/stream', '/api/chat/thinking', '/api/chat/compact']),
      ),
    );
    for (const drive of server.drives) {
      expect(drive, `${drive.method} ${drive.path}`).toMatchObject({
        thread: 'thread-d',
        leaseToken: token,
        status: 200,
      });
    }
    expect(banner()).toBeNull();
  });
});

describe('a second tab', () => {
  it('observes, says so, and has its composer and driving actions off', async () => {
    const server = leaseServer();
    server.holdElsewhere('thread-w');
    mount('/t/thread-w');

    await waitFor(() => expect(banner()).toBeTruthy());
    expect(banner()?.getAttribute('role')).toBe('status');
    expect(banner()?.textContent).toContain(
      'Another tab or client is driving this conversation — watching read-only.',
    );
    // An observer hold of its own, alongside the driver's.
    const lease = server.leases.get('thread-w');
    expect(lease?.holder).toBe('other-tab');
    expect(lease?.observers.size).toBe(1);

    expect(composer()?.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('combobox', { name: 'Thinking: off' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(document.body.textContent).toContain('Watching read-only.');
  });

  it('takes over within one renewal of the driver leaving, and the banner clears', async () => {
    const server = leaseServer();
    server.holdElsewhere('thread-t');
    mount('/t/thread-t');
    await waitFor(() => expect(banner()).toBeTruthy());
    const observerToken = [...(server.leases.get('thread-t')?.observers.values() ?? [])][0];

    // Still held: a renewal tick or two, and it keeps watching.
    await settle(RENEW_MS * 2.5);
    expect(banner()).toBeTruthy();
    expect(server.leases.get('thread-t')?.holder).toBe('other-tab');

    server.leave('thread-t');
    await waitFor(() => expect(banner()).toBeNull(), { timeout: RENEW_MS * 4 });

    const lease = server.leases.get('thread-t');
    expect(lease?.mode).toBe('exclusive');
    expect(lease?.holder).toBe(sessionStorage.getItem('felix.holderId'));
    // The observer hold it had is gone, released with its own token.
    expect(lease?.observers.size).toBe(0);
    expect(
      server.calls.filter((c) => c.route === 'release' && c.token === observerToken),
    ).toMatchObject([{ status: 200 }]);
    await waitFor(() => expect(composer()?.disabled).toBe(false));

    // And what it sends now carries the token it took over with.
    await type('mine now');
    await waitFor(() =>
      expect(server.drives.find((d) => d.path === '/api/chat/stream')).toMatchObject({
        leaseToken: lease?.token,
        status: 200,
      }),
    );
  });

  it('sends a forced driving request with its observer token, and the harness refuses it', async () => {
    const server = leaseServer();
    server.holdElsewhere('thread-f');
    mount('/t/thread-f');
    await waitFor(() => expect(banner()).toBeTruthy());

    // The header menu's Continue run is off; the request path is still the server's
    // to refuse, so call the client the shell uses, as a stale control would.
    const { continueChat } = await import('../src/api');
    await expect(continueChat({ threadId: 'thread-f', manifest: 'quick' })).rejects.toMatchObject({
      name: 'LeaseRefusedError',
      code: 'lease_read_only',
    });
    expect(server.drives).toMatchObject([
      { path: '/api/chat/continue', status: 409, leaseToken: expect.any(String) },
    ]);
  });
});
