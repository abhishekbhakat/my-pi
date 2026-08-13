---
name: zoho-mcp
description: Dynamic access to Zoho Books MCP server (9 tools)
user-invocable: false
disable-model-invocation: false
---

# zoho-mcp Skill

This skill provide dynamic access to Zoho Books MCP server without load all tool definitions into context.

## Authentication

Create `zoho-auth.json` in this directory by copy `zoho-auth.sample.json` and replace `YOUR_ZOHO_MCP_URL` with your Zoho MCP server URL (URL contain connection token).

Alternative: set `ZOHO_MCP_URL` environment variable.

First connection require one-time Zoho OAuth login:

```bash
npx mcp-remote "$ZOHO_MCP_URL" --transport http-only
```

Open printed URL, sign in to Zoho, and token is cached in `~/.mcp-auth/` and refreshed automatically on subsequent calls.

## Available Tools

- `ZohoBooks_list_customer_payments`: List all payments made by your customer.
- `ZohoBooks_create_invoice`: Create invoice for your customer.
- `ZohoBooks_list_contacts`: Retrieve comprehensive list of all contacts with advanced filters. This operation support multiple search criteria including contact name, company name, address, email, phone, and general text search. Filter contacts by status (active, inactive, duplicate, CRM) and sort by various fields. Response include essential contact information, financial data including outstanding amounts and credit limits, and pagination details for efficient data retrieval.
- `ZohoBooks_create_contact`: Create new contact with comprehensive business information. This operation allow you to create customer or vendor by provide details such as contact name, company information, addresses, contact persons, payment terms, tax settings, and custom fields. Created contact can be used for generate invoices, bills, estimates, and other business transactions. System automatically assign unique contact ID.
- `ZohoBooks_list_vendor_payments`: List all payments made to your vendor.
- `ZohoBooks_list_items`: Get list of all active items with pagination.
- `ZohoBooks_list_sales_orders`: List all sales orders.
- `ZohoBooks_get_estimate`: Get details of estimate.
- `ZohoBooks_list_organizations`: Get list of organizations.

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
