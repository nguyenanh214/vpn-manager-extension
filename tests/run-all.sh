#!/usr/bin/env bash
# Chạy toàn bộ test. Mỗi bộ dùng Chrome mới với profile sạch vì Chrome cache
# module của service worker trong profile — tái dùng sẽ chạy code cũ.
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$TESTS_DIR")"
SUITES="${*:-platform ovpn-store popup ovpn routing forwards lifecycle host-registry prune-ovpn traffic}"

# Các bộ dựng tunnel THẬT cần một file .ovpn chạy được. Đường dẫn đó và IP lối ra là
# của riêng từng máy nên không nằm trong repo — chúng ở .env, file này tự nạp.
if [ -f "$REPO_DIR/.env" ]; then
  set -a; . "$REPO_DIR/.env"; set +a
fi

# Báo NGAY từ đầu, trước khi chạy: thiếu cấu hình thì các bộ nặng sẽ tự bỏ qua và in
# "TẤT CẢ PASS" — dễ tưởng là đã kiểm xong trong khi chưa chạy dòng nào.
echo "--- Cấu hình ---"
if [ -n "${VPNMGR_TEST_OVPN:-}" ]; then
  echo "  VPNMGR_TEST_OVPN   = $VPNMGR_TEST_OVPN"
else
  echo "  VPNMGR_TEST_OVPN   chưa đặt — sẽ tự lấy file .ovpn đầu tiên trong profiles"
fi
if [ -n "${VPNMGR_TEST_EXIT_IP:-}" ]; then
  echo "  VPNMGR_TEST_EXIT_IP= $VPNMGR_TEST_EXIT_IP"
else
  echo "  VPNMGR_TEST_EXIT_IP chưa đặt — chỉ kiểm traffic CÓ đổi lối ra, không so đúng IP"
fi
if [ ! -f "$REPO_DIR/.env" ]; then
  echo
  echo "  Chưa có .env. Muốn kiểm chặt (so đúng IP lối ra) thì:"
  echo "      cp .env.example .env    rồi điền vào"
fi
echo
total_fail=0
any_browser=0

# macOS không ship `timeout` (coreutils GNU); Homebrew cài nó thành `gtimeout`.
# Không có cái nào thì chạy thẳng — mất lưới an toàn còn hơn báo THẤT BẠI cho bộ
# test thật ra chưa từng được chạy.
TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
else
  echo "! Không có timeout/gtimeout — test chạy không giới hạn thời gian."
  echo "  Muốn có: brew install coreutils"
  echo
fi

# Host vừa bị đóng stdin KHÔNG chết ngay: nó chờ grace 15s rồi stopAll(), mà stopAll
# xoá mọi container vpnmgr-* theo tiền tố tên — kể cả tunnel của bộ test TIẾP THEO.
# Chạy `host-registry` sát `traffic` là traffic vỡ đúng kiểu đó. Thứ tự mặc định chỉ
# thoát nhờ prune-ovpn chen giữa đủ lâu, không nên trông vào may rủi ấy.
#
# So PID trước/sau chứ không đếm tổng: máy người chạy test thường đang mở Chrome với
# extension, và host của Chrome sống suốt phiên — đếm tổng là chờ vô ích tới hết giờ.
# Chỉ ĐỌC tiến trình rồi chờ, tuyệt đối không pkill: `pkill -f` từng tự giết chính
# shell này. Máy không có pgrep (Windows) thì danh sách rỗng, vòng chờ bỏ qua luôn.
host_pids() { pgrep -f 'vpn-manager-host\.js' 2>/dev/null | sort; }

wait_new_hosts_gone() {
  before="$1"
  for _ in $(seq 1 40); do
    leftover="$(comm -13 <(echo "$before") <(host_pids) | tr -d '[:space:]')"
    [ -z "$leftover" ] && return 0
    sleep 1
  done
  echo "  ! host do bộ $suite sinh ra chưa thoát sau 40s — bộ sau có thể mất tunnel"
}

for suite in $SUITES; do
  echo "=============== $suite ==============="
  hosts_before="$(host_pids)"

  # host-registry không cần trình duyệt, nó spawn native host trực tiếp
  case "$suite" in
    host-registry|platform|ovpn-store|prune-ovpn|traffic) needs_browser=0 ;;
    *) needs_browser=1 ;;
  esac
  # Bộ nào cũng phải giết Chrome còn sót (xem đầu stop-chrome.sh), nhưng chỉ bộ dùng
  # trình duyệt mới được dọn state THẬT của user — năm bộ còn lại tự sandbox lấy.
  if [ "$needs_browser" = "1" ]; then
    any_browser=1
    "$TESTS_DIR/stop-chrome.sh" --purge-state >/dev/null 2>&1
    "$TESTS_DIR/launch-chrome.sh" || { echo "  không khởi động được Chrome"; total_fail=1; continue; }
  else
    "$TESTS_DIR/stop-chrome.sh" >/dev/null 2>&1
  fi

  if [ -n "$TIMEOUT_CMD" ]; then
    "$TIMEOUT_CMD" 300 node "$TESTS_DIR/$suite.test.mjs"
  else
    node "$TESTS_DIR/$suite.test.mjs"
  fi
  if [ $? -eq 0 ]; then
    echo
  else
    total_fail=1
    echo "  -> bộ $suite THẤT BẠI"
  fi
  # Giết Chrome NGAY sau bộ này, trước khi chờ: host do nó sinh ra chỉ thoát khi mất
  # port, còn để Chrome sống thì vòng chờ dưới đây cầm chắc hết 40s vô ích rồi cảnh
  # báo sai — mà host ấy vẫn kịp stopAll() giữa bộ sau.
  "$TESTS_DIR/stop-chrome.sh" >/dev/null 2>&1
  wait_new_hosts_gone "$hosts_before"
done

[ "$any_browser" = "1" ] && "$TESTS_DIR/stop-chrome.sh" --purge-state >/dev/null 2>&1
echo "======================================="
[ "$total_fail" -eq 0 ] && echo "TẤT CẢ PASS" || echo "CÓ BỘ THẤT BẠI"
exit "$total_fail"
