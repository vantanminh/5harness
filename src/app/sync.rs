//! Encrypted, user-scoped cloud synchronization for durable Harness data.
//!
//! Only the durable markdown entity directories are included.  The derived
//! index, machine-local traces, OAuth credentials, and arbitrary project files
//! never enter a sync payload.  The payload is encrypted before it leaves the
//! machine so Firebase is an opaque transport/storage layer rather than a
//! second source of truth for the repository.

use std::env;
use std::fs;
use std::io::{self, IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::app::auth;
use crate::app::index::write_project_index;
use crate::app::link::read_project_id;
use crate::error::{Error, Result};
use crate::infra::entities::atomic_write;

pub const SYNC_SCHEMA_VERSION: u32 = 1;
pub const PBKDF2_ITERATIONS: u32 = 310_000;
pub const MAX_MANIFEST_BYTES: usize = 700 * 1024;
pub const MAX_ENVELOPE_BYTES: usize = 900_000;
pub const SYNC_STATE_FILE_NAME: &str = "cloud-sync.json";
const MAX_FILES: usize = 10_000;
const MIN_PASSPHRASE_CHARS: usize = 12;
const DURABLE_ROOTS: &[&str] = &[
    "docs/stories",
    "docs/decisions",
    "docs/intakes",
    "docs/backlog",
    "docs/reports",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncFile {
    pub path: String,
    pub sha256: String,
    pub content_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncManifest {
    pub schema_version: u32,
    pub project_id: String,
    pub generated_at: String,
    pub files: Vec<SyncFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub schema_version: u32,
    pub format: String,
    pub project_id: String,
    pub project_name: String,
    pub plaintext_sha256: String,
    pub kdf: String,
    pub iterations: u32,
    pub salt_base64: String,
    pub cipher: String,
    pub nonce_base64: String,
    pub ciphertext_base64: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SyncState {
    server: String,
    project_id: String,
    last_revision: String,
    last_plaintext_sha256: String,
    #[serde(default)]
    last_files_sha256: String,
    last_synced_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PushResponse {
    snapshot_id: String,
    revision: String,
    created_at: String,
    plaintext_sha256: String,
    ciphertext_bytes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PullResponse {
    project_id: String,
    revision: String,
    created_at: String,
    updated_at: String,
    envelope: EncryptedEnvelope,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StatusResponse {
    project_id: String,
    has_snapshot: bool,
    revision: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    plaintext_sha256: Option<String>,
    ciphertext_bytes: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub action: String,
    pub project_id: String,
    pub revision: Option<String>,
    pub files: usize,
    pub plaintext_sha256: Option<String>,
    pub message: String,
}

pub fn run_push(
    project_root: &Path,
    passphrase: Option<&str>,
    passphrase_stdin: bool,
) -> Result<SyncResult> {
    let (token, auth_state) = auth::access_token()?;
    let project_id = read_project_id(project_root)?;
    let phrase = resolve_passphrase(passphrase, passphrase_stdin)?;
    let (manifest, envelope) = create_envelope(project_root, &project_id, &phrase)?;
    let local_state = read_sync_state(project_root)?;
    let base_revision = local_state
        .filter(|state| state.server == auth_state.server && state.project_id == project_id)
        .map(|state| state.last_revision);
    let client = http_client()?;
    let response = client
        .post(auth::api_url(&auth_state.server, "/sync/snapshots"))
        .bearer_auth(token)
        .json(&json!({
            "project_id": project_id,
            "base_revision": base_revision,
            "envelope": envelope,
        }))
        .send()
        .map_err(|e| Error::new(format!("Harness cloud sync upload failed: {e}")))?;
    if response.status().as_u16() == 409 {
        return Err(Error::new(
            "Remote Harness data changed since the last sync. Run `harness sync pull` first, resolve the local state, then push again.",
        ));
    }
    let response = ensure_success(response, "upload")?;
    let pushed: PushResponse = response
        .json()
        .map_err(|e| Error::new(format!("Invalid sync upload response: {e}")))?;
    let state = SyncState {
        server: auth_state.server,
        project_id: project_id.clone(),
        last_revision: pushed.revision.clone(),
        last_plaintext_sha256: pushed.plaintext_sha256.clone(),
        last_files_sha256: manifest_files_sha256(&manifest)?,
        last_synced_at: pushed.created_at.clone(),
    };
    write_sync_state(project_root, &state)?;
    Ok(SyncResult {
        action: "push".into(),
        project_id,
        revision: Some(pushed.revision),
        files: manifest.files.len(),
        plaintext_sha256: Some(pushed.plaintext_sha256),
        message: format!(
            "Uploaded {} durable files ({} encrypted bytes).",
            manifest.files.len(),
            pushed.ciphertext_bytes
        ),
    })
}

pub fn run_pull(
    project_root: &Path,
    passphrase: Option<&str>,
    passphrase_stdin: bool,
    force: bool,
    prune: bool,
) -> Result<SyncResult> {
    let (token, auth_state) = auth::access_token()?;
    let project_id = read_project_id(project_root)?;
    let client = http_client()?;
    let response = client
        .get(auth::api_url(
            &auth_state.server,
            &format!("/sync/snapshots/{project_id}"),
        ))
        .bearer_auth(token)
        .send()
        .map_err(|e| Error::new(format!("Harness cloud sync download failed: {e}")))?;
    if response.status().as_u16() == 404 {
        return Err(Error::new(
            "No cloud snapshot exists for this project and account. Run `harness sync push` first.",
        ));
    }
    let response = ensure_success(response, "download")?;
    let remote: PullResponse = response
        .json()
        .map_err(|e| Error::new(format!("Invalid sync download response: {e}")))?;
    if remote.project_id != project_id || remote.envelope.project_id != project_id {
        return Err(Error::new(
            "Cloud snapshot project identity did not match this repository; refusing to apply it.",
        ));
    }
    let phrase = resolve_passphrase(passphrase, passphrase_stdin)?;
    let manifest = decrypt_envelope(&remote.envelope, &phrase)?;
    validate_manifest(&manifest, &project_id)?;
    let plaintext_sha256 = manifest_sha256(&manifest)?;
    if plaintext_sha256 != remote.envelope.plaintext_sha256 {
        return Err(Error::new(
            "Cloud snapshot integrity check failed; refusing to write local files.",
        ));
    }

    let local_state = read_sync_state(project_root)?;
    let local_manifest = build_manifest(project_root, &project_id)?;
    let local_files_digest = manifest_files_sha256(&local_manifest)?;
    let local_changed = local_state.as_ref().is_some_and(|state| {
        state.server == auth_state.server
            && state.project_id == project_id
            && state.last_files_sha256 != local_files_digest
    });
    if local_changed && !force {
        return Err(Error::new(
            "Local Harness data changed since the last sync. Review it and rerun with `harness sync pull --force` to apply the cloud snapshot.",
        ));
    }

    apply_manifest(project_root, &manifest, prune)?;
    let state = SyncState {
        server: auth_state.server,
        project_id: project_id.clone(),
        last_revision: remote.revision.clone(),
        last_plaintext_sha256: plaintext_sha256.clone(),
        last_files_sha256: manifest_files_sha256(&manifest)?,
        last_synced_at: remote.updated_at,
    };
    write_sync_state(project_root, &state)?;
    Ok(SyncResult {
        action: "pull".into(),
        project_id,
        revision: Some(remote.revision),
        files: manifest.files.len(),
        plaintext_sha256: Some(plaintext_sha256),
        message: format!(
            "Applied {} durable files{}.",
            manifest.files.len(),
            if prune {
                " and pruned local files absent from cloud"
            } else {
                ""
            }
        ),
    })
}

pub fn run_status(project_root: &Path) -> Result<Value> {
    let (token, auth_state) = auth::access_token()?;
    let project_id = read_project_id(project_root)?;
    let client = http_client()?;
    let response = client
        .get(auth::api_url(
            &auth_state.server,
            &format!("/sync/snapshots/{project_id}"),
        ))
        .bearer_auth(token)
        .send()
        .map_err(|e| Error::new(format!("Harness cloud sync status failed: {e}")))?;
    let local = read_sync_state(project_root)?;
    if response.status().as_u16() == 404 {
        return Ok(json!({
            "server": auth_state.server,
            "project_id": project_id,
            "cloud": null,
            "local": local,
        }));
    }
    let response = ensure_success(response, "status")?;
    let remote: StatusResponse = response
        .json()
        .map_err(|e| Error::new(format!("Invalid sync status response: {e}")))?;
    Ok(json!({
        "server": auth_state.server,
        "project_id": project_id,
        "cloud": remote,
        "local": local,
    }))
}

pub fn create_envelope(
    project_root: &Path,
    project_id: &str,
    passphrase: &str,
) -> Result<(SyncManifest, EncryptedEnvelope)> {
    validate_passphrase(passphrase)?;
    let manifest = build_manifest(project_root, project_id)?;
    let plaintext = serde_json::to_vec(&manifest)?;
    if plaintext.len() > MAX_MANIFEST_BYTES {
        return Err(Error::new(format!(
            "Harness sync manifest is {} bytes; the maximum is {} bytes. Split the project or remove oversized durable content.",
            plaintext.len(),
            MAX_MANIFEST_BYTES
        )));
    }
    let digest = sha256_hex(&plaintext);
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    secure_random(&mut salt)?;
    secure_random(&mut nonce)?;
    let key = derive_key(passphrase, &salt, PBKDF2_ITERATIONS);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| Error::new("Unable to initialize sync encryption"))?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: project_id.as_bytes(),
            },
        )
        .map_err(|_| Error::new("Unable to encrypt Harness sync manifest"))?;
    let envelope = EncryptedEnvelope {
        schema_version: SYNC_SCHEMA_VERSION,
        format: "harness-sync-envelope".into(),
        project_id: project_id.into(),
        project_name: project_root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| project_id.into()),
        plaintext_sha256: digest,
        kdf: "PBKDF2-HMAC-SHA256".into(),
        iterations: PBKDF2_ITERATIONS,
        salt_base64: STANDARD.encode(salt),
        cipher: "AES-256-GCM".into(),
        nonce_base64: STANDARD.encode(nonce),
        ciphertext_base64: STANDARD.encode(encrypted),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let encoded_size = serde_json::to_vec(&envelope)?.len();
    if encoded_size > MAX_ENVELOPE_BYTES {
        return Err(Error::new(format!(
            "Encrypted Harness sync envelope is {} bytes; the maximum is {} bytes.",
            encoded_size, MAX_ENVELOPE_BYTES
        )));
    }
    Ok((manifest, envelope))
}

pub fn decrypt_envelope(envelope: &EncryptedEnvelope, passphrase: &str) -> Result<SyncManifest> {
    validate_passphrase(passphrase)?;
    if envelope.schema_version != SYNC_SCHEMA_VERSION
        || envelope.format != "harness-sync-envelope"
        || envelope.kdf != "PBKDF2-HMAC-SHA256"
        || envelope.cipher != "AES-256-GCM"
        || envelope.iterations < 100_000
        || envelope.iterations > 2_000_000
    {
        return Err(Error::new(
            "Unsupported or unsafe Harness sync envelope format.",
        ));
    }
    let salt = STANDARD
        .decode(&envelope.salt_base64)
        .map_err(|_| Error::new("Harness sync envelope salt is invalid"))?;
    let nonce = STANDARD
        .decode(&envelope.nonce_base64)
        .map_err(|_| Error::new("Harness sync envelope nonce is invalid"))?;
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext_base64)
        .map_err(|_| Error::new("Harness sync envelope ciphertext is invalid"))?;
    if envelope.ciphertext_base64.len() > MAX_ENVELOPE_BYTES
        || salt.len() != 16
        || nonce.len() != 12
        || ciphertext.len() < 16
    {
        return Err(Error::new(
            "Harness sync envelope cryptographic fields have invalid lengths",
        ));
    }
    let key = derive_key(passphrase, &salt, envelope.iterations);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| Error::new("Unable to initialize sync decryption"))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: ciphertext.as_ref(),
                aad: envelope.project_id.as_bytes(),
            },
        )
        .map_err(|_| Error::new("Unable to decrypt Harness sync envelope; check the passphrase"))?;
    if sha256_hex(&plaintext) != envelope.plaintext_sha256 {
        return Err(Error::new(
            "Harness sync envelope plaintext hash does not match; refusing to apply it",
        ));
    }
    serde_json::from_slice(&plaintext)
        .map_err(|e| Error::new(format!("Decrypted Harness sync manifest is invalid: {e}")))
}

