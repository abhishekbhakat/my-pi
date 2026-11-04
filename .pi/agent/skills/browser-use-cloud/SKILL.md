---
name: browser-use-cloud
description: >-
  Managed cloud browsers and hosted web agents through Browser Use Cloud (API
  v4). Use for stealth browsing with residential proxies, driving a remote
  Chrome over CDP from Playwright or Puppeteer, running a natural-language web
  task on a hosted agent, persistent login profiles, CAPTCHA-solving pages,
  live preview or recording, or when the user says browser-use, Browser Use
  Cloud, cloud browser, remote Chrome, CDP browser, hosted browser agent, or
  "browse this site for me" where a local browser is blocked or missing.
  Covers SDK setup, the run lifecycle, browser session start and the mandatory
  stop call, sessions, workspaces, profiles, secrets, and billing traps.
keywords:
  [
    browser-use,
    browser use cloud,
    cloud browser,
    remote chrome,
    cdp,
    playwright,
    puppeteer,
    stealth,
    residential proxy,
    captcha,
    hosted agent,
    browser automation,
    profiles,
    workspaces,
    recording,
  ]
homepage: https://docs.browser-use.com
---

# Browser Use Cloud

Cloud-hosted Chromium with stealth, residential proxies, CAPTCHA solving,
persistent profiles, live preview, and recording. Two products on one
infrastructure.

| Product | What it does | Entry point |
| --- | --- | --- |
| Agent | Give a goal in natural language; it drives the browser and returns a result | `POST /api/v4/runs` |
| Browser | Real cloud Chrome you drive yourself over CDP | `POST /api/v4/browsers`, then `cdpUrl` |

Docs are the source of truth. Never guess an endpoint, model string, or SDK
signature; fetch the page.

- Index: <https://docs.browser-use.com/llms.txt>
- Everything inlined: <https://docs.browser-use.com/.well-known/llms-full.txt>
- API v4 spec: <https://docs.browser-use.com/cloud/openapi/v4.json>

## Hard rules

1. Never hard-code, print, log, or commit the API key. Keys start with `bu_`
   and travel in `X-Browser-Use-API-Key`, with no `Bearer` prefix.
2. `client.close()`, `browser.close()`, and dropping CDP do not stop a browser.
   Billing continues. Always stop: `client.browsers.stop(id)` or
   `PATCH /api/v4/browsers/{id}` with `{"action":"stop"}`.
3. Use API v4 for new work. Reach for v2 only when cost beats correctness.
   The open-source `browser-use` Python library is a different API; do not mix
   its signatures or docs with the Cloud SDK.
4. A client wait timeout does not cancel the server-side run. Reconcile before
   starting duplicate work.
5. Model strings can reach REST before the TypeScript union. If a valid model is
   rejected by generated types, call `POST /api/v4/runs` directly.
6. Cap spend: pass `maxCostUsd` on runs and `timeout` (minutes, max 240) on
   browsers unless the user asked for a long session.

## Setup

Use the SDK, not hand-rolled HTTP.

```bash
pip install --upgrade browser-use-sdk     # Python
npm install browser-use-sdk@latest        # TypeScript
```

Check first whether it is installed, then upgrade.

Credential lives in `browser-use-auth.json` beside this file (gitignored,
install-copies it):

```json
{ "api_key": "bu_..." }
```

The SDKs read `BROWSER_USE_API_KEY` only. Export it from the JSON before any
call. Never echo the key:

```bash
export BROWSER_USE_API_KEY=$(node -e 'process.stdout.write(require("/absolute/path/to/skills/browser-use-cloud/browser-use-auth.json").api_key)')
```

Bash and zsh: `VAR=x && cmd` does not export to the child. Either use the
`$(...)` assignment above, or export once per shell.

No key yet: user creates one in one click at
<https://cloud.browser-use.com/settings?tab=api-keys&new=1>. Do not invent a
key or scrape one from another tool's config. If the JSON is missing, ask once;
no blind retry.

