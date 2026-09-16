//! Device authorization for the hosted Harness service.
//!
//! The CLI deliberately does not implement a Firebase login itself. The
//! browser owns the Firebase session, and the web application approves a
//! short-lived device code. The CLI keeps the PKCE verifier and polls the
//! OAuth token endpoint, so no loopback listener or callback URL is required.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
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
pub const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const DEVICE_CODE_PATH: &str = "/oauth/device/code";
const TOKEN_PATH: &str = "/oauth/token";
const DEVICE_PATH: &str = "/device";

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

#[derive(Clone, Debug, Serialize)]
pub struct LoginStatus {
    pub logged_in: bool,
    pub server: Option<String>,
    pub user_id: Option<String>,
    pub user_email: Option<String>,
    pub access_expires_at: Option<i64>,
    pub refresh_expires_at: Option<i64>,
    pub access_valid: bool,
    pub refresh_valid: bool,
    pub auth_file: String,
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

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
    message: Option<String>,
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

pub fn login_status() -> Result<LoginStatus> {
    let auth_file = auth_file_path().display().to_string();
    let Some(auth) = read_auth()? else {
        return Ok(LoginStatus {
            logged_in: false,
            server: None,
            user_id: None,
            user_email: None,
            access_expires_at: None,
            refresh_expires_at: None,
            access_valid: false,
            refresh_valid: false,
            auth_file,
        });
    };
    let now = unix_now();
    Ok(LoginStatus {
        logged_in: true,
        server: Some(auth.server),
        user_id: auth.user_id,
        user_email: auth.user_email,
        access_expires_at: Some(auth.access_expires_at),
        refresh_expires_at: auth.refresh_expires_at,
        access_valid: auth.access_expires_at > now,
        refresh_valid: auth
            .refresh_expires_at
            .map(|expires_at| expires_at > now)
            .unwrap_or(true),
        auth_file,
    })
}

pub fn format_login_status(status: &LoginStatus) -> String {
    if !status.logged_in {
        return format!(
            "Harness cloud login: not connected\nCredential file: {}\nRun `harness login --server <web-url>` to authorize this machine.",
            status.auth_file
        );
    }
    let now = unix_now();
    let account = status
        .user_email
        .as_deref()
        .or(status.user_id.as_deref())
        .unwrap_or("unknown account");
    let access = match status.access_expires_at {
        Some(expires_at) if expires_at > now => format!("valid ({}s remaining)", expires_at - now),
        Some(_) => "expired (will refresh on the next cloud request)".to_string(),
        None => "unknown".to_string(),
    };
    let refresh = match status.refresh_expires_at {
        Some(expires_at) if expires_at > now => format!("valid ({}s remaining)", expires_at - now),
        Some(_) => "expired".to_string(),
        None => "valid".to_string(),
    };
    format!(
        "Harness cloud login: connected\nServer: {}\nAccount: {}\nAccess token: {}\nRefresh token: {}\nCredential file: {}",
        status.server.as_deref().unwrap_or("unknown"),
        account,
        access,
        refresh,
        status.auth_file
    )
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
    let verifier = random_string(48)?;
    let challenge = pkce_challenge(&verifier);
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| Error::new(format!("HTTP client initialization failed: {e}")))?;
    let response = client
        .post(oauth_url(&server, DEVICE_CODE_PATH))
        .form(&[
            ("client_id", CLIENT_ID),
            ("scope", DEFAULT_SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ])
        .send()
        .map_err(|e| Error::new(format!("Harness device authorization request failed: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(Error::new(format!(
            "Harness device authorization request rejected (HTTP {}). Run `harness login` again.",
            status.as_u16()
        )));
    }
    let device: DeviceCodeResponse = response.json().map_err(|e| {
        Error::new(format!(
            "Invalid device authorization response from Harness cloud: {e}"
        ))
    })?;
    if device.device_code.is_empty()
        || device.device_code.len() > 512
        || device.user_code.is_empty()
        || device.user_code.len() > 64
        || device.expires_in == 0
    {
        return Err(Error::new(
            "Harness cloud returned an incomplete device authorization response.",
        ));
    }
    let verification_url = device_verification_url(&server, &device)?;

