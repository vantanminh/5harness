import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { User } from "firebase/auth";

import { apiFetch, jsonBody, type ApiFailure } from "./lib/api";
import {
  firebaseConfigured,
  firebaseRefreshToken,
  signIn as signInWithGoogle,
  signOut as signOutFromFirebase,
  subscribeToAuth,
} from "./lib/firebase";
import {
  commitAuthor,
  commitClient,
  filesChanged,
  shortCommitId,
  type CloudCommit,
} from "./lib/commits";
import {
  decryptEnvelope,
  type EncryptedEnvelope,
  type SyncManifest,
} from "./lib/envelope";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Auth context is unavailable.");
  return context;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => subscribeToAuth((next) => {
    setUser(next);
    setLoading(false);
  }), []);
  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn: async () => {
      await signInWithGoogle();
    },
    signOut: signOutFromFirebase,
  }), [loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/authorize" element={<AuthorizePage />} />
            <Route path="/device" element={<DevicePage />} />
            <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
            <Route path="/projects/:projectId" element={<RequireAuth><ProjectPage /></RequireAuth>} />
            <Route path="/projects/:projectId/commits/:commitId" element={<RequireAuth><CommitDetailPage /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function SiteLayout() {
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Harness Cloud home">
          <span className="brand-mark">H</span>
          <span>Harness Cloud</span>
        </Link>
        <nav className="nav-links">
          {user ? (
            <>
              <Link to="/dashboard">Dashboard</Link>
              <Link to="/settings">Settings</Link>
              <button className="text-button" onClick={() => void signOut()}>Sign out</button>
            </>
          ) : (
            <Link to="/">Sign in</Link>
          )}
        </nav>
      </header>
      <main className="page"><Outlet /></main>
      <footer className="footer">
        <span>5harness cloud sync</span>
        <span>Encrypted before upload · Firebase Auth · Cloudflare Worker</span>
      </footer>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState label="Checking your session…" />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomePage() {
  const { user, loading, signIn } = useAuth();
  const [error, setError] = useState("");
  return (
    <section className="hero-grid">
      <div className="hero-copy">
        <p className="eyebrow">Private project memory, wherever you work</p>
        <h1>Keep Harness in sync without handing your notes to the cloud.</h1>
        <p className="lede">
          Harness Cloud stores encrypted snapshots of your durable markdown so a
          new device can pick up the same project history. Your sync passphrase
          never leaves the browser or CLI.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link className="button primary" to="/dashboard">Open dashboard <span>→</span></Link>
          ) : (
            <button
              className="button primary"
              disabled={loading || !firebaseConfigured}
              onClick={() => {
                setError("");
                void signIn().catch((reason: unknown) => setError(errorMessage(reason)));
              }}
            >
              {loading ? "Checking session…" : "Continue with Google"} <span>↗</span>
            </button>
          )}
          <a className="button quiet" href="https://github.com/vantanminh/5harness" target="_blank" rel="noreferrer">
            Read the CLI docs
          </a>
        </div>
        {!firebaseConfigured && (
          <Notice tone="warning">Firebase web configuration is missing. Configure the variables in <code>web/.env.example</code> before deploying.</Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <div className="hero-card">
        <div className="card-kicker">How it works</div>
        <div className="flow-step"><span>01</span><div><strong>Sign in here</strong><small>Firebase Auth protects your account.</small></div></div>
        <div className="flow-line" />
        <div className="flow-step"><span>02</span><div><strong>Authorize Harness</strong><small>Enter the one-time device code shown in your terminal.</small></div></div>
        <div className="flow-line" />
        <div className="flow-step"><span>03</span><div><strong>Sync encrypted snapshots</strong><small>Firebase sees metadata and ciphertext only.</small></div></div>
        <div className="privacy-pill"><span className="dot green" /> No service account keys in the browser</div>
      </div>
    </section>
  );
}

function AuthorizePage() {
  const { user, loading, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useMemo(() => parseAuthorizationRequest(), []);
  if (!request.valid) {
    return (
      <section className="center-card narrow">
        <p className="eyebrow">Authorization request</p>
        <h1>That request is not valid.</h1>
        <p className="muted">{request.error}</p>
        <Link className="button quiet" to="/">Return home</Link>
      </section>
    );
  }
  if (loading) return <LoadingState label="Checking your Firebase session…" />;
  if (!user) {
    return (
      <section className="center-card narrow">
        <p className="eyebrow">Harness CLI wants access</p>
        <h1>Sign in before you authorize.</h1>
        <p className="muted">The CLI can only receive a token after your Firebase account has approved this request.</p>
        <button className="button primary" onClick={() => void signIn().catch((reason) => setError(errorMessage(reason)))}>Sign in with Google ↗</button>
        {error && <Notice tone="error">{error}</Notice>}
      </section>
    );
  }
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const refreshToken = await firebaseRefreshToken();
      if (!refreshToken) throw new Error("Firebase session is unavailable. Sign in again.");
      const result = await apiFetch<{ redirect_uri: string; code: string; state: string }>("/oauth/authorize", {
        method: "POST",
        credentials: "include",
        body: jsonBody({
          ...request.params,
          csrf_token: request.csrfToken,
          firebase_refresh_token: refreshToken,
        }),
      });
      const callback = new URL(result.redirect_uri);
      callback.searchParams.set("code", result.code);
      callback.searchParams.set("state", result.state);
      window.location.assign(callback.toString());
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };
  const cancel = () => {
    const callback = new URL(request.params.redirect_uri);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", request.params.state);
    window.location.assign(callback.toString());
  };
  return (
    <section className="center-card consent-card">
      <div className="consent-icon">H</div>
      <p className="eyebrow">Authorize a local CLI</p>
      <h1>Connect Harness to your account</h1>
      <p className="muted">You are signed in as <strong>{user.email}</strong>. This grant lets the local Harness CLI manage encrypted snapshots belonging to this account.</p>
      <div className="scope-box">
        <div><span className="scope-icon">↕</span><div><strong>Sync durable project data</strong><small>Read and write encrypted Harness snapshots</small></div></div>
        <div><span className="scope-icon">⌁</span><div><strong>Only your projects</strong><small>Every request is isolated by your Firebase user id</small></div></div>
      </div>
      <p className="callback-note">Redirecting to local callback<br /><code>{request.params.redirect_uri}</code></p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="button-row">
        <button className="button primary" disabled={busy} onClick={() => void approve()}>{busy ? "Authorizing…" : "Authorize Harness"}</button>
        <button className="button quiet" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
    </section>
  );
}

function DevicePage() {
  const { user, loading, signIn } = useAuth();
  const initialCode = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("user_code") ?? "";
    return normalizeDeviceCode(value);
  }, []);
  const [userCode, setUserCode] = useState(initialCode);
  const [csrfToken, setCsrfToken] = useState("");
  const [csrfError, setCsrfError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiFetch<{ csrf_token: string }>("/oauth/device/csrf", { credentials: "include" })
      .then((result) => {
        if (active) setCsrfToken(result.csrf_token);
      })
      .catch((reason: unknown) => {
        if (active) setCsrfError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const approve = async () => {
    const normalized = normalizeDeviceCode(userCode);
    if (!normalized) {
      setError("Enter the eight-character code shown in your terminal.");
      return;
    }
    if (!csrfToken) {
      setError("This approval page has expired. Refresh and try again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const refreshToken = await firebaseRefreshToken();
      if (!refreshToken) throw new Error("Firebase session is unavailable. Sign in again.");
      await apiFetch<{ ok: true }>("/oauth/device/approve", {
        method: "POST",
        credentials: "include",
        body: jsonBody({
          user_code: normalized,
          csrf_token: csrfToken,
          firebase_refresh_token: refreshToken,
        }),
      });
      setApproved(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (approved) {
    return (
      <section className="center-card narrow device-card">
        <div className="consent-icon">✓</div>
        <p className="eyebrow">Device authorized</p>
        <h1>Return to your terminal.</h1>
        <p className="muted">Harness will finish signing in automatically. You can close this tab.</p>
      </section>
    );
  }
  if (loading) return <LoadingState label="Checking your Firebase session…" />;
  return (
    <section className="center-card narrow device-card">
      <div className="consent-icon">H</div>
      <p className="eyebrow">Harness device login</p>
      <h1>Connect your terminal.</h1>
      <p className="muted">Enter the code printed by <code>harness login</code>. This authorizes only the local CLI session and never displays a token.</p>
      <div className="device-form">
        <label htmlFor="device-code">Device code</label>
        <input
          id="device-code"
          className="device-code-input"
          value={userCode}
          onChange={(event) => setUserCode(normalizeDeviceCode(event.target.value))}
          placeholder="ABCD-EFGH"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          aria-describedby="device-code-help"
        />
        <small id="device-code-help">Codes expire after ten minutes.</small>
      </div>
      {!user ? (
        <>
          <p className="device-login-note">Sign in with the account that should own your Harness snapshots.</p>
          <button className="button primary" disabled={!firebaseConfigured} onClick={() => void signIn().catch((reason) => setError(errorMessage(reason)))}>Sign in with Google ↗</button>
        </>
      ) : (
        <>
          <p className="device-login-note">Signed in as <strong>{user.email}</strong>.</p>
          <button className="button primary" disabled={busy || !csrfToken} onClick={() => void approve()}>{busy ? "Authorizing…" : "Authorize terminal"}</button>
        </>
      )}
      {csrfError && <Notice tone="error">{csrfError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!firebaseConfigured && <Notice tone="warning">Firebase web configuration is missing.</Notice>}
    </section>
  );
}

type CloudProject = {
  project_id: string;
  project_name: string;
  revision: string | null;
  created_at: string | null;
  updated_at: string | null;
  plaintext_sha256: string | null;
  ciphertext_bytes: number | null;
};

type CloudUsage = {
  used: {
    sync_writes: number;
    sync_reads: number;
    sync_bytes: number;
  };
  limits: {
    sync_writes: number;
    sync_reads: number;
    sync_bytes: number;
  };
};

function DashboardPage() {
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [projectsResult, usageResult] = await Promise.all([
        apiFetch<{ projects: CloudProject[] }>("/sync/projects"),
        apiFetch<CloudUsage>("/sync/usage"),
      ]);
      setProjects(projectsResult.projects);
      setUsage(usageResult);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <section>
      <div className="section-heading">
        <div><p className="eyebrow">Your cloud workspace</p><h1>Project dashboard</h1><p className="muted">Encrypted snapshots are grouped by Harness project id.</p></div>
        <button className="button quiet" onClick={() => void load()} disabled={loading}>↻ Refresh</button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="stats-grid">
        <StatCard label="Projects" value={String(projects.length)} note="owned by this account" />
        <StatCard label="Latest sync" value={latestSync(projects)} note="based on cloud metadata" />
        <StatCard label="Daily writes" value={usage ? `${usage.used.sync_writes}/${usage.limits.sync_writes}` : "—"} note="account quota used" />
        <StatCard label="Storage model" value="Encrypted" note="ciphertext at rest" />
      </div>
      {loading ? <LoadingState label="Loading encrypted project metadata…" /> : projects.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">⌁</div><h2>No cloud snapshots yet</h2><p>Connect a local repository, then run <code>harness sync push</code>.</p><Link className="button primary" to="/settings">View setup details</Link></div>
      ) : (
        <div className="project-grid">{projects.map((project) => <ProjectCard key={project.project_id} project={project} />)}</div>
      )}
    </section>
  );
}

function ProjectCard({ project }: { project: CloudProject }) {
  return (
    <Link to={"/projects/" + encodeURIComponent(project.project_id)} className="project-card">
      <div className="project-card-top"><span className="project-badge">H</span><span className="status-label"><span className="dot green" /> synced</span></div>
      <h2>{project.project_name}</h2>
      <code className="project-id">{project.project_id}</code>
      <div className="project-meta"><span>{project.ciphertext_bytes ? formatBytes(project.ciphertext_bytes) : "—"} encrypted</span><span>{project.updated_at ? formatDate(project.updated_at) : "never"}</span></div>
      <span className="card-arrow">Open snapshot →</span>
    </Link>
  );
}

function ProjectPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<(CloudProject & { envelope: EncryptedEnvelope }) | null>(null);
  const [commits, setCommits] = useState<CloudCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptedError, setDecryptedError] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch<(CloudProject & { has_snapshot: boolean; envelope: EncryptedEnvelope })>("/sync/snapshots/" + encodeURIComponent(projectId)),
      apiFetch<{ commits: CloudCommit[] }>("/sync/snapshots/" + encodeURIComponent(projectId) + "/commits").catch(() => ({ commits: [] as CloudCommit[] })),
    ])
      .then(([result, commitResult]) => {
        if (!active) return;
        setSnapshot(result);
        setCommits(commitResult.commits ?? []);
      })
      .catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);
  const unlock = async () => {
    if (!snapshot) return;
    setDecrypting(true);
    setDecryptedError("");
    try {
      setManifest(await decryptEnvelope(snapshot.envelope, passphrase));
    } catch (reason) {
      setDecryptedError(errorMessage(reason));
    } finally {
      setDecrypting(false);
    }
  };
  const remove = async () => {
    if (!window.confirm("Delete this encrypted cloud snapshot? Local files will not be changed.")) return;
    setDeleting(true);
    try {
      await apiFetch<void>("/sync/snapshots/" + encodeURIComponent(projectId), { method: "DELETE" });
      navigate("/dashboard");
    } catch (reason) {
      setError(errorMessage(reason));
      setDeleting(false);
    }
  };
  if (loading) return <LoadingState label="Loading snapshot metadata…" />;
  return (
    <section>
      <Link className="back-link" to="/dashboard">← Back to dashboard</Link>
      <div className="section-heading project-heading"><div><p className="eyebrow">Encrypted snapshot</p><h1>{snapshot?.project_name || projectId}</h1><code>{projectId}</code></div><button className="danger-button" onClick={() => void remove()} disabled={deleting}>{deleting ? "Deleting…" : "Delete snapshot"}</button></div>
      {error ? <Notice tone="error">{error}</Notice> : snapshot && (
        <>
          <div className="detail-grid">
            <div className="detail-card"><span>Revision</span><strong>{snapshot.revision || "—"}</strong></div>
            <div className="detail-card"><span>Updated</span><strong>{snapshot.updated_at ? formatDate(snapshot.updated_at) : "—"}</strong></div>
            <div className="detail-card"><span>Encrypted size</span><strong>{snapshot.ciphertext_bytes ? formatBytes(snapshot.ciphertext_bytes) : "—"}</strong></div>
            <div className="detail-card"><span>Encryption</span><strong>AES-256-GCM</strong></div>
          </div>
          <CommitHistory projectId={projectId} commits={commits} />
          {!manifest ? (
            <div className="unlock-card"><div><p className="eyebrow">Local decryption</p><h2>Unlock this snapshot</h2><p className="muted">The passphrase is used only in this browser tab. It is never sent to Firebase.</p></div><div className="unlock-form"><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="Sync passphrase" autoComplete="off" /><button className="button primary" onClick={() => void unlock()} disabled={decrypting || passphrase.length < 12}>{decrypting ? "Decrypting…" : "Unlock locally"}</button></div>{decryptedError && <Notice tone="error">{decryptedError}</Notice>}</div>
          ) : (
            <ManifestView manifest={manifest} onLock={() => { setManifest(null); setPassphrase(""); }} />
          )}
        </>
      )}
    </section>
  );
}

function CommitHistory({ projectId, commits }: { projectId: string; commits: CloudCommit[] }) {
  return (
    <div className="commit-card">
      <div className="manifest-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>{commits.length} sync commit{commits.length === 1 ? "" : "s"}</h2>
          <p className="muted">Each auto-sync stores only changed durable paths, with author, client, and time.</p>
        </div>
      </div>
      {commits.length === 0 ? (
        <p className="muted">No commit history yet. Push or auto-sync from a current CLI.</p>
      ) : (
        <div className="commit-list">
          {commits.map((commit) => (
            <Link
              key={commit.id}
              className="commit-row"
              to={"/projects/" + encodeURIComponent(projectId) + "/commits/" + encodeURIComponent(commit.id)}
            >
              <code className="commit-id">{shortCommitId(commit.id)}</code>
              <div className="commit-copy">
                <strong>{commit.message}</strong>
                <span>{commitAuthor(commit)} · {commitClient(commit)} · {commit.created_at ? formatDate(commit.created_at) : "unknown time"}</span>
              </div>
              <span className="commit-files">{filesChanged(commit)} files</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitDetailPage() {
  const { projectId = "", commitId = "" } = useParams();
  const [commit, setCommit] = useState<CloudCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void apiFetch<{ commit: CloudCommit }>(
      "/sync/snapshots/" + encodeURIComponent(projectId) + "/commits/" + encodeURIComponent(commitId),
    )
      .then((result) => { if (active) setCommit(result.commit); })
      .catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, commitId]);
  if (loading) return <LoadingState label="Loading commit…" />;
  return (
    <section>
      <Link className="back-link" to={"/projects/" + encodeURIComponent(projectId)}>← Back to snapshot</Link>
      {error && <Notice tone="error">{error}</Notice>}
      {commit && (
        <>
          <div className="section-heading project-heading">
            <div>
              <p className="eyebrow">Sync commit</p>
              <h1>{commit.message}</h1>
              <code>{commit.id}</code>
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-card"><span>Author</span><strong>{commitAuthor(commit)}</strong></div>
            <div className="detail-card"><span>When</span><strong>{commit.created_at ? formatDate(commit.created_at) : "—"}</strong></div>
            <div className="detail-card"><span>Client</span><strong>{commitClient(commit)}</strong></div>
            <div className="detail-card"><span>Parent</span><strong>{commit.parent_id ? shortCommitId(commit.parent_id) : "root"}</strong></div>
          </div>
          <div className="commit-card">
            <div className="manifest-heading">
              <div>
                <p className="eyebrow">Changed paths</p>
                <h2>{filesChanged(commit)} durable files</h2>
                <p className="muted">Only paths that changed in this commit are stored in the history record.</p>
              </div>
            </div>
            <div className="file-list">
              {(commit.changed_paths ?? []).map((file) => (
                <div className={"file-row change-" + file.change} key={file.path}>
                  <span className="file-type">{file.change.slice(0, 1).toUpperCase()}</span>
                  <code>{file.path}</code>
                  <span>{file.change}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ManifestView({ manifest, onLock }: { manifest: SyncManifest; onLock: () => void }) {
  return (
    <div className="manifest-card"><div className="manifest-heading"><div><p className="eyebrow">Decrypted in memory</p><h2>{manifest.files.length} durable files</h2><p className="muted">Generated {formatDate(manifest.generated_at)}</p></div><button className="button quiet" onClick={onLock}>Lock again</button></div><div className="file-list">{manifest.files.map((file) => <div className="file-row" key={file.path}><span className="file-type">md</span><code>{file.path}</code><span>{formatBytes(atob(file.content_base64).length)}</span></div>)}</div></div>
  );
}

function SettingsPage() {
  const { user } = useAuth();
  const [revoking, setRevoking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const revokeCliSessions = async () => {
    if (!window.confirm("Revoke every Harness CLI session for this account?")) return;
    setRevoking(true);
    setMessage("");
    setError("");
    try {
      await apiFetch<void>("/oauth/revoke-all", { method: "POST" });
      setMessage("All CLI sessions were revoked. Run harness login again on devices you still trust.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRevoking(false);
    }
  };
  return (
    <section className="settings-layout">
      <div><p className="eyebrow">Account and setup</p><h1>Settings</h1><p className="muted">Cloud sync is designed so your Firebase project is usable by many accounts without exposing service credentials.</p></div>
      <div className="settings-card"><div className="settings-avatar">{(user?.displayName || user?.email || "U").slice(0, 1).toUpperCase()}</div><div><span className="card-kicker">Signed in account</span><h2>{user?.displayName || user?.email}</h2><p className="muted">{user?.email}</p></div></div>
      <div className="settings-card stacked"><span className="card-kicker">CLI connection</span><h2>Authorize from your terminal</h2><pre><code>harness login</code></pre><p className="muted">Defaults to <code>https://5harness.knotree.com</code>. Override with <code>--server</code> if needed. After the first <code>harness sync push</code>, durable edits auto-sync as GitHub-like commits. Web AIs can connect at <code>/mcp</code> with the same account.</p></div>
      <div className="settings-card stacked"><span className="card-kicker">Privacy boundary</span><div className="check-row"><span className="check">✓</span><span>Firebase stores an encrypted envelope scoped to your user id.</span></div><div className="check-row"><span className="check">✓</span><span>OAuth refresh credentials are rotated and never shown in this UI.</span></div><div className="check-row"><span className="check">✓</span><span>Deleting a cloud snapshot does not delete your local repository files.</span></div></div>
      <div className="settings-card stacked danger-zone"><span className="card-kicker">Access control</span><h2>Revoke CLI access</h2><p className="muted">Use this after losing a device. It revokes every active CLI token family; your Firebase browser session stays signed in.</p><button className="danger-button" onClick={() => void revokeCliSessions()} disabled={revoking}>{revoking ? "Revoking…" : "Revoke all CLI sessions"}</button>{message && <Notice tone="info">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}</div>
    </section>
  );
}

function NotFoundPage() {
  return <section className="center-card narrow"><p className="eyebrow">404</p><h1>Page not found.</h1><Link className="button quiet" to="/">Return home</Link></section>;
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><span className="spinner" />{label}</div>;
}

function Notice({ tone, children }: { tone: "error" | "warning" | "info"; children: ReactNode }) {
  return <div className={"notice " + tone}>{children}</div>;
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="stat-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function parseAuthorizationRequest(): { valid: true; params: Record<string, string>; csrfToken: string } | { valid: false; error: string } {
  const outer = new URLSearchParams(window.location.search);
  const embedded = outer.get("oauth");
  const search = embedded ? new URLSearchParams(embedded) : outer;
  const params = {
    client_id: search.get("client_id") || "",
    redirect_uri: search.get("redirect_uri") || "",
    response_type: search.get("response_type") || "",
    code_challenge: search.get("code_challenge") || "",
    code_challenge_method: search.get("code_challenge_method") || "",
    scope: search.get("scope") || "",
    state: search.get("state") || "",
    ...(search.get("resource") ? { resource: search.get("resource") || "" } : {}),
  };
  try {
    const callback = new URL(params.redirect_uri);
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(callback.hostname);
    const callbackValid = (
      (callback.protocol === "http:" && loopback && callback.pathname === "/callback" && Boolean(callback.port)) ||
      (callback.protocol === "https:" && Boolean(callback.hostname))
    ) && !callback.username && !callback.password && !callback.hash;
    const scopes = params.scope.split(" ").filter(Boolean);
    if (!params.client_id || params.client_id.length > 512 || params.response_type !== "code" || !callbackValid || params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge) || !scopes.includes("sync:read") || scopes.some((scope) => !["sync:read", "sync:write", "offline_access"].includes(scope)) || params.state.length < 16 || params.state.length > 512) {
      return { valid: false, error: "The OAuth request is missing a safe redirect, PKCE challenge, or supported scope." };
    }
  } catch {
    return { valid: false, error: "The redirect target is not valid." };
  }
  return { valid: true, params, csrfToken: outer.get("oauth_csrf") || "" };
}

function normalizeDeviceCode(value: string): string {
  const compact = value.replace(/[\s-]/g, "").toUpperCase().slice(0, 8);
  if (compact.length <= 4) return compact;
  return compact.slice(0, 4) + "-" + compact.slice(4);
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === "object" && "message" in reason) return String((reason as ApiFailure).message);
  return "Something went wrong. Try again.";
}

function latestSync(projects: CloudProject[]): string {
  const dates = projects.map((project) => project.updated_at ? Date.parse(project.updated_at) : 0).filter(Boolean);
  return dates.length ? formatDate(new Date(Math.max(...dates)).toISOString()) : "—";
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "unknown";
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

export default App;
