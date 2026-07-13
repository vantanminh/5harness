import http from "node:http";
import { resolveTargetFromOptions, type TargetOptions } from "../infrastructure/context.js";
import { createMonitoredMcpHandler } from "../application/mcp-server.js";
import { isLoopbackBindHost } from "../domain/paths.js";
import { McpOAuthService } from "../application/mcp-oauth.js";
import { handleMcpOAuthRoute, requireMcpBearer } from "../application/mcp-oauth-http.js";
import { ensureDefaultAuth, verifyCredentials } from "../infrastructure/dashboard-auth.js";

export type McpCliOptions = TargetOptions & { port?: string; host?: string };

export function executeMcp(options: McpCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ? Number(options.port) : 3928;
  if (!isLoopbackBindHost(host)) {
    console.log(
      "warning: binding MCP outside loopback requires an HTTPS reverse proxy; OAuth credentials and tokens must not cross plaintext networks. See docs/SECURITY.md.",
    );
  }
  // Always persist call records for this project (decision 0015)
  const handle = createMonitoredMcpHandler(targetDir);
  ensureDefaultAuth();
  let oauth: McpOAuthService | undefined;

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    oauth ??= new McpOAuthService({
      issuer: `http://${host}:${actualPort}`,
      resource: `http://${host}:${actualPort}/mcp`,
    });
    const url = new URL(req.url ?? "/", oauth.issuer);
    if (await handleMcpOAuthRoute(req, res, url, oauth, {
      authenticateUser: (username, password) => verifyCredentials(username, password),
    })) return;

    if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
      if (!requireMcpBearer(req, res, oauth)) return;
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const json = handle(body);
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
      res.end(JSON.stringify({ status: "ok", name: "harness-mcp", project: targetDir }));
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
    console.log(`Project: ${targetDir}`);
    console.log(`Monitor log: ${targetDir}/.5harness/local/mcp-calls.jsonl`);
    console.log("Press Ctrl+C to stop.");
  });
}
