// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { resetPresence } from '../src/lib/presence';

/**
 * "Blocked on this thread" is one fact, and every surface has to say it.
 *
 * The attention line reads the tenant-wide `/approvals` poll, which runs always;
 * the title, the favicon, the header chip, the readout and the banner read the
 * engine's queue, which adopted rows on mount and while streaming and at no other
 * time. So the line's own route — "Open thread to review", for a write whose diff
 * only its banner can draw — landed on a thread with no banner, an Idle readout
 * and a plain title, while the line said the call was waiting on that thread.
 */

const ROW = {
  id: 'apr_1',
  tenant_id: 't',
  manifest_id: 'cowork',
  tool_name: 'write_file',
  call_signature: 'sig',
  args: { path: 'notes/today.md', content: 'hello\n' },
  principal_subj: 'operator',
  status: 'pending',
  created_at: Date.now(),
  decided_at: null,
  decided_by: '',
  decision_note: '',
  edited_args: null,
  rule_id: 'workspace-write',
  ttl_seconds: 300,
  consumed_at: null,
  thread_id: 'tenant:thread-b',
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/approvals')) {
        return new Response(
          JSON.stringify({ requests: [{ ...ROW, expires_at: Date.now() + 240_000 }] }),
          { status: 200 },
        );
      }
      if (url.includes('/chat/sessions')) {
        return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

let address = '';
function Probe() {
  address = useLocation().pathname;
  return null;
}

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Probe />
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('felix.apiKey', 'test');
  resetPresence();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the route to a write on another thread', () => {
  it('lands on a thread whose banner, title and header all say it is waiting', async () => {
    mount('/t/thread-a');
    const line = await screen.findByRole('region', { name: 'What is waiting' });
    await waitFor(() =>
      expect(within(line).getByRole('status').textContent).toContain('1 call is waiting'),
    );
    // Not here: the engine adopts this thread's rows only, so nothing else claims it.
    expect(screen.queryByRole('button', { name: 'Approve write_file' })).toBeNull();

    await userEvent.click(within(line).getByRole('button', { name: 'Review' }));
    await userEvent.click(within(line).getByRole('link', { name: /Open thread to review/ }));
    await waitFor(() => expect(address).toBe('/t/thread-b'));

    // The banner, not the line's card: the line counts it and no longer offers it.
    expect(await screen.findByRole('button', { name: 'Approve write_file' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Approve/ })).toHaveLength(1);
    await waitFor(() => expect(document.title).toContain('Approve'));
  });

  it('adopts a call the always-on poll finds for the open thread, without a reload', async () => {
    mount('/t/thread-b');
    expect(await screen.findByRole('button', { name: 'Approve write_file' })).toBeTruthy();
    await waitFor(() => expect(document.title).toContain('Approve'));
  });
});
