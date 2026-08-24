/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearKnownVersions,
  knownVersions,
  recordFromPointer,
  recordVersion,
} from '../src/lib/manifest-versions';

/**
 * The harness has no version-list route, so the manifest sheet asked the operator to
 * type the version number that re-points production traffic. This records the numbers
 * that pass through the client anyway, to turn that recall into recognition.
 *
 * It is explicitly partial — a version created from another tab will not be here —
 * so what matters is that it never *invents* a version and never loses one.
 */

const NOW = 1_700_000_000_000;

beforeEach(() => clearKnownVersions());

describe('manifest version record', () => {
  it('starts empty and stays per-manifest', () => {
    expect(knownVersions('quick')).toEqual([]);
    recordVersion('quick', { version: 3, via: 'created' }, NOW);
    expect(knownVersions('quick')).toHaveLength(1);
    expect(knownVersions('cowork')).toEqual([]);
  });

  it('records both numbers a pointer reports', () => {
    recordFromPointer('quick', { version: 4, canary_version: 5 }, NOW);
    expect(knownVersions('quick').map((v) => v.version)).toEqual([5, 4]);
  });

  it('ignores a pointer with no versions rather than inventing one', () => {
    recordFromPointer('quick', { version: null, canary_version: null }, NOW);
    expect(knownVersions('quick')).toEqual([]);
  });

  it('does not duplicate a version seen twice', () => {
    recordFromPointer('quick', { version: 4 }, NOW);
    recordFromPointer('quick', { version: 4 }, NOW + 1000);
    expect(knownVersions('quick')).toHaveLength(1);
  });

  it('keeps the richer entry when an observed version is later created here', () => {
    recordFromPointer('quick', { version: 7 }, NOW);
    recordVersion('quick', { version: 7, comment: 'raised max_tool_calls', via: 'created' }, NOW);
    const [v] = knownVersions('quick');
    expect(v.via).toBe('created');
    expect(v.comment).toBe('raised max_tool_calls');
  });

  it('does not let a later observation erase a comment', () => {
    recordVersion('quick', { version: 7, comment: 'the good one', via: 'created' }, NOW);
    recordFromPointer('quick', { version: 7 }, NOW + 5000);
    expect(knownVersions('quick')[0].comment).toBe('the good one');
  });

  it('rejects values that are not real version numbers', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      recordVersion('quick', { version: bad, via: 'observed' }, NOW);
    }
    expect(knownVersions('quick')).toEqual([]);
  });

  it('sorts newest version first', () => {
    for (const v of [2, 11, 7]) recordVersion('quick', { version: v, via: 'observed' }, NOW);
    expect(knownVersions('quick').map((v) => v.version)).toEqual([11, 7, 2]);
  });

  it('survives a corrupt blob without taking the sheet down', () => {
    localStorage.setItem('felix.manifestVersions', '{not json');
    expect(knownVersions('quick')).toEqual([]);
  });
});
