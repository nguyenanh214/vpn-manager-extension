# Kiến trúc hệ thống

## Bài toán

Máy Ubuntu dùng OpenVPN cert-based qua NetworkManager. Bật VPN bằng NetworkManager
sẽ **đổi default route của toàn máy** → mọi traffic (dev server, docker, apt, git…)
đều chui qua tunnel. Nhưng thực tế chỉ vài domain cần VPN.

## Ràng buộc của Chrome (đã xác minh, không thể lách)

| Điều | Thực tế |
|---|---|
| Extension tạo VPN tunnel | **Không thể.** Không có API TUN/raw socket. `chrome.vpnProvider` chỉ có trên ChromeOS. |
| Proxy riêng cho từng tab | **Không thể.** `chrome.proxy` là per-profile. |
| Proxy riêng cho từng domain | **Được** — PAC script, `FindProxyForURL(url, host)` chạy cho mỗi request. |
| Điều khiển process trên máy | Chỉ qua **Native Messaging**. |

Hệ quả: route theo **domain** (PAC), không phải theo tab. Trên thực tế điều này
tốt hơn — một tab tải tài nguyên từ nhiều domain, mỗi domain được định tuyến riêng.

## Sơ đồ

```
┌─ Chrome ────────────────────────────────┐
│  popup (2 tab)                          │
│  service worker ── chrome.proxy(PAC) ───┼──> domain trong list?
│        │                                │      ├ có  → SOCKS5 127.0.0.1:108N
│        │ native messaging (stdio)       │      └ không → DIRECT (mạng thường)
└────────┼────────────────────────────────┘
         ▼
   native host (Node, zero dependency)
         │ docker CLI (execFile, không qua shell)
         ▼
   container vpnmgr-<profileId>  [NET_ADMIN + /dev/net/tun]
   ├─ openvpn client ──> tun0 + default route  ← CHỈ TỒN TẠI TRONG CONTAINER
   ├─ sockd (dante) :1080, external = tun0
   └─ /certs/*.pem (bind-mount read-only từ ~/.cert/)
```

**Điểm mấu chốt:** `tun0` và `0.0.0.0/1 via tun0` nằm trong network namespace của
container. Routing table của host **không bị đụng**. Đây là thứ thay thế việc bật
VPN toàn máy.

## Luồng bật một domain

1. Popup gửi `toggle-domain` tới service worker.
2. Nếu domain chưa gán VPN → trả lỗi `Chọn VPN trước`, **không** bật.
3. `reconciler.reconcile()` tính tập VPN cần chạy từ các domain đang bật.
4. Gửi `sync-tunnels` tới native host: dừng container thừa, khởi động container thiếu.
5. Native host chờ container in marker `VPNMGR_READY` (timeout 45s).
6. **Chỉ sau khi tunnel sẵn sàng** mới sinh PAC và gọi `chrome.proxy.settings.set`.

Thứ tự bước 5→6 là bắt buộc. Ngược lại Chrome sẽ trỏ request vào cổng SOCKS chưa ai nghe.

## Fail-closed

PAC **không có fallback `; DIRECT`**. Nếu tunnel chết, domain đó fail bằng
`ERR_PROXY_CONNECTION_FAILED` thay vì âm thầm đi ra mạng thường. Tương tự, khi
`sync-tunnels` báo một profile lỗi, domain của profile đó **vẫn nằm trong PAC**
trỏ vào cổng đã chết — có chủ đích, để không lộ traffic.

## Native messaging protocol

4 byte length (little-endian) + JSON UTF-8, tối đa 1MB mỗi message.

Request `{ id, action, payload }` → Response `{ id, ok, data | error }`.

| Action | Mục đích |
|---|---|
| `ping` / `check-prereqs` | Kiểm tra host, docker, image, curl, nmcli |
| `list-nm-profiles` | Đọc connection OpenVPN từ NetworkManager |
| `check-paths` | Xác nhận file cert tồn tại + đọc được |
| `start-tunnel` / `stop-tunnel` / `tunnel-status` / `tunnel-logs` | Điều khiển một tunnel |
| `sync-tunnels` | Đưa tập tunnel đang chạy về đúng tập yêu cầu |
| `test-connection` | Bật tunnel, so IP thoát với IP thật |
| `stop-all` | Dọn toàn bộ, dùng lúc shutdown |

## Vòng đời

