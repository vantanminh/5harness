import { cp, mkdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const sourceDirectory = resolve(webDirectory, "dist");
const targetDirectory = resolve(webDirectory, "dist-worker");

await rm(targetDirectory, { recursive: true, force: true });
await mkdir(targetDirectory, { recursive: true });
await cp(sourceDirectory, targetDirectory, {
  recursive: true,
  filter: (source) => basename(source) !== "_redirects",
});

console.log(`Prepared Worker assets in ${targetDirectory}`);
