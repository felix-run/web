/** @vitest-environment happy-dom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
const rejected = () => new Response('{"error":"unauthorized"}', { status: 401 });

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

describe('Gate', () => {
  it('prompts for a key when none is stored', async () => {
    renderGate();
    expect(screen.queryByText('chat is open')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
    renderGate();
    const input = screen.getByPlaceholderText('Access key') as HTMLInputElement;
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
    const input = screen.getByPlaceholderText('Access key') as HTMLInputElement;
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
    // submit() stores the key before verifying it, so a rejected key stays in
    // localStorage until a 401 through apiFetch clears it. Harmless — the next
    // mount re-checks and stays locked — but surprising, so it is pinned here.
    expect(getApiKey()).toBe('wrong-key');
  });

  // The rotation path: any 401 anywhere in the app drops the key and re-prompts,
  // rather than leaving the user with an app that silently fails every request.
  it('re-locks when a later request comes back 401', async () => {
    setApiKey('good-for-now');
    renderGate();
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());

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
});
