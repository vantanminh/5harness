import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboard } from "../src/application/dashboard.js";
import { linkProject, unlinkProject } from "../src/application/registry.js";
import { listMcpCalls } from "../src/application/mcp-monitor.js";
import { addStoryMd } from "../src/application/md-durable.js";
import { MCP_OAUTH_SCOPE } from "../src/application/mcp-oauth.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForOutput(child: ChildProcess, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}: ${output}`)), 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(expected)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`MCP process exited early (${code}): ${output}`));
    });
  });
}

function sessionCookie(setCookie: string | null): string {
  expect(setCookie).toBeTruthy();
  const part = setCookie!.split(";")[0];
  expect(part).toMatch(/^harness_session=/);
  return part!;
}

async function loginAsAdmin(baseUrl: string, redirect = "/"): Promise<string> {
  const login = await fetch(`${baseUrl}api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "admin",
      password: "admin",
      redirect,
    }),
  });
  expect(login.status).toBe(302);
  return sessionCookie(login.headers.get("set-cookie"));
}

async function acquireToken(
  baseUrl: string,
  projectMode: "single" | "all" = "single",
  selectedProjectId?: string,
): Promise<string> {
  const redirectUri = "http://127.0.0.1:4567/callback";
  const resource = `${baseUrl}mcp`;
  const verifier = "p".repeat(64);
  const registration = await fetch(`${baseUrl}register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Vitest MCP client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(registration.status).toBe(201);
  expect(registration.headers.get("cache-control")).toBe("no-store");
  const client = await registration.json() as { client_id: string };

  const authorization = new URL(`${baseUrl}authorize`);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
    resource,
    scope: MCP_OAUTH_SCOPE,
    state: "http-state",
  }).toString();

  // Unauthenticated consent must bounce to the shared login page.
  const unauth = await fetch(authorization, { redirect: "manual" });
  expect(unauth.status).toBe(302);
  const loginLoc = unauth.headers.get("location")!;
  expect(loginLoc.startsWith("/login?redirect=")).toBe(true);
  const returned = decodeURIComponent(loginLoc.slice("/login?redirect=".length));
  expect(returned.startsWith("/authorize?")).toBe(true);

  const cookie = await loginAsAdmin(baseUrl, returned);
  const approvalPage = await fetch(authorization, { headers: { Cookie: cookie } });
  expect(approvalPage.status).toBe(200);
  expect(approvalPage.headers.get("cache-control")).toBe("no-store");
  expect(approvalPage.headers.get("content-security-policy")).toContain(
    "form-action 'self' http://127.0.0.1:4567",
  );
  const html = await approvalPage.text();
  expect(html).toMatch(/Authorize access/);
  expect(html).not.toMatch(/name="password"/);
  const requestId = /name="request_id" value="([^"]+)"/.exec(html)?.[1];
  expect(requestId).toBeTruthy();
  const projectIds = [
    ...html.matchAll(/name="project_id" type="radio" value="([^"]+)"/g),
  ].map((match) => match[1]!);
  const projectId = selectedProjectId ?? projectIds[0];
  if (projectMode === "single") expect(projectId).toBeTruthy();
  if (selectedProjectId) expect(projectIds).toContain(selectedProjectId);

  const approval = await fetch(`${baseUrl}authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({
      request_id: requestId!,
      action: "approve",
      project_mode: projectMode,
      ...(projectId ? { project_id: projectId } : {}),
    }),
  });
  expect(approval.status).toBe(302);
  const callback = new URL(approval.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe("http-state");

  const tokenResponse = await fetch(`${baseUrl}token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  expect(tokenResponse.headers.get("cache-control")).toBe("no-store");
  const token = await tokenResponse.json() as {
    access_token: string;
    token_type: string;
    project_mode: string;
    project_ids: string[];
  };
  expect(token.token_type).toBe("Bearer");
  expect(token.project_mode).toBe(projectMode);
  expect(token.project_ids).toHaveLength(projectMode === "single" ? 1 : 0);
  return token.access_token;
}

