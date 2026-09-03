# pi-mail

Passive mailbox for pi sessions on one machine. You queue a message into
another session mailbox. That session reads it when active. Nothing runs a
turn on anyone behalf.

## Tool

One tool, `mail`, three actions.

```text
mail send          Queue text into a target mailbox. Answers queued, never delivered.
mail inbox         Peek unread headers with age. Takes optional limit.
mail read          Inject unread bodies into your own current leaf and mark them read.
```

Address a mailbox by full session id or a unique prefix. Ambiguous prefixes
and unknown ids fail with an error. You cannot mail your own session.

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
  index.ts            Extension entry, registers mail tool and message renderer
  mailbox.ts          Queue, list, resolve, ack, TTL
  resolver.ts         Live-candidate pick for diagnostics (send path never calls it)
```

## Limits

- One message body: at most 100_000 characters.
- One mailbox unread total: at most 100_000 characters of body text.
- `inbox` / `read` `limit`: capped at 50 (default 20).
- One `read` batch stops once injected body text hits 100_000 characters;
  remaining unread stay queued for the next `read`.

Reminders are tool snippets plus inbox counts. The agent still has to look.
Ever-forked session files refuse disk diagnosis without a marker; live
self-report removes that gap.
