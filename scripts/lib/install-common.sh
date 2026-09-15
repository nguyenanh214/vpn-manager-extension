# VPN Manager — định tuyến từng domain qua OpenVPN tunnel riêng.
# Copyright (C) 2026 thuyanh.nguyen
#
# Phát hành theo GNU General Public License v3.0 hoặc bản mới hơn.
# KHÔNG KÈM BẤT KỲ BẢO ĐẢM NÀO. Xem file LICENSE.
# Phần chung của install-linux.sh và install-macos.sh.
# KHÔNG chạy trực tiếp file này — entry point đặt $OS rồi source nó.
#
# Viết cho bash 3.2 vì macOS vẫn ship bản đó (2007, lý do giấy phép GPLv3).
# KHÔNG dùng: declare -A, mapfile, readarray, ${var,,}, ${var^^}.
set -euo pipefail

: "${OS:?install-common.sh cần biến OS, gọi qua install-linux.sh hoặc install-macos.sh}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_NAME="com.andy.vpn_manager"
# Manifest phải trỏ tới wrapper .sh, không phải .js: Chrome spawn với PATH tối thiểu
# nên shebang "#!/usr/bin/env node" sẽ chết nếu node cài qua nvm.
HOST_PATH="$REPO_DIR/native-host/vpn-manager-host.sh"
HOST_SCRIPT="$REPO_DIR/native-host/vpn-manager-host.js"
IMAGE="vpn-manager-socks"
STATE_DIR="$HOME/.config/vpn-manager"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
fail() { red "LỖI: $*"; exit 1; }

# Thư mục manifest native messaging, khác nhau giữa Linux và macOS.
# In ra từng dòng thay vì trả mảng, cho hợp bash 3.2.
browser_dirs() {
  if [ "$OS" = "macos" ]; then
    echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    echo "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    echo "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    echo "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  else
    echo "$HOME/.config/google-chrome/NativeMessagingHosts"
    echo "$HOME/.config/chromium/NativeMessagingHosts"
    echo "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    echo "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  fi
}

# Ba tình huống Docker khác nhau, ba cách sửa khác nhau. Gộp chung thành
# "Docker không dùng được" là bắt user tự mò.
check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    red "  ✗ Không tìm thấy Docker."
    if [ "$OS" = "macos" ]; then
      echo "    1. Tải Docker Desktop: https://www.docker.com/products/docker-desktop/"
      echo "       - Apple Silicon (M1/M2/M3): bản \"Mac with Apple chip\""
      echo "       - Intel: bản \"Mac with Intel chip\""
      echo "    2. Mở Docker Desktop, chờ icon cá voi trên thanh menu hết nhấp nháy"
      echo "    3. Chạy lại script này"
    else
      echo "    Cài docker rồi thêm user vào group:"
      echo "      sudo usermod -aG docker \$USER"
      echo "    Sau đó đăng xuất và đăng nhập lại."
    fi
    exit 1
  fi

  if docker info >/dev/null 2>&1; then return 0; fi

  # Có CLI nhưng không nối được daemon
  if [ "$OS" = "macos" ]; then
    if [ ! -d /Applications/Docker.app ]; then
      red "  ✗ Có lệnh docker nhưng thiếu Docker Desktop (chỉ có CLI, không có daemon)."
      echo "    Đây là kết quả thường gặp của \`brew install docker\` — lệnh đó chỉ cài CLI."
      echo "    Cài thêm phần daemon:"
      echo "      brew install --cask docker"
      echo "    Rồi mở /Applications/Docker.app một lần và chạy lại script này."
    else
      red "  ✗ Docker Desktop đã cài nhưng chưa chạy."
      echo "    Mở /Applications/Docker.app, chờ icon cá voi trên thanh menu hết nhấp nháy,"
      echo "    rồi chạy lại script này."
    fi
  else
    red "  ✗ Không chạy được docker mà không cần sudo."
    echo "    Thêm user vào group docker rồi đăng xuất/đăng nhập lại:"
    echo "      sudo usermod -aG docker \$USER"
  fi
  exit 1
}

echo "=== VPN Manager — cài đặt ==="
echo "Repo: $REPO_DIR"
echo "OS:   $OS"
echo

# --- 1. Kiểm tra điều kiện ---
echo "[1/6] Kiểm tra môi trường"
check_docker
command -v node >/dev/null 2>&1 || fail "Chưa cài node. Cần Node >= 18."
command -v curl >/dev/null 2>&1 || fail "Chưa cài curl"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Cần Node >= 18, đang có $(node -v)"

