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

/** Each opening tag of the named components, read to its real end: braces are skipped, so an
 * `onChange={(e) => …}` arrow does not end the tag early. */
function jsxTags(text: string, names: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const m of text.matchAll(new RegExp(`<(${names.join('|')})\\b`, 'g'))) {
    let depth = 0;
    let end = m.index;
    for (; end < text.length; end++) {
      const c = text[end];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push([m[1], text.slice(m.index, end + 1)]);
  }
  return out;
}

/** An attribute's raw value: `"…"`, or the `{…}` expression with its braces balanced. */
function attribute(tag: string, name: string): string | null {
  const at = tag.search(new RegExp(`\\s${name}=`));
  if (at < 0) return null;
  const start = tag.indexOf('=', at) + 1;
  if (tag[start] === '"') return tag.slice(start, tag.indexOf('"', start + 1) + 1);
  let depth = 0;
  for (let i = start; i < tag.length; i++) {
    if (tag[i] === '{') depth++;
    else if (tag[i] === '}' && --depth === 0) return tag.slice(start, i + 1);
  }
  return null;
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

  /**
   * The One-Field Rule in DESIGN.md: a field's call site sets width and spacing, never height,
   * radius, padding, text size or background, which belong to the primitive's `size`. It was
   * written down and untested, and a re-review found two heights and three backgrounds that had
   * survived it. Each exception here says why it is one.
   */
  it('lets a field call site set width and spacing, and nothing the primitive owns', () => {
    const ALLOWED: Record<string, string[]> = {
      // The composer's pickers are chips on the composer's own muted wash, not form fields.
      'chat/multimodal-input.tsx': ['bg-muted/40', 'bg-muted'],
      // The sidebar's search and rename sit on its accent: the wash is lost on the sidebar ground.
      'chat/thread-list.tsx': ['bg-sidebar-accent'],
      // The pane's path fields sit on a tinted strip, so they take the flat page colour.
      'pane/file-actions.tsx': ['bg-background'],
      'pane/save-to-workspace.tsx': ['bg-background'],
    };
    const owned = /^(h-|rounded|px-|py-|p-|text-(xs|sm|base|lg|xl)$|bg-)/;
    const root = join(__dirname, '../src');
    const found: string[] = [];
    for (const path of sources(root)) {
      const rel = path.slice(root.length + '/components/'.length);
      if (rel.startsWith('ai-elements/')) continue;
      const text = readFileSync(path, 'utf8');
      for (const [name, tag] of jsxTags(text, ['Input', 'SelectTrigger', 'Textarea'])) {
        const cls = attribute(tag, 'className');
        if (!cls) continue;
        // A plain string, or every string literal inside `{cn(...)}`.
        const literal = cls.startsWith('"')
          ? cls.slice(1, -1)
          : [...cls.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)]
              .map((m) => m[1] ?? m[2] ?? m[3])
              .join(' ');
        for (const token of literal.split(/\s+/).filter(Boolean)) {
          const base = token.split(':').pop() ?? token;
          if (!owned.test(base) || ALLOWED[rel]?.includes(base)) continue;
          found.push(`${rel} <${name}> ${token}`);
        }
      }
    }
    expect(found).toEqual([]);
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
