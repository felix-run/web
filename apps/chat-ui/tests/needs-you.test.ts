import type { ThreadMeta } from '@felix/client';
import { describe, expect, it } from 'vitest';
import { needsYouRows, rowKey } from '../src/lib/needs-you';
import type { JobRecord } from '../src/types';

/**
 * What the sidebar's Needs-you band lists, and in what order: what waits on a
 * person, then scheduled jobs that are failing (they ran with nobody watching),
 * then runs going in this tab. A conversation's failed or denied turn is not
 * here — it was seen by whoever ran it, and stays a mark on its row.
 */

const thread = (id: string, title: string, updatedAt = 0): ThreadMeta => ({
  id,
  title,
  manifest: 'cowork',
  updatedAt,
  named: true,
});

const job = (name: string, over: Partial<JobRecord> = {}): JobRecord => ({
  tenant_id: 't',
  name,
  schedule: '*/5 * * * *',
  manifest_id: 'quick',
  last_status: 'ok',
  last_error: '',
  created_at: 0,
  payload: {},
  ...over,
});

const none = new Set<string>();

describe('needsYouRows', () => {
  it('orders waiting, then failing jobs, then running, and lists a thread once', () => {
    const rows = needsYouRows({
      threads: [thread('a', 'Alpha', 2), thread('b', 'Bravo', 1)],
      approvals: [{ thread_id: 'b', tool_name: 'write_file' }],
      blocked: none,
      asking: none,
      // Bravo runs and waits: it is listed as waiting, not twice.
      running: new Set(['a', 'b']),
      jobs: [job('digest', { last_status: 'error', last_run_at: 5 })],
    });
    expect(rows.map(rowKey)).toEqual(['waiting:b', 'job:digest', 'running:a']);
    expect(rows[0]).toMatchObject({ detail: 'write_file', detailIsTool: true });
  });

  it('says what a thread waits on: one call by name, several by count, or a question', () => {
    const rows = needsYouRows({
      threads: [thread('a', 'A', 3), thread('b', 'B', 2), thread('q', 'Q', 1)],
      approvals: [
        { thread_id: 'a', tool_name: 'write_file' },
        { thread_id: 'b', tool_name: 'write_file' },
        { thread_id: 'b', tool_name: 'local_shell' },
      ],
      blocked: new Set(['q']),
      asking: new Set(['q']),
      running: none,
      jobs: [],
    });
    expect(rows.map((r) => (r.kind === 'waiting' ? r.detail : null))).toEqual([
      'write_file',
      '2 approvals',
      'a question',
    ]);
  });

  // `/approvals` names a thread only when there was one; absent and empty are the
  // same. Such a row still waits on a person, so it is a row, not nothing.
  it('gathers approvals no thread owns into one row', () => {
    const rows = needsYouRows({
      threads: [],
      approvals: [
        { thread_id: '', tool_name: 'local_shell' },
        { tool_name: 'write_file' } as { thread_id?: string; tool_name: string },
      ],
      blocked: none,
      asking: none,
      running: none,
      jobs: [],
    });
    expect(rows).toEqual([{ kind: 'unthreaded', count: 2, tool: null }]);
  });

  it('names a thread the index does not hold by its id', () => {
    const [row] = needsYouRows({
      threads: [],
      approvals: [{ thread_id: 'elsewhere', tool_name: 'write_file' }],
      blocked: none,
      asking: none,
      running: none,
      jobs: [],
    });
    expect(row).toMatchObject({ label: { text: 'elsewhere', isId: true } });
  });

  // Once per job however often it fires, and only while it is failing: the Jobs
  // glance's reading, which clears when a run succeeds. A disabled job will not
  // run again until someone chooses to, so it is not waiting on them.
  it('lists each failing job once, newest first, and leaves out a disabled one', () => {
    const rows = needsYouRows({
      threads: [],
      approvals: [],
      blocked: none,
      asking: none,
      running: none,
      jobs: [
        job('fine'),
        job('old', { last_error: 'boom', last_run_at: 1 }),
        job('new', { last_status: 'error', last_run_at: 9 }),
        job('off', { last_status: 'error', last_run_at: 10, enabled: false }),
      ],
    });
    expect(rows.map(rowKey)).toEqual(['job:new', 'job:old']);
  });

  it('is empty when nothing waits, fails or runs — and while the jobs read has not answered', () => {
    expect(
      needsYouRows({
        threads: [thread('a', 'A')],
        approvals: [],
        blocked: none,
        asking: none,
        running: none,
        jobs: undefined,
      }),
    ).toEqual([]);
  });
});
