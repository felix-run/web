/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountChip } from '../src/components/account-chip';
import { Gate } from '../src/components/gate';
import {
  authHeaders,
  getApiKey,
  getSession,
  handleUnauthorized,
  setApiKey,
  setRelockHandler,
  setSession,
} from '../src/lib/auth';

/**
 * GitHub sign-in, at the wire. The device flow is a loop against a person who is
 * somewhere else: the page polls `/auth/github/token` and every answer but one
 * means "not yet". What these pin is that each answer moves the card to the
 * right place, that the session it ends with is what every request then sends,
 * and that the two ways in never ride one request together.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status });
const workerRefusal = () => json({ error: 'unauthorized', gate: 'chat_key' }, 401);
const DEVICE = {
  device_code: 'dc-1',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};
const TOKEN = {
  access_token: 'felix-jwt',
  token_type: 'Bearer',
  expires_in: 28_800,
  tenant: 'acme',
  scopes: ['chat'],
  github_login: 'octo',
};

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: Array<{ url: string; init?: RequestInit }>;

beforeEach(() => {
  localStorage.clear();
  calls = [];
  routes = {
    '/api/v1/models': (init) =>
      (init?.headers as Record<string, string> | undefined)?.authorization === 'Bearer felix-jwt'
        ? json({ data: [] })
        : workerRefusal(),
    '/api/auth/methods': () => json({ github_device: true, bearer_required: true }),
    '/api/auth/github/device': () => json(DEVICE),
    '/api/auth/github/token': () => json(TOKEN),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const handler = routes[url];
      return handler ? handler(init) : json({ error: 'not_found' }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setRelockHandler(null);
});

const tokenCalls = () => calls.filter((c) => c.url === '/api/auth/github/token');

const renderGate = () =>
  render(
    <Gate>
      <div>chat is open</div>
    </Gate>,
  );

/** Advance the poll clock, letting each fetch it starts settle. */
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('the gate, when the harness offers GitHub', () => {
  it('leads with GitHub and keeps the key one step behind it', async () => {
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(screen.queryByPlaceholderText('Access key')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /use an access key instead/i }));
    expect(screen.getByPlaceholderText('Access key')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /sign in with github instead/i }));
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeTruthy();
  });

  it('offers no key when only the harness refuses', async () => {
    routes['/api/v1/models'] = () => json({ error: 'unauthorized' }, 401);
    renderGate();
    await screen.findByRole('button', { name: /continue with github/i });
    expect(screen.queryByText(/access key/i)).toBeNull();
  });

  it('falls back to the key alone on a harness with no /auth/methods', async () => {
    delete routes['/api/auth/methods'];
    renderGate();
    await screen.findByPlaceholderText('Access key');
    expect(screen.queryByText(/github/i)).toBeNull();
  });

  it('signs in through the device flow and opens on the bearer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setApiKey('old-shared-key');
    // The stored key is stale; GitHub is how this person gets in now.
    let pending = 2;
    routes['/api/auth/github/token'] = () =>
      pending-- > 0
        ? json({ error: 'authorization_pending', message: 'pending', interval: 5 }, 428)
        : json(TOKEN);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));

    await screen.findByText('WDJB-MJHT');
    expect(screen.getByRole('link', { name: /open github/i }).getAttribute('href')).toBe(
      DEVICE.verification_uri,
    );
    expect(screen.getByText(/waiting for you to approve/i)).toBeTruthy();

    // Nothing is asked before the interval GitHub set.
    await tick(4_900);
    expect(tokenCalls()).toHaveLength(0);
    await tick(100);
    expect(tokenCalls()).toHaveLength(1);
    await tick(5_000);
    await tick(5_000);
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());

    expect(tokenCalls()).toHaveLength(3);
    expect(JSON.parse(String(tokenCalls()[0]?.init?.body))).toEqual({ device_code: 'dc-1' });
    const session = getSession();
    expect(session).toMatchObject({ token: 'felix-jwt', login: 'octo', tenant: 'acme' });
    // One credential, never both: the Worker would honour the key and drop the person.
    expect(getApiKey()).toBeNull();
    expect(authHeaders()).toEqual({ authorization: 'Bearer felix-jwt' });
  });

  it('backs off when GitHub says slow down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer = 0;
    routes['/api/auth/github/token'] = () =>
      answer++ === 0
        ? json({ error: 'slow_down', message: 'slow', interval: 10 }, 428)
        : json({ error: 'authorization_pending', message: 'pending' }, 428);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    await screen.findByText('WDJB-MJHT');
    await tick(5_000);
    expect(tokenCalls()).toHaveLength(1);
    await tick(9_900);
    expect(tokenCalls()).toHaveLength(1);
    await tick(100);
    expect(tokenCalls()).toHaveLength(2);
  });

  // The harness says `tenant_ambiguous` only after GitHub approved, and a code
  // is single-use — so the choice starts a second flow, carrying the tenant.
  it('asks which tenant, starts again with it, and remembers the choice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes['/api/auth/github/token'] = (init) => {
      const body = JSON.parse(String(init?.body)) as { tenant?: string };
      return body.tenant
        ? json({ ...TOKEN, tenant: body.tenant })
        : json({ error: 'tenant_ambiguous', message: 'pick', tenants: ['acme', 'globex'] }, 409);
    };
    // Locked to start with: the uncredentialed probe is refused, later ones are not.
    let first = true;
    routes['/api/v1/models'] = (init) => {
      if (first && !(init?.headers as Record<string, string>)?.authorization) {
        first = false;
        return workerRefusal();
      }
      return json({ data: [] });
    };
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    await screen.findByText('WDJB-MJHT');
    await tick(5_000);
    fireEvent.click(await screen.findByRole('button', { name: 'globex' }));
    await screen.findByText('WDJB-MJHT');
    await tick(5_000);
    await waitFor(() => expect(screen.getByText('chat is open')).toBeTruthy());

    expect(calls.filter((c) => c.url === '/api/auth/github/device')).toHaveLength(2);
    expect(JSON.parse(String(tokenCalls().at(-1)?.init?.body))).toEqual({
      device_code: 'dc-1',
      tenant: 'globex',
    });
    expect(getSession()?.tenant).toBe('globex');
    expect(localStorage.getItem('felix.githubTenant')).toBe('globex');
  });

  it('says whose problem a refusal is, and offers a retry only when one could help', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes['/api/auth/github/token'] = () => json({ error: 'not_a_member', message: 'no' }, 403);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    await screen.findByText('WDJB-MJHT');
    await tick(5_000);
    await screen.findByText(/not in an organization this deployment admits/i);
    expect(screen.getByRole('button', { name: /try another account/i })).toBeTruthy();
  });

  it('names the refused account when an invite-only harness turns it away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes['/api/auth/github/token'] = () =>
      json({ error: 'not_invited', message: 'no', github_login: 'octo' }, 403);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    await screen.findByText('WDJB-MJHT');
    await tick(5_000);
    await screen.findByText(/The GitHub account octo isn’t on the invite list/);
    expect(screen.getByRole('button', { name: /try another account/i })).toBeTruthy();
  });

  it('says how an invite-only harness admits people before anyone signs in', async () => {
    routes['/api/auth/methods'] = () =>
      json({ github_device: true, bearer_required: true, github_signup: 'invite' });
    renderGate();
    await screen.findByText('Sign in with GitHub. Felix is invite-only for now.');
    expect(screen.getByText(/an invited account gets a tenant of its own/)).toBeTruthy();
  });

  it('keeps the organization wording on a harness that admits only its organizations', async () => {
    renderGate();
    await screen.findByText('Sign in with the GitHub account your organization uses.');
    expect(screen.queryByText(/invite-only/)).toBeNull();
  });

  it('has nothing to retry when the harness is misconfigured', async () => {
    routes['/api/auth/github/device'] = () =>
      json({ error: 'github_config_error', message: 'misconfigured' }, 503);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    await screen.findByText(/misconfigured on the harness/i);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('does not send an expired session, and says it ended', async () => {
    setSession({
      token: 'old',
      expiresAt: Date.now() - 1,
      login: 'octo',
      tenant: 'acme',
      scopes: [],
    });
    renderGate();
    await screen.findByText(/your github sign-in has ended/i);
    expect(calls.some((c) => JSON.stringify(c.init?.headers ?? {}).includes('Bearer old'))).toBe(
      false,
    );
    expect(getSession()).toBeNull();
  });

  it('comes back with the sign-in message when a request is refused mid-session', async () => {
    setSession({
      token: 'felix-jwt',
      expiresAt: Date.now() + 3_600_000,
      login: 'octo',
      tenant: 'acme',
      scopes: [],
    });
    renderGate();
    await screen.findByText('chat is open');
    act(() => handleUnauthorized());
    await screen.findByText(/your github sign-in has ended/i);
    expect(getSession()).toBeNull();
  });
});

