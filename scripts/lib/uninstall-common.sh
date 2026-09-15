# VPN Manager — định tuyến từng domain qua OpenVPN tunnel riêng.
# Copyright (C) 2026 thuyanh.nguyen
#
# Phát hành theo GNU General Public License v3.0 hoặc bản mới hơn.
# KHÔNG KÈM BẤT KỲ BẢO ĐẢM NÀO. Xem file LICENSE.
# Phần chung của uninstall-linux.sh và uninstall-macos.sh.
# KHÔNG chạy trực tiếp — entry point đặt $OS rồi source nó.
set -uo pipefail

: "${OS:?uninstall-common.sh cần biến OS}"

HOST_NAME="com.andy.vpn_manager"
IMAGE="vpn-manager-socks"
STATE_DIR="$HOME/.config/vpn-manager"

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

echo "=== VPN Manager — gỡ cài đặt ($OS) ==="

echo "[1/4] Dừng mọi tunnel"
IDS="$(docker ps -aq --filter 'name=^vpnmgr-' 2>/dev/null)"
if [ -n "$IDS" ]; then
  docker rm -f $IDS >/dev/null 2>&1 && echo "  ✓ đã xoá $(echo "$IDS" | wc -l | tr -d ' ') container"
else
  echo "  ✓ không có container nào"
fi

echo "[2/4] Xoá manifest native host"
FOUND=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  if [ -f "$dir/$HOST_NAME.json" ]; then
    rm -f "$dir/$HOST_NAME.json"
    echo "  ✓ $dir/$HOST_NAME.json"
    FOUND=$((FOUND + 1))
  fi
done <<EOF
$(browser_dirs)
EOF
[ "$FOUND" -gt 0 ] || echo "  - không có manifest nào"

echo "[3/4] Xoá image Docker"
docker rmi "$IMAGE" >/dev/null 2>&1 && echo "  ✓ $IMAGE" || echo "  - image không tồn tại"

echo "[4/4] Xoá state"
# Thư mục này chứa file .ovpn user import — có private key inline.
if [ -d "$STATE_DIR" ]; then
  COUNT="$(ls -1 "$STATE_DIR/profiles" 2>/dev/null | wc -l | tr -d ' ')"
  rm -rf "$STATE_DIR"
  echo "  ✓ $STATE_DIR (kèm $COUNT file .ovpn đã lưu)"
else
  echo "  - không có thư mục state"
fi

echo
echo "Xong. Gỡ nốt extension trong chrome://extensions."
