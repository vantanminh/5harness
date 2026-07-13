/**
 * Shared browser auth surfaces: login + MCP OAuth approval.
 * One login page for dashboard and OAuth consent; approval never collects credentials.
 */

const AUTH_CSS = `
  :root {
    --bg: #f4f6f9;
    --surface: #ffffff;
    --fg: #15202b;
    --muted: #5b6b7c;
    --border: #d7dee7;
    --border-strong: #c2ccd8;
    --link: #0b6bcb;
    --link-hover: #0958a8;
    --primary: #0b6bcb;
    --primary-fg: #ffffff;
    --danger-bg: #fff1f0;
    --danger-fg: #a11212;
    --danger-border: #f0c2c0;
    --ok-bg: #edf8f0;
    --ok-fg: #1a7f37;
    --chip-bg: #eef3f9;
    --shadow: 0 12px 40px rgba(21, 32, 43, 0.08);
    --ring: 0 0 0 3px rgba(11, 107, 203, 0.22);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --fg: #e6edf3;
      --muted: #9aa7b5;
      --border: #30363d;
      --border-strong: #3d464f;
      --link: #58a6ff;
      --link-hover: #79b8ff;
      --primary: #2f81f7;
      --primary-fg: #ffffff;
      --danger-bg: #3d1214;
      --danger-fg: #ffb4b0;
      --danger-border: #6e2a2c;
      --ok-bg: #12261a;
      --ok-fg: #3fb950;
      --chip-bg: #21262d;
      --shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      --ring: 0 0 0 3px rgba(47, 129, 247, 0.35);
    }
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--fg);
    background:
      radial-gradient(1200px 500px at 10% -10%, rgba(11, 107, 203, 0.12), transparent 55%),
      radial-gradient(900px 420px at 100% 0%, rgba(31, 167, 114, 0.08), transparent 50%),
      var(--bg);
  }
  .shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }
  .card {
    width: 100%;
    max-width: 26rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 1rem;
    box-shadow: var(--shadow);
    padding: 1.75rem 1.6rem 1.5rem;
  }
  .card.wide { max-width: 30rem; }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 1.25rem;
  }
  .brand-mark {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.65rem;
    display: grid;
    place-items: center;
    font-weight: 750;
    font-size: 0.95rem;
    letter-spacing: -0.03em;
    color: var(--primary-fg);
    background: linear-gradient(145deg, var(--primary), #1f9d6a);
  }
  .brand-text { display: grid; gap: 0.05rem; }
  .brand-text strong { font-size: 0.98rem; letter-spacing: -0.01em; }
  .brand-text span { font-size: 0.8rem; color: var(--muted); }
  h1 {
    margin: 0 0 0.4rem;
    font-size: 1.35rem;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }
  .lede {
    margin: 0 0 1.25rem;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .alert {
    margin: 0 0 1rem;
    padding: 0.7rem 0.85rem;
    border-radius: 0.55rem;
    border: 1px solid var(--danger-border);
    background: var(--danger-bg);
    color: var(--danger-fg);
    font-size: 0.92rem;
  }
  .alert.ok {
    border-color: color-mix(in srgb, var(--ok-fg) 30%, var(--border));
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  form { display: grid; gap: 0.9rem; }
  label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  input[type="text"],
  input[type="password"] {
    width: 100%;
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.55rem;
    padding: 0.7rem 0.8rem;
  }
  input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: var(--ring);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin-top: 0.25rem;
  }
  .actions.stack { display: grid; }
  button, .btn {
    font: inherit;
    font-weight: 600;
    border-radius: 0.55rem;
    border: 1px solid transparent;
    padding: 0.72rem 1rem;
    cursor: pointer;
  }
  button.primary, .btn.primary {
    background: var(--primary);
    color: var(--primary-fg);
  }
  button.primary:hover, .btn.primary:hover { filter: brightness(1.05); }
  button.secondary, .btn.secondary {
    background: transparent;
    color: var(--fg);
    border-color: var(--border-strong);
  }
  button.secondary:hover, .btn.secondary:hover { background: var(--chip-bg); }
  button.full { width: 100%; }
  .hint {
    margin: 1rem 0 0;
    font-size: 0.8rem;
    color: var(--muted);
    text-align: center;
  }
  .hint code {
    font-size: 0.85em;
    background: var(--chip-bg);
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.05rem 0.3rem;
  }
  .meta {
    display: grid;
    gap: 0.75rem;
    margin: 0 0 1.15rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
  }
  .meta-row { display: grid; gap: 0.25rem; }
  .meta-row .k {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    font-weight: 700;
  }
  .meta-row .v {
    font-size: 0.95rem;
    word-break: break-word;
  }
  .meta-row code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.84rem;
    word-break: break-all;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    background: var(--chip-bg);
    border: 1px solid var(--border);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .session-note {
    margin: 0 0 1rem;
    font-size: 0.88rem;
    color: var(--muted);
  }
`;

