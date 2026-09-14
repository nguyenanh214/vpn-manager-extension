#!/usr/bin/env bash
# Cài đặt VPN Manager: build image, đăng ký native messaging host.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_NAME="com.andy.vpn_manager"
# Manifest phải trỏ tới wrapper .sh, không phải .js: Chrome spawn với PATH tối thiểu
# nên shebang "#!/usr/bin/env node" sẽ chết nếu node cài qua nvm.
HOST_PATH="$REPO_DIR/native-host/vpn-manager-host.sh"
HOST_SCRIPT="$REPO_DIR/native-host/vpn-manager-host.js"
IMAGE="vpn-manager-socks"

# Chrome, Chromium và Brave dùng thư mục NativeMessagingHosts khác nhau
BROWSER_DIRS=(
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/chromium/NativeMessagingHosts"
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
)

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
fail() { red "LỖI: $*"; exit 1; }

echo "=== VPN Manager — cài đặt ==="
echo "Repo: $REPO_DIR"
echo

# --- 1. Kiểm tra điều kiện ---
echo "[1/6] Kiểm tra môi trường"
command -v docker >/dev/null || fail "Chưa cài docker"
command -v node   >/dev/null || fail "Chưa cài node"
command -v curl   >/dev/null || fail "Chưa cài curl"
command -v nmcli  >/dev/null || ylw "  ! Không có nmcli — sẽ không import được từ NetworkManager"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Cần Node >= 18, đang có $(node -v)"

docker info >/dev/null 2>&1 || fail "Không chạy được docker mà không cần sudo. Thêm user vào group docker: sudo usermod -aG docker \$USER"
[ -c /dev/net/tun ] || fail "Thiếu /dev/net/tun — kernel không hỗ trợ TUN"
grn "  ✓ docker, node $(node -v), curl, /dev/net/tun"

# --- 2. Build image ---
echo
echo "[2/6] Build image Docker"

# credsStore trỏ tới helper không tồn tại (rác của Docker Desktop đã gỡ) sẽ làm
# hỏng bước pull. Dùng config sạch riêng cho lần build này, không đụng file global.
DOCKER_ENV=()
if [ -f "$HOME/.docker/config.json" ] && grep -q '"credsStore"' "$HOME/.docker/config.json"; then
  HELPER="$(sed -n 's/.*"credsStore"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HOME/.docker/config.json")"
  if ! command -v "docker-credential-$HELPER" >/dev/null 2>&1; then
    ylw "  ! ~/.docker/config.json trỏ tới credsStore \"$HELPER\" nhưng helper không tồn tại"
    ylw "    Dùng config tạm để build. Sửa vĩnh viễn: xoá dòng \"credsStore\" khỏi file đó."
    TMP_DOCKER_CFG="$(mktemp -d)"
    echo '{}' > "$TMP_DOCKER_CFG/config.json"
    DOCKER_ENV=(env "DOCKER_CONFIG=$TMP_DOCKER_CFG")
    trap 'rm -rf "$TMP_DOCKER_CFG"' EXIT
  fi
fi

"${DOCKER_ENV[@]}" docker build -t "$IMAGE" "$REPO_DIR/docker" >/dev/null
grn "  ✓ image $IMAGE đã sẵn sàng"

# --- 3. Nhận Extension ID ---
echo
echo "[3/6] Đăng ký extension"
cat <<'HOWTO'
  Nếu chưa load extension:
    1. Mở chrome://extensions
    2. Bật "Developer mode" (góc trên bên phải)
    3. "Load unpacked" -> chọn thư mục:
HOWTO
echo "         $REPO_DIR/extension"
echo "    4. Copy Extension ID hiện ra trên thẻ extension"
echo

EXTENSION_ID="${1:-}"
if [ -z "$EXTENSION_ID" ]; then
  read -rp "  Dán Extension ID: " EXTENSION_ID
fi
[[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]] || fail "Extension ID phải là 32 chữ cái a-p, nhận được: '$EXTENSION_ID'"

# --- 4. Ghi manifest native host ---
echo
echo "[4/6] Cài native messaging host"
chmod +x "$HOST_PATH" "$HOST_SCRIPT"
INSTALLED=0
for dir in "${BROWSER_DIRS[@]}"; do
  browser_root="$(dirname "$dir")"
  [ -d "$browser_root" ] || continue
  mkdir -p "$dir"
  sed -e "s|__HOST_PATH__|$HOST_PATH|" -e "s|__EXTENSION_ID__|$EXTENSION_ID|" \
    "$REPO_DIR/native-host/$HOST_NAME.json.template" > "$dir/$HOST_NAME.json"
  chmod 600 "$dir/$HOST_NAME.json"
  grn "  ✓ $dir/$HOST_NAME.json"
  INSTALLED=$((INSTALLED + 1))
done
[ "$INSTALLED" -gt 0 ] || fail "Không tìm thấy thư mục cấu hình trình duyệt nào"

# --- 5. Thư mục state ---
echo
echo "[5/6] Tạo thư mục state"
mkdir -p "$HOME/.config/vpn-manager"
chmod 700 "$HOME/.config/vpn-manager"
grn "  ✓ $HOME/.config/vpn-manager (0700)"

# Script này chạy trong shell của user (có nvm), Chrome thì không.
# Ghi lại đường dẫn tuyệt đối để wrapper dùng thẳng.
NODE_BIN="$(command -v node)"
printf '%s' "$NODE_BIN" > "$HOME/.config/vpn-manager/node-path"
chmod 600 "$HOME/.config/vpn-manager/node-path"
grn "  ✓ node: $NODE_BIN"

# --- 6. Kiểm tra host khởi động được đúng như Chrome sẽ spawn ---
echo
echo "[6/6] Thử spawn native host giống hệt Chrome"
# Chrome không nạp shell profile và chỉ cấp PATH tối thiểu.
SPAWN_OUT="$(env -i HOME="$HOME" PATH=/usr/bin:/bin "$HOST_PATH" < /dev/null 2>&1)" || true
if echo "$SPAWN_OUT" | grep -q "khởi động pid="; then
  grn "  ✓ host khởi động được với PATH tối thiểu"
else
  red "  ✗ host KHÔNG khởi động được khi Chrome spawn:"
  echo "$SPAWN_OUT" | sed 's/^/      /'
  fail "Sửa lỗi trên rồi chạy lại"
fi

echo
grn "=== Xong ==="
echo "Vào chrome://extensions bấm Reload trên VPN Manager, rồi mở popup."
