import { describe, expect, it } from "vitest";
import {
  renderApprovalPage,
  renderLoginPage,
  safeRedirectPath,
} from "../src/application/auth-pages.js";

describe("auth pages", () => {
  it("safeRedirectPath allows relative path+query and rejects open redirects", () => {
    expect(safeRedirectPath("/authorize?client_id=x&state=1")).toBe(
      "/authorize?client_id=x&state=1",
    );
    expect(safeRedirectPath("/")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath("https://evil.example/phish")).toBe("/");
    expect(safeRedirectPath("//evil.example/phish")).toBe("/");
    expect(safeRedirectPath("\\\\evil\\share")).toBe("/");
  });

  it("login page is the only credential form and preserves redirect", () => {
    const html = renderLoginPage({
      redirect: "/authorize?response_type=code&client_id=c1",
      error: "Invalid username or password",
    });
    expect(html).toMatch(/Sign in/);
    expect(html).toMatch(/name="password"/);
    expect(html).toMatch(/name="redirect" value="\/authorize\?response_type=code&amp;client_id=c1"/);
    expect(html).toMatch(/Invalid username or password/);
  });

  it("approval page never collects credentials", () => {
    const html = renderApprovalPage({
      requestId: "req_1",
      clientName: "Codex CLI",
      scope: "mcp:access",
      resource: "http://127.0.0.1:3927/mcp",
      projects: [
        { id: "project-1", name: "Demo", path: "/projects/demo" },
      ],
    });
    expect(html).toMatch(/Authorize access/);
    expect(html).toMatch(/Codex CLI/);
    expect(html).toMatch(/mcp:access/);
    expect(html).toMatch(/name="request_id" value="req_1"/);
    expect(html).toMatch(/name="project_mode" type="radio" value="single" checked/);
    expect(html).toMatch(/name="project_id" type="radio" value="project-1" checked/);
    expect(html).toMatch(/All linked projects/);
    expect(html).toMatch(/Powerful access/);
    expect(html).not.toMatch(/name="username"/);
    expect(html).not.toMatch(/name="password"/);
  });
});