if [ "$OS" = "linux" ] && ! command -v nmcli >/dev/null 2>&1; then
  ylw "  ! Không có nmcli — sẽ không import được từ NetworkManager"
fi
grn "  ✓ docker, node $(node -v), curl"

# --- 2. Dựng image ---
echo
echo "[2/6] Dựng image Docker"

# credsStore trỏ tới helper không tồn tại (rác của Docker Desktop đã gỡ) làm hỏng
# bước pull. Dùng config sạch riêng cho lần này, không đụng file global của user.
DOCKER_CFG_ARG=""
if [ -f "$HOME/.docker/config.json" ] && grep -q '"credsStore"' "$HOME/.docker/config.json"; then
  HELPER="$(sed -n 's/.*"credsStore"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HOME/.docker/config.json")"
  if ! command -v "docker-credential-$HELPER" >/dev/null 2>&1; then
    ylw "  ! ~/.docker/config.json trỏ tới credsStore \"$HELPER\" nhưng helper không tồn tại"
    ylw "    Dùng config tạm. Sửa vĩnh viễn: xoá dòng \"credsStore\" khỏi file đó."
    TMP_DOCKER_CFG="$(mktemp -d)"
    echo '{}' > "$TMP_DOCKER_CFG/config.json"
    DOCKER_CFG_ARG="$TMP_DOCKER_CFG"
    trap 'rm -rf "$TMP_DOCKER_CFG"' EXIT
  fi
fi

# Truyền qua biến môi trường thay vì mảng: bash 3.2 báo "unbound variable" với
# mảng rỗng khi đang bật `set -u`.
if [ -n "$DOCKER_CFG_ARG" ]; then
  DOCKER_CONFIG="$DOCKER_CFG_ARG" docker build -t "$IMAGE" "$REPO_DIR/docker" >/dev/null
else
  docker build -t "$IMAGE" "$REPO_DIR/docker" >/dev/null
fi
grn "  ✓ image $IMAGE đã sẵn sàng"

# Host không có /dev/net/tun trên macOS vì Docker chạy trong VM — kiểm tra file
# trên host sẽ luôn sai. Thử tạo interface trong container mới là phép thử đúng.
echo
echo -n "  Thử tạo interface tun trong container... "
TUN_OUT="$(docker run --rm --cap-add=NET_ADMIN --device /dev/net/tun \
  --entrypoint sh "$IMAGE" -c \
  'ip tuntap add dev tunprobe mode tun && ip link del tunprobe && echo TUN_OK' 2>&1)" || true
if echo "$TUN_OUT" | grep -q TUN_OK; then
  grn "OK"
else
  echo
  red "  ✗ Container không tạo được interface tun:"
  echo "$TUN_OUT" | sed 's/^/      /'
  echo "    Không có nó thì không dựng được tunnel."
  [ "$OS" = "macos" ] && echo "    Thử khởi động lại Docker Desktop."
  exit 1
fi

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

EXTENSION_ID="${EXTENSION_ID_ARG:-}"
if [ -z "$EXTENSION_ID" ]; then
  printf "  Dán Extension ID: "
  read -r EXTENSION_ID
fi
case "$EXTENSION_ID" in
  [a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p]\
[a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p]) ;;
  *) fail "Extension ID phải là 32 chữ cái a-p, nhận được: '$EXTENSION_ID'" ;;
esac

# --- 4. Ghi manifest native host ---
echo
echo "[4/6] Cài native messaging host"
chmod +x "$HOST_PATH" "$HOST_SCRIPT"
INSTALLED=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  browser_root="$(dirname "$dir")"
  [ -d "$browser_root" ] || continue
  mkdir -p "$dir"
  sed -e "s|__HOST_PATH__|$HOST_PATH|" -e "s|__EXTENSION_ID__|$EXTENSION_ID|" \
    "$REPO_DIR/native-host/$HOST_NAME.json.template" > "$dir/$HOST_NAME.json"
  chmod 600 "$dir/$HOST_NAME.json"
  grn "  ✓ $dir/$HOST_NAME.json"
  INSTALLED=$((INSTALLED + 1))
done <<EOF
$(browser_dirs)
EOF
[ "$INSTALLED" -gt 0 ] || fail "Không tìm thấy thư mục cấu hình trình duyệt nào. Đã cài Chrome chưa?"

# --- 5. Thư mục state ---
echo
echo "[5/6] Tạo thư mục state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
grn "  ✓ $STATE_DIR (0700)"

