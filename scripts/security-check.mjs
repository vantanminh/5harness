#!/usr/bin/env node
/**
 * Check security-sensitive npm package properties before release.
 * This file is a development/release helper and is not included in the npm
 * tarball.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const shimPath = path.join(root, "npm", "shim.mjs");
const shim = fs.readFileSync(shimPath, "utf8");

function fail(message) {
  console.error(`security:check failed: ${message}`);
  process.exitCode = 1;
}

if (packageJson.license !== "MIT") {
  fail(`package.json must declare MIT (got ${JSON.stringify(packageJson.license)})`);
}

for (const hook of ["preinstall", "install", "postinstall"]) {
  if (packageJson.scripts?.[hook]) {
    fail(`package.json must not define ${hook}`);
  }
}

if (packageJson.files?.some((entry) => entry === "npm" || entry === "npm/")) {
  fail("build-only npm sources must not be published");
}

for (const forbidden of ["node:fs", "process.env", "HARNESS_NATIVE_BIN", "shell: true"]) {
  if (shim.includes(forbidden)) {
    fail(`npm/shim.mjs contains forbidden launcher capability: ${forbidden}`);
  }
}

if (!shim.includes("shell: false")) {
  fail("npm/shim.mjs must explicitly disable shell invocation");
}

if (process.exitCode) {
  process.exit();
}
console.log("security:check ok — MIT, no install hooks, no env/filesystem launcher override");
