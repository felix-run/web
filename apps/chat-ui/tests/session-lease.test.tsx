// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { type Call, leaseServer } from './lease-server';

/**
 * The shell's session lease, against `lease-server.ts` — a harness that answers
 * the way `felix/session/lease.py` does. All of it is mounted in `StrictMode`, as
 * `main.tsx` mounts it.
 */

let address = '';
let go: NavigateFunction = () => {};
function Probe() {
  address = useLocation().pathname;
  go = useNavigate();
  return null;
}

function mount(at: string) {
  address = '';
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[at]}>
        <Probe />
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

/** Long enough for every delayed request in a test to have landed. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 120)));

const errors = (calls: Call[]) => calls.filter((c) => c.status === 403 || c.status === 409);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
// The keeper is module state, as it is for the life of a page, so each test
// unmounts and lets its releases land against its own server before the next.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 120));
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the session lease', () => {
  /**
   * StrictMode mounts, cleans up and mounts again before anything resolves. The
   * old cleanup released with no token — which the harness accepts from the
   * holder and applies to whatever hold it has — so a release that landed after
   * the second mount's acquire dropped the lease the mounted thread was using.
   */
  it('holds exactly one lease across the StrictMode double mount', async () => {
    const server = leaseServer();
    server.delays.release = [20];
    const view = mount('/t/thread-x');
    await settle();

    expect(server.leases.get('thread-x')?.mode).toBe('exclusive');
    expect(server.calls.filter((c) => c.route === 'acquire')).toHaveLength(1);
    expect(server.calls.filter((c) => c.route === 'release')).toEqual([]);
    expect(errors(server.calls)).toEqual([]);

    view.unmount();
    await settle();
    // Released with the token its own acquire returned, and nothing left behind.
    const released = server.calls.filter((c) => c.route === 'release');
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ thread: 'thread-x', status: 200, token: 'tok-1' });
    expect(server.leases.size).toBe(0);
  });

  /**
   * The acquire is still on the wire when the thread changes. It has to release
   * itself once it lands — with the token it got — rather than leak a hold for
   * the TTL, or hand that token to the next thread's cleanup.
   */
  it('releases an acquire that resolves after its cleanup ran', async () => {
    const server = leaseServer();
    server.delays.acquire = [60];
    mount('/t/thread-a');
    await waitFor(() => expect(address).toBe('/t/thread-a'));
    await act(async () => {
      go('/t/thread-b');
    });
    await settle();

    expect([...server.leases.keys()]).toEqual(['thread-b']);
    const releasesOfA = server.calls.filter((c) => c.route === 'release');
    expect(releasesOfA).toHaveLength(1);
    expect(releasesOfA[0]).toMatchObject({ thread: 'thread-a', status: 200 });
    expect(releasesOfA[0]?.token).toBeTruthy();
    expect(errors(server.calls)).toEqual([]);
  });

  /**
   * A fast thread switch is not a StrictMode artefact: production does it on
   * every click through the rail quicker than a round trip. One shared token ref
   * let a late acquire for one thread overwrite the next thread's token, and the
   * next release 403'd with it and left that thread held.
   */
  it('keeps one hold through a fast thread switch, each released with its own token', async () => {
    const server = leaseServer();
    server.delays.acquire = [50, 0, 40, 0, 30, 0];
    mount('/t/thread-a');
    await waitFor(() => expect(address).toBe('/t/thread-a'));
    for (const next of ['thread-b', 'thread-a', 'thread-b', 'thread-a']) {
      await act(async () => {
        go(`/t/${next}`);
      });
    }
    await settle();

    expect(errors(server.calls)).toEqual([]);
    expect([...server.leases.keys()]).toEqual(['thread-a']);
    expect(server.calls.filter((c) => c.route === 'release' && !c.token)).toEqual([]);
  });

  /**
   * Same thread again while its release is still on the wire: the acquire waits
   * for the release, or the release lands after it and drops the new hold.
   */
  it('does not re-acquire a thread until its release has landed', async () => {
    const server = leaseServer();
    mount('/t/thread-a');
    await waitFor(() => expect(address).toBe('/t/thread-a'));
    await settle();
    server.delays.release = [60];
    await act(async () => {
      go('/t/thread-b');
    });
    await act(() => new Promise((r) => setTimeout(r, 10)));
    await act(async () => {
      go('/t/thread-a');
    });
    await settle();

    expect(errors(server.calls)).toEqual([]);
    expect([...server.leases.keys()]).toEqual(['thread-a']);
  });
});

