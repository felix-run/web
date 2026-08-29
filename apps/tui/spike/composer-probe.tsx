/**
 * Spike 2: the composer.
 *
 * Every scenario the Ink composer's test pins, re-asked of OpenTUI — plus the
 * three things Ink cannot do that the port is *for*. Driven the way
 * `tests/composer.test.ts` drives Ink: bytes into a synthetic stdin, asserting
 * the message that would be **sent**, never the frame drawn.
 *
 * One scenario per process, chosen by argv, so no scenario can leak state into
 * the next.
 */

import { appendFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { createCliRenderer, type InputRenderable, type TextareaRenderable } from '@opentui/core';
import { createRoot, usePaste } from '@opentui/react';
import { useRef, useState } from 'react';

const ESC = String.fromCharCode(27);
const ENTER = '\r';
const LF = '\n';
const paste = (t: string) => `${ESC}[200~${t}${ESC}[201~`;

const scenario = process.argv[2] ?? '';
const out = (line: string) => appendFileSync('composer.out', `${line}\n`);

const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => {}, unref: () => {} });

/** One chunk, then a tick — a keyboard does not arrive all at once. */
async function feed(...chunks: string[]) {
  for (const chunk of chunks) {
    stdin.push(chunk);
    await new Promise((r) => setTimeout(r, 12));
  }
}

const submitted: string[] = [];
let readValue: () => string = () => '';

function report(pass: boolean, detail: string) {
  out(`${pass ? 'PASS' : 'FAIL'} ${scenario} — ${detail}`);
  process.exit(pass ? 0 : 1);
}

/** Single-line: the closest thing to today's composer. */
function InputComposer() {
  const ref = useRef<InputRenderable>(null);
  const [pasted, setPasted] = useState('');
  readValue = () => ref.current?.value ?? '';
  // A paste is its own channel here too; flattening stays our policy.
  usePaste((e) => {
    // The text is bytes, not a string — and the event is preventable, which is
    // the hook `flattenPaste` needs: intercept, join the lines with a space,
    // insert that instead of letting the buffer strip the newlines and run the
    // words together.
    const ev = e as unknown as { bytes: ArrayLike<number>; preventDefault?: () => void };
    const raw = new TextDecoder().decode(Uint8Array.from(Array.from(ev.bytes)));
    out(`  paste-raw=${JSON.stringify(raw)}`);
    ev.preventDefault?.();
    const flat = raw.replace(/[\r\n]+/g, ' ').replace(/\s+$/, '');
    setPasted(flat);
    if (ref.current) ref.current.value = (ref.current.value ?? '') + flat;
  });
  return (
    <box flexDirection="column">
      <input ref={ref} focused onSubmit={(v: string) => submitted.push(v)} />
      <text>{pasted ? `paste-seen:${pasted}` : ''}</text>
    </box>
  );
}

/**
 * Multi-line: the thing Ink has no answer for at all.
 *
 * The defaults are Enter=newline / Meta+Enter=submit — the opposite of a chat
 * prompt. They are a plain array, so this is what the port would actually
 * ship: Enter sends, Shift+Enter opens a line.
 */
const CHAT_BINDINGS = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
] as never;

function TextareaComposer() {
  const ref = useRef<TextareaRenderable>(null);
  readValue = () => (ref.current as unknown as { plainText?: string })?.plainText ?? '';
  return (
    <textarea
      ref={ref}
      focused
      height={5}
      keyBindings={CHAT_BINDINGS}
      onSubmit={() => submitted.push(readValue())}
    />
  );
}

const multiline = scenario.startsWith('textarea');

const renderer = await createCliRenderer({
  stdin,
  width: 100,
  height: 20,
  exitOnCtrlC: false,
  // Kitty is how a terminal can report shift+enter at all.
  useKittyKeyboard: {},
});

// Focus/blur are renderer events here, not stray text on stdin.
let focusEvents = 0;
renderer.on('focus', () => focusEvents++);
renderer.on('blur', () => focusEvents++);

createRoot(renderer).render(multiline ? <TextareaComposer /> : <InputComposer />);

await new Promise((r) => setTimeout(r, 400));

switch (scenario) {
  case 'focus-reports': {
    // Tab away, type, come back, send. Ink 7 delivers `[O`/`[I` as text.
    await feed(`${ESC}[O`, 'hello', `${ESC}[I`, ENTER);
    report(
      submitted[0] === 'hello' && focusEvents === 2,
      `submitted=${JSON.stringify(submitted[0])} focus/blur events=${focusEvents}`,
    );
    break;
  }
  case 'bracketed-paste': {
    await feed(paste(`explain the proxy worker${LF}and the dev copy of it${LF}`));
    const notSent = submitted.length === 0;
    const held = readValue();
    await feed(ENTER);
    report(
      notSent && submitted.length === 1 && submitted[0] === 'explain the proxy worker and the dev copy of it',
      `not-sent-on-paste=${notSent} held=${JSON.stringify(held)} sent=${JSON.stringify(submitted[0])}`,
    );
    break;
  }
  case 'raw-paste': {
    // A terminal that ignores bracketed paste sends the text raw.
    await feed(`one${LF}two${LF}`);
    const notSent = submitted.length === 0;
    report(notSent, `not-sent=${notSent} held=${JSON.stringify(readValue())} sent=${JSON.stringify(submitted)}`);
    break;
  }
  case 'cursor-motion': {
    await feed('hello world');
    await feed(`${ESC}[D`, `${ESC}[D`, `${ESC}[D`, `${ESC}[D`, `${ESC}[D`); // ←×5
    await feed('X');
    report(readValue() === 'hello Xworld', `value=${JSON.stringify(readValue())}`);
    break;
  }
  case 'word-motion': {
    await feed('alpha beta gamma');
    await feed(`${ESC}[1;5D`); // ctrl+←
    await feed('Z');
    report(readValue() === 'alpha beta Zgamma', `value=${JSON.stringify(readValue())}`);
    break;
  }
  case 'burst': {
    // The failure this repo has already paid for: enough keystrokes fast
    // enough to reach React's nested-update limit. 400 chars, no gaps.
    const text = 'the quick brown fox jumps over the lazy dog '.repeat(9).slice(0, 400);
    for (const ch of text) stdin.push(ch);
    await new Promise((r) => setTimeout(r, 900));
    const v = readValue();
    report(v === text, `len=${v.length}/${text.length} exact=${v === text}`);
    break;
  }
  case 'textarea-raw-paste': {
    // The terminal that ignores bracketed paste, against the multi-line
    // composer the port would actually ship. On `<input>` the bare LF submits
    // mid-paste; here `linefeed` is bound to newline.
    await feed(`one${LF}two${LF}`);
    const notSent = submitted.length === 0;
    report(notSent, `not-sent=${notSent} held=${JSON.stringify(readValue())} sent=${JSON.stringify(submitted)}`);
    break;
  }
  case 'textarea-enter': {
    await feed('first');
    await feed(`${ESC}[13;2u`); // kitty shift+enter
    await feed('second');
    const v = readValue();
    report(v === `first${LF}second`, `value=${JSON.stringify(v)}`);
    break;
  }
  case 'textarea-submit': {
    await feed('send me');
    await feed(ENTER);
    report(submitted[0] === 'send me', `submitted=${JSON.stringify(submitted)} value=${JSON.stringify(readValue())}`);
    break;
  }
  default:
    out(`FAIL ${scenario} — unknown scenario`);
    process.exit(1);
}
