import { Button } from '@felix/ui/button';

/**
 * Starter prompts for the empty state. Tuned per agent so suggestions match
 * what the selected Python harness manifest can actually do.
 */
type Suggestion = { title: string; label: string; prompt: string };

const BY_MANIFEST: Record<string, Suggestion[]> = {
  cowork: [
    {
      title: 'Create a note',
      label: 'todo.md with three tasks',
      prompt:
        'Create notes/todo.md with three short tasks for today, then confirm the file contents.',
    },
    {
      title: 'Search the workspace',
      label: 'find TODO comments',
      prompt: 'Search the workspace for TODO and summarize matches by file.',
    },
    {
      title: 'Draft then write',
      label: 'approve a file write',
      prompt:
        'Draft a one-paragraph README for this workspace and write it to README.md (I will approve the write).',
    },
    {
      title: 'List files',
      label: 'top-level tree',
      prompt: 'List the top-level files and folders in the workspace.',
    },
  ],
  quick: [
    {
      title: 'Summarize Felix',
      label: 'in two sentences',
      prompt: 'In two sentences, what is Felix and who is it for?',
    },
    {
      title: 'Draft a reply',
      label: 'polite and concise',
      prompt: 'Draft a short, polite reply declining a meeting that conflicts with a deadline.',
    },
    {
      title: 'Explain a tradeoff',
      label: 'Compose vs Kubernetes',
      prompt:
        'Compare Docker Compose and Kubernetes for running a small self-hosted agent API. Keep it practical.',
    },
    {
      title: 'Write a haiku',
      label: 'about streaming tokens',
      prompt: 'Write a haiku about streaming tokens from a language model.',
    },
  ],
  deep: [
    {
      title: 'Plan a rollout',
      label: 'multi-step with risks',
      prompt:
        'Plan a multi-step rollout of a public API behind a chat UI. Include risks and validation steps.',
    },
    {
      title: 'Break down a bug',
      label: 'symptoms → hypotheses',
      prompt:
        'Walk through diagnosing a chat stream that returns 500 only for unknown manifests. List hypotheses and checks.',
    },
    {
      title: 'Design a eval set',
      label: 'five golden prompts',
      prompt:
        'Propose five golden eval prompts for a general-purpose chat agent and how to judge them.',
    },
    {
      title: 'Architecture sketch',
      label: 'API, worker, store',
      prompt:
        'Sketch how an agent harness should split API, worker, and session store responsibilities.',
    },
  ],
  'oss-only': [
    {
      title: 'Local-only chat',
      label: 'no cloud keys',
      prompt: 'What does an oss-only agent imply for model routing and secrets?',
    },
    {
      title: 'Pick a model',
      label: 'for coding help',
      prompt: 'Recommend an open model size for coding help on a 16GB laptop and why.',
    },
    {
      title: 'Offline tips',
      label: 'when the LLM is slow',
      prompt: 'Give three practical tips when a local LLM feels too slow for interactive chat.',
    },
    {
      title: 'Write a haiku',
      label: 'about local inference',
      prompt: 'Write a haiku about running inference on a laptop fan.',
    },
  ],
};

const FALLBACK = BY_MANIFEST.quick!;

export function SuggestedActions({
  manifest,
  disabled,
  onSend,
}: {
  manifest?: string;
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const suggestions = (manifest && BY_MANIFEST[manifest]) || FALLBACK;

  return (
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {suggestions.map((s, i) => (
        <Button
          key={`${manifest ?? 'default'}-${s.title}`}
          variant="outline"
          disabled={disabled}
          onClick={() => onSend(s.prompt)}
          style={{ animationDelay: `${i * 50}ms` }}
          className="h-auto flex-col items-start gap-0.5 whitespace-normal rounded-xl border-border/60 bg-card/40 px-4 py-3 text-left shadow-none transition-colors hover:bg-accent/60"
        >
          <span className="text-sm font-medium text-foreground">{s.title}</span>
          <span className="text-xs text-muted-foreground">{s.label}</span>
        </Button>
      ))}
    </div>
  );
}
