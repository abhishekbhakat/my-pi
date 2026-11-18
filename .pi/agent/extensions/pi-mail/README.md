# pi-mail

Passive mailbox for pi sessions on one machine. You queue a message into
another session mailbox. That session reads it when active. Nothing runs a
turn on anyone behalf.

## Tool

```text
mail send          Queue text for another session.
mail inbox         Peek at unread headers and their ages.
mail read          Show unread bodies in your current leaf and mark them read.
mail sessions      List live names, short IDs, full IDs, and working directories.
```

Use a full session ID, a live name such as `dp1`, or a unique ID prefix such as
`01a1ea16`. Pi checks in that order. A live name wins over a matching ID prefix,
and name lookup ignores case. You can address an offline mailbox by ID, but
not by name. You cannot mail your own session.

## Session names

Open Pi in `data-pipelines` to get `dp1`. Open a second session there while
`dp1` is live to get `dp2`. Pi takes two initials from a multi-word directory
name or two letters from a single word (`docs` gets `do`). A one-letter name
gets an `x` suffix; a directory with no letters gets `sx`. If two working
directories claim the same prefix, Pi adds a letter to the later project's
prefix. Each absolute working directory keeps its prefix.

The status bar shows your name as `mail dp1`. Use `mail sessions` to find other
live names. Each line gives the name, first 8 characters of the session ID,
full session ID, and quoted absolute working directory:

```text
dp1 01a1ea16 01a1ea16-7f47-73fb-9888-949a40b32ab0 "/work/data-pipelines"
```

Pi keeps the mapping in `<agent-dir>/pi-mail/names.json`. It checks each
owner's PID and process start time, drops dead owners on lookup, and releases
a name on session shutdown. Reloading or resuming a session that's still live
keeps its name. The next session takes the lowest free number, so use a full
ID if you need to contact the same session later. Capability child processes
such as the coder do not take names. If Pi cannot read the registry, you can
still use session IDs.

## Pickup rules

`read` injects display-only entries through `sendMessage` with
`deliverAs: steer`. It never triggers a turn and never sends as you, so your
own activity signal stays clean. Each message is marked read right after its
own inject. A crash mid-batch redelivers the remainder instead of dropping it.

Mail older than the TTL (7 days, `PI_MAIL_TTL_MS` overrides) shows a stale
flag. Check `inbox` when you start work and when you stall.

## Layout

```text
pi-mail/
  index.ts            Extension entry, registers mail + user_mail tools and renderer
  mailbox.ts          Agent mailbox: queue, list, resolve, ack, TTL
  names.ts            Live session names and persistent project prefixes
  resolver.ts         Live-candidate pick for diagnostics (send path never calls it)
  user-mail/          User-facing mail over the local network (issue #5)
    index.ts          pi wiring: command, tool dispatch, renderer
    session/          Election cache, srv chip, formatting
    identity.ts       username + alias, mail ids
    protocol.ts       Ports, wire types, validators
    client.ts         HTTP client to the network server
    discovery/        UDP query (clients) and responder (server)
    election.ts       Find or claim the one server per network
    mailbox/          Receiving: shared store, mirror sync, inbox, read
    outbox/           Sending: target resolution, envelope post
    server/           Only loaded by the election winner: routes, registry,
                      rate limit, node:http plumbing

See user-mail/DESIGN.md for the protocol and lifecycle.
```

`mail` stays session-to-session on one machine. `user_mail` targets users
across the LAN so a team can leave passive messages for each other.

## Limits

- One message body: at most 100_000 characters.
- One mailbox unread total: at most 100_000 characters of body text.
- `inbox` and `read`: 20 entries by default, at most 50.
- `sessions`: at most 50 entries by default; use `limit` for a shorter list.
- One `read` batch stops once injected body text hits 100_000 characters;
  remaining unread stay queued for the next `read`.

Reminders are tool snippets plus inbox counts. The agent still has to look.
Ever-forked session files refuse disk diagnosis without a marker; live
self-report removes that gap.
