import type { IncomingMessage, ServerResponse } from "node:http";
import {
  McpOAuthService,
  MCP_OAUTH_SCOPE,
  OAuthProtocolError,
  extractBearerToken,
} from "./mcp-oauth.js";

const MAX_BODY_BYTES = 1024 * 1024;

export type OAuthHttpOptions = {
  authenticateUser: (username: string, password: string) => boolean;
  isUserAuthenticated?: (req: IncomingMessage) => boolean;
};

function securityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendOAuthError(res: ServerResponse, error: unknown): void {
  if (error instanceof OAuthProtocolError) {
    sendJson(res, error.status, { error: error.error, error_description: error.message });
    return;
  }
  sendJson(res, 400, { error: "invalid_request", error_description: "Malformed OAuth request" });
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    req.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        reject(new OAuthProtocolError("invalid_request", "request body is too large", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderApproval(input: {
  requestId: string;
  clientName: string;
  scope: string;
  resource: string;
  authenticated: boolean;
  error?: string;
}): string {
  const credentials = input.authenticated
    ? "<p>Authenticated with the current dashboard session.</p>"
    : `<label>Username <input name="username" autocomplete="username" required></label>
       <label>Password <input name="password" type="password" autocomplete="current-password" required></label>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Authorize MCP client</title><style>
body{font:16px system-ui;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#18202a}code{word-break:break-all}
form{display:grid;gap:1rem;padding:1.25rem;border:1px solid #ccd3dc;border-radius:.5rem}label{display:grid;gap:.35rem}
input,button{font:inherit;padding:.65rem}.actions{display:flex;gap:.75rem}.error{color:#a11212}
</style></head><body><h1>Authorize Harness MCP</h1>
${input.error ? `<p class="error">${htmlEscape(input.error)}</p>` : ""}
<p><strong>${htmlEscape(input.clientName)}</strong> requests <code>${htmlEscape(input.scope)}</code> access to:</p>
<p><code>${htmlEscape(input.resource)}</code></p>
<form method="post" action="/authorize">
<input type="hidden" name="request_id" value="${htmlEscape(input.requestId)}">
${credentials}<div class="actions"><button name="action" value="approve" type="submit">Authorize</button>
<button name="action" value="deny" type="submit">Deny</button></div></form></body></html>`;
}

function isMetadataPath(pathname: string): boolean {
  return pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp";
}

export async function handleMcpOAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  oauth: McpOAuthService,
  options: OAuthHttpOptions,
): Promise<boolean> {
  if (req.method === "GET" && isMetadataPath(url.pathname)) {
    sendJson(res, 200, oauth.protectedResourceMetadata());
    return true;
  }
  if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    sendJson(res, 200, oauth.authorizationServerMetadata());
    return true;
  }
  if (req.method === "POST" && url.pathname === "/register") {
    try {
      const input = JSON.parse(await readBody(req)) as Record<string, unknown>;
      sendJson(res, 201, oauth.registerClient(input));
    } catch (error) {
      sendOAuthError(res, error);
    }
    return true;
  }
  if (req.method === "GET" && url.pathname === "/authorize") {
    try {
      const pending = oauth.beginAuthorization(url.searchParams);
      securityHeaders(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderApproval({
        ...pending,
        authenticated: options.isUserAuthenticated?.(req) ?? false,
      }));
    } catch (error) {
      sendOAuthError(res, error);
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/authorize") {
    try {
      const form = new URLSearchParams(await readBody(req));
      const requestId = form.get("request_id") ?? "";
      if (form.get("action") === "deny") {
        res.writeHead(302, { Location: oauth.denyAuthorization(requestId), "Cache-Control": "no-store" });
        res.end();
        return true;
      }
      const authenticated = options.isUserAuthenticated?.(req) ?? false;
      if (!authenticated && !options.authenticateUser(form.get("username") ?? "", form.get("password") ?? "")) {
        throw new OAuthProtocolError("access_denied", "Invalid administrator credentials", 401);
      }
      res.writeHead(302, { Location: oauth.approveAuthorization(requestId), "Cache-Control": "no-store" });
      res.end();
    } catch (error) {
      sendOAuthError(res, error);
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/token") {
    try {
      const params = new URLSearchParams(await readBody(req));
      sendJson(res, 200, oauth.exchangeAuthorizationCode(params));
    } catch (error) {
      sendOAuthError(res, error);
    }
    return true;
  }
  return false;
}

export function requireMcpBearer(
  req: IncomingMessage,
  res: ServerResponse,
  oauth: McpOAuthService,
): boolean {
  const validation = oauth.validateAccessToken(extractBearerToken(req.headers.authorization));
  if (validation.ok) return true;
  const metadata = `${oauth.issuer}/.well-known/oauth-protected-resource/mcp`;
  const insufficient = validation.reason === "insufficient_scope";
  const status = insufficient ? 403 : 401;
  const parameters = insufficient
    ? `error="insufficient_scope", scope="${MCP_OAUTH_SCOPE}"`
    : `resource_metadata="${metadata}", scope="${MCP_OAUTH_SCOPE}"`;
  res.setHeader("WWW-Authenticate", `Bearer ${parameters}`);
  sendJson(res, status, {
    error: insufficient ? "insufficient_scope" : "invalid_token",
    error_description: validation.reason,
  });
  return false;
}