### Khi nào host được spawn

Chrome spawn host ở **hành động đầu tiên** cần tới nó, không phải lúc mở trình duyệt:

| Tình huống | Host |
|---|---|
| Mở trình duyệt, không domain nào bật, không mở popup | không spawn |
| Mở popup (gọi `check-prereqs`) | spawn |
| Đóng popup | **vẫn sống** |
| Mở trình duyệt khi có domain đang bật (`onStartup` → `reconcile`) | spawn, không cần popup |
| Đóng trình duyệt | thoát sau grace, tunnel bị dọn |

**Đã đo:** port native messaging đang mở **giữ cho MV3 service worker không bị kill**.
Host sống suốt phiên trình duyệt (đo được >3 phút sau khi đóng popup, vẫn chạy), chứ
không chết sau ~30s idle như hành vi mặc định của service worker.

### Vì sao vẫn cần grace period

Dù trường hợp thường gặp là host sống hết phiên, stdin EOF vẫn có thể xảy ra mà Chrome
chưa đóng: reload extension, extension crash, service worker bị kill trong tình huống
biên. Nhìn từ phía process, những trường hợp đó **giống hệt** Chrome đóng hẳn.

`lifecycle-lock.js` giải quyết bằng registry pid tại `~/.config/vpn-manager/hosts/`:
- Host khởi động ghi file tên là pid của mình.
- Khi stdin EOF → đợi **15s grace** → gỡ đăng ký → đếm các host khác còn sống
  (`process.kill(pid, 0)`, entry của process đã chết bị dọn luôn).
  - Còn host khác sống → chỉ là SW restart, hoặc trình duyệt khác vẫn đang dùng →
    thoát im lặng, tunnel giữ nguyên.
  - Không còn host nào → trình duyệt cuối cùng đã đóng → `docker rm -f` mọi container `vpnmgr-*`.

Đếm host thay vì dùng một lock toàn cục là bắt buộc khi có nhiều trình duyệt hoặc
nhiều Chrome profile cùng chạy extension: với lock đơn, host thoát sau sẽ giết tunnel
của trình duyệt vẫn đang mở.

**Giới hạn đã biết:** nhiều profile cùng dùng extension sẽ tranh nhau qua `sync-tunnels`
— profile này có thể dừng tunnel mà profile kia vừa dựng. Công cụ cá nhân, một trình
duyệt, nên chấp nhận được.

## Port-forward (tab Forward)

PAC chỉ điều khiển được Chrome. Ứng dụng desktop không đi qua PAC, và phần lớn
client database **không nói được SOCKS5** — Navicat 17 chẳng hạn: trong binary chỉ
có `CURLPROXY_SOCKS5` (libcurl, dùng cho HTTP), còn kết nối MySQL là TCP thô nên
không có đường ép qua proxy.

Giải pháp là port-forward: container mở một cổng TCP trên `127.0.0.1`, `socat`
chuyển tiếp qua tunnel tới `host:port` bên trong VPN.

```
Navicat ──> 127.0.0.1:13306 ──> [container: socat ──> tun0] ──> 10.8.0.20:3306
```

Client chỉ cần trỏ host về `127.0.0.1` và đổi port. Không cấu hình proxy, hoạt động
với mọi ứng dụng.

**Ràng buộc:** cổng publish của Docker chỉ đặt được **lúc tạo container**. Thêm, sửa
hay xoá forward đều buộc phải dựng lại tunnel. `docker-driver.signatureOf(profile)`
băm toàn bộ cấu hình (gateway, cert, cổng SOCKS, danh sách forward) và gắn vào
container qua nhãn `vpnmgr.signature`. `start()` so nhãn của container đang chạy với
signature mong muốn: giống thì dùng lại, khác thì dừng và dựng lại.

**Chỉ một tunnel cho mỗi cert.** Đã đo: server VPN không bật `duplicate-cn` — chạy
hai container cùng cert thì cả hai nhận cùng IP `10.8.0.4` và cái đầu tiên hỏng.
Vì vậy forward và domain **dùng chung** một container cho mỗi VPN profile, thay vì
mỗi thứ một tunnel riêng. `requiredProfiles()` gộp domain và forward đang bật lại
rồi mới quyết định tunnel nào cần chạy.

**Hệ quả về vòng đời:** forward sống theo extension. Đóng Chrome là tunnel bị dọn và
client mất kết nối.

