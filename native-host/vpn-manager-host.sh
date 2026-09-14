#!/bin/sh
# Wrapper khởi động native host.
#
# Chrome spawn native messaging host với PATH tối thiểu (/usr/bin:/bin), KHÔNG nạp
# shell profile. Node cài qua nvm/fnm/volta nằm ngoài PATH đó, nên shebang
# "#!/usr/bin/env node" sẽ chết với exit 127 và Chrome chỉ báo "Native host has exited".
# Wrapper này dò tìm node rồi exec bằng đường dẫn tuyệt đối.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH_FILE="${HOME}/.config/vpn-manager/node-path"

find_node() {
  # 1. Ghi đè thủ công
  if [ -n "${VPN_MANAGER_NODE:-}" ] && [ -x "${VPN_MANAGER_NODE}" ]; then
    printf '%s' "${VPN_MANAGER_NODE}"; return 0
  fi

  # 2. Đường dẫn install.sh đã dò được (chạy trong shell có nvm)
  if [ -f "${NODE_PATH_FILE}" ]; then
    saved="$(cat "${NODE_PATH_FILE}")"
    if [ -x "${saved}" ]; then printf '%s' "${saved}"; return 0; fi
  fi

  # 3. PATH hiện tại
  if command -v node >/dev/null 2>&1; then
    command -v node; return 0
  fi

  # 4. nvm/fnm — lấy bản mới nhất theo thứ tự version, không phải thứ tự chữ cái
  for base in "${HOME}/.nvm/versions/node" "${HOME}/.fnm/node-versions" "${HOME}/.volta/tools/image/node"; do
    [ -d "${base}" ] || continue
    latest="$(ls -1 "${base}" 2>/dev/null | sort -V | tail -1)"
    [ -n "${latest}" ] || continue
    for candidate in "${base}/${latest}/bin/node" "${base}/${latest}/installation/bin/node"; do
      if [ -x "${candidate}" ]; then printf '%s' "${candidate}"; return 0; fi
    done
  done

  # 5. Vị trí cài hệ thống thường gặp
  for candidate in /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node /snap/bin/node; do
    if [ -x "${candidate}" ]; then printf '%s' "${candidate}"; return 0; fi
  done

  return 1
}

if ! NODE="$(find_node)"; then
  echo "[vpn-manager-host] Không tìm thấy Node.js." >&2
  echo "[vpn-manager-host] Chạy lại scripts/install.sh, hoặc đặt biến VPN_MANAGER_NODE." >&2
  exit 1
fi

exec "${NODE}" "${DIR}/vpn-manager-host.js"
