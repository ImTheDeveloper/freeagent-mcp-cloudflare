import type { AppEnv, OAuthProviderBinding } from "../env";
import { textResponse } from "../http";
import { createPendingAuthId, putPendingOAuthRequest } from "./pending";
import { buildFreeAgentAuthorizeUrl, createInitialMcpOAuthState } from "./oauth";

interface AuthorizeEnv extends AppEnv {
  OAUTH_PROVIDER?: OAuthProviderBinding;
  AUTH_STORE: DurableObjectNamespace;
  WORKER_BASE_URL?: string;
}

export async function handleAuthorizeRequest(request: Request, env: AuthorizeEnv): Promise<Response> {
  if (!env.OAUTH_PROVIDER) {
    return textResponse("OAuth provider binding is unavailable.", 500);
  }

  if (!env.AUTH_STORE) {
    return textResponse("Auth store binding is unavailable.", 500);
  }

  if (!env.FREEAGENT_CLIENT_ID) {
    return textResponse("FREEAGENT_CLIENT_ID is missing from Worker secrets.", 500);
  }

  if (!env.WORKER_BASE_URL) {
    return textResponse("WORKER_BASE_URL is not configured in Worker environment.", 500);
  }

  if (request.method !== "GET") {
    return textResponse("Method not allowed", 405);
  }

  let oauthRequest: unknown;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch {
    return textResponse("Invalid OAuth authorization request.", 400);
  }

  const pendingAuthId = createPendingAuthId();
  await putPendingOAuthRequest(env, pendingAuthId, {
    oauthRequest,
    createdAt: Date.now(),
  });

  const freeAgentState = createInitialMcpOAuthState(pendingAuthId);
  const authorizeUrl = buildFreeAgentAuthorizeUrl({
    clientId: env.FREEAGENT_CLIENT_ID,
    redirectUri: `${env.WORKER_BASE_URL}/callback`,
    state: freeAgentState,
  });

  return Response.redirect(authorizeUrl, 302);
}