# Script này chạy trong shell của user (có nvm), Chrome thì không.
# Ghi lại đường dẫn tuyệt đối để wrapper khỏi phải dò.
NODE_BIN="$(command -v node)"
printf '%s' "$NODE_BIN" > "$STATE_DIR/node-path"
chmod 600 "$STATE_DIR/node-path"
grn "  ✓ node: $NODE_BIN"

# --- 6. Thử spawn đúng như Chrome ---
echo
echo "[6/6] Thử spawn native host giống hệt Chrome"
# Chrome không nạp shell profile và chỉ cấp PATH tối thiểu — mà "tối thiểu" khác nhau
# giữa hai OS. Trên macOS, Chrome nhận PATH của launchd; kiểm chứng bằng
# `ps -p <pid Chrome> -E` là đúng bốn thư mục dưới đây, KHÔNG có /usr/local/bin.
if [ "$OS" = "macos" ]; then
  MIN_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
else
  MIN_PATH="/usr/bin:/bin"
fi

SPAWN_OUT="$(env -i HOME="$HOME" PATH="$MIN_PATH" "$HOST_PATH" < /dev/null 2>&1)" || true
if echo "$SPAWN_OUT" | grep -q "khởi động pid="; then
  grn "  ✓ host khởi động được với PATH tối thiểu"
else
  red "  ✗ host KHÔNG khởi động được khi Chrome spawn:"
  echo "$SPAWN_OUT" | sed 's/^/      /'
  fail "Sửa lỗi trên rồi chạy lại"
fi

# Khởi động được vẫn chưa đủ: host còn phải TÌM RA docker với PATH đó. Trên macOS
# Docker Desktop đặt symlink ở /usr/local/bin, ngoài PATH của launchd — host chạy
# ngon rồi chết ở `spawn docker ENOENT`, triệu chứng trông như Docker chưa chạy.
echo -n "  Host có gọi được docker với PATH đó không... "
# Giữ lại các biến CHỌN ENDPOINT của docker: `env -i` xoá sạch chúng, mà Docker
# rootless trên Linux chọn socket qua DOCKER_HOST/XDG_RUNTIME_DIR. Không giữ thì probe
# fail trong khi máy hoàn toàn dùng được. `${v:+...}` để biến rỗng thì biến mất hẳn
# chứ không thành chuỗi rỗng — docker phân biệt hai thứ đó.
DOCKER_PROBE="$(env -i HOME="$HOME" PATH="$MIN_PATH" \
  ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} \
  ${DOCKER_CONTEXT:+DOCKER_CONTEXT="$DOCKER_CONTEXT"} \
  ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} \
  "$NODE_BIN" \
  -e 'const p=require(process.argv[1]);
      const bin=p.resolveExecutable("docker", p.dockerSearchPaths());
      require("child_process").execFile(bin, ["info", "--format", "{{.ServerVersion}}"],
        { timeout: 20000 },
        (e) => { console.log(e ? "PROBE_FAIL " + bin + ": " + e.message : "PROBE_OK " + bin); });' \
  "$REPO_DIR/native-host/lib/platform.js" 2>&1)" || true
if echo "$DOCKER_PROBE" | grep -q PROBE_OK; then
  grn "OK ($(echo "$DOCKER_PROBE" | sed -n 's/^.*PROBE_OK //p' | head -1))"
elif [ "$OS" = "macos" ]; then
  # macOS: đã kiểm chứng Chrome cấp đúng PATH này, nên fail ở đây là hỏng thật.
  echo
  red "  ✗ Host không gọi được docker khi Chrome spawn:"
  echo "$DOCKER_PROBE" | sed 's/^/      /'
  fail "Thêm vị trí cài docker vào dockerSearchPaths() trong native-host/lib/platform.js"
else
  # Linux: chỉ cảnh báo. Ở đây Chrome thường được khởi động từ session đã export sẵn
  # DOCKER_HOST, nên probe này nghiêm hơn thực tế — chặn cài đặt là chặn nhầm.
  echo
  ylw "  ! Không gọi được docker với PATH tối thiểu:"
  echo "$DOCKER_PROBE" | sed 's/^/      /'
  ylw "    Nếu popup báo \"Docker không dùng được\", thêm vị trí cài docker vào"
  ylw "    dockerSearchPaths() trong native-host/lib/platform.js"
fi

echo
grn "=== Xong ==="
echo "Vào chrome://extensions bấm Reload trên VPN Manager, rồi mở popup."
