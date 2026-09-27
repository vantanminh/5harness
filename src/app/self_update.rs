//! Install and refresh the native 5harness binary from the latest GitHub release.
//!
//! A native install writes an `auto-update` marker. Later commands then replace
//! the verified binary and continue on that release, so the operator does not
//! run a package-manager command by hand. `harness update` applies the latest
//! release immediately.

use std::cmp::Ordering;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::domain::paths::resolve_harness_home;
use crate::error::{Error, Result};
use crate::infra::entities::ensure_directory_no_symlink;
use crate::VERSION;

const SUCCESS_TTL_MS: u64 = 60 * 60 * 1000;
const FAILURE_TTL_MS: u64 = 5 * 60 * 1000;
const STALE_LOCK_MS: u64 = 15 * 60 * 1000;
const MAX_BINARY_BYTES: u64 = 80 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_REPO: &str = "vantanminh/5harness";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateMode {
    Now,
    EnableAuto,
    DisableAuto,
}

pub struct UpdateReport {
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutoPolicy {
    pub disabled: bool,
    pub ci: bool,
    pub already_applied: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug)]
struct Release {
    tag: String,
    version: String,
}

enum Channel {
    Native(PathBuf),
    PackageManager,
}

struct UpdateLock {
    path: PathBuf,
}

impl Drop for UpdateLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn maybe_auto_update() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    let exe = running_executable().ok();
    let install_root = exe.as_ref().and_then(|path| install_root_of(path));
    let home = resolve_harness_home();
    let policy = AutoPolicy {
        disabled: env_truthy("HARNESS_NO_UPDATE_CHECK"),
        ci: env_truthy("CI") || env_truthy("CONTINUOUS_INTEGRATION"),
        already_applied: env_truthy("HARNESS_UPDATE_APPLIED"),
        enabled: env_truthy("HARNESS_AUTO_UPDATE")
            || marker_enabled(&home)
            || install_root.as_deref().is_some_and(marker_enabled),
    };
    if !should_attempt_auto_update(&policy, &args) {
        return Ok(());
    }
    let Some(exe) = exe else {
        return Ok(());
    };
    let Some(channel) = auto_channel(&exe) else {
        return Ok(());
    };
    if ensure_directory_no_symlink(&home).is_err() {
        return Ok(());
    }
    match cached_state(&home) {
        CachedState::Current | CachedState::Backoff => return Ok(()),
        CachedState::Pending(_) | CachedState::Miss => {}
    }
    let lock = match UpdateLock::try_acquire(&home) {
        Ok(lock) => lock,
        Err(err) if err.message.contains("already in progress") => return Ok(()),
        Err(err) => return Err(err),
    };
    let latest = match resolve_latest(&home) {
        Ok(release) => release,
        Err(err) => {
            let _ = write_cache(&home, false, "");
            return Err(err);
        }
    };
    if !is_newer(VERSION, &latest.version) {
        let _ = write_cache(&home, true, &latest.tag);
        return Ok(());
    }
    let restart = match apply_channel(&channel, &latest, false) {
        Ok(path) => path,
        Err(err) => {
            let _ = write_cache(&home, false, "");
            return Err(err);
        }
    };
    let _ = write_cache(&home, true, &latest.version);
    drop(lock);
    reexec(&restart, &latest.tag)
}

