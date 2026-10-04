---
name: pi-durable-decisions
description: >-
  Build a long-running app on @earendil-works/pi-durable that steers a Pi
  harness and does most judgments with System One models (Jev, GLiDE, Clef).
  Use when the user wants a durable agent app, crash-safe resume, Docker,
  multi-person steering, or CLM-first routing before the LLM writes.
keywords: [pi-durable, harness, sqlite, docker, system one, jev, glide, clef, noul, lattice]
---

# Pi durable apps

`@earendil-works/pi-durable` is the runtime. Not `pi.appendEntry`. Not an
extension inside this repo. The app process owns the harness. CLMs decide
route, gate, and done. The harness LLM only writes the residue.

Copy `templates/app/` into a new project. Pin the three packages. API is
experimental and changes between releases.

## Runtime facts

Cite these from the installed package before you invent calls.

- `Harness.open(storage, { models, registry }, context)` then `resume()` then
  `root()`. Node `>=22.19`. SQLite via `openNodeSqliteStorage`.
- One process per sqlite file. WAL. No cross-process lock. Docker: one
  replica, volume on the db path.
- `submit` with a stable `requestId` is idempotent. `harness.close` on
  SIGTERM. Next start `resume()` continues interrupted work.
- Tools are durable tasks. A CLM call inside a tool must be replay-safe:
  read the verdict doc first, call the model only on a miss.

## Lattice

App code, not the model.

1. Route and gate with Noul / Choice / Score. Cap 16 questions per call.
2. Key a verdict by hash(question + evidence). Store it in the verdict
   file (`VERDICT_DB`) or another durable store, never in process memory.
   Same key on restart means reuse, no second CLM call.
3. Bands: noul true `>=0.65`, false `<=0.35`, else hedge. Choice needs
   margin `>=0.15`. Score needs top `p >= 0.4`. Hedge goes to the LLM.
4. Submit one prompt that already contains the verdicts. LLM output is only
   the residue.
5. Verify with another CLM pass over the result before you report done.

Decider wire (no secrets in the repo):

- `POST {base}` with `{ state, model, questions }`. `questions` is an
  id-keyed map of `{ type, instructions, criteria }`.
- Auth: `Authorization: Bearer` normally, `x-api-key` for Fastino.
- Response: `{ answers: { [id]: { noul, choice, score, probabilities } } }`.
  Cloudflare Clef wraps it in `{ result, success }`.

Env only: `OPENAI_API_KEY`, `DECIDER_BASE_URL`, `DECIDER_API_KEY`,
`DECIDER_MODEL`, `DECIDER_AUTH`, `PI_MODEL`, `SESSION_DB`, `VERDICT_DB`.
Never copy a baked fallback key into the app.

## Docker

`Dockerfile` uses `node:22-bookworm-slim` (engine floor 22.19).
`compose.yaml` mounts a named volume at `/data`, sets `SESSION_DB`, and
stops with a grace period so `close()` can checkpoint WAL.

Smoke, from the app dir:

```bash
docker compose build
docker compose up -d
docker kill --signal=TERM <container>
docker compose up -d
```

Second start must log `resumed` and must not re-ask a verdict whose key
is already in the doc. One replica only.

## Do not

- Add unit tests unless the user asks.
- Register tools on this repo's pi, or edit `deciders.json`.
- Run two containers on one sqlite file.
- Print API keys.
