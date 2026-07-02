---
name: youtrack
description: Dynamic access to youtrack MCP server (19 tools)
user-invocable: false
disable-model-invocation: false
---

# youtrack Skill

This skill provides dynamic access to the youtrack MCP server without loading all tool definitions into context.

## Authentication

Create `youtrack-auth.json` in this directory by copying `youtrack-auth.sample.json` and replacing `YOUR_YOUTRACK_BEARER_TOKEN` with your YouTrack permanent token.

Alternatively, set the `YOUTRACK_MCP_TOKEN` environment variable.

## Available Tools

- `log_work`: Adds a work item (spent time) to the specified issue. You can specify the duration (in minutes), optional date, work type, description, and optional work item attributes. Use get_project to retrieve the workTypes and workItemAttributesSchema for the target project.
- `manage_issue_tags`: Adds a tag to or removes a tag from an issue. If a name is used, the first tag that matches the provided name is added. If no matching tags are found, an error message with suggestions for similar tags is returned. When successful, it returns the ID of the updated issue and the updated list of issue tags.
- `search_issues`: Searches for issues using YouTrack’s query language. The 'query' can combine attribute filters, keywords, and free text. Examples of common patterns include:

- Free text: Find matching words in the issue summary, description, and comments. Use wildcards: '*' for any characters, '?' for single characters (e.g., 'summary: log*', 'fix??'). Examples: 'login button bug', 'some other text', 'summary: log*', 'description: fix??'.
- Linked issues: '<linkType>: <issueId>' (by link type), 'links: <issueId>' (all linked to issueId issues). Examples: 'relates to: DEMO-123', 'subtask of: DEMO-123' (issues where DEMO-123 is a parent), 'links: DEMO-12' (issues linked to DEMO-12 with any link type). Hint: get_issue returns 'linkedIssueCounts' property which shows the available link types for the issue.
- Issues where an issue is mentioned: 'mentions: <issueId>'. Examples: 'mentions: DEMO-123'.
- Project filter: 'project: <ProjectName>'. Use project name or project key. Examples: 'project: {Mobile App}', 'project: MA'.
- Assignee filter: 'for: <login>'. Use 'me' for the currently authenticated user. Examples: 'for: me', 'for: john.smith'.
- Reporter filter: 'reporter: <login>'. Use 'me' for the currently authenticated user. Examples: 'reporter: me', 'reporter: admin'.
- Tag filter: 'tag: <TagName>'. Wrap multi-word tags in braces { }. Examples: 'tag: urgent', 'tag: {customer feedback}'.
- Field filter: '<FieldName>: <Value>'. For any project field, for example, State, Type, Priority, and so on. Wrap multi-word names or values in { }. Use get_project to get the possible fields and values for the project issues to search. Use '-' as 'not', e.g., 'State: -Fixed' filters out fixed issues. Examples: 'Priority: High', 'State: {In Progress}, Fixed' (searches issues with 'In Progress' state + issues with 'Fixed' state), 'Due Date: {plus 5d}' (issues that are due in five days).
- Date filters: 'created:', 'updated:', 'resolved date:' (or any date field) plus a date, range, or relative period. Relative periods: 'today', 'yesterday', '{This week}', '{Last week}', '{This month}', etc. Examples: 'created: {This month}', 'updated: today', 'resolved date: 2025-06-01 .. 2025-06-30', 'updated: {minus 2h} .. *' (issues updated last 2 hours), 'created: * .. {minus 1y 6M}' (issues that are at least one and a half years old).
- Keywords: '#Unresolved' to find unresolved issues based on the State; '#Resolved' to find resolved issues.
- Empty/Non-Empty Fields: Use the 'has: <attribute>'. Example: 'has: attachments' finds issues with attachments, while 'has: -comments' finds issues with no comments. Other attributes: 'links', '<linkType>' (e.g. 'has: {subtask of}'), 'star' (subscription), 'votes', 'work'.
- Combining filters: List multiple conditions separated by spaces (logical AND). For OR operator, add it explicitly. Examples: '(project: MA) and (for: me) and (created: {minus 8h} .. *) and runtime error' (issues in project MA and assigned to currently authenticated user and created during last 8h and contains 'runtime error' text), '(Type: Task and State: Open) or (Type: Bug and Priority: Critical)'.

