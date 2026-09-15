//! Browser authorization for the hosted Harness service.
//!
//! The CLI deliberately does not implement a Firebase login itself.  The
//! browser owns the Firebase session, and the web application exchanges that
//! session for a short-lived, one-time OAuth code.  This module only handles
//! the public OAuth client side: PKCE, the loopback callback, token rotation,
//! and machine-local credential storage.

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use url::Url;

use crate::error::{Error, Result};
use crate::infra::entities::atomic_write;
use crate::infra::registry::get_harness_home;

pub const CLIENT_ID: &str = "harness-cli";
pub const AUTH_FILE_NAME: &str = "auth.json";
pub const DEFAULT_SCOPE: &str = "sync:read sync:write";
const CALLBACK_PATH: &str = "/callback";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuthState {
    pub server: String,
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub refresh_expires_at: Option<i64>,
    pub user_id: Option<String>,
    pub user_email: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: Option<i64>,
    refresh_expires_in: Option<i64>,
    user: Option<TokenUser>,
}

#[derive(Debug, Deserialize)]
struct TokenUser {
    id: Option<String>,
    email: Option<String>,
}

pub fn auth_file_path() -> PathBuf {
    get_harness_home().join(AUTH_FILE_NAME)
}

pub fn read_auth() -> Result<Option<AuthState>> {
    let path = auth_file_path();
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| Error::new(format!("Unable to read {}: {e}", path.display())))?;
    let auth: AuthState = serde_json::from_str(&raw)
        .map_err(|e| Error::new(format!("Invalid Harness auth file {}: {e}", path.display())))?;
    if auth.server.is_empty() || auth.refresh_token.is_empty() {
        return Err(Error::new(
            "Harness auth file is incomplete. Run `harness login` again.",
        ));
    }
    Ok(Some(auth))
}

fn write_auth(auth: &AuthState) -> Result<()> {
    let path = auth_file_path();
    let home = path
        .parent()
        .ok_or_else(|| Error::new("Unable to resolve Harness home directory"))?;
    fs::create_dir_all(home)?;
    let payload = serde_json::to_string_pretty(auth)? + "\n";
    atomic_write(&path, &payload)?;
    set_private_file_permissions(&path);
    Ok(())
}

fn set_private_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    // Windows user-profile directories are ACL-protected by the operating
    // system.  We intentionally do not invoke icacls or a shell here: the
    // credential file is created below the user's Harness home only.
    #[cfg(windows)]
    let _ = path;
}

pub fn logout() -> Result<bool> {
    let path = auth_file_path();
    let Some(auth) = read_auth()? else {
        return Ok(false);
    };

    // Revocation is best effort.  The local credential is removed even when
    // the service is unreachable, so logout never leaves a usable refresh
    // token behind on this machine.
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| Error::new(format!("HTTP client initialization failed: {e}")))?;
    let _ = client
        .post(api_url(&auth.server, "/oauth/revoke"))
        .json(&json!({
            "client_id": CLIENT_ID,
            "refresh_token": auth.refresh_token,
        }))
        .send();
    fs::remove_file(path)?;
    Ok(true)
}

pub fn login(
    server_input: Option<&str>,
    no_browser: bool,
    timeout_seconds: u64,
) -> Result<AuthState> {
    let server = resolve_server(server_input)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| Error::new(format!("Unable to bind loopback OAuth callback: {e}")))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let state = random_string(32)?;
    let verifier = random_string(48)?;
    let challenge = pkce_challenge(&verifier);
    let authorize_url =
        authorization_url(&server, &redirect_uri, &state, &challenge, DEFAULT_SCOPE)?;

    if no_browser {
        println!("Open this URL in a browser to authorize Harness:\n{authorize_url}");
    } else if let Err(error) = open_browser(&authorize_url) {
        eprintln!("Could not open the browser automatically: {error}");
        println!("Open this URL in a browser to authorize Harness:\n{authorize_url}");
    } else {
        println!("Waiting for browser authorization…");
    }

    let code = wait_for_callback(&listener, &state, Duration::from_secs(timeout_seconds))?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| Error::new(format!("HTTP client initialization failed: {e}")))?;
    let response = client
        .post(api_url(&server, "/oauth/token"))
        .json(&json!({
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "redirect_uri": redirect_uri,
            "code": code,
            "code_verifier": verifier,
        }))
        .send()
        .map_err(|e| Error::new(format!("Harness authorization exchange failed: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(Error::new(format!(
            "Harness authorization exchange rejected (HTTP {}). Run `harness login` again.",
            status.as_u16()
        )));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|e| Error::new(format!("Invalid token response from Harness cloud: {e}")))?;
    if token.access_token.is_empty() || token.refresh_token.is_empty() {
        return Err(Error::new(
            "Harness cloud returned an incomplete token response.",
        ));
    }

    let now = unix_now();
    let auth = AuthState {
        server,
        access_token: token.access_token,
        access_expires_at: now + token.expires_in.unwrap_or(900).clamp(60, 3600),
        refresh_token: token.refresh_token,
        refresh_expires_at: token
            .refresh_expires_in
            .map(|seconds| now + seconds.clamp(300, 60 * 60 * 24 * 90)),
        user_id: token.user.as_ref().and_then(|user| user.id.clone()),
        user_email: token.user.as_ref().and_then(|user| user.email.clone()),
        created_at: now,
        updated_at: now,
    };
    write_auth(&auth)?;
    Ok(auth)
}