describe('a page load', () => {
  /**
   * `/` used to mint two thread ids — the shell's own for its first render, and a
   * different one in `NewThread` — and lease both, which on a `memory://`
   * harness files each as a session: two empty UUID-titled threads per load. Now
   * one id, and the harness hears of it when the first message goes.
   */
  it('asks the harness nothing about the thread / mints until a message is sent', async () => {
    const server = leaseServer();
    mount('/');
    await waitFor(() => expect(address).toMatch(/^\/t\/[0-9a-f-]{36}$/));
    const minted = address.replace('/t/', '');
    await settle();

    const threadScoped = server.requests.filter((r) =>
      /\/chat\/(sessions\/lease|sessions\/[0-9a-f-]{36}|history\/|abort)/.test(r),
    );
    expect(threadScoped).toEqual([]);

    await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      await userEvent.type(box, 'hi');
      await userEvent.keyboard('{Enter}');
    });
    await settle();

    expect(server.calls.filter((c) => c.route === 'acquire').map((c) => c.thread)).toEqual([
      minted,
    ]);
    expect(server.leases.get(minted)?.mode).toBe('exclusive');
  });
});

describe('the page going away', () => {
  /**
   * Closing a tab unmounts nothing, so the shell's cleanup never released and a
   * closed tab held the thread exclusively until the TTL — a new tab on it got
   * 409 and observed for five minutes. The release has to leave on `pagehide`,
   * outlive the page (`keepalive`), and carry the credential the proxy wants.
   */
  it('releases the exclusive hold on pagehide, keepalive, with the credential', async () => {
    localStorage.setItem('felix.apiKey', 'k-test');
    const server = leaseServer();
    mount('/t/thread-x');
    await settle();
    expect(server.leases.get('thread-x')?.mode).toBe('exclusive');

    act(() => {
      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
    });
    expect(server.releaseInits).toHaveLength(1);
    const sent = server.releaseInits[0];
    expect(sent?.url).toBe('/api/chat/sessions/lease/release');
    expect(sent?.init).toMatchObject({
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', 'x-chat-key': 'k-test' },
    });
    expect(JSON.parse(String(sent?.init.body))).toEqual({
      thread_id: 'thread-x',
      holder_id: sessionStorage.getItem('felix.holderId'),
      token: 'tok-1',
    });
    await settle();
    expect(server.leases.size).toBe(0);
    expect(errors(server.calls)).toEqual([]);
  });

  /**
   * A page put in the back/forward cache can come back. It released its hold on
   * the way into the cache, so on the way back out it must take the thread again
   * — or it would sit on a thread it believes it holds while another tab takes it.
   */
  it('takes the thread again when the page comes back from the back/forward cache', async () => {
    const server = leaseServer();
    mount('/t/thread-x');
    await settle();

    act(() => {
      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    });
    await settle();
    expect(server.leases.size).toBe(0);

    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await settle();
    expect(server.leases.get('thread-x')?.mode).toBe('exclusive');
    expect(server.calls.map((c) => c.route)).toEqual(['acquire', 'release', 'acquire']);
    expect(errors(server.calls)).toEqual([]);
  });
});

describe('a refused driving request', () => {
  /**
   * The renewal interval here is the real 150s, so nothing but the refused
   * request itself can be what flips the tab: the keeper still believes it drives.
   */
  it('flips a tab that believed it drove to watching, without an error', async () => {
    const server = leaseServer();
    mount('/t/thread-r');
    await waitFor(() => expect(server.leases.get('thread-r')?.mode).toBe('exclusive'));

    // Another client takes the thread while this tab still holds a stale token —
    // a hold that lapsed while the laptop slept — and this tab sends.
    const lease = server.leases.get('thread-r');
    if (lease) lease.token = 'theirs';
    if (lease) lease.holder = 'other-tab';
    await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      await userEvent.type(box, 'are you there');
      await userEvent.keyboard('{Enter}');
    });

    await waitFor(() => expect(screen.queryByTestId('watching-banner')).toBeTruthy());
    expect(server.drives).toMatchObject([{ path: '/api/chat/stream', status: 409 }]);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    // Read-only, not failed: no alert in the transcript and no error toast.
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Could not|409|lease_held/);
  });
});
