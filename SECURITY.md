# Security Policy

## Supported scope

This repository contains a Cloudflare Worker MCP server and OAuth integration code for FreeAgent.

## Reporting a vulnerability

Please do not open public issues for security-sensitive problems.

- If GitHub private vulnerability reporting is enabled on this repository, use that.
- Otherwise, report privately to the maintainers through the normal private channel.
- Include reproduction steps, impact, and the affected files, endpoints, or flows.

## Secret handling requirements

- Never commit real credentials such as `FREEAGENT_CLIENT_SECRET`, OAuth tokens, or encryption keys.
- Use `.dev.vars` locally and `wrangler secret put` for deployed environments.
- Keep `wrangler.jsonc` placeholders intact in public branches.
- Rotate secrets immediately if accidental exposure is suspected.
