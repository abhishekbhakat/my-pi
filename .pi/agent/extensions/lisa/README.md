# Lisa

Lisa pilots pi sessions for you. You talk to Lisa here. Lisa drives other sessions through herdr.

## Command

/lisa toggles Lisa. No arguments. On means bash only and herdr only. You approve sends and deletes.

On resumes your last Lisa session. A switch moves you there, then Lisa starts. Off stops Lisa and opens a fresh session.

## State

Lisa keeps state in lisa.db under the agent extensions dir. Lisa sets journal_mode=WAL on activation.

Check mode with `sqlite3 <db> "PRAGMA journal_mode;"`. Expect wal.

## Single owner

One Lisa runs at a time. Activation writes owner.lock with token and pid. The lock records session.

You get a refusal when you run a second /lisa on while the owner pid lives. A stale lock from a dead pid clears on next activation. Lisa releases the owned lock on quit.

## Single session

Lisa binds to one session. Activation records the session file. Next /lisa on returns there.

/delete stays blocked while Lisa owns the session. /new and /resume away stay blocked. /fork and /clone stay blocked. Toggle /lisa first to use them.

Limit: /xdelete still exits and deletes the transcript. Next /lisa restores the backup copy. Memories and tasks persist in lisa.db.

## Scope

Lisa skills come from skills/herdr inside this extension. Lisa hides that skill from prompts when off. Lisa hides all other skills from prompts when on.

Lisa prompt replaces the default pi prompt. PERSONALITY.md sets voice. The default pi prompt stays out.

Lisa memories live in table memories(key, value) in lisa.db. Lisa reads them at start. Lisa updates them as she learns.

Prompt filtering sets policy. It gives you no sandbox. Cached /skill commands and prior context can name other skills. Bash runs any command the shell allows. You own that risk.

## Footer

Lisa off hides the lisa segment. Lisa on shows lisa alone. Lisa clears fast and intent segments on activation and each turn. Lisa clears yolo the same way. Off opens a fresh session. Fresh start brings those segments back.

## Files

index.ts holds toggle and guard logic. lisa-db.ts holds lock and DB work. skills/herdr holds the bundled skill. PERSONALITY.md holds voice. README.md holds this overview.
