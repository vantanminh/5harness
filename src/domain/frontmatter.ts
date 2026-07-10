/**
 * Minimal YAML frontmatter (--- ... ---) for harness entity files.
 * Supports scalars (string, number, boolean, null) and string arrays.
 */

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | string[];

export type FrontmatterData = Record<string, FrontmatterValue>;

export function parseFrontmatter(content: string): {
  data: FrontmatterData;
  body: string;
} {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    return { data: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: normalized };
  }
  const yamlBlock = normalized.slice(4, end).replace(/^\r?\n/, "");
  let body = normalized.slice(end + 4); // after \n---
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);

  const data = parseSimpleYaml(yamlBlock);
  return { data, body };
}

export function serializeEntityFile(
  data: FrontmatterData,
  body: string = "",
): string {
  const yaml = serializeSimpleYaml(data);
  const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
  const bodyPart = trimmedBody ? `${trimmedBody}\n` : "";
  return `---\n${yaml}---\n${bodyPart ? `\n${bodyPart}` : ""}`;
}

function parseSimpleYaml(block: string): FrontmatterData {
  const data: FrontmatterData = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }
    const key = match[1]!;
    const rest = match[2]!;
    if (rest === "" || rest === "|" || rest === ">") {
      // block or empty → try array items
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const item = lines[j]!.match(/^\s+-\s+(.*)$/);
        if (!item) break;
        items.push(unquote(item[1]!.trim()));
        j += 1;
      }
      if (items.length > 0) {
        data[key] = items;
        i = j;
        continue;
      }
      data[key] = rest === "" ? null : rest;
      i += 1;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      if (!inner) {
        data[key] = [];
      } else {
        data[key] = inner.split(",").map((s) => unquote(s.trim()));
      }
      i += 1;
      continue;
    }
    data[key] = parseScalar(rest.trim());
    i += 1;
  }
  return data;
}

function serializeSimpleYaml(data: FrontmatterData): string {
  const keys = Object.keys(data);
  const lines: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${formatScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function parseScalar(raw: string): string | number | boolean | null {
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  return unquote(raw);
}

function unquote(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  // quote if looks special
  if (
    value === "" ||
    /[:#\[\]{},&*!|>'"%@`]/.test(value) ||
    /^\s|\s$/.test(value) ||
    value === "true" ||
    value === "false" ||
    value === "null"
  ) {
    return JSON.stringify(value);
  }
  return value;
}

export function asString(
  data: FrontmatterData,
  key: string,
): string | undefined {
  const v = data[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

export function asStringArray(
  data: FrontmatterData,
  key: string,
): string[] | undefined {
  const v = data[key];
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

export function asNumber(
  data: FrontmatterData,
  key: string,
): number | undefined {
  const v = data[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return undefined;
}

export function asBoolean01(
  data: FrontmatterData,
  key: string,
): 0 | 1 | undefined {
  const v = data[key];
  if (v === true || v === 1 || v === "1" || v === "true") return 1;
  if (v === false || v === 0 || v === "0" || v === "false") return 0;
  return undefined;
}
