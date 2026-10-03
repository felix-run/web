// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The AI Elements components are presentational, and nothing in them needs the AI
 * SDK at runtime: the twelve that import from `ai` import *types* only, which the
 * compiler erases. This pins that, so a component that starts calling into the SDK
 * fails here rather than quietly adding it to the bundle — and it shows the
 * mapping a Felix tool call needs, which is the whole of the integration cost.
 */

vi.mock('ai', () => {
  throw new Error('an AI Elements component imported the AI SDK at runtime');
});

afterEach(cleanup);

describe('AI Elements without the AI SDK', () => {
  it('renders a Felix tool call through the tool card, from a plain object', async () => {
    const { Tool, ToolHeader } = await import('../src/components/ai-elements/tool');
    // A Felix `ToolCall`, mapped to the shape the header expects: the part type is
    // `tool-<name>` and the state is the AI SDK's spelling of done / in flight.
    const call = { name: 'write_file', done: true };
    render(
      <Tool>
        <ToolHeader
          type={`tool-${call.name}`}
          state={call.done ? 'output-available' : 'input-available'}
        />
      </Tool>,
    );
    expect(screen.getByText('write_file')).toBeTruthy();
  });

  it('renders the components that never mention the SDK', async () => {
    const { Task, TaskTrigger, TaskContent, TaskItem } = await import(
      '../src/components/ai-elements/task'
    );
    const { Sources, SourcesTrigger } = await import('../src/components/ai-elements/sources');
    render(
      <>
        <Task>
          <TaskTrigger title="Migrate the billing table" />
          <TaskContent>
            <TaskItem>Backfill in batches of 500</TaskItem>
          </TaskContent>
        </Task>
        <Sources>
          <SourcesTrigger count={2} />
        </Sources>
      </>,
    );
    expect(screen.getByText('Migrate the billing table')).toBeTruthy();
    expect(screen.getByText(/2 sources/i)).toBeTruthy();
  });
});
