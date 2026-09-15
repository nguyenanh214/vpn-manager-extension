# VPN Manager — Chrome Extension

Định tuyến **từng domain** qua OpenVPN tunnel riêng. Phần còn lại của trình duyệt
và của máy đi mạng bình thường.

Giải bài toán: bật VPN bằng NetworkManager đổi default route của cả máy, trong khi
chỉ vài domain thực sự cần VPN.

## Cách hoạt động

```
Chrome ──PAC──> domain trong list? ──> SOCKS5 127.0.0.1:1080 ──┐
                     └── không ──> DIRECT                      │
                                                               ├──> container
Navicat, DBeaver... ──> 127.0.0.1:13306 (port-forward) ────────┘     openvpn + sockd + socat
                                                                     tun0 nằm TRONG container
                                                          → routing table của host không bị đụng
```

Extension không tự chạy được VPN (Chrome không có API cho việc đó). Nó điều khiển
một native messaging host bằng Node, host này quản lý container Docker.

Chi tiết: [docs/system-architecture.md](docs/system-architecture.md).

## Yêu cầu

- Docker chạy được không cần sudo (`sudo usermod -aG docker $USER`, rồi đăng xuất vào lại)
- Node >= 18, `curl`, `/dev/net/tun`
- `nmcli` (tuỳ chọn — để import VPN có sẵn từ NetworkManager)

## Cài đặt

> Node cài qua **nvm** vẫn dùng được. Chrome spawn native host với PATH tối thiểu
> nên không tự thấy nvm — `install.sh` ghi lại đường dẫn node tuyệt đối, và wrapper
> `native-host/vpn-manager-host.sh` tự dò nếu đường dẫn đó đổi.


```bash
# 1. Load extension
#    chrome://extensions -> bật Developer mode -> Load unpacked -> chọn thư mục extension/
#    Copy Extension ID hiện trên thẻ

# 2. Chạy installer với ID vừa copy
./scripts/install.sh <extension-id>

# 3. Quay lại chrome://extensions, bấm Reload trên VPN Manager
```

Sau khi cập nhật code (nhất là trong `docker/`), chạy lại `./scripts/install.sh <id>`
để build lại image. Tunnel đang chạy sẽ dùng image mới ở lần dựng lại kế tiếp.

Gỡ: `./scripts/uninstall.sh`

## Sử dụng

**Tab VPN** → `Import từ NetworkManager` để lấy sẵn gateway và đường dẫn cert từ
các connection OpenVPN đang có. Hoặc `Thêm thủ công` rồi nhập gateway + đường dẫn
tới các file `.pem`.

Nhấn `Test` để kiểm tra: extension sẽ bật tunnel, so IP thoát với IP thật, và báo
đỏ nếu traffic không thực sự đi qua VPN.

**Tab Domains** → `+ Thêm domain`, chọn VPN ở dropdown, gạt công tắc. Thêm
`example.com` thì `www.example.com` và mọi subdomain khác cũng đi qua VPN.

Tunnel tự tắt khi đóng Chrome.

## Ứng dụng ngoài trình duyệt (Navicat, DBeaver, psql...)

PAC chỉ điều khiển Chrome, và phần lớn client database không nói được SOCKS5.
Dùng tab **Forward**: mở một cổng trên `127.0.0.1` chuyển tiếp qua tunnel.

Ví dụ với Navicat:

1. Tab **Forward** → `+ Thêm forward`
   - Tên: `MySQL nội bộ`
   - Cổng cục bộ: `13306` (tuỳ ý, tránh dải 1080-1179)
   - Host đích: địa chỉ MySQL **nhìn từ trong VPN**, vd `10.8.0.20`
   - Cổng đích: `3306`
2. Chọn VPN ở dropdown, gạt công tắc.
3. Trong Navicat, tab **General** của connection: Host = `127.0.0.1`, Port = `13306`.
   Không đụng tab SSL/SSH/HTTP, không cần cấu hình proxy.

> Hộp thoại **Options → Proxy** của Navicat KHÔNG dùng được cho việc này — nó chỉ
> áp dụng cho kích hoạt bản quyền, updater và Cloud/AI, đúng như dòng chữ đầu hộp thoại.

Forward sống theo extension: đóng Chrome là tunnel dừng và Navicat mất kết nối.

## Certificate chỉ dùng được ở một nơi

