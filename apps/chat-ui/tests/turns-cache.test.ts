/** @vitest-environment happy-dom */
import type { Turn } from '@felix/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetIdentityState } from '../src/lib/identity-state';
import {
  clearTurns,
  loadTurns,
  saveTurns,
  scheduleSaveTurns,
  TURNS_SAVE_MS,
} from '../src/lib/threads';

const turns = (content: string): Turn[] => [{ id: 'a', role: 'assistant', content }];

describe('scheduleSaveTurns', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes once per interval, and the newest copy at that', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    let current = turns('a');
    for (const c of ['a', 'ab', 'abc']) {
      current = turns(c);
      scheduleSaveTurns('t1', () => current);
    }
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TURNS_SAVE_MS);
    expect(setItem).toHaveBeenCalledOnce();
    expect(loadTurns('t1')[0]?.content).toBe('abc');
  });

  it('is withdrawn by a write or a clear made in the meantime', () => {
    scheduleSaveTurns('t1', () => turns('stale'));
    saveTurns('t1', turns('final'));
    scheduleSaveTurns('t2', () => turns('stale'));
    clearTurns('t2');
    vi.advanceTimersByTime(TURNS_SAVE_MS);
    expect(loadTurns('t1')[0]?.content).toBe('final');
    expect(loadTurns('t2')).toEqual([]);
  });

  it('flushes on pagehide', () => {
    scheduleSaveTurns('t1', () => turns('on the way out'));
    window.dispatchEvent(new Event('pagehide'));
    expect(loadTurns('t1')[0]?.content).toBe('on the way out');
  });

  it('never writes back a transcript after its identity is forgotten', () => {
    scheduleSaveTurns('t1', () => turns('the last person'));
    forgetIdentityState();
    vi.advanceTimersByTime(TURNS_SAVE_MS);
    expect(localStorage.getItem('felix.turns:t1')).toBeNull();
  });

  it('keeps going when storage is full', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => saveTurns('t1', turns('x'))).not.toThrow();
    scheduleSaveTurns('t1', () => turns('y'));
    expect(() => vi.advanceTimersByTime(TURNS_SAVE_MS)).not.toThrow();
  });
});
