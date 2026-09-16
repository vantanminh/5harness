import type { Env } from "./types";

function allowedOrigins(env: Env): string[] {
  return (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  const configured = allowedOrigins(env);
  if (configured.includes("*")) return true;
  if (configured.length > 0) return configured.includes(origin);
  return false;
}

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Content-Type, Cookie, X-Firebase-AppCheck, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const origin = request.headers.get("Origin");
  if (origin && originAllowed(request, env)) {
    const configured = allowedOrigins(env);
    if (!configured.includes("*")) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Credentials", "true");
    } else {
      headers.set("Access-Control-Allow-Origin", "*");
    }
  }
  return headers;
}

export function withCors(request: Request, env: Env, response: Response): Response {
  const headers = corsHeaders(request, env);
  for (const [name, value] of response.headers) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function json(
  request: Request,
  env: Env,
  data: unknown,
  status = 200,
): Response {
  return withCors(
    request,
    env,
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  );
}

export function errorJson(
  request: Request,
  env: Env,
  error: string,
  message: string,
  status: number,
): Response {
  return json(request, env, { error, message }, status);
}
