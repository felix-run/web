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

  it('sends the chosen option only on Send answer, never on choosing it', () => {
    const onRespond = vi.fn();
    const select: PendingUiRequest = {
      requestId: 'r3',
      threadId: 't1',
      kind: 'select',
      prompt: 'Which environment?',
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' },
      ],
    };
    render(
      <UiPromptBanner
        pending={select}
        resolving={false}
        onRespond={onRespond}
        onCancel={vi.fn()}
      />,
    );
    // A radio group moves its selection on an arrow key; choosing must not answer.
    fireEvent.click(screen.getByRole('radio', { name: /Production/ }));
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onRespond).toHaveBeenCalledWith('prod');
  });

  it('sends what was typed', () => {
    const onRespond = vi.fn();
    render(
      <UiPromptBanner pending={input} resolving={false} onRespond={onRespond} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Which branch?' }), {
      target: { value: 'release/0.9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onRespond).toHaveBeenCalledWith('release/0.9');
  });

  it('keeps confirm as two immediate answers', () => {
    const onRespond = vi.fn();
    render(
      <UiPromptBanner
        pending={confirm}
        resolving={false}
        onRespond={onRespond}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onRespond).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull();
  });
});