pub fn build_manifest(project_root: &Path, project_id: &str) -> Result<SyncManifest> {
    ensure_safe_durable_roots(project_root)?;
    let mut files = Vec::new();
    for durable_root in DURABLE_ROOTS {
        let root = project_root.join(durable_root);
        if root.exists() {
            collect_markdown_files(project_root, &root, &mut files)?;
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(SyncManifest {
        schema_version: SYNC_SCHEMA_VERSION,
        project_id: project_id.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        files,
    })
}

fn collect_markdown_files(
    project_root: &Path,
    directory: &Path,
    out: &mut Vec<SyncFile>,
) -> Result<()> {
    let directory_metadata = fs::symlink_metadata(directory)?;
    if directory_metadata.file_type().is_symlink() {
        return Err(Error::new(format!(
            "Harness sync refused a symlinked durable directory: {}",
            directory.display()
        )));
    }
    if !directory_metadata.is_dir() {
        return Ok(());
    }
    let mut entries: Vec<_> = fs::read_dir(directory)?
        .filter_map(|entry| entry.ok())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_markdown_files(project_root, &path, out)?;
            continue;
        }
        let is_markdown = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"));
        let is_readme = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("README.md"));
        if !is_markdown || is_readme {
            continue;
        }
        let relative = path
            .strip_prefix(project_root)
            .map_err(|_| Error::new("Durable sync path escaped the project root"))?
            .to_string_lossy()
            .replace('\\', "/");
        let content = fs::read(&path)?;
        out.push(SyncFile {
            path: relative,
            sha256: sha256_hex(&content),
            content_base64: STANDARD.encode(content),
        });
        if out.len() > MAX_FILES {
            return Err(Error::new(format!(
                "Harness sync refuses projects with more than {MAX_FILES} durable files"
            )));
        }
    }
    Ok(())
}

