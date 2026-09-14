# Changelog

## 1.3.0 — 2026-09-14

### Thay đổi
- Cert vào container bằng `docker cp` thay vì bind-mount. Docker CLI tự đọc file bằng
  API của OS nên không còn khâu dịch đường dẫn — điều kiện cần để chạy trên Windows.
- `signatureOf` băm **nội dung** cert thay vì đường dẫn. Với bind-mount, sửa cert có
  hiệu lực ngay; với `docker cp`, nội dung được sao lúc tạo container nên nếu vẫn băm
  đường dẫn thì đổi cert sẽ không dựng lại container và tunnel chạy tiếp bằng cert cũ.
- Thư mục cert trong container đổi `/certs` → `/config`.
- Bộ test chuyển vào `tests/` trong repo, chạy bằng `tests/run-all.sh`.

### Đã kiểm chứng
- 60/60 test pass
- Sửa nội dung cert (giữ nguyên tên file) làm signature đổi → container dựng lại
- `docker cp` hoạt động với đường dẫn Windows (`C:\Users\...`), đã test trên máy thật

## 1.2.0 — 2026-09-14

Xử lý tunnel chết im lặng. Triệu chứng người dùng gặp: Navicat connect lần đầu OK,
lần hai lỗi `2013 - Lost connection at 'handshake: reading initial communication
packet', system error: 110`.

### Nguyên nhân
Một máy khác dùng **cùng certificate**. Server không bật `duplicate-cn` nên đá phiên
cũ. Client bị đá vẫn giữ `tun0` up và route đúng, không hay biết gì cho tới khi
`ping-restart` (server push 120s) kích hoạt. Trong 2 phút đó UI báo chấm xanh còn
mọi kết nối thì timeout.

### Sửa
- `explicit-exit-notify 1` — client thoát thì server giải phóng session ngay.
- `pull-filter ignore "ping-restart"` + `ping-restart 30` — tự hồi sau 30s thay vì 120s.
- `docker stop -t 5` trước `rm -f` — SIGTERM cho OpenVPN thoát sạch; trước đây
  `rm -f` SIGKILL khiến dựng lại container tự đụng session cũ của chính mình.
- `watchdog()` trong entrypoint — thoát container khi `tun0` biến mất. Đã quan sát:
  OpenVPN kẹt vòng lặp `TUN/TAP: File descriptor in bad state` vô hạn, container mãi
  "Up" nhưng chết bên trong.
- `docker-driver.health()` + action `tunnel-health` — kiểm tra thật thay vì chỉ
  `docker ps`. Popup gọi mỗi lần mở, tunnel hỏng thì dừng và dựng lại tự động.
- **Killswitch**: xoá default route qua `eth0` sau khi tunnel lên. Không có nó,
  `socat` (khác `sockd`, không ràng buộc interface) sẽ forward ra mạng thường trong
  lúc tunnel sập — đã kiểm chứng là rò thật.

### Đã kiểm chứng
- Xoá `tun0` thủ công → forward và SOCKS đều thất bại, không lọt ra IP thật lần nào.
- Watchdog thoát container trong ~10s.
- `health()` không bị đánh lừa khi `tun0` mất mà `eth0` vẫn có internet.

## 1.1.0 — 2026-09-14

Tab **Forward**: mở cổng TCP trên `127.0.0.1` chuyển tiếp qua tunnel, cho ứng dụng
desktop không hỗ trợ SOCKS5 (Navicat, DBeaver, psql...) dùng chung VPN với trình duyệt.

### Tính năng
- Tab thứ 3 với CRUD forward: thêm, sửa, xoá, bật/tắt, gán VPN.
- Validate: cổng cục bộ 1024-65535, chặn dải SOCKS 1080-1179, chặn trùng cổng,
  host đích phải là hostname/IPv4 hợp lệ.
- Bật khi chưa chọn VPN → báo "Chọn VPN trước", giống tab Domains.
- `socat` trong container thực hiện forward; `VPN_FORWARDS` truyền danh sách quy tắc.
- Nhãn `vpnmgr.signature` cho phép phát hiện cấu hình đổi và dựng lại container.
- Xoá VPN đang được forward dùng sẽ cảnh báo, liệt kê cả domain lẫn forward.

