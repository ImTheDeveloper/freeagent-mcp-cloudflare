import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent, getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { getFreeAgentApiBaseUrl, getFreeAgentMode, type AppEnv } from "./env";
import { getPrincipalAuthRecord, patchPrincipalAuthRecord } from "./auth/store";
import { bootstrapAccountContext, switchActiveClientContext } from "./freeagent/context";
import {
  buildTruncationNotice,
  countCollectionItems,
  freeAgentGet,
  freeAgentGetAllPages,
  freeAgentGetDetailed,
} from "./freeagent/api";
import { formatFreeAgentErrorMessage } from "./freeagent/errors";
import {
  buildBalanceSheetPath,
  buildCashflowPath,
  buildFinalAccountsReportPath,
  buildProfitAndLossSummaryPath,
  buildRequestScope,
  buildTrialBalanceSummaryPath,
  buildVatReturnPath,
} from "./freeagent/reports";
import {
  buildBankAccountPath,
  buildBankAccountsPath,
  buildBankTransactionPath,
  buildBankTransactionsPath,
  buildBillPath,
  buildBillsPath,
  buildCapitalAssetPath,
  buildCapitalAssetsPath,
  buildCategoryPath,
  buildCategoriesPath,
  buildContactPath,
  buildContactsPath,
  buildCreditNotePath,
  buildCreditNotesPath,
  buildEstimatePath,
  buildEstimatesPath,
  buildExpensePath,
  buildExpensesPath,
  buildInvoicePath,
  buildInvoiceTimelinePath,
  buildInvoicesPath,
  buildPriceListItemPath,
  buildPriceListItemsPath,
  buildProjectPath,
  buildProjectsPath,
  buildRecurringInvoicePath,
  buildRecurringInvoicesPath,
  bankAccountIdFromUrl,
  extractBankAccountIdFromNominalCode,
  findRowsOutsideDateRange,
  resolveDirectBankAccountRef,
  buildTaskPath,
  buildTasksPath,
  buildTransactionPath,
  buildTransactionsPath,
  buildTimeslipPath,
  buildTimeslipsPath,
  buildUserPath,
  buildUsersPath,
} from "./freeagent/resources";
import { ensureValidAccessToken } from "./freeagent/token";
import {
  registerOptionalTool,
  type OptionalArgsShape,
  type TextToolResponse,
} from "./mcp/register-tools";
import { DEFAULT_SESSION_STATE, type SessionState } from "./types";

const SESSION_INACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const pageParam = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("1-based page number. Defaults to 1.");
const perPageParam = z
  .number()
  .int()
  .positive()
  .max(100)
  .optional()
  .describe("Records per page, 1-100. Defaults to 25, so pass 100 to reduce paging.");

export class FreeAgentMCP extends McpAgent<any, SessionState> {
  server = new McpServer({
    name: "freeagent-mcp",
    version: "0.1.0",
  });

  initialState = DEFAULT_SESSION_STATE;

