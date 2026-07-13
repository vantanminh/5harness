import type { IncomingMessage, ServerResponse } from "node:http";
import {
  McpOAuthService,
  MCP_OAUTH_SCOPE,
  OAuthProtocolError,
  extractBearerToken,
} from "./mcp-oauth.js";
import { renderApprovalPage } from "./auth-pages.js";

const MAX_BODY_BYTES = 1024 * 1024;

export type OAuthHttpOptions = {
  /** Session cookie (or equivalent) — required to show/approve consent. */
  isUserAuthenticated: (req: IncomingMessage) => boolean;
};

function securityHeaders(res: ServerResponse, callbackOrigin?: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const formAction = callbackOrigin ? `'self' ${callbackOrigin}` : "'self'";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'`,
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
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

function isMetadataPath(pathname: string): boolean {
  return pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp";
}

function loginRedirectLocation(url: URL): string {
  const target = `${url.pathname}${url.search}`;
  return `/login?redirect=${encodeURIComponent(target)}`;
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
      // Validate OAuth params first so bad clients fail before login.
      const pending = oauth.beginAuthorization(url.searchParams);
      if (!options.isUserAuthenticated(req)) {
        securityHeaders(res);
        res.writeHead(302, {
          Location: loginRedirectLocation(url),
          "Cache-Control": "no-store",
        });
        res.end();
        return true;
      }
      // A browser applies form-action across redirects. Allow only the origin
      // of the already validated, registered callback so the OAuth 302 can
      // leave /authorize without broadening form submission destinations.
      securityHeaders(res, pending.redirectOrigin);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderApprovalPage(pending));
    } catch (error) {
      sendOAuthError(res, error);
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/authorize") {
    try {
      const form = new URLSearchParams(await readBody(req));
      const requestId = form.get("request_id") ?? "";
      if (!options.isUserAuthenticated(req)) {
        // Consent posts must use the shared login session — no inline credentials.
        throw new OAuthProtocolError(
          "access_denied",
          "Sign in at /login before approving MCP clients",
          401,
        );
      }
      if (form.get("action") === "deny") {
        res.writeHead(302, { Location: oauth.denyAuthorization(requestId), "Cache-Control": "no-store" });
        res.end();
        return true;
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
      if (req.headers.authorization) {
        throw new OAuthProtocolError("invalid_client", "public clients must not use client authentication", 401);
      }
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
    : `${validation.reason === "missing" ? "" : "error=\"invalid_token\", "}` +
      `resource_metadata="${metadata}", scope="${MCP_OAUTH_SCOPE}"`;
  res.setHeader("WWW-Authenticate", `Bearer ${parameters}`);
  sendJson(res, status, {
    error: insufficient ? "insufficient_scope" : "invalid_token",
    error_description: validation.reason,
  });
  return false;
}
