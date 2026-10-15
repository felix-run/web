import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Textarea } from '@felix/ui/textarea';
import { PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { listWorkflowTools } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import { Fact, Facts, PageSection } from '@/components/harness/panel';
import { relTime } from '@/components/inspector/primitives';
import { kindIcon, kindWord } from '@/components/workflows/step-node';
import type { SaveConflict } from '@/components/workflows/use-workflow-draft';
import { Problems } from '@/components/workflows/workflow-inspector';
import {
  addInput,
  describeDifferences,
  disconnect,
  edgeId,
  edgesInto,
  INPUT_TYPES,
  inputNameProblem,
  inputTypeOf,
  removeInput,
  removeStep,
  renameInput,
  renameStep,
  setInputType,
  stepIdProblem,
  updateStep,
  wouldCycle,
} from '@/lib/workflow-draft';
import { nodeIdsOf, stepsOf, TRIGGER } from '@/lib/workflow-layout';
import type {
  WorkflowDefinition,
  WorkflowKind,
  WorkflowPort,
  WorkflowPortRef,
  WorkflowRecord,
  WorkflowStepDef,
  WorkflowTool,
} from '@/types';

type Edit = (change: (def: WorkflowDefinition) => WorkflowDefinition) => void;
type Wire = (edge: { source: WorkflowPortRef; target: WorkflowPortRef }) => void;

/** The kinds the console draws first, in this order; any other the harness lists follows. */
const BUILT_IN = ['agent_turn', 'tool_call', 'approval', 'branch'];

/**
 * The step palette: every kind the harness can run (`GET /workflows/-/kinds`), built in or a
 * plugin's. Pressing one adds that step beside the selected node and selects it, so the keyboard
 * builds a graph the same way a pointer does.
 */
export function StepPalette({
  kinds,
  error,
  onAdd,
  className,
}: {
  kinds: WorkflowKind[] | undefined;
  error: unknown;
  onAdd: (kind: string) => void;
  className?: string;
}) {
  const ordered = [...(kinds ?? [])].sort(
    (a, b) =>
      (BUILT_IN.indexOf(a.name) + 1 || BUILT_IN.length + 1) -
      (BUILT_IN.indexOf(b.name) + 1 || BUILT_IN.length + 1),
  );
  return (
    <nav aria-label="Add a step" className={className}>
      <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground max-lg:sr-only">
        Add a step
      </h2>
      {error ? <ErrorNotice error={error} doing="list the step kinds" /> : null}
      {!kinds && !error ? <p className="px-1 text-sm text-muted-foreground">Loading…</p> : null}
      <ul className="flex gap-1 lg:flex-col max-lg:flex-wrap">
        {ordered.map((k) => {
          const Icon = kindIcon(k.name);
          return (
            <li key={k.name}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onAdd(k.name)}
              >
                <Icon aria-hidden />
                {BUILT_IN.includes(k.name) ? kindWord(k.name) : k.label || k.name}
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A JSON field: edited as text, applied when it parses, and said so when it does not. */
function JsonField({
  label,
  value,
  onChange,
  hint,
  optional = false,
  refuse,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  hint?: string;
  optional?: boolean;
  /** Why a parsed value will not do, or null when it will. */
  refuse?: (value: unknown) => string | null;
}) {
  const id = useId();
  const shown = value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState<string | null>(null);
  // A change from elsewhere — another field, Take theirs — replaces what is typed here.
  useEffect(() => {
    setText(shown);
    setBad(null);
  }, [shown]);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Passing through a field changes nothing: no draft for an unchanged value.
          if (text === shown) return;
          if (optional && !text.trim()) {
            setBad(null);
            onChange(undefined);
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            setBad('Not JSON: kept as it was.');
            return;
          }
          const why = refuse?.(parsed) ?? null;
          setBad(why ? `${why} Kept as it was.` : null);
          if (!why) onChange(parsed);
        }}
        className="min-h-24 font-mono text-xs"
        aria-invalid={Boolean(bad)}
        aria-describedby={`${id}-note`}
      />
      <p
        id={`${id}-note`}
        className={bad ? 'text-xs text-state-failed' : 'text-xs text-muted-foreground'}
      >
        {bad ?? hint}
      </p>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  hint,
  mono = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  hint?: string;
  mono?: boolean;
  /** The harness's own limit for the field, so a draft never fails to parse on length. */
  maxLength?: number;
}) {
  const id = useId();
  const props = {
    id,
    value,
    maxLength,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    'aria-describedby': hint ? `${id}-note` : undefined,
    className: mono ? 'font-mono' : undefined,
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? <Textarea {...props} className="min-h-24" /> : <Input {...props} />}
      {hint ? (
        <p id={`${id}-note`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A field whose text stands for something else — a number, a list, a value that may not be empty.
 * What is typed stays as typed; it reaches the draft only when `commit` accepts it, and when it
 * does not the field says why. A change from elsewhere (Take theirs) replaces the text unless the
 * field is being typed in.
 */
function ParsedField({
  label,
  shown,
  commit,
  hint,
  mono = false,
  maxLength,
  inputMode,
}: {
  label: string;
  /** The draft's value, as text. */
  shown: string;
  /** Apply `text` to the draft, or say why it cannot be. */
  commit: (text: string) => string | null;
  hint?: string;
  mono?: boolean;
  maxLength?: number;
  inputMode?: 'numeric';
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    setText(shown);
    setError(null);
  }, [shown]);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={ref}
        id={id}
        value={text}
        maxLength={maxLength}
        inputMode={inputMode}
        className={mono ? 'font-mono' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setError(commit(e.target.value));
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-note`}
      />
      <p
        id={`${id}-note`}
        className={error ? 'text-xs text-state-failed' : 'text-xs text-muted-foreground'}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

/** A manifest, chosen from the ones this console knows, or typed when it knows none. */
function ManifestField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const choices = value && !options.includes(value) ? [value, ...options] : options;
  if (!choices.length) {
    return <TextField label="Manifest" value={value} onChange={onChange} mono />;
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Manifest</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full font-mono">
          <SelectValue placeholder="Choose a manifest…" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((m) => (
            <SelectItem key={m} value={m} className="font-mono">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The tool a tool step calls, from what its manifest binds for the person editing. */
function ToolField({
  manifest,
  value,
  onPick,
}: {
  manifest: string;
  value: string;
  onPick: (tool: WorkflowTool) => void;
}) {
  const id = useId();
  const [tools, setTools] = useState<WorkflowTool[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setTools(null);
    setError(null);
    if (!manifest) return;
    let live = true;
    listWorkflowTools(manifest).then(
      (items) => live && setTools(items),
      (err: unknown) => live && setError(err),
    );
    return () => {
      live = false;
    };
  }, [manifest]);
  if (!manifest) {
    return <p className="text-sm text-muted-foreground">Choose a manifest for its tools.</p>;
  }
  if (error) return <ErrorNotice error={error} doing={`list ${manifest}'s tools`} />;
  if (!tools) return <p className="text-sm text-muted-foreground">Listing {manifest}'s tools…</p>;
  const picked = tools.find((t) => t.name === value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Tool</Label>
      <Select
        value={value || undefined}
        onValueChange={(name) => {
          const tool = tools.find((t) => t.name === name);
          if (tool) onPick(tool);
        }}
      >
        <SelectTrigger id={id} className="w-full font-mono">
          <SelectValue
            placeholder={tools.length ? 'Choose a tool…' : 'This manifest binds no tools'}
          />
        </SelectTrigger>
        <SelectContent>
          {tools.map((t) => (
            <SelectItem
              key={t.name}
              value={t.name}
              disabled={t.inputs === null}
              className="font-mono"
            >
              {t.name}
              {t.inputs === null ? ` — ${t.problem ?? 'cannot be a step'}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {picked?.description ? (
        <p className="text-xs text-muted-foreground">{picked.description}</p>
      ) : null}
      {value && !picked ? (
        <p className="text-xs text-state-failed">
          {manifest} no longer binds <span className="font-mono">{value}</span> for you.
        </p>
      ) : null}
    </div>
  );
}

/** The fields a step's kind takes. A kind this console has no form for edits its config as JSON. */
function ConfigForm({
  step,
  edit,
  manifestOptions,
}: {
  step: WorkflowStepDef;
  edit: Edit;
  manifestOptions: string[];
}) {
  const config = step.config ?? {};
  const set = (patch: Record<string, unknown>) =>
    edit((d) => {
      const merged: Record<string, unknown> = { ...config, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete merged[k];
      return updateStep(d, step.id, { config: merged });
    });
  const str = (k: string) => (typeof config[k] === 'string' ? (config[k] as string) : '');
  switch (step.kind) {
    case 'agent_turn':
      return (
        <div className="space-y-3">
          <ManifestField
            value={str('manifest')}
            options={manifestOptions}
            onChange={(manifest) => set({ manifest })}
          />
          <TextField
            label="Prompt"
            value={str('prompt')}
            onChange={(prompt) => set({ prompt })}
            multiline
            maxLength={20_000}
            hint="Each {{ name }} becomes an input port of this step."
          />
          <JsonField
            label="Output schema"
            value={config.output_schema}
            onChange={(output_schema) => set({ output_schema })}
            optional
            hint="Optional. An object schema: each property becomes an output port; empty, the step outputs text."
          />
        </div>
      );
    case 'tool_call':
      return (
        <div className="space-y-3">
          <ManifestField
            value={str('manifest')}
            options={manifestOptions}
            // Another manifest's tools are other tools: the wiring snapshot goes with the old one.
            onChange={(manifest) =>
              set({ manifest, tool: undefined, input_schema: undefined, args: undefined })
            }
          />
          <ToolField
            manifest={str('manifest')}
            value={str('tool')}
            onPick={(tool) =>
              set({ tool: tool.name, input_schema: tool.input_schema, args: config.args ?? {} })
            }
          />
          <JsonField
            label="Fixed arguments"
            value={config.args ?? {}}
            onChange={(args) => set({ args })}
            hint="A property fixed here is not an input port."
          />
        </div>
      );
    case 'approval':
      return (
        <div className="space-y-3">
          <TextField
            label="What the reviewer is asked"
            value={str('prompt')}
            onChange={(prompt) => set({ prompt })}
            multiline
            maxLength={2000}
            hint="Shown beside the payload the step receives."
          />
          <ParsedField
            label="Expires after (seconds)"
            shown={typeof config.ttl_seconds === 'number' ? String(config.ttl_seconds) : ''}
            inputMode="numeric"
            commit={(v) => {
              if (!v.trim()) {
                set({ ttl_seconds: undefined });
                return null;
              }
              const n = Number(v);
              if (!Number.isInteger(n) || n < 1 || n > 3600)
                return 'A whole number from 1 to 3600.';
              set({ ttl_seconds: n });
              return null;
            }}
            hint="1 to 3600. Empty: the harness default. Nobody deciding fails the step."
          />
        </div>
      );
    case 'branch':
      return (
        <ParsedField
          label="Cases"
          shown={Array.isArray(config.cases) ? (config.cases as string[]).join(', ') : ''}
          commit={(v) => {
            set({
              cases: v
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean),
            });
            return null;
          }}
          mono
          hint="Comma-separated. Empty: routes a boolean to true or false; otherwise a string to its case, else default."
        />
      );
    default:
      return (
        <JsonField
          label="Config"
          value={config}
          refuse={(v) =>
            v && typeof v === 'object' && !Array.isArray(v) ? null : 'A config is a JSON object.'
          }
          onChange={(v) =>
            edit((d) => updateStep(d, step.id, { config: v as Record<string, unknown> }))
          }
          hint={`The config ${step.kind} takes; the check below says what it makes of it.`}
        />
      );
  }
}

/** A step's id, renamed on Enter or leaving the field, once it is one the schema takes. */
function StepIdField({
  def,
  step,
  edit,
  onRenamed,
}: {
  def: WorkflowDefinition;
  step: WorkflowStepDef;
  edit: Edit;
  onRenamed: (id: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(step.id);
  useEffect(() => setText(step.id), [step.id]);
  const problem = text === step.id ? null : stepIdProblem(def, text, step.id);
  const commit = () => {
    if (text === step.id || problem) return;
    edit((d) => renameStep(d, step.id, text));
    onRenamed(text);
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Id</Label>
      <Input
        id={id}
        value={text}
        className="font-mono"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(step.id);
        }}
        aria-invalid={Boolean(problem)}
        aria-describedby={`${id}-note`}
      />
      <p
        id={`${id}-note`}
        className={problem ? 'text-xs text-state-failed' : 'text-xs text-muted-foreground'}
      >
        {problem ?? 'Wires and runs name the step by it.'}
      </p>
    </div>
  );
}

/**
 * Each input port and what feeds it, with a *Connect from…* list of every output that may: the
 * keyboard's way to wire, and the pointer's way to wire a port off screen.
 */
function PortWiring({
  record,
  step,
  edit,
  wire,
}: {
  record: WorkflowRecord;
  step: WorkflowStepDef;
  edit: Edit;
  wire: Wire;
}) {
  const def = record.definition;
  const ports = record.ports[step.id];
  if (!ports) {
    return (
      <p className="text-sm text-muted-foreground">
        Its ports are known once its config is valid; the problems below say what is missing.
      </p>
    );
  }
  if (!ports.inputs.length) return <p className="text-sm text-muted-foreground">No inputs.</p>;
  const nameOf = (id: string) =>
    id === TRIGGER ? 'inputs' : stepsOf(def).find((s) => s.id === id)?.name || id;
  const sourcesFor = (into: WorkflowPort) =>
    nodeIdsOf(def)
      .filter((n) => n !== step.id && !wouldCycle(def, n, step.id))
      .flatMap((n) =>
        (record.ports[n]?.outputs ?? [])
          .filter((out) => out.control === into.control)
          .map((out) => ({ node: n, port: out })),
      );
  return (
    <ul className="space-y-3">
      {ports.inputs.map((into) => {
        const feeding = edgesInto(def, step.id, into.name);
        const options = sourcesFor(into);
        return (
          <li key={into.name} className="space-y-1.5">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-mono">
                {into.name}
                {into.required ? <span className="text-muted-foreground">*</span> : null}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {into.control ? 'control' : into.type}
              </span>
            </div>
            {feeding.map((e) => (
              <div key={edgeId(e)} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  from{' '}
                  <span className="font-mono">
                    {nameOf(e.source.step)}.{e.source.port}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Disconnect ${e.source.step}.${e.source.port} from ${into.name}`}
                  onClick={() => edit((d) => disconnect(d, [edgeId(e)]))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            {options.length ? (
              <Select
                value=""
                onValueChange={(v) => {
                  const [node, port] = v.split('\u0000');
                  wire({
                    source: { step: node, port },
                    target: { step: step.id, port: into.name },
                  });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-label={`Connect ${into.name} from`}
                >
                  <SelectValue
                    placeholder={
                      feeding.length && into.name !== 'when' ? 'Rewire from…' : 'Connect from…'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {options.map(({ node, port }) => (
                    <SelectItem key={`${node}.${port.name}`} value={`${node}\u0000${port.name}`}>
                      <span className="font-mono">
                        {nameOf(node)}.{port.name}
                      </span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {port.control ? 'control' : port.type}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : feeding.length ? null : (
              <p className="text-xs text-muted-foreground">Nothing upstream can feed it.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The selected step, editable: what it is, how it is configured, and what feeds it. */
export function StepEditor({
  record,
  step,
  edit,
  wire,
  manifestOptions,
  onSelect,
}: {
  record: WorkflowRecord;
  step: WorkflowStepDef;
  edit: Edit;
  wire: Wire;
  manifestOptions: string[];
  onSelect: (stepId: string | null) => void;
}) {
  const problems = record.problems.filter((p) => p.step === step.id);
  return (
    <>
      <PageSection
        title={step.name || step.id}
        meta={kindWord(step.kind)}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              edit((d) => removeStep(d, step.id));
              onSelect(null);
            }}
          >
            <Trash2Icon />
            Delete step
          </Button>
        }
      >
        <div className="space-y-3">
          <TextField
            label="Name"
            value={step.name ?? ''}
            onChange={(name) => edit((d) => updateStep(d, step.id, { name }))}
            maxLength={200}
            hint="What the canvas and a run call it; empty, its id."
          />
          <StepIdField def={record.definition} step={step} edit={edit} onRenamed={onSelect} />
          <ConfigForm step={step} edit={edit} manifestOptions={manifestOptions} />
        </div>
      </PageSection>
      <PageSection title="Inputs">
        <PortWiring record={record} step={step} edit={edit} wire={wire} />
      </PageSection>
      {problems.length ? (
        <PageSection title="Problems" meta={String(problems.length)}>
          <Problems problems={problems} onSelect={onSelect} />
        </PageSection>
      ) : null}
    </>
  );
}

/** One workflow input: its name (renamed on Enter or leaving the field), its type, and removing it. */
function InputRow({ def, name, edit }: { def: WorkflowDefinition; name: string; edit: Edit }) {
  const id = useId();
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const problem = text === name ? null : inputNameProblem(def, text, name);
  const commit = () => {
    if (text !== name && !problem) edit((d) => renameInput(d, name, text));
  };
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={text}
          aria-label={`Input ${name}: name`}
          className="min-w-0 flex-1 font-mono"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setText(name);
          }}
          aria-invalid={Boolean(problem)}
        />
        <Select
          value={inputTypeOf(def.inputs?.[name])}
          onValueChange={(type) => edit((d) => setInputType(d, name, type))}
        >
          <SelectTrigger className="w-32 font-mono" aria-label={`Input ${name}: type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INPUT_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="font-mono">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove input ${name}`}
          onClick={() => edit((d) => removeInput(d, name))}
        >
          <XIcon />
        </Button>
      </div>
      {problem ? <p className="text-xs text-state-failed">{problem}</p> : null}
    </li>
  );
}

/** With no step selected: the workflow itself — its name, its inputs, its problems. */
export function WorkflowSettings({
  record,
  edit,
  onSelect,
  onDelete,
}: {
  record: WorkflowRecord;
  edit: Edit;
  onSelect: (stepId: string | null) => void;
  onDelete: () => Promise<void>;
}) {
  const def = record.definition;
  const inputs = Object.keys(def.inputs ?? {});
  const fresh = (() => {
    for (let n = inputs.length + 1; ; n++) {
      const name = `input_${n}`;
      if (!inputs.includes(name)) return name;
    }
  })();
  return (
    <>
      <PageSection
        title="Workflow"
        actions={
          <ConfirmButton
            question={`Delete ${record.id}? Its runs keep their records until they are swept.`}
            confirmLabel="Delete workflow"
            destructive
            size="sm"
            variant="ghost"
            onConfirm={onDelete}
          >
            <Trash2Icon />
            Delete
          </ConfirmButton>
        }
      >
        <div className="space-y-3">
          <ParsedField
            label="Name"
            shown={def.name}
            maxLength={200}
            commit={(name) => {
              // The harness refuses a nameless definition outright, so an emptied field waits.
              if (!name.trim()) return 'A workflow needs a name.';
              edit((d) => ({ ...d, name }));
              return null;
            }}
          />
          <TextField
            label="Description"
            value={def.description ?? ''}
            onChange={(description) => edit((d) => ({ ...d, description }))}
            multiline
            maxLength={2000}
          />
          <Facts>
            <Fact label="Id" mono>
              {record.id}
            </Fact>
            <Fact label="Revision" mono>
              {record.revision}
            </Fact>
            <Fact label="Saved">
              {relTime(record.updated_at)}
              {record.updated_by ? <span className="font-mono"> · {record.updated_by}</span> : null}
            </Fact>
          </Facts>
        </div>
      </PageSection>
      <PageSection
        title="Inputs"
        actions={
          <Button variant="ghost" size="sm" onClick={() => edit((d) => addInput(d, fresh))}>
            <PlusIcon />
            Add input
          </Button>
        }
      >
        {inputs.length ? (
          <ul className="space-y-2">
            {inputs.map((name) => (
              <InputRow key={name} def={def} name={name} edit={edit} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            None. A run’s form, a job’s payload and a trigger fill these.
          </p>
        )}
      </PageSection>
      <PageSection
        title="Problems"
        meta={record.problems.length ? String(record.problems.length) : undefined}
      >
        <Problems problems={record.problems} onSelect={onSelect} />
      </PageSection>
    </>
  );
}

/**
 * A save that lost to one made since: what each side has that the other does not, then the
 * choice. The workflow deleted meanwhile is the same choice with one side empty.
 */
export function ConflictNotice({
  mine,
  conflict,
  onKeepMine,
  onTakeTheirs,
  onLeave,
}: {
  mine: WorkflowDefinition;
  conflict: SaveConflict;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onLeave: () => void;
}) {
  const theirs = conflict.current;
  const lines = theirs ? describeDifferences(mine, theirs.definition) : [];
  return (
    <section
      role="alert"
      aria-labelledby="workflow-conflict"
      className="mb-4 rounded-2xl border border-state-blocked/40 bg-solid-state-blocked/5 p-3.5"
    >
      <h2 id="workflow-conflict" className="text-sm font-semibold">
        {theirs ? 'Saved elsewhere since you started' : 'Deleted elsewhere since you started'}
      </h2>
      {theirs ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Revision <span className="font-mono">{theirs.revision}</span>, saved{' '}
            {relTime(theirs.updated_at)}
            {theirs.updated_by ? (
              <>
                {' '}
                by <span className="font-mono">{theirs.updated_by}</span>
              </>
            ) : null}
            .
          </p>
          {lines.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm">Only where nodes sit differs.</p>
          )}
        </>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onKeepMine}>
          {theirs ? 'Keep mine' : 'Save mine again'}
        </Button>
        {theirs ? (
          <Button size="sm" variant="outline" onClick={onTakeTheirs}>
            Take theirs
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onLeave}>
            Discard mine
          </Button>
        )}
      </div>
    </section>
  );
}
