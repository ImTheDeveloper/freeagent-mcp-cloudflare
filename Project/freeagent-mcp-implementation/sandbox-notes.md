# FreeAgent Sandbox Notes

These notes capture the practical sandbox constraints found during the build.

## Company sandbox

FreeAgent supports a sandbox API base URL.

Use:

- `FREEAGENT_API_BASE_URL=https://api.sandbox.freeagent.com`

This is the easiest environment for end-to-end validation of company mode.

## Practice sandbox

Practice-mode testing is more operationally awkward than company-mode testing.

FreeAgent docs indicate the current process is:

1. Contact the integrations team at `integrationsrequests@freeagent.com`.
2. Request a temporary practice dashboard sandbox.
3. Ensure the OAuth app has Accountancy Practice API enabled.
4. Add or create client accounts within the practice dashboard.

This means full practice-mode validation may be blocked by external provisioning rather than by code readiness.

## Rate-limit testing

FreeAgent supports an artificial sandbox rate-limit mode.

The docs state that sending the header below to sandbox requests lowers the limit to help test backoff handling:

- `X-RateLimit-Test: true`

The current implementation does not inject that header automatically. If we later add explicit rate-limit integration tests against a sandbox environment, this is the mechanism to use.

## Recommended validation order

1. Validate company mode locally and against a sandbox or real company account.
2. Validate practice-mode auth and client switching once practice sandbox access exists.
3. Validate rate-limit handling separately using sandbox plus the rate-limit test header.

## Current known limitation

At the time of writing, the repository is structurally ready for practice mode, but full end-to-end practice validation still depends on obtaining an appropriate practice dashboard environment.
