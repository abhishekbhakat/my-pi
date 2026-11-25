---
name: browser-use
description: Drive local Lightpanda with open-source Browser Use CLI via CDP. Use for web interaction, DOM extraction, and form testing. No Chrome or cloud fallback.
---

# Browser Use

Install CLI if missing: `uv tool install 'browser-use==1.0.8'`. See [upstream CLI skill](https://github.com/browser-use/browser-use/blob/94784c1f7ecb6b0a5f565b7f9fba59e395b7e048/skills/browser-use/SKILL.md) for helpers and diagnostics.

## Local Lightpanda only

1. Start `lightpanda serve --host 127.0.0.1 --port 19222` in managed job. Verify that job is listening before connecting.
2. Pass `BU_CDP_URL=http://127.0.0.1:19222` on every browser CLI call. Unset `BU_CDP_WS` and use unique `BU_NAME` per task so stale settings or daemons cannot redirect connection.
3. If Lightpanda fails or lacks required feature, stop and report limit. Never fall back to Chrome, Chromium, Browser Use Cloud, Lightpanda Cloud, or another remote browser. Ignore upstream cloud and Chrome instructions.

For Python SDK, pass `Browser(cdp_url='http://127.0.0.1:19222')` explicitly. Never use bare `Browser()` or omit browser when creating an `Agent`. Supply an explicit local model for agent runs; do not use default Browser Use model gateway.

## Lightpanda smoke test

```bash
env -u BU_CDP_WS BU_CDP_URL=http://127.0.0.1:19222 BU_NAME="lightpanda-smoke-$$" BH_TAB_MARKER=0 browser-use <<'PY'
new_tab('data:text/html,<title>Lightpanda smoke test</title><h1>CDP works</h1>')
print(page_info())
PY
```

Verified tab creation, navigation, and title retrieval with CLI 1.0.8. Screenshot and full agent compatibility unverified. Stop managed Lightpanda job when done.
