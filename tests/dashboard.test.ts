import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getEntityDetail,
  getProjectDetail,
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

  it("project detail includes intakes, stories, backlog, and traces", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-h3-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-p3-"));
    tempDirs.push(home, project);

    addStoryMd(
      { projectRoot: project },
      { id: "US-D3", title: "Full detail story", lane: "normal" },
    );
    linkProject(project, {
      env: { ...process.env, HARNESS_HOME: home },
    });

    const opts = { env: { ...process.env, HARNESS_HOME: home } };
    const detail = getProjectDetail(project, opts);
    expect(detail).not.toBeNull();
    expect(detail!.intakes).toBeDefined();
    expect(detail!.stories).toBeDefined();
    expect(detail!.backlog).toBeDefined();
    expect(detail!.traces).toBeDefined();
    expect(detail!.stories).toMatch(/US-D3/);

    // project page HTML includes all tabs
    const html = handleDashboardRequest(
      "GET",
      `/project?id=${encodeURIComponent(detail!.project.id)}`,
      opts,
    );
    expect(html.status).toBe(200);
    expect(html.body).toMatch(/section-tabs/);
    expect(html.body).toMatch(/Stats/);
    expect(html.body).toMatch(/Stories/);
    expect(html.body).toMatch(/Decisions/);
    expect(html.body).toMatch(/Intakes/);
    expect(html.body).toMatch(/Backlog/);
    expect(html.body).toMatch(/Traces/);
  });

  it("serves entity detail via handler and HTTP", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-h4-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-p4-"));
    tempDirs.push(home, project);

    addStoryMd(
      { projectRoot: project },
      { id: "US-D4", title: "Entity detail story", lane: "tiny" },
    );
    linkProject(project, {
      env: { ...process.env, HARNESS_HOME: home },
    });

    const opts = { env: { ...process.env, HARNESS_HOME: home } };

    // entity detail via handler
    const entDetail = getEntityDetail(project, "US-D4", opts);
    expect(entDetail).not.toBeNull();
    expect(entDetail!.id).toBe("US-D4");
    expect(entDetail!.type).toBe("story");
    expect(entDetail!.title).toBe("Entity detail story");

    // entity API
    const apiEntity = handleDashboardRequest(
      "GET",
      `/api/entity?project=${encodeURIComponent(project)}&id=US-D4`,
      opts,
    );
    expect(apiEntity.status).toBe(200);
    expect(apiEntity.body).toMatch(/US-D4/);
    expect(apiEntity.body).toMatch(/Entity detail story/);

    // entity HTML page
    const htmlEntity = handleDashboardRequest(
      "GET",
      `/entity?project=${encodeURIComponent(project)}&id=US-D4`,
      opts,
    );
    expect(htmlEntity.status).toBe(200);
    expect(htmlEntity.body).toMatch(/US-D4/);
    expect(htmlEntity.body).toMatch(/Entity detail story/);
    expect(htmlEntity.body).toMatch(/Frontmatter/);
    expect(htmlEntity.body).toMatch(/Body/);

    // entity via HTTP server
    const dash = await startDashboard({
      host: "127.0.0.1",
      port: 0,
      env: { ...process.env, HARNESS_HOME: home },
    });
    try {
      const entRes = await get(
        `${dash.url}api/entity?project=${encodeURIComponent(project)}&id=US-D4`,
      );
      expect(entRes.status).toBe(200);
      expect(entRes.body).toMatch(/US-D4/);

      // 404 for unknown entity
      const notFound = await get(
        `${dash.url}api/entity?project=${encodeURIComponent(project)}&id=NONEXISTENT`,
      );
      expect(notFound.status).toBe(404);
    } finally {
      await dash.close();
    }
  });

  it("home page shows footer with version", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-h5-"));
    tempDirs.push(home);

    const html = handleDashboardRequest("GET", "/", {
      env: { ...process.env, HARNESS_HOME: home },
    });
    expect(html.status).toBe(200);
    expect(html.body).toMatch(/Harness v\d+\.\d+\.\d+/);
    expect(html.body).toMatch(/github.com\/vantanminh\/harness/);
  });
});
