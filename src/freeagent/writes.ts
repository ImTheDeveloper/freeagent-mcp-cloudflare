/**
 * Pure helpers for the opt-in write tools: reference resolution, request body
 * construction and the reconcile safety checks. Kept free of I/O so every rule
 * can be unit-tested without a Worker runtime.
 */

export type WriteResource =
  | "invoices"
  | "bills"
  | "expenses"
  | "users"
  | "attachments"
  | "contacts"
  | "projects"
  | "bank_transactions"
  | "bank_transaction_explanations"
  | "categories"
  | "bank_accounts";

/**
 * Turns an id or full URL into a canonical resource URL on the configured API
 * host. A full URL for a different host or resource is rejected so a model can
 * never aim a write at an arbitrary address.
 */
export function resolveResourceUrl(resource: WriteResource, ref: string, baseUrl: string): string {
  const trimmed = ref.trim();
  const prefix = `${baseUrl.replace(/\/+$/, "")}/v2/${resource}/`;
  const ID = /^[A-Za-z0-9_-]+$/;

  if (/^https?:\/\//i.test(trimmed)) {
    // The remainder must be a plain id. Anything else (dot segments, encoded
    // dots, extra path, query) could be normalised onto a different endpoint.
    if (!trimmed.startsWith(prefix) || !ID.test(trimmed.slice(prefix.length))) {
      throw new Error(`Expected a ${resource} reference on ${baseUrl}, got "${trimmed}".`);
    }
    return trimmed;
  }

  if (!ID.test(trimmed)) {
    throw new Error(`"${trimmed}" is not a valid ${resource} id or URL.`);
  }

  return `${prefix}${trimmed}`;
}

/** The `/v2/...` path of a resource URL, used to call the API with it. */
export function pathFromResourceUrl(url: string): string {
  return new URL(url).pathname;
}

function toMinor(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`"${value}" is not a valid amount.`);
  }

  return Math.round(parsed * 100);
}

function fromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

function money(value: string | number): string {
  return fromMinor(toMinor(value));
}

export interface InvoiceItemInput {
  description: string;
  price: string | number;
  quantity?: string | number;
  itemType?: string;
  salesTaxRate?: string | number;
}

export interface CreateInvoiceInput {
  contact: string;
  project?: string;
  datedOn: string;
  paymentTermsInDays: number;
  reference?: string;
  comments?: string;
  currency?: string;
  items: InvoiceItemInput[];
}

/** Builds the POST body. FreeAgent always creates invoices as drafts. */
export function buildCreateInvoiceBody(input: CreateInvoiceInput, baseUrl: string) {
  if (input.items.length === 0) {
    throw new Error("An invoice needs at least one item.");
  }

  return {
    invoice: {
      contact: resolveResourceUrl("contacts", input.contact, baseUrl),
      project: input.project ? resolveResourceUrl("projects", input.project, baseUrl) : undefined,
      dated_on: input.datedOn,
      payment_terms_in_days: input.paymentTermsInDays,
      reference: input.reference,
      comments: input.comments,
      currency: input.currency,
      invoice_items: input.items.map((item) => ({
        description: item.description,
        item_type: item.itemType,
        price: money(item.price),
        quantity: String(item.quantity ?? 1),
        sales_tax_rate: item.salesTaxRate === undefined ? undefined : String(item.salesTaxRate),
      })),
    },
  };
}

export interface CreateContactInput {
  organisationName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function buildCreateContactBody(input: CreateContactInput) {
  if (!input.organisationName && !(input.firstName && input.lastName)) {
    throw new Error("Provide organisationName, or both firstName and lastName.");
  }

  return {
    contact: {
      organisation_name: input.organisationName,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
    },
  };
}

export const INVOICE_TRANSITIONS = ["mark_as_sent", "mark_as_draft", "mark_as_cancelled"] as const;
export type InvoiceTransition = (typeof INVOICE_TRANSITIONS)[number];

export interface TransactionForReconcile {
  url: string;
  amount: string;
  unexplained_amount: string;
  dated_on: string;
  bank_account: string;
}

export interface TargetForReconcile {
  url: string;
  due_value?: string | null;
  currency?: string;
  status?: string;
}

export interface ReconcileInput {
  transaction: TransactionForReconcile;
  bankCurrency?: string;
  /** Exactly one of these three. */
  category?: string;
  invoice?: TargetForReconcile;
  bill?: TargetForReconcile;
  /** Positive magnitude. Defaults to the most that can sensibly be matched. */
  grossValue?: string | number;
  datedOn?: string;
  description?: string;
  salesTaxRate?: string | number;
  baseUrl: string;
}

export type ReconcilePlan =
  | { ok: true; body: { bank_transaction_explanation: Record<string, unknown> }; amount: string; remainingUnexplained: string }
  | { ok: false; error: string };

/**
 * Validates a reconcile request against the transaction (and invoice/bill) and
 * builds the explanation body. Every rejection is a readable message so the
 * model can correct its call instead of hitting a bare FreeAgent 422.
 */
export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const targets = [input.category, input.invoice, input.bill].filter((value) => value !== undefined);

