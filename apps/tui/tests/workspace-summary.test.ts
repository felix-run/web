import { describe, expect, it } from 'bun:test';
import type { ToolCall, Turn } from '@felix/client';
import { summarizeWorkspace } from '../src/workspace-summary';

const turn = (...tools: ToolCall[]): Turn => ({
  id: 'summary',
  role: 'assistant',
  content: 'All tests passed!',
  tools,
});
const call = (name: string, output: unknown, input: unknown = {}): ToolCall => ({
  name,
  output,
  input,
  done: true,
});

describe('workspace results', () => {
  it('does not count a pending approval as a completed write', () => {
    const summary = summarizeWorkspace(
      turn(call('local_write', '[approval required] request pending', { path: 'a.ts' })),
    );
    expect(summary?.files).toEqual([]);
    expect(summary?.unconfirmed).toEqual(['write a.ts']);
  });

  it('does not derive successful checks from model prose or read-only tools', () => {
    expect(summarizeWorkspace(turn())).toBeNull();
    expect(summarizeWorkspace(turn(call('local_read', 'content', { path: 'file.ts' })))).toBeNull();
  });

  it('separates observed mutations from commands, and includes rename destinations', () => {
    const summary = summarizeWorkspace(
      turn(
        call('client · local_edit', '{"replacements":1}', { path: 'src/a.ts' }),
        call('local_rename', '{"path":"a","to_path":"b"}', { path: 'a', to_path: 'b' }),
        call('local_shell', '12 tests passed', { command: 'npm test' }),
      ),
    );
    expect(summary?.files).toEqual(['edit src/a.ts', 'rename a → b']);
    expect(summary?.commands).toEqual(['npm test']);
  });

  it('never counts failures, denied calls or missing results as completed operations', () => {
    const summary = summarizeWorkspace(
      turn(
        call('local_edit', 'error: file changed', { path: 'a.ts' }),
        call('local_shell', '[tool error/provider_error] command exited with code 1', {
          command: 'npm test',
        }),
        call('local_write', '[plan mode] local_write can change things', { path: 'b.ts' }),
        call('local_shell', undefined, { command: 'npm run build' }),
        { ...call('local_delete', undefined, { path: 'old.ts' }), done: false },
      ),
    );
    expect(summary?.files).toEqual([]);
    expect(summary?.commands).toEqual([]);
    expect(summary?.issues).toHaveLength(3);
    expect(summary?.unconfirmed).toEqual(['npm run build', 'delete old.ts']);
  });

  it('keeps failed attempts visible when a later retry succeeds', () => {
    const summary = summarizeWorkspace(
      turn(
        call('local_shell', 'error: unsupported command', { command: 'npm test' }),
        call('local_shell', 'passed', { command: 'npm test' }),
      ),
    );
    expect(summary?.commands).toEqual(['npm test']);
    expect(summary?.issues).toHaveLength(1);
  });

  it('uses the latest observed plan state and retains blocked steps', () => {
    const plan = (status: string) =>
      JSON.stringify({
        id: 'p',
        plan: {
          title: 'Build',
          steps: [
            { id: '1', title: 'Implement', status },
            { id: '2', title: 'Verify', status: 'blocked', note: 'missing credentials' },
          ],
        },
      });
    const summary = summarizeWorkspace(
      turn(
        call('plan_create', plan('pending')),
        call('local_edit', 'edited', { path: 'a.ts' }),
        call('plan_update_step', plan('done')),
      ),
    );
    expect(summary?.remaining).toEqual(['Verify · missing credentials']);
  });
});
