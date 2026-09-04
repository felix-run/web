/**
 * What a thread with nothing in it should say.
 *
 * It used to say nothing at all: nineteen blank rows above a composer, which
 * looks like a client that has failed to load rather than one waiting for you.
 *
 * The temptation is to fill it with keys, and that would be wrong — the
 * composer already carries its hint along the bottom of its border, and the
 * status line already names the manifest, the host and the directory. Repeating
 * them would make the first screen the densest one.
 *
 * So this says the one thing that is nowhere else on screen, and is the most
 * important fact about this client: **the agent is pointed at a real working
 * directory.** It reads from it without asking — the stated trade of running
 * against your own files — and asks before it writes, unless you started with
 * `--yes`, in which case it does not, and that deserves saying plainly on the
 * screen you see before typing anything.
 */

import { DIM, type Theme } from '../theme.js';

export interface GreetingProps {
  /** The agent in play, which the status line also names but quietly. */
  manifest: string;
  /** The working directory's last segment — what the agent can reach. */
  workspace: string;
  /** `--yes`: writes proceed without a prompt. */
  unattended: boolean;
  theme: Theme;
}

export function Greeting({ manifest, workspace, unattended, theme }: GreetingProps) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text>
        <span fg={theme.ready}>FELIX</span>
        <span attributes={DIM}> · {manifest}</span>
      </text>
      <text attributes={DIM}> </text>
      {unattended ? (
        <text fg={theme.danger}>
          Working in {workspace}. Reads and writes it without asking (--yes).
        </text>
      ) : (
        <text attributes={DIM}>
          Working in {workspace}. Reads it freely; asks before it writes.
        </text>
      )}
      <text attributes={DIM}>Ask anything, or /help for what this client can do.</text>
    </box>
  );
}
