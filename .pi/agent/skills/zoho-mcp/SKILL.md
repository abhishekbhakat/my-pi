---
name: zoho-mcp
description: Zoho Books via MCP executor. Run ./executor.py --list for live tools.
user-invocable: false
disable-model-invocation: false
---

# zoho-mcp Skill

Thin wrapper around Zoho Books MCP. Live tool schemas beat this doc. Call `./executor.py --list` / `--describe` before unfamiliar operations.

## Authentication

Create `zoho-auth.json` in this directory by copy `zoho-auth.sample.json` and replace `YOUR_ZOHO_MCP_URL` with your Zoho MCP server URL (URL contain connection token).

Alternative: set `ZOHO_MCP_URL` environment variable.

First connection require one-time Zoho OAuth login:

```bash
npx mcp-remote "$ZOHO_MCP_URL" --transport http-only
```

Open printed URL, sign in to Zoho, and token is cached in `~/.mcp-auth/` and refreshed automatically on subsequent calls.

`mcp-config.json` may already hold the MCP URL. Executor resolves: `ZOHO_MCP_URL` → `zoho-auth.json` → `mcp-config.json`.

## Conventions

Durable business rules for this org. Follow every invoice/payment task.

### Invoice totals: whole INR

Always land invoice `total` on a whole rupee (no paise).

1. Create or update invoice as usual.
2. Read returned `total`. If it has paise, set `adjustment` so total becomes nearest whole rupee.
3. `adjustment_description`: `Rounding adjustment`.
4. Verify with get/list that `total` has no fractional part.
5. If `|adjustment| > 1`, stop and warn user — likely rate/qty error, not rounding.
6. Show the adjustment in the proposal table before create when numbers are known; still auto-apply on create/update so drafts never sit at x.94.

`update_invoice` requires full `line_items` again. Omitting a line deletes it. Always resend every line when patching adjustment.

Nearest-rupee example: ₹1,49,999.94 → `adjustment` +0.06 → ₹1,50,000.00.

### Line items

- `product_type` must be `service` (not `services`) for consulting.
- Prefer known `item_id` + `tax_id` + `hsn_or_sac` from prior invoices for same customer.

### Payments

- Before `create_customer_payment`, confirm date, mode, amount, and bank/cash `account_id` if depositing to a specific account.
- India TDS on professional fees: usually % of **taxable** (pre-GST), not of grand total. Use `invoices[].tax_amount_withheld` so invoice balance clears (received + withheld = total).
- Default deposit without `account_id` lands in Undeposited Funds.

### Organization

- Resolve `organization_id` via `ZohoBooks_list_organizations` once per session when unknown. Pass it on every call that needs `query_params.organization_id`.

## Skill doc sync policy

- **Do not** rewrite this SKILL.md on every mid-session tool discovery.
- Use new tools immediately via `--list` / `--describe` / `--call`.
- Update this file only when:
  - user asks to update the skill, or
  - this doc **contradicts** live reality (wrong auth steps, wrong conventions, capability group that misleads).
- After repo edit under `.pi/agent/skills/zoho-mcp/`, run `make install` from the my-pi repo. Never write `~/.pi` by hand. Tell user `/reload`.

## Capability groups

Names below are typical. Live set may differ — always `--list` if a needed tool is missing.

| Group    | Typical tools                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Org      | `list_organizations`                                                                                              |
| Contacts | `list_contacts`, `create_contact`, `update_contact`, `delete_contact`                                             |
| Invoices | `list_invoices`, `get_invoice`, `create_invoice`, `update_invoice`, `delete_invoice`, `delete_invoice_line_item`, `list_invoices_of_credit_note` |
| Payments | `list_customer_payments`, `create_customer_payment`, `create_customer_payment_refund`, `list_vendor_payments`     |
| Items    | `list_items`, `list_item_details`, `get_item`, `create_item`, `update_item`, `delete_item`, active/inactive, portal add/remove |
| Taxes    | `list_taxes`, `get_tax`, `create_tax`, `update_tax`, `delete_tax` (Sales Tax enabled)                             |
| Other    | `list_sales_orders`, `get_estimate`                                                                               |

Prefix all tool names with `ZohoBooks_`.

## Usage Pattern

**Step 1:** Pick tool. If absent from `--list`, tell user which Zoho MCP tool to enable.

**Step 2:** Build call JSON. Prefer `--describe tool_name` for required fields.

```json
{
  "tool": "ZohoBooks_list_invoices",
  "arguments": {
    "query_params": {
      "organization_id": "ORG_ID",
      "per_page": 5,
      "sort_column": "date"
    }
  }
}
```

**Step 3:** Execute:

```bash
cd $SKILL_DIR
./executor.py --call 'YOUR_JSON_HERE'
```

Replace `$SKILL_DIR` with the skill directory path (repo source under my-pi `.pi/agent/skills/zoho-mcp/`, or installed copy under the agent skills path after `make install`).

## Getting Tool Details

```bash
cd $SKILL_DIR
./executor.py --list
./executor.py --describe tool_name
```

## Error Handling

- Wrong tool name → `--list`
- Missing args → `--describe tool_name`
- MCP / OAuth fail → re-auth with `npx mcp-remote …`
- Tool not on server → enable in Zoho MCP dashboard, then `--list` again (no skill rewrite required)
