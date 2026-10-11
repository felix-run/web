import { Brain, Bug, ClipboardList, Eraser, Palette, PenSquare, Play } from 'lucide-react';
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
};

/** The commands a typed prefix offers: by name, or by an alias it once had. */
export function matchSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return slashCommands.filter(
    (c) => c.name.startsWith(q) || (c.aliases?.some((a) => a.startsWith(q)) ?? false),
  );
}

/** The command a whole typed name runs, alias included. */
export function findSlashCommand(name: string): SlashCommand | undefined {
  const n = name.toLowerCase();
  return slashCommands.find((c) => c.name === n || c.aliases?.includes(n));
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
}: {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  selectedIndex: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = matchSlashCommands(query);

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
            key={cmd.name}
            onClick={() => onSelect(cmd)}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              {cmd.icon}
            </div>
            <span className="font-mono text-sm text-foreground">/{cmd.name}</span>
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
