/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
 */

afterEach(cleanup);

function mount(over: Partial<ShellValue> = {}) {
  const shell = { threadId: 'a1b2c3', harnessReachable: true, ...over } as ShellValue;
  return render(
    <ShellProvider value={shell}>
      <Greeting manifest="cowork" />
    </ShellProvider>,
  );
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

  it('offers no starter prompts', () => {
    mount();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says a send will fail while the harness is unreachable', () => {
    mount({ harnessReachable: false });
    expect(screen.getByText(/unreachable/).className).toMatch(/text-state-failed/);
  });
});
