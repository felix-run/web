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
 *
 * Above that, the manifest's own words when it has them (`metadata.greeting`),
 * and below it the manifest's starters (`metadata.starters`), numbered for
 * `/start <n>`. Both come from the harness through `/v1/models`, and neither has
 * a fallback here: an agent that declares none gets the screen as it was. The
 * starters show their titles only — `/start` puts the whole prompt in the
 * composer, so it is read there before Enter sends it.
 */

import type { ManifestGreeting, ManifestStarter } from '@felix/client';
import { BOLD, DIM, type Theme } from '../theme.js';

export interface GreetingProps {
  /** The agent in play, which the status line also names but quietly. */
  manifest: string;
  /** The working directory's last segment — what the agent can reach. */
  workspace: string;
  /** `--yes`: writes proceed without a prompt. */
  unattended: boolean;
  /** The manifest's own headline and subtitle, when it declares them. */
  greeting?: ManifestGreeting;
  /** The manifest's starter prompts, when it declares them. */
  starters?: ManifestStarter[];
  theme: Theme;
}

export function Greeting({
  manifest,
  workspace,
  unattended,
  greeting,
  starters = [],
  theme,
}: GreetingProps) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text>
        <span fg={theme.ready}>FELIX</span>
        <span attributes={DIM}> · {manifest}</span>
      </text>
      <text attributes={DIM}> </text>
      {greeting ? (
        <>
          <text attributes={BOLD}>{greeting.headline}</text>
          {greeting.subtitle ? <text attributes={DIM}>{greeting.subtitle}</text> : null}
          <text attributes={DIM}> </text>
        </>
      ) : null}
      {unattended ? (
        <text fg={theme.danger}>
          Working in {workspace}. Reads and writes it without asking (--yes).
        </text>
      ) : (
        <text attributes={DIM}>
          Working in {workspace}. Reads it freely; asks before it writes.
        </text>
      )}
      {starters.length ? (
        <>
          <text attributes={DIM}> </text>
          {starters.map((s, i) => (
            <text key={s.title}>
              <span fg={theme.ready}>{`  ${i + 1}  `}</span>
              <span>{s.title}</span>
            </text>
          ))}
          <text attributes={DIM}> </text>
          <text attributes={DIM}>
            /start {starters.length === 1 ? '1' : `1–${starters.length}`} puts one in the composer,
            or ask anything. /help for more.
          </text>
        </>
      ) : (
        <text attributes={DIM}>Ask anything, or /help for what this client can do.</text>
      )}
    </box>
  );
}
