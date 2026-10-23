import type { FieldSize } from '@felix/ui/lib/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useOptionalShell } from '@/shell-context';

/**
 * One choice in a pick list: its name, and under it what the harness says about it that the name
 * does not — an agent's provider model, a thinking level's token budget. Every agent list and the
 * composer's pickers draw their rows with this, so an agent looks the same wherever it is picked.
 *
 * Both lines are mono: the name is the harness's identifier and the description a quotation of
 * it. `textValue` keeps typeahead on the name. No second line when there is nothing to add:
 * the client drops a wire model that *is* the name, since repeating it would say nothing.
 */
export function OptionItem({
  value,
  label = value,
  description,
}: {
  value: string;
  label?: string;
  description?: string;
}) {
  return (
    <SelectItem value={value} textValue={label}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono font-medium">{label}</span>
        {description && (
          <span
            data-slot="option-description"
            className="font-mono text-xs wrap-anywhere text-muted-foreground"
          >
            {description}
          </span>
        )}
      </span>
    </SelectItem>
  );
}

/**
 * How far an agent list may grow: at least 18rem, so a name and its model sit on their lines
 * rather than wrapping in a column the trigger's width, and at most 26rem tall, so eighteen
 * agents at two lines each scroll instead of covering the page. The composer's lists share it.
 */
export const OPTION_LIST_BOUNDS =
  'min-w-72 max-h-[min(var(--radix-select-content-available-height),26rem)]';

/** Wire model by agent name, from `/v1/models`. */
export function modelsById(
  entries: ReadonlyArray<{ id: string; wireModel?: string }>,
): Map<string, string | undefined> {
  return new Map(entries.map((e) => [e.id, e.wireModel]));
}

/**
 * The agent picker, wherever an agent is chosen outside the composer: the harness pages' header,
 * Memory's filter and its Recalled by, a job's agent, an eval's baseline, a manifest to import.
 * Seven places chose from the same `/v1/models` list with four widths, two fonts in the trigger
 * and two kinds of row; this is the one.
 *
 * The trigger shows the name alone (the row carries the model too) in mono, and the placeholder
 * or a sentinel the caller adds above the agents (`leading`, e.g. "Every agent") in sans, since
 * those are our words. A value the list does not carry is offered anyway, at the head, so a
 * restored or since-removed agent is still what the trigger says rather than a blank.
 */
export function AgentSelect({
  id,
  value,
  options,
  onValueChange,
  placeholder = 'Choose an agent',
  size,
  className,
  leading,
  trailing,
  providerModels,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  id?: string;
  value: string | undefined;
  options: readonly string[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  size?: FieldSize;
  /** Width and spacing only; the look is the primitive's. */
  className?: string;
  /** Choices that are not agents, above them: their value must not be an agent's name. */
  leading?: ReadonlyArray<{ value: string; label: string }>;
  /** Items after the agents, such as "Another name…". */
  trailing?: ReactNode;
  /** Defaults to the shell's `/v1/models` answer. */
  providerModels?: Map<string, string | undefined>;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const shell = useOptionalShell();
  const models = providerModels ?? modelsById(shell?.manifestEntries ?? []);
  const sentinel = leading?.find((l) => l.value === value);
  const all = value && !sentinel && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select
      value={value || undefined}
      // An empty value is never a choice: Radix reports `""` when `value` moves to an option the
      // list does not hold yet.
      onValueChange={(v) => v && onValueChange(v)}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cn(!sentinel && 'font-mono data-[placeholder]:font-sans', className)}
      >
        {/* The name alone; SelectValue's default would draw the row's model line too. */}
        <SelectValue placeholder={placeholder}>
          {value ? <span className="min-w-0 truncate">{sentinel?.label ?? value}</span> : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" size={size} className={OPTION_LIST_BOUNDS}>
        {leading?.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
        {all.map((m) => (
          <OptionItem key={m} value={m} description={models.get(m)} />
        ))}
        {trailing}
      </SelectContent>
    </Select>
  );
}