pub fn perform_update(mode: UpdateMode) -> Result<UpdateReport> {
    let home = resolve_harness_home();
    let exe = running_executable().ok();
    let install_root = exe.as_ref().and_then(|path| install_root_of(path));
    match mode {
        UpdateMode::DisableAuto => {
            set_auto_markers(&home, install_root.as_deref(), false)?;
            return Ok(UpdateReport {
                summary: "Automatic updates are off.".into(),
            });
        }
        UpdateMode::EnableAuto => {
            set_auto_markers(&home, install_root.as_deref(), true)?;
        }
        UpdateMode::Now => {}
    }
    ensure_directory_no_symlink(&home)?;
    let _lock = UpdateLock::try_acquire(&home)?;
    let channel = explicit_channel(exe.as_deref());
    let latest = fetch_latest_release()?;
    if !is_newer(VERSION, &latest.version) {
        let _ = write_cache(&home, true, &latest.tag);
        let mut summary = format!("5harness {VERSION} is already the latest release.");
        if mode == UpdateMode::EnableAuto {
            summary.push_str(" Automatic updates are on.");
        }
        return Ok(UpdateReport { summary });
    }
    let path = apply_channel(&channel, &latest, true)?;
    let _ = write_cache(&home, true, &latest.tag);
    let summary = match channel {
        Channel::PackageManager => format!(
            "Updated 5harness to {} with `{}`.",
            latest.tag,
            package_manager_command().join(" ")
        ),
        Channel::Native(_) => {
            let mut text = format!(
                "Updated 5harness to {}.\nBinary: {}",
                latest.tag,
                path.display()
            );
            if mode == UpdateMode::EnableAuto {
                text.push_str("\nAutomatic updates are on.");
            }
            text
        }
    };
    Ok(UpdateReport { summary })
}

pub fn should_attempt_auto_update(policy: &AutoPolicy, args: &[String]) -> bool {
    if policy.disabled || policy.ci || policy.already_applied || !policy.enabled {
        return false;
    }
    if args
        .iter()
        .skip(1)
        .any(|arg| matches!(arg.as_str(), "--help" | "-h" | "--version" | "-V" | "-v"))
    {
        return false;
    }
    command_name(args) != Some("update")
}

enum CachedState {
    Miss,
    Backoff,
    Current,
    Pending(String),
}

fn cached_state(home: &Path) -> CachedState {
    let Some(cache) = read_cache(home) else {
        return CachedState::Miss;
    };
    if !cache_fresh(
        cache.ok,
        cache.checked_at_ms,
        now_ms(),
        success_ttl_ms(),
        failure_ttl_ms(),
    ) {
        return CachedState::Miss;
    }
    if !cache.ok {
        return CachedState::Backoff;
    }
    if is_newer(VERSION, &cache.latest) {
        CachedState::Pending(cache.latest)
    } else {
        CachedState::Current
    }
}

fn resolve_latest(home: &Path) -> Result<Release> {
    if let CachedState::Pending(tag) = cached_state(home) {
        validate_tag(&tag)?;
        return Ok(Release {
            version: tag.trim_start_matches('v').to_string(),
            tag,
        });
    }
    fetch_latest_release()
}

fn apply_channel(channel: &Channel, latest: &Release, verbose: bool) -> Result<PathBuf> {
    match channel {
        Channel::PackageManager => {
            let command = package_manager_command();
            if verbose {
                eprintln!("Updating 5harness with `{}`.", command.join(" "));
            }
            run_package_manager(&command)?;
            running_executable()
        }
        Channel::Native(dest) => {
            if verbose {
                eprintln!(
                    "Updating 5harness to {} ({})…",
                    latest.tag,
                    release_asset_name()?
                );
            }
            install_release(dest, &latest.tag)?;
            Ok(dest.clone())
        }
    }
}

fn auto_channel(exe: &Path) -> Option<Channel> {
    if let Some(dest) = managed_native_exe(exe) {
        return Some(Channel::Native(dest));
    }
    if uses_package_manager(exe) {
        return Some(Channel::PackageManager);
    }
    None
}

fn explicit_channel(exe: Option<&Path>) -> Channel {
    if let Some(exe) = exe {
        if let Some(dest) = managed_native_exe(exe) {
            return Channel::Native(dest);
        }
        if uses_package_manager(exe) {
            return Channel::PackageManager;
        }
    } else if env::var("npm_config_user_agent")
        .map(|agent| !agent.trim().is_empty())
        .unwrap_or(false)
    {
        return Channel::PackageManager;
    }
    Channel::Native(default_install_bin())
}

