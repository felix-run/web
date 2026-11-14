/** @vitest-environment happy-dom */
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from '../src/components/chat/message-actions';

/**
 * Which of a turn's hover actions ask first, and why.
 *
 * Regenerate resets the thread's server log and replays only the message text,
 * so the answer it replaces — and every tool result in the log — is gone, with no
 * undo. Rewind moves the active leaf and offers Undo in its toast, so it takes
 * nothing and stays one click. Both were one click; a stray click on a control
 * that only appears on hover was enough to lose a run's worth of tool output.
 */

afterEach(cleanup);

function mount(props: { onRegenerate?: () => void; onRewind?: () => void }) {
  return render(
    <TooltipProvider>
      <MessageActions content="the answer" {...props} />
    </TooltipProvider>,
  );
}

describe('Regenerate', () => {
  it('arms on the first click and fires only on the confirm', async () => {
    const onRegenerate = vi.fn();
    mount({ onRegenerate });

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }));
    expect(onRegenerate).not.toHaveBeenCalled();
    // The consequence is named where the decision is made.
    expect(screen.getByText(/tool results in it are dropped/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledTimes(1));
  });

  it('backs out with Cancel and does nothing', () => {
    const onRegenerate = vi.fn();
    mount({ onRegenerate });

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Regenerate response' })).toBeTruthy();
  });
});

describe('Rewind', () => {
  it('stays one click, because its toast can undo it', () => {
    const onRewind = vi.fn();
    mount({ onRewind });

    fireEvent.click(screen.getByRole('button', { name: 'Rewind the thread to this message' }));
    expect(onRewind).toHaveBeenCalledTimes(1);
  });
});
