/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Greeting } from '../src/components/chat/greeting';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The empty thread is a readout, not a welcome.
 *
 * It was a 28px question over four starter cards — one of them a haiku — which
 * told the operator nothing about what the first message would be sent to. What
 * it says now is only what the client holds: the agent, the folder, the thread
 * and whether the harness answers. The last is pinned in words because a
 * harness that is down is the one fact here that changes what to do next.
 *
 * Under the readout sit starter prompts chosen by agent, which send on click.
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
  it('reads out what the first message will be sent to', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Empty thread' })).toBeTruthy();
    expect(screen.getByText('cowork')).toBeTruthy();
    expect(screen.getByText('a1b2c3')).toBeTruthy();
    expect(screen.getByText('none mounted')).toBeTruthy();
    expect(screen.getByText('reachable')).toBeTruthy();
  });

  it("offers the agent's starter prompts and sends the full prompt on click", () => {
    const shell = mount();
    const button = screen.getByRole('button', { name: 'List the workspace' });
    fireEvent.click(button);
    expect(shell.send).toHaveBeenCalledWith(
      'List the top-level files and folders in the workspace.',
    );
  });

  it('falls back to a general set for an agent with none of its own', () => {
    mount({}, 'router');
    expect(screen.getByRole('button', { name: 'What can you do?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'List the workspace' })).toBeNull();
  });

  it("prefers the manifest's own starters over the built-in table", () => {
    const shell = mount({
      manifestEntries: [
        { id: 'cowork', starters: [{ title: 'Tidy notes', prompt: 'Tidy the notes folder.' }] },
      ],
    });
    expect(screen.queryByRole('button', { name: 'List the workspace' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tidy notes' }));
    expect(shell.send).toHaveBeenCalledWith('Tidy the notes folder.');
  });

  it('gives a manifest that declares no starters the general pair, not the name table', () => {
    mount({ manifestEntries: [{ id: 'cowork', starters: [] }] });
    expect(screen.getByRole('button', { name: 'What can you do?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'List the workspace' })).toBeNull();
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
