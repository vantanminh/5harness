interface Env {
  FIREBASE_API_URL: string;
  FIREBASE_PROXY_TOKEN?: string;
}

type PagesContext = {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
};

export const onRequest = async ({ request, env, params }: PagesContext): Promise<Response> => {
  if (!env.FIREBASE_API_URL) {
    return Response.json(
      { error: "backend_not_configured", message: "Firebase API proxy is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parameter = params.path;
  const path = Array.isArray(parameter) ? parameter.join("/") : parameter || "";
  let upstream: URL;
  try {
    upstream = new URL(
      env.FIREBASE_API_URL.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, ""),
    );
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname);
    if (upstream.protocol !== "https:" && !(upstream.protocol === "http:" && local)) {
      throw new Error("Firebase API URL must use HTTPS outside local development.");
    }
  } catch {
    return Response.json(
      { error: "backend_not_configured", message: "Firebase API proxy URL is invalid." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  upstream.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("cookie");
  headers.delete("x-harness-proxy");
  if (env.FIREBASE_PROXY_TOKEN) {
    headers.set("X-Harness-Proxy", env.FIREBASE_PROXY_TOKEN);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  let response: Response;
  try {
    response = await fetch(upstream, init);
  } catch {
    return Response.json(
      { error: "backend_unavailable", message: "Firebase cloud backend is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
