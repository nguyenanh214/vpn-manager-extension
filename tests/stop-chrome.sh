#!/usr/bin/env bash
# Dừng Chrome test và dọn container/registry còn sót.
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="${VPNMGR_TEST_DIR:-$TESTS_DIR/.run}"

[ -f "$RUN_DIR/chrome.pid" ] && kill "$(cat "$RUN_DIR/chrome.pid")" 2>/dev/null
sleep 1
IDS="$(docker ps -aq --filter 'name=^vpnmgr-' 2>/dev/null)"
[ -n "$IDS" ] && docker rm -f $IDS >/dev/null 2>&1
rm -rf "$HOME/.config/vpn-manager/hosts"
exit 0
