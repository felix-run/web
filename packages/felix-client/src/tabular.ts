/**
 * Tool output that is really a table, read as one.
 *
 * A query tool returning forty rows arrived as forty pretty-printed JSON objects
 * — every key repeated on every row, one screen per handful of records — or as
 * CSV with nothing lined up. Both are tables, and reading them is comparing down
 * a column, which neither layout allows.
 *
 * This is conservative on purpose: a false positive mangles output that was fine
 * as text, while a miss only leaves it as text. So it recognises exactly three
 * shapes and refuses everything near them — rows of differing width, a single
 * column, a "CSV" that is really prose with commas in it.
 */
export interface Tabular {
  columns: string[];
  rows: string[][];
  /** Where it came from, so a renderer can name it. */
  source: 'json' | 'csv' | 'tsv';
}

/** More than this many columns is not a table anyone reads in a tool card. */
const MAX_COLUMNS = 16;

/** Keys a tool commonly wraps its rows in: `{"items": [...]}`. */
const WRAPPER_KEYS = ['items', 'rows', 'results', 'data', 'records', 'hits', 'entries'];

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fromRecords(records: unknown[]): Tabular | null {
  if (records.length < 2 || !records.every(isRecord)) return null;
  const columns: string[] = [];
  for (const r of records) {
    for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  }
  if (columns.length < 2 || columns.length > MAX_COLUMNS) return null;
  // Rows that are mostly nested objects are documents, not records: a table of
  // JSON blobs is worse than the JSON.
  const nested = records.reduce<number>(
    (n, r) => n + Object.values(r).filter((v) => typeof v === 'object' && v !== null).length,
    0,
  );
  if (nested > (records.length * columns.length) / 2) return null;
  return {
    columns,
    rows: records.map((r) => columns.map((c) => cell(r[c]))),
    source: 'json',
  };
}

function fromJson(value: unknown): Tabular | null {
  if (Array.isArray(value)) return fromRecords(value);
  if (isRecord(value)) {
    const keys = Object.keys(value);
    for (const k of WRAPPER_KEYS) {
      const inner = value[k];
      // Only when the array is the point of the object — a wrapper with a page
      // cursor beside it, not a record that happens to hold a list.
      if (Array.isArray(inner) && keys.length <= 4) return fromRecords(inner);
    }
  }
  return null;
}

/** One delimited line, honouring double-quoted fields with `""` escapes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function fromDelimited(text: string): Tabular | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  // A header and at least two rows: two lines that happen to share a comma
  // count is a coincidence, three is a format.
  if (lines.length < 3) return null;
  for (const [delimiter, source] of [
    ['\t', 'tsv'],
    [',', 'csv'],
  ] as const) {
    if (!lines[0]?.includes(delimiter)) continue;
    const parsed = lines.map((l) => splitLine(l, delimiter));
    const width = parsed[0]?.length ?? 0;
    if (width < 2 || width > MAX_COLUMNS) continue;
    if (!parsed.every((r) => r.length === width)) continue;
    const [header, ...rows] = parsed as [string[], ...string[][]];
    // A header names columns: non-empty, distinct, and label-like — a few words at
    // most. Prose split on commas has clauses where the names should be, and its
    // lines end the way sentences do, which a data row almost never does.
    const labelLike = (h: string) => h.length > 0 && h.length <= 40 && h.split(/\s+/).length <= 3;
    if (!header.every(labelLike) || new Set(header).size !== width) continue;
    if (lines.some((l) => /[.!?]["')]?$/.test(l.trim()))) continue;
    return { columns: header, rows, source };
  }
  return null;
}

/** The output as a table, or `null` when it is not one. */
export function parseTabular(output: unknown): Tabular | null {
  if (output == null) return null;
  if (typeof output !== 'string') return fromJson(output);
  const s = output.trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      return fromJson(JSON.parse(s));
    } catch {
      return null;
    }
  }
  return fromDelimited(s);
}
