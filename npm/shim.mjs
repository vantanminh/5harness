#!/usr/bin/env node
/**
 * Thin npm bin shim. Product runtime is the native Rust binary.
 * This file only locates and execs that binary; it does not implement CLI logic.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

function candidates() {
  const ext = process.platform === "win32" ? ".exe" : "";
  const t = rustTriple();
  return [
    process.env.HARNESS_NATIVE_BIN,
    path.join(here, `harness-${t}${ext}`),
    path.join(root, "bin", `harness-${t}${ext}`),
    path.join(root, "bin", `harness${ext}`),
    path.join(root, "target", "release", `harness${ext}`),
    path.join(root, "target", "debug", `harness${ext}`),
  ].filter(Boolean);
}

const bin = candidates().find((p) => {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
});

if (!bin) {
  console.error(
    "5harness: native binary not found. Reinstall with `npm i -g 5harness` or run `cargo build --release`.",
  );
  process.exit(1);
}

const result = spawnSync(bin, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  console.error(`5harness: failed to launch ${bin}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
