#!/usr/bin/env node

import { createServer } from "node:http";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const serverUrl = process.argv[2] || process.env.MCP_SERVER_URL;
const callbackPort = Number(process.env.MCP_CALLBACK_PORT || "8090");
const callbackUrl = `http://127.0.0.1:${callbackPort}/callback`;
const callbackTimeoutMs = 10 * 60 * 1000;

if (!serverUrl) {
  console.error("Usage: node scripts/live-company-smoke.mjs <mcp-server-url>");
  process.exit(1);
}

class InMemoryOAuthClientProvider {
  constructor(redirectUrl, clientMetadata, onRedirect) {
    this._redirectUrl = redirectUrl;
    this._clientMetadata = clientMetadata;
    this._onRedirect = onRedirect;
    this._clientInformation = undefined;
    this._tokens = undefined;
    this._codeVerifier = undefined;
    this._discoveryState = undefined;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return this._clientMetadata;
  }

  clientInformation() {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation) {
    this._clientInformation = clientInformation;
  }

  tokens() {
    return this._tokens;
  }

  saveTokens(tokens) {
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl) {
    this._onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier) {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier() {
    if (!this._codeVerifier) {
      throw new Error("No code verifier saved");
    }

    return this._codeVerifier;
  }

  saveDiscoveryState(state) {
    this._discoveryState = state;
  }

  discoveryState() {
    return this._discoveryState;
  }
}

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === "/favicon.ico") {
        res.writeHead(404);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || "", "http://127.0.0.1");
      const code = parsedUrl.searchParams.get("code");
      const error = parsedUrl.searchParams.get("error");

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html>
            <body>
              <h1>Authorization Successful</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>setTimeout(() => window.close(), 1500);</script>
            </body>
          </html>
        `);
        resolve({ code, server });
        return;
      }

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html>
            <body>
              <h1>Authorization Failed</h1>
              <p>${error}</p>
            </body>
          </html>
        `);
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing authorization code");
      reject(new Error("No authorization code provided"));
    });

    server.on("error", reject);

    server.listen(callbackPort, "127.0.0.1", () => {
      console.log(`OAuth callback server listening on ${callbackUrl}`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error(`Timed out waiting ${callbackTimeoutMs / 1000}s for OAuth callback`));
    }, callbackTimeoutMs).unref();
  });
}

async function callToolAndPrint(client, name, args = undefined) {
  console.log(`\n==> Calling tool: ${name}`);
  const result = await client.callTool({
    name,
    arguments: args,
  });

  const rendered = JSON.stringify(result, null, 2);
  console.log(rendered.length > 4000 ? `${rendered.slice(0, 4000)}\n...<truncated>` : rendered);
}

async function run() {
  const clientMetadata = {
    client_name: "FreeAgent MCP Live Smoke Client",
    redirect_uris: [callbackUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };

  let lastAuthorizationUrl = null;

  const authProvider = new InMemoryOAuthClientProvider(callbackUrl, clientMetadata, (authorizationUrl) => {
    lastAuthorizationUrl = authorizationUrl.toString();
    console.log("\nOpen this URL in your normal browser and complete FreeAgent login:\n");
    console.log(lastAuthorizationUrl);
    console.log("");
  });

  const client = new Client(
    {
      name: "freeagent-live-company-smoke",
      version: "0.1.0",
    },
    { capabilities: {} },
  );

  let activeTransport;

  try {
    activeTransport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider,
    });
    await client.connect(activeTransport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }

    if (!lastAuthorizationUrl) {
      throw new Error("OAuth authorization URL was not generated");
    }

    const { code, server } = await startCallbackServer();

    const exchangeTransport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider,
    });

    await exchangeTransport.finishAuth(code);
    server.close();

    activeTransport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider,
    });

    await client.connect(activeTransport);
  }

  console.log("\nConnected successfully. Running smoke checks...");

  const tools = await client.listTools();
  console.log(`\nDiscovered ${tools.tools.length} tools.`);

  // Any list_/report tool advertising no parameters is the pagination bug:
  // callers cannot override the 25-row default they cannot see.
  const missingParams = tools.tools.filter(
    (tool) =>
      (tool.name.startsWith("list_") || tool.name.startsWith("get_")) &&
      Object.keys(tool.inputSchema?.properties ?? {}).length === 0 &&
      !["get_me", "get_company", "get_practice", "get_invoice_timeline", "get_company_tax_timeline"].includes(
        tool.name,
      ),
  );

  console.log("\nTools advertising no parameters:");
  console.log(missingParams.length ? missingParams.map((tool) => `  - ${tool.name}`).join("\n") : "  (none)");

  const invoiceSchema = tools.tools.find((tool) => tool.name === "list_invoices");
  console.log(
    `\nlist_invoices parameters: ${Object.keys(invoiceSchema?.inputSchema?.properties ?? {}).join(", ") || "NONE"}`,
  );

  await callToolAndPrint(client, "auth_status");
  await callToolAndPrint(client, "get_me");
  await callToolAndPrint(client, "get_company");
  await callToolAndPrint(client, "get_balance_sheet");
  await callToolAndPrint(client, "get_profit_and_loss");
  // Must return every nominal code, not just the first 25.
  await callToolAndPrint(client, "get_trial_balance_summary");
  await callToolAndPrint(client, "list_invoices", { page: 1, perPage: 10 });
  await callToolAndPrint(client, "list_bank_accounts", { page: 1, perPage: 20 });
  await callToolAndPrint(client, "list_transactions", { page: 1, perPage: 10 });

  await activeTransport?.close();
  console.log("\nSmoke test completed.");
}

run().catch((error) => {
  console.error("\nSmoke test failed:", error);
  process.exit(1);
});
