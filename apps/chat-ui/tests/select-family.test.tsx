/** @vitest-environment happy-dom */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSelect } from '../src/components/agent-select';

/**
 * One select, one agent picker. A native `<select>` draws its list with the OS — light chrome on
 * a dark page, its own chevron and focus ring — and four of them sat among the primitive's
 * pills on the Versions tab and in the plan editor. Seven places chose an agent from the same
 * `/v1/models` list with four widths and two fonts in the trigger.
 */

afterEach(cleanup);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('the select family', () => {
  it('has no native <select> anywhere in the app', () => {
    const offenders = sources(join(__dirname, '../src')).filter((path) =>
      // Comments may name the element; markup may not.
      readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        .match(/<select[\s>]/),
    );
    expect(offenders).toEqual([]);
  });
});

describe('AgentSelect', () => {
  const models = new Map([
    ['quick', 'claude-haiku-5-5'],
    ['deep', undefined],
  ]);

  it('shows the name alone in the trigger and the model under it in the list', async () => {
    render(
      <AgentSelect
        aria-label="Agent"
        value="quick"
        options={['quick', 'deep']}
        onValueChange={() => {}}
        providerModels={models}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Agent' });
    expect(trigger.textContent).toBe('quick');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const row = await screen.findByRole('option', { name: /quick/ });
    expect(within(row).getByText('claude-haiku-5-5')).toBeTruthy();
    // No second line when the harness reports none.
    expect(screen.getByRole('option', { name: 'deep' }).textContent).toBe('deep');
  });

  it('offers a value the list no longer carries instead of drawing a blank', async () => {
    render(
      <AgentSelect
        aria-label="Agent"
        value="retired"
        options={['quick']}
        onValueChange={() => {}}
        providerModels={models}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Agent' });
    expect(trigger.textContent).toBe('retired');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'retired' })).toBeTruthy();
  });

  it('draws a sentinel of ours in sans and agents in mono', () => {
    const { rerender } = render(
      <AgentSelect
        aria-label="Agent"
        value="*"
        options={['quick']}
        onValueChange={() => {}}
        leading={[{ value: '*', label: 'Every agent' }]}
        providerModels={models}
      />,
    );
    const trigger = () => screen.getByRole('combobox', { name: 'Agent' });
    expect(trigger().textContent).toBe('Every agent');
    expect(trigger().className).not.toMatch(/\bfont-mono\b/);
    rerender(
      <AgentSelect
        aria-label="Agent"
        value="quick"
        options={['quick']}
        onValueChange={() => {}}
        leading={[{ value: '*', label: 'Every agent' }]}
        providerModels={models}
      />,
    );
    expect(trigger().className).toMatch(/\bfont-mono\b/);
  });

  it('reports a choice, and never an empty one', async () => {
    const onValueChange = vi.fn();
    render(
      <AgentSelect
        aria-label="Agent"
        value="quick"
        options={['quick', 'deep']}
        onValueChange={onValueChange}
        providerModels={models}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Agent' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'deep' }));
    expect(onValueChange).toHaveBeenCalledWith('deep');
  });
});
