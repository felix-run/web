import { useId } from 'react';

/** Which stored version a tab is looking at — the Review, Files, Evals and Feedback tabs share it. */
export function VersionPicker({
  versions,
  value,
  onChange,
}: {
  versions: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor={id} className="text-muted-foreground">
        Version
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
      >
        {versions.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}
