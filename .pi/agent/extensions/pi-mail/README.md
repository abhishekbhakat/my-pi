# pi-mail

Use `mail` to leave a message for another Pi session on this machine. Use
`pager` if that session needs to act before it checks its inbox.

## Mail

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

## Pager

Call `pager` with `action: "send"`, `to`, and `message`. Use a live name,
full session ID, or unique ID prefix for `to`. If the recipient is offline,
use `mail`.

If the user has the same session open in two processes, Pager picks the one
with the latest startup, user input, or branch navigation. The receiving Pi
process submits the page as a user message on the branch it has open. An idle
session starts a turn. A busy session steers after its current tool calls.
Pager does not edit session files. Capability children and one-shot Pi runs
can send pages but cannot receive them.

Pager waits up to three seconds for the target to acknowledge the user
message. A timeout does not cancel the page. Unclaimed pages expire after
30 seconds or when the receiving session closes or switches sessions.
Use mail for anything that can wait. Pages are limited to 4,000 characters,
five per target process per minute, and three reply hops.

## Session names

Open Pi in `data-pipelines` to get `dp1`. Open a second session there while
`dp1` is live to get `dp2`. Pi takes two initials from a multi-word directory
name or two letters from a single word (`docs` gets `do`). A one-letter name
gets an `x` suffix; a directory with no letters gets `sx`. If two working
directories claim the same prefix, Pi adds a letter to the later project's
prefix. Each absolute working directory keeps its prefix.

The footer shows your name, such as `dp1`, at the right end of the status line,
where the long session ID used to be. Use `mail sessions` to find other
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

## User mail over the LAN

Use `/pi-user-mail <alias>` to choose an address, then use `user_mail` to
send, list, or read passive messages. Run `/pi-user-mail` without an alias to
see the selected server. Only the Pi session hosting it shows `srv`.

User mail uses gRPC on TCP 15926 and IPv4 UDP discovery on port 15925. Update
and reload Pi on each laptop. The gRPC clients and servers do not talk to
older HTTP versions. Both ports must be reachable for automatic discovery
and delivery to work. A laptop can join without hosting if you launch Pi
with `PI_USER_MAIL_SERVER=never`.

Use only on a trusted network: connections are unencrypted and the server
does not authenticate user IDs. If laptops cannot discover each other,
each can start a server. A server that yields leaves its existing mail on
its own disk; user mail does not move inboxes between hosts.

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
