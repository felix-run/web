import {
  codePoints,
  parseSkillMd,
  updateSkillMdFrontmatter,
  type ValidationIssue,
  validateSkillName,
} from '@felix/skill-format';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Textarea } from '@felix/ui/textarea';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const LIMITS = { name: 64, description: 1024, compatibility: 500 } as const;

/** Counted in code points, as the harness counts them: an emoji is one, not two. */
function CharCount({ value, max }: { value: string; max: number }) {
  const n = codePoints(value);
  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        n > max ? 'text-state-failed' : 'text-muted-foreground',
      )}
    >
      {n}/{max}
      {n > max && <span className="sr-only"> — over the limit</span>}
    </span>
  );
}

function FieldErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-state-failed">
      {errors.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

/**
 * SKILL.md's frontmatter as fields. The source text stays the single source of
 * truth: the form projects from it and writes back through
 * `updateSkillMdFrontmatter`, which regenerates only the YAML between the fences
 * and leaves the body byte-identical. YAML comments in the block do not survive
 * an edit made here, which the form says.
 */
export function FrontmatterForm({
  content,
  slug,
  errors = [],
  onChange,
}: {
  /** Full SKILL.md source — the single source of truth the form projects from. */
  content: string;
  slug: string;
  errors?: ValidationIssue[];
  onChange: (content: string) => void;
}) {
  // A metadata row being keyed in has no object entry until its key is non-empty.
  const [draftRow, setDraftRow] = useState<{ key: string; value: string } | null>(null);

  const parsed = parseSkillMd(content);
  if (!parsed || typeof parsed.frontmatter !== 'object' || parsed.frontmatter === null) {
    return (
      <div className="rounded-lg border border-state-failed/30 bg-state-failed/10 p-3 text-sm">
        <p className="font-medium">Frontmatter is not valid YAML.</p>
        <p className="mt-1 text-muted-foreground">
          Fix the block between the <code>---</code> fences in the source editor to edit fields
          here.
        </p>
      </div>
    );
  }

  const fm = parsed.frontmatter as Record<string, unknown>;
  const str = (key: string) => (typeof fm[key] === 'string' ? (fm[key] as string) : '');
  const metadata =
    fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata)
      ? (fm.metadata as Record<string, string>)
      : {};

  const emit = (next: Record<string, unknown>) => {
    const compact = Object.fromEntries(
      Object.entries(next).filter(([key, value]) => {
        if (key === 'name' || key === 'description') return true;
        if (value === undefined || value === '') return false;
        if (key === 'metadata' && Object.keys(value as object).length === 0) return false;
        return true;
      }),
    );
    onChange(updateSkillMdFrontmatter(content, compact));
  };

  const setField = (key: string, value: string) => emit({ ...fm, [key]: value });

  const setMetadataEntry = (index: number, key: string, value: string) => {
    const entries = Object.entries(metadata);
    entries[index] = [key, value];
    emit({ ...fm, metadata: Object.fromEntries(entries.filter(([k]) => k !== '')) });
  };

  const removeMetadataEntry = (index: number) => {
    const entries = Object.entries(metadata);
    entries.splice(index, 1);
    emit({ ...fm, metadata: Object.fromEntries(entries) });
  };

  const commitDraftRow = () => {
    if (!draftRow) return;
    const key = draftRow.key.trim();
    if (key === '' || metadata[key] !== undefined) return;
    setDraftRow(null);
    emit({ ...fm, metadata: { ...metadata, [key]: draftRow.value } });
  };

  const fieldErrors = (field: string) =>
    errors.filter((e) => e.path === `frontmatter.${field}`).map((e) => e.message);
  const nameErrors = [
    ...new Set([
      ...fieldErrors('name'),
      ...validateSkillName(str('name'), slug).map((e) => e.message),
    ]),
  ];

  return (
    <div className="space-y-4 p-1">
      <p className="text-xs text-muted-foreground">
        Edits here rewrite the YAML block, so comments inside it are dropped. The body is untouched.
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-name">name</Label>
          <CharCount value={str('name')} max={LIMITS.name} />
        </div>
        <Input
          id="fm-name"
          value={str('name')}
          onChange={(e) => setField('name', e.target.value)}
          className="font-mono text-xs"
          aria-invalid={nameErrors.length > 0}
        />
        <FieldErrors errors={nameErrors} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-description">description</Label>
          <CharCount value={str('description')} max={LIMITS.description} />
        </div>
        <Textarea
          id="fm-description"
          value={str('description')}
          onChange={(e) => setField('description', e.target.value)}
          className="min-h-20 text-xs"
          placeholder="What the skill does and when to use it."
          aria-invalid={fieldErrors('description').length > 0}
        />
        <FieldErrors errors={fieldErrors('description')} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fm-license">license</Label>
        <Input
          id="fm-license"
          value={str('license')}
          onChange={(e) => setField('license', e.target.value)}
          className="text-xs"
          placeholder="MIT, Apache-2.0, or a bundled license file"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-compatibility">compatibility</Label>
          <CharCount value={str('compatibility')} max={LIMITS.compatibility} />
        </div>
        <Textarea
          id="fm-compatibility"
          value={str('compatibility')}
          onChange={(e) => setField('compatibility', e.target.value)}
          className="min-h-14 text-xs"
          placeholder="Environment requirements — only if the skill needs them."
          aria-invalid={fieldErrors('compatibility').length > 0}
        />
        <FieldErrors errors={fieldErrors('compatibility')} />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="flex w-full items-center justify-between">
          <Label asChild>
            <span>metadata</span>
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs"
            onClick={() => setDraftRow({ key: '', value: '' })}
            disabled={draftRow !== null}
          >
            <PlusIcon className="size-3" aria-hidden /> Add
          </Button>
        </legend>
        {Object.entries(metadata).map(([key, value], index) => (
          // Keyed by position: keying by the key text would remount the row mid-rename and drop focus.
          <div key={`${index}-metadata-row`} className="flex items-center gap-1.5">
            <Input
              value={key}
              onChange={(e) => setMetadataEntry(index, e.target.value, value)}
              className="w-2/5 font-mono text-xs"
              aria-label={`Metadata key ${index + 1}`}
            />
            <Input
              value={value}
              onChange={(e) => setMetadataEntry(index, key, e.target.value)}
              className="flex-1 text-xs"
              aria-label={`Metadata value for ${key}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-6 shrink-0 p-0"
              onClick={() => removeMetadataEntry(index)}
              aria-label={`Remove metadata ${key}`}
            >
              <Trash2Icon className="size-3" aria-hidden />
            </Button>
          </div>
        ))}
        {draftRow && (
          // biome-ignore lint/a11y/noStaticElementInteractions: blur here only observes focus leaving the row's inputs; the div is not interactive itself
          <div
            className="flex items-center gap-1.5"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) commitDraftRow();
            }}
          >
            <Input
              autoFocus
              value={draftRow.key}
              onChange={(e) => setDraftRow({ key: e.target.value, value: draftRow.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraftRow();
              }}
              placeholder="key"
              className="w-2/5 font-mono text-xs"
              aria-label="New metadata key"
            />
            <Input
              value={draftRow.value}
              onChange={(e) => setDraftRow({ key: draftRow.key, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraftRow();
              }}
              placeholder="value"
              className="flex-1 text-xs"
              aria-label="New metadata value"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-6 shrink-0 p-0"
              onClick={() => setDraftRow(null)}
              aria-label="Discard new metadata row"
            >
              <Trash2Icon className="size-3" aria-hidden />
            </Button>
          </div>
        )}
        <FieldErrors
          errors={errors
            .filter((e) => e.path.startsWith('frontmatter.metadata'))
            .map((e) => e.message)}
        />
      </fieldset>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="fm-allowed-tools">allowed-tools</Label>
          <Badge variant="outline">experimental</Badge>
        </div>
        <Input
          id="fm-allowed-tools"
          value={str('allowed-tools')}
          onChange={(e) => setField('allowed-tools', e.target.value)}
          className="font-mono text-xs"
          placeholder="Bash(git:*) Read Write"
        />
        <p className="text-xs text-muted-foreground">
          Space-separated tools pre-approved to run. Support varies by agent.
        </p>
      </div>
    </div>
  );
}
