import { appCheckToken, idToken } from "./firebase";

const apiBase = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export type ApiFailure = Error & {
  status?: number;
  code?: string;
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = await idToken();
  if (token) headers.set("Authorization", "Bearer " + token);
  const check = await appCheckToken();
  if (check) headers.set("X-Firebase-AppCheck", check);

  const response = await fetch(apiBase + path, {
    ...init,
    headers,
    credentials: init.credentials ?? "omit",
  });
  if (!response.ok) {
    let payload: { error?: string; message?: string } = {};
    try {
      payload = await response.json();
    } catch {
      // Keep the status-only error below.
    }
    const failure = new Error(
      payload.message || "Cloud request failed (HTTP " + response.status + ").",
    ) as ApiFailure;
    failure.status = response.status;
    failure.code = payload.error;
    throw failure;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}