    println_flush("Harness device login");
    println_flush(&format!(
        "Enter this code in your browser: {}",
        device.user_code
    ));
    println_flush(&format!("Verification URL: {verification_url}"));
    if !no_browser {
        if let Err(error) = open_browser(&verification_url) {
            eprintln!("Could not open the browser automatically: {error}");
            let _ = io::stderr().flush();
        }
    }
    println_flush("Waiting for browser authorization. This terminal will finish automatically after you approve the code.");

    let token = poll_device_token(&client, &server, &device, &verifier, timeout_seconds)?;
    println_flush("Browser authorization received. Completing login…");
    let auth = auth_state_from_token(server, token)?;
    write_auth(&auth)?;
    Ok(auth)
}

fn auth_state_from_token(server: String, token: TokenResponse) -> Result<AuthState> {
    if token.access_token.is_empty() || token.refresh_token.is_empty() {
        return Err(Error::new(
            "Harness cloud returned an incomplete token response.",
        ));
    }
    let now = unix_now();
    Ok(AuthState {
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
    })
}

fn poll_device_token(
    client: &Client,
    server: &str,
    device: &DeviceCodeResponse,
    verifier: &str,
    timeout_seconds: u64,
) -> Result<TokenResponse> {
    let deadline =
        Instant::now() + Duration::from_secs(timeout_seconds.clamp(1, 900).min(device.expires_in));
    let mut interval = Duration::from_secs(device.interval.unwrap_or(5).clamp(1, 30));
    let mut first_poll = true;
    let mut last_heartbeat = Instant::now();
    loop {
        if !first_poll {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::new(
                    "Timed out waiting for device authorization. Run `harness login` again.",
                ));
            }
            thread::sleep(interval.min(remaining));
        }
        first_poll = false;

        let response = match client
            .post(oauth_url(server, TOKEN_PATH))
            .form(&[
                ("grant_type", DEVICE_GRANT_TYPE),
                ("client_id", CLIENT_ID),
                ("device_code", device.device_code.as_str()),
                ("code_verifier", verifier),
            ])
            .send()
        {
            Ok(response) => response,
            Err(error) if Instant::now() < deadline => {
                eprintln!("Device authorization is temporarily unavailable; retrying… ({error})");
                let _ = io::stderr().flush();
                continue;
            }
            Err(error) => {
                return Err(Error::new(format!(
                    "Harness device token request failed: {error}"
                )))
            }
        };
        let retry_after = retry_after_interval(response.headers());
        let status = response.status();
        let body = response.text().map_err(|e| {
            Error::new(format!(
                "Invalid device token response from Harness cloud: {e}"
            ))
        })?;
        if status.is_success() {
            return serde_json::from_str(&body).map_err(|e| {
                Error::new(format!("Invalid token response from Harness cloud: {e}"))
            });
        }

        let error_response = serde_json::from_str::<OAuthErrorResponse>(&body).ok();
        match error_response
            .as_ref()
            .and_then(|error| error.error.as_deref())
        {
            Some("authorization_pending") => {
                if let Some(wait) = retry_after {
                    interval = wait;
                }
                heartbeat_wait(deadline, &mut last_heartbeat);
                continue;
            }
            Some("slow_down") => {
                interval = retry_after
                    .unwrap_or_else(|| interval + Duration::from_secs(5))
                    .max(interval + Duration::from_secs(5))
                    .min(Duration::from_secs(30));
                heartbeat_wait(deadline, &mut last_heartbeat);
                continue;
            }
            Some("access_denied") => {
                return Err(Error::new("Harness device authorization was denied."));
            }
            Some("expired_token") => {
                return Err(Error::new(
                    "Harness device code expired. Run `harness login` again.",
                ));
            }
            Some(error_code) => {
                let description = error_response
                    .as_ref()
                    .and_then(|error| {
                        error
                            .error_description
                            .as_deref()
                            .or(error.message.as_deref())
                    })
                    .unwrap_or("Device token request was rejected.");
                return Err(Error::new(format!(
                    "Harness device token request rejected ({error_code}): {description}"
                )));
            }
            None if status.as_u16() >= 500 && Instant::now() < deadline => continue,
            None => {
                return Err(Error::new(format!(
                    "Harness device token request rejected (HTTP {}). Run `harness login` again.",
                    status.as_u16()
                )));
            }
        }
    }
}