pub fn access_token() -> Result<(String, AuthState)> {
    let Some(mut auth) = read_auth()? else {
        return Err(Error::new(
            "Harness cloud is not connected. Run `harness login --server <web-url>` first.",
        ));
    };
    let now = unix_now();
    if auth.access_expires_at > now + 30 {
        return Ok((auth.access_token.clone(), auth));
    }
    if auth
        .refresh_expires_at
        .is_some_and(|expires_at| expires_at <= now)
    {
        return Err(Error::new(
            "Harness cloud refresh credential expired. Run `harness login` again.",
        ));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| Error::new(format!("HTTP client initialization failed: {e}")))?;
    let response = client
        .post(api_url(&auth.server, "/oauth/token"))
        .json(&json!({
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": auth.refresh_token,
        }))
        .send()
        .map_err(|e| Error::new(format!("Harness cloud token refresh failed: {e}")))?;
    if !response.status().is_success() {
        return Err(Error::new(
            "Harness cloud token refresh rejected. Run `harness login` again.",
        ));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|e| Error::new(format!("Invalid refresh response from Harness cloud: {e}")))?;
    let now = unix_now();
    auth.access_token = token.access_token;
    auth.access_expires_at = now + token.expires_in.unwrap_or(900).clamp(60, 3600);
    if !token.refresh_token.is_empty() {
        auth.refresh_token = token.refresh_token;
    }
    auth.refresh_expires_at = token
        .refresh_expires_in
        .map(|seconds| now + seconds.clamp(300, 60 * 60 * 24 * 90))
        .or(auth.refresh_expires_at);
    if let Some(user) = token.user {
        auth.user_id = user.id.or(auth.user_id);
        auth.user_email = user.email.or(auth.user_email);
    }
    auth.updated_at = now;
    write_auth(&auth)?;
    Ok((auth.access_token.clone(), auth))
}

pub fn resolve_server(input: Option<&str>) -> Result<String> {
    let candidate = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            env::var("HARNESS_CLOUD_URL")
                .ok()
                .map(|v| v.trim().to_string())
        })
        .or_else(|| read_auth().ok().flatten().map(|auth| auth.server));
    let server = candidate.ok_or_else(|| {
        Error::new(
            "No Harness cloud URL configured. Pass `--server <web-url>` or set HARNESS_CLOUD_URL.",
        )
    })?;
    validate_server_url(&server)
}

pub fn validate_server_url(raw: &str) -> Result<String> {
    let parsed = Url::parse(raw.trim()).map_err(|_| {
        Error::new(
            "Invalid Harness cloud URL. Use an https:// URL (or http://localhost for development).",
        )
    })?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let loopback = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1");
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(Error::new(
            "Harness cloud URL must use HTTPS; HTTP is allowed only for localhost development.",
        ));
    }
    if parsed.username() != "" || parsed.password().is_some() || parsed.query().is_some() {
        return Err(Error::new(
            "Harness cloud URL must not contain credentials or a query string.",
        ));
    }
    let mut normalized = parsed.to_string();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

pub fn api_url(server: &str, path: &str) -> String {
    let suffix = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("{}/api{}", server.trim_end_matches('/'), suffix)
}

