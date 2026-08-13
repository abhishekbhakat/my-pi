---
name: youtrack
description: Dynamic access to youtrack MCP server (19 tools)
user-invocable: false
disable-model-invocation: false
---

# youtrack Skill

This skill provide dynamic access to youtrack MCP server without load all tool definitions into context.

## Authentication

Create `youtrack-auth.json` in this directory by copy `youtrack-auth.sample.json` and replace `YOUR_YOUTRACK_BEARER_TOKEN` with your YouTrack permanent token.

Alternative: set `YOUTRACK_MCP_TOKEN` environment variable.

## Available Tools

- `log_work`: Add work item (spent time) to specified issue. Specify duration (in minutes), optional date, work type, description, and optional work item attributes. Use get_project to retrieve workTypes and workItemAttributesSchema for target project.
- `manage_issue_tags`: Add tag to or remove tag from issue. If name is used, first tag that match provided name is added. If no matching tags are found, error message with suggestions for similar tags is returned. When successful, it return ID of updated issue and updated list of issue tags.
- `search_issues`: Search for issues using YouTrack query language. `query` can combine attribute filters, keywords, and free text. Examples of common patterns include:

- Free text: Find matching words in issue summary, description, and comments. Use wildcards: '*' for any characters, '?' for single characters (e.g., 'summary: log*', 'fix??'). Examples: 'login button bug', 'some other text', 'summary: log*', 'description: fix??'.
- Linked issues: '<linkType>: <issueId>' (by link type), 'links: <issueId>' (all linked to issueId issues). Examples: 'relates to: DEMO-123', 'subtask of: DEMO-123' (issues where DEMO-123 is parent), 'links: DEMO-12' (issues linked to DEMO-12 with any link type). Hint: get_issue return 'linkedIssueCounts' property which show available link types for issue.
- Issues where issue is mentioned: 'mentions: <issueId>'. Examples: 'mentions: DEMO-123'.
- Project filter: 'project: <ProjectName>'. Use project name or project key. Examples: 'project: {Mobile App}', 'project: MA'.
- Assignee filter: 'for: <login>'. Use 'me' for currently authenticated user. Examples: 'for: me', 'for: john.smith'.
- Reporter filter: 'reporter: <login>'. Use 'me' for currently authenticated user. Examples: 'reporter: me', 'reporter: admin'.
- Tag filter: 'tag: <TagName>'. Wrap multi-word tags in braces { }. Examples: 'tag: urgent', 'tag: {customer feedback}'.
- Field filter: '<FieldName>: <Value>'. For any project field, for example, State, Type, Priority, and so on. Wrap multi-word names or values in { }. Use get_project to get possible fields and values for project issues to search. Use '-' as 'not', e.g., 'State: -Fixed' filter out fixed issues. Examples: 'Priority: High', 'State: {In Progress}, Fixed' (search issues with 'In Progress' state + issues with 'Fixed' state), 'Due Date: {plus 5d}' (issues that are due in five days).
- Date filters: 'created:', 'updated:', 'resolved date:' (or any date field) plus date, range, or relative period. Relative periods: 'today', 'yesterday', '{This week}', '{Last week}', '{This month}', etc. Examples: 'created: {This month}', 'updated: today', 'resolved date: 2025-06-01 .. 2025-06-30', 'updated: {minus 2h} .. *' (issues updated last 2 hours), 'created: * .. {minus 1y 6M}' (issues that are at least one and a half years old).
- Keywords: '#Unresolved' to find unresolved issues based on State; '#Resolved' to find resolved issues.
- Empty/Non-Empty Fields: Use 'has: <attribute>'. Example: 'has: attachments' find issues with attachments, while 'has: -comments' find issues with no comments. Other attributes: 'links', '<linkType>' (e.g. 'has: {subtask of}'), 'star' (subscription), 'votes', 'work'.
- Combining filters: List multiple conditions separated by spaces (logical AND). For OR operator, add it explicit. Examples: '(project: MA) and (for: me) and (created: {minus 8h} .. *) and runtime error' (issues in project MA and assigned to currently authenticated user and created during last 8h and contain 'runtime error' text), '(Type: Task and State: Open) or (Type: Bug and Priority: Critical)'.

