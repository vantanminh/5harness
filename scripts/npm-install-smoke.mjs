#!/usr/bin/env node
/**
 * Install the package tarball into an isolated npm prefix and execute the
 * installed shim. This is intentionally a development/CI check, not a
 * package install hook.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`npm-install-smoke: ${message}`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const executable = process.platform === "win32" && cmd === "npm" ? "npm.cmd" : cmd;
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    shell: process.platform === "win32" && cmd === "npm",
    env: { ...process.env, HARNESS_NO_UPDATE_CHECK: "1" },
  });
  if (result.error || result.status !== 0) {
    fail(`${executable} ${args.join(" ")} failed (exit ${result.status ?? "unknown"})${result.error ? `: ${result.error.message}` : ""}`);
  }
  return result;
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "5harness-install-smoke-"));
const packDir = path.join(tempRoot, "pack");
const prefix = path.join(tempRoot, "prefix");
fs.mkdirSync(packDir, { recursive: true });

try {
  run("npm", ["run", "build"]);
  run("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir]);
  const tarballs = fs.readdirSync(packDir)
    .filter((name) => name.startsWith("5harness-") && name.endsWith(".tgz"))
    .map((name) => path.join(packDir, name));
  if (tarballs.length !== 1) fail(`expected one package tarball, found ${tarballs.length}`);

  run("npm", ["install", "--global", "--ignore-scripts", "--prefix", prefix, tarballs[0]]);
  const installedShim = walk(prefix).find((file) =>
    file.split(path.sep).includes("5harness") &&
    file.endsWith(path.join("dist", "cli.js")),
  );
  if (!installedShim) fail(`installed package did not contain dist/cli.js under ${prefix}`);
  const result = spawnSync(process.execPath, [installedShim, "--version"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, HARNESS_NO_UPDATE_CHECK: "1" },
  });
  if (result.error || result.status !== 0) {
    fail(`installed harness --version failed (exit ${result.status ?? "unknown"})`);
  }
  console.log(`npm-install-smoke: installed tarball and ran ${path.relative(prefix, installedShim)}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
