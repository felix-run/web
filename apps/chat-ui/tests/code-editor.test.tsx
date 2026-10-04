// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../src/components/skills/code-editor';

/**
 * The editor's two modes. Editable, Tab is the editor's and the field says how
 * to leave it; read-only, nothing typed reaches the value and Tab is the
 * browser's again, so the hint that explains the trap would be a false one.
 */

afterEach(cleanup);

const source = () =>
  screen.getByRole('textbox', { name: 'SKILL.md source' }) as HTMLTextAreaElement;

describe('CodeEditor', () => {
  it('editable: Tab indents and the field describes the way out', () => {
    const onChange = vi.fn();
    render(<CodeEditor path="SKILL.md" value="body" onChange={onChange} />);
    const field = source();
    expect(field.readOnly).toBe(false);
    const tab = fireEvent.keyDown(field, { key: 'Tab' });
    expect(tab).toBe(false); // default prevented: the key indented rather than moving focus
    expect(screen.getByText(/Tab inserts two spaces/)).toBeTruthy();
  });

  it('read-only: the field refuses edits, leaves Tab alone and drops the hint', () => {
    render(<CodeEditor path="SKILL.md" value="body" readOnly />);
    const field = source();
    expect(field.readOnly).toBe(true);
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
    expect(screen.queryByText(/Tab inserts two spaces/)).toBeNull();
    expect(field.getAttribute('aria-describedby')).toBeNull();
  });

  it('read-only still points at validation issues when there are any', () => {
    render(<CodeEditor path="SKILL.md" value="body" readOnly issuesId="issues" />);
    expect(source().getAttribute('aria-describedby')).toBe('issues');
  });
});
