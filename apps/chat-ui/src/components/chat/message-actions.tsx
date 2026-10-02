import { Button } from '@felix/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@felix/ui/tooltip';
import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon, TagIcon, Undo2Icon } from 'lucide-react';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { cn } from '@/lib/utils';

/**
 * Hover / focus actions for a transcript turn. Copy on any text turn;
 * Regenerate only on the last assistant turn; Rewind and Label when a server
 * event id is known — both address the turn by that id. Edit on a user turn
 * opens it for rewriting in place; the turn owns that editor.
 */
export function MessageActions({
  content,
  label,
  onLabel,
  onRegenerate,
  onRewind,
  onEdit,
  className,
}: {
  content: string;
  /** The label already on this turn, if any. */
  label?: string;
  /** Set it, or clear it with `null`. Absent when there is no event id yet. */
  onLabel?: (label: string | null) => void;
  onRegenerate?: () => void;
  onRewind?: () => void;
  onEdit?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label ?? '');

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  if (!content && !onRegenerate && !onRewind && !onLabel && !onEdit) return null;

  const commit = () => {
    const next = draft.trim();
    // Empty is how a label is removed: the route takes `null` to clear one, and
    // saving a blank is what someone who wants it gone will type.
    onLabel?.(next.length ? next : null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <input
          // biome-ignore lint/a11y/noAutofocus: the control was just opened for this
          autoFocus
          aria-label="Label for this message"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="Name this turn"
          className="h-7 w-44 rounded-md border border-border/60 bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={commit}>
          Save
        </Button>
      </div>
    );
  }

  // Hidden until hover only where hover exists. This keyed on width (`sm:`) and so
  // hid every action on an iPad, where a tap on the message does not reliably
  // produce a hover and the invisible buttons could only be hit blind.
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100',
        className,
      )}
    >
      {content && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground coarse:size-10 dark:hover:bg-solid-accent/50"
              onClick={copy}
              aria-label="Copy message"
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
        </Tooltip>
      )}
      {onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground coarse:size-10 dark:hover:bg-solid-accent/50"
              onClick={onEdit}
              aria-label="Edit this message"
            >
              <PencilIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit and resend</TooltipContent>
        </Tooltip>
      )}
      {onLabel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground coarse:size-10 dark:hover:bg-solid-accent/50"
              onClick={() => {
                setDraft(label ?? '');
                setEditing(true);
              }}
              aria-label={label ? 'Edit this message label' : 'Label this message'}
            >
              <TagIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label ? 'Edit label' : 'Label this turn'}</TooltipContent>
        </Tooltip>
      )}
      {onRewind && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground coarse:size-10 dark:hover:bg-solid-accent/50"
              onClick={onRewind}
              aria-label="Rewind the thread to this message"
            >
              <Undo2Icon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          {/* Names the consequence, not the mechanism: "Rewind here" told the reader
              nothing about what happens to everything after it. */}
          <TooltipContent>Continue from here, setting later turns aside</TooltipContent>
        </Tooltip>
      )}
      {/*
        Regenerate arms before it fires; Rewind does not. The difference is what
        each can take back. Rewind moves the active leaf and its toast offers Undo,
        which moves it back — nothing is lost. Regenerate resets the thread's
        server history and replays only the message text, so the answer it
        replaces goes, and with it every tool result and note in the thread's
        log. One stray click on a hover control should not cost that.
      */}
      {onRegenerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <ConfirmButton
              variant="ghost"
              size="xs"
              className="text-muted-foreground dark:hover:bg-solid-accent/50"
              restingClassName="size-7 px-0 coarse:size-10"
              aria-label="Regenerate response"
              question="Replace this answer? The thread's server log is reset and replayed as text, so tool results in it are dropped."
              confirmLabel="Regenerate"
              destructive
              onConfirm={onRegenerate}
            >
              <RefreshCwIcon className="size-3.5" />
            </ConfirmButton>
          </TooltipTrigger>
          <TooltipContent>Regenerate</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
