#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Justify markdown tables (default ceiling 128).

Two regimes (never shrink/rewrap cell text):

1. **Perfect** — if natural width (sum of per-column max cell lengths +
   pipe overhead) is <= ceiling: pad every cell to those maxes. All rows
   share one length; pipes align; no pad past content.
2. **Ceiling** — if natural width exceeds the ceiling: size columns from
   majority stats (p75 / median / header), shrink under the ceiling; cells
   longer than their column overflow that row only.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_WIDTH = 128
TABLE_LINE = re.compile(r"^\s*\|.*\|\s*$")
SEP_CELL = re.compile(r"^:?-+:?$")


def is_table_line(line: str) -> bool:
    return bool(TABLE_LINE.match(line))


def is_separator_row(cells: list[str]) -> bool:
    """True if every non-empty cell is a GFM separator; need at least one."""
    nonempty = [c for c in cells if c.strip()]
    if not nonempty:
        return False
    return all(SEP_CELL.match(c.replace(" ", "")) for c in nonempty)


def split_row(line: str) -> list[str]:
    """Split a GFM row on unescaped pipes; backslash-pipe stays literal."""
    raw = line.strip()
    if raw.startswith("|"):
        raw = raw[1:]
    # GFM rows end with a delimiter pipe. A final cell that ends in a literal
    # pipe is written as ...\| |  (escaped pipe, then closing delimiter).
    if raw.endswith("|"):
        raw = raw[:-1]

    cells: list[str] = []
    buf: list[str] = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch == "\\" and i + 1 < len(raw) and raw[i + 1] == "|":
            buf.append("|")
            i += 2
            continue
        if ch == "|":
            cells.append("".join(buf).strip())
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    cells.append("".join(buf).strip())
    return cells


def trim_empty_columns(rows: list[list[str]]) -> list[list[str]]:
    """Drop trailing columns with no real content (phantom pipe splits).

    Separator-only cells (``---``) do not count as content — otherwise a
    ragged header like ``| a | b |   |   |`` keeps ghost columns forever.
    """
    if not rows:
        return rows
    col_count = max(len(r) for r in rows)
    for r in rows:
        while len(r) < col_count:
            r.append("")

    sep_idx = next((i for i, r in enumerate(rows) if is_separator_row(r)), None)

    def col_has_content(c: int) -> bool:
        for i, r in enumerate(rows):
            if sep_idx is not None and i == sep_idx:
                continue
            if r[c].strip():
                return True
        return False

    last = col_count - 1
    while last > 0 and not col_has_content(last):
        last -= 1
    width = last + 1
    return [r[:width] for r in rows]


def parse_align(cell: str) -> str:
    s = cell.replace(" ", "")
    left = s.startswith(":")
    right = s.endswith(":")
    if left and right:
        return "center"
    if right:
        return "right"
    return "left"


def pad_cell(text: str, width: int, align: str) -> str:
    """Pad text to width. If text is longer, return it unchanged (row overflows)."""
    text = text.strip()
    if len(text) >= width:
        return text
    if align == "right":
        return text.rjust(width)
    if align == "center":
        return text.center(width)
    return text.ljust(width)


def format_separator(width: int, align: str) -> str:
    # Keep at least 3 dashes so GFM alignment still parses.
    inner = max(width, 3)
    body = "-" * inner
    if align == "center":
        return ":" + body[1:-1] + ":"
    if align == "right":
        return body[:-1] + ":"
    return body


def row_width(col_widths: list[int]) -> int:
    # "| a | b |" == sum(w_i) + 3*n + 1
    n = len(col_widths)
    return sum(col_widths) + 3 * n + 1


