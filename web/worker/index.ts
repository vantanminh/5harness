import { AuthError } from "./auth";
import { handleApi } from "./api";
import { errorJson } from "./cors";
import { ApiError } from "./errors";
import { handleOAuthRequest, isOAuthRoute, purgeOAuthData } from "./oauth";
import type { Env } from "./types";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, ctx);
      }

      // The consent UI is the SPA route. The Worker handles an actual OAuth
      // request, while the redirected oauth= URL is served as an asset.
      if (
        url.pathname === "/authorize" &&
        (url.searchParams.has("oauth") || !url.searchParams.has("client_id"))
      ) {
        return env.ASSETS
          ? env.ASSETS.fetch(request)
          : new Response("Harness Cloud assets are not configured.", { status: 503 });
      }
      if (isOAuthRoute(url.pathname)) {
        return await handleOAuthRequest(request, env, ctx);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Harness Cloud Worker is running.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return errorJson(request, env, "unauthenticated", error.message, error.status);
      }
      if (error instanceof ApiError) {
        return errorJson(request, env, error.code, error.message, error.status);
      }
      console.error(
        "Harness Cloud Worker request failed",
        error instanceof Error ? error.name : "unknown",
      );
      return errorJson(
        request,
        env,
        "internal_error",
        "Internal cloud service error.",
        500,
      );
    }
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(purgeOAuthData(env));
  },
};
