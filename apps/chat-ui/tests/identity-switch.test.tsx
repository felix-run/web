/** @vitest-environment happy-dom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Moving from one identity to another in one browser: a GitHub sign-in, then a Google one, then
 * somebody else's. The browser kept transcripts, the thread list, durable-run tokens and the chosen
 * agent under keys that name no person, and a sign-out forgot only the token — so the next person
 * opened the last one's conversations from the cache. These pin what must be forgotten, when, and
 * what must not be.
 */

const reloadHome = vi.fn();
vi.mock('../src/lib/opened-identity', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/opened-identity')>();
  return { ...real, reloadHome: () => reloadHome() };
});

const disablePush = vi.fn(async () => {});
vi.mock('../src/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/push')>();
  return { ...real, disablePush: () => disablePush() };
});

const removeGitHubConnection = vi.fn(async () => {});
vi.mock('../src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api')>();
  return { ...real, removeGitHubConnection: () => removeGitHubConnection() };
});

const toastError = vi.fn();
vi.mock('sonner', async (importOriginal) => {
  const real = await importOriginal<typeof import('sonner')>();
  return { ...real, toast: Object.assign(real.toast, { error: (m: unknown) => toastError(m) }) };
});

const { Gate } = await import('../src/components/gate');
const auth = await import('../src/lib/auth');
const { leave, onLeave } = await import('../src/lib/leave');

type Session = Parameters<typeof auth.setSession>[0];

const github = (over: Partial<Session> = {}): Session => ({
  token: 'gh-token',
  expiresAt: Date.now() + 3_600_000,
  login: 'blake',
  tenant: 'default',
  scopes: ['jobs:write'],
  provider: 'github',
  ...over,
});
const google = (over: Partial<Session> = {}): Session =>
  github({ token: 'g-token', login: '', email: 'blake@example.com', provider: 'google', ...over });

/** What the last person left: a thread, its transcript, a durable run, a pin, the agent, a pane. */
function leaveTraces() {
  localStorage.setItem('felix.threads', JSON.stringify([{ id: 't1', title: 'Payroll' }]));
  localStorage.setItem('felix.turns:t1', JSON.stringify([{ role: 'user', content: 'salaries' }]));
  localStorage.setItem('felix.durableRuns', '{"t1":"tok"}');
  localStorage.setItem('felix.pinnedThreads', '["t1"]');
  localStorage.setItem('felix.manifest', 'deep');
  localStorage.setItem('felix.githubTenant', 'acme');
  sessionStorage.setItem('felix.pane:t1', '{"items":[]}');
  sessionStorage.setItem('felix.tabThread', 't1');
}

