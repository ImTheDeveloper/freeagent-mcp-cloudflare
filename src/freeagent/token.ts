import type { AppEnv } from "../env";
import { getFreeAgentApiBaseUrl } from "../env";
import { decryptToken, encryptToken } from "../auth/crypto";
import type { FreeAgentTokenResponse, SessionState } from "../types";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface TokenEnv extends Pick<AppEnv, "FREEAGENT_CLIENT_ID" | "FREEAGENT_CLIENT_SECRET" | "TOKEN_ENCRYPTION_KEY" | "FREEAGENT_API_BASE_URL"> {}

export async function refreshAccessToken(
  refreshToken: string,
  env: Pick<TokenEnv, "FREEAGENT_CLIENT_ID" | "FREEAGENT_CLIENT_SECRET" | "FREEAGENT_API_BASE_URL">,
): Promise<FreeAgentTokenResponse> {
  if (!env.FREEAGENT_CLIENT_ID || !env.FREEAGENT_CLIENT_SECRET) {
    throw new Error("Missing FREEAGENT_CLIENT_ID or FREEAGENT_CLIENT_SECRET");
  }

  const response = await fetch(`${getFreeAgentApiBaseUrl(env)}/v2/token_endpoint`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.FREEAGENT_CLIENT_ID,
      client_secret: env.FREEAGENT_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    const body = await response.text();
    if (response.status === 429) {
      throw new Error(
        `FreeAgent token refresh failed (429).${retryAfter ? ` Retry after ${retryAfter}s.` : ""}`,
      );
    }

    throw new Error(`FreeAgent token refresh failed (${response.status}): ${body}`);
  }

  return (await response.json()) as FreeAgentTokenResponse;
}

export async function ensureValidAccessToken(
  state: SessionState,
  env: TokenEnv,
): Promise<{ accessToken: string; nextState: SessionState }> {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }

  if (
    state.encryptedAccessToken &&
    state.tokenExpiresAt &&
    Date.now() < state.tokenExpiresAt - REFRESH_BUFFER_MS
  ) {
    return {
      accessToken: await decryptToken(state.encryptedAccessToken, env.TOKEN_ENCRYPTION_KEY),
      nextState: state,
    };
  }

  if (!state.encryptedRefreshToken) {
    throw new Error("No refresh token found. Reconnect the MCP connector.");
  }

  const refreshToken = await decryptToken(state.encryptedRefreshToken, env.TOKEN_ENCRYPTION_KEY);
  const refreshed = await refreshAccessToken(refreshToken, env);

  const nextState: SessionState = {
    ...state,
    encryptedAccessToken: await encryptToken(refreshed.access_token, env.TOKEN_ENCRYPTION_KEY),
    encryptedRefreshToken: await encryptToken(refreshed.refresh_token, env.TOKEN_ENCRYPTION_KEY),
    tokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
  };

  return {
    accessToken: refreshed.access_token,
    nextState,
  };
}
