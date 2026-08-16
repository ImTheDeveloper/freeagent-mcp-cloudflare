import { describe, expect, it } from "vitest";
import {
  buildBankTransactionsPath,
  buildBillsPath,
  buildCapitalAssetPath,
  buildCapitalAssetsPath,
  buildCreditNotesPath,
  buildEstimatesPath,
  buildExpensesPath,
  buildInvoicePath,
  buildInvoiceTimelinePath,
  buildInvoicesPath,
  buildRecurringInvoicesPath,
  buildTransactionPath,
  buildTransactionsPath,
  bankAccountIdFromUrl,
  extractBankAccountIdFromNominalCode,
  filterRowsByDateRange,
  resolveDirectBankAccountRef,
} from "../src/freeagent/resources";

describe("freeagent operational resource helpers", () => {
  it("builds invoice-style list and detail paths", () => {
    expect(
      buildInvoicesPath({
        page: 2,
        perPage: 50,
        view: "open",
        sort: "-updated_at",
        updatedSince: "2026-04-01T12:00:00.000Z",
        includeItems: true,
      }),
    ).toBe(
      "/v2/invoices?page=2&per_page=50&view=open&sort=-updated_at&updated_since=2026-04-01T12%3A00%3A00.000Z&nested_invoice_items=true",
    );
    expect(buildInvoicePath("123")).toBe("/v2/invoices/123");
    expect(buildInvoiceTimelinePath()).toBe("/v2/invoices/timeline");
    expect(buildCreditNotesPath({ includeItems: true, view: "draft" })).toBe(
      "/v2/credit_notes?view=draft&nested_credit_note_items=true",
    );
  });

  it("never sends a date filter FreeAgent does not support on invoices", () => {
    // /v2/invoices has no from_date/to_date. Sending them risks a 400 or, worse,
    // an unfiltered result that looks filtered, so they must not appear here.
    const path = buildInvoicesPath({ sort: "-created_at" });
    expect(path).toBe("/v2/invoices?sort=-created_at");
    expect(path).not.toContain("from_date");
    expect(path).not.toContain("to_date");

    expect(
      buildInvoicesPath({
        contact: "https://api.freeagent.com/v2/contacts/7",
        project: "https://api.freeagent.com/v2/projects/2",
      }),
    ).toBe(
      "/v2/invoices?contact=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fcontacts%2F7&project=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fprojects%2F2",
    );
  });

  it("resolves bank account references that need no lookup", () => {
    const base = "https://api.freeagent.com";

    expect(resolveDirectBankAccountRef("https://api.freeagent.com/v2/bank_accounts/1", base)).toBe(
      "https://api.freeagent.com/v2/bank_accounts/1",
    );
    // A bare id is the case that used to 404, because the filter needs a full URL.
    expect(resolveDirectBankAccountRef("123", base)).toBe(
      "https://api.freeagent.com/v2/bank_accounts/123",
    );
    expect(resolveDirectBankAccountRef(" 123 ", base)).toBe(
      "https://api.freeagent.com/v2/bank_accounts/123",
    );
    expect(resolveDirectBankAccountRef("123", "https://api.freeagent.com/")).toBe(
      "https://api.freeagent.com/v2/bank_accounts/123",
    );
    // Nominal codes and names need the account list, so they defer to a lookup.
    expect(resolveDirectBankAccountRef("750-1", base)).toBeNull();
    expect(resolveDirectBankAccountRef("Business Current", base)).toBeNull();
  });

  it("maps a bank nominal code onto the account id the API uses", () => {
    // The trial balance reports a bank account as 750-<id>, while the
    // bank_accounts resource exposes no nominal_code field at all.
    expect(extractBankAccountIdFromNominalCode("750-123456")).toBe("123456");
    expect(extractBankAccountIdFromNominalCode(" 750-123456 ")).toBe("123456");
    // A display code such as 750-1 parses, but no account will carry id 1,
    // so the caller gets the account list back instead of a bare 404.
    expect(extractBankAccountIdFromNominalCode("750-1")).toBe("1");
    expect(extractBankAccountIdFromNominalCode("123456")).toBeNull();
    expect(extractBankAccountIdFromNominalCode("Current Account")).toBeNull();
    expect(extractBankAccountIdFromNominalCode("750-abc")).toBeNull();
  });

  it("filters rows by dated_on for endpoints with no server-side date filter", () => {
    const rows = [
      { dated_on: "2021-06-01" },
      { dated_on: "2025-07-01" },
      { dated_on: "2026-01-15" },
      { dated_on: "2026-12-31" },
    ];

    // Bounds are inclusive on both ends.
    expect(filterRowsByDateRange(rows, "2025-07-01", "2026-01-15")).toEqual([
      { dated_on: "2025-07-01" },
      { dated_on: "2026-01-15" },
    ]);
    // Open-ended ranges only apply the bound that was given.
    expect(filterRowsByDateRange(rows, "2025-04-01", undefined)).toHaveLength(3);
    expect(filterRowsByDateRange(rows, undefined, "2026-03-31")).toHaveLength(3);
    // No range requested returns the rows untouched.
    expect(filterRowsByDateRange(rows)).toBe(rows);
    // A row with no date cannot be shown to belong in the window.
    expect(filterRowsByDateRange([{}], "2025-04-01", "2026-03-31")).toEqual([]);
  });

  it("extracts the account id from a bank account resource URL", () => {
    expect(bankAccountIdFromUrl("https://api.freeagent.com/v2/bank_accounts/123456")).toBe("123456");
    expect(bankAccountIdFromUrl("https://api.freeagent.com/v2/bank_accounts/123456?x=1")).toBe(
      "123456",
    );
    expect(bankAccountIdFromUrl("https://api.freeagent.com/v2/invoices/1")).toBeNull();
  });

  it("builds estimates, bills, expenses, recurring invoices, and transactions paths", () => {
    expect(
      buildEstimatesPath({
        page: 3,
        perPage: 20,
        view: "recent",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        updatedSince: "2026-02-01T00:00:00.000Z",
        includeItems: true,
      }),
    ).toBe(
      "/v2/estimates?page=3&per_page=20&view=recent&from_date=2026-01-01&to_date=2026-01-31&updated_since=2026-02-01T00%3A00%3A00.000Z&nested_estimate_items=true",
    );
    expect(buildBillsPath({ view: "open", includeItems: true })).toBe(
      "/v2/bills?view=open&nested_bill_items=true",
    );
    expect(buildExpensesPath({ project: "https://api.freeagent.com/v2/projects/2" })).toBe(
      "/v2/expenses?project=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fprojects%2F2",
    );
    expect(buildRecurringInvoicesPath({ page: 1, perPage: 100, view: "active" })).toBe(
      "/v2/recurring_invoices?page=1&per_page=100&view=active",
    );
    expect(buildTransactionsPath({ fromDate: "2026-01-01", toDate: "2026-03-31", nominalCode: "750-1" })).toBe(
      "/v2/accounting/transactions?from_date=2026-01-01&to_date=2026-03-31&nominal_code=750-1",
    );
    expect(buildTransactionPath("abc")).toBe("/v2/accounting/transactions/abc");
  });

  it("builds bank transaction and capital asset paths with special filters", () => {
    expect(
      buildBankTransactionsPath({
        bankAccount: "https://api.freeagent.com/v2/bank_accounts/1",
        page: 2,
        perPage: 25,
        view: "unexplained",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        updatedSince: "2026-02-01T00:00:00.000Z",
        lastUploaded: true,
      }),
    ).toBe(
      "/v2/bank_transactions?page=2&per_page=25&bank_account=https%3A%2F%2Fapi.freeagent.com%2Fv2%2Fbank_accounts%2F1&view=unexplained&from_date=2026-01-01&to_date=2026-01-31&updated_since=2026-02-01T00%3A00%3A00.000Z&last_uploaded=true",
    );
    expect(buildCapitalAssetsPath({ view: "disposed", includeHistory: true })).toBe(
      "/v2/capital_assets?view=disposed&include_history=true",
    );
    expect(buildCapitalAssetPath("42", { includeHistory: true })).toBe(
      "/v2/capital_assets/42?include_history=true",
    );
  });
});
