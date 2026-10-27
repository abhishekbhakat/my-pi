---
name: atlassian
description: >-
  Access Atlassian Jira and Confluence through the official Atlassian MCP
  server. Use when the user asks to find, read, create, or update Jira issues,
  Confluence pages, or other Atlassian content available to their account.
---

# Atlassian

Endpoint: `https://mcp.atlassian.com/v2/mcp`. Transport: OAuth through the
pinned `mcp-remote` stdio proxy in `mcp-config.json` beside this file. The
config holds no tokens.

## Authorize

On first use, expired access, or an authorization error, the agent runs this
command. Do not ask the user to run it:

```bash
npx -y -p mcp-remote@0.15.2 mcp-remote-client https://mcp.atlassian.com/v2/mcp --transport http-only --auth-timeout 300
```

The browser opens. Tell the user to approve access there. Do not print the
authorization URL, codes, or tokens. An organization admin may need to enable
the Atlassian MCP server. The proxy owns its OAuth cache under `~/.mcp-auth`;
do not read, print, or delete it.

## Jira and Confluence CLIs

Both commands use the same OAuth connection. First get the site `cloudId`, then
list live tools and inspect a schema before calling it:

```bash
JIRA="$HOME/.pi/agent/bin/jira"
CONFLUENCE="$HOME/.pi/agent/bin/confluence"
"$JIRA" sites
"$JIRA" tools
"$CONFLUENCE" tools
"$JIRA" describe searchJiraIssuesUsingJql
"$CONFLUENCE" describe searchConfluence
```

`get` and `search` are aliases for documented primary tools. Pass the JSON
arguments required by the live schema, including `cloudId`. Use `--args-file`
for large or sensitive arguments instead of exposing them in process arguments.
`tools --all` shows tools for both products. `describe` and `call` never filter.

```bash
"$JIRA" search --args '<json-object>'
"$CONFLUENCE" get --args-file /path/to/arguments.json
"$JIRA" discover --args '<json-object>'
"$JIRA" call executeRead --args-file /path/to/arguments.json
```

Some operations are deferred. Use `discover`, inspect the returned operation
schema, then call `executeRead`, `executeWrite`, or `executeDestructive`.
`call` requires `--write` for write or unknown tools and `--destructive` for
destructive tools. These flags do not replace user approval.

The server determines tools, sites, and permissions. Do not invent a tool or
assume access. Never call a write or destructive tool unless the user requested
the action. Tool results may contain private workspace data; share only what the
user asked for. On authorization failure, run the command in Authorize again.
The CLI suppresses proxy stderr, so that command also shows proxy errors.
