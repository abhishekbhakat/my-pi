---
name: xurl-posts
description: >
  Post, search, and read on X (Twitter) via the xurl CLI with OAuth2, without
  wasting API quota. Use when user want to post or tweet, quote or repost,
  search X or Twitter, find a specific tweet, read a post or profile, upload
  media to a post, delete a post, or mention xurl, X API, Twitter API quota,
  or rate limits.
keywords: [xurl, twitter, X, post, tweet, search, quote, repost, API]
---

# xurl: X (Twitter) from the shell

`xurl` (Go binary, `~/go/bin/xurl`) wraps the X API v2 with OAuth2 user auth.
Every command prints JSON. Companion skill: the official `xurl` skill (same
name, installed from the xdevplatform/xurl submodule) holds the full command
reference and the secret-safety rules (never read `~/.xurl/`, never `-v`,
never `xurl token` in agent sessions). This skill covers the part upstream
does not: quota-aware search strategy and posting pitfalls, proven in a real
session on a legacy free-tier app.

## Auth check (one call, then stop)

```bash
xurl /2/users/me          # who am I (costs 1 read)
xurl auth status          # local, free: shows app + user, no API call
```

Do not call `/2/users/me` repeatedly. Cache the user id once.

## Quota economics (read this before searching)

X API reads are metered (pay-per-use pricing since 2026: post reads around
$0.005/resource, own-data reads around $0.001; legacy free tier has fixed
monthly caps). Every network call spends quota or money. Rules:

1. **Cache every response to a file, filter locally.** Never re-fetch what a
   cached file already contains.
2. **One big fetch beats many small ones.** `xurl posts <user> -n 100` is one
   API call that covers a year for accounts posting a few times a week.
3. **Search returns minimum 10 results per call** (`-n` 10 to 100). Each
   search call is expensive; write one good query, not five vague ones.
4. **Recent search only covers the last 7 days.** Older content needs the
   user-timeline route (`xurl posts`), not search.
5. **Never run `xurl -v` in agent sessions.** The upstream `xurl` skill bans
   `--verbose` here: it can print sensitive headers and tokens into context.
   Treat 429 as the quota signal instead. Remaining-quota numbers live in the
   X developer dashboard, not in agent output.
6. **429 response**: quota window exhausted. Do not retry in a loop; read the
   reset timestamp and wait, or switch to cached data.

## Search workflow that does not waste quota

Goal: find a specific post or topic with the fewest API calls.

```bash
# 1. Is it in something already fetched? Check caches first.
ls /tmp/*.json

# 2. Known author? Pull timeline once, cache, grep locally.
xurl posts <username> -n 100 > /tmp/<username>_posts.json
uv run python - <<'EOF'
import json
d = json.load(open('/tmp/<username>_posts.json'))
for p in d.get('data', []):
    if 'keyword' in p['text'].lower():
        print(p['id'], p['created_at'], p['text'][:200])
EOF

# 3. Unknown author or topic? One search call, max results.
xurl search "keyword1 keyword2" -n 20 > /tmp/search1.json
# operators that work: from:user, #tag, quoted phrase in quotes, since:/until:
# (since/until still capped by the 7-day recent-search window)

# 4. Only the finalist gets a full read.
xurl read <post_id>
```

Gotchas seen in practice:

- Search results carry `author_id` but often no username. Resolve names from
  a cached timeline fetch (`author_id` to username map) or one
  `xurl user <username>` call, not per-result reads.
- Search payload text field can include `RT @user:` prefix for reposts; strip
  before matching.
- `xurl posts` lists newest first and includes reposts; a `-n 100` pull on
  @mistralai reached back 12 months.

## Posting

```bash
xurl post "Hello world!"                       # plain post
xurl post "Text" --media-id <id>               # with media (see below)
xurl reply <post_id> "Text"                    # reply
xurl quote <post_id> "Text"                    # native quote (see caveats)
xurl repost <post_id>                          # repost without comment
xurl delete <post_id>                          # remove your own post
```

The `post` response contains the new `id` and final `text` — that is usually
verification enough. `xurl read <id>` re-verifies but spends a read.

### Character limit: 280 weighted, not 280 bytes

- Every URL counts as **23 characters**, no matter its real length.
- Emoji and CJK count as **2 characters** each.
- ASCII counts as 1.

`wc -c` measures bytes and lies about emoji. Count the X way:

```bash
uv run python -c "import unicodedata as u
t='your text https://x.com/user/status/123'
n=0
import re
t2=re.sub(r'https?://\S+','x'*23,t)
for c in t2: n+=2 if ord(c)>0x2FFF else 1
print(n)"
```

Keep a 10-char buffer under 280.

### Shell quoting

Wrap text in **single quotes**. `$15` inside double quotes stays literal in
bash, but backticks and `$()` execute in double quotes. Apostrophes inside
text: end the single-quoted string, add `\'`, reopen (`'it'$'"'"'s'` style), or
use a heredoc.

### Media

```bash
xurl media upload photo.jpg          # prints media id
xurl post "caption" --media-id <id> # attach
xurl post "two" --media-id 111 --media-id 222
```

## Caveats

1. **Quote and reply can 403 on free/legacy apps.** Error: "You can only reply
   to or quote posts where you are mentioned or are the author." Workaround
   that renders almost identically: plain post with the status URL on its own
   line; X attaches the quote-preview card.

   ```bash
   xurl post 'My commentary on this post

   https://x.com/<user>/status/<post_id>'
   ```

   Difference: likes and reposts land only on your post, and it does not
   appear in the original's quote count.
2. **Posts are near-permanent.** `delete` exists; edits are not exposed by
   xurl post commands. Verify text before firing.
3. **Unverified third-party claims quoted in a post become your claims.**
   Pricing figures from viral replies are not official; prefer primary
   sources, or attribute them.
4. **Draft in chat, post once.** Show the user the final text and character
   count before posting anything they have not seen word-for-word.
5. **JSON only.** Output is always JSON; parse with `uv run python` or `jq`,
   never regex over raw output.
6. **Emoji in the 280 budget**: one sparkle emoji is 2 chars, not 1.

## Session-tested recipe

Find a post a user vaguely remembers, then quote it, in six API calls:

1. `xurl posts <candidate-account> -n 100 > /tmp/a.json` (1 call)
2. Local grep of `/tmp/a.json` for keywords (0 calls)
3. `xurl posts <second-account> -n 50 > /tmp/b.json` if first miss (1 call)
4. `xurl search "keywords" -n 20` when author unknown (1 call)
5. `xurl read <finalist_id>` for metrics and URL (1 call)
6. `xurl post "<comment>\n\n<status-url>"` (1 call, link-quote card)

Used against real data: located Mistral's GLM 5.3 Vibe Code announcement
(@mistralvibe status 2102056993531871446) from "Mistral posted about GLM 5.3
pricing", after ruling out @mistralai, @MistralDevs, and @zai_org timelines.
