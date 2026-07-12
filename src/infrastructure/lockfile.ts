import fs from "node:fs";
import path from "node:path";

export type LockHandle = {
  path: string;
  release: () => void;
};

export type AcquireLockOptions = {
  /** Stale lock threshold in ms (default 30s). */
  staleMs?: number;
  /** How long to wait for the lock (default 5s). */
  waitMs?: number;
  /** Poll interval while waiting (default 50ms). */
  pollMs?: number;
  now?: () => number;
  pid?: number;
};

type LockPayload = {
  pid: number;
  acquiredAt: string;
  host?: string;
};

/**
 * Path for project-local mutation/index lock (US-034).
 */
export function mutationLockPath(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "mutation.lock");
}

function readLock(file: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as LockPayload;
  } catch {
    return null;
  }
}

function isStale(
  payload: LockPayload | null,
  staleMs: number,
  now: number,
): boolean {
  if (!payload?.acquiredAt) return true;
  const t = Date.parse(payload.acquiredAt);
  if (Number.isNaN(t)) return true;
  return now - t > staleMs;
}

/**
 * Try to acquire an exclusive lock file. Returns null if busy and not stale.
 */
export function tryAcquireLock(
  lockPath: string,
  options: AcquireLockOptions = {},
): LockHandle | null {
  const staleMs = options.staleMs ?? 30_000;
  const nowFn = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const now = nowFn();

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    const existing = readLock(lockPath);
    if (!isStale(existing, staleMs, now)) {
      return null;
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      return null;
    }
  }

  const payload: LockPayload = {
    pid,
    acquiredAt: new Date(now).toISOString(),
  };

  // Exclusive create — fails if another process won the race.
  try {
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return null;
    throw err;
  }

  return {
    path: lockPath,
    release: () => {
      try {
        if (fs.existsSync(lockPath)) {
          const cur = readLock(lockPath);
          if (cur?.pid === pid) {
            fs.unlinkSync(lockPath);
          }
        }
      } catch {
        // release is best-effort
      }
    },
  };
}

/**
 * Acquire lock, waiting up to waitMs. Throws if still busy.
 */
export function acquireLock(
  lockPath: string,
  options: AcquireLockOptions = {},
): LockHandle {
  const waitMs = options.waitMs ?? 5_000;
  const pollMs = options.pollMs ?? 50;
  const nowFn = options.now ?? Date.now;
  const start = nowFn();

  for (;;) {
    const handle = tryAcquireLock(lockPath, options);
    if (handle) return handle;
    if (nowFn() - start >= waitMs) {
      throw new Error(
        `Could not acquire lock at ${lockPath} within ${waitMs}ms (another harness process may be writing). Retry shortly, or remove a stale lock after confirming no harness process is running.`,
      );
    }
    sleepMs(pollMs);
  }
}

function sleepMs(ms: number): void {
  try {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin fallback */
    }
  }
}

/**
 * Run fn while holding the project mutation lock.
 */
export function withMutationLock<T>(
  projectRoot: string,
  fn: () => T,
  options?: AcquireLockOptions,
): T {
  const handle = acquireLock(mutationLockPath(projectRoot), options);
  try {
    return fn();
  } finally {
    handle.release();
  }
}
