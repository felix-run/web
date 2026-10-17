/** @vitest-environment happy-dom */
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render } from '@testing-library/react';
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

function tree(
  rows: Array<{ id: string; anchor?: boolean }>,
  { view = 'everyday', lastAnchorId = 'turn-0' }: { view?: string; lastAnchorId?: string } = {},
) {
  return (
    <TooltipProvider>
      <ShellProvider value={{ threadId: 't', streaming: true, view } as unknown as ShellValue}>
        <Conversation {...(lastAnchorId ? { lastAnchorId } : {})}>
          {rows.map((r) => (
            <ConversationItem key={r.id} id={r.id} anchor={r.anchor}>
              {r.id}
            </ConversationItem>
          ))}
        </Conversation>
      </ShellProvider>
    </TooltipProvider>
  );
}

function mount(rows: Array<{ id: string; anchor?: boolean }>) {
  return render(tree(rows));
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

/** A rect whose top is read from `top()` at call time, so a test can move a row. */
function placeAt(el: Element, top: () => number, height = 400) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ top: top(), bottom: top() + height, left: 0, right: 800, width: 800, height }) as DOMRect;
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

  it("turns off the browser's scroll anchoring, which fought the scroller's", () => {
    mount([{ id: 'turn-0', anchor: true }]);
    const viewport = document.querySelector('[data-slot=message-scroller-viewport]');
    expect(viewport?.className).toContain('[overflow-anchor:none]');
  });

  it('gives the jump to the latest reply a strip of its own, never a place over the transcript', () => {
    mount([{ id: 'turn-0', anchor: true }]);
    const button = document.querySelector('[data-slot=message-scroller-button]');
    const strip = button?.parentElement;
    expect(strip?.getAttribute('data-slot')).toBe('conversation-jump');
    expect(strip?.className).toContain('h-10');
    // Beside the viewport, not inside it: nothing it covers can be a message.
    expect(
      document.querySelector('[data-slot=message-scroller-viewport]')?.contains(button ?? null),
    ).toBe(false);
    cleanup();
    // An empty thread has nothing to jump to and keeps its greeting on the composer.
    render(tree([], { lastAnchorId: '' }));
    expect(document.querySelector('[data-slot=conversation-jump]')?.className).toContain('h-0');
  });

  it('keeps the reader on the same row when the view changes the height above it', async () => {
    const rows = [{ id: 'turn-0', anchor: true }, { id: 'turn-1' }];
    const { rerender } = render(tree(rows));
    const viewport = document.querySelector('[data-slot=message-scroller-viewport]') as HTMLElement;
    const [first, second] = [...document.querySelectorAll('[data-message-id]')];
    let above = 0;
    placeAt(viewport, () => 0, 600);
    placeAt(first as Element, () => -400 + above);
    // The row being read starts 20px under the viewport's top…
    placeAt(second as Element, () => 20 + above);
    await act(frame);
    await act(frame);
    // …until debug draws 300px more above it.
    above = 300;
    rerender(tree(rows, { view: 'debug' }));
    expect(viewport.scrollTop).toBe(300);
  });
});