fn uses_package_manager(exe: &Path) -> bool {
    if env::var("npm_config_user_agent")
        .map(|agent| !agent.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    exe.components()
        .any(|component| component.as_os_str() == "node_modules")
}

fn managed_native_exe(current: &Path) -> Option<PathBuf> {
    let name = current.file_name()?;
    if name != "harness" && name != "harness.exe" {
        return None;
    }
    let bin_dir = current.parent()?;
    if bin_dir.file_name()? != "bin" {
        return None;
    }
    let root = bin_dir.parent()?;
    let root_name = root.file_name()?;
    if root_name == ".5harness" || root_name == "5harness" || marker_enabled(root) {
        Some(current.to_path_buf())
    } else {
        None
    }
}

fn install_root_of(exe: &Path) -> Option<PathBuf> {
    let bin_dir = exe.parent()?;
    if bin_dir.file_name()? != "bin" {
        return None;
    }
    Some(bin_dir.parent()?.to_path_buf())
}

fn default_install_bin() -> PathBuf {
    if let Ok(prefix) = env::var("HARNESS_INSTALL_PREFIX") {
        let trimmed = prefix.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("bin").join(binary_file_name());
        }
    }
    platform_default_install_bin()
}

#[cfg(windows)]
fn platform_default_install_bin() -> PathBuf {
    let base = env::var("LOCALAPPDATA")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base)
        .join("5harness")
        .join("bin")
        .join("harness.exe")
}

#[cfg(not(windows))]
fn platform_default_install_bin() -> PathBuf {
    resolve_harness_home().join("bin").join("harness")
}

fn binary_file_name() -> &'static str {
    if cfg!(windows) {
        "harness.exe"
    } else {
        "harness"
    }
}

fn running_executable() -> Result<PathBuf> {
    let exe = env::current_exe()?;
    let metadata = fs::symlink_metadata(&exe)?;
    if metadata.file_type().is_symlink() {
        let canonical = fs::canonicalize(&exe)?;
        let canonical_meta = fs::symlink_metadata(&canonical)?;
        if canonical_meta.file_type().is_symlink() {
            return Err(Error::new(
                "refusing to update through a symlinked harness binary",
            ));
        }
        return Ok(canonical);
    }
    Ok(exe)
}

fn set_auto_markers(home: &Path, install_root: Option<&Path>, enabled: bool) -> Result<()> {
    write_marker(home, enabled)?;
    if let Some(root) = install_root {
        if root != home {
            write_marker(root, enabled)?;
        }
    }
    Ok(())
}

fn write_marker(dir: &Path, enabled: bool) -> Result<()> {
    ensure_directory_no_symlink(dir)?;
    let path = dir.join("auto-update");
    if path
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(Error::new(format!(
            "refusing to change symlinked auto-update marker: {}",
            path.display()
        )));
    }
    if !enabled {
        if path.exists() {
            fs::remove_file(&path)?;
        }
        return Ok(());
    }
    if path.exists() {
        fs::remove_file(&path)?;
    }
    crate::infra::entities::atomic_write(&path, "1\n")
}

fn marker_enabled(dir: &Path) -> bool {
    let path = dir.join("auto-update");
    if path
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return false;
    }
    fs::read_to_string(path)
        .map(|text| {
            let value = text.trim();
            value == "1" || value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("on")
        })
        .unwrap_or(false)
}

fn reexec(exe: &Path, tag: &str) -> Result<()> {
    eprintln!("Updated 5harness to {tag}.");
    let mut cmd = Command::new(exe);
    cmd.args(env::args().skip(1));
    cmd.env("HARNESS_UPDATE_APPLIED", "1");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let err = cmd.exec();
        Err(Error::new(format!(
            "could not restart harness after update: {err}"
        )))
    }
    #[cfg(not(unix))]
    {
        let status = cmd.status()?;
        std::process::exit(status.code().unwrap_or(1));
    }
}

fn package_manager_command() -> Vec<String> {
    let agent = env::var("npm_config_user_agent").unwrap_or_default();
    if agent.contains("bun/") {
        return vec![
            "bun".into(),
            "add".into(),
            "-g".into(),
            "5harness@latest".into(),
        ];
    }
    if agent.contains("pnpm/") {
        return vec![
            "pnpm".into(),
            "add".into(),
            "-g".into(),
            "5harness@latest".into(),
        ];
    }
    vec![
        "npm".into(),
        "install".into(),
        "--global".into(),
        "5harness@latest".into(),
    ]
}