pub fn validate_manifest(manifest: &SyncManifest, project_id: &str) -> Result<()> {
    if manifest.schema_version != SYNC_SCHEMA_VERSION || manifest.project_id != project_id {
        return Err(Error::new(
            "Harness sync manifest schema or project id is invalid",
        ));
    }
    if manifest.files.len() > MAX_FILES {
        return Err(Error::new("Harness sync manifest contains too many files"));
    }
    let mut paths = std::collections::HashSet::new();
    let mut total_bytes = 0usize;
    for file in &manifest.files {
        if !is_safe_durable_path(&file.path) {
            return Err(Error::new(format!(
                "Harness sync refused unsafe durable path: {}",
                file.path
            )));
        }
        if !paths.insert(file.path.clone()) {
            return Err(Error::new(format!(
                "Harness sync manifest contains duplicate path: {}",
                file.path
            )));
        }
        let content = STANDARD
            .decode(&file.content_base64)
            .map_err(|_| Error::new(format!("Invalid base64 for sync file {}", file.path)))?;
        if sha256_hex(&content) != file.sha256 {
            return Err(Error::new(format!(
                "Hash mismatch for sync file {}; refusing to apply",
                file.path
            )));
        }
        total_bytes = total_bytes.saturating_add(content.len());
        if total_bytes > MAX_MANIFEST_BYTES {
            return Err(Error::new(
                "Harness sync manifest exceeds the plaintext size limit",
            ));
        }
        if std::str::from_utf8(&content).is_err() {
            return Err(Error::new(format!(
                "Harness sync file is not UTF-8 markdown: {}",
                file.path
            )));
        }
    }
    Ok(())
}

