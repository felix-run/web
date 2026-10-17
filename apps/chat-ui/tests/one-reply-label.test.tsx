// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * One reply, one "Felix".
 *
 * The session log keeps each model message as its own event, and a message that said
 * something *and* called a tool stays its own turn when the thread is rebuilt — so a reply
 * that ran a tool and then said "Done." drew two assistant groups, each under its own label,
 * as if Felix had answered twice. The rows stay one per turn (the scroller names them by
 * position, and only an operator turn is an anchor); the label is what goes.
 */

const THREAD = 'one-label-thread';

const snapshot = {
  id: `default:${THREAD}`,
  leafId: 'a3',
  transcript: [
    { id: 'u1', seq: 1, kind: 'message', role: 'user', content: 'write notes', metadata: {} },
    {
      id: 'a1',
      seq: 2,
      kind: 'message',
      role: 'assistant',
      content: 'Writing it now.',
      toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '1+1' } }],
      metadata: { parent_id: 'u1' },
    },
    {
      id: 't1',
      seq: 3,
      kind: 'tool_result',
      role: 'tool',
      content: '2',
      toolCallId: 'c1',
      toolName: 'calculator',
      metadata: { parent_id: 'a1' },
    },
    {
      id: 'a2',
      seq: 4,
      kind: 'message',
      role: 'assistant',
      content: 'Done.',
      metadata: { parent_id: 't1' },
    },
    {
      id: 'u2',
      seq: 5,
      kind: 'message',
      role: 'user',
      content: 'thanks',
      metadata: { parent_id: 'a2' },
    },
    {
      id: 'a3',
      seq: 6,
      kind: 'message',
      role: 'assistant',
      content: 'Any time.',
      metadata: { parent_id: 'u2' },
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith(`/chat/sessions/${THREAD}`))
        return new Response(JSON.stringify(snapshot), { status: 200 });
      if (url.includes('/chat/sessions'))
        return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
      if (url.includes('/approvals'))
        return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const transcript = () => document.querySelector('[aria-label="Transcript"]') as HTMLElement;
const labels = () =>
  [...transcript().querySelectorAll('span')].filter((s) => s.textContent === 'Felix');

describe('a reply that ran a tool and then answered', () => {
  it('is drawn under one label, each turn still its own row', async () => {
    render(
      <MemoryRouter initialEntries={[`/t/${THREAD}`]}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(transcript()?.textContent).toContain('Any time.'));
    expect(transcript().textContent).toContain('Writing it now.');
    expect(transcript().textContent).toContain('Done.');

    // Two replies, two labels: "Writing it now." + "Done." is one of them.
    expect(labels()).toHaveLength(2);
    expect(transcript().querySelectorAll('[data-continues]')).toHaveLength(1);

    // The rows are unchanged: one per turn, named by position, anchored on the operator's.
    const rows = [...transcript().querySelectorAll('[data-slot=message-scroller-item]')];
    expect(rows.map((r) => r.getAttribute('data-message-id'))).toEqual([
      'turn-0',
      'turn-1',
      'turn-2',
      'turn-3',
      'turn-4',
    ]);
    expect(rows.map((r) => r.getAttribute('data-scroll-anchor'))).toEqual([
      'true',
      'false',
      'false',
      'true',
      'false',
    ]);
  });
});
