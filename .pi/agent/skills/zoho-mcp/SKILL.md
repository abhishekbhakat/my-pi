---
name: zoho-mcp
description: Dynamic access to Zoho Books MCP server (9 tools)
user-invocable: false
disable-model-invocation: false
---

# zoho-mcp Skill

This skill provides dynamic access to the Zoho Books MCP server without loading all tool definitions into context.

## Authentication

Create `zoho-auth.json` in this directory by copying `zoho-auth.sample.json` and replacing `YOUR_ZOHO_MCP_URL` with your Zoho MCP server URL (the URL contains the connection token).

Alternatively, set the `ZOHO_MCP_URL` environment variable.

The first connection requires a one-time Zoho OAuth login:

```bash
npx mcp-remote "$ZOHO_MCP_URL" --transport http-only
```

Open the printed URL, sign in to Zoho, and the token is cached in `~/.mcp-auth/` and refreshed automatically on subsequent calls.

## Available Tools

- `ZohoBooks_list_customer_payments`: List all the payments made by your customer.
- `ZohoBooks_create_invoice`: Create an invoice for your customer.
- `ZohoBooks_list_contacts`: Retrieve a comprehensive list of all contacts with advanced filters. This operation supports multiple search criteria including contact name, company name, address, email, phone, and general text search. You can filter contacts by status (active, inactive, duplicate, CRM) and sort by various fields. The response includes essential contact information, financial data including outstanding amounts and credit limits, and pagination details for efficient data retrieval.
- `ZohoBooks_create_contact`: Create a new contact with comprehensive business information. This operation allows you to create a customer or vendor by providing details such as contact name, company information, addresses, contact persons, payment terms, tax settings, and custom fields. The created contact can be used for generating invoices, bills, estimates, and other business transactions. The system automatically assigns a unique contact ID.
- `ZohoBooks_list_vendor_payments`: List all the payments made to your vendor.
- `ZohoBooks_list_items`: Get the list of all active items with pagination.
- `ZohoBooks_list_sales_orders`: List all sales orders.
- `ZohoBooks_get_estimate`: Get the details of an estimate.
- `ZohoBooks_list_organizations`: Get the list of organizations.

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
