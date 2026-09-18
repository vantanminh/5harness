import { describe, expect, it } from "vitest";
import { buildOAuthCallbackUrl } from "./oauth";

describe("hosted OAuth callback construction", () => {
  it("preserves the provider issuer on a successful ChatGPT callback", () => {
    const callback = new URL(buildOAuthCallbackUrl(
      "https://chatgpt.com/connector_platform_oauth_redirect?existing=1",
      {
        code: "auth-code",
        state: "state-value",
        iss: "https://5harness.knotree.com",
      },
    ));

    expect(callback.searchParams.get("existing")).toBe("1");
    expect(callback.searchParams.get("code")).toBe("auth-code");
    expect(callback.searchParams.get("state")).toBe("state-value");
    expect(callback.searchParams.get("iss")).toBe("https://5harness.knotree.com");
  });

  it("includes the issuer on a denied callback", () => {
    const callback = new URL(buildOAuthCallbackUrl(
      "https://chatgpt.com/connector_platform_oauth_redirect",
      {
        error: "access_denied",
        state: "state-value",
        iss: "https://5harness.knotree.com",
      },
    ));

    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe("state-value");
    expect(callback.searchParams.get("iss")).toBe("https://5harness.knotree.com");
  });
});
