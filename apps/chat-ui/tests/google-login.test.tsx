/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gate } from '../src/components/gate';
import { getSession, setRelockHandler } from '../src/lib/auth';

/**
 * Google sign-in, at the wire: the harness offers it on `/auth/methods` as `google_redirect`, the
 * button goes to its authorize route, and the return collects from Google's exchange — not
 * GitHub's, which is where every redirect went before. What these pin is that the page asks the
 * provider it left for, and that a refused account is told what to do about it.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status });
const TOKEN = {
  access_token: 'felix-jwt',
  token_type: 'Bearer',
  expires_in: 28_800,
  tenant: 'kids',
  scopes: [],
  github_login: '',
};

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: string[];
let assigned: string[];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  assigned = [];
  routes = {
    '/api/v1/models': (init) =>
      (init?.headers as Record<string, string> | undefined)?.authorization === 'Bearer felix-jwt'
        ? json({ data: [] })
        : json({ error: 'unauthorized' }, 401),
    '/api/auth/methods': () =>
      json({
        github_device: false,
        github_redirect: false,
        google_redirect: true,
        bearer_required: true,
      }),
    '/api/auth/google/exchange': () => json(TOKEN),
    '/api/auth/github/exchange': () => json({ error: 'expired_token', message: 'none' }, 400),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url.split('?')[0] as string);
      const handler = routes[url.split('?')[0] as string];
      return handler ? handler(init) : json({ error: 'not_found' }, 404);
    }),
  );
  vi.spyOn(window.location, 'assign').mockImplementation((url: string | URL) => {
    assigned.push(String(url));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setRelockHandler(null);
  window.history.replaceState(null, '', '/');
});

const renderGate = () =>
  render(
    <Gate>
      <div>chat is open</div>
    </Gate>,
  );

describe('Google sign-in', () => {
  it('is the card when Google is the only way in, and sends the browser to the harness', async () => {
    window.history.replaceState(null, '', '/t/abc');
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(screen.queryByRole('button', { name: /continue with github/i })).toBeNull();
    const target = new URL(assigned[0] as string, window.location.origin);
    expect(target.pathname).toBe('/api/auth/google/authorize');
    expect(target.searchParams.get('return_to')).toBe(`${window.location.origin}/t/abc`);
    expect(screen.getByRole('button', { name: /opening google/i })).toBeTruthy();
  });

  it('collects from Google on the way back, once, and clears the fragment', async () => {
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    cleanup();

    window.history.replaceState(null, '', '/t/abc#felix_login=ok');
    renderGate();
    await screen.findByText('chat is open');
    expect(getSession()).toMatchObject({ token: 'felix-jwt', tenant: 'kids' });
    expect(window.location.hash).toBe('');
    expect(calls.filter((c) => c === '/api/auth/google/exchange')).toHaveLength(1);
    expect(calls).not.toContain('/api/auth/github/exchange');
  });

  it('collects from GitHub when this tab went to GitHub', async () => {
    routes['/api/auth/methods'] = () =>
      json({
        github_device: true,
        github_redirect: true,
        google_redirect: true,
        bearer_required: true,
      });
    routes['/api/auth/github/exchange'] = () =>
      json({ ...TOKEN, tenant: 'acme', github_login: 'octo' });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    cleanup();

    window.history.replaceState(null, '', '/#felix_login=ok');
    renderGate();
    await screen.findByText('chat is open');
    expect(calls).toContain('/api/auth/github/exchange');
    expect(calls).not.toContain('/api/auth/google/exchange');
  });

  it('sits under GitHub when the harness offers both', async () => {
    routes['/api/auth/methods'] = () =>
      json({
        github_device: true,
        github_redirect: true,
        google_redirect: true,
        bearer_required: true,
      });
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(new URL(assigned[0] as string, window.location.origin).pathname).toBe(
      '/api/auth/google/authorize',
    );
  });

  it('tells an account that is not on the list what to do', async () => {
    window.history.replaceState(null, '', '/#felix_login_error=not_allowed');
    renderGate();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringMatching(/isn’t on this deployment’s list/),
    );
    expect(window.location.hash).toBe('');
  });

  it('is not offered by a harness that does not say so', async () => {
    routes['/api/auth/methods'] = () => json({ github_device: true, bearer_required: true });
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });
});
