---
name: tinyfish
description: >-
  Set up TinyFish (web-driving agent MCP + skills) for every coding agent on
  this machine, and verify the install. Trigger on "set up TinyFish",
  "install TinyFish", "tinyfish connect", "tinyfish doctor", or user ask to
  register TinyFish MCP for pi or other agents.
keywords: [tinyfish, mcp, connect, doctor, web agent, browser agent]
---

# TinyFish

TinyFish registers an MCP server into every installed coding agent
(pi, Claude Code, Codex, ...) and installs its skills. CLI ships via npx.

## Authentication

Key precedence:

1. Environment: `TINYFISH_API_KEY`
2. `tinyfish-auth.json` in this skill directory (gitignored)

```json
{
  "api_key": "sk-tinyfish-..."
}
```

Get key: user supplies it. Never echo key into chat, commits, or logs.
If key missing, ask user once; do not retry blind.

## Setup flow

1. Read key (env or `tinyfish-auth.json`).
2. Warn user before connect: command may pause up to 10 minutes waiting on
   browser sign-in only user can finish. Use 600s timeout.
3. Connect (registers MCP for all detected agents, installs skills):

```bash
npx -y @tiny-fish/cli@latest connect --all \
  --api-key "$TINYFISH_API_KEY" \
  --skip-launch \
  --url "https://agent.tinyfish.ai/mcp"
```

4. Verify:

```bash
npx -y @tiny-fish/cli@latest doctor --pretty
```

5. If doctor lists failures, run repairs in listed order. Repairs with
   `unattended_safe: false` belong to user: show command, do not run it.
   Re-run doctor after repairs until clean.

6. Proof: use TinyFish tools to fetch today's top Hacker News story.
   Tools appear only in a session started after install. If missing in
   this session, say so; do not reinstall.

7. Report: which agents connected, which need user browser sign-in,
   anything unfinished.

## Agent rules

1. Never quote API key back to user or into any output.
2. Never rerun connect when tools missing post-install; new session needed.
3. `--skip-launch` always; agent does not launch other apps.
4. If connect/doctor unavailable (no npx, offline), report and stop.
