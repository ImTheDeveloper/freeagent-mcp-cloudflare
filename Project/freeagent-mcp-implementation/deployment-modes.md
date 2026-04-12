# FreeAgent MCP Deployment Modes

This project supports two FreeAgent operating modes from the same codebase.

## Company mode

Use company mode when the authenticated user is working against a single FreeAgent company account.

Characteristics:

- simpler bootstrap flow
- no cross-client switching
- `get_company` reads the directly connected company
- best default for initial validation and direct end-user use

Recommended config:

- `FREEAGENT_MODE=company`
- FreeAgent app created without practice-specific assumptions unless you also plan to use practice mode elsewhere

## Practice mode

Use practice mode when the authenticated user belongs to a FreeAgent practice dashboard and needs access to multiple client accounts.

Characteristics:

- requires a FreeAgent app with `Enable Accountancy Practice API` checked
- `get_practice`, `list_clients`, and `switch_client` become meaningful
- downstream requests target a client using the `X-Subdomain` header
- rate limits apply per client subdomain

Recommended config:

- `FREEAGENT_MODE=practice`
- FreeAgent practice dashboard account manager authorizes the app

## Shared Cloudflare resources

Both modes require the same Worker-side resources:

- Workers KV namespace bound as `OAUTH_KV`
- Durable Object bound as `AUTH_STORE`
- Durable Object bound as `MCP_OBJECT`
- Worker vars for:
  - `WORKER_BASE_URL`
  - `FREEAGENT_MODE`
  - `FREEAGENT_API_BASE_URL`
  - `FREEAGENT_USER_AGENT`
- Worker secrets for:
  - `FREEAGENT_CLIENT_ID`
  - `FREEAGENT_CLIENT_SECRET`
  - `TOKEN_ENCRYPTION_KEY`

## Recommended deployment approach

Use separate Cloudflare Worker environments or separate Worker names for company and practice deployments.

Reasoning:

- app registration and sandbox setup can differ between company and practice usage
- switching `FREEAGENT_MODE` per environment is straightforward
- it keeps operational intent clear for each deployed endpoint

## First deploy checklist

1. Create the FreeAgent OAuth app.
2. Decide whether the target deployment is company mode or practice mode.
3. Create the Cloudflare KV namespace and Durable Object bindings expected by `wrangler.jsonc`.
4. Set Worker secrets for `FREEAGENT_CLIENT_ID`, `FREEAGENT_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY`.
5. Set Worker vars for `WORKER_BASE_URL`, `FREEAGENT_MODE`, `FREEAGENT_API_BASE_URL`, and `FREEAGENT_USER_AGENT`.
6. Run `npm run cf-typegen` after any `wrangler.jsonc` changes.
7. Run `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.
8. Deploy with `npm run deploy`.
9. Complete an end-to-end OAuth test in the intended mode.

## Current practical recommendation

- deploy company mode first if you want the shortest path to a real connected environment
- deploy practice mode as soon as you have practice sandbox or real practice access available
