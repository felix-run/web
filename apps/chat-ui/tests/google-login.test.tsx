/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountChip } from '../src/components/account-chip';
import { Gate } from '../src/components/gate';
import { getSession, setRelockHandler, setSession, signOut } from '../src/lib/auth';

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
let methods: Array<string | undefined>;
let assigned: string[];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  methods = [];
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
      methods.push(init?.method);
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
  it('takes focus when a person switches back to it from the key', async () => {
    routes['/api/v1/models'] = () => json({ error: 'unauthorized', gate: 'chat_key' }, 401);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /use an access key instead/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sign in with google instead/i }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /continue with google/i }),
      ),
    );
  });

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
    expect(getSession()).toMatchObject({ token: 'felix-jwt', tenant: 'kids', provider: 'google' });
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

describe('the account chip, for a Google session', () => {
  const googleSession = (msLeft: number) => ({
    token: 'felix-jwt',
    expiresAt: Date.now() + msLeft,
    login: '',
    tenant: 'kids',
    scopes: [],
    provider: 'google' as const,
  });

  it('renews by going to Google and back, not with a GitHub code', async () => {
    window.history.replaceState(null, '', '/t/abc');
    setSession(googleSession(5 * 60_000));
    render(<AccountChip />);
    fireEvent.click(screen.getByRole('button', { name: /signed in as kids/i }));
    expect(await screen.findByText(/goes to Google and brings you back/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^sign in again$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    const target = new URL(assigned[0] as string, window.location.origin);
    expect(target.pathname).toBe('/api/auth/google/authorize');
    expect(target.searchParams.get('return_to')).toBe(`${window.location.origin}/t/abc`);
    expect(calls).not.toContain('/api/auth/github/device');
    // The return collects from Google's exchange: the renewal said where it went.
    expect(sessionStorage.getItem('felix.signInProvider')).toBe('google');
  });

  it('asks about no GitHub connection, and signs out without forgetting one', async () => {
    setSession(googleSession(3_600_000));
    const relock = vi.fn();
    setRelockHandler(relock);
    render(<AccountChip />);
    fireEvent.click(screen.getByRole('button', { name: /signed in as kids/i }));
    expect(await screen.findByText(/is still honoured until/i)).toBeTruthy();
    expect(screen.queryByText(/the GitHub connection Felix holds/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(relock).toHaveBeenCalledWith({ cause: 'signed-out' }));
    expect(getSession()).toBeNull();
    expect(calls).not.toContain('/api/github/connection');
    expect(methods).not.toContain('DELETE');
  });

  it('keeps a session stored before Google sign-in on GitHub renewal', async () => {
    const { provider: _, ...older } = googleSession(5 * 60_000);
    setSession({ ...older, login: 'octo', tenant: 'acme' });
    render(<AccountChip />);
    fireEvent.click(screen.getByRole('button', { name: /signed in as @octo/i }));
    expect(await screen.findByRole('button', { name: /^sign in again$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });
});

describe('the "Last used" badge', () => {
  const BOTH = () =>
    json({
      github_device: true,
      github_redirect: true,
      google_redirect: true,
      bearer_required: true,
    });
  const button = (name: RegExp) => screen.getByRole('button', { name });

  it('marks nothing on a browser that has never signed in', async () => {
    routes['/api/auth/methods'] = BOTH;
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(screen.getByText(/sign in with github or google/i)).toBeTruthy();
    expect(screen.queryByText('Last used')).toBeNull();
  });

  it('marks Google, and leads with it, after a Google sign-in this browser signed out of', async () => {
    routes['/api/auth/methods'] = BOTH;
    setSession({
      token: 'old',
      expiresAt: Date.now() + 1000,
      login: '',
      tenant: 'kids',
      scopes: [],
      provider: 'google',
    });
    signOut();
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(button(/continue with google/i).textContent).toContain('Last used');
    expect(button(/continue with github/i).textContent).not.toContain('Last used');
    expect(button(/continue with google/i).getAttribute('data-variant')).toBe('default');
    expect(button(/continue with github/i).getAttribute('data-variant')).toBe('outline');
  });

  it('marks GitHub after a GitHub sign-in, including one stored before providers were recorded', async () => {
    routes['/api/auth/methods'] = BOTH;
    setSession({
      token: 'old',
      expiresAt: Date.now() + 1000,
      login: 'octo',
      tenant: 'acme',
      scopes: [],
    });
    signOut();
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(button(/continue with github/i).textContent).toContain('Last used');
    expect(button(/continue with google/i).textContent).not.toContain('Last used');
  });

  it('is not drawn where there is only one way in', async () => {
    setSession({
      token: 'old',
      expiresAt: Date.now() + 1000,
      login: '',
      tenant: 'kids',
      scopes: [],
      provider: 'google',
    });
    signOut();
    renderGate();
    await screen.findByRole('button', { name: /continue with google/i });
    expect(screen.queryByText('Last used')).toBeNull();
  });

  it('is recorded by the sign-in itself, on the way back from Google', async () => {
    routes['/api/auth/methods'] = BOTH;
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    cleanup();
    window.history.replaceState(null, '', '/#felix_login=ok');
    renderGate();
    await screen.findByText('chat is open');
    expect(localStorage.getItem('felix.lastSignInProvider')).toBe('google');
  });
});

describe("a Google session's profile", () => {
  const PIC = 'https://lh3.googleusercontent.com/a/ACg8oc=s96-c';

  it('is kept from the sign-in, for the chip to show', async () => {
    routes['/api/auth/google/exchange'] = () =>
      json({ ...TOKEN, email: 'jade@example.com', name: 'Jade Bauman', picture: PIC });
    sessionStorage.setItem('felix.signInProvider', 'google');
    window.history.replaceState(null, '', '/#felix_login=ok');
    renderGate();
    await screen.findByText('chat is open');
    expect(getSession()).toMatchObject({
      email: 'jade@example.com',
      name: 'Jade Bauman',
      picture: PIC,
    });
  });

  it('names the person, by first name on the chip and in full with their email inside', async () => {
    setSession({
      token: 'felix-jwt',
      expiresAt: Date.now() + 3_600_000,
      login: '',
      tenant: 'kids',
      scopes: [],
      provider: 'google',
      email: 'jade@example.com',
      name: 'Jade Bauman',
      picture: PIC,
    });
    render(<AccountChip />);
    const chip = screen.getByRole('button', { name: 'Signed in as Jade Bauman' });
    expect(chip.textContent).toContain('Jade');
    expect(chip.textContent).not.toContain('Bauman');
    fireEvent.click(chip);
    expect(await screen.findByText('jade@example.com')).toBeTruthy();
  });

  it('falls back to the email, then the tenant, when Google withheld the name', () => {
    setSession({
      token: 't',
      expiresAt: Date.now() + 3_600_000,
      login: '',
      tenant: 'kids',
      scopes: [],
      provider: 'google',
      email: 'jade@example.com',
    });
    render(<AccountChip />);
    expect(screen.getByRole('button', { name: 'Signed in as jade@example.com' })).toBeTruthy();
  });

  it('drops a stored picture that is not on Google’s image host', () => {
    for (const bad of [
      'http://lh3.googleusercontent.com/a',
      'https://evil.example.com/a.googleusercontent.com',
      'https://lh3.googleusercontent.com@evil.example.com/a',
      'javascript:alert(1)',
    ]) {
      localStorage.setItem(
        'felix.session',
        JSON.stringify({
          token: 't',
          expiresAt: Date.now() + 60_000,
          tenant: 'kids',
          provider: 'google',
          picture: bad,
        }),
      );
      expect(getSession()?.picture).toBeUndefined();
    }
  });
});
