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
    const trigger = screen.getByRole('combobox', { name: 'Choose agent' });
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
    const trigger = screen.getByRole('combobox', { name: 'Choose agent' });
    expect(trigger.className.split(/\s+/)).toContain('font-mono');
    trigger.focus();
    await user.keyboard('{Enter}');
    const name = await screen.findByText('research', { selector: '[role="option"] span' });
    expect(name.className.split(/\s+/)).toContain('font-mono');
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
    const trigger = await screen.findByRole('combobox', { name: 'Choose agent' });
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
