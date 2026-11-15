import { classifyToolResult, fileToolOp, plansInTurn, type Turn } from '@felix/client';

export interface WorkspaceSummary {
  files: string[];
  commands: string[];
  issues: string[];
  unconfirmed: string[];
  remaining: string[];
}

/** Observed tool outcomes only: prose is never evidence that a check passed. */
export function summarizeWorkspace(turn: Turn): WorkspaceSummary | null {
  const summary: WorkspaceSummary = {
    files: [],
    commands: [],
    issues: [],
    unconfirmed: [],
    remaining: [],
  };
  let relevant = false;
  for (const tool of turn.tools ?? []) {
    const name = tool.name.replace(/^client · /, '');
    const op = fileToolOp(name);
    const mutation = op === 'write' || op === 'edit' || op === 'delete' || op === 'rename';
    if (!mutation && name !== 'local_shell') continue;
    relevant = true;
    const args =
      tool.input && typeof tool.input === 'object' ? (tool.input as Record<string, unknown>) : {};
    const path = typeof args.path === 'string' ? args.path : '(path unavailable)';
    const command = typeof args.command === 'string' ? args.command : '(command unavailable)';
    const label = mutation
      ? `${op} ${path}${op === 'rename' ? ` → ${typeof args.to_path === 'string' ? args.to_path : '(destination unavailable)'}` : ''}`
      : command;
    if (
      !tool.done ||
      typeof tool.output !== 'string' ||
      !tool.output.trim() ||
      tool.output.startsWith('[approval required]')
    ) {
      summary.unconfirmed.push(label);
      continue;
    }
    // Local tools historically returned plain error text. Treat it conservatively
    // even for shell calls; current clients additionally emit typed error markers.
    const issue =
      classifyToolResult(name, tool.output) ?? classifyToolResult('local_read', tool.output);
    if (issue) summary.issues.push(`${label}: ${issue.label}`);
    else if (mutation) summary.files.push(label);
    else summary.commands.push(label);
  }
  if (!relevant) return null;
  for (const plan of plansInTurn(turn.tools).latest.values()) {
    for (const step of plan.steps) {
      if (step.state !== 'done')
        summary.remaining.push(`${step.title}${step.note ? ` · ${step.note}` : ''}`);
    }
  }
  return summary;
}
