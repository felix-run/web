/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountChip } from '../src/components/account-chip';
import { Gate } from '../src/components/gate';
import { GitHubPage } from '../src/components/harness/github';
import { ThreadRepoSection } from '../src/components/workspace/thread-repo';
import { getSession, setApiKey, setRelockHandler, setSession } from '../src/lib/auth';

/**
 * The GitHub App half of the browser: sign-in by redirect, the thread's repository on the harness,
 * and the connection the harness keeps for you — at the wire, through a stubbed `fetch`.
 *
 * What these pin: the redirect button goes to the harness's authorize route and comes back to this
 * page; the return collects the token once and clears the fragment so a reload cannot replay it;
 * an ambiguous membership offers a tenant per button; the repository block says nothing and asks
 * nothing under the shared key; a repository opens, clones and reports itself; and revoking is one
 * click that asks the harness.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status });
const TOKEN = {
  access_token: 'felix-jwt',
  token_type: 'Bearer',
  expires_in: 28_800,
  tenant: 'acme',
  scopes: ['chat'],
  github_login: 'octo',
};
const CONNECTION = {
  github_user_id: 42,
  github_login: 'octo',
  status: 'active',
  created_at: 1,
  updated_at: 1,
  refresh_expires_at: 0,
};

const REPOS = {
  installations: [
    { id: 7, account: 'acme', account_type: 'Organization', repository_selection: 'selected' },
  ],
  repositories: [
    {
      full_name: 'acme/docs',
      private: true,
      archived: false,
      default_branch: 'main',
      can_write: false,
      size_kb: 10,
      installation_id: 7,
    },
    {
      full_name: 'acme/widgets',
      private: true,
      archived: false,
      default_branch: 'main',
      can_write: true,
      size_kb: 12,
      installation_id: 7,
    },
  ],
  truncated: false,
  install_url: 'https://github.com/apps/felix/installations/new',
};

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: Array<{ url: string; init?: RequestInit }>;
let assigned: string[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  assigned = [];
  routes = {
    '/api/v1/models': (init) =>
      (init?.headers as Record<string, string> | undefined)?.authorization === 'Bearer felix-jwt'
        ? json({ data: [] })
        : json({ error: 'unauthorized', gate: 'chat_key' }, 401),
    '/api/auth/methods': () =>
      json({ github_device: true, github_redirect: true, bearer_required: true }),
    '/api/auth/github/exchange': () => json(TOKEN),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
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
  vi.useRealTimers();
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

const signedInAsOcto = () =>
  setSession({
    token: 'felix-jwt',
    expiresAt: Date.now() + 3_600_000,
    login: 'octo',
    tenant: 'acme',
    scopes: [],
  });

describe('sign-in by redirect', () => {
  it('sends the browser to the harness, coming back to this page', async () => {
    window.history.replaceState(null, '', '/t/abc?x=1');
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    expect(assigned).toHaveLength(1);
    const target = new URL(assigned[0] as string, window.location.origin);
    expect(target.pathname).toBe('/api/auth/github/authorize');
    expect(target.searchParams.get('return_to')).toBe(`${window.location.origin}/t/abc?x=1`);
    // No device flow was started: the redirect replaces the code.
    expect(calls.some((c) => c.url === '/api/auth/github/device')).toBe(false);
  });

  it('holds the button while the browser leaves, and lets go on a return from the cache', async () => {
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    const button = screen.getByRole('button', { name: /opening github/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    // A second click while the first is still leaving sends nothing more.
    fireEvent.click(button);
    expect(assigned).toHaveLength(1);

    act(() => {
      // happy-dom's PageTransitionEvent ignores `persisted`, so build one that carries it.
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    expect(
      (screen.getByRole('button', { name: /continue with github/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('collects the token once on the way back, and clears the fragment', async () => {
    window.history.replaceState(null, '', '/t/abc#felix_login=ok');
    renderGate();
    await screen.findByText('chat is open');
    expect(getSession()).toMatchObject({ token: 'felix-jwt', login: 'octo', tenant: 'acme' });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/t/abc');
    expect(calls.filter((c) => c.url === '/api/auth/github/exchange')).toHaveLength(1);
  });

  it('says why a sign-in came back with nothing, and clears the fragment', async () => {
    window.history.replaceState(null, '', '/#felix_login_error=not_a_member');
    renderGate();
    await screen.findByText(/not in an organization this deployment admits/i);
    expect(window.location.hash).toBe('');
    expect(calls.some((c) => c.url === '/api/auth/github/exchange')).toBe(false);
  });

  it('names the account an invite-only harness refused, from the fragment', async () => {
    window.history.replaceState(null, '', '/#felix_login_error=not_invited&login=octo');
    renderGate();
    await screen.findByText(/The GitHub account octo isn’t on the invite list/);
    expect(window.location.hash).toBe('');
  });

  it('offers a tenant per button when membership grants several', async () => {
    window.history.replaceState(
      null,
      '',
      '/#felix_login_error=tenant_ambiguous&tenants=acme,globex',
    );
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'globex' }));
    const target = new URL(assigned[0] as string, window.location.origin);
    expect(target.searchParams.get('tenant')).toBe('globex');
  });

  it('keeps the code card when the harness offers only the device flow', async () => {
    routes['/api/auth/methods'] = () =>
      json({ github_device: true, github_redirect: false, bearer_required: true });
    routes['/api/auth/github/device'] = () =>
      json({
        device_code: 'd',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    await screen.findByText('WDJB-MJHT');
    expect(assigned).toHaveLength(0);
  });
});

describe("the thread's repository on the harness", () => {
  it('says nothing and asks nothing under the shared access key', () => {
    setApiKey('shared');
    const { container } = render(<ThreadRepoSection threadId="t1" />);
    expect(container.innerHTML).toBe('');
    expect(calls).toHaveLength(0);
  });

  it('opens one of your repositories, shows the clone, then where it stands', async () => {
    signedInAsOcto();
    let state: 'none' | 'cloning' | 'ready' = 'none';
    const base = {
      repo: 'acme/widgets',
      base: 'main',
      private: true,
      opened_by: 'github:42',
      created_at: 1,
      error: null,
    };
    routes['/api/github/repos'] = () => json(REPOS);
    routes['/api/chat/sessions/t1/workspace/repo'] = (init) => {
      if (init?.method === 'POST') {
        state = 'cloning';
        return json({ ...base, state: 'cloning', branch: null, ahead: null, dirty: null }, 202);
      }
      if (state === 'none') return json({ error: 'no_repository', message: 'none' }, 404);
      if (state === 'cloning') {
        state = 'ready';
        return json({ ...base, state: 'cloning', branch: null, ahead: null, dirty: null });
      }
      return json({ ...base, state: 'ready', branch: 'main', ahead: 2, dirty: true });
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ThreadRepoSection threadId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open a repository' }));
    expect(await screen.findByText(/2 repositories the GitHub App can reach for you/)).toBeTruthy();
    expect(screen.getByText('read-only')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: /install the app on more repositories/i })
        .getAttribute('href'),
    ).toBe(REPOS.install_url);
    fireEvent.click(screen.getByRole('button', { name: /acme\/widgets/ }));
    await screen.findByText('Cloning on the harness…');
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ full_name: 'acme/widgets' });
    // Each poll schedules the next only once React has rendered the last answer, so the clock is
    // advanced until the state settles rather than a fixed number of times.
    const ready = 'main · 2 ahead · uncommitted changes';
    for (let i = 0; i < 6 && !screen.queryByText(ready); i++)
      await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.getByText(ready)).toBeTruthy();
    expect(screen.queryByText('Cloning on the harness…')).toBeNull();
  });

  it("draws the checkout's files, opened onto what git reports changed", async () => {
    signedInAsOcto();
    routes['/api/chat/sessions/t1/workspace/repo'] = () =>
      json({
        repo: 'acme/widgets',
        base: 'main',
        private: false,
        opened_by: 'github:42',
        created_at: 1,
        error: null,
        state: 'ready',
        branch: 'main',
        ahead: 0,
        dirty: true,
      });
    routes['/api/chat/sessions/t1/workspace/repo/files'] = () =>
      json({
        state: 'ready',
        truncated: true,
        files: [
          { path: 'README.md', kind: 'missing', size: null, status: 'deleted' },
          { path: 'docs/guide.md', kind: 'file', size: 10, status: 'clean' },
          { path: 'link', kind: 'symlink', size: 11, status: 'clean' },
          { path: 'src/app.py', kind: 'file', size: 9, status: 'modified' },
          { path: 'src/new.py', kind: 'file', size: 6, status: 'untracked' },
        ],
      });
    render(<ThreadRepoSection threadId="t1" />);
    const tree = await screen.findByRole('tree', { name: 'Repository files' });
    // The folder holding a change opens; the one without stays folded.
    expect(tree.textContent).toContain('app.py, modified');
    expect(tree.textContent).toContain('new.py, untracked');
    expect(tree.textContent).toContain('README.md, deleted');
    expect(tree.textContent).not.toContain('guide.md');
    expect(tree.textContent).toContain('link, symbolic link');
    // Nothing opens a checkout file, so no file is a Tab stop.
    for (const item of tree.querySelectorAll('[role="treeitem"]')) {
      if (!item.querySelector('button')) expect(item.getAttribute('tabindex')).toBe('-1');
    }
    expect(screen.getByText(/Showing the first 5 files; the repository has more/)).toBeTruthy();
  });

  it('re-reads the checkout when a run settles', async () => {
    signedInAsOcto();
    let listed = 0;
    routes['/api/chat/sessions/t1/workspace/repo'] = () =>
      json({
        repo: 'acme/widgets',
        base: 'main',
        private: false,
        opened_by: 'github:42',
        created_at: 1,
        error: null,
        state: 'ready',
        branch: 'main',
        ahead: 0,
        dirty: false,
      });
    routes['/api/chat/sessions/t1/workspace/repo/files'] = () => {
      listed++;
      return json({ state: 'ready', truncated: false, files: [] });
    };
    const { rerender } = render(<ThreadRepoSection threadId="t1" streaming={false} />);
    await screen.findByText('The repository has no files.');
    expect(listed).toBe(1);
    rerender(<ThreadRepoSection threadId="t1" streaming />);
    rerender(<ThreadRepoSection threadId="t1" streaming={false} />);
    await vi.waitFor(() => expect(listed).toBe(2));
  });

  it('turns a refusal into what to do about it', async () => {
    signedInAsOcto();
    routes['/api/chat/sessions/t1/workspace/repo'] = () =>
      json({ error: 'no_repository', message: 'none' }, 404);
    routes['/api/github/repos'] = () =>
      json(
        {
          error: 'github_connection_revoked',
          message: 'your GitHub connection stopped working; reconnect GitHub',
        },
        409,
      );
    render(<ThreadRepoSection threadId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open a repository' }));
    await screen.findByText(/sign out and sign in with GitHub again/i);
  });
});

describe('your GitHub connection', () => {
  it('can be revoked from the account chip, asking the harness', async () => {
    signedInAsOcto();
    let connected = true;
    routes['/api/github/connection'] = (init) => {
      if (init?.method === 'DELETE') {
        connected = false;
        return new Response(null, { status: 204 });
      }
      return json(
        connected
          ? {
              connected: true,
              connection: {
                github_user_id: 42,
                github_login: 'octo',
                status: 'active',
                created_at: 1,
                updated_at: 1,
                refresh_expires_at: 0,
              },
            }
          : { connected: false, connection: null },
      );
    };
    render(<AccountChip />);
    fireEvent.click(screen.getByRole('button', { name: /signed in as/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke GitHub access' }));
    await screen.findByText('Not connected to GitHub');
    expect(
      calls.some((c) => c.url === '/api/github/connection' && c.init?.method === 'DELETE'),
    ).toBe(true);
  });

  it('is shown at /harness/github with the repositories it reaches', async () => {
    signedInAsOcto();
    routes['/api/github/connection'] = () =>
      json({
        connected: true,
        connection: {
          github_user_id: 42,
          github_login: 'octo',
          status: 'active',
          created_at: 1,
          updated_at: 1,
          refresh_expires_at: 0,
        },
      });
    routes['/api/github/repos'] = () => json(REPOS);
    render(
      <MemoryRouter>
        <GitHubPage docs="https://docs.example/auth" />
      </MemoryRouter>,
    );
    await screen.findByText(/The App is installed on acme\./);
    expect(screen.getByText('2 repositories')).toBeTruthy();
    expect(screen.getByText('private · read & write')).toBeTruthy();
    expect(screen.getByText('connected as octo')).toBeTruthy();
  });

  it('asks before revoking, then forgets the repositories', async () => {
    signedInAsOcto();
    routes['/api/github/connection'] = (init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json({ connected: true, connection: CONNECTION });
    routes['/api/github/repos'] = () => json(REPOS);
    render(
      <MemoryRouter>
        <GitHubPage docs="https://docs.example/auth" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke GitHub access' }));
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await screen.findByText(/Felix holds no GitHub connection for you/);
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true);
    expect(screen.queryByText('acme/docs')).toBeNull();
  });

  it('searches the harness once a listing is truncated, since the rows it sent are not all', async () => {
    signedInAsOcto();
    routes['/api/github/connection'] = () => json({ connected: true, connection: CONNECTION });
    let listed = 0;
    const gadgets = { ...REPOS.repositories[1], full_name: 'acme/gadgets' };
    routes['/api/github/repos'] = () =>
      json(listed++ === 0 ? { ...REPOS, truncated: true } : { ...REPOS, repositories: [gadgets] });
    render(
      <MemoryRouter>
        <GitHubPage docs="https://docs.example/auth" />
      </MemoryRouter>,
    );
    fireEvent.change(
      await screen.findByRole('searchbox', { name: 'Search repositories by name' }),
      {
        target: { value: 'gadgets' },
      },
    );
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('?q=gadgets'))).toBe(true));
    // Not among the rows first sent, so only the harness's answer can put it here.
    await screen.findByText('acme/gadgets');
  });

  it('says what failed and offers to try again', async () => {
    signedInAsOcto();
    let fail = true;
    routes['/api/github/connection'] = () =>
      fail ? json({ error: 'boom' }, 500) : json({ connected: false, connection: null });
    render(
      <MemoryRouter>
        <GitHubPage docs="https://docs.example/auth" />
      </MemoryRouter>,
    );
    await screen.findByRole('alert');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Felix holds no GitHub connection for you/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('under the shared key, says a GitHub sign-in is needed rather than asking', () => {
    setApiKey('shared');
    render(
      <MemoryRouter>
        <GitHubPage docs="https://docs.example/auth" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/needs a GitHub sign-in|need a GitHub sign-in/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
