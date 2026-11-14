// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSkillBundle } from '../src/components/skills/use-skill-bundle';

/**
 * The editor's working copy. The rule worth a test above all is the baseline:
 * a refetch of the *same* version must never overwrite an edit in progress,
 * and a *different* version must always replace it — the second is what a
 * "reload the newer version" choice relies on.
 */

const BASE: Record<string, string> = { 'SKILL.md': '---\nname: a\ndescription: b\n---\nbody' };

function mount(initialFiles = BASE, versionId = 'v1') {
  return renderHook(
    (props: { initialFiles: Record<string, string>; versionId: string }) => useSkillBundle(props),
    { initialProps: { initialFiles, versionId } },
  );
}

describe('useSkillBundle', () => {
  it('starts clean and tracks dirty against the baseline, both ways', () => {
    const { result } = mount();
    expect(result.current.files).toEqual(BASE);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setFileContent('SKILL.md', 'changed'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setFileContent('SKILL.md', BASE['SKILL.md'] ?? ''));
    expect(result.current.dirty).toBe(false);
  });

  it('stubs an editable SKILL.md when the bundle loaded empty', () => {
    const { result } = mount({}, 'v-empty');
    expect(result.current.files).toEqual({ 'SKILL.md': '' });
    expect(result.current.dirty).toBe(false);
  });

  it('keeps an edit through a same-version refetch', () => {
    const { result, rerender } = mount();
    act(() => result.current.setFileContent('SKILL.md', 'edited'));
    rerender({ initialFiles: { 'SKILL.md': 'refetched' }, versionId: 'v1' });
    expect(result.current.files['SKILL.md']).toBe('edited');
  });

  it('re-baselines on a version switch even when dirty', () => {
    const { result, rerender } = mount();
    act(() => result.current.setFileContent('SKILL.md', 'edited'));
    rerender({ initialFiles: { 'SKILL.md': 'v2 content' }, versionId: 'v2' });
    expect(result.current.files['SKILL.md']).toBe('v2 content');
    expect(result.current.dirty).toBe(false);
  });

  it('creates files only at paths the harness allows, and opens them', () => {
    const { result } = mount();
    let ok = false;
    act(() => {
      ok = result.current.createFile('scripts/run.py');
    });
    expect(ok).toBe(true);
    expect(result.current.activePath).toBe('scripts/run.py');
    for (const bad of ['nope/run.py', 'scripts/../x.py', 'references/SKILL.md']) {
      act(() => {
        ok = result.current.createFile(bad);
      });
      expect(ok).toBe(false);
    }
  });

  it('renames a folder recursively, follows the open file, and refuses collisions', () => {
    const { result } = mount({
      ...BASE,
      'scripts/a.py': 'a',
      'scripts/lib/b.py': 'b',
      'references/keep.md': 'k',
    });
    act(() => result.current.setActivePath('scripts/lib/b.py'));
    act(() => {
      result.current.renamePath('scripts', 'assets');
    });
    expect(result.current.files['assets/lib/b.py']).toBe('b');
    expect(result.current.files['scripts/a.py']).toBeUndefined();
    expect(result.current.activePath).toBe('assets/lib/b.py');
    let ok = true;
    act(() => {
      ok = result.current.renamePath('references/keep.md', 'assets/a.py');
    });
    expect(ok).toBe(false);
  });

  it('deletes a folder by prefix and falls back to SKILL.md', () => {
    const { result } = mount({ ...BASE, 'scripts/a.py': '', 'scripts/b.py': '' });
    act(() => result.current.setActivePath('scripts/a.py'));
    act(() => result.current.deletePath('scripts'));
    expect(Object.keys(result.current.files)).toEqual(['SKILL.md']);
    expect(result.current.activePath).toBe('SKILL.md');
  });

  it('never deletes or renames SKILL.md', () => {
    const { result } = mount();
    act(() => {
      result.current.deletePath('SKILL.md');
      result.current.renamePath('SKILL.md', 'OTHER.md');
    });
    expect(result.current.files['SKILL.md']).toBe(BASE['SKILL.md']);
  });

  it('overwrites SKILL.md as an edit, and reset re-baselines after a save', () => {
    const { result } = mount();
    act(() => result.current.overwriteSkillMd('remote'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset({ 'SKILL.md': 'remote' }));
    expect(result.current.dirty).toBe(false);
  });
});
