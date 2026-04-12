# FreeAgent MCP on Cloudflare Workers

Remote MCP server for read-only FreeAgent access, deployed on Cloudflare Workers.

## Features

- Federated one-shot auth for connector setup using FreeAgent OAuth.
- MCP endpoint secured with `@cloudflare/workers-oauth-provider`.
- Durable Object-backed auth state with encrypted token storage.
- Company mode and practice mode support from one codebase.
- Broad read-only accounting and operational tool surface for analysis workflows.

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
3. Ask the user to provide values for `FREEAGENT_CLIENT_ID`, `FREEAGENT_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY`.
4. Run `npm run type-check` and `npm run test` before starting dev or deploy steps.
5. Start local dev with `npm run dev`.
6. For deployment, ensure Wrangler auth works, then run `npx wrangler deploy`.

Rules for LLM agents:

- Never invent or hardcode credentials.
- Never commit `.dev.vars`, real secrets, or account-specific deployment values.
- Keep `wrangler.jsonc` placeholders intact in public branches.
- If account-specific config is temporarily needed for testing, keep it out of the public branch or restore placeholders before publishing.

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
- This project is intentionally read-only for safety.

## Related Docs

- Architecture and phased plan: `Project/freeagent-mcp-implementation/`
- Capability mapping: `Project/freeagent-mcp-implementation/capability-matrix.md`
- Deployment modes: `Project/freeagent-mcp-implementation/deployment-modes.md`
- Sandbox notes: `Project/freeagent-mcp-implementation/sandbox-notes.md`
- Secret management: `Project/freeagent-mcp-implementation/secret-management.md`
