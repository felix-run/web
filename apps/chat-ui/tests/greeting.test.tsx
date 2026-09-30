/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Greeting } from '../src/components/chat/greeting';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The empty thread: a welcome headline, the agent's starter cards, and a one-line
 * readout of what the first message will be sent to.
 *
 * The readout is pinned because it is the part a redesign drops first, and
 * "harness unreachable" is the one fact here that changes what to do next. Each
 * card shows the prompt it sends, and the click sends exactly that.
 */

afterEach(cleanup);

function mount(over: Partial<ShellValue> = {}, manifest = 'cowork') {
  const shell = {
    threadId: 'a1b2c3',
    harnessReachable: true,
    streaming: false,
    send: vi.fn(),
    manifestEntries: [],
    ...over,
  } as ShellValue;
  render(
    <ShellProvider value={shell}>
      <Greeting manifest={manifest} />
    </ShellProvider>,
  );
  return shell;
}

describe('the empty thread', () => {
  it('welcomes, and still reads out what the first message will be sent to', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'What do you want to work on?' })).toBeTruthy();
    // Named in the welcome sentence and again in the readout.
    expect(screen.getAllByText('cowork')).toHaveLength(2);
    expect(screen.getByText('a1b2c3')).toBeTruthy();
    expect(screen.getByText('none mounted')).toBeTruthy();
    expect(screen.getByText('reachable')).toBeTruthy();
  });

  it("offers the agent's starter prompts and sends the full prompt on click", () => {
    const shell = mount();
    const button = screen.getByRole('button', { name: /^List the workspace/ });
    fireEvent.click(button);
    expect(shell.send).toHaveBeenCalledWith(
      'List the top-level files and folders in the workspace.',
    );
  });

  it('falls back to a general set for an agent with none of its own', () => {
    mount({}, 'router');
    expect(screen.getByRole('button', { name: /^What can you do?/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
  });

  it("prefers the manifest's own starters over the built-in table", () => {
    const shell = mount({
      manifestEntries: [
        { id: 'cowork', starters: [{ title: 'Tidy notes', prompt: 'Tidy the notes folder.' }] },
      ],
    });
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Tidy notes/ }));
    expect(shell.send).toHaveBeenCalledWith('Tidy the notes folder.');
  });

  it('gives a manifest that declares no starters the general pair, not the name table', () => {
    mount({ manifestEntries: [{ id: 'cowork', starters: [] }] });
    expect(screen.getByRole('button', { name: /^What can you do?/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
  });

  it("uses the manifest's own headline and subtitle", () => {
    mount({
      manifestEntries: [
        {
          id: 'cowork',
          greeting: { headline: 'What should we do in this folder?', subtitle: 'Reads freely.' },
        },
      ],
    });
    expect(screen.getByRole('heading', { name: 'What should we do in this folder?' })).toBeTruthy();
    expect(screen.getByText('Reads freely.')).toBeTruthy();
    expect(screen.queryByText(/You're chatting with/)).toBeNull();
  });

  it('keeps the sentence naming the agent when the manifest sets only a headline', () => {
    mount({ manifestEntries: [{ id: 'cowork', greeting: { headline: 'Hello' } }] });
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeTruthy();
    expect(screen.getByText(/You're chatting with/)).toBeTruthy();
  });

  it('disables the starters while a run is streaming', () => {
    mount({ streaming: true });
    for (const b of screen.getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a send will fail while the harness is unreachable', () => {
    mount({ harnessReachable: false });
    expect(screen.getByText(/unreachable/).className).toMatch(/text-state-failed/);
  });
});
