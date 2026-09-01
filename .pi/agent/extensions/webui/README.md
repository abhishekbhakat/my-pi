# webui + SSM

SSM is a **detached manager** on a fixed port. It does not belong to a pi session pid.

```text
http://127.0.0.1:17300/ssm           catalog (daemon, survives pi quit)
http://127.0.0.1:17300/view?path=…   read-only session
http://127.0.0.1:17300/              live UI (proxied to the pi that registered)
```

## Commands

| Command | Action |
| ------- | ------ |
| `/ssm` | Ensure daemon, open catalog |
| `/webui` | Register this session as live, open `/` |

## Daemon

`~/.pi/agent/bin/ssm-server` (copied by `make install`).

- Binds **only** `127.0.0.1:17300`
- Catalog + archive + view from disk
- Live `/` and `/__webui/*` reverse-proxy to the last registered pi (ephemeral loopback port)
- No pi attached → stub page on `/`; `/ssm` still works
- Stop: `~/.pi/agent/bin/ssm-server --stop`

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

If 17300 is an old in-process webui: quit that pi, or `ssm-server --stop` after install.

Then `/reload`. Bookmark `http://127.0.0.1:17300/ssm`.
