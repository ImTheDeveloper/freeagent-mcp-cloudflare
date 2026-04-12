export type FreeAgentMode = "company" | "practice";

export interface OAuthProviderBinding {
  parseAuthRequest(request: Request): Promise<unknown>;
  completeAuthorization(options: {
    request: unknown;
    userId: string;
    metadata?: { label?: string };
    scope?: string[];
    props?: Record<string, unknown>;
  }): Promise<{ redirectTo: string }>;
}

export interface AppEnv {
  FREEAGENT_CLIENT_ID?: string;
  FREEAGENT_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  FREEAGENT_MODE?: FreeAgentMode;
  FREEAGENT_API_BASE_URL?: string;
  FREEAGENT_USER_AGENT?: string;
}

export function getFreeAgentMode(env: Pick<AppEnv, "FREEAGENT_MODE">): FreeAgentMode {
  return env.FREEAGENT_MODE === "practice" ? "practice" : "company";
}

export function getFreeAgentApiBaseUrl(env: Pick<AppEnv, "FREEAGENT_API_BASE_URL">): string {
  return env.FREEAGENT_API_BASE_URL ?? "https://api.freeagent.com";
}

export function getFreeAgentUserAgent(env: Pick<AppEnv, "FREEAGENT_USER_AGENT">): string {
  return env.FREEAGENT_USER_AGENT ?? "freeagent-mcp/0.1.0";
}