fn authorization_url(
    server: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
    scope: &str,
) -> Result<String> {
    let mut url = Url::parse(&format!("{}/authorize", server.trim_end_matches('/')))
        .map_err(|_| Error::new("Invalid Harness cloud authorization URL"))?;
    url.query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", scope)
        .append_pair("state", state);
    Ok(url.to_string())
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn random_string(bytes: usize) -> Result<String> {
    let mut value = vec![0u8; bytes];
    getrandom::getrandom(&mut value)
        .map_err(|e| Error::new(format!("Secure random generator failed: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn open_browser(url: &str) -> Result<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map(|_| ())
            .map_err(|e| Error::new(format!("browser launcher failed: {e}")))
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| Error::new(format!("browser launcher failed: {e}")))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| Error::new(format!("browser launcher failed: {e}")))
    }
}

fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String> {
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() >= deadline {
            return Err(Error::new(
                "Timed out waiting for browser authorization. Run `harness login` again.",
            ));
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                let request = read_http_head(&mut stream)?;
                let result = callback_result(&request, expected_state);
                let (status, body) = match &result {
                    Ok(_) => (
                        "200 OK",
                        "Harness authorization complete. You can close this tab.",
                    ),
                    Err(_) => (
                        "400 Bad Request",
                        "Authorization was not accepted. You can close this tab.",
                    ),
                };
                write_http_response(&mut stream, status, body);
                if let Ok(code) = result {
                    return Ok(code);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(Error::new(format!("OAuth callback failed: {error}"))),
        }
    }
}

fn read_http_head(stream: &mut TcpStream) -> Result<String> {
    let mut bytes = Vec::with_capacity(1024);
    let mut buf = [0u8; 1024];
    while bytes.len() < 64 * 1024 {
        let count = stream.read(&mut buf)?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..count]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(bytes).map_err(|_| Error::new("OAuth callback contained invalid HTTP data"))
}

fn callback_result(request: &str, expected_state: &str) -> Result<String> {
    let line = request
        .lines()
        .next()
        .ok_or_else(|| Error::new("OAuth callback was empty"))?;
    let mut parts = line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err(Error::new("OAuth callback must use GET"));
    }
    let target = parts
        .next()
        .ok_or_else(|| Error::new("OAuth callback target missing"))?;
    let parsed = Url::parse(&format!("http://localhost{target}"))
        .map_err(|_| Error::new("OAuth callback target invalid"))?;
    if parsed.path() != CALLBACK_PATH {
        return Err(Error::new("OAuth callback path mismatch"));
    }
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }
    if let Some(error) = error {
        return Err(Error::new(format!("Browser authorization failed: {error}")));
    }
    if state.as_deref() != Some(expected_state) {
        return Err(Error::new("OAuth state mismatch"));
    }
    code.filter(|value| !value.is_empty())
        .ok_or_else(|| Error::new("OAuth authorization code missing"))
}

fn write_http_response(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[allow(dead_code)]
fn _standard_base64_is_available(value: &[u8]) -> String {
    STANDARD.encode(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_https_and_local_development_urls() {
        assert_eq!(
            validate_server_url("https://cloud.example.com/").unwrap(),
            "https://cloud.example.com"
        );
        assert!(validate_server_url("http://cloud.example.com").is_err());
        assert!(validate_server_url("http://127.0.0.1:8787/").is_ok());
        assert!(validate_server_url("https://user:password@cloud.example.com").is_err());
        assert!(validate_server_url("https://cloud.example.com/?next=secret").is_err());
    }

    #[test]
    fn builds_pkce_authorization_url_without_the_verifier() {
        let verifier = "a-secure-verifier-value";
        let challenge = pkce_challenge(verifier);
        let url = authorization_url(
            "https://cloud.example.com",
            "http://127.0.0.1:43123/callback",
            "state-value",
            &challenge,
            DEFAULT_SCOPE,
        )
        .unwrap();
        assert!(url.contains("code_challenge_method=S256"), "{url}");
        assert!(
            url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback"),
            "{url}"
        );
        assert!(url.contains("state=state-value"), "{url}");
        assert!(!url.contains(verifier), "verifier leaked in URL: {url}");
    }

    #[test]
    fn callback_requires_exact_path_and_state() {
        let request = "GET /callback?code=abc&state=ok HTTP/1.1\r\nHost: localhost\r\n\r\n";
        assert_eq!(callback_result(request, "ok").unwrap(), "abc");
        assert!(callback_result(request, "wrong").is_err());
        assert!(callback_result("GET /callback?code=abc&state=ok HTTP/1.1\r\n\r\n", "ok").is_ok());
        assert!(callback_result("GET /other?code=abc&state=ok HTTP/1.1\r\n\r\n", "ok").is_err());
    }
}
