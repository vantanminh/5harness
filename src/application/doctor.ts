import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./catalog.js";
import { extractRepoVersion, compareVersions } from "../domain/upgrade.js";
import { readRegistry } from "../infrastructure/registry.js";
import { findProjectByPath } from "../domain/registry.js";
import {
  hasMarkdownStore,
  loadProjectIndex,
  checkIndexIntegrity,
} from "./index-store.js";
import { VERSION } from "../version.js";
import {
  resolveDefaultLogFile,
  resolveGlobalLogDir,
  isDebugEnabled,
} from "../infrastructure/logger.js";

export type DoctorCheck = {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

export type DoctorReport = {
  cliVersion: string;
  projectRoot: string;
  checks: DoctorCheck[];
  healthy: boolean;
};

function checkNodeEngines(projectRoot: string): DoctorCheck {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {
      name: "node-engines",
      status: "ok",
      message: "No package.json - engines check skipped",
    };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      engines?: { node?: string };
    };
    const required = pkg.engines?.node;
    if (!required) {
      return {
        name: "node-engines",
        status: "ok",
        message: "No engines.node specified",
      };
    }
    const currentMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
    const reqClean = required.replace(/^[><=]+/, "").trim();
    const reqMajor = Number(reqClean.split(".")[0]);
    if (Number.isNaN(reqMajor)) {
      return {
        name: "node-engines",
        status: "ok",
        message: `engines.node "${required}" - unable to parse, skipped`,
      };
    }
    if (currentMajor >= reqMajor) {
      return {
        name: "node-engines",
        status: "ok",
        message: `Node ${process.version} satisfies engines.node "${required}"`,
      };
    }
    return {
      name: "node-engines",
      status: "warn",
      message: `Node ${process.version} may not satisfy engines.node "${required}"`,
    };
  } catch {
    return {
      name: "node-engines",
      status: "warn",
      message: "Could not parse package.json engines",
    };
  }
}


