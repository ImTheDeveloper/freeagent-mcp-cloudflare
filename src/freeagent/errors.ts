import { FreeAgentApiError } from "./api";

function summarizeBody(body: string): string {
  const normalized = body.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  return normalized.length > 800 ? `${normalized.slice(0, 797)}...` : normalized;
}

export function formatFreeAgentErrorMessage(errorPrefix: string, cause: unknown): string {
  if (cause instanceof FreeAgentApiError) {
    if (cause.status === 429) {
      return `${errorPrefix}: FreeAgent rate limit reached (429).${cause.retryAfterSeconds ? ` Retry after ${cause.retryAfterSeconds}s.` : ""}`;
    }

    if (cause.status === 401) {
      return `${errorPrefix}: FreeAgent returned 401. Reconnect the MCP client or refresh the authorization.`;
    }

    if (cause.status === 403) {
      return `${errorPrefix}: FreeAgent returned 403. The authenticated user likely lacks the required permission level for this resource.`;
    }

    if (cause.status === 404) {
      return `${errorPrefix}: FreeAgent returned 404. The requested resource was not found in the current account context.`;
    }

    const body = summarizeBody(cause.body);
    return body
      ? `${errorPrefix}: FreeAgent request failed (${cause.status}). ${body}`
      : `${errorPrefix}: FreeAgent request failed (${cause.status}).`;
  }

  return `${errorPrefix}: ${(cause as Error).message}`;
}
