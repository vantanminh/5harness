import http from "node:http";
import { buildCatalog } from "./catalog.js";
import { getEntityText } from "./index-store.js";
import {
  queryBacklogMd,
  queryDecisionsMd,
  queryIntakesMd,
  queryMatrixMd,
  queryStatsMd,
  queryStoriesMd,
} from "./md-query.js";
import { queryTracesMd } from "./local-traces.js";
import type { ListedProject } from "../domain/registry.js";
import { listLinkedProjects } from "./registry.js";
import { VERSION } from "../version.js";

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

export type ProjectDetail = {
  project: ProjectSummary;
  matrix: string;
  stats: string;
  decisions: string;
  intakes: string;
  stories: string;
  backlog: string;
  traces: string;
};

export function getProjectDetail(
  projectIdOrPath: string,
  options: DashboardOptions = {},
): ProjectDetail | null {
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
    intakes: queryIntakesMd(project.path),
    stories: queryStoriesMd(project.path),
    backlog: queryBacklogMd(project.path, "open"),
    traces: queryTracesMd(project.path),
  };
}

export type EntityDetail = {
  id: string;
  type: string;
  path: string;
  title: string;
  frontmatter: string;
  body: string;
  project: ProjectSummary;
};

export function getEntityDetail(
  projectIdOrPath: string,
  entityId: string,
  options: DashboardOptions = {},
): EntityDetail | null {
  const projects = listProjectSummaries(options);
  const project =
    projects.find(
      (p) =>
        p.id === projectIdOrPath ||
        p.path === projectIdOrPath ||
        p.name === projectIdOrPath,
    ) ?? null;
  if (!project || project.missing) return null;

  const result = getEntityText(project.path, entityId, false);
  if (!result) return null;

  return {
    id: result.entry.id,
    type: result.entry.type,
    path: result.entry.path,
    title: result.entry.title,
    frontmatter: result.frontmatter,
    body: result.body,
    project,
  };
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
  :root {
    --bg: #fff;
    --fg: #111;
    --muted: #666;
    --border: #ddd;
    --th-bg: #f4f4f4;
    --pre-bg: #f8f8f8;
    --link: #06c;
    --status-ok: #1a7f37;
    --status-missing: #cf222e;
    --status-error: #bf8700;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --fg: #c9d1d9;
      --muted: #8b949e;
      --border: #30363d;
      --th-bg: #161b22;
      --pre-bg: #161b22;
      --link: #58a6ff;
      --status-ok: #3fb950;
      --status-missing: #f85149;
      --status-error: #d29922;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0;
    padding: 2rem;
    max-width: 1100px;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.5;
  }
  h1 { margin-bottom: 0.25rem; font-size: 1.6rem; }
  h2 { margin-top: 2rem; font-size: 1.2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.9rem; }
  th, td { border: 1px solid var(--border); padding: 0.45rem 0.65rem; text-align: left; }
  th { background: var(--th-bg); font-weight: 600; white-space: nowrap; }
  code { font-size: 0.85em; background: var(--pre-bg); padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: var(--pre-bg); padding: 1rem; overflow: auto; font-size: 0.82em; line-height: 1.4; border-radius: 4px; border: 1px solid var(--border); }
  .status-ok { color: var(--status-ok); font-weight: 600; }
  .status-missing { color: var(--status-missing); font-weight: 600; }
  .status-error { color: var(--status-error); font-weight: 600; }
  .nav { margin-bottom: 1.5rem; }
  .nav a { margin-right: 1rem; }
  .badge { display: inline-block; background: var(--th-bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.15em 0.5em; font-size: 0.8rem; margin-right: 0.3rem; }
  .section-tabs { display: flex; gap: 0.25rem; margin: 1.5rem 0 1rem; flex-wrap: wrap; }
  .section-tabs a { padding: 0.35rem 0.75rem; border: 1px solid var(--border); border-radius: 4px 4px 0 0; font-size: 0.85rem; background: var(--th-bg); }
  .section-content { border: 1px solid var(--border); padding: 1rem; border-radius: 0 4px 4px 4px; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.8rem; color: var(--muted); }
  .footer a { color: var(--muted); }
  @media (max-width: 768px) {
    body { padding: 1rem; }
    table { font-size: 0.78rem; }
    th, td { padding: 0.3rem 0.4rem; }
  }
`;

function renderFooter(): string {
  return `<div class="footer">
  <p>Harness v${htmlEscape(VERSION)} &mdash; <a href="https://github.com/vantanminh/harness">github.com/vantanminh/harness</a></p>
</div>`;
}

function renderHome(projects: ProjectSummary[]): string {
  const totalStories = projects.reduce((s, p) => s + (p.stats?.stories ?? 0), 0);
  const totalDecisions = projects.reduce((s, p) => s + (p.stats?.decisions ?? 0), 0);
  const totalIntakes = projects.reduce((s, p) => s + (p.stats?.intakes ?? 0), 0);
  const totalBacklog = projects.reduce((s, p) => s + (p.stats?.backlog ?? 0), 0);
  const ok = projects.filter((p) => !p.missing && !p.error).length;
  const missing = projects.filter((p) => p.missing).length;
  const errored = projects.filter((p) => !p.missing && p.error).length;

  const rows = projects
    .map((p) => {
      const status = p.missing ? "missing" : p.error ? "error" : "ok";
      const statusClass = `status-${status}`;
      const stats = p.stats
        ? `${p.stats.stories} stories &middot; ${p.stats.decisions} decisions &middot; ${p.stats.intakes} intakes`
        : (p.error ?? "—");
      return `<tr>
  <td><a href="/project?id=${encodeURIComponent(p.id)}">${htmlEscape(p.name)}</a></td>
  <td><code>${htmlEscape(p.path)}</code></td>
  <td class="${statusClass}">${status}</td>
  <td>${stats}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Harness Dashboard</title>
  <style>${CSS}</style>
</head>
<body>
  <h1>Harness Dashboard</h1>
  <p class="muted">Local read-only view of registry projects (markdown SoT).</p>
  <p><a href="/api/projects">JSON /api/projects</a></p>

  ${projects.length > 0 ? `
  <table>
    <thead><tr><th>Name</th><th>Path</th><th>Status</th><th>Summary</th></tr></thead>
    <tbody>
${rows || `<tr><td colspan="4">No linked projects. Run <code>harness link</code>.</td></tr>`}
    </tbody>
  </table>
  <p class="muted" style="margin-top:1rem">
    ${projects.length} project${projects.length !== 1 ? "s" : ""} &mdash;
    <span class="status-ok">${ok} ok</span>,
    <span class="status-missing">${missing} missing</span>,
    <span class="status-error">${errored} error</span>
    &mdash; totals: ${totalStories} stories, ${totalDecisions} decisions, ${totalIntakes} intakes, ${totalBacklog} backlog
  </p>
  ` : `<p class="muted">No linked projects. Run <code>harness link</code> to register a project.</p>`}

  ${renderFooter()}
</body>
</html>`;
}

function renderProject(detail: ProjectDetail): string {
  const p = detail.project;

  const tabs = [
    { id: "stats", label: "Stats", content: detail.stats },
    { id: "matrix", label: "Matrix", content: detail.matrix },
    { id: "stories", label: "Stories", content: detail.stories },
    { id: "decisions", label: "Decisions", content: detail.decisions },
    { id: "intakes", label: "Intakes", content: detail.intakes },
    { id: "backlog", label: "Backlog", content: detail.backlog },
    { id: "traces", label: "Traces", content: detail.traces },
  ];

  const tabLinks = tabs
    .map((t) => {
      const pid = encodeURIComponent(p.id);
      return `<a href="/project?id=${pid}#sec-${t.id}">${t.label}</a>`;
    })
    .join("\n");

  const sections = tabs
    .map((t) => {
      const esc = htmlEscape(t.content);
      const empty = !t.content.trim();
      return `<div class="section-content" id="sec-${t.id}">
  ${empty ? `<p class="muted">No ${t.label.toLowerCase()} recorded.</p>` : `<pre>${esc}</pre>`}
</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(p.name)} — Harness</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="nav"><a href="/">← Projects</a></div>
  <h1>${htmlEscape(p.name)}</h1>
  <p class="muted"><code>${htmlEscape(p.path)}</code></p>
  <p>
    <span class="badge">${p.stats?.stories ?? 0} stories</span>
    <span class="badge">${p.stats?.decisions ?? 0} decisions</span>
    <span class="badge">${p.stats?.intakes ?? 0} intakes</span>
    <span class="badge">${p.stats?.backlog ?? 0} backlog</span>
  </p>

  <div class="section-tabs">
    ${tabLinks}
  </div>
  ${sections}

  <p style="margin-top:1rem"><a href="/api/project?id=${encodeURIComponent(p.id)}">JSON /api/project</a></p>

  ${renderFooter()}
</body>
</html>`;
}

function renderEntity(detail: EntityDetail): string {
  const p = detail.project;
  const fmLines = detail.frontmatter.split("\n").map((l) => htmlEscape(l)).join("\n");
  const bodyText = detail.body.trim()
    ? `<pre style="white-space:pre-wrap;font-family:system-ui;line-height:1.6;font-size:0.9rem;border-radius:4px">${htmlEscape(detail.body.trim())}</pre>`
    : `<p class="muted">(no body)</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(detail.id)} (${htmlEscape(detail.type)}) — ${htmlEscape(p.name)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="nav">
    <a href="/">← Projects</a>
    <a href="/project?id=${encodeURIComponent(p.id)}">← ${htmlEscape(p.name)}</a>
  </div>
  <h1>${htmlEscape(detail.id)} <span class="badge">${htmlEscape(detail.type)}</span></h1>
  <p class="muted"><code>${htmlEscape(detail.path)}</code> &mdash; ${htmlEscape(detail.title)}</p>

  <h2>Frontmatter</h2>
  <pre>${fmLines}</pre>

  <h2>Body</h2>
  ${bodyText}

  <p style="margin-top:1rem"><a href="/api/entity?project=${encodeURIComponent(p.id)}&id=${encodeURIComponent(detail.id)}">JSON /api/entity</a></p>

  ${renderFooter()}
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

      // --- API routes ---
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
      if (url.pathname === "/api/entity") {
        const projectId = url.searchParams.get("project") ?? "";
        const entityId = url.searchParams.get("id") ?? "";
        const detail = getEntityDetail(projectId, entityId, dashOpts);
        if (!detail) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "entity not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(detail, null, 2));
        return;
      }

      // --- HTML routes ---
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
      if (url.pathname === "/entity") {
        const projectId = url.searchParams.get("project") ?? "";
        const entityId = url.searchParams.get("id") ?? "";
        const detail = getEntityDetail(projectId, entityId, dashOpts);
        if (!detail) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Entity not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderEntity(detail));
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

  // API routes
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
  if (url.pathname === "/api/entity") {
    const projectId = url.searchParams.get("project") ?? "";
    const entityId = url.searchParams.get("id") ?? "";
    const detail = getEntityDetail(projectId, entityId, options);
    if (!detail) {
      return {
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "entity not found" }),
      };
    }
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail, null, 2),
    };
  }

  // HTML routes
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return {
      status: 200,
      contentType: "text/html",
      body: renderHome(listProjectSummaries(options)),
    };
  }
  if (url.pathname === "/project") {
    const id = url.searchParams.get("id") ?? "";
    const detail = getProjectDetail(id, options);
    if (!detail) {
      return { status: 404, contentType: "text/plain", body: "Project not found" };
    }
    return {
      status: 200,
      contentType: "text/html",
      body: renderProject(detail),
    };
  }
  if (url.pathname === "/entity") {
    const projectId = url.searchParams.get("project") ?? "";
    const entityId = url.searchParams.get("id") ?? "";
    const detail = getEntityDetail(projectId, entityId, options);
    if (!detail) {
      return { status: 404, contentType: "text/plain", body: "Entity not found" };
    }
    return {
      status: 200,
      contentType: "text/html",
      body: renderEntity(detail),
    };
  }
  return { status: 404, contentType: "text/plain", body: "Not found" };
}
