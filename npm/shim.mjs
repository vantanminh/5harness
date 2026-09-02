#!/usr/bin/env node
/**
 * Thin npm bin shim. Product runtime is the native Rust binary.
 *
 * The npm package contains one binary per supported target, so the shim has to
 * choose the current target before handing over control. Keep this boundary
 * deliberately small: paths are package-relative constants, argv is passed as
 * an array, and no shell or environment-provided executable is accepted.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function rustTriple() {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
  if (p === "win32" && a === "arm64") return "aarch64-pc-windows-msvc";
  if (p === "darwin" && a === "x64") return "x86_64-apple-darwin";
  if (p === "darwin" && a === "arm64") return "aarch64-apple-darwin";
  if (p === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
  if (p === "linux" && a === "arm64") return "aarch64-unknown-linux-gnu";
  throw new Error(`5harness: unsupported platform ${p}-${a}`);
}

function packageBinaryCandidates() {
  const ext = process.platform === "win32" ? ".exe" : "";
  const t = rustTriple();
  return [
    path.join(root, "bin", `harness-${t}${ext}`),
    path.join(root, "bin", `harness${ext}`),
  ];
}

let result;
let bin;
for (const candidate of packageBinaryCandidates()) {
  const attempt = spawnSync(candidate, process.argv.slice(2), {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (attempt.error?.code === "ENOENT") {
    continue;
  }
  result = attempt;
  bin = candidate;
  break;
}

if (!result) {
  console.error(
    "5harness: native binary not found in the package. Reinstall with `npm i -g 5harness`.",
  );
  process.exitCode = 1;
} else if (result.error) {
  console.error(`5harness: failed to launch ${bin}: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status === null ? 1 : result.status;
}
