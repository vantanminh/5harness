import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleDashboardRequest,
  listProjectSummaries,
  startDashboard,
} from "../src/application/dashboard.js";
import { addStoryMd } from "../src/application/md-durable.js";
import { linkProject } from "../src/application/registry.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

describe("dashboard (US-014)", () => {
  it("serializes registry projects and project matrix via handlers", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-proj-"));
    tempDirs.push(home, project);

    addStoryMd(
      { projectRoot: project },
      { id: "US-D1", title: "Dashboard story", lane: "normal" },
    );
    linkProject(project, {
      env: { ...process.env, HARNESS_HOME: home },
    });

    const summaries = listProjectSummaries({
      env: { ...process.env, HARNESS_HOME: home },
    });
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    const mine = summaries.find((s) => s.path === project);
    expect(mine?.stats?.stories).toBe(1);

    const api = handleDashboardRequest("GET", "/api/projects", {
      env: { ...process.env, HARNESS_HOME: home },
    });
    expect(api.status).toBe(200);
    expect(api.body).toMatch(/US-D1|Dashboard story|stories/);
    const parsed = JSON.parse(api.body) as Array<{ path: string; stats?: { stories: number } }>;
    expect(parsed.some((p) => p.path === project && p.stats?.stories === 1)).toBe(
      true,
    );

    const homeHtml = handleDashboardRequest("GET", "/", {
      env: { ...process.env, HARNESS_HOME: home },
    });
    expect(homeHtml.status).toBe(200);
    expect(homeHtml.contentType).toContain("html");
    expect(homeHtml.body).toMatch(/Harness Dashboard/);
  });

  it("binds localhost and serves HTTP", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-h2-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-p2-"));
    tempDirs.push(home, project);
    addStoryMd(
      { projectRoot: project },
      { id: "US-D2", title: "HTTP story", lane: "tiny" },
    );
    linkProject(project, {
      env: { ...process.env, HARNESS_HOME: home },
    });

    const dash = await startDashboard({
      host: "127.0.0.1",
      port: 0,
      env: { ...process.env, HARNESS_HOME: home },
    });
    try {
      expect(dash.host).toBe("127.0.0.1");
      const homeRes = await get(dash.url);
      expect(homeRes.status).toBe(200);
      expect(homeRes.body).toMatch(/Harness Dashboard/);

      const apiRes = await get(`${dash.url}api/projects`);
      expect(apiRes.status).toBe(200);
      const data = JSON.parse(apiRes.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      const id = (data as Array<{ id: string; path: string }>).find(
        (p) => p.path === project,
      )?.id;
      expect(id).toBeTruthy();
      const detail = await get(`${dash.url}api/project?id=${encodeURIComponent(id!)}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatch(/US-D2|HTTP story/);
    } finally {
      await dash.close();
    }
  });
});
