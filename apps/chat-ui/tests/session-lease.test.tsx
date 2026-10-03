// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * The shell's session lease, against a harness that answers the way
 * `felix/session/lease.py` does — not a stub that says 200 to everything, which
 * is how a release with the wrong token went unnoticed: the real one 403s it.
 *
 * Every request can be held in flight for a while before the "server" acts on
 * it, which is the reordering a real network does and the only way the races
 * here show up. All of it is mounted in `StrictMode`, as `main.tsx` mounts it.
 */

interface Lease {
  holder: string;
  token: string;
  mode: 'exclusive' | 'shared';
  observers: Set<string>;
}
interface Call {
  route: 'acquire' | 'release';
  thread: string;
  status: number;
  token?: string;
}

function leaseServer() {
  const leases = new Map<string, Lease>();
  const calls: Call[] = [];
  /** Per route, how long the next requests sit on the wire before the server acts. */
  const delays: Record<Call['route'], number[]> = { acquire: [], release: [] };
  let minted = 0;

  function acquire(b: Record<string, string>): [number, unknown] {
    const existing = leases.get(b.thread_id);
    const mode = b.mode === 'shared' ? 'shared' : 'exclusive';
    if (existing) {
      if (existing.mode === 'exclusive' && existing.holder !== b.holder_id) {
        return [409, { detail: 'lease_held' }];
      }
      if (existing.holder === b.holder_id) {
        existing.mode = mode;
        if (b.token) existing.token = b.token;
        return [200, { ok: true, renewed: true, token: existing.token }];
      }
      existing.observers.add(b.holder_id);
      return [200, { ok: true, renewed: false, token: existing.token }];
    }
    const token = b.token || `tok-${++minted}`;
    leases.set(b.thread_id, { holder: b.holder_id, token, mode, observers: new Set() });
    return [200, { ok: true, renewed: false, token }];
  }

  function release(b: Record<string, string>): [number, unknown] {
    const lease = leases.get(b.thread_id);
    if (!lease) return [200, { ok: true, released: false }];
    if (b.token && lease.token !== b.token) return [403, { detail: 'token_mismatch' }];
    if (b.holder_id && lease.holder !== b.holder_id && !lease.observers.has(b.holder_id)) {
      return [403, { detail: 'not_holder' }];
    }
    if (b.holder_id && lease.observers.has(b.holder_id) && lease.holder !== b.holder_id) {
      lease.observers.delete(b.holder_id);
      return [200, { ok: true, released: true }];
    }
    leases.delete(b.thread_id);
    return [200, { ok: true, released: true }];
  }

  const requests: string[] = [];
  const fetchFn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? 'GET'} ${url} ${String(init?.body ?? '')}`);
    const route = url.endsWith('/chat/sessions/lease/release')
      ? 'release'
      : url.endsWith('/chat/sessions/lease')
        ? 'acquire'
        : null;
    if (route) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      const wait = delays[route].shift() ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const [status, payload] = route === 'acquire' ? acquire(body) : release(body);
      calls.push({ route, thread: body.thread_id ?? '', status, token: body.token });
      return new Response(JSON.stringify(payload), { status });
    }
    if (url.includes('/chat/stream')) {
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (url.includes('/chat/sessions')) {
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    }
    if (url.includes('/approvals')) {
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchFn);
  return { leases, calls, delays, requests };
}

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
    expect(server.calls.filter((c) => c.route === 'release')).toEqual([
      { route: 'release', thread: 'thread-x', status: 200, token: 'tok-1' },
    ]);
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
