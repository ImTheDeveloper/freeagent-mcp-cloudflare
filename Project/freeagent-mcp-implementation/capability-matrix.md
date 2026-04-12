# FreeAgent MCP Capability Matrix

This document maps the current MCP tool surface to the minimum FreeAgent permission level and the account mode in which the tool is expected to work.

Reference docs:

- `build-architecture.md`
- `implementation-plan.md`

## Notes

- FreeAgent access is controlled primarily by the authenticated user's permission level, not by granular OAuth scopes in the Xero sense.
- `Both` means the tool should work in company mode and in practice mode when a client context is active.
- `Practice only` means the tool depends on the practice dashboard API.
- Some resources may expose fewer fields at lower permission levels even when the endpoint itself is reachable.

| Tool group | Tools | Minimum access level | Modes | Notes |
| --- | --- | --- | --- | --- |
| Health and session | `hello`, `auth_status` | N/A | Both | Worker/runtime health and session visibility only. |
| User identity | `get_me` | `Time` | Both | Based on `GET /v2/users/me`. |
| Company context | `get_company` | `Time` | Both | In practice mode this is the currently active client company. |
| Practice context | `get_practice`, `list_clients`, `switch_client` | Practice dashboard account manager | Practice only | Requires a FreeAgent app with Accountancy Practice API enabled. |
| Core reports | `get_balance_sheet`, `get_profit_and_loss`, `get_trial_balance_summary`, `get_trial_balance_opening_balances`, `list_vat_returns`, `get_vat_return`, `list_final_accounts_reports`, `get_final_accounts_report`, `get_company_tax_timeline` | `Tax, Accounting & Users` | Both | Report availability depends on the target company data and account type. |
| Cashflow | `get_cashflow` | `Banking` | Both | Historic cashflow only, no projected cashflow. |
| Invoices | `list_invoices`, `get_invoice`, `get_invoice_timeline` | `Estimates and Invoices` | Both | Nested invoice items are optional on the list tool. |
| Credit notes | `list_credit_notes`, `get_credit_note` | `Estimates and Invoices` | Both | Nested credit note items are optional on the list tool. |
| Estimates | `list_estimates`, `get_estimate` | `Estimates and Invoices` | Both | Nested estimate items are optional on the list tool. |
| Recurring invoices | `list_recurring_invoices`, `get_recurring_invoice` | `Estimates and Invoices` | Both | Read-only recurring invoice inspection only. |
| Bills | `list_bills`, `get_bill` | `Bills` | Both | Nested bill items are optional on the list tool. |
| Expenses | `list_expenses`, `get_expense` | `My Money` | Both | Some fields depend on expense type and company type. |
| Bank accounts | `list_bank_accounts`, `get_bank_account` | `Banking` | Both | View filters split standard bank, credit card, and PayPal accounts. |
| Bank transactions | `list_bank_transactions`, `get_bank_transaction` | `Banking` | Both | `list_bank_transactions` requires a bank account reference. |
| Accounting transactions | `list_transactions`, `get_transaction` | `Tax, Accounting & Users` | Both | Supports date-range and nominal-code filters. |
| Capital assets | `list_capital_assets`, `get_capital_asset` | `Banking` | Both | Capital asset history is optional via `includeHistory`. |
| Contacts | `list_contacts`, `get_contact` | `Time` | Both | More detailed fields are returned when the user also has Contacts & Projects permission. |
| Projects | `list_projects`, `get_project` | `Contacts and Projects` | Both | Supports nested contact details on the list tool. |
| Tasks | `list_tasks`, `get_task` | `Time` | Both | More detailed task billing fields require Contacts & Projects permission. |
| Timeslips | `list_timeslips`, `get_timeslip` | `Time` | Both | Supports nested related resources on the list tool. |
| Users | `list_users`, `get_user` | `Tax, Accounting & Users` | Both | `get_me` remains the preferred self-profile tool. |
| Categories | `list_categories`, `get_category` | `My Money` | Both | `list_categories` can include sub-accounts. |
| Price list items | `list_price_list_items`, `get_price_list_item` | `Invoices, Estimates and Files` | Both | Sort support only on the list tool. |

## Deferred or intentionally excluded

| Area | Status | Reason |
| --- | --- | --- |
| Mutating endpoints | Excluded | v1 remains read-only. |
| Attachments and PDF fetches | Deferred | Useful, but outside the first safe read-only surface. |
| Filing and payment transitions | Excluded | Too risky for a default MCP surface. |
| Region-specific or niche endpoints | Deferred | Held back until the core analytical surface stabilises. |
