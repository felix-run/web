import type { SkillVersion } from '@felix/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { useId } from 'react';
import { versionState } from './skill-status';

/**
 * A version as an option names its state — `0.3.0 · draft`, `0.2.0 · live` —
 * because a bare number asked the reader to remember which one was live while
 * choosing what to compare, evaluate or file feedback against.
 */
export function versionOptionLabel(
  v: Pick<SkillVersion, 'status' | 'version' | 'published_at' | 'decided_at'>,
  liveVersion: string | null,
): string {
  return `${v.version} · ${versionState(v, liveVersion)}`;
}

/**
 * One stored version, chosen from a list that says each one's state: the version in mono, its
 * state beside it in muted sans, in the trigger and the rows alike. It was a native `<select>`,
 * whose list the OS draws — light chrome on a dark page, and the one picker on the Versions tab
 * with a different chevron and focus ring from every control around it.
 */
export function VersionSelect({
  id,
  versions,
  liveVersion,
  value,
  onChange,
}: {
  id: string;
  versions: SkillVersion[];
  liveVersion: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const row = (v: SkillVersion) => (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono">{v.version}</span>
      <span className="text-muted-foreground">{versionState(v, liveVersion)}</span>
    </span>
  );
  const current = versions.find((v) => v.version === value);
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger id={id} size="sm">
        <SelectValue>{current ? row(current) : value}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" size="sm">
        {versions.map((v) => (
          <SelectItem
            key={v.version}
            value={v.version}
            textValue={versionOptionLabel(v, liveVersion)}
          >
            {row(v)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Which stored version a tab is looking at — the Gate, Evals and Feedback tabs share it. */
export function VersionPicker({
  versions,
  liveVersion,
  value,
  onChange,
}: {
  versions: SkillVersion[];
  liveVersion: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor={id} className="text-muted-foreground">
        Version
      </label>
      <VersionSelect
        id={id}
        versions={versions}
        liveVersion={liveVersion}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
