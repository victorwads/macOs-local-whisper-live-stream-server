#!/usr/bin/env python3
import argparse
import sys
import curses

from download_model import SUPPORTED


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Choose a Whisper model interactively.")
    parser.add_argument("--default", default="large-v3", help="Default selection if not interactive.")
    return parser.parse_args()


def choose_with_curses(options, default):
    def _inner(stdscr):
        curses.curs_set(0)
        stdscr.nodelay(False)
        try:
            default_idx = options.index(default)
        except ValueError:
            default_idx = 0
        idx = default_idx
        while True:
            stdscr.erase()
            stdscr.addstr(0, 0, "Use ↑/↓ and Enter to choose a model")
            for i, opt in enumerate(options):
                prefix = "➤ " if i == idx else "  "
                stdscr.addstr(i + 2, 0, f"{prefix}{opt}")
            stdscr.refresh()
            ch = stdscr.getch()
            if ch in (curses.KEY_UP, ord("k")):
                idx = (idx - 1) % len(options)
            elif ch in (curses.KEY_DOWN, ord("j")):
                idx = (idx + 1) % len(options)
            elif ch in (curses.KEY_ENTER, ord("\n"), ord("\r")):
                return options[idx]
    return curses.wrapper(_inner)


def main() -> None:
    args = parse_args()
    options = sorted(SUPPORTED)

    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print(args.default)
        return

    choice = choose_with_curses(options, args.default)
    print(choice)


if __name__ == "__main__":
    main()