  async init(): Promise<void> {
    this.server.tool("hello", async () => ({
      content: [
        {
          type: "text" as const,
          text: "FreeAgent MCP is online in read-only mode.",
        },
      ],
    }));

    this.server.tool("auth_status", async () => {
      await this.prepareSession();
      return this.textResponse(this.buildAuthStatusMessage());
    });

    this.server.tool("get_me", async () => {
      try {
        await this.prepareAuthenticatedContext();
        return this.jsonResponse({
          principalId: this.state.principalId,
          mode: this.state.mode,
          userProfile: this.state.userProfile,
        });
      } catch (cause) {
        return this.textResponse(`Failed to get user profile: ${(cause as Error).message}`);
      }
    });

    this.server.tool("get_company", async () => {
      try {
        await this.prepareAuthenticatedContext();

        if (!this.state.company) {
          return this.textResponse("No company context is available for the current session.");
        }

        return this.jsonResponse(this.state.company);
      } catch (cause) {
        return this.textResponse(`Failed to get company: ${(cause as Error).message}`);
      }
    });

    this.server.tool("get_practice", async () => {
      try {
        await this.prepareAuthenticatedContext();

        if (this.state.mode !== "practice") {
          return this.textResponse("FreeAgent is configured in company mode for this worker.");
        }

        return this.jsonResponse(this.state.practice);
      } catch (cause) {
        return this.textResponse(`Failed to get practice: ${(cause as Error).message}`);
      }
    });

    this.server.tool("list_clients", async () => {
      try {
        await this.prepareAuthenticatedContext();

        if (this.state.mode !== "practice") {
          return this.textResponse("FreeAgent is configured in company mode for this worker.");
        }

        return this.jsonResponse({
          activeSubdomain: this.state.activeSubdomain,
          clients: this.state.clients,
        });
      } catch (cause) {
        return this.textResponse(`Failed to list clients: ${(cause as Error).message}`);
      }
    });

    this.server.tool(
      "switch_client",
      { subdomain: z.string().min(1) },
      async ({ subdomain }) => {
        try {
          const { principalId, accessToken } = await this.prepareAuthenticatedContext();

          if (this.state.mode !== "practice") {
            return this.textResponse("FreeAgent is configured in company mode for this worker.");
          }

          const env = this.getAppEnv();
          const nextContext = await switchActiveClientContext(accessToken, env, this.state.clients, subdomain);
          const nextState: SessionState = {
            ...this.state,
            company: nextContext.company,
            activeSubdomain: nextContext.activeSubdomain,
          };

          this.setState(nextState);
          await patchPrincipalAuthRecord(env, principalId, this.buildAuthRecordPatch(nextState, principalId));

          return this.textResponse(`Active client switched to ${subdomain}.`);
        } catch (cause) {
          return this.textResponse(`Failed to switch client: ${(cause as Error).message}`);
        }
      },
    );

    this.registerOptionalTool(
      "get_balance_sheet",
      { asAtDate: z.string().optional().describe("YYYY-MM-DD. Defaults to today.") },
      async ({ asAtDate }) =>
        this.readOnlyAggregatedToolCall(
          buildBalanceSheetPath({ asAtDate }),
          "Failed to get balance sheet",
        ),
      "Balance sheet as at a date. All rows are fetched and concatenated.",
    );

    this.registerOptionalTool(
      "get_profit_and_loss",
      {
        fromDate: z.string().optional().describe("YYYY-MM-DD."),
        toDate: z.string().optional().describe("YYYY-MM-DD."),
        accountingPeriod: z.string().optional().describe("e.g. 2022/23."),
      },
      async ({ fromDate, toDate, accountingPeriod }) =>
        this.readOnlyAggregatedToolCall(
          buildProfitAndLossSummaryPath({ fromDate, toDate, accountingPeriod }),
          "Failed to get profit and loss summary",
        ),
      "Profit and loss summary. WITH NO DATES IT RETURNS THE CURRENT ACCOUNTING YEAR TO DATE, not a full year — pass fromDate/toDate for a complete period. Ranges must be 12 months or less, or contained within one accounting year. Note the response carries several profit figures: use operating_profit or retained_profit for this period; retained_profit_carried_forward is a cumulative balance, not the period result.",
    );

    this.registerOptionalTool(
      "get_trial_balance_summary",
      {
        fromDate: z.string().optional().describe("YYYY-MM-DD."),
        toDate: z.string().optional().describe("YYYY-MM-DD."),
      },
      async ({ fromDate, toDate }) =>
        this.readOnlyAggregatedToolCall(
          buildTrialBalanceSummaryPath({ fromDate, toDate }),
          "Failed to get trial balance summary",
        ),
      "Full trial balance for the period. Every nominal code is fetched and concatenated, so the result is complete rather than a first page. With no dates it reports as at today. Each row carries both `display_nominal_code` (e.g. 750-1, what the FreeAgent UI shows) and `nominal_code` (e.g. 750-123456, whose suffix is the underlying resource id) — quote display_nominal_code to a human, and use nominal_code when cross-referencing another endpoint.",
    );

    this.server.tool("get_trial_balance_opening_balances", async () =>
      this.readOnlyAggregatedToolCall(
        "/v2/accounting/trial_balance/summary/opening_balances",
        "Failed to get trial balance opening balances",
      ),
    );

    this.server.registerTool(
      "get_cashflow",
      {
        description:
          "Historic cash movement between two dates. It does NOT project: a range in the future returns a total of 0, which means 'not supported', not 'no cash expected'. Incoming and outgoing totals are both positive; balance is incoming minus outgoing.",
        inputSchema: {
          fromDate: z.string().describe("YYYY-MM-DD. Past dates only; future ranges return zero."),
          toDate: z.string().describe("YYYY-MM-DD."),
        },
      },
      async ({ fromDate, toDate }) =>
        this.readOnlyToolCall(
          buildCashflowPath({ fromDate, toDate }),
          "Failed to get cashflow",
        ),
    );

    this.server.tool("list_vat_returns", async () =>
      this.readOnlyToolCall("/v2/vat_returns", "Failed to list VAT returns"),
    );

    this.server.tool(
      "get_vat_return",
      { periodEndsOn: z.string().min(1) },
      async ({ periodEndsOn }) =>
        this.readOnlyToolCall(buildVatReturnPath(periodEndsOn), "Failed to get VAT return"),
    );

    this.server.tool("list_final_accounts_reports", async () =>
      this.readOnlyToolCall(
        "/v2/final_accounts_reports",
        "Failed to list final accounts reports",
      ),
    );

    this.server.registerTool(
      "get_final_accounts_report",
      {
        description:
          "Filing metadata for an accounting period (dates, filing status, filed reference). This FreeAgent resource carries NO financial figures — for prior-year numbers use get_profit_and_loss, get_balance_sheet, or get_trial_balance_summary with the period dates returned here.",
        inputSchema: { periodEndsOn: z.string().min(1).describe("YYYY-MM-DD period end date.") },
      },
      async ({ periodEndsOn }) => this.getFinalAccountsReport(periodEndsOn),
    );

    this.server.registerTool(
      "get_company_tax_timeline",
      {
        description:
          "Upcoming tax dates and amounts. The array mixes company and personal liabilities: filter on `is_personal` before totalling, or a director's self-assessment will be added to the company's bill. `amount_due` is omitted entirely, not zero, when it does not apply.",
        inputSchema: {},
      },
      async () =>
        this.readOnlyToolCall("/v2/company/tax_timeline", "Failed to get company tax timeline"),
    );

    this.registerOptionalTool(
      "list_invoices",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional().describe(
          "all (default), recent_open_or_overdue, open, overdue, open_or_overdue, draft, paid, last_N_months.",
        ),
        sort: z.string().optional().describe(
          "Defaults to -created_at (newest first). Prefix with '-' to reverse. Documented values: created_at, updated_at.",
        ),
        fromDate: z.string().optional().describe(
          "YYYY-MM-DD. Undocumented by FreeAgent; the response reports whether it was actually applied.",
        ),
        toDate: z.string().optional().describe(
          "YYYY-MM-DD. Undocumented by FreeAgent; the response reports whether it was actually applied.",
        ),
        updatedSince: z.string().optional(),
        contact: z.string().optional().describe("Contact resource URL."),
        project: z.string().optional().describe("Project resource URL."),
        includeItems: z.boolean().optional(),
      },
      async ({ page, perPage, view, sort, fromDate, toDate, updatedSince, contact, project, includeItems }) =>
        this.readOnlyListToolCall(
          buildInvoicesPath({
            page,
            perPage,
            view,
            sort: sort ?? "-created_at",
            fromDate,
            toDate,
            updatedSince,
            contact,
            project,
            includeItems,
          }),
          "Failed to list invoices",
          (payload) => {
            const rows = (payload.invoices ?? []) as Array<{ dated_on?: string }>;
            const outside = findRowsOutsideDateRange(rows, fromDate, toDate);

            if (outside === 0) {
              return {};
            }

            return {
              dateFilterWarning:
                `UNFILTERED RESULT: ${outside} of ${rows.length} invoices fall outside ` +
                `${fromDate ?? "any start"}..${toDate ?? "any end"}. FreeAgent ignored the date filter ` +
                "on this endpoint, so these results are NOT date-filtered. Filter by `dated_on` yourself, " +
                "and page through every result first — the unfiltered set is larger than one page.",
            };
          },
        ),
      "Lists invoices, newest first by default. Paginated: check the `truncation` field in the response and page through it before drawing conclusions.",
    );

