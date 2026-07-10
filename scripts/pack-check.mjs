#!/usr/bin/env node
/**
 * Validate publish contract: build artifacts, version sync, and npm pack contents.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`pack:check failed: ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(
      `${cmd} ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

// Ensure build is current for shebang + dist checks
run("npm", ["run", "build"]);

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const versionSrc = fs.readFileSync(path.join(root, "src", "version.ts"), "utf8");
const versionMatch = versionSrc.match(/VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch || versionMatch[1] !== pkg.version) {
  fail(
    `version mismatch: package.json=${pkg.version} src/version.ts=${versionMatch?.[1] ?? "missing"}`,
  );
}

if (pkg.bin?.harness !== "./dist/cli.js") {
  fail(`bin.harness must be ./dist/cli.js (got ${JSON.stringify(pkg.bin)})`);
}

if (!pkg.files?.includes("LICENSE")) {
  // files may list LICENSE implicitly via root — require LICENSE file on disk
}
const licensePath = path.join(root, "LICENSE");
if (!fs.existsSync(licensePath)) {
  fail("LICENSE file missing");
}

const cliPath = path.join(root, "dist", "cli.js");
if (!fs.existsSync(cliPath)) {
  fail("dist/cli.js missing after build");
}
const head = fs.readFileSync(cliPath, "utf8").slice(0, 32);
if (!head.startsWith("#!/usr/bin/env node")) {
  fail("dist/cli.js must start with #!/usr/bin/env node");
}

const requiredOnDisk = [
  "templates/manifest.json",
  "migrations/001-init.sql",
  "migrations/002-quality.sql",
  "README.md",
  "CHANGELOG.md",
];
for (const rel of requiredOnDisk) {
  if (!fs.existsSync(path.join(root, rel))) {
    fail(`required file missing: ${rel}`);
  }
}

// Parse npm pack --dry-run --json for packed paths (may include trailing notices)
const packJson = run("npm", ["pack", "--dry-run", "--json"]);

function extractJsonValue(text) {
  const startCandidates = [text.indexOf("["), text.indexOf("{")].filter(
    (i) => i >= 0,
  );
  if (startCandidates.length === 0) {
    throw new Error("no JSON object/array in npm pack output");
  }
  const start = Math.min(...startCandidates);
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error("unbalanced JSON in npm pack output");
}

let packedPaths = [];
try {
  const parsed = extractJsonValue(packJson);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const list = entry.files ?? entry;
  if (Array.isArray(list)) {
    packedPaths = list.map((f) => {
      if (typeof f === "string") return f.replace(/\\/g, "/");
      return String(f.path ?? f.name ?? "").replace(/\\/g, "/");
    });
  }
} catch (error) {
  fail(`JSON parse error: ${error}\n${packJson.slice(0, 800)}`);
}

if (packedPaths.length === 0) {
  // Fallback: line-based dry-run (npm notice Tarball Contents)
  const text = run("npm", ["pack", "--dry-run"]);
  packedPaths = text
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/npm notice\s+\d+(?:\.\d+)?[kKmMgG]?B\s+(.+)$/);
      return m ? m[1].trim().replace(/\\/g, "/") : null;
    })
    .filter(Boolean);
}

const packed = new Set(packedPaths);

function hasPacked(rel) {
  if (packed.has(rel)) return true;
  if (packed.has(`package/${rel}`)) return true;
  for (const p of packed) {
    if (p === rel || p.endsWith(`/${rel}`) || p.endsWith(rel)) return true;
  }
  return false;
}

const mustPack = [
  "package.json",
  "LICENSE",
  "README.md",
  "dist/cli.js",
  "templates/manifest.json",
  "migrations/001-init.sql",
  "migrations/002-quality.sql",
];

const missing = mustPack.filter((rel) => !hasPacked(rel));
if (missing.length > 0) {
  console.error("Packed sample:", [...packed].slice(0, 25).join(", "));
  fail(`tarball missing: ${missing.join(", ")}`);
}

// Ensure no accidental native binary is shipped in the tarball
const banned = [...packed].filter(
  (p) =>
    p.includes("harness-cli.exe") ||
    p.endsWith("scripts/bin/harness-cli") ||
    p.includes("scripts/bin/harness-cli.exe"),
);
if (banned.length > 0) {
  fail(`tarball must not ship bootstrap binaries: ${banned.join(", ")}`);
}

console.log(`pack:check ok — version ${pkg.version}, ${packed.size} packed paths`);