fn apply_manifest(project_root: &Path, manifest: &SyncManifest, prune: bool) -> Result<()> {
    ensure_safe_durable_roots(project_root)?;
    let mut remote_paths = std::collections::HashSet::new();
    for file in &manifest.files {
        remote_paths.insert(file.path.clone());
        let bytes = STANDARD
            .decode(&file.content_base64)
            .map_err(|_| Error::new(format!("Invalid base64 for sync file {}", file.path)))?;
        let content = std::str::from_utf8(&bytes)
            .map_err(|_| Error::new(format!("Sync file is not UTF-8 markdown: {}", file.path)))?;
        ensure_safe_parent_path(project_root, &file.path)?;
        atomic_write(&project_root.join(&file.path), content)?;
    }
    if prune {
        let mut local_files = Vec::new();
        for durable_root in DURABLE_ROOTS {
            let root = project_root.join(durable_root);
            if root.exists() {
                collect_local_paths(&root, &mut local_files)?;
            }
        }
        for path in local_files {
            let relative = path
                .strip_prefix(project_root)
                .map_err(|_| Error::new("Local sync path escaped project root"))?
                .to_string_lossy()
                .replace('\\', "/");
            if !remote_paths.contains(&relative) {
                fs::remove_file(path)?;
            }
        }
    }
    write_project_index(project_root).map(|_| ())
}