fn run_package_manager(command: &[String]) -> Result<()> {
    let Some((bin, args)) = command.split_first() else {
        return Err(Error::new("missing package manager command"));
    };
    let status = Command::new(bin).args(args).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::new(format!("{bin} update failed with {status}")))
    }
}

fn install_release(dest: &Path, tag: &str) -> Result<()> {
    let asset = release_asset_name()?;
    let repo = install_repo()?;
    validate_tag(tag)?;
    let client = http_client()?;
    let binary_url = format!("https://github.com/{repo}/releases/download/{tag}/{asset}");
    let checksum_url = format!("https://github.com/{repo}/releases/download/{tag}/SHA256SUMS");
    let bytes = fetch_bytes(
        &client,
        &binary_url,
        MAX_BINARY_BYTES,
        Duration::from_secs(60),
    )?;
    let manifest = fetch_bytes(
        &client,
        &checksum_url,
        MAX_TEXT_BYTES,
        Duration::from_secs(20),
    )?;
    let manifest =
        String::from_utf8(manifest).map_err(|_| Error::new("SHA256SUMS is not valid UTF-8"))?;
    let expected = checksum_for_asset(&manifest, &asset).ok_or_else(|| {
        Error::new(format!(
            "release {tag} does not provide a SHA-256 checksum for {asset}"
        ))
    })?;
    write_verified_executable(dest, &bytes, &expected)
}

fn fetch_latest_release() -> Result<Release> {
    let repo = install_repo()?;
    let client = http_client()?;
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let body = fetch_bytes(&client, &url, MAX_TEXT_BYTES, Duration::from_secs(15))?;
    let value: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| Error::new("latest GitHub release was not valid JSON"))?;
    let tag = value
        .get("tag_name")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    validate_tag(&tag)?;
    let version = tag.trim_start_matches('v').to_string();
    Ok(Release { tag, version })
}

fn install_repo() -> Result<String> {
    let repo = env::var("HARNESS_INSTALL_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string());
    let repo = repo.trim();
    let mut parts = repo.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(name), None)
            if !owner.is_empty()
                && !name.is_empty()
                && owner
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') =>
        {
            Ok(repo.to_string())
        }
        _ => Err(Error::new("HARNESS_INSTALL_REPO must look like owner/name")),
    }
}

fn validate_tag(tag: &str) -> Result<()> {
    let version = tag.trim().trim_start_matches('v');
    let mut parts = version.split('.');
    let major = parts.next().unwrap_or("");
    let minor = parts.next().unwrap_or("");
    let patch_and_rest = parts.next().unwrap_or("");
    let patch = patch_and_rest.split(['-', '+']).next().unwrap_or("");
    if parts.next().is_some()
        || major.is_empty()
        || minor.is_empty()
        || patch.is_empty()
        || !major.chars().all(|c| c.is_ascii_digit())
        || !minor.chars().all(|c| c.is_ascii_digit())
        || !patch.chars().all(|c| c.is_ascii_digit())
    {
        return Err(Error::new(format!(
            "refusing release tag that is not semver: {tag}"
        )));
    }
    Ok(())
}

fn release_asset_name() -> Result<String> {
    let target = release_target()?;
    if cfg!(windows) {
        Ok(format!("harness-{target}.exe"))
    } else {
        Ok(format!("harness-{target}"))
    }
}

fn release_target() -> Result<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Ok("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Ok("aarch64-unknown-linux-gnu"),
        ("macos", "x86_64") => Ok("x86_64-apple-darwin"),
        ("macos", "aarch64") => Ok("aarch64-apple-darwin"),
        ("windows", "x86_64") => Ok("x86_64-pc-windows-msvc"),
        ("windows", "aarch64") => Ok("aarch64-pc-windows-msvc"),
        _ => Err(Error::new(
            "this build target has no published 5harness release asset",
        )),
    }
}

fn http_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("5harness-update")
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|err| Error::new(format!("could not start update client: {err}")))
}

