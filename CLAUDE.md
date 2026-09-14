# VPN Manager Extension

Chrome extension định tuyến **từng domain** qua OpenVPN tunnel riêng, phần còn lại của
máy đi mạng bình thường. Extension không tự chạy VPN được (Chrome không có API đó) —
nó điều khiển một native messaging host bằng Node, host này quản lý container Docker
chạy OpenVPN client + SOCKS5 + port-forward.

Kiến trúc đầy đủ: [docs/system-architecture.md](docs/system-architecture.md)

## 🔴 Việc tiếp theo, nếu bạn đang chạy trên WINDOWS

Installer Windows **đã chạy thật lần đầu ngày 2026-09-14** và đã sửa 4 lỗi chặn
(xem [docs/project-changelog.md](docs/project-changelog.md)). Máy Windows này hiện
đã cài xong, extension id `jjjlompfphjoakhblebcifjpliigghhf`.

Chrome thật đã nối được tới native host qua popup: nút Import NetworkManager ẩn đúng
trên Windows, mà nó chỉ ẩn khi `check-prereqs` về tới popup kèm `os` — `call()` hỏng
thì trả `ok:false` và nút vẫn hiện.

Còn đúng một việc chưa kiểm được, **không phải vì code mà vì thiếu điều kiện**:

- **Traffic ra đúng IP VPN.** File `.ovpn` mẫu trỏ `vpn.example.net`, tên này chưa
  có bản ghi A — cả resolver Windows lẫn 1.1.1.1 đều trả lời rỗng. Đã loại trừ lỗi
  phía mình: cùng container đó resolve `one.one.one.one` bình thường. Cần server VPN
  lên mới kiểm được.

Runbook gốc (vẫn hữu ích cho phần debug và ràng buộc khi sửa):
[plans/260914-1343-cross-platform-va-ovpn-import/windows-test-handover.md](plans/260914-1343-cross-platform-va-ovpn-import/windows-test-handover.md)

## Trạng thái

| Phase | Trạng thái |
|---|---|
| 01 `docker cp` thay bind-mount | ✅ Linux |
| 02 Import file `.ovpn` | ✅ Linux |
| 03 Trừu tượng hoá OS | ✅ Linux |
| 04 Installer macOS | 🟡 code xong, chưa chạy trên macOS thật |
| 05 Installer Windows | 🟡 đã chạy thật, sửa 4 lỗi; còn chờ server VPN |
| 06 Tài liệu | ⬜ chưa làm |

Kế hoạch: [plans/260914-1343-cross-platform-va-ovpn-import/plan.md](plans/260914-1343-cross-platform-va-ovpn-import/plan.md)

## Kiểm thử

115 test tự động, **phần lớn chỉ chạy được trên Linux** (cần bash + Chrome for Testing):

```bash
tests/run-all.sh              # tất cả
tests/run-all.sh platform     # một bộ
```

Hai bộ không cần trình duyệt lẫn Docker, chạy được ở bất cứ đâu có Node:

- `platform` (24 test) — giả lập cả ba OS
- `ovpn-store` (9 test) — dọn file .ovpn mồ côi, chạy trong sandbox bằng cách trỏ
  `APPDATA`/`HOME` vào thư mục tạm

## Quy ước

- File code giữ **dưới 200 dòng**; bash script được miễn
- Tên file kebab-case
- Comment giải thích **tại sao**, không mô tả lại code
- Native host **zero dependency**, chỉ dùng thư viện chuẩn của Node
- Luôn `execFile`, **không bao giờ** `exec`/shell — mọi giá trị từ extension là input
  không tin cậy
- **Không bao giờ** lưu nội dung private key vào `chrome.storage`, chỉ lưu đường dẫn
- Commit theo conventional commits, tiếng Việt, không tham chiếu AI
- Chi tiết: [docs/code-standards.md](docs/code-standards.md)

## Bài học đã trả giá — đừng lặp lại

- **Chrome cache module service worker trong profile.** Sửa code rồi tái dùng profile
  cũ sẽ chạy bản CŨ dù file trên đĩa đã mới. `tests/launch-chrome.sh` xoá profile mỗi
  lần vì lý do này. Mất rất lâu mới tìm ra.
- **Chrome spawn native host với PATH tối thiểu**, không nạp shell profile. Node cài
  qua nvm sẽ không thấy được. Đó là lý do có wrapper `.sh`/`.bat` thay vì trỏ thẳng
  vào `.js`.
- **`pkill -f <pattern>` tự giết chính shell đang chạy** nếu pattern nằm trong command
  line của nó. Lọc theo tên process thay vì pattern.
- **Server VPN không bật `duplicate-cn`.** Hai client cùng certificate sẽ đá nhau; bên
  bị đá vẫn tưởng mình đang kết nối tới tận `ping-restart`. Đừng chạy hai tunnel cùng
  cert song song khi test.