## Tunnel chết mà không báo

Container chạy **không** đồng nghĩa tunnel còn truyền được gói tin. Khi server đá
client (thường do một máy khác dùng cùng certificate), `tun0` vẫn up, route vẫn đúng,
OpenVPN vẫn tưởng mình đang kết nối — và mọi thứ im lặng cho tới khi `ping-restart`
kích hoạt. Đã quan sát thực tế: log của client cho thấy 4 lần
`Inactivity timeout (--ping-restart), restarting` trong chưa tới 10 phút.

Bốn lớp phòng thủ:

| Cơ chế | Nơi | Tác dụng |
|---|---|---|
| `explicit-exit-notify 1` | config OpenVPN | Client thoát thì server giải phóng session ngay, không treo tới 120s |
| `pull-filter ignore "ping-restart"` + `ping-restart 30` | config OpenVPN | Server push 120s; ép xuống 30s để tự hồi nhanh gấp 4 lần |
| `docker stop -t 5` trước `rm` | `docker-driver.stop()` | SIGTERM cho trap chạy, OpenVPN kịp gửi exit-notify. `rm -f` thẳng sẽ SIGKILL và server giữ session cũ, đụng với container vừa dựng lại |
| `watchdog()` | entrypoint | Thoát container khi `tun0` biến mất. OpenVPN có thể kẹt vòng lặp `File descriptor in bad state` và **không bao giờ tự hồi** |

`docker-driver.health()` kiểm tra thật: `tun0` phải tồn tại, rồi ping gateway tunnel,
rồi TCP tới `1.1.1.1:53` (không phụ thuộc ICMP). Chỉ báo hỏng khi cả hai phép đều
thất bại. Popup gọi nó mỗi lần mở; tunnel hỏng sẽ bị dừng và dựng lại, đồng thời hiện
chấm đỏ kèm lý do thay vì chấm xanh giả.

**Kiểm tra `tun0` trước là bắt buộc.** Nếu `tun0` mất, default route rơi về `eth0` và
phép thử TCP sẽ đi ra mạng thường rồi báo "khoẻ" sai — đã kiểm chứng là có thật.

## Killswitch

Sau khi tunnel lên, entrypoint **xoá default route qua `eth0`**. OpenVPN đã định tuyến
toàn bộ qua `0.0.0.0/1` + `128.0.0.0/1` trên `tun0`, và giữ riêng host route tới server
VPN qua `eth0` nên vẫn kết nối lại được.

Nếu `tun0` biến mất, hai route `/1` mất theo và gói tin **không còn đường ra** — thay vì
âm thầm đi ra mạng thường. Cùng triết lý fail-closed với PAC.

Quan trọng với `socat`: khác `sockd` (có `external: tun0`), `socat` không ràng buộc
interface nên nếu không có killswitch, forward sẽ rò ra ngoài VPN trong lúc tunnel sập.
Đã kiểm chứng: xoá `tun0` thủ công → cả forward lẫn SOCKS đều thất bại, không lần nào
lọt ra IP thật.

## Khởi động native host

Chrome spawn native messaging host với **PATH tối thiểu** (`/usr/bin:/bin`) và
**không nạp shell profile**. Node cài qua nvm/fnm/volta nằm ngoài PATH đó, nên
shebang `#!/usr/bin/env node` sẽ thất bại với exit 127 — Chrome chỉ báo mỗi
"Native host has exited", không nói lý do.

Vì vậy manifest trỏ tới wrapper `vpn-manager-host.sh`, không trỏ thẳng vào `.js`.
Wrapper dò node theo thứ tự: biến `VPN_MANAGER_NODE` → `~/.config/vpn-manager/node-path`
(do `install.sh` ghi, chạy trong shell có nvm) → `PATH` hiện tại → thư mục
nvm/fnm/volta (chọn bản mới nhất theo `sort -V`) → các vị trí hệ thống thường gặp.

`install.sh` có bước cuối spawn host bằng `env -i PATH=/usr/bin:/bin` đúng như Chrome
làm, và fail ngay nếu host không khởi động được.

## Cổng SOCKS5

Mỗi VPN profile được cấp một cổng riêng trong dải **1080–1179** khi thêm vào
(`allocateSocksPort`). Nhiều tunnel chạy song song được. Cổng chỉ publish ở
`127.0.0.1`, máy khác trong LAN không dùng ké được.
