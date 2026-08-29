"""Replay an alt-screen ANSI capture into a grid, so a TUI frame can be read.

The client's rendered components are verified by running it, and this is what
makes "running it" checkable without a person watching. Capture a session under
a pty, replay it here, and what comes back is the frame as the terminal would
have drawn it.

    perl -e 'alarm(8); exec("script", "-q", "/dev/null", "sh", "-c",
             "stty rows 40 cols 140; bun run src/main.tsx")' </dev/null > /tmp/tui.log 2>&1
    python3 scripts/screen.py /tmp/tui.log 40 140

Stripping the escapes and reading the log directly does **not** work, and fails
in a way that looks like a rendering bug: the renderer draws with absolute
cursor moves, so removing them collapses the whole frame onto one line and two
components appear to overlap. Every apparent corruption found while porting this
client to its current renderer was this, and not the renderer.

Cursor motions are handled to the extent a frame needs — absolute positioning,
relative moves, column set, erase-to-end-of-line, clear. It is a reader for
snapshots, not a terminal emulator; anything more and the answer is a real one.
"""
import re, sys

def render(path, rows=44, cols=150):
    raw = open(path,'rb').read().decode('utf8','replace')
    raw = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)','',raw)      # OSC
    raw = re.sub(r'\x1b[_P][^\x1b]*\x1b\\','',raw)               # DCS/APC
    g = [[' ']*cols for _ in range(rows)]
    r = c = 0
    i = 0
    csi = re.compile(r'\x1b\[([0-9;?><]*)([a-zA-Z])')
    while i < len(raw):
        ch = raw[i]
        if ch == '\x1b':
            m = csi.match(raw, i)
            if m:
                args, fin = m.group(1), m.group(2)
                if fin == 'H':
                    p = [int(x) for x in args.split(';') if x.isdigit()] or [1,1]
                    r = (p[0]-1) if len(p) > 0 else 0
                    c = (p[1]-1) if len(p) > 1 else 0
                elif fin in 'ABCD':
                    n = int(args) if args.isdigit() else 1
                    if fin == 'A': r -= n
                    elif fin == 'B': r += n
                    elif fin == 'C': c += n
                    elif fin == 'D': c -= n
                elif fin == 'G':
                    c = (int(args) - 1) if args.isdigit() else 0
                elif fin == 'K':
                    if 0 <= r < rows:
                        for x in range(c, cols): g[r][x] = ' '
                elif fin == 'J' and args in ('2','', '0'):
                    g = [[' ']*cols for _ in range(rows)]
                i = m.end(); continue
            i += 1; continue
        if ch == '\n': r += 1; c = 0; i += 1; continue
        if ch == '\r': c = 0; i += 1; continue
        if 0 <= r < rows and 0 <= c < cols and ch >= ' ':
            g[r][c] = ch
        c += 1; i += 1
    return '\n'.join(''.join(row).rstrip() for row in g)

if __name__ == '__main__':
    out = render(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
    print('\n'.join(l for l in out.split('\n') if l.strip()))