fn oauth_url(server: &str, path: &str) -> String {
    format!(
        "{}/{}",
        server.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn device_verification_url(server: &str, device: &DeviceCodeResponse) -> Result<String> {
    let base = Url::parse(&device.verification_uri)
        .map_err(|_| Error::new("Harness cloud returned an invalid device verification URL."))?;
    let expected =
        Url::parse(server).map_err(|_| Error::new("Invalid Harness cloud authorization URL"))?;
    if base.origin() != expected.origin()
        || base.path() != DEVICE_PATH
        || base.username() != ""
        || base.password().is_some()
        || base.fragment().is_some()
    {
        return Err(Error::new(
            "Harness cloud returned an unsafe device verification URL.",
        ));
    }
    let mut complete = base;
    complete
        .query_pairs_mut()
        .append_pair("user_code", &device.user_code);
    Ok(complete.to_string())
}

/*
 * The callback-based flow is intentionally no longer used by the CLI. The
 * hosted Worker keeps its OAuth callback endpoint for existing clients while
 * new CLI logins use the device grant above.
 */
fn _legacy_callback_note() {
    // Keep this as a named anchor for release notes and source searches.
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

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn println_flush(message: &str) {
    println!("{message}");
    let _ = io::stdout().flush();
}

fn heartbeat_wait(deadline: Instant, last_heartbeat: &mut Instant) {
    if last_heartbeat.elapsed() < Duration::from_secs(15) {
        return;
    }
    println_flush(&format!(
        "Still waiting for browser authorization ({}s remaining)…",
        deadline.saturating_duration_since(Instant::now()).as_secs()
    ));
    *last_heartbeat = Instant::now();
}

fn retry_after_interval(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    let seconds = value.parse::<u64>().ok()?;
    Some(Duration::from_secs(seconds.clamp(1, 30)))
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
    fn builds_pkce_challenge_without_the_verifier() {
        let verifier = "a-secure-verifier-value";
        let challenge = pkce_challenge(verifier);
        assert!(!challenge.is_empty());
        assert!(!challenge.contains(verifier));
    }

    #[test]
    fn device_verification_url_is_same_origin_and_contains_user_code() {
        let device = DeviceCodeResponse {
            device_code: "opaque-device-code".to_string(),
            user_code: "ABCD-EFGH".to_string(),
            verification_uri: "https://cloud.example.com/device".to_string(),
            expires_in: 600,
            interval: Some(5),
        };
        let url = device_verification_url("https://cloud.example.com", &device).unwrap();
        assert_eq!(url, "https://cloud.example.com/device?user_code=ABCD-EFGH");
        let mut unsafe_device = device;
        unsafe_device.verification_uri = "https://evil.example.com/device".to_string();
        assert!(device_verification_url("https://cloud.example.com", &unsafe_device).is_err());
    }

    #[test]
    fn formats_login_status_without_exposing_tokens() {
        let disconnected = LoginStatus {
            logged_in: false,
            server: None,
            user_id: None,
            user_email: None,
            access_expires_at: None,
            refresh_expires_at: None,
            access_valid: false,
            refresh_valid: false,
            auth_file: "/tmp/auth.json".to_string(),
        };
        let disconnected_text = format_login_status(&disconnected);
        assert!(disconnected_text.contains("not connected"));
        assert!(disconnected_text.contains("harness login"));
        assert!(!disconnected_text.contains("access_token"));

        let connected = LoginStatus {
            logged_in: true,
            server: Some("https://cloud.example.com".to_string()),
            user_id: Some("uid-1".to_string()),
            user_email: Some("user@example.com".to_string()),
            access_expires_at: Some(unix_now() + 600),
            refresh_expires_at: Some(unix_now() + 3600),
            access_valid: true,
            refresh_valid: true,
            auth_file: "/tmp/auth.json".to_string(),
        };
        let connected_text = format_login_status(&connected);
        assert!(connected_text.contains("connected"));
        assert!(connected_text.contains("user@example.com"));
        assert!(connected_text.contains("https://cloud.example.com"));
        assert!(!connected_text.contains("secret"));
    }
}
