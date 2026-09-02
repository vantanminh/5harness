#!/usr/bin/env bash
# Automatic macOS install for 5harness (native CLI).
# Documented command:
#   curl -fsSL https://raw.githubusercontent.com/vantanminh/5harness/main/install/macos.sh | bash
# Local artifact (tests / CI):
#   HARNESS_INSTALL_FROM=/path/to/artifact-dir-or-bin ./install/macos.sh
set -euo pipefail

prefix="${HARNESS_INSTALL_PREFIX:-${HOME}/.5harness}"
bin_dir="${prefix}/bin"
mkdir -p "${bin_dir}"

find_local() {
  local from="$1"
  if [[ -f "$from" ]]; then
    echo "$from"
    return
  fi
  if [[ -d "$from" ]]; then
    for n in harness harness-aarch64-apple-darwin harness-x86_64-apple-darwin; do
      if [[ -f "${from}/${n}" ]]; then
        echo "${from}/${n}"
        return
      fi
    done
    local nested
    nested="$(find "$from" -type f \( -name 'harness' -o -name 'harness-*-apple-darwin' \) | head -n 1 || true)"
    if [[ -n "$nested" ]]; then
      echo "$nested"
      return
    fi
  fi
  echo "HARNESS_INSTALL_FROM did not contain a harness macOS binary: $from" >&2
  exit 1
}

install_bin() {
  local src="$1"
  local dest="${bin_dir}/harness"
  cp "$src" "$dest"
  chmod +x "$dest"
  echo "Installed $dest"
  if ! echo ":$PATH:" | grep -q ":${bin_dir}:"; then
    local rc
    if [[ -n "${ZSH_VERSION:-}" ]] || [[ "${SHELL:-}" == *zsh ]]; then
      rc="${HOME}/.zshrc"
    else
      rc="${HOME}/.bashrc"
    fi
    echo "export PATH=\"${bin_dir}:\$PATH\"" >> "$rc"
    echo "Added ${bin_dir} to PATH via $rc"
  fi
  export PATH="${bin_dir}:$PATH"
  "$dest" --version
}

if [[ -n "${HARNESS_INSTALL_FROM:-}" ]]; then
  src="$(find_local "${HARNESS_INSTALL_FROM}")"
  install_bin "$src"
  exit 0
fi

repo="${HARNESS_INSTALL_REPO:-vantanminh/5harness}"
arch="$(uname -m)"
if [[ "$arch" == "arm64" ]]; then
  want="aarch64-apple-darwin"
else
  want="x86_64-apple-darwin"
fi
echo "Downloading latest 5harness macOS binary ($want) from GitHub ($repo)..."
api="https://api.github.com/repos/${repo}/releases/latest"
json="$(curl -fsSL -H "User-Agent: 5harness-install" "$api")"
url="$(printf '%s' "$json" | python3 -c "import json,sys
rel=json.load(sys.stdin)
want=sys.argv[1]
for a in rel.get('assets',[]):
    n=a.get('name','')
    if want in n or n=='harness':
        print(a.get('browser_download_url',''));
        break
" "$want" || true)"
if [[ -z "$url" ]]; then
  echo "No macOS asset on latest GitHub release. Set HARNESS_INSTALL_FROM to a local binary." >&2
  exit 1
fi
tmp="$(mktemp)"
curl -fsSL -o "$tmp" "$url"
install_bin "$tmp"
rm -f "$tmp"
