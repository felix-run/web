// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { Toaster } from '../src/components/toaster';
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
          <Toaster />
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

describe('a send the harness refuses on the lease', () => {
  /** The `/chat/stream` bodies that reached the server, by the message they carried. */
  const streamed = (server: ReturnType<typeof leaseServer>) =>
    server.requests
      .filter((r) => r.startsWith('POST ') && r.includes('/chat/stream '))
      .map((r) => {
        const body = JSON.parse(r.slice(r.indexOf('{'))) as {
          messages?: Array<{ content?: string }>;
        };
        return body.messages?.at(-1)?.content;
      });

  it('puts the message back in the composer, and sends it once after the takeover', async () => {
    // The hold lapsed while the tab slept, and another client took the thread:
    // this tab still believes it drives, and its send carries a stale token. It is
    // taken as the send arrives, so no renewal tick can find out first. Taking it
    // before Enter raced a 60ms tick on a loaded CI runner: the tab flipped to
    // watching, Enter met a disabled composer, and nothing was sent.
    let takeOnSend = false;
    const server = leaseServer({
      beforeDrive: ({ path, thread }) => {
        const lease = thread ? server.leases.get(thread) : undefined;
        if (!takeOnSend || path !== '/api/chat/stream' || !lease) return;
        takeOnSend = false;
        lease.holder = 'other-tab';
        lease.token = 'tok-other';
      },
    });
    mount('/t/thread-k');
    await waitFor(() => expect(server.leases.get('thread-k')?.mode).toBe('exclusive'));
    const ours = server.leases.get('thread-k')?.token;

    await act(async () => {
      await userEvent.type(composer() as HTMLTextAreaElement, 'do not lose this');
    });
    takeOnSend = true;
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });
    await waitFor(() => expect(banner()).toBeTruthy());
    expect(server.drives.find((d) => d.path === '/api/chat/stream')).toMatchObject({
      leaseToken: ours,
      status: 409,
    });
    // Back in the composer, exactly, while it is read-only — and nowhere in the
    // transcript as though it had been sent.
    await waitFor(() => expect(composer()?.value).toBe('do not lose this'));
    expect(composer()?.disabled).toBe(true);
    expect(
      await screen.findByText(
        'Your message was kept. It will be sendable when this tab drives again.',
      ),
    ).toBeTruthy();
    const transcript = document.querySelector('[data-slot="conversation"]');
    expect(transcript?.textContent ?? '').not.toContain('do not lose this');

    // The other client leaves; this tab takes over and the composer opens.
    server.leave('thread-k');
    await waitFor(() => expect(composer()?.disabled).toBe(false), { timeout: RENEW_MS * 4 });
    const taken = server.leases.get('thread-k')?.token;

    await act(async () => {
      (composer() as HTMLTextAreaElement).focus();
      await userEvent.keyboard('{Enter}');
    });
    await waitFor(() =>
      expect(server.drives.filter((d) => d.path === '/api/chat/stream')).toMatchObject([
        { status: 409 },
        { status: 200, leaseToken: taken },
      ]),
    );
    // A send that went through clears the composer, as it always has.
    await waitFor(() => expect(composer()?.value).toBe(''));
    await settle(RENEW_MS * 2);
    expect(streamed(server)).toEqual(['do not lose this', 'do not lose this']);
    expect(server.drives.filter((d) => d.path === '/api/chat/stream')).toHaveLength(2);
  });

  it('keeps a refused queued message in the queue, and sends it once after the takeover', async () => {
    // The first run stays open until the test ends it, so a second message queues.
    const enc = new TextEncoder();
    let finish: () => void = () => {};
    let opened = 0;
    let takeOnSend = false;
    const server = leaseServer({
      // Taken as the drained send arrives, for the reason the test above gives:
      // taken earlier, a renewal tick can flip the tab first and nothing drains.
      beforeDrive: ({ path, thread }) => {
        const lease = thread ? server.leases.get(thread) : undefined;
        if (!takeOnSend || path !== '/api/chat/stream' || !lease) return;
        takeOnSend = false;
        lease.holder = 'other-tab';
        lease.token = 'tok-other';
      },
      stream: () => {
        opened += 1;
        if (opened > 1) {
          return new Response('data: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            finish = () => {
              c.enqueue(enc.encode('data: [DONE]\n\n'));
              c.close();
            };
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const tray = () => document.querySelector('section[aria-label="Queued messages"]');
    mount('/t/thread-q');
    await waitFor(() => expect(server.leases.get('thread-q')?.mode).toBe('exclusive'));

    await type('first');
    await waitFor(() => expect(opened).toBe(1));
    await type('queued next');
    await waitFor(() => expect(tray()?.textContent).toContain('queued next'));

    // Taken as the run ends and the queue drains; the drain sends with the stale token.
    takeOnSend = true;
    await act(async () => finish());

    await waitFor(() => expect(banner()).toBeTruthy());
    await waitFor(() => expect(tray()?.textContent).toContain('queued next'));
    // Back in the queue, not the composer, and not paused: the takeover sends it.
    expect(composer()?.value).toBe('');
    expect(tray()?.textContent).not.toContain('Paused');

    server.leave('thread-q');
    await waitFor(() => expect(tray()).toBeNull(), { timeout: RENEW_MS * 6 });
    await settle(RENEW_MS * 2);
    expect(streamed(server)).toEqual(['first', 'queued next', 'queued next']);
    expect(server.drives.filter((d) => d.path === '/api/chat/stream').map((d) => d.status)).toEqual(
      [200, 409, 200],
    );
  });
});