export function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Allow only same-origin relative paths (path + query). Blocks open redirects.
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) return "/";
  if (value.length > 2048) return "/";
  const noHash = value.split("#")[0] ?? "/";
  // Reject control characters and backslashes (Windows path tricks)
  if (/[\u0000-\u001f\\]/.test(noHash)) return "/";
  return noHash || "/";
}

export function renderLoginPage(options?: {
  error?: string;
  redirect?: string;
}): string {
  const redirect = safeRedirectPath(options?.redirect);
  const errorHtml = options?.error
    ? `<p class="alert" role="alert">${htmlEscape(options.error)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Sign in — Harness</title>
  <style>${AUTH_CSS}</style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">5h</div>
        <div class="brand-text">
          <strong>Harness</strong>
          <span>Local administrator sign-in</span>
        </div>
      </div>
      <h1>Sign in</h1>
      <p class="lede">Use the machine-local admin account to open the dashboard or approve MCP clients.</p>
      ${errorHtml}
      <form method="post" action="/api/auth/login">
        <input type="hidden" name="redirect" value="${htmlEscape(redirect)}" />
        <label for="username">Username
          <input id="username" name="username" type="text" value="admin" autocomplete="username" required autofocus />
        </label>
        <label for="password">Password
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </label>
        <div class="actions stack">
          <button class="primary full" type="submit">Sign in</button>
        </div>
      </form>
      <p class="hint">Default is <code>admin</code> / <code>admin</code>. Change it with <code>harness dashboard set-password</code>.</p>
    </div>
  </div>
</body>
</html>`;
}

export function renderApprovalPage(input: {
  requestId: string;
  clientName: string;
  scope: string;
  resource: string;
  error?: string;
}): string {
  const errorHtml = input.error
    ? `<p class="alert" role="alert">${htmlEscape(input.error)}</p>`
    : "";
  const scopes = input.scope
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => `<span class="chip">${htmlEscape(scope)}</span>`)
    .join(" ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Authorize MCP — Harness</title>
  <style>${AUTH_CSS}</style>
</head>
<body>
  <div class="shell">
    <div class="card wide">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">5h</div>
        <div class="brand-text">
          <strong>Harness</strong>
          <span>MCP client authorization</span>
        </div>
      </div>
      <h1>Authorize access</h1>
      <p class="lede">An MCP client wants to use this machine-local Harness server. Only approve clients you trust.</p>
      ${errorHtml}
      <div class="meta">
        <div class="meta-row">
          <span class="k">Client</span>
          <span class="v"><strong>${htmlEscape(input.clientName)}</strong></span>
        </div>
        <div class="meta-row">
          <span class="k">Scope</span>
          <span class="v">${scopes || `<span class="chip">${htmlEscape(input.scope)}</span>`}</span>
        </div>
        <div class="meta-row">
          <span class="k">Resource</span>
          <span class="v"><code>${htmlEscape(input.resource)}</code></span>
        </div>
      </div>
      <p class="session-note">You are signed in with the local administrator session. Approving issues a short-lived MCP access token to the client — not your dashboard password.</p>
      <form method="post" action="/authorize">
        <input type="hidden" name="request_id" value="${htmlEscape(input.requestId)}" />
        <div class="actions">
          <button class="primary" name="action" value="approve" type="submit">Authorize</button>
          <button class="secondary" name="action" value="deny" type="submit">Deny</button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}
