#!/usr/bin/env bash
# Khởi động Chrome for Testing với extension đã load, phục vụ test tự động.
#
# Hai điều bắt buộc, học từ lỗi thật:
#   1. env -i — Chrome thật spawn native host với PATH tối thiểu, không có nvm.
#      Kế thừa PATH của shell sẽ che mất lỗi "không tìm thấy node".
#   2. Xoá profile mỗi lần — Chrome cache module của service worker trong profile,
#      tái dùng sẽ chạy code CŨ dù file trên đĩa đã mới.
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$TESTS_DIR")"
RUN_DIR="${VPNMGR_TEST_DIR:-$TESTS_DIR/.run}"
PORT="${CDP_PORT:-9223}"

CHROME="${VPNMGR_TEST_CHROME:-}"
if [ -z "$CHROME" ]; then
  CHROME="$(find "$HOME/.cache/ms-playwright" -name chrome -type f \
    -path '*chrome-linux64*' 2>/dev/null | head -1)"
fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "Không tìm thấy Chrome for Testing." >&2
  echo "Cài bằng: npx playwright@latest install chromium" >&2
  echo "Hoặc đặt biến VPNMGR_TEST_CHROME trỏ tới binary." >&2
  exit 1
fi

MANIFEST="$HOME/.config/google-chrome/NativeMessagingHosts/com.andy.vpn_manager.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Chưa cài native host. Chạy scripts/install.sh trước." >&2
  exit 1
fi

rm -rf "$RUN_DIR/chrome-profile"
mkdir -p "$RUN_DIR/chrome-profile/NativeMessagingHosts"
cp "$MANIFEST" "$RUN_DIR/chrome-profile/NativeMessagingHosts/"

nohup env -i HOME="$HOME" DISPLAY="${DISPLAY:-:1}" PATH=/usr/bin:/bin \
  "$CHROME" --user-data-dir="$RUN_DIR/chrome-profile" \
  --load-extension="$REPO_DIR/extension" \
  --remote-debugging-port="$PORT" --no-first-run --no-default-browser-check \
  --disable-sync --headless=new --window-size=380,560 about:blank \
  > "$RUN_DIR/chrome.log" 2>&1 &
echo $! > "$RUN_DIR/chrome.pid"

for _ in $(seq 1 40); do
  curl -s "http://localhost:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 3

if curl -s "http://localhost:$PORT/json/list" | grep -q fkmekgedgclilahepbobamfabndfnjfh; then
  echo "chrome pid=$(cat "$RUN_DIR/chrome.pid") — extension loaded (PATH tối thiểu)"
else
  echo "extension KHÔNG load — xem $RUN_DIR/chrome.log" >&2
  exit 1
fi
