import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Textarea } from '@felix/ui/textarea';
import { LoaderIcon, PlayIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { startWorkflowRun, WorkflowRouteError } from '@/api';
import { ErrorNotice } from '@/components/error-notice';
import type { WorkflowRecord, WorkflowRun } from '@/types';

type Field =
  | { kind: 'text' }
  | { kind: 'number'; integer: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'json' };

/** The control an input's schema asks for: a field for text and numbers, a choice, else JSON. */
function fieldFor(schema: Record<string, unknown>): Field {
  const values = schema.enum;
  if (Array.isArray(values) && values.length && values.every((v) => typeof v === 'string')) {
    return { kind: 'enum', values: values as string[] };
  }
  switch (schema.type) {
    case 'string':
      return { kind: 'text' };
    case 'integer':
      return { kind: 'number', integer: true };
    case 'number':
      return { kind: 'number', integer: false };
    case 'boolean':
      return { kind: 'boolean' };
    default:
      return { kind: 'json' };
  }
}

/** The value a field's text stands for, or an `Error` naming what is wrong with it. */
function parse(field: Field, text: string): unknown {
  switch (field.kind) {
    case 'text':
      return text;
    case 'enum':
      // The harness checks that every input is there, not what it holds: an unchosen case would
      // reach a branch or a prompt as the empty string.
      return field.values.includes(text) ? text : new Error(`one of ${field.values.join(', ')}`);
    case 'boolean':
      return text === 'true';
    case 'number': {
      const n = Number(text);
      if (text.trim() === '' || !Number.isFinite(n)) return new Error('a number');
      if (field.integer && !Number.isInteger(n)) return new Error('a whole number');
      return n;
    }
    case 'json':
      try {
        return JSON.parse(text);
      } catch {
        return new Error('JSON');
      }
  }
}

/** What a refused start says, from the harness's own code. */
function refusal(err: unknown): string | null {
  if (!(err instanceof WorkflowRouteError)) return null;
  const detail = (err.detail ?? {}) as {
    problems?: { message: string }[];
    missing?: string[];
    unknown?: string[];
    manifest?: string;
    limit?: number;
  };
  switch (err.code) {
    case 'not_runnable':
      return `It cannot run: ${(detail.problems ?? []).map((p) => p.message).join('; ') || 'it has problems'}.`;
    case 'bad_inputs':
      return [
        detail.missing?.length ? `missing ${detail.missing.join(', ')}` : '',
        detail.unknown?.length ? `not inputs of this workflow: ${detail.unknown.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ');
    case 'workflow_changed':
      return 'The workflow was saved again since this page loaded it. Reload to run the new revision.';
    case 'not_permitted':
      return `You may not run manifest ${detail.manifest ?? 'a step names'}.`;
    case 'too_many_runs':
      return `This tenant already has ${detail.limit ?? 'the most'} runs going.`;
    default:
      return null;
  }
}

/** Run now: one field per workflow input, built from its schema, and a start pinned to this revision. */
export function RunNowForm({
  workflow,
  onStarted,
}: {
  workflow: WorkflowRecord;
  onStarted: (run: WorkflowRun) => void;
}) {
  const inputs = Object.entries(workflow.definition.inputs ?? {});
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      inputs.map(([name, schema]) => [name, fieldFor(schema).kind === 'boolean' ? 'false' : '']),
    ),
  );
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const values: Record<string, unknown> = {};
    const bad: Record<string, string> = {};
    for (const [name, schema] of inputs) {
      const value = parse(fieldFor(schema), text[name] ?? '');
      if (value instanceof Error) bad[name] = `Expected ${value.message}.`;
      else values[name] = value;
    }
    setInvalid(bad);
    if (Object.keys(bad).length) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await startWorkflowRun(workflow.id, values, workflow.revision));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const said = error ? refusal(error) : null;
  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={`${formId}-note`}>
      {inputs.length === 0 ? (
        <p className="text-sm text-muted-foreground">This workflow takes no inputs.</p>
      ) : (
        inputs.map(([name, schema]) => {
          const field = fieldFor(schema);
          const id = `${formId}-${name}`;
          const value = text[name] ?? '';
          const set = (v: string) => setText((t) => ({ ...t, [name]: v }));
          return (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={id} className="gap-2">
                <span className="font-mono">{name}</span>
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  {field.kind === 'enum' ? field.values.join(' | ') : String(schema.type ?? 'any')}
                </span>
              </Label>
              {field.kind === 'enum' || field.kind === 'boolean' ? (
                <Select value={value} onValueChange={set}>
                  <SelectTrigger
                    id={id}
                    className="w-full"
                    aria-invalid={Boolean(invalid[name])}
                    aria-describedby={invalid[name] ? `${id}-error` : undefined}
                  >
                    <SelectValue placeholder={`Choose ${name}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.kind === 'enum' ? field.values : ['true', 'false']).map((v) => (
                      <SelectItem key={v} value={v} className="font-mono">
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.kind === 'json' ? (
                <Textarea
                  size="sm"
                  id={id}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="min-h-20 font-mono"
                  aria-invalid={Boolean(invalid[name])}
                  aria-describedby={invalid[name] ? `${id}-error` : undefined}
                />
              ) : (
                <Input
                  id={id}
                  value={value}
                  inputMode={field.kind === 'number' ? 'decimal' : undefined}
                  onChange={(e) => set(e.target.value)}
                  aria-invalid={Boolean(invalid[name])}
                  aria-describedby={invalid[name] ? `${id}-error` : undefined}
                />
              )}
              {invalid[name] ? (
                <p id={`${id}-error`} className="text-xs text-state-failed">
                  {invalid[name]}
                </p>
              ) : null}
            </div>
          );
        })
      )}
      {error ? (
        said ? (
          <p className="text-sm text-state-failed">{said}</p>
        ) : (
          <ErrorNotice error={error} doing="start the run" />
        )
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderIcon className="animate-spin" /> : <PlayIcon />}
          Start run
        </Button>
        <p id={`${formId}-note`} className="text-xs text-muted-foreground">
          Runs revision <span className="font-mono">{workflow.revision}</span>, as you, with your
          scopes.
        </p>
      </div>
    </form>
  );
}
