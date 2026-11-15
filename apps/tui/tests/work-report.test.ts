import { describe, expect, it } from 'bun:test';
import type { ToolCall, Turn } from '@felix/client';
import { workReport } from '../src/work-report';

const turn = (...tools: ToolCall[]): Turn => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content: 'Tests passed!',
  tools,
});
const tool = (name: string, output: unknown, input: unknown = {}): ToolCall => ({
  name,
  output,
  input,
  done: true,
});
const plan = (status: string) =>
  tool(
    'plan_get',
    JSON.stringify({
      id: 'build',
      plan: {
        title: 'Ship fix',
        steps: [
          { id: '1', title: 'Implement', status },
          { id: '2', title: 'Verify', status: 'blocked', note: 'missing dependency' },
        ],
      },
    }),
  );

describe('work report', () => {
  it('combines tool history and the latest plan across continuation turns', () => {
    const report = workReport(
      [
        turn(plan('pending'), tool('local_edit', 'edited', { path: 'src/a.ts' })),
        turn(tool('local_shell', '[tool error/provider_error] exit 1', { command: 'npm test' })),
        turn(plan('done'), tool('local_shell', 'passed', { command: 'npm test' })),
      ],
      'coding-thread',
    );
    expect(report).toContain('File operations (1)');
    expect(report).toContain('Commands completed (1)');
    expect(report).toContain('Failed or refused attempts (1)');
    expect(report).toContain('Unfinished steps in latest recorded plans (1)');
    expect(report).toContain('Ship fix: Verify [blocked] · missing dependency');
    expect(report).not.toContain('Ship fix: Implement');
  });

  it('does not infer checks from prose, user content or absent results', () => {
    const report = workReport(
      [
        { id: 'u', role: 'user', content: 'run tests' },
        turn(),
        turn(tool('local_shell', undefined, { command: 'npm test' })),
      ],
      't',
    );
    expect(report).toContain('Commands completed (0)');
    expect(report).toContain('Unconfirmed operations (1)');
    expect(report).toContain('No saved plan was observed');
  });

  it('bounds large histories and neutralizes terminal control characters', () => {
    const tools = Array.from({ length: 205 }, (_, i) =>
      tool('local_write', 'wrote', { path: `file-${i}.ts` }),
    );
    const report = workReport([turn(...tools)], 't\u001b[31m');
    expect(report).toContain('File operations (205)');
    expect(report).toContain('5 more; see the transcript');
    expect(report).not.toContain('\u001b');
    expect(report).not.toContain('file-204.ts');
  });
});
