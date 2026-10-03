/** @vitest-environment happy-dom */
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Conversation, ConversationItem } from '../src/components/chat/conversation';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The transcript's rows, which the scroller reads. Two rules are easy to break
 * from outside the component: an operator turn is the only anchor (it is what a
 * sent message scrolls to), and rows are drawn in full — the primitive's
 * off-screen placeholders made the opening jump miss by the height of a long
 * reply.
 */

afterEach(cleanup);

function mount(rows: Array<{ id: string; anchor?: boolean }>) {
  return render(
    <TooltipProvider>
      <ShellProvider value={{ threadId: 't', streaming: true } as unknown as ShellValue}>
        <Conversation lastAnchorId="turn-0">
          {rows.map((r) => (
            <ConversationItem key={r.id} id={r.id} anchor={r.anchor}>
              {r.id}
            </ConversationItem>
          ))}
        </Conversation>
      </ShellProvider>
    </TooltipProvider>,
  );
}

describe('Conversation', () => {
  it('marks operator turns as anchors and nothing else', () => {
    mount([{ id: 'turn-0', anchor: true }, { id: 'turn-1' }]);
    const rows = [...document.querySelectorAll('[data-slot=message-scroller-item]')];
    expect(
      rows.map((r) => [r.getAttribute('data-message-id'), r.getAttribute('data-scroll-anchor')]),
    ).toEqual([
      ['turn-0', 'true'],
      ['turn-1', 'false'],
    ]);
  });

  it('draws every row in full', () => {
    mount([{ id: 'turn-0', anchor: true }]);
    const row = document.querySelector('[data-slot=message-scroller-item]');
    expect(row?.className).toContain('[content-visibility:visible]');
  });

  it('names the transcript and says when a reply is still being written', () => {
    mount([{ id: 'turn-0', anchor: true }]);
    expect(document.querySelector('[aria-label="Transcript"]')).not.toBeNull();
    expect(
      document.querySelector('[data-slot=message-scroller-content]')?.getAttribute('aria-busy'),
    ).toBe('true');
  });
});
