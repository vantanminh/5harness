#!/usr/bin/env node
/**
 * Build the Rust CLI and stage the current-platform binary + npm shim.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`build-native: ${msg}`);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

function rustTriple() {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
  if (p === "win32" && a === "arm64") return "aarch64-pc-windows-msvc";
  if (p === "darwin" && a === "x64") return "x86_64-apple-darwin";
  if (p === "darwin" && a === "arm64") return "aarch64-apple-darwin";
  if (p === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
  if (p === "linux" && a === "arm64") return "aarch64-unknown-linux-gnu";
  fail(`unsupported platform ${p}-${a}`);
}

run("cargo", ["build", "--release"]);

const ext = process.platform === "win32" ? ".exe" : "";
const built = path.join(root, "target", "release", `harness${ext}`);
if (!fs.existsSync(built)) fail(`missing ${built}`);

const binDir = path.join(root, "bin");
const distDir = path.join(root, "dist");
fs.mkdirSync(binDir, { recursive: true });
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const stagedName = `harness-${rustTriple()}${ext}`;
fs.copyFileSync(built, path.join(binDir, stagedName));
fs.copyFileSync(built, path.join(binDir, `harness${ext}`));

const shimSrc = path.join(root, "npm", "shim.mjs");
const shimDest = path.join(distDir, "cli.js");
let shim = fs.readFileSync(shimSrc, "utf8");
if (!shim.startsWith("#!/usr/bin/env node")) {
  shim = `#!/usr/bin/env node\n${shim}`;
}
fs.writeFileSync(shimDest, shim);
try {
  fs.chmodSync(shimDest, 0o755);
} catch {
  // Windows
}

console.log(`build-native: staged ${stagedName} and dist/cli.js`);
