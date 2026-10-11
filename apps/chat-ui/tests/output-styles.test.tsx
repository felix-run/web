// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * Output styles (`spec.output_styles`): how the agent writes, picked per conversation. The
 * Style picker sits beside Thinking only when the selected agent declares styles, reads the
 * thread's stored one off the snapshot (a name the agent does not declare reads as its
 * default, which is what the harness runs), and sets it with `POST /chat/style` checked
 * against that agent.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function harness(stored: string | null, styles = true) {
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      }
      if (url.endsWith('/v1/models')) {
        return Response.json({
          object: 'list',
          data: [
            {
              id: 'cowork',
              felix: styles
                ? {
                    outputStyles: [
                      { name: 'terse', description: 'Short answers' },
                      { name: 'teacher', description: 'Explains as it goes' },
                    ],
                    defaultOutputStyle: 'terse',
                  }
                : { outputStyles: [] },
            },
          ],
        });
      }
      if (/\/chat\/sessions\/styled(\?|$)/.test(url)) {
        return Response.json({
          id: 'styled',
          phase: 'idle',
          transcript: [{ id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'hi' }],
          outputStyle: stored,
        });
      }
      return Response.json({ sessions: [], items: [], requests: [], events: [] });
    }),
  );
  localStorage.setItem('felix.manifest', 'cowork');
  render(
    <MemoryRouter initialEntries={['/t/styled']}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return posts;
}

describe('the Style picker', () => {
  it('shows the thread’s style, and posts another one checked against the agent', async () => {
    const posts = harness('teacher');
    const trigger = await screen.findByRole('combobox', { name: 'Style: teacher' });

    const user = userEvent.setup({ delay: null });
    await waitFor(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    // Short in the trigger; the list says which style the default is.
    expect(labels[0]).toContain('default');
    expect(labels[0]).toContain("The agent's own: terse");
    await user.click(screen.getByRole('option', { name: /^default/ }));

    await waitFor(() =>
      expect(posts.find((p) => p.url.endsWith('/chat/style'))?.body).toEqual({
        thread_id: 'styled',
        manifest: 'cowork',
        style: null,
      }),
    );
    expect(await screen.findByRole('combobox', { name: 'Style: default' })).toBeTruthy();
  });

  it('reads a stored style the agent does not declare as its default', async () => {
    harness('gone');
    expect(await screen.findByRole('combobox', { name: 'Style: default' })).toBeTruthy();
  });

  it('is not drawn for an agent with no styles', async () => {
    harness(null, false);
    await screen.findByRole('combobox', { name: /^Agent: / });
    // Asked and answered, so the absence is the answer and not the list still on its way.
    const asked = () =>
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([u]) =>
        String(u).endsWith('/v1/models'),
      );
    await waitFor(() => expect(asked()).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('combobox', { name: /^Style: / })).toBeNull();
  });
});
