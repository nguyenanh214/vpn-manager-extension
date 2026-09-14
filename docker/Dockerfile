# OpenVPN client + SOCKS5 proxy, cô lập trong network namespace của container.
# tun0 và default route chỉ tồn tại bên trong container -> routing table của host không bị đụng.
FROM alpine:3.20

RUN apk add --no-cache openvpn dante-server iproute2 socat

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
