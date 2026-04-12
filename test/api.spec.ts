import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFreeAgentHeaders, freeAgentGetDetailed } from "../src/freeagent/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("freeagent api helpers", () => {
  it("builds authenticated headers including practice subdomain when provided", () => {
    const headers = buildFreeAgentHeaders(
      "access-token",
      { FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0" },
      { subdomain: "client-alpha" },
    );

    expect(headers.get("Authorization")).toBe("Bearer access-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("User-Agent")).toBe("freeagent-mcp/0.1.0");
    expect(headers.get("X-Subdomain")).toBe("client-alpha");
  });

  it("returns payload and parses pagination metadata from response headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ invoices: [{ url: "https://api.freeagent.com/v2/invoices/1" }] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          Link: '<https://api.freeagent.com/v2/invoices?page=1&per_page=50>; rel="prev", <https://api.freeagent.com/v2/invoices?page=3&per_page=50>; rel="next"',
          "X-Total-Count": "125",
        },
      }),
    );

    const result = await freeAgentGetDetailed(
      "/v2/invoices?page=2&per_page=50",
      "access-token",
      {
        FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
        FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0",
      },
    );

    expect(result.payload).toEqual({
      invoices: [{ url: "https://api.freeagent.com/v2/invoices/1" }],
    });
    expect(result.pagination).toEqual({
      page: 2,
      perPage: 50,
      totalCount: 125,
      links: {
        prev: "https://api.freeagent.com/v2/invoices?page=1&per_page=50",
        next: "https://api.freeagent.com/v2/invoices?page=3&per_page=50",
      },
    });
  });
});
