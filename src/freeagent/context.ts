import { getFreeAgentMode, type AppEnv } from "../env";
import type { FreeAgentClient, FreeAgentCompany, FreeAgentPractice, SessionState } from "../types";
import { fetchCompany, fetchPractice, listPracticeClients } from "./api";

export interface AccountContextSnapshot {
  mode: SessionState["mode"];
  company: FreeAgentCompany | null;
  practice: FreeAgentPractice | null;
  clients: FreeAgentClient[];
  activeSubdomain: string | null;
}

export function resolveActiveSubdomain(
  clients: FreeAgentClient[],
  preferredSubdomain: string | null,
): string | null {
  if (preferredSubdomain && clients.some((client) => client.subdomain === preferredSubdomain)) {
    return preferredSubdomain;
  }

  return clients.find((client) => typeof client.subdomain === "string" && client.subdomain.length > 0)?.subdomain ?? null;
}

export async function bootstrapAccountContext(
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_MODE" | "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
  options?: { preferredActiveSubdomain?: string | null },
): Promise<AccountContextSnapshot> {
  const mode = getFreeAgentMode(env);

  if (mode === "company") {
    const company = await fetchCompany(accessToken, env);
    return {
      mode,
      company,
      practice: null,
      clients: [],
      activeSubdomain: typeof company.subdomain === "string" ? company.subdomain : null,
    };
  }

  const practice = await fetchPractice(accessToken, env);
  const clients = await listPracticeClients(accessToken, env);
  const activeSubdomain = resolveActiveSubdomain(clients, options?.preferredActiveSubdomain ?? null);
  const company = activeSubdomain
    ? await fetchCompany(accessToken, env, { subdomain: activeSubdomain })
    : null;

  return {
    mode,
    company,
    practice,
    clients,
    activeSubdomain,
  };
}

export async function switchActiveClientContext(
  accessToken: string,
  env: Pick<AppEnv, "FREEAGENT_API_BASE_URL" | "FREEAGENT_USER_AGENT">,
  clients: FreeAgentClient[],
  subdomain: string,
): Promise<Pick<AccountContextSnapshot, "company" | "activeSubdomain">> {
  if (!clients.some((client) => client.subdomain === subdomain)) {
    throw new Error(`Client subdomain not found: ${subdomain}`);
  }

  const company = await fetchCompany(accessToken, env, { subdomain });
  return {
    company,
    activeSubdomain: subdomain,
  };
}
