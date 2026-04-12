import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent, getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { getFreeAgentMode, type AppEnv } from "./env";
import { getPrincipalAuthRecord, patchPrincipalAuthRecord } from "./auth/store";
import { bootstrapAccountContext, switchActiveClientContext } from "./freeagent/context";
import { freeAgentGet, freeAgentGetDetailed } from "./freeagent/api";
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
import { DEFAULT_SESSION_STATE, type SessionState } from "./types";

type TextToolResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

const SESSION_INACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const pageParam = z.number().int().positive().optional();
const perPageParam = z.number().int().positive().max(100).optional();
type OptionalArgsShape = z.ZodRawShape;

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
      { asAtDate: z.string().optional() },
      async ({ asAtDate }) =>
        this.readOnlyToolCall(
          buildBalanceSheetPath({ asAtDate }),
          "Failed to get balance sheet",
        ),
    );

    this.registerOptionalTool(
      "get_profit_and_loss",
      {
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        accountingPeriod: z.string().optional(),
      },
      async ({ fromDate, toDate, accountingPeriod }) =>
        this.readOnlyToolCall(
          buildProfitAndLossSummaryPath({ fromDate, toDate, accountingPeriod }),
          "Failed to get profit and loss summary",
        ),
    );

    this.registerOptionalTool(
      "get_trial_balance_summary",
      {
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      },
      async ({ fromDate, toDate }) =>
        this.readOnlyToolCall(
          buildTrialBalanceSummaryPath({ fromDate, toDate }),
          "Failed to get trial balance summary",
        ),
    );

    this.server.tool("get_trial_balance_opening_balances", async () =>
      this.readOnlyToolCall(
        "/v2/accounting/trial_balance/summary/opening_balances",
        "Failed to get trial balance opening balances",
      ),
    );

    this.server.tool(
      "get_cashflow",
      {
        fromDate: z.string(),
        toDate: z.string(),
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

    this.server.tool(
      "get_final_accounts_report",
      { periodEndsOn: z.string().min(1) },
      async ({ periodEndsOn }) =>
        this.readOnlyToolCall(
          buildFinalAccountsReportPath(periodEndsOn),
          "Failed to get final accounts report",
        ),
    );

    this.server.tool("get_company_tax_timeline", async () =>
      this.readOnlyToolCall("/v2/company/tax_timeline", "Failed to get company tax timeline"),
    );

    this.registerOptionalTool(
      "list_invoices",
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
          buildInvoicesPath({ page, perPage, view, sort, updatedSince, includeItems }),
          "Failed to list invoices",
        ),
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

    this.server.tool(
      "list_bank_transactions",
      {
        page: pageParam,
        perPage: perPageParam,
        bankAccount: z.string().min(1),
        view: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        updatedSince: z.string().optional(),
        lastUploaded: z.boolean().optional(),
      },
      async ({ page, perPage, bankAccount, view, fromDate, toDate, updatedSince, lastUploaded }) =>
        this.readOnlyListToolCall(
          buildBankTransactionsPath({
            page,
            perPage,
            bankAccount,
            view,
            fromDate,
            toDate,
            updatedSince,
            lastUploaded,
          }),
          "Failed to list bank transactions",
        ),
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
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        nominalCode: z.string().optional(),
      },
      async ({ page, perPage, fromDate, toDate, nominalCode }) =>
        this.readOnlyListToolCall(
          buildTransactionsPath({ page, perPage, fromDate, toDate, nominalCode }),
          "Failed to list transactions",
        ),
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
      { subAccounts: z.boolean().optional() },
      async ({ subAccounts }) =>
        this.readOnlyToolCall(
          buildCategoriesPath({ subAccounts }),
          "Failed to list categories",
        ),
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
  ): void {
    const inputSchema = z.object(shape).optional();

    this.server.registerTool(name, { inputSchema: inputSchema as z.ZodTypeAny }, async (args) =>
      cb((args ?? {}) as any),
    );
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

  private async readOnlyListToolCall(path: string, errorPrefix: string): Promise<TextToolResponse> {
    try {
      const { accessToken } = await this.prepareAuthenticatedContext();
      const { payload, pagination } = await freeAgentGetDetailed<Record<string, unknown>>(
        path,
        accessToken,
        this.getAppEnv(),
        buildRequestScope(this.state),
      );

      if (pagination) {
        return this.jsonResponse({
          ...payload,
          pagination,
        });
      }

      return this.jsonResponse(payload);
    } catch (cause) {
      return this.textResponse(formatFreeAgentErrorMessage(errorPrefix, cause));
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
