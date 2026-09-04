import { describe, expect, it } from 'bun:test';
import { getComponentCatalogue } from '@opentui/react';
import { inspectorRows, SECTIONS, TAB_WIDTH } from '../src/inspector';
import { Inspector } from '../src/ui/inspector';
import { lines, mount, shows, testTheme } from './render';

/**
 * The overlay, drawn.
 *
 * Two of these cover failures that are silent rather than loud: a tab strip
 * that quietly shows three of seven sections behind scroll arrows, and a table
 * that quietly wraps a row onto two lines. Both look fine at the width they
 * were written at.
 */

const panel = (over: Partial<Parameters<typeof Inspector>[0]['panel']> = {}) => ({
  loading: false,
  error: null,
  head: ['when', 'event', 'status', 'what'],
  rows: [],
  empty: 'nothing recorded on this tenant yet',
  ...over,
});

const draw = (over: Record<string, unknown> = {}) =>
  mount(
    <Inspector
      section={SECTIONS[0]!}
      panel={panel()}
      width={80}
      rows={inspectorRows(28)}
      theme={testTheme}
      panelRef={{ current: null }}
      searching={false}
      query=""
      onQuery={() => {}}
      {...over}
    />,
    { width: 80, height: 28 },
  );

describe('the section strip', () => {
  it('shows all seven sections at eighty columns, with no scroll arrows', async () => {
    // The renderable's default tabWidth is 20, which fits three of seven and
    // hides the rest behind `‹ ›`. Seven times TAB_WIDTH has to stay inside the
    // usable width, so renaming a section means redoing that arithmetic.
    expect(SECTIONS.length * TAB_WIDTH).toBeLessThanOrEqual(72);
    const ui = await draw();
    // The strip is the last thing to settle; wait for the far end of it rather
    // than for the renderer, which reports idle before React has committed.
    await ui.until(() => shows(ui.frame(), SECTIONS[SECTIONS.length - 1]!.name));
    const frame = ui.frame();
    for (const section of SECTIONS) {
      expect(shows(frame, section.name)).toBe(true);
    }
    expect(frame.includes('‹') || frame.includes('›')).toBe(false);
    ui.stop();
  });

  it('every section name fits the tab it is drawn in', () => {
    for (const section of SECTIONS) {
      expect(section.name.length).toBeLessThanOrEqual(TAB_WIDTH - 2);
    }
  });

  it('puts the section description in the border, where there is room', async () => {
    const ui = await draw();
    await ui.until(() => shows(ui.frame(), 'what the harness recorded'));
    ui.stop();
  });
});

describe('a panel says which of the four things it is', () => {
  it('shows the empty line when there is nothing, and no error', async () => {
    const ui = await draw();
    await ui.until(() => shows(ui.frame(), 'nothing recorded on this tenant yet'));
    ui.stop();
  });

  it('shows a failure as a failure, never as an empty list', async () => {
    // A failed read rendered as an empty list claims the harness is idle, which
    // is a different and wrong statement.
    const ui = await draw({ panel: panel({ error: 'audit: 403' }) });
    await ui.until(() => shows(ui.frame(), 'audit: 403'));
    expect(shows(ui.frame(), 'nothing recorded on this tenant yet')).toBe(false);
    ui.stop();
  });

  it('says it is reading rather than saying there is nothing', async () => {
    const ui = await draw({ panel: panel({ loading: true }) });
    await ui.until(() => shows(ui.frame(), 'reading…'));
    ui.stop();
  });
});

describe('the table', () => {
  it('is registered by importing the module that renders it', () => {
    // `text-table` is not a JSX intrinsic at 0.5.10 despite what the docs say,
    // so reaching the element without `extend()` throws `Unknown component
    // type`. Importing `Inspector` reaches `Table`, which runs the registration.
    expect(getComponentCatalogue()['text-table']).toBeDefined();
  });

  it('draws one line per row at eighty columns', async () => {
    // wrapMode="none" plus a balanced fitter is what makes this true, and a
    // long model id is what breaks it.
    const rows = Array.from({ length: 6 }, (_, i) => [
      { text: `${i}s ago` },
      { text: 'tool_call' },
      { text: 'ok' },
      { text: `read_file_number_${i}` },
    ]);
    const ui = await draw({ panel: panel({ rows }) });
    await ui.until(() => shows(ui.frame(), 'read_file_number_5'));
    const body = lines(ui.frame()).filter((l) => l.includes('tool_call'));
    expect(body).toHaveLength(6);
    ui.stop();
  });

  it('right-aligns a numeric column so the digits line up', async () => {
    // TextTable has no per-column alignment; `num()` is what keeps a metrics
    // column from going ragged.
    const { num } = await import('../src/format');
    expect(num(7, 5)).toBe('    7');
    expect(num(120450, 5)).toBe('120450');
    expect(num(7, 5).length).toBe(num(12345, 5).length);
  });
});

describe('the panel height', () => {
  it('never asks for more rows than the terminal can spare', () => {
    // The overlay is absolute: asking for too many does not shrink it, it draws
    // over the composer — the failure the rail's own arithmetic exists to avoid.
    for (const height of [10, 14, 24, 40, 200]) {
      expect(inspectorRows(height)).toBeLessThanOrEqual(Math.max(0, height - 12));
    }
  });

  it('stops growing on a very tall terminal', () => {
    expect(inspectorRows(200)).toBe(18);
  });
});
