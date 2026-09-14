#!/usr/bin/env bash
# Gỡ VPN Manager trên macOS.
set -euo pipefail

ACTUAL="$(uname -s)"
if [ "$ACTUAL" != "Darwin" ]; then
  printf '\033[33m! Script này dành cho %s, máy hiện tại là %s\033[0m\n' "macOS" "$ACTUAL" >&2
  printf '  Dùng: %s\n' "scripts/uninstall-linux.sh hoặc scripts/uninstall-windows.ps1" >&2
  exit 1
fi

OS="macos"
EXTENSION_ID_ARG="${1:-}"
export OS EXTENSION_ID_ARG
. "$(cd "$(dirname "$0")" && pwd)/lib/uninstall-common.sh"
