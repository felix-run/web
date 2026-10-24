/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gate } from '../src/components/gate';
import { clearSession, getSession, handleUnauthorized, setSession } from '../src/lib/auth';

/**
 * The Gate is what stands between a browser and `/api/*`. The proxy Worker holds no credential,
 * so the gate opens on a session the harness accepts — or on nothing at all, when the harness
 * asks for none — and it has to re-prompt when a session ends under it. The 401 path is the one
 * that matters: without it, an ended session leaves the person staring at a wall of failing
 * requests.
 */

const unlocked = () => new Response('{"data":[]}', { status: 200 });
const refused = () => new Response('{"error":"unauthorized"}', { status: 401 });
const methods = (body: object) => () => Response.json(body);

/** A session that will not lapse during a test. */
const session = (token = 'stored-jwt') => ({
  token,
  expiresAt: Date.now() + 3_600_000,
  login: 'octo',
  tenant: 'acme',
  scopes: ['chat'],
});

/**
 * A harness that requires sign-in: it opens for `token` and refuses everything else, and offers
 * GitHub's device flow. Every other route is a 404.
 */
const harness =
  (token: string, offer: object = { github_device: true, bearer_required: true }) =>
  async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/methods') return methods(offer)();
    if (url !== '/api/v1/models') return new Response('{}', { status: 404 });
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    return auth === `Bearer ${token}` ? unlocked() : refused();
  };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  clearSession();
  fetchMock = vi.fn(async () => unlocked());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderGate = () =>
  render(
    <Gate>
      <div>chat is open</div>
    </Gate>,
  );

/** The probes of `/api/v1/models`, which is where the gate checks a credential. */
const probes = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/v1/models') as [string, RequestInit][];

/**
 * Resolves once the locked gate is listening for `type`. The card is committed before the effect
 * that attaches its listeners runs, so waiting on the card alone and then dispatching can lose the
 * event in between — which a loaded CI runner hit, timing out on "chat is open". Call before
 * rendering, so the spy sees the attach.
 */
function listeningFor(type: string): () => Promise<void> {
  const spy = vi.spyOn(window, 'addEventListener');
  return () => waitFor(() => expect(spy.mock.calls.some(([t]) => t === type)).toBe(true));
}

