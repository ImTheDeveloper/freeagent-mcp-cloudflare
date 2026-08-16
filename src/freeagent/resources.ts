import { buildPathWithQuery } from "./shared";

interface PaginatedQueryOptions {
  page?: number;
  perPage?: number;
}

interface DateQueryOptions {
  fromDate?: string;
  toDate?: string;
  updatedSince?: string;
}

interface SortQueryOptions {
  sort?: string;
}

function buildResourceIdPath(basePath: string, id: string): string {
  return `${basePath}/${encodeURIComponent(id)}`;
}

export function buildInvoicesPath(
  options?: PaginatedQueryOptions &
    DateQueryOptions &
    SortQueryOptions & {
      view?: string;
      includeItems?: boolean;
      contact?: string;
      project?: string;
    },
): string {
  return buildPathWithQuery("/v2/invoices", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    sort: options?.sort,
    from_date: options?.fromDate,
    to_date: options?.toDate,
    updated_since: options?.updatedSince,
    contact: options?.contact,
    project: options?.project,
    nested_invoice_items: options?.includeItems ? true : undefined,
  });
}

export function buildInvoicePath(id: string): string {
  return buildResourceIdPath("/v2/invoices", id);
}

export function buildInvoiceTimelinePath(): string {
  return "/v2/invoices/timeline";
}

export function buildCreditNotesPath(
  options?: PaginatedQueryOptions &
    SortQueryOptions & {
      view?: string;
      updatedSince?: string;
      includeItems?: boolean;
    },
): string {
  return buildPathWithQuery("/v2/credit_notes", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    sort: options?.sort,
    updated_since: options?.updatedSince,
    nested_credit_note_items: options?.includeItems ? true : undefined,
  });
}

export function buildCreditNotePath(id: string): string {
  return buildResourceIdPath("/v2/credit_notes", id);
}

export function buildEstimatesPath(
  options?: PaginatedQueryOptions &
    DateQueryOptions & {
      view?: string;
      includeItems?: boolean;
    },
): string {
  return buildPathWithQuery("/v2/estimates", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    from_date: options?.fromDate,
    to_date: options?.toDate,
    updated_since: options?.updatedSince,
    nested_estimate_items: options?.includeItems ? true : undefined,
  });
}

export function buildEstimatePath(id: string): string {
  return buildResourceIdPath("/v2/estimates", id);
}

export function buildRecurringInvoicesPath(
  options?: PaginatedQueryOptions & {
    view?: string;
  },
): string {
  return buildPathWithQuery("/v2/recurring_invoices", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
  });
}

export function buildRecurringInvoicePath(id: string): string {
  return buildResourceIdPath("/v2/recurring_invoices", id);
}

export function buildBillsPath(
  options?: PaginatedQueryOptions &
    DateQueryOptions & {
      view?: string;
      includeItems?: boolean;
    },
): string {
  return buildPathWithQuery("/v2/bills", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    from_date: options?.fromDate,
    to_date: options?.toDate,
    updated_since: options?.updatedSince,
    nested_bill_items: options?.includeItems ? true : undefined,
  });
}

export function buildBillPath(id: string): string {
  return buildResourceIdPath("/v2/bills", id);
}

export function buildExpensesPath(
  options?: PaginatedQueryOptions &
    DateQueryOptions & {
      view?: string;
      project?: string;
    },
): string {
  return buildPathWithQuery("/v2/expenses", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    from_date: options?.fromDate,
    to_date: options?.toDate,
    updated_since: options?.updatedSince,
    project: options?.project,
  });
}

export function buildExpensePath(id: string): string {
  return buildResourceIdPath("/v2/expenses", id);
}

export function buildBankAccountsPath(
  options?: PaginatedQueryOptions & {
    view?: string;
  },
): string {
  return buildPathWithQuery("/v2/bank_accounts", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
  });
}

export function buildBankAccountPath(id: string): string {
  return buildResourceIdPath("/v2/bank_accounts", id);
}

export function buildBankTransactionsPath(
  options: PaginatedQueryOptions &
    DateQueryOptions & {
      bankAccount: string;
      view?: string;
      lastUploaded?: boolean;
    },
): string {
  return buildPathWithQuery("/v2/bank_transactions", {
    page: options.page,
    per_page: options.perPage,
    bank_account: options.bankAccount,
    view: options.view,
    from_date: options.fromDate,
    to_date: options.toDate,
    updated_since: options.updatedSince,
    last_uploaded: options.lastUploaded ? true : undefined,
  });
}

/**
 * Resolves a bank account reference that needs no API lookup.
 *
 * FreeAgent's `bank_account` filter only accepts a full resource URL, so a bare
 * id is expanded here. Returns null when the reference is a nominal code or
 * name and has to be matched against the account list instead.
 */
export function resolveDirectBankAccountRef(ref: string, apiBaseUrl: string): string | null {
  const trimmed = ref.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^\d+$/.test(trimmed)) {
    return `${apiBaseUrl.replace(/\/+$/, "")}/v2/bank_accounts/${trimmed}`;
  }

  return null;
}