export function runDoctor(projectRoot: string): DoctorReport {
  const checks: DoctorCheck[] = [];

  // 1. Markdown store present
  if (hasMarkdownStore(projectRoot)) {
    checks.push({
      name: "markdown-store",
      status: "ok",
      message: "Markdown entity directories found",
    });
  } else {
    checks.push({
      name: "markdown-store",
      status: "fail",
      message: "No markdown entity directories - run `harness init`",
    });
  }

  // 2. Registry linked
  try {
    const registry = readRegistry();
    const linked = findProjectByPath(registry, projectRoot);
    if (linked) {
      checks.push({
        name: "registry-linked",
        status: "ok",
        message: `Project registered as "${linked.name}"`,
      });
    } else {
      checks.push({
        name: "registry-linked",
        status: "warn",
        message: "Project not in machine registry - run `harness link`",
      });
    }
  } catch (err) {
    checks.push({
      name: "registry-linked",
      status: "warn",
      message: `Could not read registry: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 3. AGENTS.md version vs CLI
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    const agentsText = fs.readFileSync(agentsPath, "utf8");
    const repoVersion = extractRepoVersion(agentsText);
    if (repoVersion) {
      const cmp = compareVersions(VERSION, repoVersion);
      if (cmp > 0) {
        checks.push({
          name: "agents-version",
          status: "warn",
          message: `AGENTS.md version ${repoVersion} < CLI ${VERSION} - run 'harness upgrade'`,
        });
      } else if (cmp === 0) {
        checks.push({
          name: "agents-version",
          status: "ok",
          message: `AGENTS.md version ${repoVersion} matches CLI ${VERSION}`,
        });
      } else {
        checks.push({
          name: "agents-version",
          status: "warn",
          message: `CLI ${VERSION} is older than AGENTS.md version ${repoVersion} - upgrade CLI`,
        });
      }
    } else {
      checks.push({
        name: "agents-version",
        status: "warn",
        message: "No harness-version marker in AGENTS.md - run 'harness upgrade'",
      });
    }
  } else {
    checks.push({
      name: "agents-version",
      status: "fail",
      message: "AGENTS.md not found - run 'harness init'",
    });
  }

  // 4. Index present and fresh
  const index = loadProjectIndex(projectRoot);
  if (index) {
    try {
      const catalog = buildCatalog(projectRoot);
      const indexTime = new Date(index.built_at).getTime();
      let staleCount = 0;
      for (const entry of catalog.entries) {
        if (entry.mtimeMs > indexTime) staleCount++;
      }
      if (staleCount > 0) {
        checks.push({
          name: "index-fresh",
          status: "warn",
          message: `Index built at ${index.built_at}; ${staleCount} entities modified since - run 'harness reindex'`,
        });
      } else {
        checks.push({
          name: "index-fresh",
          status: "ok",
          message: `Index present and up-to-date (${index.catalog.length} entities, ${index.edges.length} edges)`,
        });
      }
    } catch {
      checks.push({
        name: "index-fresh",
        status: "warn",
        message: "Index present but could not verify freshness",
      });
    }
  } else {
    checks.push({
      name: "index-fresh",
      status: "warn",
      message: "No index found - run 'harness reindex'",
    });
  }

  // 5. Index integrity (US-034): schema, checksum, missing files, broken links
  const integrity = checkIndexIntegrity(projectRoot);
  if (!index && integrity.issues.length === 0) {
    checks.push({
      name: "index-integrity",
      status: "ok",
      message: "No index to validate (run `harness reindex` after init)",
    });
  } else if (integrity.ok && integrity.issues.length === 0) {
    checks.push({
      name: "index-integrity",
      status: "ok",
      message: `Index integrity ok (checksum present; ${integrity.brokenLinkCount} unresolved links)`,
    });
  } else if (integrity.ok) {
    // warn-only issues (e.g. missing checksum on old index, broken links)
    const warnMsg = integrity.issues
      .filter((i) => i.severity === "warn")
      .map((i) => i.message)
      .slice(0, 3)
      .join("; ");
    checks.push({
      name: "index-integrity",
      status: "warn",
      message: warnMsg || "Index integrity warnings",
    });
  } else {
    const failMsg = integrity.issues
      .filter((i) => i.severity === "fail")
      .map((i) => i.message)
      .slice(0, 3)
      .join("; ");
    checks.push({
      name: "index-integrity",
      status: "fail",
      message: failMsg || "Index integrity failed — run `harness reindex`",
    });
  }

  // 6. Node engines
  checks.push(checkNodeEngines(projectRoot));

  // 7. Log surface (US-033) — informational, never a hard fail
  const logFile = resolveDefaultLogFile(process.env, projectRoot);
  const globalLogs = resolveGlobalLogDir(process.env);
  const debugOn = isDebugEnabled(process.env);
  checks.push({
    name: "logs",
    status: "ok",
    message: debugOn
      ? `Debug logging on (HARNESS_DEBUG); log file: ${logFile} (global dir: ${globalLogs})`
      : `Log file path: ${logFile} (set HARNESS_DEBUG=1 for debug; global: ${globalLogs})`,
  });

  const hasFailure = checks.some((c) => c.status === "fail");
  return { cliVersion: VERSION, projectRoot, checks, healthy: !hasFailure };
}

export function formatDoctorReport(report: DoctorReport, json: boolean): string {
  if (json) {
    return JSON.stringify(report, null, 2);
  }
  const icon = (s: string) => {
    switch (s) {
      case "ok": return "+";
      case "warn": return "!";
      case "fail": return "X";
      default: return "?";
    }
  };
  const lines = [
    `harness doctor v${report.cliVersion}`,
    `project: ${report.projectRoot}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`  ${icon(check.status)} ${check.name}: ${check.message}`);
  }
  lines.push("");
  lines.push(report.healthy ? "All checks passed." : "Some checks failed. See above.");
  return lines.join("\n");
}