  if (targets.length !== 1) {
    return { ok: false, error: "Provide exactly one of category, paidInvoice or paidBill." };
  }

  let signed: number;
  let unexplained: number;

  try {
    signed = toMinor(input.transaction.amount);
    unexplained = toMinor(input.transaction.unexplained_amount);
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }

  if (unexplained === 0) {
    return { ok: false, error: "This transaction is already fully explained. Delete or update the existing explanation instead." };
  }

  const moneyIn = signed > 0;
  const remaining = Math.abs(unexplained);

  if (input.invoice && !moneyIn) {
    return { ok: false, error: "paidInvoice needs a money-in transaction, but this transaction is money out." };
  }

  if (input.bill && moneyIn) {
    return { ok: false, error: "paidBill needs a money-out transaction, but this transaction is money in." };
  }

  const target = input.invoice ?? input.bill;

  if (target?.currency && input.bankCurrency && target.currency !== input.bankCurrency) {
    return {
      ok: false,
      error: `Foreign-currency matching is not supported yet (bank ${input.bankCurrency}, document ${target.currency}). Reconcile it in FreeAgent.`,
    };
  }

  let due: number | undefined;

  if (target) {
    if (target.due_value === undefined || target.due_value === null) {
      return { ok: false, error: "Could not read how much is still due on the invoice/bill, so nothing was written." };
    }

    try {
      due = Math.abs(toMinor(target.due_value));
    } catch (cause) {
      return { ok: false, error: (cause as Error).message };
    }

    if (due === 0) {
      return { ok: false, error: "This invoice/bill has nothing left to pay (it is already paid)." };
    }
  }

  let magnitude: number;

  try {
    if (input.grossValue !== undefined) {
      magnitude = Math.abs(toMinor(input.grossValue));
    } else {
      magnitude = due === undefined ? remaining : Math.min(remaining, due);
    }
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }

  if (magnitude <= 0) {
    return { ok: false, error: "The amount to explain must be greater than zero." };
  }

  if (due !== undefined && magnitude > due) {
    return {
      ok: false,
      error: `Amount ${fromMinor(magnitude)} exceeds the ${fromMinor(due)} still due on the invoice/bill.`,
    };
  }

  if (magnitude > remaining) {
    return {
      ok: false,
      error: `Amount ${fromMinor(magnitude)} exceeds the ${fromMinor(remaining)} still unexplained on this transaction.`,
    };
  }

  const explanation: Record<string, unknown> = {
    bank_transaction: input.transaction.url,
    dated_on: input.datedOn ?? input.transaction.dated_on,
    gross_value: fromMinor(moneyIn ? magnitude : -magnitude),
    description: input.description,
  };

  if (input.invoice) {
    explanation.paid_invoice = input.invoice.url;
  } else if (input.bill) {
    explanation.paid_bill = input.bill.url;
  } else {
    explanation.category = resolveResourceUrl("categories", input.category as string, input.baseUrl);
    if (input.salesTaxRate !== undefined) {
      explanation.sales_tax_rate = String(input.salesTaxRate);
    }
  }

  return {
    ok: true,
    body: { bank_transaction_explanation: explanation },
    amount: fromMinor(moneyIn ? magnitude : -magnitude),
    remainingUnexplained: fromMinor(remaining - magnitude),
  };
}

/** Drops undefined values and fails when nothing is left, so an empty PUT never goes out. */
export function definedFields(fields: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    throw new Error("Nothing to update: provide at least one field.");
  }

  return Object.fromEntries(entries);
}

export interface BillItemInput {
  category: string;
  totalValue: string | number;
  description?: string;
  salesTaxRate?: string | number;
  salesTaxStatus?: "TAXABLE" | "EXEMPT" | "OUT_OF_SCOPE";
}

export interface CreateBillInput {
  contact: string;
  reference: string;
  datedOn: string;
  dueOn?: string;
  currency?: string;
  comments?: string;
  project?: string;
  attachment?: FileInput;
  items: BillItemInput[];
}

