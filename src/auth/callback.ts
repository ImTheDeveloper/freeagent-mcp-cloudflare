import type { AppEnv, OAuthProviderBinding } from "../env";
import { fetchCurrentUser } from "../freeagent/api";
import { bootstrapAccountContext } from "../freeagent/context";
import { encryptToken } from "./crypto";
import { consumePendingOAuthRequest } from "./pending";
import { exchangeAuthorizationCode, parseOAuthState } from "./oauth";
import { getPrincipalAuthRecord, patchPrincipalAuthRecord } from "./store";
import type { FreeAgentUser, FreeAgentUserSummary } from "../types";

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

interface CallbackEnv extends AppEnv {
  AUTH_STORE: DurableObjectNamespace;
  OAUTH_PROVIDER?: OAuthProviderBinding;
  WORKER_BASE_URL?: string;
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function toUserSummary(user: FreeAgentUser): FreeAgentUserSummary {
  return {
    url: typeof user.url === "string" ? user.url : null,
    email: typeof user.email === "string" ? user.email.toLowerCase() : null,
    firstName: typeof user.first_name === "string" ? user.first_name : null,
    lastName: typeof user.last_name === "string" ? user.last_name : null,
  };
}

function getPrincipalIdFromUser(user: FreeAgentUser): string {
  if (typeof user.email === "string" && user.email.includes("@")) {
    return user.email.toLowerCase();
  }

  if (typeof user.url === "string" && user.url.length > 0) {
    return user.url;
  }

  throw new Error("Unable to extract principal identity from FreeAgent user profile.");
}

export async function handleOAuthCallback(request: Request, env: CallbackEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return html(`<h1>FreeAgent authorization failed</h1><p>${error}</p><p>You can close this tab.</p>`);
  }

  if (!state || !code) {
    return new Response("Missing required query params: state and code", { status: 400 });
  }

  if (
    !env.FREEAGENT_CLIENT_ID ||
    !env.FREEAGENT_CLIENT_SECRET ||
    !env.TOKEN_ENCRYPTION_KEY ||
    !env.WORKER_BASE_URL
  ) {
    return new Response("Missing required OAuth secrets in Worker environment.", { status: 500 });
  }

  if (!env.OAUTH_PROVIDER) {
    return new Response("OAuth provider bindings are unavailable.", { status: 500 });
  }

  let oauthState: ReturnType<typeof parseOAuthState>;
  try {
    oauthState = parseOAuthState(state);
  } catch {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  try {
    const redirectUri = `${env.WORKER_BASE_URL}/callback`;
    const tokens = await exchangeAuthorizationCode({
      code,
      redirectUri,
      clientId: env.FREEAGENT_CLIENT_ID,
      clientSecret: env.FREEAGENT_CLIENT_SECRET,
    });

    const user = await fetchCurrentUser(tokens.access_token, env);
    const principalId = getPrincipalIdFromUser(user);
    const userProfile = toUserSummary(user);
    const currentRecord = await getPrincipalAuthRecord(env, principalId);
    const accountContext = await bootstrapAccountContext(tokens.access_token, env, {
      preferredActiveSubdomain: currentRecord?.activeSubdomain ?? null,
    });

    const encryptedAccessToken = await encryptToken(tokens.access_token, env.TOKEN_ENCRYPTION_KEY);
    const encryptedRefreshToken = await encryptToken(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY);

    const pendingAuth = await consumePendingOAuthRequest(env, oauthState.pendingAuthId);
    if (!pendingAuth) {
      return new Response("Authorization session expired. Please reconnect from your MCP client.", {
        status: 400,
      });
    }

    if (Date.now() - pendingAuth.createdAt > PENDING_AUTH_TTL_MS) {
      return new Response("Authorization session expired. Please reconnect from your MCP client.", {
        status: 400,
      });
    }

    await patchPrincipalAuthRecord(env, principalId, {
      principalId,
      mode: accountContext.mode,
      userProfile,
      company: accountContext.company,
      practice: accountContext.practice,
      clients: accountContext.clients,
      activeSubdomain: accountContext.activeSubdomain,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      oauthState: null,
      oauthStateCreatedAt: null,
    });

    const requestedScope = Array.isArray((pendingAuth.oauthRequest as { scope?: unknown }).scope)
      ? ((pendingAuth.oauthRequest as { scope?: string[] }).scope ?? [])
      : undefined;

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: pendingAuth.oauthRequest,
      userId: principalId,
      metadata: { label: "FreeAgent MCP" },
      scope: requestedScope,
      props: {
        sub: principalId,
        userId: principalId,
        email: userProfile.email,
      },
    });

    return Response.redirect(redirectTo, 302);
  } catch (cause) {
    console.error("OAuth callback handling failed", cause);
    return new Response("Failed to complete OAuth callback", { status: 500 });
  }
}
