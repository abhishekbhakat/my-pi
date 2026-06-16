---
name: slack
description: Dynamic access to the Slack MCP server
user-invocable: false
disable-model-invocation: false
---

# slack Skill

This skill provides dynamic access to the Slack MCP server without loading all tool definitions into context.

## Authentication

Slack MCP requires a **user access token** (`xoxp-...`) with the workspace API scopes listed in `mcp-config.json`. A bot token (`xoxb-...`) is not used.

Authentication methods (in precedence order):

1. **`slack-auth.json`** in this directory (copy from `slack-auth.sample.json` and fill in `client_id` and `access_token`).
2. **Environment variable**: `SLACK_MCP_TOKEN`.
3. **PKCE OAuth helper**: run `./slack_auth.py` to authenticate through a browser. It writes the token back into `slack-auth.json`.

The signing secret and verification token from your Slack app are for the Events API and are **not needed** here.

## Available Tools

Run these for live schemas after authenticating:

```bash
cd $SKILL_DIR
./executor.py --list
./executor.py --describe <tool_name>
```

| Tool                              | Purpose                                                                            |
|-----------------------------------|------------------------------------------------------------------------------------|
| `slack_send_message`              | Send a message to a channel or user (use user_id as channel_id for DMs).           |
| `slack_schedule_message`          | Schedule a message for future delivery.                                            |
| `slack_send_message_draft`        | Create a draft message without sending.                                            |
| `slack_add_reaction`              | Add an emoji reaction to a message.                                                |
| `slack_get_reactions`             | Get reactions on a message.                                                        |
| `slack_search_emojis`             | Search custom workspace emojis by name.                                            |
| `slack_create_conversation`       | Create a channel, DM, or group DM.                                                 |
| `slack_search_channels`           | Find channels by name or description.                                              |
| `slack_search_users`              | Find users by name, email, or profile attributes.                                  |
| `slack_read_user_profile`         | Get detailed profile info for a user (defaults to current user).                   |
| `slack_list_channel_members`      | List members of a channel/group (not DMs).                                         |
| `slack_read_channel`              | Read recent messages from a channel or DM.                                         |
| `slack_read_thread`               | Read a thread by parent message timestamp.                                         |
| `slack_search_public`             | Search messages and files in public channels.                                      |
| `slack_search_public_and_private` | Search all channels, DMs, and group DMs (ask user consent first).                  |
| `slack_read_file`                 | Read a file's content by file ID.                                                  |
| `slack_create_canvas`             | Create a new Slack canvas.                                                         |
| `slack_read_canvas`               | Read/export a canvas as markdown.                                                  |
| `slack_update_canvas`             | Append, prepend, or replace canvas content (use section IDs to avoid overwriting). |

## Usage Pattern

**Step 1:** Identify the tool. For unknown parameters, run:

```bash
./executor.py --describe <tool_name>
```

**Step 2:** Build the call JSON:

```json
{
  "tool": "slack_send_message",
  "arguments": {
    "channel_id": "C1234567890",
    "text": "Hello from the agent"
  }
}
```

**Step 3:** Execute it:

```bash
./executor.py --call '{"tool": "slack_send_message", "arguments": {"channel_id": "C1234567890", "text": "Hello from the agent"}}'
```

Replace `$SKILL_DIR` with the actual path to this skill directory.

## Slack Message Formatting

Use Slack mrkdwn syntax in messages and drafts:

| Format        | Syntax           |                      |
|---------------|------------------|----------------------|
| Bold          | `*text*`         |                      |
| Italic        | `_text_`         |                      |
| Strikethrough | `~text~`         |                      |
| Inline code   | `` `code` ``     |                      |
| Code block    | `` ```code``` `` |                      |
| Quote         | `> text`         |                      |
| Link          | `<url\           | display>` or `<url>` |
| Bulleted list | `- item`         |                      |
| Numbered list | `1. item`        |                      |

Tables, markdown headers (`#`), and image embeds (`![alt](url)`) are **not supported** in messages.

**Tips:** lead with the point, keep messages short, use line breaks, reply in threads when appropriate, and use `slack_send_message_draft` for long or sensitive messages.

## Slack Search Modifiers

Use these with `slack_search_public` and `slack_search_public_and_private`:

| Modifier                                                                 | Meaning                           |
|--------------------------------------------------------------------------|-----------------------------------|
| `in:channel-name` / `in:#C123456`                                        | Limit to a channel                |
| `-in:channel-name`                                                       | Exclude a channel                 |
| `in:<@U123456>` / `in:@username`                                         | Limit to DMs with a user          |
| `from:<@U123456>` / `from:username`                                      | Messages from a user              |
| `to:<@U123456>` / `to:me`                                                | Messages to a user                |
| `is:thread`                                                              | Threaded messages only            |
| `has:pin`, `has:link`, `has:file`                                        | Content filters                   |
| `has::emoji:` / `hasmy::emoji:`                                          | Reaction filters                  |
| `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `on:YYYY-MM-DD`, `during:month` | Date filters                      |
| `"exact phrase"`                                                         | Exact phrase match                |
| `-word`                                                                  | Exclude a word                    |
| `wild*`                                                                  | Wildcard (min 3 chars before `*`) |

For files, add `content_types="files"` and `type:` filters (`images`, `documents`, `pdfs`, `spreadsheets`, `presentations`, `canvases`, `lists`, `emails`, `audio`, `videos`).

**Common pitfalls:** boolean operators (`AND`, `OR`, `NOT`) and parentheses are not supported. Search is not real-time; use `slack_read_channel` for the newest messages.

## Error Handling

If the executor returns an error:

- Verify the token is a **user token** (`xoxp-...`) and has the required workspace API scopes.
- Check tool name and required arguments with `--describe`.
- Confirm the app is enabled for Slack MCP access under **App Assistant / MCP** in Slack app settings.
- Watch Slack rate limits and retry after the `Retry-After` interval.
