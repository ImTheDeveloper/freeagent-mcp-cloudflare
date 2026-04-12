import { describe, expect, it } from "vitest";
import { FreeAgentApiError } from "../src/freeagent/api";
import { formatFreeAgentErrorMessage } from "../src/freeagent/errors";

describe("freeagent error formatting", () => {
  it("formats rate limit errors with retry-after guidance", () => {
    const error = new FreeAgentApiError(
      "FreeAgent request failed (429)",
      429,
      "You must not exceed 120 requests per 60 seconds",
      60,
    );

    expect(formatFreeAgentErrorMessage("Failed to list invoices", error)).toBe(
      "Failed to list invoices: FreeAgent rate limit reached (429). Retry after 60s.",
    );
  });

  it("formats permission and not-found errors without leaking noisy payloads", () => {
    expect(
      formatFreeAgentErrorMessage(
        "Failed to list users",
        new FreeAgentApiError("forbidden", 403, "permission denied"),
      ),
    ).toBe(
      "Failed to list users: FreeAgent returned 403. The authenticated user likely lacks the required permission level for this resource.",
    );

    expect(
      formatFreeAgentErrorMessage(
        "Failed to get invoice",
        new FreeAgentApiError("not found", 404, "missing"),
      ),
    ).toBe(
      "Failed to get invoice: FreeAgent returned 404. The requested resource was not found in the current account context.",
    );
  });
});
