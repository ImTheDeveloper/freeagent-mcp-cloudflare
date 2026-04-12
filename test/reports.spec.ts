import { describe, expect, it } from "vitest";
import {
  buildBalanceSheetPath,
  buildCashflowPath,
  buildFinalAccountsReportPath,
  buildProfitAndLossSummaryPath,
  buildRequestScope,
  buildTrialBalanceSummaryPath,
  buildVatReturnPath,
} from "../src/freeagent/reports";

describe("freeagent report helpers", () => {
  it("builds balance sheet paths with optional dates", () => {
    expect(buildBalanceSheetPath()).toBe("/v2/accounting/balance_sheet");
    expect(buildBalanceSheetPath({ asAtDate: "2026-03-31" })).toBe(
      "/v2/accounting/balance_sheet?as_at_date=2026-03-31",
    );
  });

  it("builds profit and loss summary paths with supported filters", () => {
    expect(
      buildProfitAndLossSummaryPath({
        fromDate: "2026-01-01",
        toDate: "2026-03-31",
        accountingPeriod: "2025/26",
      }),
    ).toBe(
      "/v2/accounting/profit_and_loss/summary?from_date=2026-01-01&to_date=2026-03-31&accounting_period=2025%2F26",
    );
  });

  it("builds trial balance, cashflow, vat, and final accounts paths", () => {
    expect(buildTrialBalanceSummaryPath({ fromDate: "2026-01-01", toDate: "2026-03-31" })).toBe(
      "/v2/accounting/trial_balance/summary?from_date=2026-01-01&to_date=2026-03-31",
    );
    expect(buildCashflowPath({ fromDate: "2026-01-01", toDate: "2026-03-31" })).toBe(
      "/v2/cashflow?from_date=2026-01-01&to_date=2026-03-31",
    );
    expect(buildVatReturnPath("2026-03-31")).toBe("/v2/vat_returns/2026-03-31");
    expect(buildFinalAccountsReportPath("2026-12-31")).toBe(
      "/v2/final_accounts_reports/2026-12-31",
    );
  });

  it("only adds subdomain routing in practice mode", () => {
    expect(buildRequestScope({ mode: "company", activeSubdomain: "alpha" })).toEqual({});
    expect(buildRequestScope({ mode: "practice", activeSubdomain: null })).toEqual({});
    expect(buildRequestScope({ mode: "practice", activeSubdomain: "alpha" })).toEqual({
      subdomain: "alpha",
    });
  });
});
