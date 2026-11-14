/** Common commands for discovery; /help remains the full command reference. */
export const COMMAND_HINTS = [
  { name: '/help', description: 'Show commands and keyboard shortcuts', args: false },
  { name: '/plan', description: 'Toggle plan mode', args: false },
  { name: '/think', description: 'Set thinking level: off to max', args: true },
  { name: '/manifest', description: 'List or switch agents', args: true },
  { name: '/start', description: 'Choose a numbered starter prompt', args: true },
  { name: '/artifact', description: 'Open full tool output by number', args: true },
  { name: '/search', description: 'Search conversation history', args: true },
  { name: '/new', description: 'Start a new thread', args: false },
  { name: '/continue', description: 'Continue the current run', args: false },
  { name: '/skills', description: 'Browse available skills', args: false },
  { name: '/skill', description: 'Read a skill by name', args: true },
  { name: '/style', description: 'List or select an output style', args: true },
  { name: '/ask', description: 'Ask a side question', args: true },
  { name: '/rename', description: 'Rename the current thread', args: true },
  { name: '/fork', description: 'Branch the current conversation', args: false },
  { name: '/compact', description: 'Compact conversation context', args: false },
  { name: '/export', description: 'Export the conversation', args: true },
  { name: '/rewind', description: 'Rewind conversation history', args: true },
  { name: '/version', description: 'Switch a prompt version', args: true },
  { name: '/open', description: 'Open a thread or search result', args: true },
  { name: '/refresh', description: 'Refresh the thread list', args: false },
  { name: '/clear', description: 'Clear the current thread history', args: false },
  { name: '/quit', description: 'Exit the terminal client', args: false },
] as const;

export function commandHints(draft: string) {
  if (!/^\/[a-z]*$/.test(draft)) return [];
  // A complete command is ready to run. Never intercept its Enter key.
  if (COMMAND_HINTS.some((hint) => hint.name === draft)) return [];
  return COMMAND_HINTS.filter((hint) => hint.name.startsWith(draft));
}
