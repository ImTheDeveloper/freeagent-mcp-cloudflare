export interface SessionState {
  principalId: string | null;
  mode: "company" | "practice" | null;
  userProfile: FreeAgentUserSummary | null;
  company: FreeAgentCompany | null;
  practice: FreeAgentPractice | null;
  clients: FreeAgentClient[];
  activeSubdomain: string | null;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: number | null;
  oauthState: string | null;
  oauthStateCreatedAt: number | null;
  lastActivityAt: number | null;
}

export const DEFAULT_SESSION_STATE: SessionState = {
  principalId: null,
  mode: null,
  userProfile: null,
  company: null,
  practice: null,
  clients: [],
  activeSubdomain: null,
  encryptedAccessToken: null,
  encryptedRefreshToken: null,
  tokenExpiresAt: null,
  oauthState: null,
  oauthStateCreatedAt: null,
  lastActivityAt: null,
};

export interface FreeAgentUserSummary {
  url: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface FreeAgentCompany {
  id?: number | string;
  url?: string;
  name?: string;
  subdomain?: string;
  type?: string;
  currency?: string;
  [key: string]: unknown;
}

export interface FreeAgentPractice {
  name?: string;
  subdomain?: string;
  [key: string]: unknown;
}

export interface FreeAgentClient {
  id?: number;
  name?: string;
  subdomain?: string;
  status?: string;
  [key: string]: unknown;
}

export interface FreeAgentUser {
  url?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
}

export type OAuthStatePayload = {
  kind: "mcp_init";
  pendingAuthId: string;
  nonce: string;
};

export interface FreeAgentTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}
