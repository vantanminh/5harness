import http from "node:http";
import { resolveTargetFromOptions, type TargetOptions } from "../infrastructure/context.js";
import { createMonitoredMcpHandler } from "../application/mcp-server.js";

export type McpCliOptions = TargetOptions & { port?: string; host?: string };

export function executeMcp(options: McpCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ? Number(options.port) : 3928;
  // Always persist call records for this project (decision 0015)
  const handle = createMonitoredMcpHandler(targetDir);

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
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
      console.error(`error: port ${port} already in use (another harness mcp?). Try --port <n>.`);
      process.exit(1);
    }
    console.error(`error: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`MCP endpoint: http://${host}:${port}/mcp`);
    console.log(`Project: ${targetDir}`);
    console.log(`Monitor log: ${targetDir}/.harness/local/mcp-calls.jsonl`);
    console.log("Press Ctrl+C to stop.");
  });
}