const traces = () => ({
  threads: localStorage.getItem('felix.threads'),
  turns: localStorage.getItem('felix.turns:t1'),
  runs: localStorage.getItem('felix.durableRuns'),
  pins: localStorage.getItem('felix.pinnedThreads'),
  agent: localStorage.getItem('felix.manifest'),
  tenant: localStorage.getItem('felix.githubTenant'),
  pane: sessionStorage.getItem('felix.pane:t1'),
  tab: sessionStorage.getItem('felix.tabThread'),
});
/** After a sign-out: nothing. */
const NONE = {
  threads: null,
  turns: null,
  runs: null,
  pins: null,
  agent: null,
  tenant: null,
  pane: null,
  tab: null,
};
/** After a change of identity: nothing but the remembered GitHub tenant (`SIGN_OUT_KEYS`). */
const SWITCHED = { ...NONE, tenant: 'acme' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  reloadHome.mockClear();
  toastError.mockClear();
  disablePush.mockClear();
  removeGitHubConnection.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"data":[]}', { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a credential for someone else', () => {
  it('forgets everything the last person left, from GitHub to Google and back', () => {
    auth.setSession(github());
    leaveTraces();
    auth.setSession(google());
    expect(traces()).toEqual(NONE);

    leaveTraces();
    auth.setSession(github());
    expect(traces()).toEqual(NONE);
  });

  it('tells two people of one provider apart by their token, not by a login the harness may omit', () => {
    const token = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
    auth.setSession(github({ login: '', token: token('github:1') }));
    leaveTraces();
    auth.setSession(github({ login: '', token: token('github:2') }));
    expect(traces()).toEqual(NONE);
  });

  it('forgets a tenant’s state on a move to another, keeping the choice of tenant', () => {
    auth.setSession(github());
    leaveTraces();
    auth.setSession(github({ tenant: 'acme' }));
    expect(traces()).toEqual(SWITCHED);
  });

  it('forgets everything when an access key replaces a session', () => {
    auth.setSession(github());
    leaveTraces();
    auth.setApiKey('k');
    expect(traces()).toEqual(NONE);
  });

  it('forgets the in-browser workspace the last person’s agent wrote into', () => {
    auth.setSession(github());
    localStorage.setItem('felix.chat.vfs', '{"notes.md":"private"}');
    auth.setSession(google());
    expect(localStorage.getItem('felix.chat.vfs')).toBeNull();
  });

  it('keeps the tenant a GitHub member just chose, which is itself a change of identity', () => {
    auth.setSession(github({ tenant: 'default' }));
    // The device flow remembers the choice, then stores the session for it.
    localStorage.setItem('felix.githubTenant', 'acme');
    auth.setSession(github({ tenant: 'acme' }));
    expect(localStorage.getItem('felix.githubTenant')).toBe('acme');
  });

  it('keeps everything through a renewal of the same sign-in', () => {
    auth.setSession(github());
    leaveTraces();
    auth.setSession(github({ token: 'renewed', expiresAt: Date.now() + 7_200_000 }));
    expect(traces().turns).not.toBeNull();
    expect(traces().threads).not.toBeNull();
  });

  it('keeps what a browser held before it recorded whose it was', () => {
    leaveTraces();
    auth.setSession(github());
    expect(traces().turns).not.toBeNull();
  });
});

describe('whose app the page opened', () => {
  it('stays stale for someone else however often a discarded render asks again', async () => {
    const { openFor } = await vi.importActual<typeof import('../src/lib/opened-identity')>(
      '../src/lib/opened-identity',
    );
    expect(openFor('a')).toBe(false);
    expect(openFor('b')).toBe(true);
    // React threw the first render away and retried it: still someone else's page.
    expect(openFor('b')).toBe(true);
  });
});

describe('when the app opens', () => {
  it('finishes a forget the last page could not, before anything reads', () => {
    auth.setSession(github());
    auth.setSession(google());
    // The old app, still on screen until the page unloads, writes after the sweep.
    localStorage.setItem('felix.turns:t1', 'late');
    auth.settleIdentity();
    expect(localStorage.getItem('felix.turns:t1')).toBeNull();
    // Once: what the new identity writes from then on is its own.
    localStorage.setItem('felix.turns:t2', 'mine');
    auth.settleIdentity();
    expect(localStorage.getItem('felix.turns:t2')).toBe('mine');
  });

  it('records whose state a browser signed in before the record was kept holds', () => {
    // A session stored by the release before this one: no record of whose the cache is.
    localStorage.setItem('felix.session', JSON.stringify(github()));
    leaveTraces();
    auth.settleIdentity();
    expect(traces().turns).not.toBeNull();
    // So the next person's sign-in now forgets it.
    auth.setSession(google());
    expect(traces()).toEqual(NONE);
  });
});

