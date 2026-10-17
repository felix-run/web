/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageEmpty } from '../src/components/harness/panel';
import { PanelModeProvider, SectionBody } from '../src/components/inspector/primitives';

/**
 * A `/harness` page with no rows says so in one muted line where the first row would sit.
 *
 * Until 2026-10-16 it was a 160px stone tray (`min-h-40 rounded-2xl bg-ground`) with the
 * sentence centred in it — on an empty page the biggest object there, in the tone the app
 * keeps for things that hold content. Pinned by shape, since a tray is one className away.
 */

afterEach(cleanup);

function expectLine(el: HTMLElement) {
  expect(el.tagName).toBe('P');
  expect(el.className).toContain('text-muted-foreground');
  for (const tray of ['bg-ground', 'rounded-2xl', 'min-h-40', 'text-center', 'justify-center'])
    expect(el.className).not.toContain(tray);
}

describe('a page with nothing in it', () => {
  it('is one left-aligned muted line, not a tray', () => {
    render(<PageEmpty>No jobs yet.</PageEmpty>);
    const line = screen.getByText('No jobs yet.');
    expectLine(line);
    expect(line.hasAttribute('data-page-empty')).toBe(true);
  });

  it('keeps an action inside the line', () => {
    render(
      <PageEmpty>
        Nothing ran. <button type="button">Show the last 24 hours</button>
      </PageEmpty>,
    );
    const button = screen.getByRole('button', { name: 'Show the last 24 hours' });
    expectLine(button.closest('[data-page-empty]') as HTMLElement);
  });

  it('is the same line through a polled section on a page', () => {
    render(
      <PanelModeProvider>
        <SectionBody loading={false} error={null} doing="list documents" empty emptyText="None.">
          <div>rows</div>
        </SectionBody>
      </PanelModeProvider>,
    );
    expectLine(screen.getByText('None.'));
    expect(screen.queryByText('rows')).toBeNull();
  });

  // The Activity page draws through `SectionBody` with no panel provider above it, and its
  // sentence ran ~100 characters wide on the old unmeasured line.
  it('is held to the same measure outside a panel provider', () => {
    render(
      <SectionBody
        loading={false}
        error={null}
        doing="load activity"
        empty
        emptyText="Nothing ran."
      >
        <div>rows</div>
      </SectionBody>,
    );
    const line = screen.getByText('Nothing ran.');
    expectLine(line);
    expect(line.className).toContain('max-w-[28rem]');
  });
});
