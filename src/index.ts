import { OAuthProvider, getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { FreeAgentMCP } from "./agent";
import { AuthStore } from "./auth-store";
import { handleAuthorizeRequest } from "./auth/authorize-handler";
import { handleOAuthCallback } from "./auth/callback";
import { notFoundResponse, textResponse } from "./http";
import type { AppEnv } from "./env";

const oauthProviderOptions = {
  apiRoute: "/mcp",
  apiHandler: FreeAgentMCP.serve("/mcp"),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  defaultHandler: {
    async fetch(request: Request, env: AppEnv): Promise<Response> {
      const url = new URL(request.url);
      const oauthProvider = getOAuthApi(oauthProviderOptions, env);

      if (url.pathname === "/authorize") {
        return handleAuthorizeRequest(request, {
          ...env,
          AUTH_STORE: (env as AppEnv & { AUTH_STORE: DurableObjectNamespace }).AUTH_STORE,
          OAUTH_PROVIDER: oauthProvider,
        });
      }

      if (url.pathname === "/callback") {
        return handleOAuthCallback(request, {
          ...env,
          AUTH_STORE: (env as AppEnv & { AUTH_STORE: DurableObjectNamespace }).AUTH_STORE,
          OAUTH_PROVIDER: oauthProvider,
        });
      }

      if (url.pathname === "/health") {
        return textResponse("ok");
      }

      return notFoundResponse();
    },
  },
};

export default new OAuthProvider(oauthProviderOptions);

export { AuthStore, FreeAgentMCP };
