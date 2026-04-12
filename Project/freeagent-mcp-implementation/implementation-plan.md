# FreeAgent MCP Implementation Plan

Reference architecture: `build-architecture.md`

## How To Use This File

- treat this as the working build checklist
- tick tasks off as they are completed
- add short implementation notes beneath a phase if the plan changes
- keep task wording concrete so completion stays unambiguous
- if the architecture changes materially, update `build-architecture.md` first

## Phase Gate Rule

Before moving from one phase to the next:

- the tests required for the work completed in the current phase must exist or be updated
- the relevant test suite must be passing
- known failing tests must be fixed or the phase should remain open

This is intended to stop broken or weakly validated foundations from being carried into later phases.

## Phase Status

- [x] Phase 0: Repository and delivery foundation
- [x] Phase 1: Worker scaffold and shared runtime
- [x] Phase 2: OAuth and token lifecycle
- [x] Phase 3: Company and practice context model
- [x] Phase 4: Core accounting analysis tools
- [x] Phase 5: Revenue, payables, and banking tools
- [x] Phase 6: Projects, time, people, and supporting reference data
- [ ] Phase 7: Hardening, documentation, and release readiness

## Phase 0: Repository and delivery foundation

Goal: create the project skeleton and delivery guardrails so future phases build on a stable base.

- [x] P0.1 Initialize `package.json` with Node 20+ compatible tooling.
- [x] P0.2 Add TypeScript configuration for Worker-friendly builds.
- [x] P0.3 Add `wrangler.jsonc` with local and deploy-safe placeholders.
- [x] P0.4 Add `.gitignore`, `.env.example`, and `.dev.vars.example` without real secrets.
- [x] P0.5 Add scripts for `dev`, `type-check`, `test`, and `deploy`.
- [x] P0.6 Choose and wire a test runner suitable for Workers and unit tests.
- [x] P0.7 Add basic lint and formatting configuration.
- [x] P0.8 Add a root `README.md` with temporary setup notes and a pointer to this Project folder.

Exit criteria:

- repository installs cleanly
- type-check command runs
- test command runs even if only placeholder tests exist
- local Worker can boot with a health endpoint stub
- phase tests are passing before Phase 1 begins

Phase 0 notes:

- Installed local Cloudflare/MCP dependencies and Worker-native test tooling.
- Added `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, env examples, lint config, README, and an initial Worker scaffold.
- Added placeholder MCP/OAuth wiring plus a `hello` MCP tool and `/health` route.
- Validation completed with `npm run cf-typegen`, `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.
- Current non-blocking noise: Vitest emits third-party sourcemap warnings from `@modelcontextprotocol/sdk`, and workerd prints a websocket disconnect line on shutdown after passing tests.

## Phase 1: Worker scaffold and shared runtime

Goal: establish the Cloudflare Worker runtime, MCP agent shell, and shared service boundaries.

- [x] P1.1 Create `src/index.ts` with `/mcp`, `/authorize`, `/callback`, and `/health` route handling.
- [x] P1.2 Wire `@cloudflare/workers-oauth-provider` around the MCP endpoint.
- [x] P1.3 Create the MCP agent class and register a minimal `hello` tool.
- [x] P1.4 Create shared environment typing for secrets, bindings, and feature flags.
- [x] P1.5 Add Durable Object bindings for auth store and MCP runtime state if needed.
- [x] P1.6 Add base error helpers and text response helpers for tools.
- [x] P1.7 Add initial runtime tests for health route and MCP bootstrapping.

Exit criteria:

- Worker serves `/health`
- MCP endpoint is mounted through the OAuth provider
- local dev starts without auth logic implemented
- runtime scaffold tests are passing before Phase 2 begins

Phase 1 notes:

