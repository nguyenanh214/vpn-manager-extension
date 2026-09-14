#!/bin/sh
# Dựng config OpenVPN từ env, chạy client, chờ tunnel up, rồi mở SOCKS5.
# In marker VPNMGR_READY ra stdout để native host biết tunnel đã sẵn sàng.
set -eu

: "${VPN_GATEWAY:?VPN_GATEWAY required}"
: "${VPN_CA:?VPN_CA required}"
: "${SOCKS_PORT:=1080}"
: "${VPN_PROTO:=udp}"
: "${READY_TIMEOUT:=45}"

CONF=/tmp/client.ovpn
REMOTE_HOST=$(echo "$VPN_GATEWAY" | cut -d: -f1)
REMOTE_PORT=$(echo "$VPN_GATEWAY" | cut -d: -f2 -s)
[ -n "$REMOTE_PORT" ] || REMOTE_PORT=1194

emit() { printf '%s\n' "$1" >> "$CONF"; }
emit_if() { [ -n "$2" ] || return 0; emit "$1 $2"; }

: > "$CONF"
emit "client"
emit "dev tun"
emit "proto $VPN_PROTO"
emit "remote $REMOTE_HOST $REMOTE_PORT"
emit "resolv-retry infinite"
emit "nobind"
emit "persist-key"
emit "persist-tun"
emit "remote-cert-tls server"
# Báo cho server biết ngay khi client thoát, thay vì để session treo tới ping-restart.
# Không có nó, dựng lại container sẽ tự đụng chính session cũ của mình (server này
# không bật duplicate-cn) và cả hai bên cùng hỏng.
if [ "$VPN_PROTO" = "udp" ]; then emit "explicit-exit-notify 1"; fi
# Server push ping-restart 120 -> bị đá thì im lặng 2 phút mới nhận ra.
# Ép xuống 30s để tunnel tự hồi nhanh.
emit "pull-filter ignore \"ping-restart\""
emit "ping-restart 30"
emit "verb 3"
emit "ca $VPN_CA"
emit_if "cert" "${VPN_CERT:-}"
emit_if "key" "${VPN_KEY:-}"
emit_if "tls-crypt" "${VPN_TLS_CRYPT:-}"
emit_if "auth" "${VPN_AUTH:-}"
emit_if "tls-version-min" "${VPN_TLS_VERSION_MIN:-}"
if [ -n "${VPN_TLS_AUTH:-}" ]; then emit "tls-auth $VPN_TLS_AUTH 1"; fi
if [ -n "${VPN_CIPHER:-}" ]; then
  emit "data-ciphers $VPN_CIPHER:AES-256-GCM:AES-128-GCM"
  emit "data-ciphers-fallback $VPN_CIPHER"
fi
if [ -n "${VPN_VERIFY_X509:-}" ]; then emit "verify-x509-name $VPN_VERIFY_X509 name"; fi

echo "[vpnmgr] config sinh xong, remote=$REMOTE_HOST:$REMOTE_PORT proto=$VPN_PROTO"

# VPN_FORWARDS = "13306:10.8.0.20:3306,15432:db.local:5432"
# Mỗi mục mở một cổng TCP trong container, chuyển tiếp qua tunnel tới đích.
# Dùng cho client không nói được SOCKS5 (Navicat, DBeaver, psql...).
start_forwards() {
  [ -n "${VPN_FORWARDS:-}" ] || return 0
  OLD_IFS=$IFS; IFS=','
  for rule in $VPN_FORWARDS; do
    [ -n "$rule" ] || continue
    lport=$(echo "$rule" | cut -d: -f1)
    rhost=$(echo "$rule" | cut -d: -f2)
    rport=$(echo "$rule" | cut -d: -f3)
    if [ -z "$lport" ] || [ -z "$rhost" ] || [ -z "$rport" ]; then
      echo "[vpnmgr] bỏ qua forward sai định dạng: $rule"
      continue
    fi
    socat "TCP-LISTEN:$lport,fork,reuseaddr" "TCP:$rhost:$rport" &
    FORWARD_PIDS="$FORWARD_PIDS $!"
    echo "[vpnmgr] forward :$lport -> $rhost:$rport"
  done
  IFS=$OLD_IFS
}

