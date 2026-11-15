# FreeAgent MCP on Cloudflare Workers

Remote MCP server for FreeAgent, deployed on Cloudflare Workers. Read-only by default; write and delete tools are opt-in.

## Features

- Federated one-shot auth for connector setup using FreeAgent OAuth.
- MCP endpoint secured with `@cloudflare/workers-oauth-provider`.
- Durable Object-backed auth state with encrypted token storage.
- Company mode and practice mode support from one codebase.
- Broad read-only accounting and operational tool surface for analysis workflows.
- Optional write tools for creating draft invoices and reconciling bank transactions (see Write tools).

Reference docs:

- Architecture and implementation notes: `Project/freeagent-mcp-implementation/`
- Capability mapping: `Project/freeagent-mcp-implementation/capability-matrix.md`

## Architecture At A Glance

- Connector setup flow: `/authorize` -> FreeAgent consent -> `/callback` -> OAuth completion -> `/mcp`.
- Durable Objects:
  - `MCP_OBJECT` for MCP session/runtime behavior.
  - `AUTH_STORE` for principal auth records and pending OAuth handoff state.
- Deployment modes:
  - `company` for direct single-company access.
  - `practice` for practice dashboard plus client switching.

## Endpoints

- MCP: `https://<worker-name>.<subdomain>.workers.dev/mcp`
- Health: `https://<worker-name>.<subdomain>.workers.dev/health`
- OAuth authorize: `https://<worker-name>.<subdomain>.workers.dev/authorize`
- OAuth callback: `https://<worker-name>.<subdomain>.workers.dev/callback`

## Quickstart

Prerequisites:

- Node.js 20+
- Cloudflare account with Wrangler auth
- FreeAgent OAuth app with callback set to `https://<worker-name>.<subdomain>.workers.dev/callback`

Install and run locally:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Validation commands:

```bash
npm run type-check
npm run test
curl -i http://localhost:8787/health
```

## Deploy

Set secrets once per environment:

```bash
npx wrangler secret put FREEAGENT_CLIENT_ID
npx wrangler secret put FREEAGENT_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

Deploy:

```bash
npx wrangler deploy
```

## Company Smoke Test

After deployment, run a repeatable company-mode smoke test:

```bash
npm run smoke:company -- https://<worker-name>.<subdomain>.workers.dev/mcp
```

The script will:

- dynamically register an OAuth client
- print a browser authorization URL
- wait for the local callback on `http://127.0.0.1:8090/callback`
- run a small MCP smoke suite after auth completes

## If You Are An LLM Agent

When helping users set up this repo, follow this exact order:

1. Install dependencies with `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars`.
3. Copy `wrangler.jsonc.example` to `wrangler.jsonc`, then fill in your own KV namespace id
   (`npx wrangler kv namespace create OAUTH_KV`) and `WORKER_BASE_URL`.
4. Ask the user to provide values for `FREEAGENT_CLIENT_ID`, `FREEAGENT_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY`.
5. Run `npm run type-check` and `npm run test` before starting dev or deploy steps.
6. Start local dev with `npm run dev`.
7. For deployment, ensure Wrangler auth works, then run `npx wrangler deploy`.

Rules for LLM agents:

- Never invent or hardcode credentials.
- Never commit `.dev.vars`, real secrets, or account-specific deployment values.
- `wrangler.jsonc` is gitignored and holds real values; `wrangler.jsonc.example` is committed and must
  keep its placeholders. Never move real ids or URLs into the example file.

## Connect From Claude Or ChatGPT

1. Add your MCP URL in client settings:
   `https://<worker-name>.<subdomain>.workers.dev/mcp`
2. Complete FreeAgent consent in the browser.
3. In chat, run `auth_status` or `get_company`.
4. In practice mode, use `list_clients` and `switch_client` to choose an active client.
5. Run read-only tools.

## Known Limitations

- Practice-mode end-to-end validation depends on having a FreeAgent practice sandbox or real practice environment.
- Some FreeAgent endpoints may behave differently depending on permission level, account type, or enabled product features.
- Read-only by default for safety. Write and delete tools exist but are off unless you enable them (see Write tools).

## Related Docs

- Architecture and phased plan: `Project/freeagent-mcp-implementation/`
- Capability mapping: `Project/freeagent-mcp-implementation/capability-matrix.md`
- Deployment modes: `Project/freeagent-mcp-implementation/deployment-modes.md`
- Sandbox notes: `Project/freeagent-mcp-implementation/sandbox-notes.md`
- Secret management: `Project/freeagent-mcp-implementation/secret-management.md`
- Security policy: `SECURITY.md`
- Contribution guide: `CONTRIBUTING.md`
- License: `LICENSE`

## Write tools (opt-in)

Both flags default to off. Only the exact string `"true"` enables them. Set them as `vars` in your own `wrangler.jsonc`.

| Variable | Enables |
| --- | --- |
| `FREEAGENT_ENABLE_WRITES` | `create_contact`, `create_invoice` (always a draft), `transition_invoice` (send / draft / cancel, never emails), `reconcile_bank_transaction`, `update_bank_transaction_explanation` |
| `FREEAGENT_ENABLE_DELETES` | `delete_bank_transaction_explanation`, `delete_invoice`. Needs `FREEAGENT_ENABLE_WRITES` as well |

`reconcile_bank_transaction` explains a transaction by category, invoice (`paidInvoice`) or bill (`paidBill`). It checks direction, amount and currency first and refuses rather than guess. `delete_bank_transaction_explanation` is the undo.

Every tool is annotated (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so MCP clients can prompt before writes. Writes are never retried automatically, because a retry could create a duplicate. Each result names the company it wrote to. Attachments are not supported yet. Always try writes against a FreeAgent sandbox first by pointing `FREEAGENT_API_BASE_URL` at it. After deploying, reconnect your MCP client so it picks up the new tool list.

Read-only explanation tools (`list_bank_transaction_explanations`, `get_bank_transaction_explanation`) are always available.
