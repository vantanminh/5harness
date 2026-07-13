import http from "node:http";
import { resolveTargetFromOptions, type TargetOptions } from "../infrastructure/context.js";
import { createMonitoredMcpHandler, mcpStreamableHttpStatus } from "../application/mcp-server.js";
import { isLoopbackBindHost } from "../domain/paths.js";
import { McpOAuthService } from "../application/mcp-oauth.js";
import {
  handleMcpOAuthRoute,
  requireMcpBearer,
  sendMcpProjectError,
} from "../application/mcp-oauth-http.js";
import { resolveMcpProjectBinding } from "../application/mcp-project-binding.js";
import { renderLoginPage, safeRedirectPath } from "../application/auth-pages.js";
import {
  createSession,
  ensureDefaultAuth,
  extractSessionToken,
  validateSession,
  verifyCredentials,
} from "../infrastructure/dashboard-auth.js";
import { listLinkedProjects } from "../application/registry.js";

export type McpCliOptions = TargetOptions & { port?: string; host?: string; publicUrl?: string };

export function executeMcp(options: McpCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ? Number(options.port) : 3928;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port "${options.port}"`);
  }
  if (!isLoopbackBindHost(host) && !options.publicUrl) {
    throw new Error("Non-loopback MCP binds require --public-url https://<public-host> behind a TLS reverse proxy");
  }
  if (!isLoopbackBindHost(host)) {
    console.log(
      "warning: binding MCP outside loopback requires an HTTPS reverse proxy; OAuth credentials and tokens must not cross plaintext networks. See docs/SECURITY.md.",
    );
  }
  ensureDefaultAuth();
  let oauth: McpOAuthService | undefined;
  const bindHostForUrl = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

  const isUserAuthenticated = (req: http.IncomingMessage): boolean => {
    const token = extractSessionToken(req.headers.cookie);
    return Boolean(token && validateSession(token));
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Harness-Project",
    );

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    oauth ??= new McpOAuthService({
      issuer: options.publicUrl ?? `http://${bindHostForUrl}:${actualPort}`,
      resource: `${(options.publicUrl ?? `http://${bindHostForUrl}:${actualPort}`).replace(/\/$/, "")}/mcp`,
    });
    const url = new URL(req.url ?? "/", oauth.issuer);
    if (
      await handleMcpOAuthRoute(req, res, url, oauth, {
        isUserAuthenticated,
        listProjects: () =>
          listLinkedProjects()
            .filter((project) => !project.missing)
            .map(({ id, name, path }) => ({ id, name, path })),
      })
    ) return;

    // Shared login surface (same as dashboard) so OAuth consent can redirect here.
    if (url.pathname === "/login" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderLoginPage({
        redirect: safeRedirectPath(url.searchParams.get("redirect")),
      }));
      return;
    }
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const params = new URLSearchParams(body);
          const redirect = safeRedirectPath(
            params.get("redirect") ?? url.searchParams.get("redirect"),
          );
          if (verifyCredentials(params.get("username") ?? "", params.get("password") ?? "")) {
            const session = createSession();
            res.writeHead(302, {
              Location: redirect,
              "Set-Cookie": `harness_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((session.expiresAt - Date.now()) / 1000)}`,
            });
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderLoginPage({
            error: "Invalid username or password",
            redirect,
          }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(err instanceof Error ? err.message : String(err));
        }
      });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
      const grant = requireMcpBearer(req, res, oauth);
      if (!grant) return;
      const headerValue = req.headers["x-harness-project"];
      const resolved = resolveMcpProjectBinding(
        grant,
        listLinkedProjects(),
        {
          header: typeof headerValue === "string" ? headerValue : undefined,
          query: url.searchParams.get("project") ?? undefined,
        },
      );
      if (!resolved.ok) {
        sendMcpProjectError(res, resolved);
        return;
      }
      const { binding } = resolved;
      const handle = createMonitoredMcpHandler(binding.projectRoot, binding);
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const json = handle(body);
          const status = mcpStreamableHttpStatus(json);
          if (status === 202) {
            // Notification-only (e.g. notifications/initialized): no body.
            res.writeHead(202);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(json);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(err instanceof Error ? err.message : String(err));
        }
      });
      return;
    }

    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: "harness-mcp",
          project_bound: false,
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `error: HARNESS_E_STATE: port ${port} already in use (another harness mcp?). Try --port <n>.`,
      );
      process.exit(1);
    }
    console.error(`error: HARNESS_E_INTERNAL: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`MCP endpoint: http://${host}:${actualPort}/mcp`);
    console.log(`OAuth discovery: http://${host}:${actualPort}/.well-known/oauth-protected-resource/mcp`);
    console.log("Project binding: unbound (selected during OAuth authorization)");
    if (options.dir || options.directory) {
      console.log(`Project hint: ${targetDir}`);
    }
    console.log("Press Ctrl+C to stop.");
  });
}
