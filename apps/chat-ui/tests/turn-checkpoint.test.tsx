// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMeter, contextFill } from '../src/components/chat/context-meter';
import { TurnCheckpoint } from '../src/components/chat/turn-checkpoint';
import type { Turn } from '../src/types';

afterEach(cleanup);

describe('the checkpoint after a labelled turn', () => {
  it('names the label and rewinds to the turn on Restore', async () => {
    const onRestore = vi.fn();
    render(
      <TooltipProvider>
        <TurnCheckpoint label="known good" onRestore={onRestore} />
      </TooltipProvider>,
    );
    expect(screen.getByText('known good')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restore to known good' }));
    expect(onRestore).toHaveBeenCalledOnce();
  });
});

describe('the context breakdown', () => {
  const turns: Turn[] = [
    {
      id: 'a1',
      role: 'assistant',
      content: 'ok',
      contextTokens: 50_000,
      usage: { input: 1_000, cacheRead: 40_000, output: 500 },
    },
  ];

  it("carries the reply's spend alongside the window figure", () => {
    expect(contextFill(turns, 200_000)?.usage).toEqual(turns[0]?.usage);
  });

  /**
   * `input` is the *uncached* prompt only; the breakdown's input is the whole
   * prompt, with the cached part beside it — and no price, since the harness
   * prices calls itself and a second catalog would disagree with the Activity page.
   */
  it('opens from the meter with input, cache and output, and no price', async () => {
    const usage = turns[0]?.usage;
    render(<ContextMeter used={50_000} window={200_000} {...(usage ? { usage } : {})} />);
    await userEvent.hover(screen.getByRole('meter', { name: 'Context window used' }));
    expect(await screen.findByText('41K')).toBeTruthy();
    expect(screen.getByText('40K')).toBeTruthy();
    expect(screen.getByText('500')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });
});
