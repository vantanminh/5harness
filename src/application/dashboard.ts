import http from "node:http";
import path from "node:path";
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
import { handleDashboardMutation } from "./dashboard-mutations.js";
import { createMonitoredMcpHandler } from "./mcp-server.js";

import { getMcpStats, listMcpCalls } from "./mcp-monitor.js";

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


function findProjectPath(idOrPath: string, options: DashboardOptions): string | null {
  const projects = listProjectSummaries(options);
  const p = projects.find(
    (proj) =>
      proj.id === idOrPath ||
      proj.path === idOrPath ||
      proj.name === idOrPath,
  );
  return p && !p.missing ? p.path : null;
}

/**
 * Resolve which project root MCP calls should bind to.
 * Priority: explicit preferred id/path → cwd match among linked projects → first healthy linked project → cwd.
 */
export function resolveMcpProjectRoot(
  options: DashboardOptions = {},
  preferred?: string | null,
): string {
  const projects = listProjectSummaries(options).filter(
    (p) => !p.missing && !p.error,
  );
  if (preferred) {
    const hit = projects.find(
      (p) =>
        p.id === preferred ||
        p.path === preferred ||
        p.name === preferred ||
        path.resolve(p.path) === path.resolve(preferred),
    );
    if (hit) return hit.path;
  }
  const cwd = path.resolve(process.cwd());
  let best: ProjectSummary | null = null;
  for (const p of projects) {
    const pp = path.resolve(p.path);
    if (cwd === pp || cwd.startsWith(pp + path.sep)) {
      if (!best || pp.length > path.resolve(best.path).length) best = p;
    }
  }
  if (best) return best.path;
  return projects[0]?.path ?? process.cwd();
}