- Added the shared Worker entrypoint with `/mcp`, `/authorize`, `/callback`, and `/health` routes.
- Mounted the MCP route behind `@cloudflare/workers-oauth-provider`.
- Added a minimal `FreeAgentMCP` agent with a `hello` tool.
- Added baseline shared response helpers and lightweight env/config helpers.
- Added runtime tests covering `/health`, placeholder `/authorize`, and that `/mcp` is mounted through the OAuth provider.
- Validation completed with `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.

## Phase 2: OAuth and token lifecycle

Goal: implement FreeAgent OAuth, encrypted token storage, and refresh handling.

- [x] P2.1 Create FreeAgent OAuth helpers for authorize URL generation.
- [x] P2.2 Implement MCP one-shot authorize handoff storage for pending auth requests.
- [x] P2.3 Implement `/authorize` handler using the OAuth provider request parser.
- [x] P2.4 Implement `/callback` handler for authorization code exchange.
- [x] P2.5 Implement token encryption and decryption helpers.
- [x] P2.6 Implement auth store record shape for principal auth data.
- [x] P2.7 Call `GET /v2/users/me` after token exchange to resolve user identity.
- [x] P2.8 Implement token refresh flow against `/v2/token_endpoint`.
- [x] P2.9 Persist rotated refresh tokens when refresh responses replace them.
- [x] P2.10 Add tests for OAuth state parsing, token encryption, callback flow, and refresh rotation.

Exit criteria:

- a user can complete OAuth successfully
- tokens are stored encrypted
- expired access tokens can be refreshed automatically
- OAuth and token lifecycle tests are passing before Phase 3 begins

Phase 2 notes:

- Added FreeAgent OAuth state helpers, authorize URL generation, authorization code exchange, and callback handling.
- Added encrypted access/refresh token helpers using AES-GCM with a derived key.
- Added Durable Object-backed auth record storage and pending MCP OAuth request storage.
- Added FreeAgent API helpers for `GET /v2/users/me` and common authenticated headers including `User-Agent`.
- Added refresh-token lifecycle helpers that rotate both access and refresh tokens into the returned next session state.
- Added direct tests for OAuth state handling, encryption/decryption, authorize redirect flow, callback flow, and token refresh rotation.
- Validation completed with `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.

## Phase 3: Company and practice context model

Goal: support both FreeAgent operating modes without duplicating the codebase.

- [x] P3.1 Define a shared session/auth model covering `company` and `practice` modes.
- [x] P3.2 Add config support for selecting mode per environment.
- [x] P3.3 Implement `GET /v2/company` bootstrap flow for company mode.
- [x] P3.4 Implement `GET /v2/practice` bootstrap flow for practice mode.
- [x] P3.5 Implement `GET /v2/clients` fetching and storage for practice mode.
- [x] P3.6 Store `activeSubdomain` for practice mode client context.
- [x] P3.7 Implement `auth_status` tool.
- [x] P3.8 Implement `get_me` tool.
- [x] P3.9 Implement `get_company` tool.
- [x] P3.10 Implement `get_practice` tool.
- [x] P3.11 Implement `list_clients` tool.
- [x] P3.12 Implement `switch_client` tool.
- [x] P3.13 Add tests for mode-specific bootstrap and practice client switching.

Exit criteria:

- company mode has stable single-company context
- practice mode can list clients and switch active client subdomain
- downstream requests can obtain the right request context automatically
- mode and context tests are passing before Phase 4 begins

Phase 3 notes:

