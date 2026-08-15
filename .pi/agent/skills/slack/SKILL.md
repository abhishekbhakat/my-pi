---
name: slack
description: Dynamic access to Slack MCP server
user-invocable: false
disable-model-invocation: false
---

# slack Skill

This skill provide dynamic access to Slack MCP server without load all tool definitions into context.

## Authentication

Slack MCP require **user access token** (`xoxp-...`) with workspace API scopes listed in `mcp-config.json`. Bot token (`xoxb-...`) is not used.

Authentication methods (in precedence order):

1. **`slack-auth.json`** in this directory (copy from `slack-auth.sample.json` and fill in `client_id` and `access_token`).
2. **Environment variable**: `SLACK_MCP_TOKEN`.
3. **PKCE OAuth helper**: run `./slack_auth.py` to authenticate through browser. It write token back into `slack-auth.json`.

Signing secret and verification token from your Slack app are for Events API and are **not needed** here.

## Available Tools

Run these for live schemas after authenticate:

```bash
cd $SKILL_DIR
./executor.py --list
./executor.py --describe <tool_name>
```

| Tool                              | Purpose                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `slack_send_message`              | Send message to channel or user (use user_id as channel_id for DMs).               |
| `slack_schedule_message`          | Schedule message for future delivery.                                              |
| `slack_send_message_draft`        | Create draft message without sending.                                              |
| `slack_add_reaction`              | Add emoji reaction to message.                                                     |
| `slack_get_reactions`             | Get reactions on message.                                                          |
| `slack_search_emojis`             | Search custom workspace emojis by name.                                            |
| `slack_create_conversation`       | Create channel, DM, or group DM.                                                   |
| `slack_search_channels`           | Find channels by name or description.                                              |
| `slack_search_users`              | Find users by name, email, or profile attributes.                                  |
| `slack_read_user_profile`         | Get detailed profile info for user (defaults to current user).                     |
| `slack_list_channel_members`      | List members of channel/group (not DMs).                                           |
| `slack_read_channel`              | Read recent messages from channel or DM.                                           |
| `slack_read_thread`               | Read thread by parent message timestamp.                                           |
| `slack_search_public`             | Search messages and files in public channels.                                      |
| `slack_search_public_and_private` | Search all channels, DMs, and group DMs (ask user consent first).                  |
| `slack_read_file`                 | Read file content by file ID.                                                      |
| `slack_create_canvas`             | Create new Slack canvas.                                                           |
| `slack_read_canvas`               | Read/export canvas as markdown.                                                    |
| `slack_update_canvas`             | Append, prepend, or replace canvas content (use section IDs to avoid overwrite).   |

## Usage Pattern

**Step 1:** Identify tool. For unknown parameters, run:

```bash
./executor.py --describe <tool_name>
```

**Step 2:** Build call JSON:

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

Replace `$SKILL_DIR` with actual path to this skill directory.

## Slack Message Formatting

Use Slack mrkdwn syntax in messages and drafts:

| Format        | Syntax           |                      |
| ------------- | ---------------- | -------------------- |
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

**Tips:** lead with point, keep messages short, use line breaks, reply in threads when appropriate, and use `slack_send_message_draft` for long or sensitive messages.

## Slack Search Modifiers

Use these with `slack_search_public` and `slack_search_public_and_private`:

| Modifier                                                                 | Meaning                           |
| ------------------------------------------------------------------------ | --------------------------------- |
| `in:channel-name` / `in:#C123456`                                        | Limit to channel                  |
| `-in:channel-name`                                                       | Exclude channel                   |
| `in:<@U123456>` / `in:@username`                                         | Limit to DMs with user            |
| `from:<@U123456>` / `from:username`                                      | Messages from user                |
| `to:<@U123456>` / `to:me`                                                | Messages to user                  |
| `is:thread`                                                              | Threaded messages only            |
| `has:pin`, `has:link`, `has:file`                                        | Content filters                   |
| `has::emoji:` / `hasmy::emoji:`                                          | Reaction filters                  |
| `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `on:YYYY-MM-DD`, `during:month` | Date filters                      |
| `"exact phrase"`                                                         | Exact phrase match                |
| `-word`                                                                  | Exclude word                      |
| `wild*`                                                                  | Wildcard (min 3 chars before `*`) |

For files, add `content_types="files"` and `type:` filters (`images`, `documents`, `pdfs`, `spreadsheets`, `presentations`, `canvases`, `lists`, `emails`, `audio`, `videos`).

**Common pitfalls:** boolean operators (`AND`, `OR`, `NOT`) and parentheses are not supported. Search is not real-time; use `slack_read_channel` for newest messages.

## Error Handling

If executor return error:

- Verify token is **user token** (`xoxp-...`) and have required workspace API scopes.
- Check tool name and required arguments with `--describe`.
- Confirm app is enabled for Slack MCP access under **App Assistant / MCP** in Slack app settings.
- Watch Slack rate limits and retry after `Retry-After` interval.