function renderMcpMonitor(projectPath: string): string {
  const stats = getMcpStats(projectPath);
  const calls = listMcpCalls(projectPath, { limit: 50 });
  const totalMs = stats.total_calls > 0 ? Math.round(stats.avg_duration_ms) : 0;

  // Summary cards
  const cards = `
  <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem">
    <div class="card"><strong>Total Calls</strong><br><span style="font-size:1.5rem">${stats.total_calls}</span></div>
    <div class="card"><strong>Error Rate</strong><br><span style="font-size:1.5rem;color:${stats.error_rate > 0.1 ? 'var(--status-missing)' : 'var(--status-ok)'}">${(stats.error_rate * 100).toFixed(1)}%</span></div>
    <div class="card"><strong>Avg Duration</strong><br><span style="font-size:1.5rem">${totalMs}ms</span></div>
    <div class="card"><strong>Tools Used</strong><br><span style="font-size:1.5rem">${Object.keys(stats.by_tool).length}</span></div>
  </div>`;

  // Timeline inline SVG (24h)
  const maxVal = Math.max(...stats.calls_per_hour, 1);
  const barW = 26;
  const barGap = 4;
  const chartW = 24 * (barW + barGap);
  const chartH = 80;
  const bars = stats.calls_per_hour.map((v, i) => {
    const h = Math.max(2, (v / maxVal) * (chartH - 10));
    const x = i * (barW + barGap);
    return `<rect x="${x}" y="${chartH - h - 5}" width="${barW}" height="${h}" fill="var(--link)" opacity="0.8" rx="2"><title>Hour ${i}: ${v} calls</title></rect>`;
  }).join('\n');

  const timeline = `
  <h3>Calls in Last 24h</h3>
  <div style="overflow-x:auto;padding:0.5rem 0">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartW + 10} ${chartH}" style="width:100%;max-width:${chartW + 10}px;height:${chartH + 20}px">
      ${bars}
    </svg>
  </div>
  <p class="muted">Hours ago: 24 ← ${maxVal} max → now</p>`;

  // Tool usage bar chart (horizontal)
  const toolNames = Object.keys(stats.by_tool).sort();
  const maxToolVal = Math.max(...toolNames.map(n => stats.by_tool[n]), 1);
  const toolBars = toolNames.map(n => {
    const pct = (stats.by_tool[n] / maxToolVal) * 100;
    return `<tr><td style="white-space:nowrap">${htmlEscape(n)}</td><td style="width:100%"><div style="background:var(--link);height:1.2rem;width:${pct}%;border-radius:3px;min-width:2rem"><span style="padding:0 0.5rem;font-size:0.8rem;color:#fff;line-height:1.2rem">${stats.by_tool[n]}</span></div></td></tr>`;
  }).join('\n');

  const toolChart = toolNames.length > 0 ? `
  <h3>Tool Usage</h3>
  <table><tbody>${toolBars}</tbody></table>` : '<p class="muted">No tool calls recorded yet.</p>';

  // Error list
  const errorRows = stats.recent_errors.length > 0
    ? stats.recent_errors.map(e => `
    <tr>
      <td><code>${htmlEscape(e.method)}</code></td>
      <td>${e.tool_name ? `<code>${htmlEscape(e.tool_name)}</code>` : '—'}</td>
      <td class="status-error">${htmlEscape(e.error_message ?? '')}</td>
      <td style="white-space:nowrap">${new Date(e.timestamp).toLocaleString()}</td>
      <td>${e.duration_ms}ms</td>
    </tr>`).join('\n')
    : '<tr><td colspan="5" class="muted">No errors recorded.</td></tr>';

  const errorSection = `
  <h3>Recent Errors (last ${stats.recent_errors.length})</h3>
  <table>
    <thead><tr><th>Method</th><th>Tool</th><th>Error</th><th>Time</th><th>Duration</th></tr></thead>
    <tbody>${errorRows}</tbody>
  </table>`;

  // Call log
  const logRows = calls.length > 0 ? calls.map(c => {
    const statusClass = c.status === 'success' ? 'status-ok' : 'status-missing';
    return `<tr>
      <td style="white-space:nowrap">${new Date(c.timestamp).toLocaleString()}</td>
      <td><code>${htmlEscape(c.method)}</code></td>
      <td>${c.tool_name ? `<code>${htmlEscape(c.tool_name)}</code>` : '—'}</td>
      <td class="${statusClass}">${c.status}</td>
      <td>${c.duration_ms}ms</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${htmlEscape(c.error_message ?? '')}">${htmlEscape(c.error_message ?? '') || '—'}</td>
    </tr>`;
  }).join('\n') : '<tr><td colspan="6" class="muted">No MCP calls recorded yet.</td></tr>';

  const logSection = `
  <h3>Call Log (last ${calls.length})</h3>
  <table>
    <thead><tr><th>Time</th><th>Method</th><th>Tool</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead>
    <tbody>${logRows}</tbody>
  </table>`;

  return `
  <style>
    .card { background:var(--pre-bg); border:1px solid var(--border); border-radius:6px; padding:0.75rem 1.25rem; min-width:140px; }
  </style>
  ${cards}
  ${timeline}
  ${toolChart}
  ${errorSection}
  ${logSection}
  <p class="muted" style="margin-top:1rem"><a href="/api/mcp-stats?project=${htmlEscape(projectPath)}">JSON stats</a> &middot; <a href="/api/mcp-calls?project=${htmlEscape(projectPath)}">JSON call log</a></p>`;
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
  <p>Harness v${htmlEscape(VERSION)} &mdash; <a href="https://github.com/vantanminh/5harness">github.com/vantanminh/5harness</a></p>
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
  const monitorHref = `/monitor?id=${encodeURIComponent(p.id)}`;

  const tabs: Array<{ id: string; label: string; content: string; html?: boolean }> = [
    { id: "stats", label: "Stats", content: detail.stats },
    { id: "matrix", label: "Matrix", content: detail.matrix },
    { id: "stories", label: "Stories", content: detail.stories },
    { id: "decisions", label: "Decisions", content: detail.decisions },
    { id: "intakes", label: "Intakes", content: detail.intakes },
    { id: "backlog", label: "Backlog", content: detail.backlog },
    { id: "traces", label: "Traces", content: detail.traces },
    {
      id: "mcp",
      label: "MCP Monitor",
      html: true,
      content: `<p><a href="${monitorHref}">Open full MCP monitor page</a> for live call stats, tool usage, and error log.</p>
<p class="muted">Records are written to <code>.5harness/local/mcp-calls.jsonl</code> when agents call the MCP endpoint.</p>`,
    },
  ];

  const tabLinks = tabs
    .map((t) => {
      const pid = encodeURIComponent(p.id);
      return `<a href="/project?id=${pid}#sec-${t.id}">${t.label}</a>`;
    })
    .join("\n");

  const sections = tabs
    .map((t) => {
      const empty = !t.content.trim();
      if (empty) {
        return `<div class="section-content" id="sec-${t.id}">
  <p class="muted">No ${t.label.toLowerCase()} recorded.</p>
</div>`;
      }
      if (t.html) {
        return `<div class="section-content" id="sec-${t.id}">
  ${t.content}
</div>`;
      }
      return `<div class="section-content" id="sec-${t.id}">
  <pre>${htmlEscape(t.content)}</pre>
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
 * Start localhost-only dashboard.
 * GET routes share handleDashboardRequest so monitor APIs stay in sync with unit tests.
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

      // MCP JSON-RPC (monitored) — project from ?project= or cwd-linked project
      if (url.pathname === "/mcp" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const preferred =
              url.searchParams.get("project") ??
              (req.headers["x-harness-project"] as string | undefined) ??
              null;
            const projectRoot = resolveMcpProjectRoot(dashOpts, preferred);
            const handle = createMonitoredMcpHandler(projectRoot);
            const json = handle(body);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(json);
          } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(err instanceof Error ? err.message : String(err));
          }
        });
        return;
      }

      // Dashboard mutations (story/intake/etc. via browser UI)
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const mutationUrl = new URL(
              req.url ?? "/",
              `http://${req.headers.host ?? "localhost"}/`,
            );
            const result = handleDashboardMutation(
              "POST",
              mutationUrl,
              body,
              req.headers as Record<string, string | string[] | undefined>,
            );
            res.writeHead(result.status, {
              "Content-Type": result.contentType.includes("charset")
                ? result.contentType
                : `${result.contentType}; charset=utf-8`,
            });
            res.end(result.body);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(msg);
          }
        });
        return;
      }

      // All GET (and other) routes — includes /monitor, /api/mcp-calls, /api/mcp-stats
      const result = handleDashboardRequest(
        req.method ?? "GET",
        req.url ?? "/",
        dashOpts,
      );
      const ct = result.contentType.includes("charset")
        ? result.contentType
        : `${result.contentType}; charset=utf-8`;
      res.writeHead(result.status, { "Content-Type": ct });
      res.end(result.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
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

  // MCP Monitor API
  if (url.pathname === "/api/mcp-calls") {
    const projectId = url.searchParams.get("project") ?? "";
    const projectPath = findProjectPath(projectId, options);
    if (!projectPath) {
      return { status: 404, contentType: "application/json", body: JSON.stringify({ error: "project not found" }) };
    }
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(listMcpCalls(projectPath, { limit: isNaN(limit) ? 50 : limit }), null, 2),
    };
  }
  if (url.pathname === "/api/mcp-stats") {
    const projectId = url.searchParams.get("project") ?? "";
    const projectPath = findProjectPath(projectId, options);
    if (!projectPath) {
      return { status: 404, contentType: "application/json", body: JSON.stringify({ error: "project not found" }) };
    }
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getMcpStats(projectPath), null, 2),
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
  if (url.pathname === "/monitor") {
    const projectId = url.searchParams.get("id") ?? "";
    const projectPath = findProjectPath(projectId, options);
    if (!projectPath) {
      return { status: 404, contentType: "text/plain", body: "Project not found" };
    }
    const projects = listProjectSummaries(options);
    const proj = projects.find(p => p.id === projectId || p.path === projectId || p.name === projectId);
    const escapedId = htmlEscape(proj?.name ?? projectId);
    const body = renderMcpMonitor(projectPath);
    return {
      status: 200,
      contentType: "text/html",
      body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MCP Monitor — ${escapedId}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="nav">
    <a href="/">&larr; Dashboard</a>
    <a href="/project?id=${encodeURIComponent(projectId)}">${escapedId}</a>
  </div>
  <h1>MCP Monitor &mdash; ${escapedId}</h1>
  <p class="muted">Real-time monitoring of MCP server calls from AI agents.</p>
  ${body}
  <p style="margin-top:1rem"><a href="#" onclick="location.reload();return false">Refresh</a></p>
  ${renderFooter()}
</body>
</html>`,
    };
  }
  return { status: 404, contentType: "text/plain", body: "Not found" };
}
