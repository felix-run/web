// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_EXPLANATION,
  MultimodalInput,
  type MultimodalInputProps,
} from '../src/components/chat/multimodal-input';

/**
 * The composer's footer controls, mounted on their own rather than through `App`,
 * because what is pinned here is how they are *presented* — which control is the
 * primary action and what a keyboard or screen-reader user is told — not the
 * send path, which `composer.test.tsx` and `app-stream.test.tsx` already drive.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(props: Partial<MultimodalInputProps> = {}) {
  return render(
    <TooltipProvider>
      <MultimodalInput status="ready" isConnected onSubmit={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe('Run in background', () => {
  it('is a ghost beside a filled Send, so a send is not offered as a two-way choice', async () => {
    mount({ onBackground: vi.fn() });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByRole('textbox', { name: 'Message Felix' }), 'hello');
    const background = screen.getByRole('button', { name: 'Run in background' });
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(background.dataset.variant).toBe('ghost');
    expect(send.dataset.variant).toBe('default');
  });

  it('carries its explanation as a description, not as a hover-only title', () => {
    mount({ onBackground: vi.fn() });
    const background = screen.getByRole('button', {
      name: 'Run in background',
      description: BACKGROUND_EXPLANATION,
    });
    expect(background.getAttribute('title')).toBeNull();
  });

  it('still starts a background run with what was typed, from the keyboard', async () => {
    const onBackground = vi.fn();
    mount({ onBackground });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByRole('textbox', { name: 'Message Felix' }), 'overnight job');
    screen.getByRole('button', { name: 'Run in background' }).focus();
    await user.keyboard('{Enter}');
    expect(onBackground).toHaveBeenCalledOnce();
    expect(onBackground.mock.calls[0]?.[0]).toMatchObject({ text: 'overnight job' });
  });
});