Return basic info: id, summary, project, resolved, reporter, created, updated and default custom fields. For full details, use get_issue. Response is paginated using specified offset and limit.
- `update_issue`: Update existing issue and its fields (customFields). Pass any of arguments to partially update issue:
- 'summary' or 'description' arguments to update only issue summary or description.
- 'customFields' argument as key-value JSON object to update issue fields like State, Type, Priority, etc. Use get_issue_fields_schema to discover 'customFields' and their possible values.
- 'subscription' argument to star (true) or unstar (false) issue on behalf of current user. Current user is notified about subsequent issue updates according to their subscription settings for Star tag.
- 'vote' argument to vote (true) or remove vote (false) on behalf of current user for issue.
Return ID of updated issue and confirmation what was updated.
- `get_project`: Retrieve full details for specific project.
- `get_saved_issue_searches`: Return saved searches marked as favorites by current user. Output search queries can be used in search_issues. Response is paginated using specified offset and/or limit.
- `get_user_group_members`: List users who are members of specified group or project team. Project teams are essentially groups that are always associated with specific project. Response is paginated using specified offset and/or limit.
- `link_issues`: Link two issues with specified link type.
  Examples:
  - TS-1 is subtask of TS-2: {"targetIssueId": "TS-1", "linkType": "subtask of", "issueToLinkId": "TS-2"};
  - TS-4 is duplicate of TS-3: {"targetIssueId": "TS-4", "linkType": "duplicates", "issueToLinkId": "TS-3"};
  - TS-1 is blocked by TS-2: {"targetIssueId": "TS-1", "linkType": "blocked by", "issueToLinkId": "TS-2"};
  Return updated link counts for all target issue link types.

- `get_current_user`: Return details about currently authenticated user (me): login, email, full name, time zone.
- `get_issue`: Return detailed information for issue or issue draft, including summary, description, URL, project, reporter (login), tags, votes, and custom fields. `customFields` output property provide more important issue details, including Type, State, Assignee, Priority, Subsystem, and so on. Use get_issue_fields_schema for full list of custom fields and their possible values.
- `get_issue_comments`: Return list of issue comments with detailed information for each. Response is paginated using specified offset and/or limit
- `get_issue_fields_schema`: Return JSON schema for custom fields in specified project. Must be used to provide relevant custom fields and values for create_issue and update_issue actions.
- `find_projects`: Find projects whose names contain specified substring (case-insensitive). Return minimal information (ID and name) to help pick project for get_project. Response is paginated using specified offset and/or limit.
- `find_user`: Find users by login or email (provide either login or email). Return profile data for matching user. This include login, full name, email, and local time zone.
- `find_user_groups`: Find user groups or project teams whose names contain specified substring (case-insensitive). Response is paginated using specified offset and/or limit.
- `add_issue_comment`: Add new comment to specified issue. Support Markdown.
- `change_issue_assignee`: Set value for Assignee field in issue to specified user. If `assigneeLogin` argument is `null`, issue will be unassigned.
- `create_draft_issue`: Create new issue draft in specified project. If project is not defined, ask for assistance. Draft issues are only visible to current user and can be edited using update_issue. Return ID assigned to issue draft and URL that open draft in web browser.
- `create_issue`: Create new issue in specified project. Call get_issue_fields_schema tool first to identify required `customFields` and permitted values (projects may require them at creation). If project is not defined, ask for assistance. Return created issue ID and URL. Use get_issue for full details.

## Usage Pattern

When user request match this skill capabilities:

**Step 1: Identify right tool** from list above

**Step 2: Generate tool call** in this JSON format:

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

IMPORTANT: Replace $SKILL_DIR with actual discovered path of this skill directory.

## Getting Tool Details

If you need detailed information about specific tool parameters:

```bash
cd $SKILL_DIR
./executor.py --describe tool_name
```

## Error Handling

If executor return error:
- Check tool name is correct
- Verify required arguments are provided
- Ensure MCP server is accessible

---

*Auto-generated from MCP server configuration by mcp_to_skill.py*