- Expanded session/auth state to include mode, company, practice, client list, and active subdomain.
- Added FreeAgent context bootstrap helpers for company mode and practice mode.
- Callback flow now hydrates account context immediately after OAuth completion.
- Added MCP tools for `auth_status`, `get_me`, `get_company`, `get_practice`, `list_clients`, and `switch_client`.
- Added lazy context hydration inside the MCP agent so older auth records can be upgraded on demand.
- Added tests covering company-mode bootstrap, practice-mode bootstrap, active subdomain resolution, and client switching.
- Validation completed with `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.

## Phase 4: Core accounting analysis tools

Goal: ship the highest-value financial analysis surface first.

- [x] P4.1 Build a reusable FreeAgent API client with JSON headers and User-Agent support.
- [x] P4.2 Add practice-mode `X-Subdomain` header injection in the client.
- [x] P4.3 Implement `get_balance_sheet`.
- [x] P4.4 Implement `get_profit_and_loss`.
- [x] P4.5 Implement `get_trial_balance_summary`.
- [x] P4.6 Implement `get_trial_balance_opening_balances`.
- [x] P4.7 Implement `get_cashflow`.
- [x] P4.8 Implement `list_vat_returns`.
- [x] P4.9 Implement `get_vat_return`.
- [x] P4.10 Implement `list_final_accounts_reports`.
- [x] P4.11 Implement `get_final_accounts_report`.
- [x] P4.12 Implement `get_company_tax_timeline`.
- [x] P4.13 Add tests for report tools, date parameter handling, and mode-aware request routing.

Exit criteria:

- the server can answer high-value accounting questions with core report endpoints alone
- report tools work in both company mode and practice mode where supported
- core analysis tool tests are passing before Phase 5 begins

Phase 4 notes:

- Added reusable report/path helpers for the accounting endpoints and practice-mode request scoping.
- Added MCP tools for balance sheet, profit and loss, trial balance summary, trial balance opening balances, cashflow, VAT returns, final accounts reports, and company tax timeline.
- Reused the authenticated session/context pipeline so report tools automatically refresh tokens and apply `X-Subdomain` in practice mode.
- Added helper-level tests for report path generation, date/query handling, and mode-aware request routing.
- Validation completed with `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.

## Phase 5: Revenue, payables, and banking tools

Goal: add the operational records needed to drill into report findings.

- [x] P5.1 Implement common pagination parsing from `Link` and `X-Total-Count` headers.
- [x] P5.2 Implement `list_invoices` with common view and sort filters.
- [x] P5.3 Implement `get_invoice`.
- [x] P5.4 Implement `get_invoice_timeline`.
- [x] P5.5 Implement `list_credit_notes`.
- [x] P5.6 Implement `get_credit_note`.
- [x] P5.7 Implement `list_estimates`.
- [x] P5.8 Implement `get_estimate`.
- [x] P5.9 Implement `list_recurring_invoices`.
- [x] P5.10 Implement `get_recurring_invoice`.
- [x] P5.11 Implement `list_bills`.
- [x] P5.12 Implement `get_bill`.
- [x] P5.13 Implement `list_expenses`.
- [x] P5.14 Implement `get_expense`.
- [x] P5.15 Implement `list_bank_accounts`.
- [x] P5.16 Implement `get_bank_account`.
- [x] P5.17 Implement `list_bank_transactions`.
- [x] P5.18 Implement `get_bank_transaction`.
- [x] P5.19 Implement `list_transactions`.
- [x] P5.20 Implement `get_transaction`.
- [x] P5.21 Implement `list_capital_assets`.
- [x] P5.22 Implement `get_capital_asset`.
- [x] P5.23 Add tests for pagination, filters, and representative endpoint handlers.

Exit criteria:

- users can move from summary reporting to the underlying operational records
- pagination and filters behave consistently across list tools
- revenue, payables, and banking tests are passing before Phase 6 begins

Phase 5 notes:

- Added shared path builders for operational resources and shared pagination parsing from `Link` and `X-Total-Count` headers.
- Added list/get MCP tools for invoices, credit notes, estimates, recurring invoices, bills, expenses, bank accounts, bank transactions, accounting transactions, and capital assets.
- Added invoice timeline support as part of the revenue drilldown surface.
- List tools now include pagination metadata in their JSON response when pagination headers or paging params are present.
- Added tests covering operational path generation, authenticated header generation, and pagination metadata parsing.
- Validation completed with `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.

## Phase 6: Projects, time, people, and supporting reference data

Goal: complete the wider analytical surface beyond pure ledger and reporting data.

- [x] P6.1 Implement `list_contacts`.
- [x] P6.2 Implement `get_contact`.
- [x] P6.3 Implement `list_projects`.
- [x] P6.4 Implement `get_project`.
- [x] P6.5 Implement `list_tasks`.
- [x] P6.6 Implement `get_task`.
- [x] P6.7 Implement `list_timeslips`.
- [x] P6.8 Implement `get_timeslip`.
- [x] P6.9 Implement `list_users`.
- [x] P6.10 Implement `get_user`.
- [x] P6.11 Implement `list_categories`.
- [x] P6.12 Implement `get_category`.
- [x] P6.13 Implement `list_price_list_items`.
- [x] P6.14 Implement `get_price_list_item`.
- [x] P6.15 Review whether any company-type-specific read-only endpoints should be added now or deferred.
- [x] P6.16 Add tests for remaining tool families and cross-resource filters.

Exit criteria:

- the MCP surface supports wider business analysis, not just financial statements
- reference data needed for interpretation is exposed through tools
- supporting data and workflow tests are passing before Phase 7 begins

Phase 6 notes:

- Added MCP tools for contacts, projects, tasks, timeslips, users, categories, and price list items.
- Added supported filter coverage for contacts/project/task/timeslip list endpoints including nested response flags where FreeAgent supports them.
- Added category support using nominal codes and optional sub-account expansion.
- Added path-builder tests for the broader people/project/reference data surface.
- Reviewed company-type-specific read-only endpoints and left niche/region-specific ones deferred rather than broadening the surface prematurely.
- Validation completed with `npm run type-check`, `npm run lint`, `npm run test`, and `npm run deploy -- --dry-run`.

## Phase 7: Hardening, documentation, and release readiness

Goal: make the implementation safe, understandable, and deployable.

- [x] P7.1 Add structured FreeAgent API error mapping with clearer user-facing messages.
- [x] P7.2 Add explicit `429` handling using `Retry-After`.
- [x] P7.3 Add capability documentation mapping tools to FreeAgent permission levels.
- [x] P7.4 Add documentation for company mode versus practice mode deployment.
- [x] P7.5 Add sandbox guidance, especially for practice dashboard access limitations.
- [x] P7.6 Add secret management documentation including client secret rotation notes.
- [x] P7.7 Add a read-only safety statement in the root README and tool descriptions.
- [x] P7.8 Run end-to-end local validation for company mode.
- [ ] P7.9 Run end-to-end local validation for practice mode when sandbox access is available.
- [x] P7.10 Prepare first deployable environment configuration.
- [ ] P7.11 Review and trim any low-value tools before first public release.
- [x] P7.12 Update this plan and `build-architecture.md` with real status and any deviations from the original approach.

Exit criteria:

- docs match reality
- deployment steps are repeatable
- failure modes are understandable
- the first release can be used safely in read-only mode
- the full test suite is passing at release readiness

Phase 7 progress notes:

- Added `FreeAgentApiError`-aware formatting so 401, 403, 404, and 429 responses surface clearer MCP messages.
- Added explicit Retry-After handling for rate-limited API requests and token refresh failures.
- Added operational docs:
  - `capability-matrix.md`
  - `deployment-modes.md`
  - `sandbox-notes.md`
  - `secret-management.md`
- Updated the root README to reinforce the current read-only posture and point to the Project docs.
- Prepared the first deployable environment shape via `wrangler.jsonc`, env examples, and deployment-mode guidance.
- Added a repeatable `npm run smoke:company` harness that dynamically registers an OAuth client, handles localhost callback capture, and runs core MCP smoke calls.
- Completed a real company-mode end-to-end validation against a live FreeAgent company account.
- Observed and fixed one live-usage issue: tools with fully optional argument sets now accept omitted arguments cleanly.
- Remaining work before Phase 7 can be closed:
  - a real practice-mode validation pass once sandbox or production access is available
  - a final pre-release review of lower-value tools for possible trimming

## Optional Later Phase Ideas

These are intentionally out of scope for the first delivery pass unless priorities change.

- [ ] L1 Add PDF retrieval tools for invoices, estimates, and credit notes.
- [ ] L2 Add attachments read support where useful and safe.
- [ ] L3 Add richer server-side summaries for common accountant workflows.
- [ ] L4 Add cached report helpers if rate limits become a real bottleneck.
- [ ] L5 Evaluate whether selected write actions ever belong behind explicit opt-in tools in a separate safety tier.

## Notes

Use this section to capture real implementation decisions and deviations as work progresses.

- Live company-mode smoke validation succeeded against a real FreeAgent company account.
