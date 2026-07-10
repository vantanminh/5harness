import http from "node:http";
import { buildCatalog } from "./catalog.js";
import {
  queryDecisionsMd,
  queryMatrixMd,
  queryStatsMd,
} from "./md-query.js";
import {
  listLinkedProjects,
  type ListedProject,
} from "./registry.js";

export type DashboardOptions = {
  host?: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
  harnessHome?: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  missing: boolean;
  remote?: string | null;
  linked_at: string;
  stats?: {
    stories: number;
    decisions: number;
    intakes: number;
    backlog: number;
  };
  error?: string;
};

function countStats(projectPath: string): ProjectSummary["stats"] {
  const cat = buildCatalog(projectPath);
  return {
    stories: cat.byType.story.length,
    decisions: cat.byType.decision.length,
    intakes: cat.byType.intake.length,
    backlog: cat.byType.backlog.length,
  };
}

export function listProjectSummaries(
  options: DashboardOptions = {},
): ProjectSummary[] {
  const projects = listLinkedProjects({
    env: options.env,
    harnessHome: options.harnessHome,
  });
  return projects.map((p: ListedProject) => {
    const base: ProjectSummary = {
      id: p.id,
      name: p.name,
      path: p.path,
      missing: p.missing,
      remote: p.remote,
      linked_at: p.linked_at,
    };
    if (p.missing) {
      base.error = "path missing on disk";
      return base;
    }
    try {
      base.stats = countStats(p.path);
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err);
    }
    return base;
  });
}

export function getProjectDetail(
  projectIdOrPath: string,
  options: DashboardOptions = {},
): {
  project: ProjectSummary;
  matrix: string;
  stats: string;
  decisions: string;
} | null {
  const projects = listProjectSummaries(options);
  const project =
    projects.find(
      (p) =>
        p.id === projectIdOrPath ||
        p.path === projectIdOrPath ||
        p.name === projectIdOrPath,
    ) ?? null;
  if (!project || project.missing) return null;
  return {
    project,
    matrix: queryMatrixMd(project.path),
    stats: queryStatsMd(project.path),
    decisions: queryDecisionsMd(project.path),
  };
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHome(projects: ProjectSummary[]): string {
  const rows = projects
    .map((p) => {
      const status = p.missing
        ? "missing"
        : p.error
          ? "error"
          : "ok";
      const stats = p.stats
        ? `${p.stats.stories} stories · ${p.stats.decisions} decisions`
        : p.error ?? "—";
      return `<tr>
  <td><a href="/project?id=${encodeURIComponent(p.id)}">${htmlEscape(p.name)}</a></td>
  <td><code>${htmlEscape(p.path)}</code></td>
  <td>${status}</td>
  <td>${htmlEscape(stats)}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Harness Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 960px; }
    h1 { margin-bottom: 0.25rem; }
    .muted { color: #666; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f4f4f4; }
    code { font-size: 0.85em; }
    pre { background: #f8f8f8; padding: 1rem; overflow: auto; }
  </style>
</head>
<body>
  <h1>Harness Dashboard</h1>
  <p class="muted">Local read-only view of registry projects (markdown SoT).</p>
  <p><a href="/api/projects">JSON /api/projects</a></p>
  <table>
    <thead><tr><th>Name</th><th>Path</th><th>Status</th><th>Summary</th></tr></thead>
    <tbody>
${rows || `<tr><td colspan="4">No linked projects. Run <code>harness link</code>.</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;
}

function renderProject(detail: NonNullable<ReturnType<typeof getProjectDetail>>): string {
  const p = detail.project;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(p.name)} — Harness</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 960px; }
    pre { background: #f8f8f8; padding: 1rem; overflow: auto; font-size: 0.85em; }
    a { color: #06c; }
  </style>
</head>
<body>
  <p><a href="/">← Projects</a></p>
  <h1>${htmlEscape(p.name)}</h1>
  <p><code>${htmlEscape(p.path)}</code></p>
  <h2>Stats</h2>
  <pre>${htmlEscape(detail.stats)}</pre>
  <h2>Matrix</h2>
  <pre>${htmlEscape(detail.matrix)}</pre>
  <h2>Decisions</h2>
  <pre>${htmlEscape(detail.decisions)}</pre>
  <p><a href="/api/project?id=${encodeURIComponent(p.id)}">JSON</a></p>
</body>
</html>`;
}

export type DashboardServer = {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

/**
 * Start localhost-only read-only dashboard.
 */
export function startDashboard(
  options: DashboardOptions = {},
): Promise<DashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3927;
  const dashOpts: DashboardOptions = {
    env: options.env,
    harnessHome: options.harnessHome,
  };

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/api/projects") {
        const body = JSON.stringify(listProjectSummaries(dashOpts), null, 2);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(body);
        return;
      }
      if (url.pathname === "/api/project") {
        const id = url.searchParams.get("id") ?? "";
        const detail = getProjectDetail(id, dashOpts);
        if (!detail) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "project not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(detail, null, 2));
        return;
      }
      if (url.pathname === "/project") {
        const id = url.searchParams.get("id") ?? "";
        const detail = getProjectDetail(id, dashOpts);
        if (!detail) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Project not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderProject(detail));
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHome(listProjectSummaries(dashOpts)));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(msg);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort =
        typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}/`,
        close: () =>
          new Promise((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
          }),
      });
    });
  });
}

/** Handle request for unit tests without binding a port. */
export function handleDashboardRequest(
  method: string,
  pathAndQuery: string,
  options: DashboardOptions = {},
): { status: number; contentType: string; body: string } {
  const url = new URL(pathAndQuery, "http://127.0.0.1/");
  void method;
  if (url.pathname === "/api/projects") {
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(listProjectSummaries(options), null, 2),
    };
  }
  if (url.pathname === "/api/project") {
    const id = url.searchParams.get("id") ?? "";
    const detail = getProjectDetail(id, options);
    if (!detail) {
      return {
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "project not found" }),
      };
    }
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail, null, 2),
    };
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return {
      status: 200,
      contentType: "text/html",
      body: renderHome(listProjectSummaries(options)),
    };
  }
  return { status: 404, contentType: "text/plain", body: "Not found" };
}
