use std::fs;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn package_json_keeps_5harness_bins() {
    let pkg: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(root().join("package.json")).unwrap()).unwrap();
    assert_eq!(pkg["name"], "5harness");
    assert_eq!(pkg["bin"]["harness"], "dist/cli.js");
    assert_eq!(pkg["bin"]["5harness"], "dist/cli.js");
    assert_eq!(pkg["bin"]["5hn"], "dist/cli.js");
}

#[test]
fn cargo_version_matches_package_json() {
    let pkg: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(root().join("package.json")).unwrap()).unwrap();
    assert_eq!(pkg["version"].as_str().unwrap(), env!("CARGO_PKG_VERSION"));
}

#[test]
fn windows_and_macos_install_scripts_exist() {
    let win = root().join("install").join("windows.ps1");
    let mac = root().join("install").join("macos.sh");
    assert!(win.is_file(), "{}", win.display());
    assert!(mac.is_file(), "{}", mac.display());
    let win_txt = fs::read_to_string(&win).unwrap();
    let mac_txt = fs::read_to_string(&mac).unwrap();
    assert!(win_txt.contains("HARNESS_INSTALL_FROM") || win_txt.contains("Install"));
    assert!(mac_txt.contains("HARNESS_INSTALL_FROM") || mac_txt.contains("install"));
}

#[test]
fn ci_still_publishes_to_npmjs_with_provenance() {
    let ci = fs::read_to_string(root().join(".github/workflows/ci.yml")).unwrap();
    let rel = fs::read_to_string(root().join(".github/workflows/release.yml")).unwrap();
    assert!(ci.contains("npm publish --access public --provenance"));
    assert!(rel.contains("npm publish --access public --provenance"));
    assert!(ci.contains("id-token: write"));
}

#[test]
fn native_shim_does_not_load_typescript_cli() {
    let shim = fs::read_to_string(root().join("npm").join("shim.mjs")).unwrap();
    assert!(!shim.contains("src/cli.ts"));
    assert!(shim.contains("spawn") || shim.contains("spawnSync") || shim.contains("execFileSync"));
}