Python imports v4 explicitly: `from browser_use_sdk.v4 import BrowserUse`.
TypeScript: `import { BrowserUse } from "browser-use-sdk/v4";`.

## Agent path

```python
from browser_use_sdk.v4 import BrowserUse

with BrowserUse() as client:
    run = client.runs.create(
        "Find the top Hacker News story",
        max_cost_usd=0.5,
    )
    result = client.runs.wait_for_completion(run.id)
    print(result.result)
```

```typescript
import { BrowserUse } from "browser-use-sdk/v4";

const client = new BrowserUse();
const run = await client.runs.create({
  task: "Find the top Hacker News story",
  maxCostUsd: 0.5,
});
const result = await client.runs.waitForCompletion(run.id);
console.log(result.result);
```

Omit `model` and `modelParams` for the default: `gpt-6-luna` with
`reasoning.effort: high`. Pass `"modelParams": {}` to opt out of that reasoning
default.

Speed-first: `model: "bu-ultrafast"` (`bu-fast` reasons more per step). Both
presets reject `modelParams`.

Structured result: pass `outputSchema` (JSON Schema). The parsed value lands in
`output`; `result` stays the text answer.

Cheap REST loop when no SDK is wanted:

```bash
curl -sS https://api.browser-use.com/api/v4/runs \
  -H "X-Browser-Use-API-Key: $BROWSER_USE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"task":"Find the top Hacker News story","maxCostUsd":0.5}'

curl -sS "https://api.browser-use.com/api/v4/runs/$RUN_ID/status" \
  -H "X-Browser-Use-API-Key: $BROWSER_USE_API_KEY"

curl -sS "https://api.browser-use.com/api/v4/runs/$RUN_ID" \
  -H "X-Browser-Use-API-Key: $BROWSER_USE_API_KEY"
```

Poll `/status` (tiny, cheap) until `completed`, `failed`, or `cancelled`, then
fetch the full run once. Terminal statuses are final.

## Browser path

```python
from browser_use_sdk.v4 import BrowserUse
from playwright.sync_api import sync_playwright

with BrowserUse() as client:
    session = client.browsers.create(proxy_country_code="us", timeout=15)
    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(session.cdp_url)
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.goto("https://example.com")
            print(page.title())
    finally:
        client.browsers.stop(session.id)
```

Use the existing context (`contexts[0]`). It carries the profile cookies and
managed settings. No local browser download is needed.

Puppeteer: `puppeteer.connect({ browserWSEndpoint: session.cdpUrl })`, use
`defaultBrowserContext()`, call `disconnect()` when done, then stop through the
API. Selenium cannot attach to a remote WebSocket CDP URL.

Standalone browser request fields: `profileId`, `proxyCountryCode` (default
`us`, `null` disables), `metadata` (up to 10 labels), `timeout` (minutes,
default 60, max 240), `browserScreenWidth`/`browserScreenHeight`,
`allowResizing`, `pdfRendererEnabled`, `solveCaptchas` (default true),
`customProxy`, `enableRecording` (default false), `extensionIds` (up to 3).
Response carries `id`, `cdpUrl`, `liveUrl`.

Stop with `PATCH /api/v4/browsers/{id}` and `{"action":"stop"}`. `stop` is the
only action. Find browsers again with `GET /api/v4/browsers?metadata=key=value`
or `?agentSessionId=<id>`; list is truncated to 50 rows by default, so always
filter.

## Sessions, files, and state

- Session: conversation history. `runs.create(..., sessionId=<id>)` continues
  one. A browser stays up about 120s after the last run (`keepAlive`, 120 to
  14400 seconds) so a follow-up reuses the page; then a fresh browser appears
  with the same settings and profile but no tabs.
- Workspace: files. Created implicitly per run, or minted empty with
  `POST /api/v4/workspaces` so uploads exist before the first run. Serialize
  runs that write the same files.
