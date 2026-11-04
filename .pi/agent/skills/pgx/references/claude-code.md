# Claude Code

Status: **verified live** (Claude Code 2.1.310, macOS): the SessionStart
hook's exports reached Bash tool commands, the session id matched
`CLAUDE_CODE_SESSION_ID`, PreToolUse and SessionEnd fired, SessionEnd fired on
a normal headless exit.

## Two ways to install the skill in Claude Code

- **Plugin (native)**: `/plugin marketplace add pgrundev/pgx` then
  `/plugin install pgx@pgrundev` inside a session (shell:
  `claude plugin marketplace add pgrundev/pgx && claude plugin install
  pgx@pgrundev`). The skill is namespaced `/pgx:pgx`; `claude plugin list`
  shows `pgx@pgrundev`, `claude plugin update pgx@pgrundev` upgrades it,
  `/plugin uninstall pgx@pgrundev` removes it (the skill only: databases,
  templates, `.pgx.toml` and project hooks are untouched).
- **Skills CLI**: `npx skills add pgrundev/pgx --skill pgx` copies the skill
  into `.claude/skills/pgx` (plus `.agents/skills/pgx` for Cursor and Codex).
  It loads as the plain skill `/pgx`.

Both copies are the same skill. With both installed, Claude Code lists `/pgx`
and `/pgx:pgx` side by side and either runs the same workflow; nothing is
duplicated at the database level because hooks and branches come from `pgx
agent setup`, never from the skill files. To keep one copy, remove the Skills
CLI one with `npx skills remove pgx` or the plugin with `/plugin uninstall
pgx@pgrundev`.

The plugin contains no hooks: `pgx agent setup` installs the project's hooks
into `.claude/settings.json` (idempotent, ownership-checked, see
[agent-lifecycle.md](agent-lifecycle.md)), so a plugin installed at user scope
does nothing in projects that have not opted in with `.pgx.toml`.

## How it works

`pgx agent setup` (or `pgx agent install claude`) adds six entries to
`.claude/settings.json`:

- `SessionStart` → `pgx agent up` for `session_id`, appends the nine
  `export` lines to `$CLAUDE_ENV_FILE` (Claude runs that file before every
  Bash command), prints the context line you see at the top of the session.
  Fires on startup, resume, `/clear`, compaction and fork; resume and
  compaction find the same branch; `/clear` and fork are new session ids and
  get new branches.
- `UserPromptSubmit` → `pgx agent touch`.
- `PreToolUse` (matcher `Bash`): for the session's own commands, `touch`. For
  a subagent's command (the payload carries `agent_id`), the hook ensures the
  subagent's branch and answers with `updatedInput`: the command becomes

  ```
  /path/to/pgx agent exec --agent <agent_id> --cwd <project> -- /bin/zsh -c '<original>' # pgx-routed <branch>
  ```

  The wrapper attaches to the subagent's branch, puts its
  `DATABASE_URL`/`PG*` into the environment (overriding whatever the parent
  session exported, and clearing `PGSERVICE`), runs the original text in
  your shell and exits with its status. The original is one single-quoted
  argument, so quoting, pipes, heredocs, redirects, background jobs and the
  exit status are untouched, and no secret appears in the command text. If
  the branch cannot be ensured (PGX not initialised, source missing, bad
  `.pgx.toml`, unusable `agent_id`) the hook answers `permissionDecision:
  deny` with the reason, so the command never runs against the parent's
  database; a stopped runtime is started on demand, as for `SessionStart`.
  The hook never answers `allow`: the rewritten command goes through Claude
  Code's normal permission flow, evaluated on the rewritten text. Add an
  allow rule for the wrapper if you do not want to confirm every subagent
  command, for example `Bash(/path/to/pgx agent exec:*)`, where `/path/to/pgx` is the absolute path the rewritten command starts with (for the installer, `~/.local/bin/pgx` written out; `pgx agent doctor` shows it) (the
  path is the `pgx` the hook resolved; `pgx agent doctor` prints it). In
  auto mode, Claude Code's classifier judges the rewritten command and may
  refuse one it would have allowed unwrapped; the same allow rule is the
  remedy.
- `SubagentStart` → `pgx agent up` for `(session_id, agent_id)`: the
  subagent's own branch, cloned from the same source, named
  `agent-claude-<session8>-<agent8>`; the subagent reads a context line
  naming it. Starting the same subagent again (resume) finds the same branch.
- `SubagentStop` → `pgx agent down` for that subagent: its backends are
  terminated (a statement it left running cannot commit later) and the
  branch is retired with the grace period. The parent's branch is untouched.
- `SessionEnd` → `pgx agent down` (grace period). `claude --continue` within
  10 minutes finds the branch intact.

Why routing rather than environment: Claude Code offers `CLAUDE_ENV_FILE` to
`SessionStart` only, and a subagent's Bash runs with the parent's
environment, so without the `PreToolUse` rewrite every subagent would use
the parent's branch (the 2026-10-26 benchmark showed exactly that). Tools
other than Bash, MCP servers and processes the parent started before the
subagent existed are not routed: they see the parent's environment.

`claude --worktree <name>` starts a new session id in a new worktree and
therefore gets its own branch; `.pgx.toml` must be committed so the worktree
sees it.

## In the session that ran setup

That session had no SessionStart after the hooks were installed, so its Bash
environment has no `DATABASE_URL` from PGX. Use `pgx agent exec -- <cmd>`:
it attaches to this session (`CLAUDE_CODE_SESSION_ID`), creates the branch
on first use, and keeps it. Or tell the user to start a new session.

## Scope choices

`--scope project` (default) writes `.claude/settings.json`, shared through
git; teammates without PGX get a silent no-op. `--scope local` writes
`.claude/settings.local.json` (personal, gitignored by Claude Code).
`--scope user` writes `~/.claude/settings.json` for every project; then the
source comes from each project's `.pgx.toml`.

## Trust and headless runs

Project hooks run in trusted folders; `claude -p` runs them regardless
(unless `--bare`). The hook touches only the local PGX home.

## Checking

`pgx agent doctor` inside the session: the `session` line must say that
`DATABASE_URL` is the branch, `hooks:claude` must report 6 hooks (a
`partial installation` means the project was set up before the subagent
hooks existed: `pgx agent install claude` adds them), and the `subagents`
line summarises the hook log. `echo $PGX_BRANCH` in Bash shows the branch;
inside a subagent, `echo $PGX_BRANCH $PGX_AGENT_ID $PGX_ROUTED` shows its
own branch, its id and `1`. `~/.pgx/agent/hooks.log` lists every delivery
(`SubagentStart … -> created agent-claude-…`, `PreToolUse … -> routed to …`,
`SubagentStop … -> retired …`).
