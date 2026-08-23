/**
 * Minimal in-memory `localStorage`, installed globally for the test run.
 *
 * The VFS persists through `localStorage`, which Node does not provide. A real
 * DOM is not needed for anything under test here, so this stands in for one
 * rather than adding jsdom for a four-method API.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

globalThis.localStorage = new MemoryStorage();
