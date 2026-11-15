import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerWriteTools, type WriteToolDeps } from "../src/mcp/write-tools";

const BASE = "https://api.example.test";

function setup(allowDeletes: boolean, get: (path: string) => any = () => ({})) {
  const write = vi.fn(async () => ({ payload: { bank_transaction_explanation: { url: "x" } }, location: "loc" }));
  const deps: WriteToolDeps = {
    baseUrl: BASE,
    allowDeletes,
    get: async (path) => get(path),
    write,
    companyLabel: () => "Test Co",
  };
  const server = new McpServer({ name: "t", version: "0" });
  registerWriteTools(server, deps);
  return { server, write };
}

async function connect(server: McpServer): Promise<Client> {
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}

describe("registerWriteTools", () => {
  it("omits delete tools unless deletes are allowed", async () => {
    const without = await (await connect(setup(false).server)).listTools();
    const withDeletes = await (await connect(setup(true).server)).listTools();
    const names = (r: typeof without) => r.tools.map((t) => t.name);

    expect(names(without)).toContain("reconcile_bank_transaction");
    expect(names(without)).not.toContain("delete_invoice");
    expect(names(without)).not.toContain("delete_bank_transaction_explanation");
    expect(names(withDeletes)).toContain("delete_invoice");
    expect(names(withDeletes)).toContain("delete_bank_transaction_explanation");
  });

  it("annotates writes and marks deletes destructive", async () => {
    const { tools } = await (await connect(setup(true).server)).listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));

    expect(byName.create_invoice).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.delete_invoice).toMatchObject({ destructiveHint: true });
  });

  it("reconciles an invoice with a single POST and reports the company", async () => {
    const { server, write } = setup(false, (path) => {
      if (path.includes("bank_transactions")) {
        return {
          bank_transaction: {
            url: `${BASE}/v2/bank_transactions/1`,
            amount: "100.00",
            unexplained_amount: "100.00",
            dated_on: "2026-02-01",
            bank_account: `${BASE}/v2/bank_accounts/9`,
          },
        };
      }
      if (path.includes("invoices")) {
        return { invoice: { url: `${BASE}/v2/invoices/3`, due_value: "100.00", currency: "GBP" } };
      }
      return { bank_account: { currency: "GBP" } };
    });
    const client = await connect(server);

    const result = await client.callTool({
      name: "reconcile_bank_transaction",
      arguments: { bankTransaction: "1", paidInvoice: "3" },
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      "POST",
      "/v2/bank_transaction_explanations",
      expect.objectContaining({
        bank_transaction_explanation: expect.objectContaining({
          paid_invoice: `${BASE}/v2/invoices/3`,
          gross_value: "100.00",
        }),
      }),
    );
    expect(JSON.stringify(result.content)).toContain("Test Co");
  });

  it("refuses with a readable error and writes nothing when a check fails", async () => {
    const { server, write } = setup(false, (path) =>
      path.includes("bank_transactions")
        ? {
            bank_transaction: {
              url: `${BASE}/v2/bank_transactions/1`,
              amount: "100.00",
              unexplained_amount: "0.0",
              dated_on: "2026-02-01",
              bank_account: `${BASE}/v2/bank_accounts/9`,
            },
          }
        : { bank_account: { currency: "GBP" } },
    );
    const client = await connect(server);

    const result = await client.callTool({
      name: "reconcile_bank_transaction",
      arguments: { bankTransaction: "1", category: "285" },
    });

    expect(result.isError).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects a foreign-host reference before any request", async () => {
    const { server, write } = setup(true);
    const client = await connect(server);

    const result = await client.callTool({
      name: "delete_invoice",
      arguments: { invoice: "https://evil.test/v2/invoices/1" },
    });

    expect(result.isError).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
});
