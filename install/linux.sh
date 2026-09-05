#!/usr/bin/env bash
# Automatic Linux install for 5harness (native CLI).
# Documented command:
#   curl -fsSL https://raw.githubusercontent.com/vantanminh/5harness/main/install/linux.sh | bash
# Local artifact (tests / CI):
#   HARNESS_INSTALL_FROM=/path/to/artifact-dir-or-bin ./install/linux.sh
#
# The installer intentionally has no Node.js dependency. npm remains the
# preferred cross-platform installation path; this script is for machines
# that want the standalone native binary.
set -euo pipefail

fail() {
  echo "5harness install: $*" >&2
  exit 1
}

command -v uname >/dev/null 2>&1 || fail "uname is required"
command -v mkdir >/dev/null 2>&1 || fail "mkdir is required"
command -v cp >/dev/null 2>&1 || fail "cp is required"

case "$(uname -s)" in
  Linux) ;;
  *) fail "this installer is for Linux; use install/macos.sh on macOS" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) target="x86_64-unknown-linux-gnu" ;;
  aarch64|arm64) target="aarch64-unknown-linux-gnu" ;;
  *) fail "unsupported Linux architecture: $(uname -m) (supported: x86_64, aarch64)" ;;
esac

prefix="${HARNESS_INSTALL_PREFIX:-${HOME}/.5harness}"
bin_dir="${prefix}/bin"
mkdir -p "${bin_dir}"

tmp_files=()
cleanup() {
  local path
  for path in "${tmp_files[@]}"; do
    rm -f "$path"
  done
}
trap cleanup EXIT

find_local() {
  local from="$1"
  if [[ -f "$from" ]]; then
    [[ "$from" != *.zip && "$from" != *.tar.gz && "$from" != *.tgz ]] || \
      fail "HARNESS_INSTALL_FROM archive must be unpacked into a directory"
    echo "$from"
    return
  fi
  if [[ -d "$from" ]]; then
    local name
    for name in "harness-${target}" harness; do
      if [[ -f "${from}/${name}" ]]; then
        echo "${from}/${name}"
        return
      fi
    done
    local nested
    nested="$(find "$from" -type f \( -name "harness-${target}" -o -name harness \) -print -quit 2>/dev/null || true)"
    if [[ -n "$nested" ]]; then
      echo "$nested"
      return
    fi
  fi
  fail "HARNESS_INSTALL_FROM did not contain a harness Linux binary for ${target}: $from"
}

add_path() {
  if [[ "${HARNESS_INSTALL_SKIP_PATH:-}" == "1" ]]; then
    echo "Skipping PATH update (HARNESS_INSTALL_SKIP_PATH=1)"
    return
  fi
  case ":${PATH}:" in
    *":${bin_dir}:"*) return ;;
  esac

  local shell_name rc line
  shell_name="$(basename "${SHELL:-}")"
  if [[ "$shell_name" == "zsh" ]]; then
    rc="${ZDOTDIR:-${HOME}}/.zshrc"
  else
    rc="${HOME}/.bashrc"
  fi
  line="export PATH=\"${bin_dir}:\$PATH\""
  if [[ ! -e "$rc" || -w "$rc" ]]; then
    if ! grep -Fqx "$line" "$rc" 2>/dev/null; then
      {
        printf '\n# 5harness\n'
        printf '%s\n' "$line"
      } >> "$rc"
    fi
    echo "Added ${bin_dir} to PATH via ${rc}"
  else
    echo "Installed ${bin_dir}/harness; add ${bin_dir} to PATH manually" >&2
  fi
}

install_bin() {
  local src="$1"
  local dest="${bin_dir}/harness"
  [[ -f "$src" ]] || fail "native binary not found: $src"
  cp "$src" "$dest"
  chmod 0755 "$dest"
  echo "Installed $dest"
  add_path
  export PATH="${bin_dir}:${PATH}"
  "$dest" --version || fail "harness --version failed after install"
}

if [[ -n "${HARNESS_INSTALL_FROM:-}" ]]; then
  install_bin "$(find_local "${HARNESS_INSTALL_FROM}")"
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required for remote installation"
repo="${HARNESS_INSTALL_REPO:-vantanminh/5harness}"
version="${HARNESS_INSTALL_VERSION:-latest}"
if [[ "$version" == "latest" ]]; then
  api="https://api.github.com/repos/${repo}/releases/latest"
  release_json="$(curl --proto '=https' --tlsv1.2 -fsSL -H 'User-Agent: 5harness-install' "$api")" || \
    fail "could not query the latest GitHub release"
  tag="$(printf '%s\n' "$release_json" | sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)"
  [[ -n "$tag" ]] || fail "latest GitHub release did not contain a tag"
else
  [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || \
    fail "HARNESS_INSTALL_VERSION must be semver (for example 0.25.3 or v0.25.3)"
  tag="v${version#v}"
fi

asset="harness-${target}"
url="https://github.com/${repo}/releases/download/${tag}/${asset}"
tmp="$(mktemp "${TMPDIR:-/tmp}/5harness.XXXXXX")"
tmp_files+=("$tmp")
echo "Downloading 5harness ${tag} (${target}) from GitHub (${repo})..."
curl --proto '=https' --tlsv1.2 -fL --retry 2 -o "$tmp" "$url" || \
  fail "could not download ${asset}; choose a published version with HARNESS_INSTALL_VERSION or use HARNESS_INSTALL_FROM"
install_bin "$tmp"
