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

| | Linux | macOS | Windows |
|---|---|---|---|
| Docker | chạy được không cần `sudo` | Docker Desktop | Docker Desktop |
| Node | >= 18 | >= 18 | >= 18 |
| Khác | `curl`, `/dev/net/tun` | — | PowerShell 5.1 (ship sẵn) |
| Tuỳ chọn | `nmcli` để import từ NetworkManager | — | — |

Trên Linux, thêm user vào group docker rồi đăng xuất/đăng nhập lại:

```bash
sudo usermod -aG docker $USER
```

Trên macOS và Windows, Docker chạy trong VM nên **host không có `/dev/net/tun`** —
đừng hoang mang nếu không thấy nó. Installer tự kiểm bằng cách tạo interface tun
*bên trong container*, đó mới là phép thử đúng.

> `brew install docker` trên macOS **chỉ cài CLI, không có daemon**. Cần
> `brew install --cask docker` hoặc tải Docker Desktop từ docker.com.

## Cài đặt

Ba bước, giống nhau ở cả ba hệ điều hành — chỉ khác lệnh ở bước 2.

**Bước 1.** Mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** →
chọn thư mục `extension/`. Copy **Extension ID** hiện trên thẻ.

> ID sinh từ đường dẫn thư mục nên **khác nhau giữa các máy**. Đừng dùng lại ID của
> máy khác.

**Bước 2.** Chạy installer tương ứng, kèm ID vừa copy:

```bash
# Linux
./scripts/install-linux.sh <extension-id>

# macOS
./scripts/install-macos.sh <extension-id>
```

```powershell
# Windows — -ExecutionPolicy Bypass là bắt buộc, policy mặc định chặn .ps1
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 <extension-id>
```

Installer chạy 6 bước: kiểm môi trường → dựng image → thử tạo interface tun trong
container → nhận ID → đăng ký native host → thử spawn host đúng như Chrome sẽ spawn.
Hỏng ở bước nào sẽ báo kèm hướng dẫn khắc phục cụ thể.

**Bước 3.** Quay lại `chrome://extensions`, bấm **Reload** trên VPN Manager. Bắt buộc,
service worker cần nạp lại.

### Cập nhật code

Chạy lại installer để dựng lại image, nhất là khi có thay đổi trong `docker/`. Tunnel
đang chạy sẽ dùng image mới ở lần dựng lại kế tiếp.

### Gỡ cài đặt

```bash
./scripts/uninstall-linux.sh      # hoặc uninstall-macos.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-windows.ps1
```

Gỡ sạch container, native host, image và thư mục state — kèm mọi file `.ovpn` đã import.

### Node cài qua nvm

Vẫn dùng được. Chrome spawn native host với PATH tối thiểu nên không tự thấy nvm;
installer ghi lại đường dẫn node tuyệt đối, và wrapper (`vpn-manager-host.sh` trên
Linux/macOS, `.bat` trên Windows) tự dò lại nếu đường dẫn đó đổi.

### Đã kiểm chứng tới đâu

| | Linux | macOS | Windows |
|---|---|---|---|
| Cài đặt | ✅ chạy thật | 🟡 chỉ chạy trong container bash 3.2 giả lập | ✅ Windows 11 + PS 5.1 |
| Gỡ cài đặt | ✅ | 🟡 giả lập | ✅ |
| Import `.ovpn`, bật domain | ✅ | ⬜ chưa chạy | ✅ |
| Port-forward | ✅ | ⬜ chưa chạy | ✅ |

macOS chưa ai chạy thật lần nào. Nếu bạn thử và gặp lỗi, mở issue — rất hữu ích.

## Sử dụng

### Thêm VPN

Tab **VPN** có ba cách, xếp theo mức tiện:

**`Import từ file .ovpn`** — nhanh nhất. Chọn file `.ovpn` do OpenVPN sinh ra, đặt tên,
xong. File phải **tự chứa** (có sẵn các khối `<ca>`, `<cert>`, `<key>` bên trong);
file trỏ tới cert bên ngoài hoặc cần username/password sẽ bị từ chối ngay lúc import
kèm lý do cụ thể, thay vì để lỗi lộ ra lúc bật domain.

**`Import từ NetworkManager`** — chỉ có trên **Linux**. Lấy sẵn gateway và đường dẫn
cert từ các connection OpenVPN đang có. Nút này tự ẩn trên macOS và Windows.

**`Thêm thủ công`** — nhập gateway và đường dẫn tới từng file `.pem`.

Nhấn **`Test`** để kiểm: extension bật tunnel, so IP thoát với IP thật, báo đỏ nếu
traffic không thực sự đi qua VPN.

### Chọn domain đi qua VPN

Tab **Domains** → `+ Thêm domain` → chọn VPN ở dropdown → gạt công tắc.

Thêm `example.com` thì `www.example.com` và mọi subdomain cũng đi qua VPN. Dán cả URL
đầy đủ cũng được, extension tự bóc lấy hostname.

Chưa chọn VPN mà gạt công tắc thì bị chặn kèm nhắc "Chọn VPN trước" — không có chuyện
bật nhầm rồi tưởng đang được bảo vệ.

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