fn collect_local_paths(directory: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(directory)?
        .filter_map(|entry| entry.ok())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_local_paths(&path, out)?;
            continue;
        }
        let is_markdown = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"));
        let is_readme = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("README.md"));
        if is_markdown && !is_readme {
            out.push(path);
        }
    }
    Ok(())
}

fn is_safe_durable_path(path: &str) -> bool {
    if path.is_empty()
        || path.contains('\\')
        || path.contains("//")
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !path.to_ascii_lowercase().ends_with(".md")
        || path.to_ascii_lowercase().ends_with("/readme.md")
    {
        return false;
    }
    DURABLE_ROOTS
        .iter()
        .any(|root| path == *root || path.starts_with(&format!("{root}/")))
}

fn ensure_safe_durable_roots(project_root: &Path) -> Result<()> {
    for durable_root in DURABLE_ROOTS {
        let mut current = project_root.to_path_buf();
        for component in Path::new(durable_root).components() {
            current.push(component.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(Error::new(format!(
                        "Harness sync refused a symlinked durable path: {}",
                        current.display()
                    )));
                }
                Ok(metadata) if !metadata.is_dir() => {
                    return Err(Error::new(format!(
                        "Harness sync expected a durable directory: {}",
                        current.display()
                    )));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}

fn ensure_safe_parent_path(project_root: &Path, relative_path: &str) -> Result<()> {
    let mut current = project_root.to_path_buf();
    let Some(parent) = Path::new(relative_path).parent() else {
        return Ok(());
    };
    for component in parent.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(Error::new(format!(
                    "Harness sync refused a symlinked destination directory: {}",
                    current.display()
                )));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(Error::new(format!(
                    "Harness sync expected a destination directory: {}",
                    current.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn manifest_sha256(manifest: &SyncManifest) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(manifest)?))
}

fn manifest_files_sha256(manifest: &SyncManifest) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(&(
        manifest.schema_version,
        &manifest.project_id,
        &manifest.files,
    ))?))
}

fn sha256_hex(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hex::encode(hasher.finalize())
}

fn derive_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iterations, &mut key);
    key
}

fn secure_random(bytes: &mut [u8]) -> Result<()> {
    getrandom::getrandom(bytes)
        .map_err(|e| Error::new(format!("Secure random generator failed: {e}")))
}

fn validate_passphrase(passphrase: &str) -> Result<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(Error::new(format!(
            "Sync passphrase must contain at least {MIN_PASSPHRASE_CHARS} characters"
        )));
    }
    Ok(())
}

fn resolve_passphrase(explicit: Option<&str>, passphrase_stdin: bool) -> Result<String> {
    let value = if let Some(value) = explicit {
        value.to_string()
    } else if passphrase_stdin {
        let mut value = String::new();
        io::stdin().read_to_string(&mut value)?;
        value.trim_end_matches(['\r', '\n']).to_string()
    } else if let Ok(value) = env::var("HARNESS_SYNC_PASSPHRASE") {
        value
    } else {
        if !io::stdin().is_terminal() {
            return Err(Error::new(
                "Sync passphrase required. Use an interactive terminal, --passphrase-stdin, or HARNESS_SYNC_PASSPHRASE.",
            ));
        }
        rpassword::prompt_password("Sync passphrase: ")?
    };
    validate_passphrase(&value)?;
    Ok(value)
}

fn sync_state_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".5harness")
        .join("local")
        .join(SYNC_STATE_FILE_NAME)
}

