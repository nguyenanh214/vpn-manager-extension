#!/usr/bin/env bash
# Gỡ VPN Manager: dừng tunnel, xoá manifest, xoá image, xoá state.
set -uo pipefail

HOST_NAME="com.andy.vpn_manager"
IMAGE="vpn-manager-socks"

echo "=== VPN Manager — gỡ cài đặt ==="

echo "[1/4] Dừng mọi tunnel"
IDS="$(docker ps -aq --filter 'name=^vpnmgr-' 2>/dev/null)"
if [ -n "$IDS" ]; then
  docker rm -f $IDS >/dev/null 2>&1 && echo "  ✓ đã xoá $(echo "$IDS" | wc -l) container"
else
  echo "  ✓ không có container nào"
fi

echo "[2/4] Xoá manifest native host"
for dir in "$HOME/.config/google-chrome/NativeMessagingHosts" \
           "$HOME/.config/chromium/NativeMessagingHosts" \
           "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"; do
  [ -f "$dir/$HOST_NAME.json" ] && rm -f "$dir/$HOST_NAME.json" && echo "  ✓ $dir/$HOST_NAME.json"
done

echo "[3/4] Xoá image Docker"
docker rmi "$IMAGE" >/dev/null 2>&1 && echo "  ✓ $IMAGE" || echo "  - image không tồn tại"

echo "[4/4] Xoá state"
rm -rf "$HOME/.config/vpn-manager" && echo "  ✓ ~/.config/vpn-manager"

echo
echo "Xong. Gỡ nốt extension trong chrome://extensions."
echo "Nếu Chrome còn giữ proxy cũ: chrome://settings/system -> mở cài đặt proxy -> đặt lại."