fn fetch_bytes(
    client: &reqwest::blocking::Client,
    url: &str,
    limit: u64,
    timeout: Duration,
) -> Result<Vec<u8>> {
    let response = client
        .get(url)
        .timeout(timeout)
        .send()
        .map_err(|err| Error::new(format!("could not download {url}: {err}")))?;
    let final_url = response.url().clone();
    if !allowed_download_host(final_url.host_str().unwrap_or("")) {
        return Err(Error::new(format!(
            "refusing update download from {}",
            final_url.host_str().unwrap_or("unknown host")
        )));
    }
    if !response.status().is_success() {
        return Err(Error::new(format!(
            "download failed for {url}: {}",
            response.status()
        )));
    }
    let mut body = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut body)
        .map_err(|err| Error::new(format!("could not read {url}: {err}")))?;
    if body.len() as u64 > limit {
        return Err(Error::new(format!(
            "download exceeded {limit} bytes: {url}"
        )));
    }
    Ok(body)
}

fn allowed_download_host(host: &str) -> bool {
    host == "github.com"
        || host == "api.github.com"
        || host == "objects.githubusercontent.com"
        || host == "release-assets.githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

fn write_verified_executable(dest: &Path, bytes: &[u8], expected_hex: &str) -> Result<()> {
    if !checksum_matches(bytes, expected_hex) {
        return Err(Error::new(
            "SHA-256 mismatch for the downloaded harness binary",
        ));
    }
    let parent = dest.parent().ok_or_else(|| {
        Error::new(format!(
            "install path has no parent directory: {}",
            dest.display()
        ))
    })?;
    ensure_directory_no_symlink(parent)?;
    if dest
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(Error::new(format!(
            "refusing to replace symlinked installed binary: {}",
            dest.display()
        )));
    }
    let nanos = now_ms();
    let temp = parent.join(format!(".harness-update-{nanos}"));
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o755))?;
    }
    let written = fs::read(&temp)?;
    if !checksum_matches(&written, expected_hex) {
        let _ = fs::remove_file(&temp);
        return Err(Error::new(
            "SHA-256 mismatch after writing the harness binary",
        ));
    }
    if let Err(err) = swap_in(&temp, dest) {
        let _ = fs::remove_file(&temp);
        return Err(err);
    }
    let installed = fs::read(dest)?;
    if !checksum_matches(&installed, expected_hex) {
        return Err(Error::new(
            "SHA-256 mismatch for the installed harness binary",
        ));
    }
    Ok(())
}

fn swap_in(temp: &Path, dest: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        if dest.exists() {
            let previous = dest.with_extension("exe.previous");
            if previous
                .symlink_metadata()
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err(Error::new(
                    "refusing to replace a symlinked previous harness binary",
                ));
            }
            let _ = fs::remove_file(&previous);
            fs::rename(dest, &previous)?;
            if let Err(err) = fs::rename(temp, dest) {
                let _ = fs::rename(&previous, dest);
                return Err(err.into());
            }
            let _ = fs::remove_file(&previous);
            return Ok(());
        }
    }
    fs::rename(temp, dest)?;
    Ok(())
}