describe('signing out', () => {
  it('forgets the session and everything kept for it, but not the preferences', () => {
    localStorage.setItem('felix.theme', 'dark');
    auth.setSession(google());
    leaveTraces();
    auth.signOut();
    expect(auth.getSession()).toBeNull();
    expect(traces()).toEqual(NONE);
    expect(localStorage.getItem('felix.theme')).toBe('dark');
    expect(auth.lastSignInProvider()).toBe('google');
    // Nothing recorded as this browser's owner any more, so the next sign-in starts clean too.
    expect(localStorage.getItem('felix.identity')).toBeNull();
  });

  it('lets go of leases and push, and the GitHub connection for a GitHub session, then reloads', async () => {
    const released = vi.fn();
    const stop = onLeave(released);
    auth.setSession(github());
    await leave({ github: true });
    stop();
    expect(released).toHaveBeenCalledOnce();
    expect(disablePush).toHaveBeenCalledOnce();
    expect(removeGitHubConnection).toHaveBeenCalledOnce();
    expect(auth.getSession()).toBeNull();
    expect(reloadHome).toHaveBeenCalledOnce();
  });

  it('asks a Google session for no GitHub connection', async () => {
    auth.setSession(google());
    await leave({ github: false });
    expect(removeGitHubConnection).not.toHaveBeenCalled();
    expect(reloadHome).toHaveBeenCalledOnce();
  });

  it('does not wait for ever on a harness that does not answer', async () => {
    vi.useFakeTimers();
    disablePush.mockImplementationOnce(() => new Promise(() => {}));
    auth.setSession(google());
    const done = leave({ github: false });
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(auth.getSession()).toBeNull();
    expect(reloadHome).toHaveBeenCalledOnce();
  });
});

describe('a 401', () => {
  it('drops the credential that was refused', () => {
    auth.setSession(github());
    auth.handleUnauthorized(auth.authHeaders());
    expect(auth.getSession()).toBeNull();
  });

  it('leaves a credential stored since the refused request left', () => {
    auth.setSession(github({ token: 'old' }));
    const sent = auth.authHeaders();
    auth.setSession(google());
    auth.handleUnauthorized(sent);
    expect(auth.getSession()?.provider).toBe('google');
  });
});

/**
 * The app on screen, and its listeners attached: `findByText` returns once the text renders, which
 * on a slow runner can be before the effect that subscribes to another tab's writes has run.
 */
async function opened() {
  await screen.findByText('chat is open');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('the open app', () => {
  const renderGate = () =>
    render(
      <Gate>
        <div>chat is open</div>
      </Gate>,
    );

  it('reloads when another tab signs in as someone else', async () => {
    auth.setSession(github());
    renderGate();
    await opened();
    localStorage.setItem('felix.session', JSON.stringify(google()));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'felix.session' }));
    });
    expect(reloadHome).toHaveBeenCalledOnce();
  });

  it('reloads when another tab signs out', async () => {
    auth.setSession(github());
    renderGate();
    await opened();
    localStorage.removeItem('felix.session');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'felix.session' }));
    });
    expect(reloadHome).toHaveBeenCalledOnce();
  });

  it('stays put through a renewal another tab stores', async () => {
    auth.setSession(github());
    renderGate();
    await opened();
    localStorage.setItem('felix.session', JSON.stringify(github({ token: 'renewed' })));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'felix.session' }));
    });
    expect(reloadHome).not.toHaveBeenCalled();
  });

  it('reopens for someone else in this page only by loading it afresh', async () => {
    auth.setSession(github());
    renderGate();
    await screen.findByText('chat is open');
    cleanup();
    // A relock, then a sign-in that did not reload (a device flow): the gate opens again.
    auth.setSession(google());
    renderGate();
    await waitFor(() => expect(reloadHome).toHaveBeenCalledOnce());
    expect(screen.queryByText('chat is open')).toBeNull();
  });

  it('says so when a sign-in to switch or renew fails and the old session carries on', async () => {
    auth.setSession(github());
    window.history.replaceState(null, '', '/#felix_login_error=account_not_allowed');
    renderGate();
    await screen.findByText('chat is open');
    expect(toastError).toHaveBeenCalledOnce();
    expect(auth.getSession()?.provider).toBe('github');
  });

  it('says nothing was rejected when a request after sign-out carried no credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('{"error":"unauthorized","gate":"chat_key"}', { status: 401 }),
      ),
    );
    renderGate();
    await screen.findByPlaceholderText('Access key');
    act(() => auth.handleUnauthorized({}));
    await screen.findByPlaceholderText('Access key');
    expect(screen.queryByText(/rejected/i)).toBeNull();
  });
});
