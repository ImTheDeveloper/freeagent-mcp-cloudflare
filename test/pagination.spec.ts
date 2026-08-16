import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTruncationNotice,
  countCollectionItems,
  freeAgentGetAllPages,
  type PaginationMetadata,
} from "../src/freeagent/api";

const env = {
  FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
  FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function row(code: number) {
  return { nominal_code: String(code), debit_value: code };
}

/** Serves `total` rows out of a paginated endpoint, recording each path requested. */
function mockPagedEndpoint(key: string, total: number, requested: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    requested.push(`${url.pathname}?${url.searchParams.toString()}`);

    const page = Number(url.searchParams.get("page") ?? "1");
    const perPage = Number(url.searchParams.get("per_page") ?? "25");
    const start = (page - 1) * perPage;
    const items = Array.from({ length: total }, (_, index) => row(index + 1)).slice(
      start,
      start + perPage,
    );

    const headers: Record<string, string> = { "X-Total-Count": String(total) };
    if (start + items.length < total) {
      headers.Link = `<https://api.freeagent.com/x?page=${page + 1}>; rel="next"`;
    }

    return new Response(JSON.stringify({ [key]: items }), { status: 200, headers });
  });
}

describe("freeAgentGetAllPages", () => {
  it("exhausts a multi-page report and concatenates every row", async () => {
    const requested: string[] = [];
    mockPagedEndpoint("trial_balance_summary", 240, requested);

    const result = await freeAgentGetAllPages<{ trial_balance_summary: Array<{ nominal_code: string }> }>(
      "/v2/accounting/trial_balance/summary",
      "token",
      env,
    );

    expect(result.payload.trial_balance_summary).toHaveLength(240);
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(3);
    expect(result.totalCount).toBe(240);
    // Rows survive in order, and the tail that the 25-row default dropped is present.
    expect(result.payload.trial_balance_summary[0].nominal_code).toBe("1");
    expect(result.payload.trial_balance_summary[239].nominal_code).toBe("240");
    // Requests default to the 100 maximum rather than the 25 default.
    expect(requested.every((path) => path.includes("per_page=100"))).toBe(true);
  });

  it("stops after one request when the endpoint is not paginated", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ balance_sheet: [row(1), row(2)] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await freeAgentGetAllPages("/v2/accounting/balance_sheet", "token", env);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.pagesFetched).toBe(1);
    expect(result.complete).toBe(true);
  });

  it("does not duplicate rows when an endpoint ignores the page parameter", async () => {
    // A full page every time, but always the same rows.
    const page = Array.from({ length: 100 }, (_, index) => row(index + 1));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ items: page }), {
          status: 200,
          headers: { Link: '<https://api.freeagent.com/x?page=2>; rel="next"' },
        }),
    );

    const result = await freeAgentGetAllPages<{ items: unknown[] }>("/v2/items", "token", env);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.payload.items).toHaveLength(100);
  });

  it("reports incompleteness when the page cap is reached", async () => {
    const requested: string[] = [];
    mockPagedEndpoint("items", 100_000, requested);

    const result = await freeAgentGetAllPages("/v2/items", "token", env, { maxPages: 3 });

    expect(result.pagesFetched).toBe(3);
    expect(result.complete).toBe(false);
  });

  it("retries without pagination params when an endpoint rejects them", async () => {
    const requested: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      requested.push(url.searchParams.toString());

      if (url.searchParams.has("page")) {
        return new Response("bad request", { status: 400 });
      }

      return new Response(JSON.stringify({ balance_sheet: [row(1)] }), { status: 200 });
    });

    const result = await freeAgentGetAllPages<{ balance_sheet: unknown[] }>(
      "/v2/accounting/balance_sheet?as_at_date=2026-03-31",
      "token",
      env,
    );

    expect(result.payload.balance_sheet).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(requested).toHaveLength(2);
  });

  it("propagates errors that are not about pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));

    await expect(freeAgentGetAllPages("/v2/items", "token", env)).rejects.toThrow(
      "FreeAgent request failed (403)",
    );
  });

  it("clamps an oversized per_page to the FreeAgent maximum", async () => {
    const requested: string[] = [];
    mockPagedEndpoint("items", 10, requested);

    await freeAgentGetAllPages("/v2/items?per_page=5000", "token", env);

    expect(requested[0]).toContain("per_page=100");
  });
});

describe("truncation reporting", () => {
  const pagination = (overrides: Partial<PaginationMetadata>): PaginationMetadata => ({
    page: 1,
    perPage: 25,
    links: {},
    ...overrides,
  });

  it("flags a first page that hides the rest of the records", () => {
    const notice = buildTruncationNotice(pagination({ totalCount: 120 }), 25);

    expect(notice?.truncated).toBe(true);
    expect(notice?.returned).toBe(25);
    expect(notice?.totalCount).toBe(120);
    expect(notice?.nextPage).toBe(2);
    expect(notice?.message).toContain("INCOMPLETE RESULT");
    expect(notice?.message).toContain("25 of 120");
  });

  it("flags truncation from a next link even without a total count", () => {
    const notice = buildTruncationNotice(
      pagination({ links: { next: "https://api.freeagent.com/v2/invoices?page=2" } }),
      25,
    );

    expect(notice?.truncated).toBe(true);
    expect(notice?.message).toContain("an unknown number of");
  });

  it("stays silent when the response is complete", () => {
    expect(buildTruncationNotice(pagination({ totalCount: 12 }), 12)).toBeUndefined();
    expect(buildTruncationNotice(pagination({}), 12)).toBeUndefined();
  });

  it("counts records from the collection key", () => {
    expect(countCollectionItems({ invoices: [1, 2, 3] })).toBe(3);
    expect(countCollectionItems({ meta: "x" })).toBe(0);
  });
});
