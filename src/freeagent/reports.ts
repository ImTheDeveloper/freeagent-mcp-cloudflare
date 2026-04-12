import { buildPathWithQuery } from "./shared";
import type { SessionState } from "../types";

export function buildBalanceSheetPath(options?: { asAtDate?: string }): string {
  return buildPathWithQuery("/v2/accounting/balance_sheet", {
    as_at_date: options?.asAtDate,
  });
}

export function buildProfitAndLossSummaryPath(options?: {
  fromDate?: string;
  toDate?: string;
  accountingPeriod?: string;
}): string {
  return buildPathWithQuery("/v2/accounting/profit_and_loss/summary", {
    from_date: options?.fromDate,
    to_date: options?.toDate,
    accounting_period: options?.accountingPeriod,
  });
}

export function buildTrialBalanceSummaryPath(options?: {
  fromDate?: string;
  toDate?: string;
}): string {
  return buildPathWithQuery("/v2/accounting/trial_balance/summary", {
    from_date: options?.fromDate,
    to_date: options?.toDate,
  });
}

export function buildCashflowPath(options: { fromDate: string; toDate: string }): string {
  return buildPathWithQuery("/v2/cashflow", {
    from_date: options.fromDate,
    to_date: options.toDate,
  });
}

export function buildVatReturnPath(periodEndsOn: string): string {
  return `/v2/vat_returns/${encodeURIComponent(periodEndsOn)}`;
}

export function buildFinalAccountsReportPath(periodEndsOn: string): string {
  return `/v2/final_accounts_reports/${encodeURIComponent(periodEndsOn)}`;
}

export function buildRequestScope(state: Pick<SessionState, "mode" | "activeSubdomain">): {
  subdomain?: string;
} {
  if (state.mode === "practice" && state.activeSubdomain) {
    return { subdomain: state.activeSubdomain };
  }

  return {};
}
