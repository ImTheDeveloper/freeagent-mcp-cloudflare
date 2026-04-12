# Secret Management And Operations

This document records the operational handling expected for FreeAgent MCP secrets and related deployment configuration.

## Worker secrets

Store the following values as Cloudflare Worker secrets rather than committed vars:

- `FREEAGENT_CLIENT_ID`
- `FREEAGENT_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`

Suggested commands:

```bash
wrangler secret put FREEAGENT_CLIENT_ID
wrangler secret put FREEAGENT_CLIENT_SECRET
wrangler secret put TOKEN_ENCRYPTION_KEY
```

## Non-secret Worker vars

These values can remain in Worker vars or environment-specific config:

- `WORKER_BASE_URL`
- `FREEAGENT_MODE`
- `FREEAGENT_API_BASE_URL`
- `FREEAGENT_USER_AGENT`

## Local development

Use `.dev.vars` for local-only secrets.

Expected flow:

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Fill in local test credentials.
3. Never commit `.dev.vars`.

## Client secret rotation

FreeAgent documents built-in OAuth client secret rotation.

Important operational points:

- FreeAgent can keep up to two active secrets for an app at once
- generate the new secret first
- update the Worker secret in Cloudflare
- redeploy and confirm OAuth still works
- revoke the old secret only after the new secret is confirmed in use

This should allow zero-downtime secret rotation.

## Token encryption key handling

`TOKEN_ENCRYPTION_KEY` protects stored FreeAgent access and refresh tokens.

Operational expectations:

- use a strong random value
- treat rotation carefully because old encrypted records cannot be decrypted by a new key without a migration strategy
- do not rotate casually in production without planning for existing auth records

## Deploy-time checks

Before production deployment:

1. Confirm the Worker secrets are present in the target environment.
2. Confirm `WORKER_BASE_URL` matches the deployed Worker URL.
3. Confirm `FREEAGENT_MODE` matches the intended app registration and test plan.
4. Run local validation first.
5. After deploy, perform a real OAuth flow test.

## Read-only safety

This repository currently targets a read-only MCP surface.

Operationally that means:

- do not expose write tools by default
- treat any future write-capable additions as a separate safety review item
- document any such change clearly before release
