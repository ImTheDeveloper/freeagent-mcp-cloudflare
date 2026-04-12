# FreeAgent MCP Build Architecture

## Purpose

This document captures the intended architecture and delivery direction for a remote MCP server focused on read-only FreeAgent analysis.

It exists to:

- align future contributors on the product and technical direction
- explain why the implementation is shaped the way it is
- provide a stable reference for the phased checklist in `implementation-plan.md`
- record the current intended scope even before the application code exists

## Product Goal

Build a remote MCP server for FreeAgent that provides materially broader accounting analysis than the existing narrow timesheet-oriented MCP offerings.

The target experience is similar in spirit to the existing Xero MCP Cloudflare project:

- remote MCP server hosted on Cloudflare Workers
- browser-based OAuth onboarding
- safe, read-only tool surface
- strong support for accountant and analysis workflows
- support for switching business context without rethinking the core MCP runtime

## Primary Use Cases

- inspect a FreeAgent company's high-level financial position
- review receivables, payables, VAT, and filing status
- drill from reports into operational accounting data
- inspect client accounts from an accountancy practice context
- support LLM-driven accounting analysis without enabling writes

## Non-Goals

- creating, updating, deleting, emailing, filing, or paying records in v1
- attachments, PDF download, or other binary-heavy tooling in v1
- attempting to normalize FreeAgent into Xero-compatible schemas where the APIs differ naturally
- building every FreeAgent endpoint before the useful analytical surface is complete

## Deployment Model

The service should follow the same broad runtime shape as the existing Xero Worker project:

- Cloudflare Worker hosts the remote MCP endpoint
- `@cloudflare/workers-oauth-provider` protects `/mcp`
- `/authorize` starts the one-shot MCP auth handoff flow
- `/callback` completes the FreeAgent OAuth exchange
- `/health` provides a basic health probe
- Durable Objects hold auth records and pending OAuth handoff state
- encrypted token storage is used for access and refresh tokens

Expected public endpoints:

- `/mcp`
- `/authorize`
- `/callback`
- `/health`

## API Modes

FreeAgent exposes two practical integration modes that matter to this project:

### Company API

Use this when the authenticated user is working against a single company account.

Relevant traits:

- simpler context model
- no cross-client switching
- good fit for direct end users

### Accountancy Practice API

Use this when the authenticated user belongs to a practice dashboard and needs access to multiple client accounts.

Relevant traits:

- closest equivalent to Xero multi-tenant workflows
- client discovery via `GET /v2/clients`
- requests are targeted to a client using the `X-Subdomain` request header
- rate limiting applies per client subdomain rather than the practice as a whole

## Recommended Product Direction

The implementation should be a dual-mode codebase with a mode switch at configuration/runtime level.

Reasoning:

- the company mode is valuable and simpler to validate
- the practice mode is the closest match to the original Xero MCP goal
- most of the Worker, MCP, token, storage, and endpoint plumbing is shared
- splitting into entirely separate codebases would duplicate too much early work

Recommended first deployment target:

- practice mode first if the priority is accountant-style cross-account analysis
- company mode first only if practice sandbox access blocks delivery

## Authentication Model

FreeAgent uses classic OAuth 2.0 authorization code flow.

Important characteristics:

- authorize endpoint: `https://api.freeagent.com/v2/approve_app`
- token endpoint: `https://api.freeagent.com/v2/token_endpoint`
- auth code lifetime is short
- access tokens expire after about an hour
- refresh requests return a replacement refresh token
- there is no Xero-style `id_token` to use as the principal identity source

### Principal Identity Strategy

Because FreeAgent does not return an OpenID identity token in the documented flow, principal identity should be resolved explicitly after token exchange.

Recommended callback sequence:

1. exchange authorization code for tokens
2. call `GET /v2/users/me`
3. call `GET /v2/company` in company mode or `GET /v2/practice` in practice mode
4. derive a stable principal identifier from user identity plus company/practice context