- Profile: cookies and browser state. Reused across runs and browsers.
- These IDs are not interchangeable, and v3/v4 workspace namespaces differ.

Busy session returns `409`. Queue the next instruction instead of retrying:
`POST /api/v4/sessions/{id}/queue` with `{"text": "...", "interrupt": false}`
returns a queued message; poll that message for its `runId`. The queue holds 20
pending messages.

## Reasoning parameters

`modelParams` takes provider-native fields and forwards them unchanged.
Unsupported paths return `422`.

| Models | Path | Values |
| --- | --- | --- |
| `gpt-6-luna`, `gpt-6-sol` | `reasoning.effort` | none, low, medium, high, xhigh, max |
| `gpt-6-astra`, `gpt-6.1-sol` | `reasoning.effort` | low, medium, high, xhigh, max |
| `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5` | `output_config.effort` | low, medium, high, xhigh, max |
| `gemini-3-flash`, `gemini-3.5-flash`, `gemini-3.6-flash` | `thinkingConfig.thinkingLevel` | minimal, low, medium, high |
| `gemini-3.1-pro` | `thinkingConfig.thinkingLevel` | low, medium, high |
| `deepseek-v4.1-flash` | `reasoning_effort` | low, high, max |

`glm-5.2`, `glm-5.3-flash`, `grok-4.5`, `grok-4.6`, `kimi-k3`, `minimax-m3`,
`deepseek-v4-flash-vision`, `claude-fable-5`, and both `bu-` presets accept no
`modelParams`. Free-plan projects are limited to `gpt-6-luna`, `gpt-5.6-luna`,
`deepseek-v4.1-flash`, `gemini-3-flash`, `minimax-m3`, `bu-ultrafast`,
`bu-fast`; other models return `403`.

## Watching a run

`GET /api/v4/runs/{id}/events?after=<cursor>` pages ordered events. Pass the
highest `id` seen as `after`, drain while `hasMore` is true. The
`browser.ready` event's `data.live_view_url` is the live iframe URL; add
`?readOnly=true&ui=false` to embed it watch-only. Recording must be requested at
creation, finalizes asynchronously after the browser stops, and never exists on
Zero Data Retention projects.

## Limits and cost

Credits are pay-as-you-go. Concurrency is per project, from 10 free browsers up
to 1000 by spend tier; the account endpoint
`GET /api/v2/billing/account` reports `projectId`,
`concurrentSessionLimit`, `activeSessionCount`, and the balance. Rate limits are
separate from concurrency; honor `Retry-After` and `retry_after_seconds`, and
use bounded workers with staggered polls. Browser time is $0.02/hour plus
network traffic.

## Verify a setup claim

A green SDK import proves nothing. Prove the key and account with one cheap
authenticated read, quoting one number:

```bash
curl -sS https://api.browser-use.com/api/v2/billing/account \
  -H "X-Browser-Use-API-Key: $BROWSER_USE_API_KEY"
```

Then run one short browser session or one small agent run and report its status
plus the stop call result. If the account read fails, report the HTTP status and
message; do not retry blind and do not add credits on the user's behalf.

## References

- [Agent quickstart](https://docs.browser-use.com/cloud/agent/quickstart.md)
- [Models](https://docs.browser-use.com/cloud/agent/models.md)
- [Thinking levels](https://docs.browser-use.com/cloud/agent/thinking-levels.md)
- [Browser quickstart](https://docs.browser-use.com/cloud/browser/quickstart.md)
- [Playwright, Puppeteer, Selenium](https://docs.browser-use.com/cloud/browser/playwright-puppeteer-selenium.md)
- [Sessions](https://docs.browser-use.com/cloud/agent/sessions.md)
- [Troubleshooting](https://docs.browser-use.com/cloud/guides/troubleshooting.md)
- [Concurrency](https://docs.browser-use.com/cloud/guides/concurrency.md)
