import { startDashboard } from "../application/dashboard.js";
import { isLoopbackBindHost } from "../domain/paths.js";

export type DashboardCliOptions = {
  port?: string;
  host?: string;
};

export async function executeDashboard(
  options: DashboardCliOptions = {},
): Promise<void> {
  const port = options.port ? Number(options.port) : 3927;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port "${options.port}"`);
  }
  const host = options.host ?? "127.0.0.1";
  if (!isLoopbackBindHost(host)) {
    console.log(
      "warning: binding outside loopback exposes the dashboard on the network (no multi-tenant auth). See docs/SECURITY.md.",
    );
  }

  const dash = await startDashboard({ host, port });
  console.log(`Harness dashboard`);
  console.log(`  ${dash.url}`);
  console.log(`  MCP: ${dash.url}mcp`);
  console.log(`  API: ${dash.url}api/projects`);
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>(() => {
    // keep process alive until signal
  });
}
