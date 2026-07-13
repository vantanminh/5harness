import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDefaultAuth,
  verifyCredentials,
  changePassword,
  setPasswordDirectly,
  createSession,
  validateSession,
  destroySession,
  extractSessionToken,
  readAuthData,
  authFilePath,
} from "../src/infrastructure/dashboard-auth.js";
import {
  handleDashboardRequest,
  startDashboard,
} from "../src/application/dashboard.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function getUrl(baseUrl: string, path: string, cookie?: string): Promise<{ status: number; body: string; headers?: http.IncomingHttpHeaders }> {
  const base = baseUrl.replace(/\/$/, "");
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {};
    if (cookie) opts.headers = { Cookie: cookie };
    http.get(`${base}${path}`, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    }).on("error", reject);
  });
}

function postForm(baseUrl: string, path: string, body: string, cookie?: string): Promise<{ status: number; body: string; headers?: http.IncomingHttpHeaders }> {
  const base = baseUrl.replace(/\/$/, "");
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${base}${path}`);
    const opts: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    if (cookie) (opts.headers as Record<string, string>)["Cookie"] = cookie;
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
function extractSessionCookie(headers?: http.IncomingHttpHeaders): string | null {
  const setCookie = headers?.["set-cookie"];
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? "");
  const match = cookieStr.match(/harness_session=([^;]+)/);
  return match ? `harness_session=${match[1]}` : null;
}

describe("dashboard auth (US-042)", () => {
  it("ensureDefaultAuth creates default admin/admin credentials", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    const data = ensureDefaultAuth({ harnessHome: home });
    expect(data.passwordHash).toBeTruthy();
    expect(data.salt).toBeTruthy();
    expect(data.created_at).toBeTruthy();
    expect(data.updated_at).toBeTruthy();
    const file = authFilePath(home);
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(raw.passwordHash).toBe(data.passwordHash);
    expect(raw.salt).toBe(data.salt);
  });

  it("ensureDefaultAuth is idempotent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    const first = ensureDefaultAuth({ harnessHome: home });
    const second = ensureDefaultAuth({ harnessHome: home });
    expect(second.passwordHash).toBe(first.passwordHash);
    expect(second.salt).toBe(first.salt);
    expect(second.created_at).toBe(first.created_at);
  });

  it("verifyCredentials accepts default admin/admin", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    ensureDefaultAuth({ harnessHome: home });
    expect(verifyCredentials("admin", "admin", { harnessHome: home })).toBe(true);
  });

  it("verifyCredentials rejects wrong password", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    ensureDefaultAuth({ harnessHome: home });
    expect(verifyCredentials("admin", "wrongpassword", { harnessHome: home })).toBe(false);
  });

  it("verifyCredentials rejects wrong username", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    ensureDefaultAuth({ harnessHome: home });
    expect(verifyCredentials("root", "admin", { harnessHome: home })).toBe(false);
  });

  it("changePassword works with correct current password", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    ensureDefaultAuth({ harnessHome: home });
    const ok = changePassword("admin", "admin", "new-secret", { harnessHome: home });
    expect(ok).toBe(true);
    expect(verifyCredentials("admin", "admin", { harnessHome: home })).toBe(false);
    expect(verifyCredentials("admin", "new-secret", { harnessHome: home })).toBe(true);
  });

  it("changePassword rejects wrong current password", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    ensureDefaultAuth({ harnessHome: home });
    expect(changePassword("admin", "wrong", "new-secret", { harnessHome: home })).toBe(false);
    expect(verifyCredentials("admin", "admin", { harnessHome: home })).toBe(true);
  });

  it("changePassword rejects empty new password", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    ensureDefaultAuth({ harnessHome: home });
    expect(changePassword("admin", "admin", "", { harnessHome: home })).toBe(false);
  });

  it("setPasswordDirectly sets password without current check", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    setPasswordDirectly("cli-password", { harnessHome: home });
    expect(verifyCredentials("admin", "cli-password", { harnessHome: home })).toBe(true);
    expect(verifyCredentials("admin", "admin", { harnessHome: home })).toBe(false);
  });

  it("setPasswordDirectly throws on empty password", () => {
    expect(() => setPasswordDirectly("")).toThrow("Password must not be empty");
    
  });

  it("password hashes are salted and different each time", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    const data1 = setPasswordDirectly("same-password", { harnessHome: home });
    const data2 = setPasswordDirectly("same-password", { harnessHome: home });
    expect(data1.passwordHash).not.toBe(data2.passwordHash);
    expect(data1.salt).not.toBe(data2.salt);
  });

  it("createSession generates valid session", () => {
    const session = createSession();
    expect(session.token).toBeTruthy();
    expect(session.token.length).toBe(64);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("validateSession accepts valid token", () => {
    const session = createSession();
    expect(validateSession(session.token)).toBe(true);
  });

  it("validateSession rejects invalid token", () => {
    expect(validateSession("invalid-token")).toBe(false);
  });

  it("destroySession removes token", () => {
    const session = createSession();
    expect(validateSession(session.token)).toBe(true);
    destroySession(session.token);
    expect(validateSession(session.token)).toBe(false);
  });

  it("extractSessionToken parses Cookie header", () => {
    expect(extractSessionToken("harness_session=abc123; Other=val")).toBe("abc123");
    expect(extractSessionToken("Other=val; harness_session=xyz789")).toBe("xyz789");
    expect(extractSessionToken(undefined)).toBe(null);
    expect(extractSessionToken("")).toBe(null);
    expect(extractSessionToken("other=val")).toBe(null);
  });

  it("readAuthData returns null when no file exists", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
    tempDirs.push(home);
    expect(readAuthData({ harnessHome: home })).toBe(null);
  });

  describe("HTTP auth flow", () => {
    it("GET /login returns login page", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const res = await getUrl(dash.url, "/login");
        expect(res.status).toBe(200);
        expect(res.body).toMatch(/Login/);
        expect(res.body).toMatch(/username/);
      } finally { await dash.close(); }
    });

    it("GET / redirects to /login when unauthenticated", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const res = await getUrl(dash.url, "/");
        expect(res.status).toBe(302);
        expect(res.headers?.location).toMatch(/\/login/);
      } finally { await dash.close(); }
    });

    it("POST /api/auth/login with correct credentials sets session cookie", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const res = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        expect(res.status).toBe(302);
        const cookie = extractSessionCookie(res.headers);
        expect(cookie).toBeTruthy();
        const homeRes = await getUrl(dash.url, "/", cookie!);
        expect(homeRes.status).toBe(200);
        expect(homeRes.body).toMatch(/Harness Dashboard/);
      } finally { await dash.close(); }
    });

    it("POST /api/auth/login with wrong password shows error", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const res = await postForm(dash.url, "/api/auth/login", "username=admin&password=wrong");
        expect(res.status).toBe(200);
        expect(res.body).toMatch(/Invalid username or password/);
      } finally { await dash.close(); }
    });

    it("POST /api/auth/logout clears session", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const loginRes = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        const cookie = extractSessionCookie(loginRes.headers);
        expect(cookie).toBeTruthy();
        const logoutRes = await postForm(dash.url, "/api/auth/logout", "", cookie!);
        expect(logoutRes.status).toBe(302);
        expect(logoutRes.headers?.location).toBe("/login");
        const homeRes = await getUrl(dash.url, "/", cookie!);
        expect(homeRes.status).toBe(302);
      } finally { await dash.close(); }
    });

    it("GET /settings returns change password page when authenticated", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const loginRes = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        const cookie = extractSessionCookie(loginRes.headers);
        expect(cookie).toBeTruthy();
        const settingsRes = await getUrl(dash.url, "/settings", cookie!);
        expect(settingsRes.status).toBe(200);
        expect(settingsRes.body).toMatch(/Change Password/);
      } finally { await dash.close(); }
    });

    it("POST /api/auth/change-password updates password in UI", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const loginRes = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        const cookie = extractSessionCookie(loginRes.headers);
        expect(cookie).toBeTruthy();
        const chRes = await postForm(dash.url, "/api/auth/change-password", "currentPassword=admin&newPassword=new-dash-pass", cookie!);
        expect(chRes.status).toBe(200);
        expect(chRes.body).toMatch(/Password updated successfully/);
        const badLogin = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        expect(badLogin.body).toMatch(/Invalid username or password/);
        const goodLogin = await postForm(dash.url, "/api/auth/login", "username=admin&password=new-dash-pass");
        expect(goodLogin.status).toBe(302);
      } finally { await dash.close(); }
    });

    it("POST /api/auth/change-password rejects wrong current password", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const loginRes = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        const cookie = extractSessionCookie(loginRes.headers);
        expect(cookie).toBeTruthy();
        const chRes = await postForm(dash.url, "/api/auth/change-password", "currentPassword=wrong&newPassword=new-pass", cookie!);
        expect(chRes.status).toBe(200);
        expect(chRes.body).toMatch(/Current password is incorrect/);
      } finally { await dash.close(); }
    });

    it("API routes return 401 when unauthenticated", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const res = await getUrl(dash.url, "/api/projects");
        expect(res.status).toBe(401);
        expect(res.body).toMatch(/Unauthorized/);
      } finally { await dash.close(); }
    });

    it("API routes work when authenticated", async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const dash = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
      try {
        const loginRes = await postForm(dash.url, "/api/auth/login", "username=admin&password=admin");
        const cookie = extractSessionCookie(loginRes.headers);
        expect(cookie).toBeTruthy();
        const res = await getUrl(dash.url, "/api/projects", cookie!);
        expect(res.status).toBe(200);
      } finally { await dash.close(); }
    });

    it("handler: /login returns login page", () => {
      const res = handleDashboardRequest("GET", "/login");
      expect(res.status).toBe(200);
      expect(res.body).toMatch(/Login/);
      expect(res.body).toMatch(/admin/);
    });

    it("handler: /settings returns settings page", () => {
      const res = handleDashboardRequest("GET", "/settings");
      expect(res.status).toBe(200);
      expect(res.body).toMatch(/Change Password/);
    });

    it("handler: home page shows settings/logout nav links", () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-auth-"));
      tempDirs.push(home);
      const res = handleDashboardRequest("GET", "/", { env: { ...process.env, HARNESS_HOME: home } });
      expect(res.status).toBe(200);
      expect(res.body).toMatch(/Settings/);
      expect(res.body).toMatch(/Logout/);
      expect(res.body).toMatch(/\/api\/auth\/logout/);
    });
  });
});
