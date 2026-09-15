#!/usr/bin/env bash
# Dừng Chrome test. Kèm --purge-state thì dọn luôn container và registry.
#
# Tách hai việc vì mức tàn phá khác hẳn nhau:
#   - Giết Chrome theo chrome.pid chỉ đụng tiến trình do launch-chrome.sh sinh ra.
#   - Dọn state xoá ~/.config/vpn-manager/hosts và `docker rm -f` MỌI container
#     vpnmgr-* — tức cả tunnel THẬT của người đang chạy test.
# Chỉ các bộ dùng trình duyệt mới cần phần sau (launch-chrome.sh chạy với HOME thật);
# năm bộ còn lại tự sandbox lấy nên gọi phần đó ở đó là phá state của user.
#
# Nhưng phần GIẾT CHROME thì bộ nào cũng cần: Chrome còn sống thì service worker của
# nó rụng sau ~30s idle, host mất port rồi hết grace 15s là stopAll() — xoá sạch
# container vpnmgr-*, kể cả tunnel mà bộ test đang chạy vừa dựng.
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="${VPNMGR_TEST_DIR:-$TESTS_DIR/.run}"

[ -f "$RUN_DIR/chrome.pid" ] && kill "$(cat "$RUN_DIR/chrome.pid")" 2>/dev/null
sleep 1

[ "${1:-}" = "--purge-state" ] || exit 0

IDS="$(docker ps -aq --filter 'name=^vpnmgr-' 2>/dev/null)"
[ -n "$IDS" ] && docker rm -f $IDS >/dev/null 2>&1
rm -rf "$HOME/.config/vpn-manager/hosts"
exit 0
