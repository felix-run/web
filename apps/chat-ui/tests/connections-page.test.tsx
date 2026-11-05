/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeConnectReturn } from '../src/lib/connect-return';

/**
 * Connecting a person's accounts. Two things are pinned above the rest: the Google return is
 * finished exactly once, because its cookie works once, and a credential typed here does not
 * outlive the attempt to send it.
 */

class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const row = (over: Record<string, unknown> = {}) => ({
  provider: 'google',
  account: 'a1',
  label: 'me@example.com',
  kind: 'oauth',
  status: 'active',
  scopes: [],
  created_at: 1,
  updated_at: 1,
  ...over,
});
const GOOGLE = {
  provider: 'google',
  label: 'Google',
  method: 'oauth',
  scopes: ['calendar_read', 'gmail_read'],
};
const ICLOUD = { provider: 'icloud', label: 'iCloud', method: 'app_password', scopes: [] };
const FEED = { provider: 'ics', label: 'Calendar feed', method: 'feed_link', scopes: [] };

async function page(over: Record<string, unknown> = {}, strict = false) {
  const fns = {
    RepoRouteError: Refused,
    listConnections: vi.fn().mockResolvedValue([]),
    listConnectProviders: vi.fn().mockResolvedValue([GOOGLE, ICLOUD, FEED]),
    listTenantConnections: vi.fn().mockRejectedValue(new Refused(403, 'forbidden', 'no')),
    removeConnection: vi.fn().mockResolvedValue(undefined),
    revokeTenantConnection: vi.fn().mockResolvedValue(undefined),
    startGoogleConnect: vi.fn().mockResolvedValue('https://accounts.example/consent'),
    finishGoogleConnect: vi.fn().mockResolvedValue(row()),
    connectICloud: vi.fn().mockResolvedValue(row({ provider: 'icloud', label: 'me@icloud.com' })),
    connectFeed: vi.fn().mockResolvedValue(row({ provider: 'ics', label: 'Work' })),
    ...over,
  };
  vi.doMock('../src/api', () => fns);
  const { ConnectionsPage } = await import('../src/components/harness/connections');
  const tree = (
    <MemoryRouter>
      <ConnectionsPage docs="https://docs.example/" />
    </MemoryRouter>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return fns;
}

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState(null, '', '/harness/connections');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('what can be connected', () => {
  it('draws what the deployment offers, and leaves out a method it does not know', async () => {
    await page({
      listConnectProviders: vi
        .fn()
        .mockResolvedValue([ICLOUD, { provider: 'x', label: 'Mystery', method: 'qr', scopes: [] }]),
    });
    expect(await screen.findByLabelText('App-specific password')).toBeTruthy();
    expect(screen.queryByText('Mystery')).toBeNull();
  });

  it('says so when nothing is on offer', async () => {
    await page({ listConnectProviders: vi.fn().mockResolvedValue([]) });
    expect(await screen.findByText('This deployment offers nothing to connect.')).toBeTruthy();
  });

  it('says a harness is too old rather than offering flows it may not have', async () => {
    await page({ listConnectProviders: vi.fn().mockResolvedValue(null) });
    expect(await screen.findByText(/older than this page/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect' })).toBeNull();
  });
});

describe('connecting Google', () => {
  it('asks for nothing until a person chooses, then only what they chose', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const fns = await page();
    const connect = (await screen.findByRole('button', {
      name: 'Connect Google',
    })) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Read your calendar'));
    fireEvent.click(connect);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.example/consent'));
    expect(fns.startGoogleConnect).toHaveBeenCalledWith(expect.any(String), ['calendar_read']);
    expect(fns.startGoogleConnect.mock.calls[0]?.[0]).toMatch(/\/harness\/connections$/);
  });

  it('finishes the return exactly once under StrictMode, and clears it from the address', async () => {
    window.history.replaceState(null, '', '/harness/connections#felix_connect=pending');
    const fns = await page({}, true);
    expect(await screen.findByText('Connected me@example.com.')).toBeTruthy();
    expect(fns.finishGoogleConnect).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('says what went wrong on a refused return, and finishes nothing', async () => {
    window.history.replaceState(null, '', '/harness/connections#felix_connect_error=access_denied');
    const fns = await page();
    expect(await screen.findByText(/You declined at Google/)).toBeTruthy();
    expect(fns.finishGoogleConnect).not.toHaveBeenCalled();
  });

  it('says the harness refused to keep it', async () => {
    window.history.replaceState(null, '', '/harness/connections#felix_connect=pending');
    await page({
      finishGoogleConnect: vi
        .fn()
        .mockRejectedValue(new Refused(403, 'not_your_connection', 'start connecting again')),
    });
    expect(await screen.findByText('start connecting again')).toBeTruthy();
  });
});

describe('a credential typed here', () => {
  async function fill(password = 'abcd-efgh-ijkl-mnop') {
    fireEvent.change(await screen.findByLabelText('Apple ID'), {
      target: { value: 'me@icloud.com' },
    });
    const secret = screen.getByLabelText('App-specific password') as HTMLInputElement;
    fireEvent.change(secret, { target: { value: password } });
    return secret;
  }
  const submit = () =>
    fireEvent.submit(
      (screen.getByLabelText('App-specific password') as HTMLInputElement).form as HTMLFormElement,
    );

  it('is a masked field that nothing offers to remember', async () => {
    await page();
    const secret = await fill();
    expect(secret.type).toBe('password');
    expect(secret.getAttribute('autocomplete')).toBe('off');
  });

  it('is sent once and gone from the form', async () => {
    const fns = await page();
    const secret = await fill();
    submit();
    await waitFor(() => expect(fns.connectICloud).toHaveBeenCalledTimes(1));
    expect(fns.connectICloud).toHaveBeenCalledWith('me@icloud.com', 'abcd-efgh-ijkl-mnop');
    expect(secret.value).toBe('');
    expect(await screen.findByText('Connected me@icloud.com.')).toBeTruthy();
  });

  it('is cleared when refused too, and the refusal is the harness’s own words', async () => {
    await page({
      connectICloud: vi
        .fn()
        .mockRejectedValue(new Refused(400, 'app_password_refused', 'Apple did not accept this')),
    });
    const secret = await fill();
    submit();
    expect(await screen.findByText('Apple did not accept this')).toBeTruthy();
    expect(secret.value).toBe('');
    expect(document.body.textContent).not.toContain('abcd-efgh-ijkl-mnop');
  });

  it('never reaches the address or browser storage', async () => {
    await page();
    const secret = await fill();
    submit();
    await waitFor(() => expect(secret.value).toBe(''));
    expect(window.location.href).not.toContain('abcd');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('abcd');
  });
});

describe('your connections', () => {
  it('lists them, says which stopped working, and disconnects after asking', async () => {
    const fns = await page({
      listConnections: vi.fn().mockResolvedValue([row({ status: 'revoked' })]),
    });
    expect(await screen.findByText('stopped working')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(fns.removeConnection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect me@example.com' }));
    await waitFor(() => expect(fns.removeConnection).toHaveBeenCalledWith('google', 'a1'));
  });
});

describe('everyone’s connections', () => {
  it('is not there for someone without the scope', async () => {
    await page();
    await screen.findByRole('heading', { name: 'Yours' });
    expect(screen.queryByText('Everyone’s connections')).toBeNull();
  });

  it('names the person without the issuer, and revokes the row asked for', async () => {
    const person = 'felix-self|github:42';
    const fns = await page({
      listTenantConnections: vi.fn().mockResolvedValue([row({ person })]),
    });
    expect(await screen.findByText('github:42')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke me@example.com' }));
    await waitFor(() =>
      expect(fns.revokeTenantConnection).toHaveBeenCalledWith(person, 'google', 'a1'),
    );
  });
});

describe('the return in the address', () => {
  it('is taken once', () => {
    window.history.replaceState(null, '', '/x#felix_connect=pending');
    expect(takeConnectReturn()).toEqual({ kind: 'pending' });
    expect(takeConnectReturn()).toBeNull();
  });

  it('leaves any other fragment alone', () => {
    window.history.replaceState(null, '', '/x#section');
    expect(takeConnectReturn()).toBeNull();
    expect(window.location.hash).toBe('#section');
  });

  it('keeps the router’s history state', () => {
    window.history.replaceState({ key: 'k' }, '', '/x#felix_connect_error=access_denied');
    takeConnectReturn();
    expect(window.history.state).toEqual({ key: 'k' });
  });
});
