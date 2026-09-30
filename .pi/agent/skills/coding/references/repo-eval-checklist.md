---
name: repo-eval-checklist
description: Six scored gates that measure repo hygiene. Run before claiming a change is done, or when auditing an unfamiliar repo.
---

# Repo eval checklist

Six gates. Each gate prints its own numbers, so run them and read the output. No self-report from memory.

Run all gates from repo root. Substitute the tracked-file scope for your repo; `vendor/` and `archive/` stay excluded from size and shape gates because they hold third-party and dead code.

## Score table

| Gate             | Question                             | Full                      | Partial          | Zero              |
| ---------------- | ------------------------------------ | ------------------------- | ---------------- | ----------------- |
| 1 File size      | Any owned file over 300 lines?       | 0 over 300                | 1 to 3 over 300  | 4+ over 300       |
| 2 Folder size    | Any folder holding 13+ files?        | 0 folders at 13+          | 1 folder at 13+  | 2+ folders at 13+ |
| 3 Dependency use | Do libraries used, not reinvented?   | see gate                  | see gate         | see gate          |
| 4 Tree nesting   | Do folders group by capability?      | clean                     | mixed            | flat              |
| 5 Makefile       | One entry point for common actions?  | has help + install + test | has some targets | none              |
| 6 Classification | Does the top level name the product? | names domains             | mixed            | vague buckets     |

Gate 3 needs judgment, not a number. The other five print their own evidence.

## Gate 1: file size

Own code over 300 lines is a maintenance cost, and the next reader pays it. Skill docs and vendored assets are exempt; they grow by reference, not by logic.

```bash
git ls-files | grep -vE '^(vendor|archive)/' | while read -r f; do
  [ -f "$f" ] || continue
  n=$(wc -l < "$f")
  [ "$n" -gt 300 ] && printf '%6d  %s\n' "$n" "$f"
done | sort -rn
```

Fix by splitting along a real boundary: separate transport from policy, parser from renderer, table from the column-width math. A split that only moves lines down a directory does not count.

## Gate 2: folder size

A folder past 12 files stops reading as a group. A stranger running `tree` should infer responsibility from names alone, and 30 siblings defeat that.

```bash
git ls-files | grep -v '^vendor/' | while read -r f; do dirname "$f"; done \
  | sort | uniq -c | sort -rn | awk '$1 > 12'
```

Split by ownership or capability. A folder named `shared`, `common`, `core`, `utils`, or `helpers` needs a stated contract before it merges anything.

## Gate 3: dependency use

Count external packages in use against the work those packages already do. High line counts next to a thin dependency list mean the code rebuilt something a library ships.

```bash
# declared runtime deps
cat .pi/agent/extensions/package.json 2>/dev/null || cat package.json

# what owned modules actually import
for f in $(git ls-files '*.ts' '*.mjs' '*.js' | grep -vE '^(\.pi/agent/skills|archive|vendor)/'); do
  grep -hoE 'from "[^"]+"|require\("[^"]+"\)' "$f" 2>/dev/null \
    | grep -vE '"\.{1,2}/|"node:|"[^"]*\.json"'
done | sed -E 's/from "//; s/require\("//; s/"$//' \
  | sed -E 's|^(@[^/]+/[^/]+).*|\1|; s#^([^@][^/]*)/.*#\1#' \
  | sort | uniq -c | sort -rn
```

Grade it this way:

- **Full.** Each non-trivial owned module maps to a package or a platform API. Hand-rolled code stays thin wrappers over a library, or solves something no library covers.
- **Partial.** Some reinvention, each instance defensible: a small dependency avoided, a runtime constraint, a case the library mishandles.
- **Zero.** Owned code reimplements tree rendering, markdown layout, HTTP serving, argument parsing, or diffing at size, with no stated reason.

Name the reinvention and its line count in the audit. "Depends are few" says nothing on its own.

## Gate 4: tree nesting

Flat means responsibility is guesswork. Check three levels.

```bash
tree -L 3 -d --gitignore -I 'node_modules|vendor|__pycache__'
```

Full pass: every folder at depth 2+ holds folders or a small set of same-kind files. Partial: some capability folders nest, others park loose files beside them. Zero: owned code sits flat at the top of its parent.

Exempt: root config files (`Makefile`, `AGENTS.md`, `README.md`, lockfiles, dotfiles).

## Gate 5: Makefile

Common actions belong behind one entry point, so a new contributor runs one command instead of reading scripts.

```bash
grep -nE '^[a-zA-Z0-9_.-]+:' Makefile
make help
```

Full pass: a `help` target that lists the rest, plus the everyday actions (install, test, sync, lint, build). Partial: targets exist, no help. Zero: no Makefile, so the README carries a shell incantation.

## Gate 6: conceptual classification

The top level tells a stranger what the repo does.

```bash
ls -a
```

Full pass: names are product domains, shared contracts, adapters, scripts, docs. Partial: some real names plus one vague bucket. Zero: `misc`, `helpers`, `common`, `temp`, `old`, `new`, or a bare `core`.

## Audit output

Report the printed numbers, then one line per gate with the grade. Keep the file paths that failed. Do not soften a zero into a partial because the code works.

```text
Gate 1 file size:      zero       34 files >300, worst scripts/pi.mjs 1843
Gate 2 folder size:    partial    userinterface-wiki/rules 154 files
Gate 3 dependency use: zero       3 runtime deps, 454-line hand-rolled tree renderer
Gate 4 tree nesting:   partial    scripts/ flat 4 files
Gate 5 Makefile:       full       16 targets, make help
Gate 6 classification: full       scripts, tests, archive, .pi
```

## What a zero means

Fix order, top first:

1. Architecture. Split the file along a real boundary, or give the flat folder a capability name.
2. CI. Gate the metric so the count cannot climb back. A ceiling slightly above the current baseline works.
3. Rule. Add the gate to this file only after levels 1 and 2 cannot hold it.

A rule that restates a metric nobody checks is a note, not a gate.
