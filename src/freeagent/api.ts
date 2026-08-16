import { getFreeAgentApiBaseUrl, getFreeAgentUserAgent, type AppEnv } from "../env";
import type { FreeAgentClient, FreeAgentCompany, FreeAgentPractice, FreeAgentUser } from "../types";

export interface PaginationMetadata {
  page: number;
  perPage: number;
  totalCount?: number;
  links: Partial<Record<"prev" | "next" | "first" | "last", string>>;
}

export class FreeAgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "FreeAgentApiError";
  }
}

function parseLinkHeader(headerValue: string | null): PaginationMetadata["links"] {
  if (!headerValue) {
    return {};
  }

  const links: PaginationMetadata["links"] = {};
  const parts = headerValue.split(",");

  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (!match) {
      continue;
    }

    const [, url, rel] = match;
    if (rel === "prev" || rel === "next" || rel === "first" || rel === "last") {
      links[rel] = url;
    }
  }

  return links;
}

function parsePaginationMetadata(response: Response, path: string): PaginationMetadata | undefined {
  const currentUrl = new URL(`https://api.freeagent.com${path}`);
  const linkHeader = response.headers.get("Link");
  const totalCountHeader = response.headers.get("X-Total-Count");
  const links = parseLinkHeader(linkHeader);

  const hasPaginationSignal =
    Boolean(linkHeader) ||
    Boolean(totalCountHeader) ||
    currentUrl.searchParams.has("page") ||
    currentUrl.searchParams.has("per_page");

  if (!hasPaginationSignal) {
    return undefined;
  }

  const totalCount = totalCountHeader ? Number(totalCountHeader) : undefined;
  const parsedTotalCount = Number.isFinite(totalCount) ? totalCount : undefined;

  return {
    page: Number(currentUrl.searchParams.get("page") ?? "1"),
    perPage: Number(currentUrl.searchParams.get("per_page") ?? "25"),
    totalCount: parsedTotalCount,
    links,
  };
}

export function buildFreeAgentHeaders(accessToken: string, env: Pick<AppEnv, "FREEAGENT_USER_AGENT">, options?: { subdomain?: string }): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": getFreeAgentUserAgent(env),
  });

  if (options?.subdomain) {
    headers.set("X-Subdomain", options.subdomain);
  }

  return headers;
}

export async function freeAgentGet<T>(
  path: string,
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
  options?: { subdomain?: string },
): Promise<T> {
  const { payload } = await freeAgentGetDetailed<T>(path, accessToken, env, options);
  return payload;
}

export async function freeAgentGetDetailed<T>(
  path: string,
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
  options?: { subdomain?: string },
): Promise<{ payload: T; pagination?: PaginationMetadata }> {
  const response = await fetch(`${getFreeAgentApiBaseUrl(env)}${path}`, {
    headers: buildFreeAgentHeaders(accessToken, env, options),
  });

  if (!response.ok) {
    throw new FreeAgentApiError(
      `FreeAgent request failed (${response.status})`,
      response.status,
      await response.text(),
      response.headers.get("Retry-After") ? Number(response.headers.get("Retry-After")) : undefined,
    );
  }

  return {
    payload: (await response.json()) as T,
    pagination: parsePaginationMetadata(response, path),
  };
}

export interface TruncationNotice {
  truncated: true;
  returned: number;
  totalCount?: number;
  nextPage: number;
  message: string;
}

/** Number of records in a collection payload such as `{ invoices: [...] }`. */
export function countCollectionItems(payload: Record<string, unknown>): number {
  return Object.values(payload).reduce<number>(
    (max, value) => (Array.isArray(value) ? Math.max(max, value.length) : max),
    0,
  );
}

/**
 * Builds an explicit in-body warning when a list response is a partial view.
 *
 * A pagination object alone is easy to read past; a truncated result that looks
 * complete leads to confidently wrong conclusions, so say so in the payload.
 */
export function buildTruncationNotice(
  pagination: PaginationMetadata,
  returned: number,
): TruncationNotice | undefined {
  const hasNextLink = Boolean(pagination.links.next);
  const knownTotalExceeded =
    pagination.totalCount !== undefined && pagination.totalCount > returned;

  if (!hasNextLink && !knownTotalExceeded) {
    return undefined;
  }

  const nextPage = pagination.page + 1;
  const total = pagination.totalCount !== undefined
    ? `${pagination.totalCount}`
    : "an unknown number of";

  return {
    truncated: true,
    returned,
    totalCount: pagination.totalCount,
    nextPage,
    message:
      `INCOMPLETE RESULT: this response contains ${returned} of ${total} records. ` +
      `Do not treat it as the full set — request page ${nextPage} (perPage up to ${FREEAGENT_MAX_PER_PAGE}) ` +
      `and combine every page before totalling, ranking, or concluding that something is absent.`,
  };
}

/** FreeAgent caps per_page at 100. */
export const FREEAGENT_MAX_PER_PAGE = 100;

/** Safety valve so a misbehaving endpoint can never spin forever. */
const MAX_AUTO_PAGES = 25;

export interface AggregatedResult<T> {
  payload: T;
  pagesFetched: number;
  /** False when the page cap stopped us before the data ran out. */
  complete: boolean;
  totalCount?: number;
}

function setQueryParam(path: string, key: string, value: string): string {
  const [basePath, queryString = ""] = path.split("?");
  const params = new URLSearchParams(queryString);
  params.set(key, value);
  return `${basePath}?${params.toString()}`;
}

function getQueryParam(path: string, key: string): string | null {
  const queryString = path.split("?")[1] ?? "";
  return new URLSearchParams(queryString).get(key);
}

/** Collection payloads are `{ invoices: [...] }` — find the array-valued keys. */
function arrayKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).filter((key) => Array.isArray(payload[key]));
}