export function buildCreateBillBody(input: CreateBillInput, baseUrl: string) {
  if (input.items.length === 0) {
    throw new Error("A bill needs at least one item.");
  }

  return {
    bill: {
      contact: resolveResourceUrl("contacts", input.contact, baseUrl),
      reference: input.reference,
      dated_on: input.datedOn,
      due_on: input.dueOn,
      currency: input.currency,
      comments: input.comments,
      project: input.project ? resolveResourceUrl("projects", input.project, baseUrl) : undefined,
      attachment: input.attachment ? buildAttachment(input.attachment) : undefined,
      bill_items: input.items.map((item) => ({
        category: resolveResourceUrl("categories", item.category, baseUrl),
        total_value: money(item.totalValue),
        description: item.description,
        sales_tax_rate: item.salesTaxRate === undefined ? undefined : String(item.salesTaxRate),
        sales_tax_status: item.salesTaxStatus,
      })),
    },
  };
}

export interface CreateExpenseInput {
  user: string;
  category: string;
  datedOn: string;
  grossValue: string | number;
  description?: string;
  currency?: string;
  ecStatus?: string;
  salesTaxRate?: string | number;
  salesTaxStatus?: "TAXABLE" | "EXEMPT" | "OUT_OF_SCOPE";
  receiptReference?: string;
  project?: string;
  attachment?: FileInput;
}

export function buildCreateExpenseBody(input: CreateExpenseInput, baseUrl: string) {
  return {
    expense: {
      user: resolveResourceUrl("users", input.user, baseUrl),
      category: resolveResourceUrl("categories", input.category, baseUrl),
      dated_on: input.datedOn,
      // FreeAgent expects money out as a negative gross value.
      gross_value: fromMinor(-Math.abs(toMinor(input.grossValue))),
      description: input.description,
      currency: input.currency,
      ec_status: input.ecStatus ?? "UK/Non-EC",
      sales_tax_rate: input.salesTaxRate === undefined ? undefined : String(input.salesTaxRate),
      sales_tax_status: input.salesTaxStatus,
      receipt_reference: input.receiptReference,
      project: input.project ? resolveResourceUrl("projects", input.project, baseUrl) : undefined,
      attachment: input.attachment ? buildAttachment(input.attachment) : undefined,
    },
  };
}

/**
 * FreeAgent moves explanation attachments to a dedicated endpoint on
 * 1 Dec 2026. Sending this version on those calls gives the new behaviour now
 * and is harmless afterwards.
 */
export const ATTACHMENTS_API_VERSION = "2026-09-01";
export const ATTACHMENT_HEADERS = { "X-Api-Version": ATTACHMENTS_API_VERSION };

/** FreeAgent documents 5MB for expense attachments. The explanation limit is not published. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_CALL = 10;

const SIGNATURES: Array<{ type: string; test: (bytes: number[]) => boolean }> = [
  { type: "application/pdf", test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
];

export const ATTACHMENT_CONTENT_TYPES = SIGNATURES.map((signature) => signature.type);

export interface FileInput {
  fileName: string;
  contentType: string;
  /** Raw base64 of the file. No `data:` prefix. */
  dataBase64: string;
  description?: string;
}

/**
 * Validates a file and builds FreeAgent's attachment object. The declared type
 * must be one FreeAgent accepts and must match the file's own first bytes, so a
 * mislabelled or non-file payload is rejected before it is sent.
 */
export function buildAttachment(file: FileInput): Record<string, string | undefined> {
  const data = file.dataBase64.replace(/\s+/g, "");

  if (data.startsWith("data:") || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error(`"${file.fileName}": dataBase64 must be plain base64 of the file (no data: prefix).`);
  }

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const size = (data.length / 4) * 3 - padding;

  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${file.fileName}" is ${size} bytes; the limit is ${MAX_ATTACHMENT_BYTES}.`);
  }

  if (!ATTACHMENT_CONTENT_TYPES.includes(file.contentType)) {
    throw new Error(`"${file.fileName}": contentType must be one of ${ATTACHMENT_CONTENT_TYPES.join(", ")}.`);
  }

  const head = Array.from(atob(data.slice(0, 16)), (char) => char.charCodeAt(0));
  const detected = SIGNATURES.find((signature) => signature.test(head));

  if (detected?.type !== file.contentType) {
    throw new Error(`"${file.fileName}": the file contents do not look like ${file.contentType}.`);
  }

  return {
    data,
    file_name: file.fileName,
    content_type: file.contentType,
    description: file.description,
  };
}

export function buildAttachmentsBody(files: FileInput[]) {
  if (files.length === 0) {
    throw new Error("Provide at least one file.");
  }

  if (files.length > MAX_FILES_PER_CALL) {
    throw new Error(`At most ${MAX_FILES_PER_CALL} files per call.`);
  }

  return { attachments: files.map(buildAttachment) };
}

/** Removes FreeAgent's signed download links, which embed short-lived credentials. */
export function stripSignedLinks<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripSignedLinks) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("content_src"))
        .map(([key, inner]) => [key, stripSignedLinks(inner)]),
    ) as T;
  }

  return value;
}
