# webui + SSM

SSM is a **detached manager** on a fixed port. It does not belong to a pi session pid.

```text
http://127.0.0.1:17300/ssm              catalog (daemon, survives pi quit)
http://127.0.0.1:17300/view?path=…      read-only session
http://127.0.0.1:17300/live?id=<id>     live UI for that session (proxied)
```

## Commands

| Command | Action |
| ------- | ------ |
| `/ssm` | Ensure daemon, open catalog |
| `/ssm-restart` | Stop + start daemon on 17300, re-register this session (notify only) |
| `/webui` | Register this session as live, open `/live?id=<sessionId>` |

## Daemon

`~/.pi/agent/bin/ssm-server` (copied by `make install`).

- Binds **only** `127.0.0.1:17300`
- Catalog + archive + view from disk
- Live `/` and `/__webui/*` reverse-proxy to the last registered pi (ephemeral loopback port)
- No pi attached → stub page on `/`; `/ssm` still works
- Restart from pi: `/ssm-restart` (or `~/.pi/agent/bin/ssm-server --stop` then start again)

Extension no longer binds 17300. It starts an internal live server on a random localhost port and POSTs `/api/live`.

## Open session from `/ssm`

**Open** → new tab read-only view. Does not switch the live agent.

## Lifecycle

- First `/ssm` or `session_start` spawns the daemon if health fails
- Daemon **stays up** when pi quits
- Pi quit: unregisters live backend, leaves daemon
- `/reload`: same; then re-registers
- Version mismatch in `/api/health` → stop + respawn

## Install

```bash
make install
```

If 17300 is an old in-process webui: quit that pi, `make install`, then `/ssm-restart`.

Then `/reload`. Bookmark `http://127.0.0.1:17300/ssm`.
