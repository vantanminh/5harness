import fs from "node:fs";
import path from "node:path";

/**
 * Atomic write: write to a sibling temp file, then rename over the target.
 * Same pattern as entity/registry writes (US-034 extends to index).
 */
export function atomicWriteFile(
  absolutePath: string,
  content: string | Buffer,
  encoding: BufferEncoding = "utf8",
): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tmp = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    if (typeof content === "string") {
      fs.writeFileSync(tmp, content, encoding);
    } else {
      fs.writeFileSync(tmp, content);
    }
    fs.renameSync(tmp, absolutePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}