Returns basic info: id, summary, project, resolved, reporter, created, updated and default custom fields. For full details, use get_issue. The response is paginated using the specified offset and limit.
- `update_issue`: Updates an existing issue and its fields (customFields). Pass any of the arguments to partially update the issue:
- 'summary' or 'description' arguments to update only the issue summary or description.
- 'customFields' argument as key-value JSON object to update issue fields like State, Type, Priority, etc. Use get_issue_fields_schema to discover 'customFields' and their possible values.
- 'subscription' argument to star (true) or unstar (false) the issue on behalf of the current user. The current user is notified about subsequent issue updates according to their subscription settings for the Star tag.
- 'vote' argument to vote (true) or remove a vote (false) on behalf of the current user for the issue.
Returns the ID of the updated issue and the confirmation what was updated.
- `get_project`: Retrieves full details for a specific project.
- `get_saved_issue_searches`: Returns saved searches marked as favorites by the current user. The output search queries can be used in search_issues. The response is paginated using the specified offset and/or limit.
- `get_user_group_members`: Lists users who are members of a specified group or project team. Project teams are essentially groups that are always associated with a specific project. The response is paginated using the specified offset and/or limit.
- `link_issues`: Links two issues with the specified link type.
  Examples:
  - TS-1 is a subtask of TS-2: {"targetIssueId": "TS-1", "linkType": "subtask of", "issueToLinkId": "TS-2"};
  - TS-4 is a duplicate of TS-3: {"targetIssueId": "TS-4", "linkType": "duplicates", "issueToLinkId": "TS-3"};
  - TS-1 is blocked by TS-2: {"targetIssueId": "TS-1", "linkType": "blocked by", "issueToLinkId": "TS-2"};
  Returns updated link counts for all target issue link types.
  
- `get_current_user`: Returns details about the currently authenticated user (me): login, email, full name, time zone.
- `get_issue`: Returns detailed information for an issue or issue draft, including the summary, description, URL, project, reporter (login), tags, votes, and custom fields. The `customFields` output property provides more important issue details, including Type, State, Assignee, Priority, Subsystem, and so on. Use get_issue_fields_schema for the full list of custom fields and their possible values.
- `get_issue_comments`: Returns a list of issue comments with detailed information for each. The response is paginated using the specified offset and/or limit
- `get_issue_fields_schema`: Returns the JSON schema for custom fields in the specified project. Must be used to provide relevant custom fields and values for create_issue and update_issue actions.
- `find_projects`: Finds projects whose names contain the specified substring (case-insensitive). Returns minimal information (ID and name) to help pick a project for get_project. The response is paginated using the specified offset and/or limit.
- `find_user`: Finds users by login or email (provide either login or email). Returns profile data for the matching user. This includes the login, full name, email, and local time zone.
- `find_user_groups`: Finds user groups or project teams whose names contain the specified substring (case-insensitive). The response is paginated using the specified offset and/or limit.
- `add_issue_comment`: Adds a new comment to the specified issue. Supports Markdown.
- `change_issue_assignee`: Sets the value for the Assignee field in an issue to the specified user. If the `assigneeLogin` argument is `null`, the issue will be unassigned.
- `create_draft_issue`: Creates a new issue draft in the specified project. If project is not defined, ask for assistance. Draft issues are only visible to the current user and can be edited using update_issue. Returns the ID assigned to the issue draft and a URL that opens the draft in a web browser.
- `create_issue`: Creates a new issue in the specified project. Call the get_issue_fields_schema tool first to identify required `customFields` and permitted values (projects may require them at creation). If project is not defined, ask for assistance. Returns the created issue ID and URL. Use get_issue for full details.

## Usage Pattern

When the user's request matches this skill's capabilities:

**Step 1: Identify the right tool** from the list above

**Step 2: Generate a tool call** in this JSON format:

```json
{
  "tool": "tool_name",
  "arguments": {
    "param1": "value1"
  }
}
```

**Step 3: Execute via bash:**

```bash
cd $SKILL_DIR
./executor.py --call 'YOUR_JSON_HERE'
```

IMPORTANT: Replace $SKILL_DIR with the actual discovered path of this skill directory.

## Getting Tool Details

If you need detailed information about a specific tool's parameters:

```bash
cd $SKILL_DIR
./executor.py --describe tool_name
```

## Error Handling

If the executor returns an error:
- Check the tool name is correct
- Verify required arguments are provided
- Ensure the MCP server is accessible

---

*Auto-generated from MCP server configuration by mcp_to_skill.py*
