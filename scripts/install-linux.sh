#!/usr/bin/env bash
# Cài đặt VPN Manager trên Linux.
set -euo pipefail

ACTUAL="$(uname -s)"
if [ "$ACTUAL" != "Linux" ]; then
  printf '\033[33m! Script này dành cho %s, máy hiện tại là %s\033[0m\n' "Linux" "$ACTUAL" >&2
  printf '  Dùng: %s\n' "scripts/install-macos.sh hoặc scripts/install-windows.ps1" >&2
  exit 1
fi

OS="linux"
EXTENSION_ID_ARG="${1:-}"
export OS EXTENSION_ID_ARG
. "$(cd "$(dirname "$0")" && pwd)/lib/install-common.sh"
