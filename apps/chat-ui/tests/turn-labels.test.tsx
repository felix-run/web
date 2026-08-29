/** @vitest-environment happy-dom */
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '../src/components/chat/message';
import type { Turn } from '../src/types';

/**
 * Naming a turn.
 *
 * `POST /chat/sessions/label` has always existed and nothing called it, because
 * nothing could read a label back either: the snapshot has always carried a
 * `labels` map and `SessionSnapshot` did not model the field. Writing without
 * reading is not a feature, so these cover the pair — the chip is visible
 * without hovering, and the control sends what was typed.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const turn: Turn = {
  id: 't1',
  role: 'assistant',
  content: 'the answer',
  eventId: 'evt-9',
  tools: [],
};

describe('a labelled turn', () => {
  it('shows the label outside the hover-only actions row', () => {
    render(<Message turn={turn} label="where it went wrong" />);
    // Present in the document, not merely reachable by hovering: the point of
    // the label is finding the turn again by scrolling.
    expect(screen.getByText('where it went wrong')).toBeTruthy();
  });

  it('offers no label control on a turn the server has no id for', () => {
    const { eventId: _drop, ...unsent } = turn;
    render(<Message turn={unsent as Turn} />);
    expect(screen.queryByLabelText(/label this message/i)).toBeNull();
  });

  it('sends what was typed', () => {
    const onLabel = vi.fn();
    render(<Message turn={turn} onLabel={onLabel} />);

    fireEvent.click(screen.getByLabelText('Label this message'));
    fireEvent.change(screen.getByLabelText('Label for this message'), {
      target: { value: '  the good one  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onLabel).toHaveBeenCalledWith('the good one');
  });

  it('saves on enter, and abandons the edit on escape', () => {
    const onLabel = vi.fn();
    render(<Message turn={turn} onLabel={onLabel} />);

    fireEvent.click(screen.getByLabelText('Label this message'));
    const field = screen.getByLabelText('Label for this message');
    fireEvent.change(field, { target: { value: 'keep' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onLabel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Label this message'));
    fireEvent.change(screen.getByLabelText('Label for this message'), {
      target: { value: 'keep' },
    });
    fireEvent.keyDown(screen.getByLabelText('Label for this message'), { key: 'Enter' });
    expect(onLabel).toHaveBeenCalledWith('keep');
  });

  /** The route takes `null` to clear one, and blank is what someone types. */
  it('clears the label when the field is emptied', () => {
    const onLabel = vi.fn();
    render(<Message turn={turn} label="old" onLabel={onLabel} />);

    fireEvent.click(screen.getByLabelText('Edit this message label'));
    fireEvent.change(screen.getByLabelText('Label for this message'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onLabel).toHaveBeenCalledWith(null);
  });

  it('starts the edit from the label already there', () => {
    render(<Message turn={turn} label="existing" onLabel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Edit this message label'));
    expect((screen.getByLabelText('Label for this message') as HTMLInputElement).value).toBe(
      'existing',
    );
  });
});

describe('setSessionLabel', () => {
  it('sends the thread, the event and the label', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { setSessionLabel } = await import('../src/api');

    await setSessionLabel({ threadId: 'abc', eventId: 'evt-9', label: 'the good one' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/chat/sessions/label');
    expect(JSON.parse(String(init.body))).toEqual({
      thread_id: 'abc',
      event_id: 'evt-9',
      label: 'the good one',
    });
    vi.unstubAllGlobals();
  });

  /** `label: null` is the route's own way to remove one, not an omission. */
  it('clears by sending null rather than by leaving the field out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { setSessionLabel } = await import('../src/api');

    await setSessionLabel({ threadId: 'abc', eventId: 'evt-9', label: null });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.label).toBeNull();
    vi.unstubAllGlobals();
  });
});