# Chặn rò rỉ: bỏ default route qua eth0 sau khi tunnel lên.
# OpenVPN định tuyến toàn bộ qua 0.0.0.0/1 + 128.0.0.0/1 trên tun0, và giữ riêng
# host route tới server VPN qua eth0 nên vẫn kết nối lại được.
# Nếu tun0 biến mất, các route /1 mất theo -> gói tin KHÔNG có đường ra, thay vì
# âm thầm đi ra mạng thường. Cùng triết lý fail-closed với PAC.
enable_killswitch() {
  if ! ip route show | grep -q "^0.0.0.0/1 .*tun0"; then
    echo "[vpnmgr] cảnh báo: không thấy route /1 qua tun0, bỏ qua killswitch"
    return 0
  fi
  default_line=$(ip route show default | head -1)
  if [ -n "$default_line" ]; then
    ip route del $default_line 2>/dev/null \
      && echo "[vpnmgr] killswitch: đã bỏ default route qua eth0" \
      || echo "[vpnmgr] killswitch: không bỏ được default route"
  fi
}

SOCKD_CONF=/tmp/sockd.conf

# external: tun0 ép mọi kết nối đi ra bằng interface tunnel.
# Kể cả route trong container bị đổi, traffic vẫn không rơi ra ngoài VPN.
write_sockd_conf() {
  cat > "$SOCKD_CONF" <<SOCKDEOF
logoutput: stderr
internal: 0.0.0.0 port = $SOCKS_PORT
external: tun0
socksmethod: none
clientmethod: none
user.privileged: root
user.unprivileged: nobody

client pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    log: error
}
socks pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    socksmethod: none
    log: error
}
SOCKDEOF
}

# OpenVPN có thể kẹt vòng lặp "TUN/TAP: File descriptor in bad state" khi tun0 biến
# mất: process vẫn sống, container vẫn "Up", nhưng không gói tin nào qua được và nó
# KHÔNG bao giờ tự hồi. Watchdog thoát hẳn để extension dựng lại container sạch.
# Config có persist-tun nên tun0 tồn tại xuyên suốt các lần reconnect — mất tun0
# nghĩa là thật sự hỏng.
watchdog() {
  while kill -0 "$OVPN_PID" 2>/dev/null; do
    if ! ip link show tun0 >/dev/null 2>&1; then
      echo "[vpnmgr] LỖI: tun0 biến mất, thoát để được dựng lại"
      return 1
    fi
    sleep 10
  done
  echo "[vpnmgr] openvpn đã thoát"
  return 1
}

OVPN_PID=""
SOCKS_PID=""
FORWARD_PIDS=""
cleanup() {
  echo "[vpnmgr] nhận tín hiệu dừng, đang tắt..."
  if [ -n "$SOCKS_PID" ]; then kill "$SOCKS_PID" 2>/dev/null || true; fi
  for fp in $FORWARD_PIDS; do kill "$fp" 2>/dev/null || true; done
  if [ -n "$OVPN_PID" ]; then kill "$OVPN_PID" 2>/dev/null || true; fi
  exit 0
}
trap cleanup TERM INT

openvpn --config "$CONF" &
OVPN_PID=$!

# Chờ tun0 có địa chỉ IP -> tunnel thực sự up
i=0
while [ "$i" -lt "$READY_TIMEOUT" ]; do
  if ! kill -0 "$OVPN_PID" 2>/dev/null; then
    echo "[vpnmgr] LỖI: openvpn thoát sớm"
    exit 1
  fi
  if ip -4 addr show dev tun0 2>/dev/null | grep -q 'inet '; then
    echo "[vpnmgr] tun0 up: $(ip -4 addr show dev tun0 | grep 'inet ' | awk '{print $2}')"
    echo "[vpnmgr] default route: $(ip route show default | head -1)"
    write_sockd_conf
    sockd -f "$SOCKD_CONF" &
    SOCKS_PID=$!
    sleep 1
    if ! kill -0 "$SOCKS_PID" 2>/dev/null; then
      echo "[vpnmgr] LỖI: sockd không khởi động được"
      exit 1
    fi
    enable_killswitch
    start_forwards
    echo "VPNMGR_READY"
    watchdog
    exit $?
  fi
  i=$((i + 1))
  sleep 1
done

echo "[vpnmgr] LỖI: quá $READY_TIMEOUT giây mà tun0 chưa up"
exit 1
