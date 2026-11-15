import { type PlanState, plansInTurn, type Turn } from '@felix/client';
import { oneLine } from './text.js';
import { summarizeWorkspace } from './workspace-summary.js';

const MAX_ROWS = 200;

/** A local report from loaded history; no model, repository command, or file write. */
export function workReport(turns: readonly Turn[], threadId: string): string {
  const files: string[] = [];
  const commands: string[] = [];
  const issues: string[] = [];
  const unconfirmed: string[] = [];
  const plans = new Map<string, PlanState>();
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    const summary = summarizeWorkspace(turn);
    if (summary) {
      files.push(...summary.files);
      commands.push(...summary.commands);
      issues.push(...summary.issues);
      unconfirmed.push(...summary.unconfirmed);
    }
    for (const [id, plan] of plansInTurn(turn.tools).latest) plans.set(id, plan);
  }
  // Tool arguments and instruction-derived titles are data, including control bytes.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal control bytes from tool-derived labels.
  const line = (text: string) => oneLine(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '), 400);
  const lines = [
    'Coding work · loaded thread history',
    `Thread: ${line(threadId)}`,
    '',
    'Recorded operations, not a live Git diff. Completed commands do not establish that tests passed.',
    'Failed or refused attempts remain in history even when a later retry succeeds.',
  ];
  const section = (title: string, entries: string[]) => {
    lines.push('', `${title} (${entries.length})`);
    lines.push(...entries.slice(0, MAX_ROWS).map((entry) => `  ${line(entry)}`));
    if (!entries.length) lines.push('  None recorded.');
    if (entries.length > MAX_ROWS)
      lines.push(`  … ${entries.length - MAX_ROWS} more; see the transcript.`);
  };
  section('File operations', files);
  section('Commands completed', commands);
  section('Failed or refused attempts', issues);
  section('Unconfirmed operations', unconfirmed);
  const remaining: string[] = [];
  for (const plan of plans.values()) {
    for (const step of plan.steps) {
      if (step.state !== 'done')
        remaining.push(
          `${plan.title}: ${step.title} [${step.status}]${step.note ? ` · ${step.note}` : ''}`,
        );
    }
  }
  section('Unfinished steps in latest recorded plans', remaining);
  if (!plans.size) lines.push('  No saved plan was observed in loaded history.');
  return lines.join('\n');
}
