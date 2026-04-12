import type { FreeAgentTokenResponse, OAuthStatePayload } from "../types";

const FREEAGENT_AUTHORIZE_URL = "https://api.freeagent.com/v2/approve_app";
const FREEAGENT_TOKEN_URL = "https://api.freeagent.com/v2/token_endpoint";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function createInitialMcpOAuthState(pendingAuthId: string): string {
  const payload: OAuthStatePayload = {
    kind: "mcp_init",
    pendingAuthId,
    nonce: crypto.randomUUID(),
  };

  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(encoded);
}

export function parseOAuthState(state: string): OAuthStatePayload {
  const decoded = new TextDecoder().decode(fromBase64Url(state));
  const parsed = JSON.parse(decoded) as Partial<OAuthStatePayload>;

  if (parsed.kind !== "mcp_init" || !parsed.pendingAuthId || !parsed.nonce) {
    throw new Error("Malformed OAuth state payload");
  }

  return {
    kind: "mcp_init",
    pendingAuthId: parsed.pendingAuthId,
    nonce: parsed.nonce,
  };
}

export function buildFreeAgentAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state: options.state,
  });

  return `${FREEAGENT_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<FreeAgentTokenResponse> {
  const response = await fetch(FREEAGENT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`FreeAgent token exchange failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as FreeAgentTokenResponse;
}