describe('the account chip', () => {
  const session = (msLeft: number) => ({
    token: 'felix-jwt',
    expiresAt: Date.now() + msLeft,
    login: 'octo',
    tenant: 'acme',
    scopes: ['chat'],
  });

  it('names no one under the shared key', () => {
    setApiKey('shared');
    const { container } = render(<AccountChip />);
    expect(container.innerHTML).toBe('');
  });

  it('shows who is signed in, quietly, until the session is ending', () => {
    setSession(session(3_600_000));
    render(<AccountChip />);
    const chip = screen.getByRole('button', { name: 'Signed in as @octo' });
    expect(chip.textContent).toContain('octo');
    expect(chip.textContent).not.toMatch(/\dm$/);
  });

  it('counts down in the last fifteen minutes', () => {
    setSession(session(12 * 60_000));
    render(<AccountChip />);
    expect(
      screen.getByRole('button', { name: 'Signed in as @octo, session ends in 12 min' }),
    ).toBeTruthy();
  });

  it('signs out to the gate without claiming the token is cancelled', async () => {
    setSession(session(3_600_000));
    const relock = vi.fn();
    setRelockHandler(relock);
    render(<AccountChip />);
    fireEvent.click(screen.getByRole('button', { name: /signed in as/i }));
    expect(await screen.findByText(/is still honoured until/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(relock).toHaveBeenCalledWith({ cause: 'signed-out' }));
    expect(getSession()).toBeNull();
    // Leaving also forgets the GitHub connection the harness holds, asked with this session's
    // own bearer while it still had one.
    const forgot = calls.find(
      (c) => c.url === '/api/github/connection' && c.init?.method === 'DELETE',
    );
    expect(forgot).toBeTruthy();
    expect((forgot?.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer felix-jwt',
    );
  });

  it('renews in place, replacing the token without relocking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setSession(session(5 * 60_000));
    const relock = vi.fn();
    setRelockHandler(relock);
    routes['/api/auth/github/token'] = () => json({ ...TOKEN, access_token: 'fresh' });
    render(<AccountChip />);
    fireEvent.click(screen.getByRole('button', { name: /signed in as/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sign in again/i }));
    await screen.findByText('WDJB-MJHT');
    await tick(5_000);
    await waitFor(() => expect(getSession()?.token).toBe('fresh'));
    expect(relock).not.toHaveBeenCalled();
  });
});
