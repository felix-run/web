const KEY_STORAGE = 'felix.float.apiKey';

let onUnauthorized: (() => void) | null = null;

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

export function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { 'x-chat-key': key } : {};
}

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export function handleUnauthorized(): void {
  clearApiKey();
  onUnauthorized?.();
}
