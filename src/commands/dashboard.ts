import { startDashboard } from "../application/dashboard.js";

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
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(
      "warning: binding outside 127.0.0.1 exposes the dashboard on the network (read-only, no auth).",
    );
  }

  const dash = await startDashboard({ host, port });
  console.log(`Harness dashboard (read-only)`);
  console.log(`  ${dash.url}`);
  console.log(`  API: ${dash.url}api/projects`);
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>(() => {
    // keep process alive until signal
  });
}
