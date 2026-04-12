import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapAccountContext, resolveActiveSubdomain, switchActiveClientContext } from "../src/freeagent/context";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("freeagent context helpers", () => {
  it("bootstraps company mode context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        company: {
          id: 1,
          name: "Example Company",
          subdomain: "example-company",
        },
      }),
    );

    const context = await bootstrapAccountContext("access-token", {
      FREEAGENT_MODE: "company",
      FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
      FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0",
    });

    expect(context).toMatchObject({
      mode: "company",
      activeSubdomain: "example-company",
      company: {
        name: "Example Company",
      },
      clients: [],
      practice: null,
    });
  });

  it("bootstraps practice mode context and preserves a preferred client", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.freeagent.com/v2/practice") {
        return Response.json({
          name: "My Practice",
          subdomain: "practice-subdomain",
        });
      }

      if (url === "https://api.freeagent.com/v2/clients?minimal_data=true&per_page=500") {
        return Response.json({
          clients: [
            { id: 1, name: "Alpha Co", subdomain: "alpha" },
            { id: 2, name: "Beta Co", subdomain: "beta" },
          ],
        });
      }

      if (url === "https://api.freeagent.com/v2/company") {
        expect(new Headers(init?.headers).get("X-Subdomain")).toBe("beta");
        return Response.json({
          company: {
            id: 2,
            name: "Beta Co",
            subdomain: "beta",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const context = await bootstrapAccountContext(
      "access-token",
      {
        FREEAGENT_MODE: "practice",
        FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
        FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0",
      },
      { preferredActiveSubdomain: "beta" },
    );

    expect(context).toMatchObject({
      mode: "practice",
      activeSubdomain: "beta",
      practice: {
        name: "My Practice",
      },
      company: {
        name: "Beta Co",
      },
    });
    expect(context.clients).toHaveLength(2);
  });

  it("switches active client context after validating the subdomain", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      expect(new Headers(init?.headers).get("X-Subdomain")).toBe("beta");
      return Response.json({
        company: {
          id: 2,
          name: "Beta Co",
          subdomain: "beta",
        },
      });
    });

    const result = await switchActiveClientContext(
      "access-token",
      {
        FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
        FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0",
      },
      [
        { id: 1, name: "Alpha Co", subdomain: "alpha" },
        { id: 2, name: "Beta Co", subdomain: "beta" },
      ],
      "beta",
    );

    expect(result).toMatchObject({
      activeSubdomain: "beta",
      company: {
        name: "Beta Co",
      },
    });
  });

  it("resolves a preferred active subdomain when it exists", () => {
    const activeSubdomain = resolveActiveSubdomain(
      [
        { subdomain: "alpha" },
        { subdomain: "beta" },
      ],
      "beta",
    );

    expect(activeSubdomain).toBe("beta");
  });
});