function largestArrayLength(payload: Record<string, unknown>): number {
  return arrayKeys(payload).reduce(
    (max, key) => Math.max(max, (payload[key] as unknown[]).length),
    0,
  );
}

/**
 * Cheap identity for a page, used to detect an endpoint that ignores `page` and
 * keeps handing back page 1 — concatenating that would silently duplicate rows.
 */
function pageSignature(payload: Record<string, unknown>): string {
  const keys = arrayKeys(payload);
  return JSON.stringify(
    keys.map((key) => {
      const items = payload[key] as unknown[];
      return [key, items.length, items[0] ?? null, items[items.length - 1] ?? null];
    }),
  );
}

function mergePages<T extends Record<string, unknown>>(accumulated: T, next: T): T {
  const merged: Record<string, unknown> = { ...accumulated };

  for (const key of Object.keys(next)) {
    const nextValue = next[key];
    const existingValue = merged[key];

    if (Array.isArray(nextValue) && Array.isArray(existingValue)) {
      merged[key] = [...existingValue, ...nextValue];
    } else if (!(key in merged)) {
      merged[key] = nextValue;
    }
  }

  return merged as T;
}

/**
 * Fetches every page of a collection and concatenates the results.
 *
 * FreeAgent paginates any multi-item response at 25 rows by default, including
 * report endpoints that read as a single document. A truncated trial balance is
 * worse than no trial balance because it looks complete, so these are exhausted
 * rather than returned as a first page.
 */
export async function freeAgentGetAllPages<T extends Record<string, unknown>>(
  path: string,
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
  options?: { subdomain?: string; maxPages?: number },
): Promise<AggregatedResult<T>> {
  const maxPages = options?.maxPages ?? MAX_AUTO_PAGES;
  const requestedPerPage = Number(getQueryParam(path, "per_page") ?? FREEAGENT_MAX_PER_PAGE);
  const perPage = Number.isFinite(requestedPerPage) && requestedPerPage > 0
    ? Math.min(requestedPerPage, FREEAGENT_MAX_PER_PAGE)
    : FREEAGENT_MAX_PER_PAGE;

  const startPage = Number(getQueryParam(path, "page") ?? 1);
  const firstPage = Number.isFinite(startPage) && startPage > 0 ? startPage : 1;

  let accumulated: T | undefined;
  let totalCount: number | undefined;
  let pagesFetched = 0;
  let complete = true;
  const seenSignatures = new Set<string>();

  for (let page = firstPage; page < firstPage + maxPages; page += 1) {
    const pagePath = setQueryParam(
      setQueryParam(path, "per_page", String(perPage)),
      "page",
      String(page),
    );

    let page1: Awaited<ReturnType<typeof freeAgentGetDetailed<T>>>;

    try {
      page1 = await freeAgentGetDetailed<T>(pagePath, accessToken, env, options);
    } catch (cause) {
      // If an endpoint rejects the pagination params outright, fall back to the
      // caller's original path so adding auto-pagination can't break it.
      if (
        pagesFetched === 0 &&
        cause instanceof FreeAgentApiError &&
        (cause.status === 400 || cause.status === 422)
      ) {
        const fallback = await freeAgentGetDetailed<T>(path, accessToken, env, options);
        return {
          payload: fallback.payload,
          pagesFetched: 1,
          complete: true,
          totalCount: fallback.pagination?.totalCount,
        };
      }

      throw cause;
    }

    const { payload, pagination } = page1;
    pagesFetched += 1;
    totalCount = pagination?.totalCount ?? totalCount;

    const signature = pageSignature(payload);
    if (pagesFetched > 1 && seenSignatures.has(signature)) {
      // Endpoint ignored `page`; stop before duplicating what we already have.
      break;
    }
    seenSignatures.add(signature);

    accumulated = accumulated ? mergePages(accumulated, payload) : payload;

    const pageItemCount = largestArrayLength(payload);
    const accumulatedCount = largestArrayLength(accumulated as Record<string, unknown>);

    // A short page always means the end. Otherwise keep going only on a positive
    // signal, so a non-paginated endpoint is never re-requested.
    if (pageItemCount < perPage) {
      break;
    }

    const hasMore = Boolean(pagination?.links.next) ||
      (totalCount !== undefined && accumulatedCount < totalCount) ||
      pageItemCount === perPage;

    if (!hasMore) {
      break;
    }

    if (page === firstPage + maxPages - 1) {
      complete = false;
    }
  }

  return {
    payload: (accumulated ?? ({} as T)),
    pagesFetched,
    complete,
    totalCount,
  };
}

export async function fetchCurrentUser(
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
): Promise<FreeAgentUser> {
  const payload = await freeAgentGet<{ user?: FreeAgentUser }>("/v2/users/me", accessToken, env);

  if (!payload.user) {
    throw new Error("FreeAgent users/me response did not include a user payload.");
  }

  return payload.user;
}

export async function fetchCompany(
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
  options?: { subdomain?: string },
): Promise<FreeAgentCompany> {
  const payload = await freeAgentGet<{ company?: FreeAgentCompany }>("/v2/company", accessToken, env, options);

  if (!payload.company) {
    throw new Error("FreeAgent company response did not include a company payload.");
  }

  return payload.company;
}

export async function fetchPractice(
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
): Promise<FreeAgentPractice> {
  return freeAgentGet<FreeAgentPractice>("/v2/practice", accessToken, env);
}

export async function listPracticeClients(
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
): Promise<FreeAgentClient[]> {
  const payload = await freeAgentGet<{ clients?: FreeAgentClient[] }>(
    "/v2/clients?minimal_data=true&per_page=500",
    accessToken,
    env,
  );

  return payload.clients ?? [];
}
