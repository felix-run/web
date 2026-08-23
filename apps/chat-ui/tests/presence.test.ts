/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armNotifications, resetPresence, setPresence } from '@/lib/presence';

interface Constructed {
  title: string;
  body?: string;
}

function stubNotification(permission: string, calls: Constructed[]) {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    close = vi.fn();
    constructor(title: string, opts?: { body?: string }) {
      calls.push({ title, body: opts?.body });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return FakeNotification;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

describe('presence', () => {
  let calls: Constructed[];

  beforeEach(() => {
    calls = [];
    resetPresence();
    document.title = 'Felix';
    setHidden(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reflects state in the document title', () => {
    setPresence('working');
    expect(document.title).toContain('Working');
    setPresence('blocked');
    expect(document.title).toContain('Approve');
    setPresence('idle');
    expect(document.title).toBe('Felix');
  });

  it('notifies once on entering blocked while hidden', () => {
    stubNotification('granted', calls);
    setHidden(true);
    setPresence('working');
    setPresence('blocked');
    // Repeated calls with the same state are a no-op: the effect driving this
    // re-runs on every queue change.
    setPresence('blocked');
    setPresence('blocked');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe('Approval needed');
  });

  it('stays silent while the tab is visible', () => {
    stubNotification('granted', calls);
    setHidden(false);
    setPresence('working');
    setPresence('blocked');
    expect(calls).toHaveLength(0);
    // The banner is on screen; only the title carries it.
    expect(document.title).toContain('Approve');
  });

  it('announces the end of a run that was in flight', () => {
    stubNotification('granted', calls);
    setHidden(true);
    setPresence('working');
    setPresence('idle');
    expect(calls.map((c) => c.title)).toEqual(['Run finished']);
  });

  it('does not announce idle when nothing was running', () => {
    stubNotification('granted', calls);
    setHidden(true);
    setPresence('idle');
    expect(calls).toHaveLength(0);
  });

  it('never notifies without permission', () => {
    stubNotification('default', calls);
    setHidden(true);
    setPresence('blocked');
    expect(calls).toHaveLength(0);
  });

  it('survives an environment with no Notification API', () => {
    vi.stubGlobal('Notification', undefined);
    setHidden(true);
    expect(() => setPresence('blocked')).not.toThrow();
  });

  it('does not re-prompt when permission is already settled', async () => {
    const granted = stubNotification('granted', calls);
    await expect(armNotifications()).resolves.toBe(true);
    expect(granted.requestPermission).not.toHaveBeenCalled();

    const denied = stubNotification('denied', calls);
    await expect(armNotifications()).resolves.toBe(false);
    expect(denied.requestPermission).not.toHaveBeenCalled();

    const undecided = stubNotification('default', calls);
    undecided.requestPermission.mockResolvedValueOnce('granted');
    await expect(armNotifications()).resolves.toBe(true);
    expect(undecided.requestPermission).toHaveBeenCalledTimes(1);

    vi.stubGlobal('Notification', undefined);
    await expect(armNotifications()).resolves.toBe(false);
  });
});
