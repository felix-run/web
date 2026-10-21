/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gate } from '../src/components/gate';
import { clearApiKey, getApiKey, handleUnauthorized, setApiKey } from '../src/lib/auth';

/**
 * The Gate is what stands between a browser and the proxy Worker's `/api/*`.
 * It is not user authentication — one shared key, stored in localStorage — but
 * it does decide when the app is usable, and it has to re-prompt when a key is
 * rotated out from under it. The 401 path is the one that matters: without it,
 * a rotated key leaves the user staring at a wall of failing requests.
 */

const unlocked = () => new Response('{"data":[]}', { status: 200 });
// The Worker's own refusal, which names its gate: that is what tells the page a
// key would open it.
const rejected = () => new Response('{"error":"unauthorized","gate":"chat_key"}', { status: 401 });

/** A Worker that opens for `key` and refuses everything else, as a gated deployment does. */
const keyed = (key: string) => async (_url: string, init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.['x-chat-key'] === key
    ? unlocked()
    : rejected();

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  clearApiKey();
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
  it('prompts for a key when none is stored and the Worker gates on one', async () => {
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    await waitFor(() => expect(screen.getByPlaceholderText('Access key')).toBeTruthy());
    expect(screen.queryByText('chat is open')).toBeNull();
  });

  // A deployment with no key and an injected upstream credential answers an
  // uncredentialed request; there is nothing to ask for.
  it('opens without asking when the deployment answers with nothing stored', async () => {
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  // The harness refusing is not the Worker refusing: no key would answer it, so
  // offering the key field would be a dead end that looks like a typo.
  it('offers no key field when the refusal is the harness’s, not the Worker’s', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    renderGate();
    await waitFor(() => expect(screen.getByText(/offers no way to sign in/i)).toBeTruthy());
    expect(screen.queryByPlaceholderText('Access key')).toBeNull();
  });

  // The flash: a stored key used to be checked *behind* the key prompt, so every
  // returning visitor saw the login screen for one round trip before the chat
  // replaced it. While the check is in flight the gate must draw neither.
  it('shows neither the prompt nor the app while a stored key is being checked', async () => {
    setApiKey('stored-key');
    let settle!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (settle = r)));
    renderGate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText('Access key')).toBeNull();
    expect(screen.queryByText(/access key/i)).toBeNull();
    expect(screen.queryByText('chat is open')).toBeNull();
    await act(async () => settle(unlocked()));
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  // The holding surface admits it is waiting only once the check has run long
  // enough to be worth saying so. A spinner for a fast probe is itself a flash.
  it('shows a spinner only once the check has run long', async () => {
    vi.useFakeTimers();
    try {
      setApiKey('stored-key');
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

  it('verifies a stored key and opens on success', async () => {
    setApiKey('stored-key');
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
    // Verification goes through the cheapest authenticated route.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/models');
    expect((init.headers as Record<string, string>)['x-chat-key']).toBe('stored-key');
  });

  it('stays locked when the stored key is rejected', async () => {
    setApiKey('stale-key');
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText('chat is open')).toBeNull();
  });

  it('stays locked when the check cannot reach the network', async () => {
    setApiKey('some-key');
    fetchMock.mockRejectedValue(new Error('offline'));
    renderGate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText('chat is open')).toBeNull();
  });

  it('accepts a key typed into the prompt and stores it', async () => {
    fetchMock.mockImplementation(keyed('typed-key'));
    renderGate();
    const input = (await screen.findByPlaceholderText('Access key')) as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'typed-key',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
    expect(getApiKey()).toBe('typed-key');
  });

  it('stays locked and shows an error when the Worker rejects a typed key', async () => {
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    const input = (await screen.findByPlaceholderText('Access key')) as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'wrong-key',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText('chat is open')).toBeNull();
    expect(screen.getByText(/rejected/i)).toBeTruthy();
    // submit() stores the key before verifying it; a rejection takes it back out,
    // so nothing keeps a key the Worker has already refused.
    expect(getApiKey()).toBeNull();
  });

  it('forgets a stored key that fails its check on load', async () => {
    setApiKey('stale-key');
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    await waitFor(() => expect(screen.getByText(/rejected/i)).toBeTruthy());
    expect(getApiKey()).toBeNull();
  });

  // Offline says nothing about the key, so it must survive: a laptop that wakes
  // without a network would otherwise be asked for a key that was fine.
  it('keeps a stored key when the check cannot reach the server', async () => {
    setApiKey('good-key');
    fetchMock.mockRejectedValue(new Error('offline'));
    renderGate();
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeTruthy());
    expect(getApiKey()).toBe('good-key');
  });

  // The rotation path: any 401 anywhere in the app drops the key and re-prompts,
  // rather than leaving the user with an app that silently fails every request.
  it('re-locks when a later request comes back 401', async () => {
    setApiKey('good-for-now');
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());

    fetchMock.mockResolvedValue(rejected());
    act(() => handleUnauthorized());

    await waitFor(() => expect(screen.queryByText('chat is open')).toBeNull());
    expect(getApiKey()).toBeNull();
  });

  it('stops listening for 401s once unmounted', async () => {
    setApiKey('good');
    const { unmount } = renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
    unmount();
    // Must not throw or try to set state on an unmounted component.
    expect(() => handleUnauthorized()).not.toThrow();
  });
  // A failed check carries a reason now. Offline and rejected are different
  // problems with different fixes, and the old boolean probe showed neither.
  it('explains an unreachable server rather than blaming the key', async () => {
    setApiKey('some-key');
    fetchMock.mockRejectedValue(new Error('offline'));
    renderGate();
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeTruthy());
    expect(screen.queryByText(/rejected/i)).toBeNull();
  });

  it('names an unconfigured proxy, which no key can fix', async () => {
    setApiKey('some-key');
    fetchMock.mockResolvedValue(new Response('{"error":"felix_origin_unset"}', { status: 502 }));
    renderGate();
    await waitFor(() => expect(screen.getByText(/FELIX_ORIGIN is unset/i)).toBeTruthy());
    expect(screen.queryByText(/rejected/i)).toBeNull();
  });

  it('reports an unexpected status with its code', async () => {
    setApiKey('some-key');
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    renderGate();
    await waitFor(() => expect(screen.getByText(/\(503\)/)).toBeTruthy());
  });

  // `autoFocus` only fires at mount, and the field is already mounted through
  // the checking phase — so the one moment the user has to type into it was
  // the one moment it was not focused.
  it('focuses the field when a stored key fails its check', async () => {
    setApiKey('stale-key');
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    await waitFor(() => expect(screen.getByText(/rejected/i)).toBeTruthy());
    // Awaited, not asserted straight after the text. The field is focused from an
    // effect keyed on `checking`, and the error message renders in the same commit
    // that flips it — so the text can be on screen a tick before effects flush.
    // Asserting synchronously passed on a warm machine and failed on a cold CI
    // runner, where `document.activeElement` was still `<body>`.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Access key')),
    );
  });
  // A screen reader names the field from its label, not its placeholder, which is gone after
  // the first keystroke; and a password manager offers to fill it only when it says what it is.
  it('labels the key field as a password a manager can fill', async () => {
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    const input = await screen.findByLabelText('Access key');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
  });

  // The field used to be disabled while a key was checked, which blurs it: a rejected key then
  // left focus on the page, and retyping meant tabbing back from the top.
  it('hands focus back to the field when a typed key is rejected', async () => {
    fetchMock.mockResolvedValue(rejected());
    renderGate();
    const input = (await screen.findByPlaceholderText('Access key')) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'wrong-key',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.blur();
    await act(async () => {
      input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(screen.getByText(/rejected/i)).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

describe('Gate, when the world changes under a locked prompt', () => {
  // A server that took the request and never answered is not a dropped network, and saying
  // "check your connection" sends the person to the wrong place.
  it('says the server sat on the check, and gives the check a deadline', async () => {
    setApiKey('stored-key');
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
    fetchMock.mockImplementation(keyed('k'));
    const listening = listeningFor('storage');
    renderGate();
    await waitFor(() => expect(screen.getByPlaceholderText('Access key')).toBeTruthy());
    await listening();
    localStorage.setItem('felix.apiKey', 'k');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'felix.apiKey', newValue: 'k' }));
    });
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });

  it('lets the no-way-in card check again once the deployment is fixed', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    renderGate();
    await waitFor(() => expect(screen.getByText(/offers no way to sign in/i)).toBeTruthy());
    fetchMock.mockImplementation(async () => unlocked());
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());
  });
});
