// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PushHint } from '../src/components/chat/push-hint';
import { ThemeProvider } from '../src/components/theme-provider';
import { enablePush, pushCapability, resyncPush } from '../src/lib/push';

/**
 * Subscribing this device to the harness's pushes, and following one back into the app.
 *
 * The browser half is stubbed at its own seams — `navigator.serviceWorker`, `PushManager`,
 * `Notification` — and the harness at `fetch`, so what is asserted is what reaches the wire:
 * that the browser's own subscription is what gets registered, that a subscription made for
 * another deployment's key is replaced rather than registered, and that a tapped notification
 * moves the router rather than reloading a page that may hold a live run.
 */

const KEY =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15';

function decode(key: string): Uint8Array {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

interface FakeSub {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

function fakeSub(endpoint: string, key: string | null): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: key ? (decode(key).buffer as ArrayBuffer) : null },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

let posted: Array<{ method: string; url: string; body: unknown }>;
let held: FakeSub | null;
let subscribeOptions: PushSubscriptionOptionsInit[];
let sw: EventTarget & { getRegistration: () => Promise<unknown> };

function device({
  standalone = false,
  permission = 'default' as NotificationPermission,
  ua = MAC,
  pushKey = KEY as string | null,
} = {}) {
  posted = [];
  subscribeOptions = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    posted.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/push/vapid-public-key')) {
      return pushKey
        ? new Response(JSON.stringify({ public_key: pushKey }), { status: 200 })
        : new Response('{"detail":"push_not_configured"}', { status: 503 });
    }
    if (url.includes('/chat/sessions')) {
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    }
    if (url.includes('/approvals'))
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const registration = {
    pushManager: {
      getSubscription: async () => held,
      subscribe: async (options: PushSubscriptionOptionsInit) => {
        subscribeOptions.push(options);
        held = fakeSub('https://web.push.apple.com/new-device', KEY);
        return held;
      },
    },
  };
  sw = Object.assign(new EventTarget(), { getRegistration: async () => registration });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
  vi.stubGlobal('PushManager', function PushManager() {});
  const notification = Object.assign(function Notification() {}, {
    permission,
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  });
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(display-mode: standalone)' ? standalone : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  return { notification };
}

beforeEach(() => {
  held = null;
  localStorage.removeItem('felix.pushHint');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('pushCapability', () => {
  it('is a step away in iPhone Safari, not a dead end', () => {
    device({ ua: IPHONE });
    expect(pushCapability()).toBe('needs-install');
  });

  it('is available once installed', () => {
    device({ ua: IPHONE, standalone: true });
    expect(pushCapability()).toBe('available');
  });
});

describe('enablePush', () => {
  it('subscribes with the deployment key and registers what the browser made', async () => {
    device();
    expect(await enablePush(KEY)).toBe('on');
    expect(Array.from(subscribeOptions[0].applicationServerKey as Uint8Array)).toEqual(
      Array.from(decode(KEY)),
    );
    expect(subscribeOptions[0].userVisibleOnly).toBe(true);
    const register = posted.find(
      (p) => p.method === 'POST' && p.url.endsWith('/push/subscriptions'),
    );
    expect(register?.body).toEqual({
      endpoint: 'https://web.push.apple.com/new-device',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('replaces a subscription made for another deployment instead of registering it', async () => {
    device();
    const stale = fakeSub(
      'https://web.push.apple.com/old-device',
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    );
    held = stale;
    await enablePush(KEY);
    expect(stale.unsubscribe).toHaveBeenCalled();
    const register = posted.find((p) => p.method === 'POST');
    expect((register?.body as { endpoint: string }).endpoint).toBe(
      'https://web.push.apple.com/new-device',
    );
  });

  it('registers nothing when the person says no', async () => {
    const { notification } = device();
    notification.requestPermission.mockResolvedValueOnce('denied');
    expect(await enablePush(KEY)).toBe('denied');
    expect(posted.filter((p) => p.method === 'POST')).toEqual([]);
  });
});

describe('resyncPush', () => {
  it('re-registers a subscription the device already holds', async () => {
    device({ permission: 'granted' });
    held = fakeSub('https://fcm.googleapis.com/fcm/send/laptop', KEY);
    await resyncPush();
    expect(posted.filter((p) => p.method === 'POST').map((p) => p.url)).toEqual([
      '/api/push/subscriptions',
    ]);
  });

  it('drops a subscription whose permission was withdrawn, on both sides', async () => {
    device({ permission: 'denied' });
    const sub = fakeSub('https://fcm.googleapis.com/fcm/send/laptop', KEY);
    held = sub;
    await resyncPush();
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(posted.find((p) => p.method === 'DELETE')?.body).toEqual({ endpoint: sub.endpoint });
  });
});

describe('the notifications line', () => {
  const mount = () =>
    render(
      <TooltipProvider>
        <PushHint />
      </TooltipProvider>,
    );

  it('offers notifications inside the installed app, and turns them on from the click', async () => {
    device({ ua: IPHONE, standalone: true });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(posted.some((p) => p.method === 'POST')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull());
  });

  it('offers nothing when the deployment does not push', async () => {
    device({ ua: IPHONE, standalone: true, pushKey: null });
    const { container } = mount();
    await waitFor(() =>
      expect(posted.some((p) => p.url.endsWith('/push/vapid-public-key'))).toBe(true),
    );
    expect(container.textContent).toBe('');
  });

  it('offers nothing in a tab, where the install line speaks instead', () => {
    device({ ua: IPHONE, standalone: false });
    const { container } = mount();
    expect(container.textContent).toBe('');
    expect(posted).toEqual([]);
  });
});

describe('a tapped notification', () => {
  it('moves the open app to the thread with the router, and answers the worker', async () => {
    device();
    let address = '';
    function Probe() {
      address = useLocation().pathname;
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/t/where-i-was']}>
        <Probe />
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(address).toBe('/t/where-i-was'));

    const channel = new MessageChannel();
    const answered = new Promise((resolve) => {
      channel.port1.onmessage = (e) => resolve(e.data);
    });
    act(() => {
      sw.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'felix:open', path: '/t/thread-7' },
          ports: [channel.port2],
        }),
      );
    });
    await waitFor(() => expect(address).toBe('/t/thread-7'));
    expect(await answered).toBe('ok');

    // Never off-site, whatever a message claims.
    act(() => {
      sw.dispatchEvent(
        new MessageEvent('message', { data: { type: 'felix:open', path: '//evil.example/x' } }),
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(address).toBe('/t/thread-7');
    channel.port1.close();
  });
});