def percentile_nearest_rank(sorted_vals: list[int], pct: float) -> int:
    """Nearest-rank percentile on a non-empty ascending list (pct in 0..100)."""
    if not sorted_vals:
        raise ValueError("empty sample")
    n = len(sorted_vals)
    # ceil(pct/100 * n), 1-based, integer-only
    rank = max(1, min(n, (int(pct * n) + 99) // 100))
    return sorted_vals[rank - 1]


def median_of(sorted_vals: list[int]) -> int:
    if not sorted_vals:
        return 0
    n = len(sorted_vals)
    mid = n // 2
    if n % 2:
        return sorted_vals[mid]
    # even: lower median keeps integers tight (ADHD: prefer smaller)
    return sorted_vals[mid - 1]


def col_maxes(
    header_lens: list[int], body_lens: list[list[int]], col_count: int
) -> list[int]:
    """Widest cell per column (header + body), floor 3."""
    out: list[int] = []
    for c in range(col_count):
        mx = header_lens[c]
        if body_lens[c]:
            mx = max(mx, max(body_lens[c]))
        out.append(max(3, mx))
    return out


def typical_widths(
    header_lens: list[int], body_lens: list[list[int]], col_count: int
) -> tuple[list[int], list[int], list[int]]:
    """Pick (base, soft_floor, hard_floor) per column from majority stats.

    Used only when natural max-width table exceeds the ceiling.

    * base       = max(3, header, p75(body)) — preferred layout width
    * soft_floor = max(3, header, median(body)) — first shrink stop
    * hard_floor = max(3, header) — last resort under the ceiling
    * ≤2 body samples → base = max (percentile unstable)
    """
    bases: list[int] = []
    softs: list[int] = []
    hards: list[int] = []
    for c in range(col_count):
        samples = list(body_lens[c])
        h = header_lens[c]
        hard = max(3, h)
        if not samples:
            bases.append(hard)
            softs.append(hard)
            hards.append(hard)
            continue
        samples_sorted = sorted(samples)
        mx = max(samples_sorted[-1], h)
        if len(samples_sorted) <= 2:
            base = max(3, mx)
            soft = max(hard, median_of(samples_sorted))
            bases.append(base)
            softs.append(min(soft, base))
            hards.append(hard)
            continue
        p75 = percentile_nearest_rank(samples_sorted, 75)
        med = median_of(samples_sorted)
        soft = max(hard, med)
        base = max(hard, p75, soft)
        base = min(base, mx) if mx >= soft else base
        base = max(base, soft)
        bases.append(base)
        softs.append(soft)
        hards.append(hard)
    return bases, softs, hards


def scale_toward(widths: list[int], floors: list[int], target: int) -> list[int]:
    """Peel width from the slackiest columns down toward floors until on budget."""
    out = list(widths)
    n = len(out)
    if n == 0 or row_width(out) <= target:
        return out
    deficit = row_width(out) - target
    while deficit > 0:
        slacks = [(out[i] - floors[i], i) for i in range(n) if out[i] > floors[i]]
        if not slacks:
            break
        slacks.sort(reverse=True)
        _, idx = slacks[0]
        out[idx] -= 1
        deficit -= 1
    return out


def choose_widths(
    maxes: list[int],
    bases: list[int],
    soft_floors: list[int],
    hard_floors: list[int],
    target: int,
) -> list[int]:
    """Pick column widths.

    Natural width = sum(per-column max cell length) + pipe overhead.
    Shortest aligned grid without shrinking text (widest cells may sit on
    different rows).

    Branch A — perfect (natural <= target):
        widths = maxes → every row length == natural, pipes align.

    Branch B — ceiling (natural > target):
        Start from **maxes** (not p75 bases) and peel toward soft then hard
        floors. Peeling prefers columns with the most slack above the floor,
        so short columns keep their full max (e.g. Doctype stays wide enough
        for ``**judgment**``) while long text columns absorb the cut. Cells
        still longer than the final width overflow that row only.

        ``bases`` (p75) is retained for callers/tests as the soft preference
        signal already embedded in ``soft_floors`` / majority stats.
    """
    del bases  # majority signal lives in soft_floors; shrink starts at maxes
    if row_width(maxes) <= target:
        return list(maxes)
    # Peel outlier tail first (max → soft), then into the median/header floor.
    scaled = scale_toward(maxes, soft_floors, target)
    scaled = scale_toward(scaled, hard_floors, target)
    return scaled


def justify_table(lines: list[str], target: int) -> list[str]:
    rows = trim_empty_columns([split_row(line) for line in lines])
    if len(rows) < 2:
        return lines

    col_count = max(len(r) for r in rows)
    if col_count == 0:
        return lines

    for r in rows:
        while len(r) < col_count:
            r.append("")

    sep_idx = next((i for i, r in enumerate(rows) if is_separator_row(r)), None)
    aligns = ["left"] * col_count
    if sep_idx is not None:
        aligns = [parse_align(c) for c in rows[sep_idx]]
        while len(aligns) < col_count:
            aligns.append("left")

    # Header = first non-separator row.
    header_idx = next(
        (i for i in range(len(rows)) if sep_idx is None or i != sep_idx),
        0,
    )
    header_lens = [len(rows[header_idx][c].strip()) for c in range(col_count)]
    body_lens: list[list[int]] = [[] for _ in range(col_count)]
    for i, r in enumerate(rows):
        if i == header_idx:
            continue
        if sep_idx is not None and i == sep_idx:
            continue
        for c in range(col_count):
            body_lens[c].append(len(r[c].strip()))

    maxes = col_maxes(header_lens, body_lens, col_count)
    bases, softs, hards = typical_widths(header_lens, body_lens, col_count)
    widths = choose_widths(maxes, bases, softs, hards, target)

    out: list[str] = []
    for i, r in enumerate(rows):
        if sep_idx is not None and i == sep_idx:
            cells = [format_separator(widths[c], aligns[c]) for c in range(col_count)]
        else:
            raw = [r[c].strip() for c in range(col_count)]
            # Pad cells that fit the grid, but only until the first overflow.
            # - Earlier columns stay aligned with the header.
            # - Once a cell runs long, later cells stay content-tight (no
            #   trailing pad that cannot match the header — ADHD noise).
            cells = []
            seen_overflow = False
            for c in range(col_count):
                text = raw[c]
                if len(text) > widths[c]:
                    seen_overflow = True
                    cells.append(text.replace("|", "\\|"))
                elif seen_overflow:
                    cells.append(text.replace("|", "\\|"))
                else:
                    cells.append(
                        pad_cell(text, widths[c], aligns[c]).replace("|", "\\|")
                    )
        out.append("| " + " | ".join(cells) + " |")
    return out


def justify_markdown(text: str, target: int = DEFAULT_WIDTH) -> str:
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        if not is_table_line(lines[i]):
            out.append(lines[i])
            i += 1
            continue

        start = i
        while i < len(lines) and is_table_line(lines[i]):
            i += 1
        block = lines[start:i]
        parsed = [split_row(x) for x in block]
        if len(block) >= 2 and any(is_separator_row(r) for r in parsed):
            out.extend(justify_table(block, target))
        else:
            out.extend(block)

    result = "\n".join(out)
    if text.endswith("\n"):
        result += "\n"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ASCII-justify markdown tables to a target row width."
    )
    parser.add_argument(
        "path",
        nargs="?",
        help="Markdown file to rewrite in place. Reads stdin if omitted.",
    )
    parser.add_argument(
        "-w",
        "--width",
        type=int,
        default=DEFAULT_WIDTH,
        help=f"Target characters per typical table row (default: {DEFAULT_WIDTH}).",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Write to this path instead of stdout / in-place.",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="With a file path, print result instead of editing in place.",
    )
    args = parser.parse_args()

    if args.width < 8:
        print("width must be >= 8", file=sys.stderr)
        return 2

    if args.path:
        src = Path(args.path)
        text = src.read_text(encoding="utf-8")
    else:
        text = sys.stdin.read()

    result = justify_markdown(text, target=args.width)

    if args.output:
        Path(args.output).write_text(result, encoding="utf-8")
    elif args.path and not args.stdout:
        Path(args.path).write_text(result, encoding="utf-8")
    else:
        sys.stdout.write(result)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
