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
