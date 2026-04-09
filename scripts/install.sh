#!/usr/bin/env bash

set -euo pipefail

REPO_OWNER="deforay"
REPO_NAME="vlsm-interfacing"

usage() {
  cat <<'EOF'
Usage:
  scripts/install.sh [--download-dir <dir>] [--tag <tag>]

Examples:
  scripts/install.sh
  scripts/install.sh --tag v4.0.3
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

map_arch_to_asset_pattern() {
  case "$(uname -m)" in
    x86_64|amd64)
      echo 'amd64|x86_64'
      ;;
    aarch64|arm64)
      echo 'arm64|aarch64'
      ;;
    *)
      # WHY: if release assets do not embed the machine architecture in the
      # filename, we still want a usable fallback instead of failing early.
      echo ''
      ;;
  esac
}

find_release_asset_url() {
  local tag="$1"
  local arch_pattern="$2"
  local api_url
  local release_json
  local asset_url

  if [[ -n "$tag" ]]; then
    api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}"
  else
    api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  fi

  release_json="$(curl -fsSL "${api_url}")"

  if [[ -n "$arch_pattern" ]]; then
    asset_url="$(printf '%s\n' "${release_json}" \
      | grep -Eo '"browser_download_url": "[^"]+\.deb"' \
      | cut -d'"' -f4 \
      | grep -Ei "${arch_pattern}" \
      | head -n1 || true)"
  fi

  if [[ -z "${asset_url:-}" ]]; then
    asset_url="$(printf '%s\n' "${release_json}" \
      | grep -Eo '"browser_download_url": "[^"]+\.deb"' \
      | cut -d'"' -f4 \
      | head -n1 || true)"
  fi

  if [[ -z "${asset_url:-}" ]]; then
    echo "No .deb asset found in the selected GitHub release." >&2
    exit 1
  fi

  printf '%s\n' "${asset_url}"
}

install_latest() {
  local download_dir=""
  local tag=""
  local arch_pattern
  local asset_url
  local package_name
  local package_path

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --download-dir)
        download_dir="$2"
        shift 2
        ;;
      --tag)
        tag="$2"
        shift 2
        ;;
      -h|--help|help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  require_command curl
  require_command dpkg

  arch_pattern="$(map_arch_to_asset_pattern)"
  asset_url="$(find_release_asset_url "${tag}" "${arch_pattern}")"
  package_name="$(basename "${asset_url}")"

  if [[ -z "${download_dir}" ]]; then
    download_dir="$(mktemp -d)"
    trap 'rm -rf "${download_dir}"' EXIT
  else
    mkdir -p "${download_dir}"
  fi

  package_path="${download_dir}/${package_name}"

  echo "Downloading ${asset_url}"
  curl -fL "${asset_url}" -o "${package_path}"

  echo "Installing ${package_path}"
  if sudo dpkg -i "${package_path}"; then
    echo "Installation completed."
    return
  fi

  # WHY: dpkg can leave dependency resolution incomplete for local .deb files.
  # apt-get -f install repairs dependencies and finishes package configuration.
  echo "dpkg reported dependency issues. Repairing with apt-get -f install..."
  sudo apt-get install -f -y
  echo "Installation completed after dependency repair."
}

install_latest "$@"
