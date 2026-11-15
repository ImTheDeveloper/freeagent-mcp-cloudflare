import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatFreeAgentErrorMessage } from "../freeagent/errors";
import {
  INVOICE_TRANSITIONS,
  definedFields,
  buildCreateBillBody,
  buildCreateContactBody,
  buildCreateExpenseBody,
  buildCreateInvoiceBody,
  pathFromResourceUrl,
  planReconcile,
  resolveResourceUrl,
  type TargetForReconcile,
  type TransactionForReconcile,
} from "../freeagent/writes";

export type WriteToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface WriteToolDeps {
  baseUrl: string;
  /** Registers the delete tools too. */
  allowDeletes: boolean;
  get<T = any>(path: string): Promise<T>;
  write(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ payload: any; location?: string }>;
  /** Names the books a write lands in, so a wrong-client write is visible. */
  companyLabel(): string;
  /** URL of the signed-in FreeAgent user, the default owner of new expenses. */
  currentUserUrl(): string | null;
}

const moneyParam = z.union([z.string(), z.number()]);
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

function ok(deps: WriteToolDeps, result: Record<string, unknown>): WriteToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ company: deps.companyLabel(), ...result }, null, 2) }],
  };
}

function fail(message: string): WriteToolResponse {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function guarded(
  prefix: string,
  run: () => Promise<WriteToolResponse>,
): Promise<WriteToolResponse> {
  try {
    return await run();
  } catch (cause) {
    return fail(formatFreeAgentErrorMessage(prefix, cause));
  }
}

/**
 * Registers the opt-in write tools. Callers gate this on FREEAGENT_ENABLE_WRITES;
 * the delete tools are additionally gated on `deps.allowDeletes`.
 */
export function registerWriteTools(server: McpServer, deps: WriteToolDeps): void {
  server.registerTool(
    "create_contact",
    {
      description:
        "Creates a contact (customer/supplier). Provide organisationName, or both firstName and lastName.",
      inputSchema: {
        organisationName: z.string().min(1).optional(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        email: z.string().email().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      guarded("Failed to create contact", async () => {
        const body = buildCreateContactBody(args);
        const { payload, location } = await deps.write("POST", "/v2/contacts", body);
        return ok(deps, { created: payload.contact ?? null, location });
      }),
  );

  server.registerTool(
    "create_invoice",
    {
      description:
        "Creates a DRAFT invoice (FreeAgent always creates invoices as drafts). Nothing is sent: use transition_invoice with mark_as_sent afterwards. `contact` is a contact id or URL. Prices are per unit, excluding VAT.",
      inputSchema: {
        contact: z.string().min(1).describe("Contact id or full contact URL."),
        project: z
          .string()
          .optional()
          .describe("Project id or full project URL to bill against. Must belong to the contact (see list_projects)."),
        datedOn: dateParam.describe("Invoice date, YYYY-MM-DD."),
        paymentTermsInDays: z.number().int().min(0).describe("Days until payment is due."),
        reference: z.string().optional(),
        comments: z.string().optional(),
        currency: z.string().length(3).optional().describe("ISO code. Defaults to the company currency."),
        items: z
          .array(
            z.object({
              description: z.string().min(1),
              price: moneyParam.describe("Unit price."),
              quantity: moneyParam.optional().describe("Defaults to 1."),
              itemType: z.string().optional().describe("e.g. Hours, Days, Products, Services."),
              salesTaxRate: moneyParam.optional().describe("VAT rate percent, e.g. 20."),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      guarded("Failed to create invoice", async () => {
        const body = buildCreateInvoiceBody(args, deps.baseUrl);
        const { payload, location } = await deps.write("POST", "/v2/invoices", body);
        return ok(deps, { created: payload.invoice ?? null, location, status: "Draft" });
      }),
  );

  server.registerTool(
    "transition_invoice",
    {
      description:
        "Changes an invoice's status. mark_as_sent makes a draft a live invoice (it can then be paid) and can re-open a cancelled one; mark_as_draft and mark_as_cancelled reverse it. Does not call FreeAgent's send-email endpoint.",
      inputSchema: {
        invoice: z.string().min(1).describe("Invoice id or full invoice URL."),
        transition: z.enum(INVOICE_TRANSITIONS),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ invoice, transition }) =>
      guarded("Failed to transition invoice", async () => {
        const url = resolveResourceUrl("invoices", invoice, deps.baseUrl);
        await deps.write("PUT", `${pathFromResourceUrl(url)}/transitions/${transition}`);
        const { invoice: updated } = await deps.get<{ invoice?: Record<string, unknown> }>(
          pathFromResourceUrl(url),
        );
        return ok(deps, { transition, invoice: updated ?? { url } });
      }),
  );

  server.registerTool(
    "reconcile_bank_transaction",
    {
      description:
        "Reconciles (explains) a bank transaction in one step by creating an explanation. Provide exactly one of: category (nominal code or category URL), paidInvoice (match money in to an invoice) or paidBill (match money out to a bill). The sign is taken from the transaction. amount defaults to the smaller of what is unexplained and what the invoice/bill still owes; it can be lower for a partial match but never above what is unexplained. Sent invoices only: mark drafts as sent first. Returns the new explanation and what is still unexplained. Undo with delete_bank_transaction_explanation.",
      inputSchema: {
        bankTransaction: z.string().min(1).describe("Bank transaction id or full URL."),
        category: z.string().optional().describe("Nominal code (e.g. a category number) or category URL."),
        paidInvoice: z.string().optional().describe("Invoice id or URL."),
        paidBill: z.string().optional().describe("Bill id or URL."),
        amount: moneyParam.optional().describe("Positive amount to explain. Defaults as described."),
        datedOn: dateParam.optional().describe("Defaults to the transaction date."),
        description: z.string().optional(),
        salesTaxRate: moneyParam.optional().describe("Category matches only, e.g. 20."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      guarded("Failed to reconcile bank transaction", async () => {
        const txUrl = resolveResourceUrl("bank_transactions", args.bankTransaction, deps.baseUrl);
        const { bank_transaction: transaction } = await deps.get<{
          bank_transaction?: TransactionForReconcile;
        }>(pathFromResourceUrl(txUrl));

        if (!transaction) {
          return fail("Bank transaction not found in the current account context.");
        }

        let invoice: TargetForReconcile | undefined;
        let bill: TargetForReconcile | undefined;

        if (args.paidInvoice) {
          const url = resolveResourceUrl("invoices", args.paidInvoice, deps.baseUrl);
          invoice = (await deps.get<{ invoice?: TargetForReconcile }>(pathFromResourceUrl(url))).invoice;
          if (!invoice) return fail("Invoice not found in the current account context.");
        }

        if (args.paidBill) {
          const url = resolveResourceUrl("bills", args.paidBill, deps.baseUrl);
          bill = (await deps.get<{ bill?: TargetForReconcile }>(pathFromResourceUrl(url))).bill;
          if (!bill) return fail("Bill not found in the current account context.");
        }

        const bankAccountUrl = resolveResourceUrl("bank_accounts", transaction.bank_account, deps.baseUrl);
        const { bank_account: bankAccount } = await deps.get<{ bank_account?: { currency?: string } }>(
          pathFromResourceUrl(bankAccountUrl),
        );

        const plan = planReconcile({
          transaction,
          bankCurrency: bankAccount?.currency,
          category: args.category,
          invoice,
          bill,
          grossValue: args.amount,
          datedOn: args.datedOn,
          description: args.description,
          salesTaxRate: args.salesTaxRate,
          baseUrl: deps.baseUrl,
        });

        if (!plan.ok) {
          return fail(`Not reconciled: ${plan.error}`);
        }

        const { payload, location } = await deps.write(
          "POST",
          "/v2/bank_transaction_explanations",
          plan.body,
        );

        return ok(deps, {
          explanation: payload.bank_transaction_explanation ?? null,
          location,
          explainedAmount: plan.amount,
          remainingUnexplained: plan.remainingUnexplained,
        });
      }),
  );

  server.registerTool(
    "update_bank_transaction_explanation",
    {
      description:
        "Updates an existing explanation: its date, description, category, or the marked-for-review flag. To change which invoice/bill it matches, delete it and reconcile again.",
      inputSchema: {
        explanation: z.string().min(1).describe("Explanation id or full URL."),
        datedOn: dateParam.optional(),
        description: z.string().optional(),
        category: z.string().optional().describe("Nominal code or category URL."),
        markedForReview: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      guarded("Failed to update bank transaction explanation", async () => {
        const url = resolveResourceUrl("bank_transaction_explanations", args.explanation, deps.baseUrl);
        const fields: Record<string, unknown> = {
          dated_on: args.datedOn,
          description: args.description,
          category: args.category ? resolveResourceUrl("categories", args.category, deps.baseUrl) : undefined,
          marked_for_review: args.markedForReview,
        };

        if (Object.values(fields).every((value) => value === undefined)) {
          return fail("Nothing to update: provide at least one field.");
        }

        await deps.write("PUT", pathFromResourceUrl(url), { bank_transaction_explanation: fields });
        const { bank_transaction_explanation: updated } = await deps.get<{
          bank_transaction_explanation?: Record<string, unknown>;
        }>(pathFromResourceUrl(url));
        return ok(deps, { explanation: updated ?? { url } });
      }),
  );


  const taxStatus = z.enum(["TAXABLE", "EXEMPT", "OUT_OF_SCOPE"]);

  /** PUT a partial update, then read the record back so the result shows what is stored. */
  async function updateResource(
    resource: "invoices" | "bills" | "expenses" | "contacts",
    rootKey: string,
    ref: string,
    fields: Record<string, unknown>,
  ): Promise<WriteToolResponse> {
    const url = resolveResourceUrl(resource, ref, deps.baseUrl);
    const body = { [rootKey]: definedFields(fields) };
    await deps.write("PUT", pathFromResourceUrl(url), body);
    const updated = await deps.get<Record<string, unknown>>(pathFromResourceUrl(url));
    return ok(deps, { [rootKey]: updated[rootKey] ?? { url } });
  }

  const optionalProject = z
    .string()
    .optional()
    .describe("Project id or full project URL.");

  server.registerTool(
    "update_invoice",
    {
      description:
        "Updates a draft or open invoice's header: reference, date, payment terms, comments or project. It does not change line items: delete a draft and recreate it for that.",
      inputSchema: {
        invoice: z.string().min(1).describe("Invoice id or full invoice URL."),
        reference: z.string().optional(),
        datedOn: dateParam.optional(),
        paymentTermsInDays: z.number().int().min(0).optional(),
        comments: z.string().optional(),
        project: optionalProject,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      guarded("Failed to update invoice", () =>
        updateResource("invoices", "invoice", args.invoice, {
          reference: args.reference,
          dated_on: args.datedOn,
          payment_terms_in_days: args.paymentTermsInDays,
          comments: args.comments,
          project: args.project ? resolveResourceUrl("projects", args.project, deps.baseUrl) : undefined,
        }),
      ),
  );

  server.registerTool(
    "update_contact",
    {
      description:
        "Updates a contact's name, status or postal address. Email and phone are deliberately not editable here.",
      inputSchema: {
        contact: z.string().min(1).describe("Contact id or full contact URL."),
        organisationName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        status: z.enum(["Active", "Hidden"]).optional(),
        defaultPaymentTermsInDays: z.number().int().min(0).optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        town: z.string().optional(),
        region: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ contact, ...rest }) =>
      guarded("Failed to update contact", () =>
        updateResource("contacts", "contact", contact, {
          organisation_name: rest.organisationName,
          first_name: rest.firstName,
          last_name: rest.lastName,
          status: rest.status,
          default_payment_terms_in_days: rest.defaultPaymentTermsInDays,
          address1: rest.address1,
          address2: rest.address2,
          town: rest.town,
          region: rest.region,
          postcode: rest.postcode,
          country: rest.country,
        }),
      ),
  );

  server.registerTool(
    "create_bill",
    {
      description:
        "Creates a supplier bill (an invoice you owe). Use it when a supplier invoice arrives that has not been paid yet; pay it later with reconcile_bank_transaction and paidBill. Not needed for something already paid by card: reconcile that straight to a category. Each item needs a category (nominal code or URL) and a gross total.",
      inputSchema: {
        contact: z.string().min(1).describe("Supplier contact id or URL (create_contact first if new)."),
        reference: z.string().min(1).describe("The supplier's invoice number."),
        datedOn: dateParam,
        dueOn: dateParam.optional(),
        currency: z.string().length(3).optional(),
        comments: z.string().optional(),
        project: optionalProject,
        items: z
          .array(
            z.object({
              category: z.string().min(1).describe("Nominal code or category URL."),
              totalValue: moneyParam.describe("Gross total for the item, including VAT."),
              description: z.string().optional(),
              salesTaxRate: moneyParam.optional().describe("VAT rate percent, e.g. 20."),
              salesTaxStatus: taxStatus.optional(),
            }),
          )
          .min(1)
          .max(40),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      guarded("Failed to create bill", async () => {
        const body = buildCreateBillBody(args, deps.baseUrl);
        const { payload, location } = await deps.write("POST", "/v2/bills", body);
        return ok(deps, { created: payload.bill ?? null, location });
      }),
  );

  server.registerTool(
    "update_bill",
    {
      description:
        "Updates a bill's header: reference, dates, comments or project. It does not change line items: delete and recreate the bill for that.",
      inputSchema: {
        bill: z.string().min(1).describe("Bill id or full bill URL."),
        reference: z.string().optional(),
        datedOn: dateParam.optional(),
        dueOn: dateParam.optional(),
        comments: z.string().optional(),
        project: optionalProject,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      guarded("Failed to update bill", () =>
        updateResource("bills", "bill", args.bill, {
          reference: args.reference,
          dated_on: args.datedOn,
          due_on: args.dueOn,
          comments: args.comments,
          project: args.project ? resolveResourceUrl("projects", args.project, deps.baseUrl) : undefined,
        }),
      ),
  );

  server.registerTool(
    "create_expense",
    {
      description:
        "Creates an out-of-pocket expense claim for a user. Do NOT use this for something paid from a company bank account or card: reconcile that transaction to a category with reconcile_bank_transaction instead, or it will be counted twice. amount is positive; the sign is handled for you. Mileage is not supported.",
      inputSchema: {
        category: z.string().min(1).describe("Nominal code or category URL."),
        datedOn: dateParam,
        amount: moneyParam.describe("Gross amount including VAT, positive."),
        description: z.string().optional(),
        user: z.string().optional().describe("User id or URL. Defaults to the signed-in user."),
        currency: z.string().length(3).optional(),
        salesTaxRate: moneyParam.optional().describe("VAT rate percent, e.g. 20."),
        salesTaxStatus: taxStatus.optional(),
        receiptReference: z.string().optional(),
        project: optionalProject,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      guarded("Failed to create expense", async () => {
        const user = args.user ?? deps.currentUserUrl();

        if (!user) {
          return fail("No default user is available: pass `user`.");
        }

        const body = buildCreateExpenseBody(
          {
            user,
            category: args.category,
            datedOn: args.datedOn,
            grossValue: args.amount,
            description: args.description,
            currency: args.currency,
            salesTaxRate: args.salesTaxRate,
            salesTaxStatus: args.salesTaxStatus,
            receiptReference: args.receiptReference,
            project: args.project,
          },
          deps.baseUrl,
        );
        const { payload, location } = await deps.write("POST", "/v2/expenses", body);
        return ok(deps, { created: payload.expense ?? null, location });
      }),
  );

  server.registerTool(
    "update_expense",
    {
      description:
        "Updates an expense: category, date, description, amount, VAT, receipt reference or project.",
      inputSchema: {
        expense: z.string().min(1).describe("Expense id or full expense URL."),
        category: z.string().optional().describe("Nominal code or category URL."),
        datedOn: dateParam.optional(),
        description: z.string().optional(),
        amount: moneyParam.optional().describe("Gross amount including VAT, positive."),
        salesTaxRate: moneyParam.optional(),
        salesTaxStatus: taxStatus.optional(),
        receiptReference: z.string().optional(),
        project: optionalProject,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      guarded("Failed to update expense", () =>
        updateResource("expenses", "expense", args.expense, {
          category: args.category ? resolveResourceUrl("categories", args.category, deps.baseUrl) : undefined,
          dated_on: args.datedOn,
          description: args.description,
          gross_value:
            args.amount === undefined ? undefined : (-Math.abs(Number(args.amount))).toFixed(2),
          sales_tax_rate: args.salesTaxRate === undefined ? undefined : String(args.salesTaxRate),
          sales_tax_status: args.salesTaxStatus,
          receipt_reference: args.receiptReference,
          project: args.project ? resolveResourceUrl("projects", args.project, deps.baseUrl) : undefined,
        }),
      ),
  );

  if (!deps.allowDeletes) {
    return;
  }

  server.registerTool(
    "delete_bank_transaction_explanation",
    {
      description:
        "DESTRUCTIVE. Deletes an explanation, returning its bank transaction to unexplained. This is the undo for a wrong reconcile. Fails if the explanation is locked (is_locked) or not deletable.",
      inputSchema: { explanation: z.string().min(1).describe("Explanation id or full URL.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ explanation }) =>
      guarded("Failed to delete bank transaction explanation", async () => {
        const url = resolveResourceUrl("bank_transaction_explanations", explanation, deps.baseUrl);
        await deps.write("DELETE", pathFromResourceUrl(url));
        return ok(deps, { deleted: url });
      }),
  );

  server.registerTool(
    "delete_invoice",
    {
      description:
        "DESTRUCTIVE. Permanently deletes an invoice. Prefer transition_invoice with mark_as_cancelled for anything that has been sent.",
      inputSchema: { invoice: z.string().min(1).describe("Invoice id or full URL.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ invoice }) =>
      guarded("Failed to delete invoice", async () => {
        const url = resolveResourceUrl("invoices", invoice, deps.baseUrl);
        await deps.write("DELETE", pathFromResourceUrl(url));
        return ok(deps, { deleted: url });
      }),
  );

  for (const [resource, tool, label] of [
    ["bills", "delete_bill", "bill"],
    ["expenses", "delete_expense", "expense"],
    ["contacts", "delete_contact", "contact"],
  ] as const) {
    server.registerTool(
      tool,
      {
        description: `DESTRUCTIVE. Permanently deletes a ${label}. FreeAgent may refuse if it is in use.`,
        inputSchema: { [label]: z.string().min(1).describe(`${label} id or full URL.`) },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args: Record<string, string>) =>
        guarded(`Failed to delete ${label}`, async () => {
          const url = resolveResourceUrl(resource, args[label] as string, deps.baseUrl);
          await deps.write("DELETE", pathFromResourceUrl(url));
          return ok(deps, { deleted: url });
        }),
    );
  }
}
