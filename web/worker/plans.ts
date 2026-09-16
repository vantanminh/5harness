import { isValidProjectId, randomOpaque } from "./protocol";

export const PLAN_TOKEN_MIN = 12;
export const PLAN_TOKEN_MAX = 32;
export const HANDOFF_PREFIX = "please implement plan from harness --";
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface CloudPlan {
  token: string;
  project_id: string;
  title: string;
  idea: string;
  research_notes: string;
  plan_markdown: string;
  implement_prompt: string;
  handoff_command: string;
  created_at: string;
  created_by: string | null;
  client_name: string | null;
}

export function generatePlanToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let token = "";
  for (const byte of bytes) token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return token;
}

export function validatePlanToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= PLAN_TOKEN_MIN &&
    value.length <= PLAN_TOKEN_MAX &&
    /^[a-z0-9]+$/.test(value)
  );
}

export function handoffCommand(token: string): string {
  return HANDOFF_PREFIX + token;
}

function boundText(value: unknown, max: number, fallback = ""): string | null {
  if (value == null) return fallback;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

export function validatePlanInput(
  value: unknown,
  fallback: { uid: string; email?: string | null },
): CloudPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isValidProjectId(raw.project_id)) return null;
  const title = boundText(raw.title, 200);
  const idea = boundText(raw.idea, 8_000);
  const research_notes = boundText(raw.research_notes, 16_000, "");
  const plan_markdown = boundText(raw.plan_markdown, 80_000);
  const implement_prompt = boundText(raw.implement_prompt, 80_000);
  const client_name = boundText(raw.client_name, 80, "mcp");
  if (!title || !idea || research_notes == null || !plan_markdown || !implement_prompt) {
    return null;
  }
  const token =
    validatePlanToken(raw.token) ? raw.token : generatePlanToken();
  return {
    token,
    project_id: raw.project_id,
    title,
    idea,
    research_notes,
    plan_markdown,
    implement_prompt,
    handoff_command: handoffCommand(token),
    created_at: new Date().toISOString(),
    created_by: fallback.email ?? fallback.uid,
    client_name,
  };
}

export function planPublicView(plan: CloudPlan): CloudPlan {
  return { ...plan };
}