fn checksum_matches(bytes: &[u8], expected_hex: &str) -> bool {
    hex_eq(expected_hex, &sha256_hex(bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn hex_eq(expected: &str, actual: &str) -> bool {
    let expected = expected.trim().to_ascii_lowercase();
    let actual = actual.trim().to_ascii_lowercase();
    if expected.len() != 64 || actual.len() != 64 {
        return false;
    }
    if !expected.chars().all(|c| c.is_ascii_hexdigit())
        || !actual.chars().all(|c| c.is_ascii_hexdigit())
    {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in expected.bytes().zip(actual.bytes()) {
        diff |= left ^ right;
    }
    diff == 0
}

fn checksum_for_asset(manifest: &str, asset: &str) -> Option<String> {
    for line in manifest.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(digest) = parts.next() else {
            continue;
        };
        let Some(raw_name) = parts.next() else {
            continue;
        };
        let name = raw_name
            .trim_start_matches('*')
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(raw_name);
        if name == asset && hex_eq(digest, digest) {
            return Some(digest.to_ascii_lowercase());
        }
    }
    None
}

fn compare_versions(current: &str, latest: &str) -> Ordering {
    fn triple(input: &str) -> [u64; 3] {
        let trimmed = input.trim().trim_start_matches('v');
        let mut nums = [0u64; 3];
        for (index, part) in trimmed
            .split(|c: char| !c.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .take(3)
            .enumerate()
        {
            nums[index] = part.parse().unwrap_or(0);
        }
        nums
    }
    triple(current).cmp(&triple(latest))
}

fn is_newer(current: &str, latest: &str) -> bool {
    compare_versions(current, latest) == Ordering::Less
}

#[derive(Debug)]
struct UpdateCache {
    checked_at_ms: u64,
    ok: bool,
    latest: String,
}

fn read_cache(home: &Path) -> Option<UpdateCache> {
    let path = home.join("update-check.json");
    if path
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(UpdateCache {
        checked_at_ms: value.get("checked_at_ms")?.as_u64()?,
        ok: value.get("ok")?.as_bool()?,
        latest: value
            .get("latest")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn write_cache(home: &Path, ok: bool, latest: &str) -> Result<()> {
    ensure_directory_no_symlink(home)?;
    let path = home.join("update-check.json");
    if path
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(Error::new(
            "refusing to write a symlinked update-check cache",
        ));
    }
    if path.exists() {
        fs::remove_file(&path)?;
    }
    let body = serde_json::json!({
        "checked_at_ms": now_ms(),
        "ok": ok,
        "latest": latest,
    });
    crate::infra::entities::atomic_write(&path, &format!("{body}\n"))
}

fn cache_fresh(
    ok: bool,
    checked_at_ms: u64,
    now_ms: u64,
    success_ttl_ms: u64,
    failure_ttl_ms: u64,
) -> bool {
    let ttl = if ok { success_ttl_ms } else { failure_ttl_ms };
    now_ms.saturating_sub(checked_at_ms) < ttl
}

fn success_ttl_ms() -> u64 {
    interval_override().unwrap_or(SUCCESS_TTL_MS)
}

fn failure_ttl_ms() -> u64 {
    interval_override().unwrap_or(FAILURE_TTL_MS)
}

fn interval_override() -> Option<u64> {
    env::var("HARNESS_UPDATE_CHECK_INTERVAL_MS")
        .ok()
        .and_then(|value| value.trim().parse().ok())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn command_name(args: &[String]) -> Option<&str> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-'))
        .map(String::as_str)
}

fn env_truthy(name: &str) -> bool {
    match env::var(name) {
        Ok(value) => {
            let value = value.trim();
            !value.is_empty()
                && value != "0"
                && !value.eq_ignore_ascii_case("false")
                && !value.eq_ignore_ascii_case("off")
                && !value.eq_ignore_ascii_case("no")
        }
        Err(_) => false,
    }
}

impl UpdateLock {
    fn try_acquire(home: &Path) -> Result<Self> {
        ensure_directory_no_symlink(home)?;
        let path = home.join("update.lock");
        if path
            .symlink_metadata()
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(Error::new("refusing to use a symlinked update lock"));
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let _ = writeln!(file, "{}", now_ms());
                Ok(Self { path })
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                if lock_is_stale(&path) {
                    fs::remove_file(&path)?;
                    let mut file = OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&path)?;
                    let _ = writeln!(file, "{}", now_ms());
                    Ok(Self { path })
                } else {
                    Err(Error::new("update already in progress"))
                }
            }
            Err(err) => Err(err.into()),
        }
    }
}

fn lock_is_stale(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    let Some(started) = text.trim().parse::<u64>().ok() else {
        return true;
    };
    now_ms().saturating_sub(started) > STALE_LOCK_MS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare_uses_numeric_components() {
        assert_eq!(compare_versions("0.9.0", "v0.10.0"), Ordering::Less);
        assert_eq!(compare_versions("0.30.1", "v0.30.1"), Ordering::Equal);
        assert_eq!(compare_versions("0.31.0", "v0.30.9"), Ordering::Greater);
        assert!(!is_newer("0.30.1", "0.30.1"));
        assert!(is_newer("0.30.1", "0.30.2"));
    }

    #[test]
    fn checksum_manifest_matches_release_asset_name() {
        let digest = "a".repeat(64);
        let manifest = format!("{digest}  harness-x86_64-unknown-linux-gnu\n");
        assert_eq!(
            checksum_for_asset(&manifest, "harness-x86_64-unknown-linux-gnu").as_deref(),
            Some(digest.as_str())
        );
        assert!(checksum_for_asset(&manifest, "harness-other").is_none());
        let starred = format!("{digest} *harness.exe\n");
        assert_eq!(
            checksum_for_asset(&starred, "harness.exe").as_deref(),
            Some(digest.as_str())
        );
    }

    #[test]
    fn auto_update_policy_skips_help_version_and_manual_update() {
        let enabled = AutoPolicy {
            disabled: false,
            ci: false,
            already_applied: false,
            enabled: true,
        };
        assert!(should_attempt_auto_update(
            &enabled,
            &args(&["harness", "status"])
        ));
        assert!(!should_attempt_auto_update(
            &enabled,
            &args(&["harness", "--version"])
        ));
        assert!(!should_attempt_auto_update(
            &enabled,
            &args(&["harness", "-v"])
        ));
        assert!(!should_attempt_auto_update(
            &enabled,
            &args(&["harness", "update"])
        ));
        assert!(should_attempt_auto_update(
            &enabled,
            &args(&["harness", "story", "update", "--id", "US-113"])
        ));
        let mut ci = enabled.clone();
        ci.ci = true;
        assert!(!should_attempt_auto_update(
            &ci,
            &args(&["harness", "status"])
        ));
        let mut off = enabled.clone();
        off.enabled = false;
        assert!(!should_attempt_auto_update(&off, &args(&["harness"])));
    }

    #[test]
    fn cache_uses_a_shorter_retry_after_failure() {
        let now = 10_000u64;
        assert!(cache_fresh(true, now - 1_000, now, 3_600_000, 300_000));
        assert!(!cache_fresh(false, now - 1_000, now, 3_600_000, 500));
        assert!(cache_fresh(false, now - 100, now, 3_600_000, 500));
    }

    #[test]
    fn verified_write_rejects_a_checksum_mismatch_and_a_symlink() {
        let root = std::env::temp_dir().join(format!("harness-self-update-{}", now_ms()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("bin")).unwrap();
        let dest = root.join("bin").join("harness");
        let bytes = b"#!/bin/sh\nexit 0\n";
        let digest = sha256_hex(bytes);
        let err = write_verified_executable(&dest, bytes, &"ab".repeat(32)).unwrap_err();
        assert!(err.message.contains("SHA-256 mismatch"));
        assert!(!dest.exists());
        write_verified_executable(&dest, bytes, &digest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), bytes);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = root.join("bin").join("linked");
            symlink(&dest, &link).unwrap();
            let err = write_verified_executable(&link, bytes, &digest).unwrap_err();
            assert!(err.message.contains("symlink"));
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn standard_install_path_is_managed_and_marker_enables_custom_prefix() {
        let root = std::env::temp_dir().join(format!("harness-managed-{}", now_ms()));
        let _ = fs::remove_dir_all(&root);
        let standard = root.join(".5harness").join("bin").join("harness");
        fs::create_dir_all(standard.parent().unwrap()).unwrap();
        assert_eq!(managed_native_exe(&standard), Some(standard.clone()));

        let custom = root.join("opt").join("bin").join("harness");
        fs::create_dir_all(custom.parent().unwrap()).unwrap();
        assert!(managed_native_exe(&custom).is_none());
        fs::write(root.join("opt").join("auto-update"), "1\n").unwrap();
        assert_eq!(managed_native_exe(&custom), Some(custom));
        assert!(marker_enabled(&root.join("opt")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn release_asset_name_matches_this_platform() {
        let name = release_asset_name().unwrap();
        assert!(name.starts_with("harness-"));
        if cfg!(windows) {
            assert!(name.ends_with(".exe"));
        } else {
            assert!(!name.ends_with(".exe"));
        }
    }

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }
}
