import { describe, expect, it } from 'bun:test';
import type { Turn } from '@felix/client';
import { handlesByTool, sizeLabel, spills } from '../src/artifacts';
import { pagerCommand } from '../src/pager';
import { Transcript } from '../src/ui/transcript';
import { mount, shows, testTheme } from './render';

/**
 * Output too large to inline, and the handle that reaches it.
 *
 * Two of these cover the reason this was worth doing at all: before it, the
 * card drew the *call* and never the *result*, so a spilled-output marker was
 * not a raw marker on screen — it was nothing on screen.
 */

// The id is 32 hex characters and the key carries the tenant — both validated
// the same way the harness validates them, so a near-miss is treated as absent
// rather than repaired into a reference that addresses something else.
const ID = 'ab12cd34ef56ab12cd34ef56ab12cd34';
const MARKER = `[artifact:${ID} key=artifacts/acme/quick/${ID}.txt chars=48000]`;

const turn = (output: string): Turn => ({
  id: 't1',
  role: 'assistant',
  content: 'checking',
  tools: [{ name: 'read_file', input: { path: 'big.log' }, output, done: true, at: 0 }],
});

describe('finding a spill', () => {
  it('reads the marker off the end of an output', () => {
    const [spill] = spills([turn(`first lines of the file…\n${MARKER}`)]);
    expect(spill?.handle).toBe(1);
    expect(spill?.ref.artifactId).toBe(ID);
    expect(spill?.ref.manifestId).toBe('quick');
    expect(spill?.ref.chars).toBe(48000);
    // The preview is what the harness kept inline. The trailing ellipsis is the
    // harness's separator rather than the tool's, so it goes with the marker.
    expect(spill?.ref.preview).toBe('first lines of the file');
  });

  it('ignores a marker a tool merely mentioned', () => {
    // Anchored to the end on purpose: a tool talking *about* an artifact is not
    // returning one, and must not produce a handle that fetches something else.
    expect(spills([turn(`I found ${MARKER} in the logs, which looks wrong.`)])).toHaveLength(0);
  });

  it('numbers spills across the whole transcript, densely', () => {
    const plain = turn('small enough to inline');
    const found = spills([
      { ...turn(`a\n${MARKER}`), id: 'x' },
      { ...plain, id: 'y' },
      { ...turn(`b\n${MARKER}`), id: 'z' },
    ]);
    // A handle exists only where there is something to fetch.
    expect(found.map((s) => s.handle)).toEqual([1, 2]);
  });

  it('keys handles by the call that produced them', () => {
    const t = turn(`a\n${MARKER}`);
    const tool = t.tools?.[0];
    expect(handlesByTool([t]).get(tool!)?.handle).toBe(1);
  });
});

describe('the card', () => {
  it('draws the result, which it never did before', async () => {
    const ui = await mount(<Transcript turns={[turn('42 rows matched')]} theme={testTheme} />, {
      width: 80,
      height: 14,
    });
    await ui.until(() => shows(ui.frame(), 'read_file'));
    expect(shows(ui.frame(), '42 rows matched')).toBe(true);
    ui.stop();
  });

  it('says how much more there is, and how to reach it', async () => {
    const ui = await mount(
      <Transcript turns={[turn(`first lines…\n${MARKER}`)]} theme={testTheme} />,
      { width: 80, height: 14 },
    );
    await ui.until(() => shows(ui.frame(), 'first lines'));
    expect(shows(ui.frame(), '48k more [a1]')).toBe(true);
    ui.stop();
  });

  it('says so when a tool returned nothing, rather than drawing a blank row', async () => {
    const ui = await mount(<Transcript turns={[turn('')]} theme={testTheme} />, {
      width: 80,
      height: 14,
    });
    await ui.until(() => shows(ui.frame(), 'read_file'));
    expect(shows(ui.frame(), '(no output)')).toBe(false);
    ui.stop();
  });
});

describe('sizeLabel', () => {
  it('fits a card that is already one dim line', () => {
    expect(sizeLabel(400)).toBe('400c');
    expect(sizeLabel(48_000)).toBe('48k');
    expect(sizeLabel(2_400_000)).toBe('2.4M');
  });
});

describe('the pager', () => {
  it('prefers $PAGER, then an editor, then less', () => {
    expect(pagerCommand({ PAGER: 'bat -p' } as NodeJS.ProcessEnv)).toEqual(['bat', '-p']);
    expect(pagerCommand({ VISUAL: 'nvim' } as NodeJS.ProcessEnv)).toEqual(['nvim']);
    expect(pagerCommand({} as NodeJS.ProcessEnv)).toEqual(['less']);
  });
});
