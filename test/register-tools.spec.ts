import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerOptionalTool, type TextToolResponse } from "../src/mcp/register-tools";

const okResponse: TextToolResponse = { content: [{ type: "text", text: "ok" }] };

async function connectedClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return client;
}

describe("registerOptionalTool", () => {
  it("advertises every optional parameter to the client", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });

    registerOptionalTool(
      server,
      "list_things",
      {
        page: z.number().int().positive().optional(),
        perPage: z.number().int().positive().max(100).optional(),
        sort: z.string().optional(),
        fromDate: z.string().optional(),
      },
      () => okResponse,
      "Lists things.",
    );

    const client = await connectedClient(server);
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "list_things");

    // Regression guard: wrapping the shape in z.object(...).optional() makes the
    // SDK emit an empty schema, silently hiding pagination from every caller.
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
      "fromDate",
      "page",
      "perPage",
      "sort",
    ]);
    expect(tool?.description).toBe("Lists things.");
  });

  it("keeps every parameter optional and forwards supplied arguments", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    let received: unknown;

    registerOptionalTool(
      server,
      "list_things",
      { page: z.number().int().positive().optional(), perPage: z.number().int().positive().optional() },
      (args) => {
        received = args;
        return okResponse;
      },
    );

    const client = await connectedClient(server);
    const { tools } = await client.listTools();

    expect(tools[0]?.inputSchema.required ?? []).toEqual([]);

    await client.callTool({ name: "list_things", arguments: {} });
    expect(received).toEqual({});

    await client.callTool({ name: "list_things", arguments: { page: 3, perPage: 100 } });
    expect(received).toEqual({ page: 3, perPage: 100 });
  });

  it("rejects a per-page value above the FreeAgent limit", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });

    registerOptionalTool(
      server,
      "list_things",
      { perPage: z.number().int().positive().max(100).optional() },
      () => okResponse,
    );

    const client = await connectedClient(server);
    const result = await client.callTool({ name: "list_things", arguments: { perPage: 500 } });

    expect(result.isError).toBe(true);
  });
});
