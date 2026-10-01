// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import {
  BACKGROUND_EXPLANATION,
  MultimodalInput,
  type MultimodalInputProps,
} from '../src/components/chat/multimodal-input';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * The composer's footer controls, mounted on their own rather than through `App`,
 * because what is pinned here is how they are *presented* — which control is the
 * primary action and what a keyboard or screen-reader user is told — not the
 * send path, which `composer.test.tsx` and `app-stream.test.tsx` already drive.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
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

describe('the agent picker', () => {
  it('draws each manifest with the provider model it runs on, in mono, in the order given', async () => {
    mount({
      models: [
        { id: 'cowork', label: 'cowork', description: 'claude-sonnet-4-5' },
        { id: 'default', label: 'default' },
      ],
      modelId: 'cowork',
      onModelChange: vi.fn(),
    });
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: /^Agent: / });
    // The trigger names the agent only; the model belongs in the list.
    expect(trigger.textContent).toBe('cowork');
    trigger.focus();
    await user.keyboard('{Enter}');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.getAttribute('data-value') ?? o.textContent)).toHaveLength(2);
    expect(options[0]?.textContent).toContain('claude-sonnet-4-5');
    expect(options[1]?.textContent).toBe('default');
    const model = screen.getByText('claude-sonnet-4-5');
    expect(model.className.split(/\s+/)).toContain('font-mono');
  });

  it('sets the manifest names in mono too, because they are the harness identifiers', async () => {
    mount({
      models: [
        { id: 'cowork', label: 'cowork', description: 'claude-sonnet-4-5' },
        { id: 'research', label: 'research' },
      ],
      modelId: 'cowork',
      onModelChange: vi.fn(),
    });
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: /^Agent: / });
    expect(trigger.className.split(/\s+/)).toContain('font-mono');
    trigger.focus();
    await user.keyboard('{Enter}');
    const name = await screen.findByText('research', { selector: '[role="option"] span' });
    expect(name.className.split(/\s+/)).toContain('font-mono');
  });

  /**
   * It was named "Choose agent", which hid the choice from anyone who could not
   * read the trigger — and the trigger now ellipsises a long name, so a sighted
   * operator may not be able to read it either. The value is in the name, the
   * way the Thinking picker's is; the visible text stays the name alone.
   */
  it('names the chosen agent in its accessible name and title, and ellipsises the label', () => {
    mount({
      models: [
        { id: 'research-assistant-long-name', label: 'research-assistant-long-name' },
        { id: 'cowork', label: 'cowork' },
      ],
      modelId: 'research-assistant-long-name',
      onModelChange: vi.fn(),
    });
    const trigger = screen.getByRole('combobox', { name: 'Agent: research-assistant-long-name' });
    expect(trigger.getAttribute('title')).toBe('Agent: research-assistant-long-name');
    expect(trigger.textContent).toBe('research-assistant-long-name');
    const label = screen.getByText('research-assistant-long-name', { selector: 'span.truncate' });
    expect(label.className.split(/\s+/)).toContain('min-w-0');
  });
});

/**
 * At 390px a long agent name's trigger painted over the microphone: the mic's
 * wrapper had `min-w-0` and shrank to 14px under its 32px button. The floor is
 * now the button's own width.
 */
describe('the microphone', () => {
  it('keeps a floor the width of its button', () => {
    class FakeRecognition {}
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    mount();
    const mic = screen.getByRole('button', { name: 'Start voice input' });
    const wrapper = mic.parentElement as HTMLElement;
    expect(wrapper.className.split(/\s+/)).toContain('min-w-8');
    expect(wrapper.className.split(/\s+/)).not.toContain('min-w-0');
  });
});

describe('the agent picker, fed by the harness', () => {
  it('shows what /v1/models says each manifest runs on', async () => {
    // The whole path: `listManifestEntries` → the shell → the workbench's options.
    // Until this, the shell kept only `id` and the picker had nothing to show.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/v1/models')) {
          return new Response(
            JSON.stringify({
              object: 'list',
              data: [
                { id: 'default', felix: { providerModel: 'gpt-5-mini' } },
                { id: 'cowork', felix: { providerModel: null } },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes('/chat/sessions')) {
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        }
        if (url.includes('/approvals')) {
          return new Response(JSON.stringify({ requests: [] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup({ delay: null });
    const trigger = await screen.findByRole('combobox', { name: /^Agent: / });
    // Two manifests means the list arrived; one would be the pre-answer fallback.
    await waitFor(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });
    const [first, second] = screen.getAllByRole('option');
    expect(first?.textContent).toBe('defaultgpt-5-mini');
    expect(second?.textContent).toBe('cowork');
  });
});

/**
 * Thinking moved out of the header's overflow menu into the composer, beside the
 * agent picker, because it is a parameter of the next send rather than a
 * preference. It was three clicks into a submenu, and the only on-screen value
 * was a `think:` badge that vanished below `sm` and at `off`.
 */
describe('the Thinking picker', () => {
  const levels = ['off', 'low', 'high'] as const;

  it('shows the level in its name and hands a choice to the caller', async () => {
    const onThinkingChange = vi.fn();
    mount({ thinkingLevels: levels, thinkingLevel: 'off', onThinkingChange });
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: 'Thinking: off' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: /^high/ }));
    expect(onThinkingChange).toHaveBeenCalledWith('high');
  });

  /**
   * Seven bare words gave no idea what a level does or when it takes effect.
   * Each option now carries a line about the mechanism, in the sans because it is
   * our sentence rather than a quotation of the harness, and the list says the
   * choice applies from the next turn.
   */
  it('describes each level, and says when a choice takes effect', async () => {
    mount({ thinkingLevels: ['off', 'high'], thinkingLevel: 'off', onThinkingChange: vi.fn() });
    const user = userEvent.setup({ delay: null });
    screen.getByRole('combobox', { name: 'Thinking: off' }).focus();
    await user.keyboard('{Enter}');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'offNo extended reasoning before the reply.',
      'highA large reasoning budget: more tokens and latency.',
    ]);
    const description = screen.getByText('No extended reasoning before the reply.');
    expect(description.className.split(/\s+/)).not.toContain('font-mono');
    const label = screen.getByText('Applies from the next turn');
    // A label, not a choice: nothing a click or arrow key can land on.
    expect(label.closest('[role="option"]')).toBeNull();
    await user.keyboard('{Escape}');
  });

  it('is absent when the caller supplies no levels', () => {
    mount();
    expect(screen.queryByRole('combobox', { name: /^Thinking/ })).toBeNull();
  });

  it('sets the level on the harness, and the header carries neither it nor a theme toggle', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/chat/thinking')) {
          posted.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response('{}', { status: 200 });
        }
        if (url.includes('/chat/sessions')) {
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        }
        if (url.includes('/approvals')) {
          return new Response(JSON.stringify({ requests: [] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/t/thinking-thread']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup({ delay: null });
    const trigger = await screen.findByRole('combobox', { name: 'Thinking: off' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: /^high/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ thread_id: 'thinking-thread', thinking_level: 'high' });
    // The picker carries the value afterwards; there is no second copy in the header.
    await screen.findByRole('combobox', { name: 'Thinking: high' });
    const header = document.querySelector('header') as HTMLElement;
    expect(header.textContent).not.toMatch(/think:|Thinking/);
    expect(header.querySelector('[aria-label="Toggle theme"]')).toBeNull();
  });
});
