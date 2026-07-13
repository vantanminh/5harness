import { startDashboard } from "../application/dashboard.js";
import { isLoopbackBindHost } from "../domain/paths.js";
import { setPasswordDirectly } from "../infrastructure/dashboard-auth.js";
import readline from "node:readline";

export type DashboardCliOptions = {
  port?: string;
  host?: string;
  publicUrl?: string;
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
      "warning: binding outside loopback requires --public-url and an HTTPS reverse proxy. See docs/SECURITY.md.",
    );
  }

  const dash = await startDashboard({ host, port, publicUrl: options.publicUrl });
  console.log(`Harness dashboard`);
  console.log(`  ${dash.url}`);
  console.log(`  MCP: ${dash.url}mcp`);
  console.log(`  API: ${dash.url}api/projects`);
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>(() => {
    // keep process alive until signal
  });
}

export type SetPasswordOptions = {
  password?: string;
};

export async function executeSetPassword(
  options: SetPasswordOptions = {},
): Promise<void> {
  let newPassword = options.password?.trim();

  if (!newPassword) {
    // Prompt interactively
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer);
        });
      });

    try {
      newPassword = (await ask("Enter new dashboard password: ")).trim();
      if (!newPassword) {
        console.log("Password cannot be empty.");
        process.exit(1);
      }
      const confirm = (await ask("Confirm new password: ")).trim();
      if (newPassword !== confirm) {
        console.log("Passwords do not match.");
        process.exit(1);
      }
    } finally {
      rl.close();
    }
  }

  setPasswordDirectly(newPassword);
  console.log("Dashboard password updated successfully.");
}