describe('Gate', () => {
  it('offers sign-in when nothing is stored and the harness requires it', async () => {
    fetchMock.mockImplementation(harness('nobody'));
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(screen.queryByText('chat is open')).toBeNull();
  });

  // A harness running FELIX_AUTH_MODE=none answers an uncredentialed request; there is nothing
  // to ask for.
  it('opens without asking when the harness answers with nothing stored', async () => {
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  // The shared access key is retired: no deployment can be answered by one, so none is offered.
  it('offers no access key, and says when there is no way in at all', async () => {
    fetchMock.mockImplementation(harness('nobody', {}));
    renderGate();
    await waitFor(() => expect(screen.getByText(/offers no way to sign in/i)).toBeTruthy());
    expect(screen.queryByText(/access key/i)).toBeNull();
    expect(screen.queryByText(/CHAT_UI_KEY/)).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });

  // A browser that stored the key before it was retired still holds it. It is a secret nothing
  // reads any more, so it goes, and it is never sent.
  it('drops a stored access key and never sends one', async () => {
    localStorage.setItem('felix.apiKey', 'old-key');
    fetchMock.mockImplementation(harness('nobody'));
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(localStorage.getItem('felix.apiKey')).toBeNull();
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      expect((init?.headers as Record<string, string> | undefined)?.['x-chat-key']).toBeUndefined();
    }
  });

  // The flash: a stored credential used to be checked *behind* the prompt, so every returning
  // visitor saw the login screen for one round trip before the chat replaced it. While the check
  // is in flight the gate must draw neither.
  it('shows neither the prompt nor the app while a stored session is being checked', async () => {
    setSession(session());
    let settle!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (settle = r)));
    renderGate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /github/i })).toBeNull();
    expect(screen.queryByText('chat is open')).toBeNull();
    await act(async () => settle(unlocked()));
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  // The holding surface admits it is waiting only once the check has run long
  // enough to be worth saying so. A spinner for a fast probe is itself a flash.
  it('shows a spinner only once the check has run long', async () => {
    vi.useFakeTimers();
    try {
      setSession(session());
      fetchMock.mockReturnValue(new Promise<Response>(() => {}));
      renderGate();
      expect(screen.queryByRole('status')).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(399);
      });
      expect(screen.queryByRole('status')).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole('status')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('verifies a stored session and opens on success', async () => {
    setSession(session());
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
    // Verification goes through the cheapest authenticated route.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer stored-jwt');
  });

  it('forgets a stored session the harness refuses, and says the sign-in ended', async () => {
    setSession(session('stale-jwt'));
    fetchMock.mockImplementation(harness('fresh-jwt'));
    renderGate();
    await waitFor(() => expect(screen.getByText(/sign-in has ended/i)).toBeTruthy());
    expect(screen.queryByText('chat is open')).toBeNull();
    expect(getSession()).toBeNull();
    // Refused once is enough: asking again with nothing would only hear it twice.
    expect(probes()).toHaveLength(1);
  });

  // Offline says nothing about the session, so it must survive: a laptop that wakes
  // without a network would otherwise be asked to sign in again for nothing.
  it('keeps a stored session when the check cannot reach the server', async () => {
    setSession(session());
    fetchMock.mockRejectedValue(new Error('offline'));
    renderGate();
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeTruthy());
    expect(screen.queryByText('chat is open')).toBeNull();
    expect(screen.queryByText(/sign-in has ended/i)).toBeNull();
    expect(getSession()?.token).toBe('stored-jwt');
  });

  // Any 401 anywhere in the app drops the session and re-prompts, rather than leaving the person
  // with an app that silently fails every request.
  it('re-locks when a later request comes back 401', async () => {
    setSession(session());
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());

    fetchMock.mockImplementation(harness('nobody'));
    act(() => handleUnauthorized());

    await waitFor(() => expect(screen.queryByText('chat is open')).toBeNull());
    expect(getSession()).toBeNull();
  });

  it('stops listening for 401s once unmounted', async () => {
    setSession(session());
    const { unmount } = renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
    unmount();
    // Must not throw or try to set state on an unmounted component.
    expect(() => handleUnauthorized()).not.toThrow();
  });

  it('names an unconfigured proxy, which no sign-in can fix', async () => {
    setSession(session());
    fetchMock.mockResolvedValue(new Response('{"error":"felix_origin_unset"}', { status: 502 }));
    renderGate();
    await waitFor(() => expect(screen.getByText(/FELIX_ORIGIN is unset/i)).toBeTruthy());
    expect(screen.queryByText(/sign-in has ended/i)).toBeNull();
  });

  it('reports an unexpected status with its code', async () => {
    setSession(session());
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    renderGate();
    await waitFor(() => expect(screen.getByText(/\(503\)/)).toBeTruthy());
  });
});

describe('Gate, when the world changes under a locked prompt', () => {
  // A server that took the request and never answered is not a dropped network, and saying
  // "check your connection" sends the person to the wrong place.
  it('says the server sat on the check, and gives the check a deadline', async () => {
    setSession(session());
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    renderGate();
    await waitFor(() => expect(screen.getByText(/did not answer in time/i)).toBeTruthy());
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('checks again when the network comes back', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const listening = listeningFor('online');
    renderGate();
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeTruthy());
    await listening();
    fetchMock.mockImplementation(async () => unlocked());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  // Signing in in one tab writes the credential every other tab's gate is asking for.
  it('opens when another tab stores a credential', async () => {
    fetchMock.mockImplementation(harness('other-tab-jwt'));
    const listening = listeningFor('storage');
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    await listening();
    const stored = JSON.stringify(session('other-tab-jwt'));
    localStorage.setItem('felix.session', stored);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'felix.session', newValue: stored }));
    });
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  it('lets the no-way-in card check again once the deployment is fixed', async () => {
    fetchMock.mockImplementation(harness('nobody', {}));
    renderGate();
    await waitFor(() => expect(screen.getByText(/offers no way to sign in/i)).toBeTruthy());
    fetchMock.mockImplementation(async () => unlocked());
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });
});