Server OpenVPN thường không bật `duplicate-cn`. Nếu **máy khác cũng đang bật VPN với
cùng certificate**, hai bên sẽ đá nhau liên tục: mỗi lần bên kia kết nối, bên này bị
ngắt nhưng vẫn tưởng mình còn kết nối trong tối đa 30 giây.

Triệu chứng: ứng dụng connect được lần đầu, lần sau timeout
(`2013 - Lost connection ... system error: 110`), rồi lại được, rồi lại hỏng.

Extension sẽ phát hiện và hiện chấm đỏ kèm lý do, đồng thời tự dựng lại tunnel khi
bạn mở popup. Nhưng cách sửa tận gốc là **tắt VPN ở máy kia**, hoặc xin admin cấp
certificate riêng cho từng máy.

## Bảo mật

Mô hình đe doạ đầy đủ — công cụ này bảo vệ được gì và **không** bảo vệ được gì — nằm
ở [SECURITY.md](SECURITY.md). Đọc trước khi dựa vào nó cho việc quan trọng.

Chi tiết kỹ thuật: [docs/system-architecture.md](docs/system-architecture.md) và
[docs/code-standards.md](docs/code-standards.md).

Tóm tắt: `chrome.storage.local` là **plaintext trên đĩa**, nên extension **chỉ lưu
đường dẫn** tới file cert, không lưu nội dung private key. Cert giữ nguyên tại chỗ
với quyền `0600`. Native host chạy full quyền user và không có sandbox, nên mọi path
từ extension đều được kiểm tra (tuyệt đối, trong `$HOME`, file thường, đọc được)
và mọi lệnh docker đều dùng `execFile` chứ không qua shell.

Fail-closed ở hai tầng. PAC **không có fallback `DIRECT`**: tunnel chết thì domain
đó báo lỗi rõ ràng thay vì âm thầm rơi ra mạng thường. Trong container, **killswitch**
xoá default route qua `eth0` sau khi tunnel lên — `tun0` mất thì gói tin không còn
đường ra. Cần thiết vì `socat` (dùng cho port-forward) không ràng buộc interface như
`sockd`, thiếu killswitch thì forward sẽ rò ra ngoài VPN lúc tunnel sập.

## Nếu bạn fork

Ba điều nên biết trước khi sửa:

- **Giữ nguyên `.gitignore`.** Nó chặn `*.pem`, `*.key`, `*.crt`, `*.ovpn` — chủ ý, để
  bạn không vô tình commit certificate của mình.
- **Đổi native messaging host ID.** Mặc định `com.andy.vpn_manager`, nằm ở
  `extension/lib/constants.js`, `native-host/com.andy.vpn_manager.json.template` và
  bốn script cài/gỡ. Hai fork cùng ID trên một máy sẽ **ghi đè manifest của nhau**.
- **Đừng gỡ killswitch để cho tiện.** Nó là thứ chặn port-forward rò traffic ra ngoài
  VPN lúc tunnel sập.

Chạy `tests/run-all.sh` trên Linux sau khi sửa. Đa số test cần bash và Chrome for
Testing; năm bộ chạy được trên cả ba OS, xem [CLAUDE.md](CLAUDE.md).

## Đóng góp

Đây là công cụ cá nhân, không phải sản phẩm có lộ trình.

**Issue thì cứ mở** — báo lỗi, hỏi cách dùng, góp ý đều hoan nghênh. Lỗ hổng bảo mật
thì đừng mở issue công khai, xem [SECURITY.md](SECURITY.md).

**Pull request có thể không được merge.** Không phải vì đóng góp không tốt, mà vì tôi
chưa có thời gian duy trì việc review. Fork về sửa cho hợp nhu cầu của bạn là cách
nhanh hơn — giấy phép cho phép hẳn hoi.

## Giấy phép

[GPL-3.0](LICENSE).

Tóm tắt không thay thế văn bản gốc: bạn được dùng, sửa và phân phối lại. Nếu bạn phát
hành bản đã sửa thì **phải mở mã nguồn theo cùng giấy phép này**. Không thể lấy code
này làm sản phẩm đóng.

Phần mềm phát hành **không kèm bất kỳ bảo đảm nào** (mục 15 và 16 của giấy phép). Nó
định tuyến traffic của bạn; nếu cấu hình sai hoặc có lỗi, traffic bạn tưởng đang đi qua
VPN có thể không đi qua. Tự kiểm chứng là trách nhiệm của người dùng.
