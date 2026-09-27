/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiPromptBanner } from '../src/components/chat/ui-prompt-banner';
import type { PendingUiRequest } from '../src/types';

/**
 * The agent's question, and the two ways it can go wrong on screen.
 *
 * "No" and "Cancel" sat side by side while sending different things — `value:
 * false` is an answer, `cancelled: true` is the timeout's own spelling of no
 * answer at all — so the label is pinned to what the button does. And the
 * input's `autoFocus` took focus from a composer mid-sentence; it now moves
 * only when nothing is being typed.
 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const confirm: PendingUiRequest = {
  requestId: 'r1',
  threadId: 't1',
  kind: 'confirm',
  prompt: 'Overwrite it?',
  options: [],
};
const input: PendingUiRequest = {
  requestId: 'r2',
  threadId: 't1',
  kind: 'input',
  prompt: 'Which branch?',
  options: [],
};

describe('UiPromptBanner', () => {
  it('labels the cancelled answer as declining, apart from No', () => {
    const onRespond = vi.fn();
    const onCancel = vi.fn();
    render(
      <UiPromptBanner
        pending={confirm}
        resolving={false}
        onRespond={onRespond}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onRespond).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Decline to answer' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('takes focus when nothing is being typed', () => {
    render(
      <UiPromptBanner pending={input} resolving={false} onRespond={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Which branch?' }));
  });

  it('leaves focus in a field someone is typing into', () => {
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    composer.focus();
    render(
      <UiPromptBanner pending={input} resolving={false} onRespond={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(document.activeElement).toBe(composer);
  });
});
