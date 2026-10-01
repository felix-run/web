// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextMeter, contextFill } from '../src/components/chat/context-meter';
import { Message } from '../src/components/chat/message';
import type { Turn } from '../src/types';

/**
 * The meter reads the newest figure the transcript has, against the selected
 * agent's window, and says nothing at all when either is missing — a meter
 * reading 0% because nothing was reported would be a claim about an empty
 * context, not an admission that the size is unknown.
 */

const user = (id: string): Turn => ({ id, role: 'user', content: 'q' });
const reply = (id: string, contextTokens?: number): Turn => ({
  id,
  role: 'assistant',
  content: 'a',
  tools: [],
  ...(contextTokens === undefined ? {} : { contextTokens }),
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('contextFill', () => {
  it('reads the newest reply that reported one', () => {
    const fill = contextFill(
      [user('u1'), reply('a1', 1000), user('u2'), reply('a2', 4000)],
      200_000,
    );
    expect(fill).toEqual({ used: 4000, window: 200_000, share: 0.02 });
  });

  it('falls back past a newer reply that reported nothing', () => {
    // A durable run not yet re-read, or a provider that reports no usage.
    const fill = contextFill([user('u1'), reply('a1', 1000), user('u2'), reply('a2')], 200_000);
    expect(fill?.used).toBe(1000);
  });

  it('says nothing without a window or without any figure', () => {
    expect(contextFill([user('u1'), reply('a1', 1000)], undefined)).toBeNull();
    expect(contextFill([user('u1'), reply('a1')], 200_000)).toBeNull();
    expect(contextFill([], 200_000)).toBeNull();
  });
});

describe('ContextMeter', () => {
  it('reports the share as a meter, with the counts in its accessible text', () => {
    render(<ContextMeter used={30_000} window={200_000} agent="quick" />);
    const meter = document.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('30000');
    expect(meter?.getAttribute('aria-valuemax')).toBe('200000');
    expect(meter?.textContent).toContain('15%');
    expect(meter?.textContent).toContain('of 200k');
    expect(meter?.getAttribute('aria-valuetext')).toContain("30,000 of 200,000 tokens in quick's");
    expect(meter?.textContent).not.toContain('nearly full');
  });

  it('says nearly full in words, not only with the bar', () => {
    render(<ContextMeter used={190_000} window={200_000} />);
    const meter = document.querySelector('[role="meter"]');
    expect(meter?.textContent).toContain('95%');
    expect(meter?.textContent).toContain('nearly full');
  });
});

describe('the per-turn usage line', () => {
  it('counts cached tokens as part of the prompt', () => {
    // `input: 3` was the whole of what the line used to show for a 1,035-token call.
    render(
      <TooltipProvider>
        <Message
          turn={{
            id: 'a1',
            role: 'assistant',
            content: 'GAMMA',
            tools: [],
            usage: { input: 3, output: 7, cacheWrite: 1025 },
          }}
        />
      </TooltipProvider>,
    );
    expect(document.body.textContent).toContain('1,028 in · 7 out · 1,035 tok');
  });
});