/**
 * Extracts the bank account id from a bank nominal code.
 *
 * FreeAgent reports bank accounts in the trial balance as `750-<account id>`,
 * e.g. `750-123456`. The bank_accounts resource carries no nominal_code field,
 * so this suffix is the only link between the two representations.
 */
export function extractBankAccountIdFromNominalCode(ref: string): string | null {
  return ref.trim().match(/^\d{3,4}-(\d+)$/)?.[1] ?? null;
}

/** Pulls the numeric id out of a bank account resource URL. */
export function bankAccountIdFromUrl(url: string): string | null {
  return url.match(/\/bank_accounts\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
}

export function buildBankTransactionPath(id: string): string {
  return buildResourceIdPath("/v2/bank_transactions", id);
}

export function buildTransactionsPath(
  options?: PaginatedQueryOptions & {
    fromDate?: string;
    toDate?: string;
    nominalCode?: string;
  },
): string {
  return buildPathWithQuery("/v2/accounting/transactions", {
    page: options?.page,
    per_page: options?.perPage,
    from_date: options?.fromDate,
    to_date: options?.toDate,
    nominal_code: options?.nominalCode,
  });
}

export function buildTransactionPath(id: string): string {
  return buildResourceIdPath("/v2/accounting/transactions", id);
}

export function buildCapitalAssetsPath(
  options?: PaginatedQueryOptions & {
    view?: string;
    includeHistory?: boolean;
  },
): string {
  return buildPathWithQuery("/v2/capital_assets", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    include_history: options?.includeHistory ? true : undefined,
  });
}

export function buildCapitalAssetPath(id: string, options?: { includeHistory?: boolean }): string {
  return buildPathWithQuery(buildResourceIdPath("/v2/capital_assets", id), {
    include_history: options?.includeHistory ? true : undefined,
  });
}

export function buildContactsPath(
  options?: PaginatedQueryOptions &
    SortQueryOptions & {
      view?: string;
      updatedSince?: string;
    },
): string {
  return buildPathWithQuery("/v2/contacts", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    sort: options?.sort,
    updated_since: options?.updatedSince,
  });
}

export function buildContactPath(id: string): string {
  return buildResourceIdPath("/v2/contacts", id);
}

export function buildProjectsPath(
  options?: PaginatedQueryOptions &
    SortQueryOptions & {
      view?: string;
      nested?: boolean;
      contact?: string;
    },
): string {
  return buildPathWithQuery("/v2/projects", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    sort: options?.sort,
    nested: options?.nested ? true : undefined,
    contact: options?.contact,
  });
}

export function buildProjectPath(id: string): string {
  return buildResourceIdPath("/v2/projects", id);
}

export function buildTasksPath(
  options?: PaginatedQueryOptions &
    SortQueryOptions & {
      view?: string;
      updatedSince?: string;
      project?: string;
    },
): string {
  return buildPathWithQuery("/v2/tasks", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
    sort: options?.sort,
    updated_since: options?.updatedSince,
    project: options?.project,
  });
}

export function buildTaskPath(id: string): string {
  return buildResourceIdPath("/v2/tasks", id);
}

export function buildTimeslipsPath(
  options?: PaginatedQueryOptions &
    DateQueryOptions & {
      view?: string;
      nested?: boolean;
      user?: string;
      task?: string;
      project?: string;
    },
): string {
  return buildPathWithQuery("/v2/timeslips", {
    page: options?.page,
    per_page: options?.perPage,
    from_date: options?.fromDate,
    to_date: options?.toDate,
    updated_since: options?.updatedSince,
    view: options?.view,
    nested: options?.nested ? true : undefined,
    user: options?.user,
    task: options?.task,
    project: options?.project,
  });
}

export function buildTimeslipPath(id: string): string {
  return buildResourceIdPath("/v2/timeslips", id);
}

export function buildUsersPath(
  options?: PaginatedQueryOptions & {
    view?: string;
  },
): string {
  return buildPathWithQuery("/v2/users", {
    page: options?.page,
    per_page: options?.perPage,
    view: options?.view,
  });
}

export function buildUserPath(id: string): string {
  return buildResourceIdPath("/v2/users", id);
}

export function buildCategoriesPath(options?: { subAccounts?: boolean }): string {
  return buildPathWithQuery("/v2/categories", {
    sub_accounts: options?.subAccounts ? true : undefined,
  });
}

export function buildCategoryPath(nominalCode: string): string {
  return buildResourceIdPath("/v2/categories", nominalCode);
}

export function buildPriceListItemsPath(
  options?: PaginatedQueryOptions &
    SortQueryOptions,
): string {
  return buildPathWithQuery("/v2/price_list_items", {
    page: options?.page,
    per_page: options?.perPage,
    sort: options?.sort,
  });
}

export function buildPriceListItemPath(id: string): string {
  return buildResourceIdPath("/v2/price_list_items", id);
}
