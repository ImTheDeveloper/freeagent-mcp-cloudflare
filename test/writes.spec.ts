import { afterEach, describe, expect, it, vi } from "vitest";
import { areDeletesEnabled, areWritesEnabled } from "../src/env";
import { freeAgentWrite } from "../src/freeagent/api";
import {
  buildCreateContactBody,
  buildCreateInvoiceBody,
  planReconcile,
  resolveResourceUrl,
} from "../src/freeagent/writes";

const BASE = "https://api.example.test";
const env = { FREEAGENT_API_BASE_URL: BASE, FREEAGENT_USER_AGENT: "test/0" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("write flags", () => {
  it("only treats the exact string true as enabled", () => {
    expect(areWritesEnabled({})).toBe(false);
    expect(areWritesEnabled({ FREEAGENT_ENABLE_WRITES: "TRUE" })).toBe(false);
    expect(areWritesEnabled({ FREEAGENT_ENABLE_WRITES: "true" })).toBe(true);
  });

  it("requires writes as well as the delete flag", () => {
    expect(areDeletesEnabled({ FREEAGENT_ENABLE_DELETES: "true" })).toBe(false);
    expect(areDeletesEnabled({ FREEAGENT_ENABLE_WRITES: "true" })).toBe(false);
    expect(
      areDeletesEnabled({ FREEAGENT_ENABLE_WRITES: "true", FREEAGENT_ENABLE_DELETES: "true" }),
    ).toBe(true);
  });
});

describe("resolveResourceUrl", () => {
  it("expands bare ids onto the configured host", () => {
    expect(resolveResourceUrl("invoices", "42", BASE)).toBe(`${BASE}/v2/invoices/42`);
  });

  it("accepts matching URLs and rejects other hosts or resources", () => {
    expect(resolveResourceUrl("invoices", `${BASE}/v2/invoices/7`, BASE)).toBe(`${BASE}/v2/invoices/7`);
    expect(() => resolveResourceUrl("invoices", "https://evil.test/v2/invoices/7", BASE)).toThrow();
    expect(() => resolveResourceUrl("invoices", `${BASE}/v2/bills/7`, BASE)).toThrow();
    expect(() => resolveResourceUrl("invoices", "../x", BASE)).toThrow();
    expect(() =>
      resolveResourceUrl("invoices", `${BASE}/v2/invoices/1/../../contacts/5`, BASE),
    ).toThrow();
    expect(() => resolveResourceUrl("invoices", `${BASE}/v2/invoices/%2e%2e/x`, BASE)).toThrow();
    expect(() => resolveResourceUrl("invoices", `${BASE}/v2/invoices/1?x=1`, BASE)).toThrow();
  });
});

describe("request bodies", () => {
  it("builds a draft invoice body with string money and a contact URL", () => {
    const body = buildCreateInvoiceBody(
      {
        contact: "5",
        datedOn: "2026-01-31",
        paymentTermsInDays: 30,
        items: [{ description: "Work", price: 100, quantity: 2, salesTaxRate: 20 }],
      },
      BASE,
    );

    expect(body.invoice.contact).toBe(`${BASE}/v2/contacts/5`);
    expect(body.invoice.invoice_items[0]).toMatchObject({
      description: "Work",
      price: "100.00",
      quantity: "2",
      sales_tax_rate: "20",
    });
    expect(body.invoice).not.toHaveProperty("status");
  });

  it("requires a contact name", () => {
    expect(() => buildCreateContactBody({ email: "a@example.test" })).toThrow();
    expect(buildCreateContactBody({ organisationName: "Acme" }).contact.organisation_name).toBe("Acme");
  });
});

const moneyIn = {
  url: `${BASE}/v2/bank_transactions/1`,
  amount: "120.00",
  unexplained_amount: "120.00",
  dated_on: "2026-02-01",
  bank_account: `${BASE}/v2/bank_accounts/9`,
};
const moneyOut = { ...moneyIn, amount: "-50.00", unexplained_amount: "-50.00" };
const invoice = { url: `${BASE}/v2/invoices/3`, due_value: "100.00", currency: "GBP" };
const bill = { url: `${BASE}/v2/bills/4`, due_value: "80.00", currency: "GBP" };

describe("planReconcile", () => {
  it("matches an invoice for the smaller of unexplained and due", () => {
    const plan = planReconcile({ transaction: moneyIn, invoice, bankCurrency: "GBP", baseUrl: BASE });
    expect(plan).toMatchObject({ ok: true, amount: "100.00", remainingUnexplained: "20.00" });
    if (plan.ok) {
      expect(plan.body.bank_transaction_explanation).toMatchObject({
        paid_invoice: invoice.url,
        gross_value: "100.00",
        bank_transaction: moneyIn.url,
        dated_on: "2026-02-01",
      });
    }
  });

  it("signs money-out bill payments negative", () => {
    const plan = planReconcile({ transaction: moneyOut, bill, bankCurrency: "GBP", baseUrl: BASE });
    expect(plan).toMatchObject({ ok: true, amount: "-50.00", remainingUnexplained: "0.00" });
  });

  it("builds category matches with a resolved category URL", () => {
    const plan = planReconcile({ transaction: moneyOut, category: "285", baseUrl: BASE });
    expect(plan.ok && plan.body.bank_transaction_explanation.category).toBe(`${BASE}/v2/categories/285`);
  });

  it("rejects the wrong direction, over-explaining and already-explained", () => {
    expect(planReconcile({ transaction: moneyOut, invoice, baseUrl: BASE })).toMatchObject({ ok: false });
    expect(planReconcile({ transaction: moneyIn, bill, baseUrl: BASE })).toMatchObject({ ok: false });
    expect(
      planReconcile({ transaction: moneyIn, invoice, grossValue: 500, baseUrl: BASE }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("exceeds") });
    expect(
      planReconcile({ transaction: { ...moneyIn, unexplained_amount: "0.0" }, invoice, baseUrl: BASE }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("already") });
  });

  it("never overpays or guesses when the amount due is unknown", () => {
    expect(
      planReconcile({ transaction: moneyIn, invoice, grossValue: 110, baseUrl: BASE }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("still due") });
    expect(
      planReconcile({ transaction: moneyIn, invoice: { url: invoice.url }, baseUrl: BASE }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("still due") });
    expect(
      planReconcile({ transaction: moneyIn, invoice: { ...invoice, due_value: "0.0" }, baseUrl: BASE }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("already paid") });
  });

  it("needs exactly one target and rejects foreign currency", () => {
    expect(planReconcile({ transaction: moneyIn, baseUrl: BASE })).toMatchObject({ ok: false });
    expect(
      planReconcile({ transaction: moneyIn, invoice, category: "285", baseUrl: BASE }),
    ).toMatchObject({ ok: false });
    expect(
      planReconcile({
        transaction: moneyIn,
        invoice: { ...invoice, currency: "EUR" },
        bankCurrency: "GBP",
        baseUrl: BASE,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Foreign-currency") });
  });
});

describe("freeAgentWrite", () => {
  it("sends a JSON body with the right method and subdomain", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 201, headers: { Location: "loc" } }));

    const result = await freeAgentWrite("POST", "/v2/contacts", "tok", env, {
      subdomain: "client-a",
      body: { contact: { organisation_name: "Acme" } },
    });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v2/contacts`);
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
    expect((init.headers as Headers).get("X-Subdomain")).toBe("client-a");
    expect(init.body).toBe(JSON.stringify({ contact: { organisation_name: "Acme" } }));
    expect(result.location).toBe("loc");
  });

  it("tolerates empty bodies and never retries a failed write", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await expect(freeAgentWrite("DELETE", "/v2/invoices/1", "tok", env)).resolves.toMatchObject({
      payload: {},
    });

    spy.mockReset();
    spy.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(freeAgentWrite("POST", "/v2/invoices", "tok", env, { body: {} })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
