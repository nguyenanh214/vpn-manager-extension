#!/usr/bin/env bash
# Chạy toàn bộ test. Mỗi bộ dùng Chrome mới với profile sạch vì Chrome cache
# module của service worker trong profile — tái dùng sẽ chạy code cũ.
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
SUITES="${*:-platform ovpn-store popup ovpn routing forwards lifecycle host-registry}"
total_fail=0

for suite in $SUITES; do
  echo "=============== $suite ==============="
  "$TESTS_DIR/stop-chrome.sh" >/dev/null 2>&1

  # host-registry không cần trình duyệt, nó spawn native host trực tiếp
  case "$suite" in
    host-registry|platform|ovpn-store) needs_browser=0 ;;
    *) needs_browser=1 ;;
  esac
  if [ "$needs_browser" = "1" ]; then
    "$TESTS_DIR/launch-chrome.sh" || { echo "  không khởi động được Chrome"; total_fail=1; continue; }
  fi

  if timeout 300 node "$TESTS_DIR/$suite.test.mjs"; then
    echo
  else
    total_fail=1
    echo "  -> bộ $suite THẤT BẠI"
  fi
done

"$TESTS_DIR/stop-chrome.sh" >/dev/null 2>&1
echo "======================================="
[ "$total_fail" -eq 0 ] && echo "TẤT CẢ PASS" || echo "CÓ BỘ THẤT BẠI"
exit "$total_fail"
