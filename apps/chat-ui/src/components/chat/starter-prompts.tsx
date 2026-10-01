import type { ManifestEntry, ManifestStarter } from '@felix/client';
import { Button } from '@felix/ui/button';
import { useShell } from '@/shell-context';

/**
 * Starter prompts for the empty thread, chosen by the agent the first message
 * goes to so each one exercises something that manifest can actually do.
 *
 * The manifest's own `metadata.starters`, from `/v1/models`, win. The table
 * below is only for a harness older than `felix-run/felix#384`, which sends no
 * `starters` key at all — it is keyed by name because that is all such a
 * harness tells us. A manifest that declares none gets the general pair.
 * Clicking sends the prompt as written. Each card shows it under the title
 * (two lines, the rest on hover), so nothing reaches the model that the
 * operator could not read first.
 */
type Starter = ManifestStarter;

const BY_MANIFEST: Record<string, Starter[]> = {
  cowork: [
    {
      title: 'List the workspace',
      prompt: 'List the top-level files and folders in the workspace.',
    },
    {
      title: 'Find TODOs',
      prompt: 'Search the workspace for TODO and summarize the matches by file.',
    },
    {
      title: 'Write a note',
      prompt:
        'Create notes/todo.md with three short tasks for today, then read the file back to confirm it.',
    },
    {
      title: 'Draft a README',
      prompt:
        'Read the workspace, draft a one-paragraph README for it, and write it to README.md (I will approve the write).',
    },
  ],
  quick: [
    {
      title: 'Calculate',
      prompt: 'What is 17.5% of 2,340, and what is that as a monthly amount over a year?',
    },
    {
      title: 'Summarize Felix',
      prompt: 'In two sentences, what is Felix and who is it for?',
    },
    {
      title: 'Draft a reply',
      prompt: 'Draft a short, polite reply declining a meeting that conflicts with a deadline.',
    },
  ],
  deep: [
    {
      title: 'Plan a rollout',
      prompt:
        'Plan a multi-step rollout of a public API behind a chat UI. Include risks and validation steps.',
    },
    {
      title: 'Research a comparison',
      prompt:
        'Compare Docker Compose and Kubernetes for running a small self-hosted agent API. Cite sources.',
    },
    {
      title: 'Design an eval set',
      prompt: 'Propose five golden eval prompts for a general-purpose agent and how to judge each.',
    },
  ],
  support: [
    {
      title: 'Troubleshoot a stream',
      prompt:
        'My chat stream returns 500 only for some agents. Walk me through diagnosing it step by step.',
    },
    {
      title: 'How do approvals work?',
      prompt: 'How do tool approvals work in Felix, and what happens if nobody answers one?',
    },
    {
      title: 'Search the docs',
      prompt: 'Search the docs for how durable runs are resumed after a disconnect.',
    },
  ],
  'oss-only': [
    {
      title: 'Pick a local model',
      prompt: 'Recommend an open model size for coding help on a 16GB laptop and explain why.',
    },
    {
      title: 'Speed up local inference',
      prompt: 'Give three practical tips for when a local LLM feels too slow for interactive chat.',
    },
  ],
};

const FALLBACK: Starter[] = [
  { title: 'What can you do?', prompt: 'What can you do, and which tools do you have access to?' },
  {
    title: 'Summarize Felix',
    prompt: 'In two sentences, what is Felix and who is it for?',
  },
];

export function startersFor(manifest: string, entry?: ManifestEntry): Starter[] {
  if (entry?.starters) return entry.starters.length ? entry.starters : FALLBACK;
  return BY_MANIFEST[manifest] ?? FALLBACK;
}

export function StarterPrompts({ manifest }: { manifest: string }) {
  const { send, streaming, manifestEntries } = useShell();
  const starters = startersFor(
    manifest,
    manifestEntries?.find((m) => m.id === manifest),
  );

  return (
    <ul aria-label="Starter prompts" className="grid w-full gap-2 sm:grid-cols-2">
      {starters.map((s) => (
        <li key={`${manifest}-${s.title}`} className="flex">
          <Button
            variant="outline"
            title={s.prompt}
            disabled={streaming}
            onClick={() => send(s.prompt)}
            className="h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal rounded-xl border-border/60 bg-solid-card/40 px-4 py-3 text-left shadow-none hover:bg-solid-accent/60"
          >
            <span className="text-sm font-medium text-foreground">{s.title}</span>
            {/* The prompt itself, so what a click sends is on screen before it is sent. */}
            <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
              {s.prompt}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
