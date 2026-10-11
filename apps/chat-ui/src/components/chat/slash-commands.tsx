import type { ManifestCommand } from '@felix/client';
import {
  Brain,
  Bug,
  ClipboardList,
  Eraser,
  MessageCircleQuestion,
  Palette,
  PenSquare,
  Play,
  Sparkles,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type SlashCommand = {
  name: string;
  description: string;
  icon: ReactNode;
  action: string;
  shortcut?: string;
  /** Older names that still run it — typed whole, or matched as a prefix. */
  aliases?: string[];
  /** For an agent's command: how its arguments read after the name. */
  argumentHint?: string;
};

/**
 * The action of a command the agent declares (`felix.commands`): not run here, but sent to the
 * harness as typed, which expands it into the manifest's prompt.
 */
export const AGENT_COMMAND = 'agent';

/**
 * `/ask <question>`: a side question about the thread (`POST /chat/ask`), answered beside the
 * transcript and added to nothing. Like an agent's command it takes words after the name, so
 * choosing it from the menu fills the composer rather than running.
 */
export const ASK_COMMAND = 'ask';

/**
 * The agent's commands as menu entries, after this client's own: a name this client already
 * answers to stays this client's, so `/new` always starts a chat whatever a manifest declares.
 */
export function agentSlashCommands(
  commands: readonly ManifestCommand[] | undefined,
): SlashCommand[] {
  const taken = new Set(slashCommands.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
  return (commands ?? [])
    .filter((c) => !taken.has(c.name.toLowerCase()))
    .map((c) => ({
      name: c.name,
      description: c.description ?? "Run this agent's prompt",
      icon: <Sparkles className="size-3.5" />,
      action: AGENT_COMMAND,
      argumentHint: c.argumentHint,
    }));
}

/** The commands a typed prefix offers: by name, or by an alias it once had; the agent's after. */
export function matchSlashCommands(
  query: string,
  agent: readonly SlashCommand[] = [],
): SlashCommand[] {
  const q = query.toLowerCase();
  return [...slashCommands, ...agent].filter(
    (c) => c.name.toLowerCase().startsWith(q) || (c.aliases?.some((a) => a.startsWith(q)) ?? false),
  );
}

/** The command a whole typed name runs, alias included; the harness matches an agent's by case. */
export function findSlashCommand(
  name: string,
  agent: readonly SlashCommand[] = [],
): SlashCommand | undefined {
  const n = name.toLowerCase();
  return [...slashCommands, ...agent].find(
    (c) => c.name.toLowerCase() === n || c.aliases?.includes(n),
  );
}

// Adapted for the chat-ui example. The menu component below is generic; only
// this command list and the actions App wires up are example-specific.
export const slashCommands: SlashCommand[] = [
  {
    name: 'new',
    description: 'Start a new chat',
    icon: <PenSquare className="size-3.5" />,
    action: 'new',
  },
  {
    name: 'clear',
    description: 'Clear this conversation',
    icon: <Eraser className="size-3.5" />,
    action: 'clear',
  },
  {
    name: 'continue',
    description: 'Resume after abort or error',
    icon: <Play className="size-3.5" />,
    action: 'continue',
  },
  {
    name: 'think',
    description: 'Cycle thinking level (off → max)',
    icon: <Brain className="size-3.5" />,
    action: 'think',
  },
  {
    name: 'ask',
    description: 'Ask about this conversation without adding to it',
    icon: <MessageCircleQuestion className="size-3.5" />,
    action: ASK_COMMAND,
    argumentHint: '<question>',
  },
  {
    name: 'plan',
    description: 'Plan mode on or off: read and propose only',
    icon: <ClipboardList className="size-3.5" />,
    action: 'plan',
  },
  {
    name: 'debug',
    description: 'Toggle debug: instrument, harness pages, ids',
    icon: <Bug className="size-3.5" />,
    action: 'debug',
    aliases: ['verbose'],
  },
  {
    name: 'theme',
    description: 'Toggle light and dark',
    icon: <Palette className="size-3.5" />,
    action: 'theme',
  },
];

export function SlashCommandMenu({
  query,
  onSelect,
  selectedIndex,
  agent = [],
}: {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  selectedIndex: number;
  /** The agent's own commands (`agentSlashCommands`), listed after this client's. */
  agent?: readonly SlashCommand[];
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = matchSlashCommands(query, agent);

  // re-run when the selection moves — the [data-selected] attribute this queries is rendered from selectedIndex
  useEffect(() => {
    const selected = menuRef.current?.querySelector("[data-selected='true']");
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute right-0 bottom-full left-0 z-50 mb-2 overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-[var(--shadow-composer-focus)] backdrop-blur-xl"
      ref={menuRef}
    >
      <div className="px-4 py-2 text-xs font-medium text-muted-foreground">Commands</div>
      <div className="max-h-64 overflow-y-auto pb-1">
        {filtered.map((cmd, index) => (
          <button
            className={cn(
              'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
              index === selectedIndex ? 'bg-muted' : 'hover:bg-muted/50',
            )}
            data-selected={index === selectedIndex}
            key={`${cmd.action}:${cmd.name}`}
            onClick={() => onSelect(cmd)}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              {cmd.icon}
            </div>
            <span className="font-mono text-sm text-foreground">/{cmd.name}</span>
            {cmd.argumentHint && (
              <span className="font-mono text-xs text-muted-foreground/70">{cmd.argumentHint}</span>
            )}
            <span className="text-xs text-muted-foreground/60">{cmd.description}</span>
            {cmd.shortcut && (
              <span className="ml-auto text-xs text-muted-foreground/40">{cmd.shortcut}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
