# VPN Manager Extension

Chrome extension định tuyến **từng domain** qua OpenVPN tunnel riêng, phần còn lại của
máy đi mạng bình thường. Extension không tự chạy VPN được (Chrome không có API đó) —
nó điều khiển một native messaging host bằng Node, host này quản lý container Docker
chạy OpenVPN client + SOCKS5 + port-forward.

Kiến trúc đầy đủ: [docs/system-architecture.md](docs/system-architecture.md)

## 🔴 Việc tiếp theo, nếu bạn đang chạy trên macOS

**Nhiệm vụ: test installer macOS lần đầu và sửa lỗi.** Giống hệt tình thế của Windows
một hôm trước: code viết từ máy Linux, **chưa chạy trên macOS thật lần nào**.

👉 [plans/.../phase-04-installer-macos.md](plans/260914-1343-cross-platform-va-ovpn-import/phase-04-installer-macos.md)

Luồng: `scripts/install-macos.sh <extension-id>` → load unpacked `extension/` →
Reload extension → import `.ovpn` → bật domain → kiểm IP. Gỡ ra làm lại bằng
`scripts/uninstall-macos.sh`.

Đọc [windows-test-handover.md](plans/260914-1343-cross-platform-va-ovpn-import/windows-test-handover.md)
trước — phần **cách debug** và **ràng buộc khi sửa** áp dụng nguyên cho macOS, chỉ
khác chỗ đăng ký native host (macOS thả file vào
`~/Library/Application Support/<browser>/NativeMessagingHosts/`, không phải registry).

Bài học Windows để lại, đáng ngờ ở macOS: bash mặc định của macOS là **3.2** (từ 2007)
— `install-macos.sh` đã bỏ mảng vì `DOCKER_ENV=()` + `set -u` vỡ ở đó, nhưng chưa chạy
thật lần nào. Và đừng tin `[ -c /dev/net/tun ]`: Docker chạy trong VM nên host macOS
không có device đó, phải thử `ip tuntap add` **bên trong container**.

Windows đã xong, không cần làm gì thêm ở đó. Máy Windows đang cài sẵn, extension id
`jjjlompfphjoakhblebcifjpliigghhf`.

## Trạng thái

| Phase | Trạng thái |
|---|---|
| 01 `docker cp` thay bind-mount | ✅ Linux |
| 02 Import file `.ovpn` | ✅ Linux |
| 03 Trừu tượng hoá OS | ✅ Linux |
| 04 Installer macOS | 🟡 code xong, chưa chạy trên macOS thật |
| 05 Installer Windows | ✅ Windows 11 + PS 5.1, kết nối thật chạy được |
| 06 Tài liệu | ⬜ chưa làm |

Kế hoạch: [plans/260914-1343-cross-platform-va-ovpn-import/plan.md](plans/260914-1343-cross-platform-va-ovpn-import/plan.md)

## Kiểm thử

122 test tự động, **phần lớn chỉ chạy được trên Linux** (cần bash + Chrome for Testing):

```bash
tests/run-all.sh              # tất cả
tests/run-all.sh platform     # một bộ
```

Hai bộ không cần trình duyệt lẫn Docker, chạy được ở bất cứ đâu có Node:

- `platform` (24 test) — giả lập cả ba OS
- `ovpn-store` (9 test) — dọn file .ovpn mồ côi, chạy trong sandbox bằng cách trỏ
  `APPDATA`/`HOME` vào thư mục tạm
- `prune-ovpn` (7 test) — cùng chức năng nhưng đi qua native host thật; cần Docker để
  kiểm chốt chặn, tự bỏ qua nếu đang có tunnel chạy

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
- **PowerShell 5.1 đọc `.ps1` không BOM bằng codepage ANSI**, không đoán UTF-8. Chữ
  tiếng Việt vỡ thành byte mà parser hiểu nhầm là dấu nháy, script chết ngay lúc parse
  với lỗi trỏ vào những dòng hoàn toàn bình thường. PS 7 không dính, nên test bằng
  `pwsh` sẽ không thấy. Mọi `.ps1` trong repo phải giữ BOM.
- **PS 5.1 bọc từng dòng stderr của native exe thành `ErrorRecord`.** Gặp
  `$ErrorActionPreference = 'Stop'` thì một dòng tiến trình bình thường của `docker`
  cũng giết script dù exit code là 0. Mọi lệnh native trong `.ps1` phải đi qua
  `Invoke-Native`.
- **Bộ đọc JSON của Chrome từ chối BOM.** Manifest native messaging ghi bằng
  `Set-Content -Encoding UTF8` (PS 5.1 luôn kèm BOM) làm Chrome báo "Specified native
  messaging host not found" — triệu chứng không gợi gì tới encoding.
- **Spawn native host là hẹn giờ dọn tunnel.** Host đóng stdin sẽ chờ grace 15s rồi
  `stopAll()`. Đừng spawn host để thử nghiệm khi user đang có tunnel chạy thật.
