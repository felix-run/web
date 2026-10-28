// @vitest-environment happy-dom
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The vendored AI Elements that are left are presentational, and nothing in them needs the
 * AI SDK at runtime: `context.tsx` imports a *type* from `ai`, which the compiler erases. This
 * pins that, so a component that starts calling into the SDK fails here rather than quietly
 * adding it to the bundle. Every file in the folder is loaded, so one added later is covered.
 */

vi.mock('ai', () => {
  throw new Error('an AI Elements component imported the AI SDK at runtime');
});

afterEach(cleanup);

// Vitest runs from the package root; `import.meta.url` is not a file URL under happy-dom.
const DIR = join(process.cwd(), 'src/components/ai-elements');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));

describe('AI Elements without the AI SDK', () => {
  it('holds only the six the app uses', () => {
    // The rest were deleted on 2026-10-28; shadcn's Trace and Code Block replaced them.
    expect(files.sort()).toEqual([
      'checkpoint.tsx',
      'context.tsx',
      'controls.tsx',
      'file-tree.tsx',
      'prompt-input.tsx',
      'terminal.tsx',
    ]);
  });

  it.each(files)('loads %s without the SDK', async (file) => {
    await expect(import(`../src/components/ai-elements/${file}`)).resolves.toBeTruthy();
  });

  it('renders the context meter from a plain usage object', async () => {
    const { Context, ContextTrigger } = await import('../src/components/ai-elements/context');
    render(
      <Context usedTokens={1200} maxTokens={8000}>
        <ContextTrigger />
      </Context>,
    );
    expect(screen.getByRole('button').textContent).toContain('15');
  });
});
