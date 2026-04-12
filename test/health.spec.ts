import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker health route", () => {
  it("returns ok", async () => {
    const response = await SELF.fetch("https://example.com/health");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("routes authorize requests through the auth handler", async () => {
    const response = await SELF.fetch("https://example.com/authorize");

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("FREEAGENT_CLIENT_ID is missing");
  });

  it("mounts the mcp route through the oauth provider", async () => {
    const response = await SELF.fetch("https://example.com/mcp");

    expect(response.status).not.toBe(404);
  });
});