Good candidate principal keys:

- company mode: `<user_email>#company:<company_subdomain>`
- practice mode: `<user_email>#practice:<practice_subdomain>`

This keeps principals stable across MCP sessions while remaining independent from ephemeral session IDs.

## Auth Storage Model

The auth store should be Durable Object-backed and conceptually similar to the Xero implementation.

Each principal auth record should store:

- principal identifier
- integration mode
- encrypted access token
- encrypted refresh token
- token expiry timestamp
- profile summary for the authenticated user
- company summary or practice summary
- available client list for practice mode
- active company context or active client subdomain
- OAuth state metadata used for reconnect and session continuity
- last updated timestamp

Pending one-shot OAuth handoff state should be stored separately from the principal record.

## Session Model

The MCP session should remain light and reconstructable from the auth store.

Session state should contain:

- principal identifier
- current mode
- current active context
- lightweight cached connection metadata needed by tools
- encrypted token material only if necessary for refresh flow continuity
- last activity timestamp for TTL behavior

Session state should be treated as disposable. Durable Objects are the source of truth for reconnect continuity.

## FreeAgent API Client Layer

Create a dedicated FreeAgent client layer rather than inlining fetch logic into tools.

The client layer should handle:

- base URL selection for production and sandbox
- `Authorization: Bearer <token>` header
- required `User-Agent` header
- optional `X-Subdomain` header in practice mode
- `Accept: application/json`
- pagination helpers
- retry/backoff behavior for `429`
- consistent error wrapping with status code and response payload

Core helpers should include:

- `freeAgentGet`
- `freeAgentGetPaginated`
- `ensureValidAccessToken`
- `refreshAccessToken`
- `buildFreeAgentHeaders`

## Context Switching Model

Xero switches tenant by tenant ID. FreeAgent practice mode should switch client by subdomain.

Recommended tools:

- `auth_status`
- `get_me`
- `get_company`
- `get_practice`
- `list_clients`
- `switch_client`

Expected behavior:

- company mode does not need cross-company switching
- practice mode persists an `activeSubdomain`
- all client-scoped requests inject `X-Subdomain: <activeSubdomain>`

## Tool Design Principles

All tools in the initial release should remain read-only.

Tool design should favor:

- obvious names
- small parameter surfaces
- explicit date and view filters where supported
- predictable pagination controls
- returning raw structured data when possible
- adding minimal formatting only where it improves MCP usability

### Tool Groups

#### Auth and context

- health and hello tools
- auth visibility
- profile visibility
- company or practice discovery
- client selection

#### Core accounting analysis

- balance sheet
- profit and loss
- trial balance
- cashflow
- VAT returns
- final accounts reports
- company tax timeline

#### Revenue and receivables

- invoices
- invoice timeline
- credit notes
- estimates
- recurring invoices

#### Payables and spend

- bills
- expenses
- capital assets

#### Banking and ledger

- bank accounts
- bank transactions
- accounting transactions
- categories

#### Projects, time, and people

- contacts
- projects
- tasks
- timeslips
- users
- price list items

## Initial Response Strategy

Default to JSON-first responses for most tools.

Where helpful, add a small text summary ahead of the JSON payload only if it materially helps model usability. The default should remain straightforward pass-through of API results.

The server should not over-format reports in v1. Correctness and coverage are more important than bespoke presentation.

## Permissions and Capability Mapping

Unlike Xero, FreeAgent does not expose the same style of granular OAuth scopes for endpoint families. Access is shaped largely by the authenticated user's FreeAgent permission level and account context.

The project should therefore document tool access by:

- minimum FreeAgent permission level
- company-only or practice-capable status
- account-type constraints such as US or Universal only resources
- known platform constraints observed during validation

This should live in a dedicated project doc once implementation begins.

## Safety Model

This project is intentionally read-only in its first releases.

Safety requirements:

- no create/update/delete operations exposed through MCP tools
- no filing/payment transitions exposed through MCP tools
- no auto-email or document-generation actions exposed
- no attachment upload or mutation endpoints exposed

Read-only safety should be clear in code, docs, tool descriptions, and release notes.

## Rate Limits and Backoff

Documented rate limits matter enough to shape the client implementation early.

The client layer should:

- detect `429`
- read `Retry-After`
- return actionable messages to the MCP caller
- avoid aggressive automatic retries that amplify pressure
- preserve enough context in errors to explain whether failure is user-wide or client-subdomain-specific in practice mode

Refresh token usage should also be conservative because refresh requests have their own documented limit.

## Testing Strategy

The codebase should be built with automated validation from the start.

Phase progression rule:

- each phase must add or update the tests needed for the behavior introduced in that phase
- the relevant test suite must be passing before work moves to the next phase
- no phase should knowingly carry forward broken tests or unvalidated critical paths

Testing should cover at minimum:

- OAuth URL generation
- OAuth callback state handling
- token encryption and decryption
- refresh token rotation
- company mode and practice mode context resolution
- practice client switching
- API client header generation
- rate-limit error mapping
- pagination parsing
- selected tool registration and representative tool handlers

## Documentation Strategy

This project folder is the initial planning area.

As code is added, the repository should also gain:

- a repo README for setup and usage
- a capability matrix mapping tools to FreeAgent permissions
- environment setup examples
- local development and deployment instructions
- sandbox notes, especially for practice mode

## Current Delivery Assumptions

These assumptions are driving the first implementation plan:

- the codebase will start greenfield in this repository
- Cloudflare Workers remains the deployment target
- the existing Xero MCP Worker is the structural reference, not a literal copy target
- practice mode is the strategic destination because it unlocks the most Xero-like analysis workflow
- company mode should still be designed in from the start if the shared abstractions remain small

## Current Status

Current state at the time this document was created:

- research completed on FreeAgent auth, core endpoints, and practice mode options
- Phase 0 repository scaffold is complete
- Phase 1 shared runtime scaffold is complete
- Phase 2 OAuth and token lifecycle scaffold is complete
- Phase 3 company/practice context model is complete
- Phase 4 core accounting analysis tools are complete
- Phase 5 revenue, payables, and banking tools are complete
- Phase 6 projects, time, people, and supporting reference data tools are complete
- Phase 7 hardening and operational documentation is partially complete
- local Cloudflare Worker scaffold now exists with `wrangler.jsonc`, TypeScript config, env examples, MCP placeholder wiring, Durable Object bindings, shared response/config helpers, and runtime tests
- FreeAgent OAuth authorize/callback handling, encrypted token storage helpers, auth record storage, pending MCP auth handoff storage, and token refresh helpers now exist
- Company-mode and practice-mode context bootstrapping, persisted active client selection, and initial context MCP tools now exist
- Core report and filing insight tools now exist for balance sheet, P&L, trial balance, cashflow, VAT returns, final accounts reports, and company tax timeline
- Operational finance tools now exist for invoices, credit notes, estimates, recurring invoices, bills, expenses, bank accounts, bank transactions, accounting transactions, invoice timeline, and capital assets
- Wider business-analysis tools now exist for contacts, projects, tasks, timeslips, users, categories, and price list items
- FreeAgent-aware error mapping, rate-limit messaging, capability documentation, deployment-mode guidance, sandbox notes, and secret-management notes now exist
- company-mode end-to-end validation has been completed successfully against a live FreeAgent company account
- a reusable live smoke harness now exists for repeating company-mode validation after future changes
- phased implementation checklist created in `implementation-plan.md`
- local validation currently passes for type-check, lint, Vitest, and Wrangler dry-run bundle build
- full practice-mode end-to-end validation still depends on obtaining an appropriate practice sandbox or real practice environment

Future contributors should update this section when the implementation materially changes direction.
