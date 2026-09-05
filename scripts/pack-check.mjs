#!/usr/bin/env node
/**
 * Validate publish contract: native build artifacts, version sync, and npm pack contents.
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
  const npmExecPath = cmd === "npm" ? process.env.npm_execpath : undefined;
  const executable = npmExecPath
    ? process.execPath
    : process.platform === "win32" && cmd === "npm"
      ? "npm.cmd"
      : cmd;
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    encoding: "utf8",
    // npm.cmd needs a shell only when this helper is run outside `npm run`.
    // Normal release checks use npm_execpath and stay shell-free.
    shell: !npmExecPath && process.platform === "win32" && cmd === "npm",
  });
  if (result.status !== 0) {
    fail(
      `${executable} ${commandArgs.join(" ")} exited ${result.status}\n${result.error?.message ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

run("npm", ["run", "build"]);

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

if (pkg.license !== "MIT") {
  fail(`package.json must declare the MIT license (got ${JSON.stringify(pkg.license)})`);
}

const installHooks = ["preinstall", "install", "postinstall"];
const configuredHooks = installHooks.filter((name) => pkg.scripts?.[name]);
if (configuredHooks.length > 0) {
  fail(`published package must not define install hooks: ${configuredHooks.join(", ")}`);
}

if (pkg.files?.some((entry) => entry === "npm" || entry === "npm/")) {
  fail("build-only npm shim sources must not be included in the published files list");
}

const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
const cargoMatch = cargo.match(/name = "harness"[\s\S]*?version = "([^"]+)"/);
if (!cargoMatch || cargoMatch[1] !== pkg.version) {
  fail(
    `version mismatch: package.json=${pkg.version} Cargo.toml=${cargoMatch?.[1] ?? "missing"}`,
  );
}

const agentsTpl = path.join(root, "templates", "AGENTS.md");
if (fs.existsSync(agentsTpl)) {
  const agentsText = fs.readFileSync(agentsTpl, "utf8");
  const marker = agentsText.match(/<!--\s*harness-version:\s*([^\s-]+)\s*-->/);
  if (!marker) {
    fail("templates/AGENTS.md missing <!-- harness-version: X.Y.Z --> marker");
  }
  if (marker[1] !== pkg.version) {
    fail(
      `version mismatch: package.json=${pkg.version} templates/AGENTS.md harness-version=${marker[1]}`,
    );
  }
}

const binHarness = pkg.bin?.harness?.replace(/^\.\//, "");
if (binHarness !== "dist/cli.js") {
  fail(`bin.harness must be dist/cli.js (got ${JSON.stringify(pkg.bin)})`);
}
const bin5 = pkg.bin?.["5harness"]?.replace(/^\.\//, "");
if (bin5 !== "dist/cli.js") {
  fail(`bin.5harness must be dist/cli.js (got ${JSON.stringify(pkg.bin)})`);
}
if (pkg.bin?.["5hn"]?.replace(/^\.\//, "") !== "dist/cli.js") {
  fail(`bin.5hn must be dist/cli.js (got ${JSON.stringify(pkg.bin)})`);
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
const shim = fs.readFileSync(cliPath, "utf8");
if (shim.includes("src/cli.ts") || shim.includes("from \"./commands/")) {
  fail("dist/cli.js must be a native-binary shim, not the TypeScript CLI");
}
for (const forbidden of ["node:fs", "process.env", "HARNESS_NATIVE_BIN", "shell: true"]) {
  if (shim.includes(forbidden)) {
    fail(`dist/cli.js contains forbidden launcher capability: ${forbidden}`);
  }
}
if (!shim.includes("shell: false")) {
  fail("dist/cli.js must disable shell invocation explicitly");
}

const ext = process.platform === "win32" ? ".exe" : "";
const native = path.join(root, "bin", `harness${ext}`);
if (!fs.existsSync(native)) {
  fail(`native binary missing after build: bin/harness${ext}`);
}

// Local builds stage only the current host binary. Release jobs download the
// native-binaries matrix and opt into a complete target check with
// HARNESS_REQUIRED_NATIVE_TARGETS (comma-separated target triples or `all`).
const supportedNativeTargets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
];
const requiredTargets = (process.env.HARNESS_REQUIRED_NATIVE_TARGETS ?? "").trim();
if (requiredTargets) {
  const targets = requiredTargets === "all"
    ? supportedNativeTargets
    : requiredTargets.split(",").map((target) => target.trim()).filter(Boolean);
  const unknown = targets.filter((target) => !supportedNativeTargets.includes(target));
  if (unknown.length > 0) {
    fail(`HARNESS_REQUIRED_NATIVE_TARGETS contains unknown target(s): ${unknown.join(", ")}`);
  }
  const missingTargets = targets.filter(
    (target) => !fs.existsSync(path.join(root, "bin", `harness-${target}${target.includes("windows") ? ".exe" : ""}`)),
  );
  if (missingTargets.length > 0) {
    fail(`required native target binary missing: ${missingTargets.join(", ")}`);
  }
}

const requiredOnDisk = [
  "templates/manifest.json",
  "migrations/001-init.sql",
  "migrations/002-quality.sql",
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/SECURITY.md",
  "docs/product/project-link.md",
  "install/linux.sh",
  "install/windows.ps1",
  "install/macos.sh",
  "Cargo.toml",
];
for (const rel of requiredOnDisk) {
  if (!fs.existsSync(path.join(root, rel))) {
    fail(`required file missing: ${rel}`);
  }
}
if (process.platform !== "win32") {
  for (const rel of ["install/linux.sh", "install/macos.sh"]) {
    const mode = fs.statSync(path.join(root, rel)).mode;
    if ((mode & 0o111) === 0) {
      fail(`${rel} must be executable`);
    }
  }
}

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
  "SECURITY.md",
  "docs/SECURITY.md",
  "docs/product/project-link.md",
  "dist/cli.js",
  "templates/manifest.json",
  "migrations/001-init.sql",
  "migrations/002-quality.sql",
  "install/linux.sh",
  "install/windows.ps1",
  "install/macos.sh",
];

const missing = mustPack.filter((rel) => !hasPacked(rel));
if (missing.length > 0) {
  console.error("Packed sample:", [...packed].slice(0, 25).join(", "));
  fail(`tarball missing: ${missing.join(", ")}`);
}

const hasNative = [...packed].some(
  (p) =>
    /(^|\/)bin\/harness/.test(p) ||
    p.includes("harness-x86_64") ||
    p.includes("harness-aarch64"),
);
if (!hasNative) {
  fail("tarball must include a staged native harness binary under bin/");
}

console.log(`pack:check ok — version ${pkg.version}, ${packed.size} packed paths`);