describe("MCP OAuth HTTP integration", () => {
  it("discovers OAuth, challenges unauthenticated calls, and accepts a PKCE token", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-project-"));
    tempDirs.push(home, project);
    const linked = linkProject(project, { harnessHome: home });
    const dashboard = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
    try {
      const rpcBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      const denied = await fetch(`${dashboard.url}mcp?project=${encodeURIComponent(project)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rpcBody,
      });
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toContain("resource_metadata=");
      expect(listMcpCalls(project)).toHaveLength(0);

      const resourceMetadata = await fetch(`${dashboard.url}.well-known/oauth-protected-resource/mcp`);
      expect(resourceMetadata.status).toBe(200);
      await expect(resourceMetadata.json()).resolves.toMatchObject({
        resource: `${dashboard.url}mcp`,
        authorization_servers: [dashboard.url.replace(/\/$/, "")],
      });
      const serverMetadata = await fetch(`${dashboard.url}.well-known/oauth-authorization-server`);
      await expect(serverMetadata.json()).resolves.toMatchObject({
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code"],
      });

      const token = await acquireToken(
        dashboard.url,
        "single",
        linked.entry.id,
      );
      const accepted = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: rpcBody,
      });
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toMatchObject({
        result: { serverInfo: { name: "harness-mcp" } },
      });
      expect(listMcpCalls(project)).toEqual([
        expect.objectContaining({
          method: "initialize",
          project_id: linked.entry.id,
          project_mode: "single",
        }),
      ]);

      const projectTool = await fetch(
        `${dashboard.url}mcp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "harness_status", arguments: {} },
          }),
        },
      );
      expect(projectTool.status).toBe(200);
      await expect(projectTool.json()).resolves.toMatchObject({
        result: { content: expect.any(Array) },
      });
      expect(listMcpCalls(project)).toHaveLength(2);

      // Streamable HTTP: notification-only POSTs must be 202 with empty body.
      // Codex CLI (rmcp) fails handshake if this is 200 + empty application/json.
      const initialized = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }),
      });
      expect(initialized.status).toBe(202);
      expect(await initialized.text()).toBe("");
    } finally {
      await dashboard.close();
    }
  });

  it("does not treat a dashboard session cookie or malformed bearer value as MCP authorization", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-separate-home-"));
    tempDirs.push(home);
    const dashboard = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
    try {
      const login = await fetch(`${dashboard.url}api/auth/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=admin&password=admin",
      });
      const cookie = login.headers.get("set-cookie")!;
      const response = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: { Cookie: cookie, Authorization: "Basic not-a-bearer" },
        body: "{}",
      });
      expect(response.status).toBe(401);
    } finally {
      await dashboard.close();
    }
  });

  it("isolates single grants and requires an explicit project id for all grants", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-routing-home-"));
    const firstProject = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-routing-a-"));
    const secondProject = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-routing-b-"));
    tempDirs.push(home, firstProject, secondProject);
    addStoryMd(
      { projectRoot: firstProject },
      { id: "US-SHARED", title: "First project story", lane: "tiny" },
    );
    addStoryMd(
      { projectRoot: secondProject },
      { id: "US-SHARED", title: "Second project story", lane: "tiny" },
    );
    const first = linkProject(firstProject, { harnessHome: home }).entry;
    const second = linkProject(secondProject, { harnessHome: home }).entry;
    const dashboard = await startDashboard({
      host: "127.0.0.1",
      port: 0,
      harnessHome: home,
    });
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "harness_get",
        arguments: { id: "US-SHARED" },
      },
    });
    try {
      const singleToken = await acquireToken(
        dashboard.url,
        "single",
        first.id,
      );
      const single = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${singleToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(single.status).toBe(200);
      expect(JSON.stringify(await single.json())).toContain("First project story");

      const crossProject = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${singleToken}`,
          "Content-Type": "application/json",
          "X-Harness-Project": second.id,
        },
        body,
      });
      expect(crossProject.status).toBe(403);
      await expect(crossProject.json()).resolves.toMatchObject({
        error_code: "project_hint_mismatch",
      });

      const allToken = await acquireToken(dashboard.url, "all");
      const missing = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${allToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(missing.status).toBe(403);
      await expect(missing.json()).resolves.toMatchObject({
        error_code: "project_required",
      });

      const unknown = await fetch(`${dashboard.url}mcp?project=unknown`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${allToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(unknown.status).toBe(403);
      await expect(unknown.json()).resolves.toMatchObject({
        error_code: "project_not_linked",
      });

      const routedSecond = await fetch(
        `${dashboard.url}mcp?project=${encodeURIComponent(second.id)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${allToken}`,
            "Content-Type": "application/json",
          },
          body,
        },
      );
      expect(routedSecond.status).toBe(200);
      expect(JSON.stringify(await routedSecond.json())).toContain(
        "Second project story",
      );

      const routedFirst = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${allToken}`,
          "Content-Type": "application/json",
          "X-Harness-Project": first.id,
        },
        body,
      });
      expect(routedFirst.status).toBe(200);
      expect(JSON.stringify(await routedFirst.json())).toContain(
        "First project story",
      );

      const conflicting = await fetch(
        `${dashboard.url}mcp?project=${encodeURIComponent(second.id)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${allToken}`,
            "Content-Type": "application/json",
            "X-Harness-Project": first.id,
          },
          body,
        },
      );
      expect(conflicting.status).toBe(403);
      await expect(conflicting.json()).resolves.toMatchObject({
        error_code: "conflicting_project_hint",
      });

      expect(listMcpCalls(firstProject)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ project_id: first.id, project_mode: "single" }),
          expect.objectContaining({ project_id: first.id, project_mode: "all" }),
        ]),
      );
      expect(listMcpCalls(secondProject)).toEqual([
        expect.objectContaining({ project_id: second.id, project_mode: "all" }),
      ]);

      fs.rmSync(secondProject, { recursive: true, force: true });
      const missingOnDisk = await fetch(
        `${dashboard.url}mcp?project=${encodeURIComponent(second.id)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${allToken}`,
            "Content-Type": "application/json",
          },
          body,
        },
      );
      expect(missingOnDisk.status).toBe(403);
      await expect(missingOnDisk.json()).resolves.toMatchObject({
        error_code: "project_unavailable",
      });

      unlinkProject(firstProject, { harnessHome: home });
      const unlinkedSingle = await fetch(`${dashboard.url}mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${singleToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
      expect(unlinkedSingle.status).toBe(403);
      await expect(unlinkedSingle.json()).resolves.toMatchObject({
        error_code: "project_not_linked",
      });
    } finally {
      await dashboard.close();
    }
  });

  it("protects the standalone harness mcp command with the same OAuth flow", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-cli-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-cli-project-"));
    tempDirs.push(home, project);
    for (const dir of ["docs/stories", "docs/decisions", "docs/intakes", "docs/backlog"]) {
      fs.mkdirSync(path.join(project, dir), { recursive: true });
    }
    const linked = linkProject(project, { harnessHome: home });
    const port = await freePort();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "mcp", "--dir", project, "--port", String(port)],
      {
        cwd: process.cwd(),
        env: { ...process.env, HARNESS_HOME: home, HARNESS_NO_UPDATE_CHECK: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      await waitForOutput(child, "MCP endpoint:");
      const baseUrl = `http://127.0.0.1:${port}/`;
      const denied = await fetch(`${baseUrl}mcp`, { method: "POST", body: "{}" });
      expect(denied.status).toBe(401);
      const token = await acquireToken(baseUrl, "single", linked.entry.id);
      const health = await fetch(`${baseUrl}health`);
      await expect(health.json()).resolves.toMatchObject({
        status: "ok",
        project_bound: false,
      });
      const accepted = await fetch(`${baseUrl}mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toMatchObject({
        result: { serverInfo: { name: "harness-mcp" } },
      });
      const projectTool = await fetch(`${baseUrl}mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "harness_status", arguments: {} },
        }),
      });
      await expect(projectTool.json()).resolves.toMatchObject({
        result: { content: expect.any(Array) },
      });
      const initialized = await fetch(`${baseUrl}mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      expect(initialized.status).toBe(202);
      expect(await initialized.text()).toBe("");
      expect(listMcpCalls(project)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            project_id: linked.entry.id,
            project_mode: "single",
          }),
        ]),
      );
    } finally {
      child.kill();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", () => resolve());
      });
    }
  }, 20_000);
});
