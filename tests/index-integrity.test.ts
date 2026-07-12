import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeIndexChecksum,
  INDEX_SCHEMA_VERSION,
  validateIndexShape,
} from "../src/domain/index-integrity.js";
import {
  buildProjectIndex,
  checkIndexIntegrity,
  loadProjectIndex,
  writeProjectIndex,
} from "../src/application/index-store.js";
import { addStoryMd } from "../src/application/md-durable.js";
import {
  acquireLock,
  mutationLockPath,
  tryAcquireLock,
  withMutationLock,
} from "../src/infrastructure/lockfile.js";
import { atomicWriteFile } from "../src/infrastructure/atomic-write.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-int-"));
  tempDirs.push(dir);
  return dir;
}

describe("index integrity domain (US-034)", () => {
  it("computes stable checksums", () => {
    const payload = {
      version: 1,
      built_at: "2026-01-01T00:00:00.000Z",
      projectRoot: "/p",
      catalog: [{ id: "a" }, { id: "b" }],
      edges: [],
      texts: { a: "x" },
    };
    const c1 = computeIndexChecksum(payload);
    const c2 = computeIndexChecksum({
      ...payload,
      catalog: [{ id: "b" }, { id: "a" }], // different array order → different hash
    });
    expect(c1).toMatch(/^[a-f0-9]{64}$/);
    expect(c1).not.toBe(c2);
    expect(computeIndexChecksum(payload)).toBe(c1);
  });

  it("validateIndexShape rejects bad schema and bad checksum", () => {
    const bad = validateIndexShape({ version: 99, catalog: [], edges: [], texts: {} });
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === "schema_mismatch")).toBe(true);

    const base = {
      version: INDEX_SCHEMA_VERSION,
      built_at: "t",
      projectRoot: "/p",
      catalog: [],
      edges: [],
      texts: {},
    };
    const checksum = computeIndexChecksum(base);
    expect(validateIndexShape({ ...base, checksum }).ok).toBe(true);
    expect(
      validateIndexShape({ ...base, checksum: "deadbeef" }).issues.some(
        (i) => i.code === "checksum_mismatch",
      ),
    ).toBe(true);
    expect(
      validateIndexShape(base).issues.some((i) => i.code === "missing_checksum"),
    ).toBe(true);
  });
});

describe("atomic index write + lock (US-034)", () => {
  it("writeProjectIndex writes checksum atomically and load validates", () => {
    const root = tmp();
    addStoryMd(
      { projectRoot: root },
      { id: "US-INT", title: "Integrity", lane: "tiny" },
    );
    const written = writeProjectIndex(root);
    expect(fs.existsSync(written.path)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(written.path, "utf8")) as {
      checksum?: string;
      version: number;
    };
    expect(raw.version).toBe(INDEX_SCHEMA_VERSION);
    expect(raw.checksum).toMatch(/^[a-f0-9]{64}$/);
    const loaded = loadProjectIndex(root);
    expect(loaded?.checksum).toBe(raw.checksum);

    const integrity = checkIndexIntegrity(root);
    expect(integrity.ok).toBe(true);
    expect(integrity.missingEntityCount).toBe(0);
  });

  it("detects corrupt checksum and missing entity files", () => {
    const root = tmp();
    addStoryMd(
      { projectRoot: root },
      { id: "US-MISS", title: "Will delete", lane: "tiny" },
    );
    writeProjectIndex(root);
    const p = path.join(root, ".5harness", "index", "index.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    raw.checksum = "0".repeat(64);
    fs.writeFileSync(p, JSON.stringify(raw, null, 2), "utf8");
    let integrity = checkIndexIntegrity(root);
    expect(integrity.ok).toBe(false);
    expect(integrity.issues.some((i) => i.code === "checksum_mismatch")).toBe(
      true,
    );

    // restore valid checksum then delete entity
    writeProjectIndex(root);
    fs.unlinkSync(path.join(root, "docs", "stories", "US-MISS.md"));
    integrity = checkIndexIntegrity(root);
    expect(integrity.ok).toBe(false);
    expect(integrity.missingEntityCount).toBeGreaterThan(0);
  });

  it("atomicWriteFile replaces target via rename", () => {
    const dir = tmp();
    const file = path.join(dir, "out.json");
    atomicWriteFile(file, '{"a":1}\n');
    expect(fs.readFileSync(file, "utf8")).toBe('{"a":1}\n');
    atomicWriteFile(file, '{"a":2}\n');
    expect(fs.readFileSync(file, "utf8")).toBe('{"a":2}\n');
  });

  it("lockfile exclusive acquire and stale reclaim", () => {
    const root = tmp();
    const lockPath = mutationLockPath(root);
    const a = tryAcquireLock(lockPath, { pid: 1, now: () => 1_000_000 });
    expect(a).not.toBeNull();
    const b = tryAcquireLock(lockPath, { pid: 2, now: () => 1_000_100 });
    expect(b).toBeNull();
    // stale after 30s
    const c = tryAcquireLock(lockPath, {
      pid: 3,
      now: () => 1_000_000 + 31_000,
      staleMs: 30_000,
    });
    expect(c).not.toBeNull();
    c!.release();
    a!.release();

    const result = withMutationLock(root, () => 42);
    expect(result).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("acquireLock throws when wait expires", () => {
    const root = tmp();
    const lockPath = mutationLockPath(root);
    const held = tryAcquireLock(lockPath, { pid: 99, now: () => Date.now() });
    expect(held).not.toBeNull();
    expect(() =>
      acquireLock(lockPath, {
        waitMs: 80,
        pollMs: 20,
        pid: 100,
        staleMs: 60_000,
      }),
    ).toThrow(/Could not acquire lock/);
    held!.release();
  });

  it("buildProjectIndex includes checksum", () => {
    const root = tmp();
    addStoryMd(
      { projectRoot: root },
      { id: "US-B", title: "B", lane: "tiny" },
    );
    const idx = buildProjectIndex(root);
    expect(idx.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