### Ghi chú kỹ thuật
- Server VPN không bật `duplicate-cn` (đã đo: hai container cùng cert → cùng IP
  10.8.0.4, cái đầu hỏng). Nên forward và domain dùng chung một tunnel cho mỗi profile.
- Navicat không hỗ trợ SOCKS5 cho kết nối DB — chỉ có `CURLPROXY_SOCKS5` cho HTTP.
  Đó là lý do chọn port-forward thay vì proxy.

### Lỗi đã sửa
- `update-forward` nhận nguyên object từ payload nên một object cũ mang `vpnId: null`
  âm thầm gỡ VPN khỏi forward, khiến reconcile dừng tunnel. Giới hạn còn 4 field
  được sửa, `vpnId`/`enabled` chỉ đổi qua action riêng.
- Route forward xuống nhiều dòng làm hàng quá cao; ép một dòng cắt bằng ellipsis.

## 1.0.0 — 2026-09-14

Phiên bản đầu. Định tuyến từng domain qua OpenVPN tunnel cô lập, không đụng
routing table của máy.

### Tính năng
- Popup 2 tab, giữ nguyên trạng thái (tab đang mở, form đang gõ dở) giữa các lần mở.
- Tab Domains: danh sách domain + chọn VPN + công tắc bật/tắt, cuộn khi dài.
  Bật khi chưa chọn VPN → báo "Chọn VPN trước", công tắc tự trả về off.
- Tab VPN: import từ NetworkManager (`nmcli`), thêm thủ công, nút test kết nối.
  Test so IP thật với IP qua tunnel, phát hiện trường hợp traffic không qua VPN.
- Validate domain: bóc scheme/path/port/`*.`/dấu chấm cuối, từ chối trùng và sai định dạng.
- Tunnel tự tắt khi Chrome đóng (grace 15s để không nhầm với service worker restart).

### Quyết định kỹ thuật
- **PAC script thay vì per-tab proxy** — `chrome.proxy` là per-profile, không có API per-tab.
- **OpenVPN trong Docker container** — `tun0` và default route bị giới hạn trong
  network namespace của container, host không bị ảnh hưởng.
- **dante-server (sockd)** thay cho microsocks — microsocks không có trong repo Alpine.
  `external: tun0` còn ép egress đi đúng tunnel kể cả khi route trong container đổi.
- **Chỉ lưu đường dẫn cert**, không lưu nội dung — `chrome.storage.local` là plaintext trên đĩa.

### Lỗi đã sửa trong quá trình phát triển
- `set -eu` + `[ -n "$X" ] && echo` trong entrypoint làm script thoát khi biến rỗng.
- `docker ps -q --format '{{.Names}}'` — `-q` ghi đè `--format`, trả về ID thay vì tên,
  khiến container mồ côi không bao giờ được dọn và giữ cổng SOCKS.
- `reconcile` loại domain khỏi PAC khi tunnel lỗi → domain âm thầm đi ra mạng thường.
  Chuyển sang fail-closed: giữ trong PAC để request fail rõ ràng.
- CSS `display:flex` đè `[hidden]{display:none}` → cả hai tab và modal rỗng hiện cùng lúc.
- `.panel` thiếu `min-width:0` → flex item không co được dưới chiều rộng nội dung,
  tràn ngang 71px làm mất công tắc và nút xoá.
- `text-overflow: ellipsis` đặt trên flex container không có tác dụng, phải đặt trên phần tử con.
- `#!/usr/bin/env node` chết với exit 127 khi Chrome spawn host: Chrome cấp PATH tối thiểu
  và không nạp shell profile, nên không thấy node cài qua nvm. Chrome chỉ báo
  "Native host has exited" không kèm lý do. Sửa bằng wrapper `.sh` tự dò node,
  cộng bước tự kiểm tra spawn trong `install.sh`.
- Lock file toàn cục không chịu được nhiều host cùng lúc (2 trình duyệt / 2 Chrome profile):
  host thoát trước bỏ qua dọn dẹp vì tưởng bị host khác chiếm lock, còn host thoát sau
  thì giết tunnel của trình duyệt vẫn đang mở. Thay bằng registry pid — chỉ host cuối
  cùng còn sống mới được dọn.
