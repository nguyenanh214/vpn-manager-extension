# Bảo mật

Công cụ này đụng tới private key của VPN và định tuyến traffic của bạn, nên mô hình
đe doạ đáng đọc trước khi dùng — nhất là nếu bạn fork về và sửa.

## Báo lỗ hổng

**Đừng mở issue công khai cho lỗ hổng bảo mật.** Dùng
[Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
của GitHub trên repo này.

Đây là công cụ cá nhân, không có SLA. Tôi sẽ trả lời khi rảnh.

## Công cụ này bảo vệ được gì

- **Fail-closed hai tầng.** PAC không có fallback `DIRECT`: tunnel chết thì domain đó
  báo lỗi chứ không âm thầm rơi ra mạng thường. Trong container, killswitch xoá default
  route qua `eth0` sau khi tunnel lên — mất `tun0` là gói tin không còn đường ra.
- **Không lưu nội dung private key vào `chrome.storage`**, chỉ lưu đường dẫn. File
  `.ovpn` do user import được native host ghi ra đĩa với quyền `0600` (Linux/macOS)
  hoặc ACL chỉ cho user hiện tại (Windows).
- **Native messaging khoá theo extension ID.** Trang web hay extension khác không gọi
  được native host.
- **SOCKS5 và port-forward chỉ bind `127.0.0.1`**, máy khác trong LAN không dùng ké được.
- **Mọi lệnh docker dùng `execFile`, không qua shell**, và mọi đường dẫn từ extension
  đều qua `path-guard.js`.

## Công cụ này KHÔNG bảo vệ được gì

Đọc kỹ phần này nếu bạn định dựa vào nó cho việc quan trọng.

- **`chrome.storage.local` là plaintext trên đĩa.** Extension khác không đọc được
  (isolate theo extension ID), nhưng bất kỳ tiến trình nào chạy dưới tài khoản của bạn
  đều đọc được file đó. Đây là lý do chỉ lưu đường dẫn cert, không lưu nội dung.
- **Native host không có sandbox.** Nó chạy full quyền tài khoản của bạn. Nếu extension
  bị chiếm quyền thì native host cũng vậy.
- **Container chạy với `--cap-add=NET_ADMIN`.** Cần thiết để tạo tun. Không dùng
  `--privileged`, nhưng NET_ADMIN vẫn là quyền mạnh với network namespace của container.
- **Docker daemon chạy bằng root.** Ai vào được group `docker` thì coi như có root trên
  máy — đó là tính chất của Docker, không phải của công cụ này.
- **Không chống được kẻ tấn công đã ở trong máy bạn.**

## Hành vi cần biết, không phải lỗ hổng

- **Mở popup sẽ kiểm tra sức khoẻ tunnel và dựng lại nếu hỏng.** Container chạy không
  đồng nghĩa tunnel còn truyền được gói tin.
- **Đóng trình duyệt là tunnel bị dọn** sau 15 giây grace. Ứng dụng đang dùng
  port-forward sẽ mất kết nối.
- **Một certificate chỉ dùng được ở một nơi** nếu server không bật `duplicate-cn`. Hai
  máy cùng cert sẽ đá nhau; bên bị đá vẫn tưởng mình đang kết nối cho tới khi
  `ping-restart` kích hoạt.

## Nếu bạn fork

- **Giữ nguyên `.gitignore`.** Nó chặn `*.pem`, `*.key`, `*.crt`, `*.ovpn` — chủ ý,
  để bạn không vô tình commit certificate của mình.
- **Đổi native messaging host ID.** Mặc định là `com.andy.vpn_manager`, xuất hiện ở
  `extension/lib/constants.js`, `native-host/com.andy.vpn_manager.json.template`, và
  bốn script cài/gỡ. Hai fork cùng ID trên một máy sẽ ghi đè manifest của nhau.
- **Đừng gỡ killswitch để "cho tiện".** Nó là thứ chặn `socat` forward traffic ra ngoài
  VPN trong lúc tunnel sập. Khác với `sockd`, `socat` không ràng buộc interface.
- **Tự kiểm chứng.** Chạy `tests/run-all.sh` trên Linux, và tự so IP trước/sau khi bật
  domain. Đừng tin vào lời hứa của README, kể cả của tôi.

## Không có bảo đảm

Phần mềm này phát hành theo GPL-3.0, **không kèm bất kỳ bảo đảm nào** — xem phần 15 và
16 trong [LICENSE](LICENSE). Nó định tuyến traffic của bạn; nếu cấu hình sai hoặc có
lỗi, traffic bạn tưởng đang đi qua VPN có thể không đi qua. Trách nhiệm kiểm chứng là
của người dùng.