fn read_sync_state(project_root: &Path) -> Result<Option<SyncState>> {
    let path = sync_state_path(project_root);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| Error::new(format!("Invalid local sync state {}: {e}", path.display())))
}

fn write_sync_state(project_root: &Path, state: &SyncState) -> Result<()> {
    let path = sync_state_path(project_root);
    atomic_write(&path, &(serde_json::to_string_pretty(state)? + "\n"))
}

fn http_client() -> Result<Client> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| Error::new(format!("HTTP client initialization failed: {e}")))
}

fn ensure_success(response: Response, action: &str) -> Result<Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    Err(Error::new(format!(
        "Harness cloud sync {action} rejected (HTTP {}). Check login, project access, and quota.",
        response.status().as_u16()
    )))
}

#[allow(dead_code)]
fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("harness-sync-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn manifest_is_deterministic_in_file_order_and_excludes_local_data() {
        let root = temp_dir("manifest");
        fs::create_dir_all(root.join("docs/stories/epics")).unwrap();
        fs::create_dir_all(root.join("docs/decisions")).unwrap();
        fs::create_dir_all(root.join(".5harness/index")).unwrap();
        fs::write(root.join("docs/stories/README.md"), "ignore").unwrap();
        fs::write(root.join("docs/stories/epics/US-002.md"), "two").unwrap();
        fs::write(root.join("docs/stories/US-001.md"), "one").unwrap();
        fs::write(root.join("docs/decisions/001.md"), "decision").unwrap();
        fs::write(
            root.join(".5harness/index/index.json"),
            "secret local index",
        )
        .unwrap();

        let manifest = build_manifest(&root, "project-1234567890").unwrap();
        let paths: Vec<_> = manifest
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert_eq!(
            paths,
            vec![
                "docs/decisions/001.md",
                "docs/stories/US-001.md",
                "docs/stories/epics/US-002.md"
            ]
        );
        assert!(validate_manifest(&manifest, "project-1234567890").is_ok());
    }

    #[test]
    fn encrypt_decrypt_round_trip_and_wrong_passphrase_fails() {
        let root = temp_dir("crypto");
        fs::create_dir_all(root.join("docs/stories")).unwrap();
        fs::write(root.join("docs/stories/US-001.md"), "# Story\n").unwrap();
        let (manifest, envelope) =
            create_envelope(&root, "project-1234567890", "a long enough passphrase").unwrap();
        assert_eq!(
            decrypt_envelope(&envelope, "a long enough passphrase").unwrap(),
            manifest
        );
        assert!(decrypt_envelope(&envelope, "a different passphrase").is_err());
        assert!(!envelope.ciphertext_base64.is_empty());
    }

    #[test]
    fn remote_paths_are_confined_to_durable_markdown_roots() {
        assert!(is_safe_durable_path("docs/stories/US-001.md"));
        assert!(is_safe_durable_path("docs/stories/epics/E1/US-001.md"));
        assert!(!is_safe_durable_path("AGENTS.md"));
        assert!(!is_safe_durable_path("docs/stories/../AGENTS.md"));
        assert!(!is_safe_durable_path("docs/stories/README.md"));
        assert!(!is_safe_durable_path("docs/stories/README.MD"));
        assert!(!is_safe_durable_path("docs/stories/x.txt"));
    }

    #[test]
    fn local_change_digest_ignores_manifest_generation_time() {
        let files = vec![SyncFile {
            path: "docs/stories/US-001.md".into(),
            sha256: sha256_hex(b"story"),
            content_base64: STANDARD.encode(b"story"),
        }];
        let first = SyncManifest {
            schema_version: SYNC_SCHEMA_VERSION,
            project_id: "project-1234567890".into(),
            generated_at: "2026-01-01T00:00:00Z".into(),
            files: files.clone(),
        };
        let second = SyncManifest {
            generated_at: "2026-01-02T00:00:00Z".into(),
            ..first.clone()
        };
        assert_ne!(
            manifest_sha256(&first).unwrap(),
            manifest_sha256(&second).unwrap()
        );
        assert_eq!(
            manifest_files_sha256(&first).unwrap(),
            manifest_files_sha256(&second).unwrap()
        );
    }
}
