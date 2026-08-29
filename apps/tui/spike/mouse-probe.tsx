/** Does OpenTUI parse and route mouse events? Feed stdin directly, no pty. */
import { PassThrough } from 'node:stream';
import { appendFileSync } from 'node:fs';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

const log = (m: string) => appendFileSync('mouse.out', `${m}\n`);

const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
// The renderer wants a tty; a PassThrough is close enough once it says so.
Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => {}, unref: () => {} });

function App() {
  return (
    <box flexDirection="column">
      <box
        width={40}
        height={3}
        onMouseOver={() => log('OVER')}
        onMouseDown={(e) => log(`DOWN ${e.x},${e.y}`)}
        onMouseScroll={() => log('SCROLL')}
      >
        <text>target</text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer({
  stdin,
  width: 100,
  height: 30,
  exitOnCtrlC: false,
  useMouse: true,
  enableMouseMovement: true,
});
createRoot(renderer).render(<App />);

setTimeout(() => {
  // SGR: ESC [ < btn ; col ; row  (M press / m release). Row 1 is inside the box.
  stdin.push('\x1b[<35;5;2M'); // move
  setTimeout(() => stdin.push('\x1b[<0;5;2M'), 120);
  setTimeout(() => stdin.push('\x1b[<0;5;2m'), 200);
  setTimeout(() => stdin.push('\x1b[<64;5;2M'), 300); // wheel up
  setTimeout(() => {
    log('DONE');
    process.exit(0);
  }, 700);
}, 600);
