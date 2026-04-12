import { describe, expect, it, vi, afterEach } from "vitest";
import { createInitialMcpOAuthState, parseOAuthState } from "../src/auth/oauth";
import { decryptToken, encryptToken } from "../src/auth/crypto";
import { handleAuthorizeRequest } from "../src/auth/authorize-handler";
import { handleOAuthCallback } from "../src/auth/callback";
import { ensureValidAccessToken } from "../src/freeagent/token";
import type { SessionState } from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function createAuthStoreStub(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return {
    idFromName(name: string) {
      return name;
    },
    get(_id: string) {
      return {
        fetch(input: string | Request, init?: RequestInit) {
          const requestUrl = typeof input === "string" ? new URL(input) : new URL(input.url);
          return handler(requestUrl, init);
        },
      };
    },
  } as unknown as DurableObjectNamespace;
}

describe("oauth helpers", () => {
  it("round-trips mcp oauth state", () => {
    const state = createInitialMcpOAuthState("pending-123");

    expect(parseOAuthState(state)).toMatchObject({
      kind: "mcp_init",
      pendingAuthId: "pending-123",
    });
  });

  it("encrypts and decrypts token payloads", async () => {
    const secret = "test-secret";
    const encrypted = await encryptToken("hello-token", secret);

    expect(encrypted).not.toContain("hello-token");
    await expect(decryptToken(encrypted, secret)).resolves.toBe("hello-token");
  });
});

describe("authorize handler", () => {
  it("creates pending auth state and redirects to FreeAgent", async () => {
    let storedRecord: unknown = null;

    const response = await handleAuthorizeRequest(
      new Request("https://example.com/authorize?client_id=test"),
      {
        FREEAGENT_CLIENT_ID: "freeagent-client",
        WORKER_BASE_URL: "https://worker.example.com",
        OAUTH_PROVIDER: {
          async parseAuthRequest() {
            return { clientId: "test-client", scope: ["mcp"] };
          },
          async completeAuthorization() {
            return { redirectTo: "https://unused.example.com" };
          },
        },
        AUTH_STORE: createAuthStoreStub(async (url, init) => {
          if (url.pathname === "/pending" && init?.method === "POST") {
            storedRecord = JSON.parse(init.body as string);
            return new Response(null, { status: 204 });
          }

          return new Response("not found", { status: 404 });
        }),
      },
    );

    expect(response.status).toBe(302);
    expect(storedRecord).toBeTruthy();

    const location = response.headers.get("location");
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe("https://api.freeagent.com/v2/approve_app");
    expect(redirectUrl.searchParams.get("client_id")).toBe("freeagent-client");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe("https://worker.example.com/callback");
    expect(redirectUrl.searchParams.get("state")).toBeTruthy();
  });
});

describe("oauth callback", () => {
  it("exchanges tokens, stores auth, and completes authorization", async () => {
    let patchedRecord: unknown = null;
    const pendingOauthRequest = { scope: ["mcp"] };
    const state = createInitialMcpOAuthState("pending-456");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = getRequestUrl(input as string | URL | Request);

      if (url === "https://api.freeagent.com/v2/token_endpoint") {
        return Response.json({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      if (url === "https://api.freeagent.com/v2/users/me") {
        return Response.json({
          user: {
            url: "https://api.freeagent.com/v2/users/1",
            email: "User@Example.com",
            first_name: "Test",
            last_name: "User",
          },
        });
      }

      if (url === "https://api.freeagent.com/v2/company") {
        return Response.json({
          company: {
            id: 1,
            name: "Example Company",
            subdomain: "example-company",
            type: "UkLimitedCompany",
            currency: "GBP",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const response = await handleOAuthCallback(
      new Request(`https://worker.example.com/callback?state=${encodeURIComponent(state)}&code=test-code`),
      {
        FREEAGENT_CLIENT_ID: "freeagent-client",
        FREEAGENT_CLIENT_SECRET: "freeagent-secret",
        TOKEN_ENCRYPTION_KEY: "encryption-secret",
        WORKER_BASE_URL: "https://worker.example.com",
        FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
        FREEAGENT_USER_AGENT: "freeagent-mcp/0.1.0",
        OAUTH_PROVIDER: {
          async parseAuthRequest() {
            return {};
          },
          async completeAuthorization() {
            return { redirectTo: "https://client.example.com/done" };
          },
        },
        AUTH_STORE: createAuthStoreStub(async (url, init) => {
          if (url.pathname === "/record" && init?.method === "GET") {
            return Response.json(null);
          }

          if (url.pathname === "/consume" && init?.method === "POST") {
            return Response.json({
              oauthRequest: pendingOauthRequest,
              createdAt: Date.now(),
            });
          }

          if (url.pathname === "/record" && init?.method === "POST") {
            patchedRecord = JSON.parse(init.body as string);
            return Response.json({ ok: true });
          }

          return new Response("not found", { status: 404 });
        }),
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://client.example.com/done");
    expect(patchedRecord).toMatchObject({
      patch: {
        principalId: "user@example.com",
        mode: "company",
        tokenExpiresAt: expect.any(Number),
        company: {
          name: "Example Company",
          subdomain: "example-company",
        },
        userProfile: {
          email: "user@example.com",
          firstName: "Test",
          lastName: "User",
        },
      },
    });
  });
});

describe("freeagent token refresh", () => {
  it("refreshes expired tokens and rotates the refresh token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );

    const state: SessionState = {
      principalId: "user@example.com",
      mode: null,
      userProfile: null,
      company: null,
      practice: null,
      clients: [],
      activeSubdomain: null,
      encryptedAccessToken: await encryptToken("old-access", "refresh-secret"),
      encryptedRefreshToken: await encryptToken("old-refresh", "refresh-secret"),
      tokenExpiresAt: Date.now() - 1000,
      oauthState: null,
      oauthStateCreatedAt: null,
      lastActivityAt: null,
    };

    const { accessToken, nextState } = await ensureValidAccessToken(state, {
      FREEAGENT_CLIENT_ID: "freeagent-client",
      FREEAGENT_CLIENT_SECRET: "freeagent-secret",
      FREEAGENT_API_BASE_URL: "https://api.freeagent.com",
      TOKEN_ENCRYPTION_KEY: "refresh-secret",
    });

    expect(accessToken).toBe("fresh-access");
    await expect(decryptToken(nextState.encryptedAccessToken!, "refresh-secret")).resolves.toBe("fresh-access");
    await expect(decryptToken(nextState.encryptedRefreshToken!, "refresh-secret")).resolves.toBe("fresh-refresh");
  });
});