    this.server.tool(
      "get_invoice",
      { invoiceId: z.string().min(1) },
      async ({ invoiceId }) =>
        this.readOnlyToolCall(buildInvoicePath(invoiceId), "Failed to get invoice"),
    );

    this.server.tool("get_invoice_timeline", async () =>
      this.readOnlyToolCall(buildInvoiceTimelinePath(), "Failed to get invoice timeline"),
    );

    this.registerOptionalTool(
      "list_credit_notes",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        sort: z.string().optional(),
        updatedSince: z.string().optional(),
        includeItems: z.boolean().optional(),
      },
      async ({ page, perPage, view, sort, updatedSince, includeItems }) =>
        this.readOnlyListToolCall(
          buildCreditNotesPath({ page, perPage, view, sort, updatedSince, includeItems }),
          "Failed to list credit notes",
        ),
    );

    this.server.tool(
      "get_credit_note",
      { creditNoteId: z.string().min(1) },
      async ({ creditNoteId }) =>
        this.readOnlyToolCall(buildCreditNotePath(creditNoteId), "Failed to get credit note"),
    );

    this.registerOptionalTool(
      "list_estimates",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        updatedSince: z.string().optional(),
        includeItems: z.boolean().optional(),
      },
      async ({ page, perPage, view, fromDate, toDate, updatedSince, includeItems }) =>
        this.readOnlyListToolCall(
          buildEstimatesPath({ page, perPage, view, fromDate, toDate, updatedSince, includeItems }),
          "Failed to list estimates",
        ),
    );

    this.server.tool(
      "get_estimate",
      { estimateId: z.string().min(1) },
      async ({ estimateId }) =>
        this.readOnlyToolCall(buildEstimatePath(estimateId), "Failed to get estimate"),
    );

    this.registerOptionalTool(
      "list_recurring_invoices",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
      },
      async ({ page, perPage, view }) =>
        this.readOnlyListToolCall(
          buildRecurringInvoicesPath({ page, perPage, view }),
          "Failed to list recurring invoices",
        ),
    );

    this.server.tool(
      "get_recurring_invoice",
      { recurringInvoiceId: z.string().min(1) },
      async ({ recurringInvoiceId }) =>
        this.readOnlyToolCall(
          buildRecurringInvoicePath(recurringInvoiceId),
          "Failed to get recurring invoice",
        ),
    );

    this.registerOptionalTool(
      "list_bills",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        updatedSince: z.string().optional(),
        includeItems: z.boolean().optional(),
      },
      async ({ page, perPage, view, fromDate, toDate, updatedSince, includeItems }) =>
        this.readOnlyListToolCall(
          buildBillsPath({ page, perPage, view, fromDate, toDate, updatedSince, includeItems }),
          "Failed to list bills",
        ),
    );

    this.server.tool(
      "get_bill",
      { billId: z.string().min(1) },
      async ({ billId }) =>
        this.readOnlyToolCall(buildBillPath(billId), "Failed to get bill"),
    );

    this.registerOptionalTool(
      "list_expenses",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        updatedSince: z.string().optional(),
        project: z.string().optional(),
      },
      async ({ page, perPage, view, fromDate, toDate, updatedSince, project }) =>
        this.readOnlyListToolCall(
          buildExpensesPath({ page, perPage, view, fromDate, toDate, updatedSince, project }),
          "Failed to list expenses",
        ),
    );

    this.server.tool(
      "get_expense",
      { expenseId: z.string().min(1) },
      async ({ expenseId }) =>
        this.readOnlyToolCall(buildExpensePath(expenseId), "Failed to get expense"),
    );

    this.registerOptionalTool(
      "list_bank_accounts",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
      },
      async ({ page, perPage, view }) =>
        this.readOnlyListToolCall(
          buildBankAccountsPath({ page, perPage, view }),
          "Failed to list bank accounts",
        ),
    );

    this.server.tool(
      "get_bank_account",
      { bankAccountId: z.string().min(1) },
      async ({ bankAccountId }) =>
        this.readOnlyToolCall(
          buildBankAccountPath(bankAccountId),
          "Failed to get bank account",
        ),
    );

    this.server.registerTool(
      "list_bank_transactions",
      {
        description:
          "Lists transactions for one bank account. `bankAccount` accepts a resource URL, a bare numeric id, a nominal code, or an account name.",
        inputSchema: {
          page: pageParam,
          perPage: perPageParam,
          bankAccount: z.string().min(1).describe(
            "Resource URL, bare numeric id, nominal code (e.g. 750-1), or account name. Resolved automatically.",
          ),
          view: z.string().optional().describe(
            "all, unexplained, explained, manual, imported, marked_for_review.",
          ),
          fromDate: z.string().optional().describe("YYYY-MM-DD."),
          toDate: z.string().optional().describe("YYYY-MM-DD."),
          updatedSince: z.string().optional(),
          lastUploaded: z.boolean().optional(),
        },
      },
      async ({ page, perPage, bankAccount, view, fromDate, toDate, updatedSince, lastUploaded }) => {
        let resolvedBankAccount: string;

        try {
          const { accessToken } = await this.prepareAuthenticatedContext();
          resolvedBankAccount = await this.resolveBankAccountRef(bankAccount, accessToken);
        } catch (cause) {
          return this.textResponse(
            formatFreeAgentErrorMessage("Failed to list bank transactions", cause),
          );
        }

        return this.readOnlyListToolCall(
          buildBankTransactionsPath({
            page,
            perPage,
            bankAccount: resolvedBankAccount,
            view,
            fromDate,
            toDate,
            updatedSince,
            lastUploaded,
          }),
          "Failed to list bank transactions",
        );
      },
    );

    this.server.tool(
      "get_bank_transaction",
      { bankTransactionId: z.string().min(1) },
      async ({ bankTransactionId }) =>
        this.readOnlyToolCall(
          buildBankTransactionPath(bankTransactionId),
          "Failed to get bank transaction",
        ),
    );

    this.registerOptionalTool(
      "list_transactions",
      {
        page: pageParam,
        perPage: perPageParam,
        fromDate: z.string().optional().describe("YYYY-MM-DD. Omitting this does NOT return all history."),
        toDate: z.string().optional().describe("YYYY-MM-DD."),
        nominalCode: z.string().optional().describe(
          "Full nominal code, e.g. 285 or 750-123456. Use the trial balance's `nominal_code`, not `display_nominal_code`.",
        ),
      },
      async ({ page, perPage, fromDate, toDate, nominalCode }) =>
        this.readOnlyListToolCall(
          buildTransactionsPath({ page, perPage, fromDate, toDate, nominalCode }),
          "Failed to list transactions",
        ),
      "Accounting ledger entries. WITH NO DATES IT RETURNS ONLY THE CURRENT ACCOUNTING PERIOD TO DATE, not all history — always pass fromDate/toDate when asking about earlier years. Ranges must be 12 months or less, or within one accounting year. `debit_value` encodes direction: credits are negative and there is no separate credit field, so sum it signed rather than by absolute value.",
    );

    this.server.tool(
      "get_transaction",
      { transactionId: z.string().min(1) },
      async ({ transactionId }) =>
        this.readOnlyToolCall(buildTransactionPath(transactionId), "Failed to get transaction"),
    );

    this.registerOptionalTool(
      "list_capital_assets",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        includeHistory: z.boolean().optional(),
      },
      async ({ page, perPage, view, includeHistory }) =>
        this.readOnlyListToolCall(
          buildCapitalAssetsPath({ page, perPage, view, includeHistory }),
          "Failed to list capital assets",
        ),
    );

    this.server.tool(
      "get_capital_asset",
      {
        capitalAssetId: z.string().min(1),
        includeHistory: z.boolean().optional(),
      },
      async ({ capitalAssetId, includeHistory }) =>
        this.readOnlyToolCall(
          buildCapitalAssetPath(capitalAssetId, { includeHistory }),
          "Failed to get capital asset",
        ),
    );

    this.registerOptionalTool(
      "list_contacts",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        sort: z.string().optional(),
        updatedSince: z.string().optional(),
      },
      async ({ page, perPage, view, sort, updatedSince }) =>
        this.readOnlyListToolCall(
          buildContactsPath({ page, perPage, view, sort, updatedSince }),
          "Failed to list contacts",
        ),
    );

    this.server.tool(
      "get_contact",
      { contactId: z.string().min(1) },
      async ({ contactId }) =>
        this.readOnlyToolCall(buildContactPath(contactId), "Failed to get contact"),
    );

    this.registerOptionalTool(
      "list_projects",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        sort: z.string().optional(),
        nested: z.boolean().optional(),
        contact: z.string().optional(),
      },
      async ({ page, perPage, view, sort, nested, contact }) =>
        this.readOnlyListToolCall(
          buildProjectsPath({ page, perPage, view, sort, nested, contact }),
          "Failed to list projects",
        ),
    );

    this.server.tool(
      "get_project",
      { projectId: z.string().min(1) },
      async ({ projectId }) =>
        this.readOnlyToolCall(buildProjectPath(projectId), "Failed to get project"),
    );

    this.registerOptionalTool(
      "list_tasks",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
        sort: z.string().optional(),
        updatedSince: z.string().optional(),
        project: z.string().optional(),
      },
      async ({ page, perPage, view, sort, updatedSince, project }) =>
        this.readOnlyListToolCall(
          buildTasksPath({ page, perPage, view, sort, updatedSince, project }),
          "Failed to list tasks",
        ),
    );

    this.server.tool(
      "get_task",
      { taskId: z.string().min(1) },
      async ({ taskId }) =>
        this.readOnlyToolCall(buildTaskPath(taskId), "Failed to get task"),
    );

    this.registerOptionalTool(
      "list_timeslips",
      {
        page: pageParam,
        perPage: perPageParam,
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        updatedSince: z.string().optional(),
        view: z.string().optional(),
        nested: z.boolean().optional(),
        user: z.string().optional(),
        task: z.string().optional(),
        project: z.string().optional(),
      },
      async ({ page, perPage, fromDate, toDate, updatedSince, view, nested, user, task, project }) =>
        this.readOnlyListToolCall(
          buildTimeslipsPath({
            page,
            perPage,
            fromDate,
            toDate,
            updatedSince,
            view,
            nested,
            user,
            task,
            project,
          }),
          "Failed to list timeslips",
        ),
    );

    this.server.tool(
      "get_timeslip",
      { timeslipId: z.string().min(1) },
      async ({ timeslipId }) =>
        this.readOnlyToolCall(buildTimeslipPath(timeslipId), "Failed to get timeslip"),
    );

    this.registerOptionalTool(
      "list_users",
      {
        page: pageParam,
        perPage: perPageParam,
        view: z.string().optional(),
      },
      async ({ page, perPage, view }) =>
        this.readOnlyListToolCall(
          buildUsersPath({ page, perPage, view }),
          "Failed to list users",
        ),
    );

    this.server.tool(
      "get_user",
      { userId: z.string().min(1) },
      async ({ userId }) =>
        this.readOnlyToolCall(buildUserPath(userId), "Failed to get user"),
    );

    this.registerOptionalTool(
      "list_categories",
      {
        subAccounts: z.boolean().optional().describe(
          "Pass true to see individual bank accounts, users, and assets. Without it they are collapsed into their parent category.",
        ),
      },
      async ({ subAccounts }) =>
        this.readOnlyToolCall(
          buildCategoriesPath({ subAccounts }),
          "Failed to list categories",
        ),
      "Chart of accounts. WITHOUT subAccounts=true, individual bank accounts, users, and assets are replaced by a single parent category, so counting rows will undercount them. Results come back split across several arrays by type (income_categories, admin_expenses_categories, ...), not one flat list.",
    );

    this.server.tool(
      "get_category",
      { nominalCode: z.string().min(1) },
      async ({ nominalCode }) =>
        this.readOnlyToolCall(buildCategoryPath(nominalCode), "Failed to get category"),
    );

    this.registerOptionalTool(
      "list_price_list_items",
      {
        page: pageParam,
        perPage: perPageParam,
        sort: z.string().optional(),
      },
      async ({ page, perPage, sort }) =>
        this.readOnlyListToolCall(
          buildPriceListItemsPath({ page, perPage, sort }),
          "Failed to list price list items",
        ),
    );

    this.server.tool(
      "get_price_list_item",
      { priceListItemId: z.string().min(1) },
      async ({ priceListItemId }) =>
        this.readOnlyToolCall(
          buildPriceListItemPath(priceListItemId),
          "Failed to get price list item",
        ),
    );
  }

  private getAppEnv(): AppEnv & { AUTH_STORE: DurableObjectNamespace } {
    return this.env as AppEnv & { AUTH_STORE: DurableObjectNamespace };
  }

  private registerOptionalTool(
    name: string,
    shape: OptionalArgsShape,
    cb: (args: any) => Promise<TextToolResponse> | TextToolResponse,
    description?: string,
  ): void {
    registerOptionalTool(this.server, name, shape, cb, description);
  }

  private buildAuthStatusMessage(): string {
    const configuredMode = getFreeAgentMode(this.getAppEnv());
    const lines = [
      `principalId: ${this.state.principalId ?? "not authorized"}`,
      `configuredMode: ${configuredMode}`,
      `sessionMode: ${this.state.mode ?? "not loaded"}`,
      `userProfile: ${this.state.userProfile?.email ?? "not loaded"}`,
      `company: ${this.state.company?.name ?? "not loaded"}`,
      `practice: ${this.state.practice?.name ?? "not loaded"}`,
      `activeSubdomain: ${this.state.activeSubdomain ?? "none"}`,
      `clientCount: ${this.state.clients.length}`,
      `hasAccessToken: ${this.state.encryptedAccessToken ? "yes" : "no"}`,
      `hasRefreshToken: ${this.state.encryptedRefreshToken ? "yes" : "no"}`,
    ];

    return lines.join("\n");
  }

  private buildAuthRecordPatch(state: SessionState, principalId: string) {
    return {
      principalId,
      mode: state.mode,
      userProfile: state.userProfile,
      company: state.company,
      practice: state.practice,
      clients: state.clients,
      activeSubdomain: state.activeSubdomain,
      encryptedAccessToken: state.encryptedAccessToken,
      encryptedRefreshToken: state.encryptedRefreshToken,
      tokenExpiresAt: state.tokenExpiresAt,
      oauthState: state.oauthState,
      oauthStateCreatedAt: state.oauthStateCreatedAt,
    };
  }

  private async prepareSession(): Promise<string> {
    await this.enforceSessionTtl();
    const principalId = this.getPrincipalId();
    await this.ensurePrincipalSession(principalId);
    await this.syncSessionFromAuthStore(principalId);
    await this.touchSessionActivity();
    return principalId;
  }

  private async prepareAuthenticatedContext(): Promise<{ principalId: string; accessToken: string }> {
    const principalId = await this.prepareSession();
    const env = this.getAppEnv();
    const { accessToken, nextState } = await ensureValidAccessToken(this.state, env);

    if (nextState !== this.state) {
      this.setState(nextState);
      await patchPrincipalAuthRecord(env, principalId, this.buildAuthRecordPatch(nextState, principalId));
    }

    if (!this.isContextHydrated()) {
      const context = await bootstrapAccountContext(accessToken, env, {
        preferredActiveSubdomain: this.state.activeSubdomain,
      });
      const nextHydratedState: SessionState = {
        ...this.state,
        ...context,
      };

      this.setState(nextHydratedState);
      await patchPrincipalAuthRecord(env, principalId, this.buildAuthRecordPatch(nextHydratedState, principalId));
    }

    await this.touchSessionActivity();
    return { principalId, accessToken };
  }

  private async readOnlyToolCall(path: string, errorPrefix: string): Promise<TextToolResponse> {
    try {
      const { accessToken } = await this.prepareAuthenticatedContext();
      const payload = await freeAgentGet<unknown>(path, accessToken, this.getAppEnv(), buildRequestScope(this.state));
      return this.jsonResponse(payload);
    } catch (cause) {
      return this.textResponse(formatFreeAgentErrorMessage(errorPrefix, cause));
    }
  }

  private async readOnlyListToolCall(
    path: string,
    errorPrefix: string,
    augment?: (payload: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<TextToolResponse> {
    try {
      const { accessToken } = await this.prepareAuthenticatedContext();
      const { payload, pagination } = await freeAgentGetDetailed<Record<string, unknown>>(
        path,
        accessToken,
        this.getAppEnv(),
        buildRequestScope(this.state),
      );

      const extra = augment?.(payload) ?? {};

      if (!pagination) {
        return this.jsonResponse({ ...extra, ...payload });
      }

      const truncation = buildTruncationNotice(pagination, countCollectionItems(payload));

      return this.jsonResponse({
        ...(truncation ? { truncation } : {}),
        ...extra,
        ...payload,
        pagination,
      });
    } catch (cause) {
      return this.textResponse(formatFreeAgentErrorMessage(errorPrefix, cause));
    }
  }

  /**
   * Fetches every page before returning.
   *
   * Used for reports that read as a single document. FreeAgent paginates them
   * at 25 rows like any other collection, and a trial balance missing its tail
   * still looks like a complete trial balance.
   */
  private async readOnlyAggregatedToolCall(path: string, errorPrefix: string): Promise<TextToolResponse> {
    try {
      const { accessToken } = await this.prepareAuthenticatedContext();
      const { payload, pagesFetched, complete, totalCount } = await freeAgentGetAllPages<
        Record<string, unknown>
      >(path, accessToken, this.getAppEnv(), buildRequestScope(this.state));

      const returned = countCollectionItems(payload);

      return this.jsonResponse({
        ...(complete
          ? {}
          : {
            truncation: {
              truncated: true,
              returned,
              totalCount,
              message:
                `INCOMPLETE RESULT: stopped after ${pagesFetched} pages of auto-pagination. ` +
                `This report is missing rows — narrow the date range and retry.`,
            },
          }),
        ...payload,
        pagination: {
          autoPaginated: true,
          pagesFetched,
          complete,
          ...(totalCount !== undefined ? { totalCount } : {}),
        },
      });
    } catch (cause) {
      return this.textResponse(formatFreeAgentErrorMessage(errorPrefix, cause));
    }
  }

  /**
   * Turns a user-supplied bank account reference into the resource URL that
   * FreeAgent's `bank_account` filter requires. Anything that isn't already a
   * URL or a bare id is matched against the account list by nominal code or name.
   */
  private async resolveBankAccountRef(ref: string, accessToken: string): Promise<string> {
    const env = this.getAppEnv();
    const direct = resolveDirectBankAccountRef(ref, getFreeAgentApiBaseUrl(env));

    if (direct) {
      return direct;
    }

    const payload = await freeAgentGet<{
      bank_accounts?: Array<{ url?: string; name?: string; bank_name?: string }>;
    }>(buildBankAccountsPath({ perPage: 100 }), accessToken, env, buildRequestScope(this.state));

    const accounts = (payload.bank_accounts ?? []).filter((account) => Boolean(account.url));
    const needle = ref.trim().toLowerCase();
    const nominalCodeId = extractBankAccountIdFromNominalCode(ref);

    const match =
      // `750-<id>` from the trial balance: the suffix is the account id.
      (nominalCodeId
        ? accounts.find((account) => bankAccountIdFromUrl(account.url as string) === nominalCodeId)
        : undefined) ??
      accounts.find((account) => account.name?.toLowerCase() === needle) ??
      accounts.find((account) => account.bank_name?.toLowerCase() === needle) ??
      accounts.find((account) => account.name?.toLowerCase().includes(needle));

    if (!match?.url && nominalCodeId) {
      // `750-1` is a display code, not the API identifier. The trial balance is
      // the only place that maps display_nominal_code onto a bank account, so
      // fall back to it rather than rejecting what a user would naturally type.
      const resolved = await this.resolveBankAccountFromDisplayCode(ref, accessToken);

      if (resolved) {
        return resolved;
      }
    }

    if (!match?.url) {
      const available = accounts
        .map((account) => {
          const id = bankAccountIdFromUrl(account.url as string);
          return `${account.name ?? "unnamed"} [nominal 750-${id ?? "?"}, id ${id ?? "?"}]`;
        })
        .join("; ");

      throw new Error(
        `Could not resolve bank account "${ref}". ` +
          (nominalCodeId
            ? `No account has id ${nominalCodeId}. Note that a code such as 750-1 is a display code, ` +
              "not the API identifier; the trial balance shows the real one. "
            : "") +
          `Available accounts: ${available || "none"}. ` +
          "Pass a resource URL, numeric id, a 750-<id> nominal code, or an account name.",
      );
    }

    return match.url;
  }

  /**
   * The final accounts resource is filing metadata only — FreeAgent exposes no
   * figures on it and has no companion endpoint that does. Rather than return a
   * bare metadata blob that reads as a failed lookup, point at the report
   * endpoints that do carry numbers, pre-filled with this period's dates.
   */
  private async getFinalAccountsReport(periodEndsOn: string): Promise<TextToolResponse> {
    try {
      const { accessToken } = await this.prepareAuthenticatedContext();
      const payload = await freeAgentGet<{
        final_accounts_report?: { period_starts_on?: string; period_ends_on?: string };
      }>(
        buildFinalAccountsReportPath(periodEndsOn),
        accessToken,
        this.getAppEnv(),
        buildRequestScope(this.state),
      );

      const report = payload.final_accounts_report;
      const fromDate = report?.period_starts_on;
      const toDate = report?.period_ends_on ?? periodEndsOn;

      return this.jsonResponse({
        ...payload,
        note:
          "This resource contains filing metadata only; FreeAgent does not expose final accounts figures through it. " +
          `For the numbers in this period call get_profit_and_loss({ fromDate: "${fromDate ?? "<period_starts_on>"}", toDate: "${toDate}" }), ` +
          `get_trial_balance_summary({ fromDate: "${fromDate ?? "<period_starts_on>"}", toDate: "${toDate}" }), ` +
          `or get_balance_sheet({ asAtDate: "${toDate}" }).`,
      });
    } catch (cause) {
      return this.textResponse(
        formatFreeAgentErrorMessage("Failed to get final accounts report", cause),
      );
    }
  }

  /**
   * Looks a bank account up by the nominal code FreeAgent shows in its UI.
   *
   * The trial balance is the only endpoint that exposes both forms on one row:
   * `display_nominal_code` (750-1) alongside the bank account URL. It must be
   * fully paginated, since bank accounts sort well past the first 25 rows.
   */
  private async resolveBankAccountFromDisplayCode(
    ref: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const { payload } = await freeAgentGetAllPages<{
        trial_balance_summary?: Array<{
          display_nominal_code?: string;
          nominal_code?: string;
          bank_account?: string;
        }>;
      }>(
        buildTrialBalanceSummaryPath(),
        accessToken,
        this.getAppEnv(),
        buildRequestScope(this.state),
      );

      const needle = ref.trim();
      const row = (payload.trial_balance_summary ?? []).find(
        (candidate) =>
          Boolean(candidate.bank_account) &&
          (candidate.display_nominal_code === needle || candidate.nominal_code === needle),
      );

      return row?.bank_account ?? null;
    } catch {
      // The caller still has a useful error to report; don't mask it with this one.
      return null;
    }
  }

  private isContextHydrated(): boolean {
    if (this.state.mode === "company") {
      return this.state.company !== null;
    }

    if (this.state.mode === "practice") {
      return this.state.practice !== null;
    }

    return false;
  }

  private jsonResponse(value: unknown): TextToolResponse {
    return this.textResponse(JSON.stringify(value, null, 2));
  }

  private textResponse(text: string): TextToolResponse {
    return {
      content: [{ type: "text", text }],
    };
  }

  private getPrincipalId(): string {
    const auth = getMcpAuthContext() as { props?: Record<string, unknown> } | undefined;
    const authProps = auth?.props;
    const agentProps = (this.props ?? {}) as Record<string, unknown>;
    const fromAuthProps =
      typeof authProps?.sub === "string"
        ? authProps.sub
        : typeof authProps?.userId === "string"
          ? authProps.userId
          : null;
    const fromAgentProps =
      typeof agentProps.sub === "string"
        ? agentProps.sub
        : typeof agentProps.userId === "string"
          ? agentProps.userId
          : null;

    return fromAuthProps ?? fromAgentProps ?? this.state.principalId ?? `session:${this.ctx.id.toString()}`;
  }

  private async ensurePrincipalSession(principalId: string): Promise<void> {
    if (!this.state.principalId || this.state.principalId === principalId) {
      if (!this.state.principalId) {
        this.setState({
          ...this.state,
          principalId,
        });
      }
      return;
    }

    this.setState({
      ...DEFAULT_SESSION_STATE,
      principalId,
      lastActivityAt: this.state.lastActivityAt,
    });
  }

  private async syncSessionFromAuthStore(principalId: string): Promise<void> {
    const record = await getPrincipalAuthRecord(this.getAppEnv(), principalId);
    if (!record) {
      return;
    }

    this.setState({
      ...this.state,
      principalId,
      mode: record.mode,
      userProfile: record.userProfile,
      company: record.company,
      practice: record.practice,
      clients: record.clients,
      activeSubdomain: record.activeSubdomain,
      encryptedAccessToken: record.encryptedAccessToken,
      encryptedRefreshToken: record.encryptedRefreshToken,
      tokenExpiresAt: record.tokenExpiresAt,
      oauthState: record.oauthState,
      oauthStateCreatedAt: record.oauthStateCreatedAt,
    });
  }

  async alarm(): Promise<void> {
    await this.enforceSessionTtl();

    if (this.state.lastActivityAt) {
      await this.scheduleSessionAlarm();
    }
  }

  private async enforceSessionTtl(): Promise<void> {
    if (!this.state.lastActivityAt) {
      return;
    }

    if (Date.now() - this.state.lastActivityAt <= SESSION_INACTIVITY_TTL_MS) {
      return;
    }

    this.clearSessionState();
  }

  private clearSessionState(): void {
    this.setState({
      ...DEFAULT_SESSION_STATE,
      lastActivityAt: null,
    });
  }

  private async touchSessionActivity(): Promise<void> {
    const now = Date.now();
    this.setState({
      ...this.state,
      lastActivityAt: now,
    });
    await this.scheduleSessionAlarm();
  }

  private async scheduleSessionAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + SESSION_INACTIVITY_TTL_MS);
  }
}
