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
