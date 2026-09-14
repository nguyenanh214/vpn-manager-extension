# Cross-platform + Import .ovpn

Chạy được trên Linux, macOS, Windows bằng một lệnh cài duy nhất cho mỗi OS.
Thêm nút import file `.ovpn` để dùng thẳng, khỏi điền tay từng đường dẫn cert.

## Bối cảnh

Bản hiện tại chỉ chạy Linux. Bốn chỗ chặn cứng:

| Vấn đề | Hệ quả |
|---|---|
| `DOCKER_ENV=()` + `set -u` | `install.sh` **vỡ ngay** trên macOS (bash 3.2 mặc định) |
| Check `/dev/net/tun` trên host | Sai trên macOS/Windows — Docker chạy trong VM, host không có device |
| Native host là `.sh` | Windows không chạy được; Chrome cần `.bat` + **registry** thay vì thư mục manifest |
| `bind-mount` cert | Vướng dịch đường dẫn `C:\Users\...` trên Windows |

## Quyết định đã chốt

1. **`docker cp` thay `bind-mount`** — bỏ hẳn dịch đường dẫn, giống nhau trên cả 3 OS.
2. **`<input type="file">`** cho import `.ovpn` — Chrome không cho extension biết đường
   dẫn thật, nên bắt buộc đọc nội dung rồi để native host ghi ra đĩa với quyền 0600.
3. User có **cả macOS lẫn Windows** để test theo checklist từng phase.

## Rủi ro lớn nhất — đã gỡ một nửa

Toàn bộ kiến trúc phụ thuộc vào `--device /dev/net/tun` hoạt động trong Docker Desktop.

| OS | Kết quả | Ngày |
|---|---|---|
| Linux | ✅ chạy thật, tunnel lên được | 2026-09-14 |
| macOS | ✅ `TUN_OK` — tạo được interface tun, không chỉ thấy device | 2026-09-14 |
| Windows | ✅ `TUN_OK` — WSL2 backend, Docker 29.8.0 | 2026-09-14 |

**Cả ba OS đều xác nhận tạo được interface tun.** Kiến trúc hiện tại dùng được,
không phải thiết kế lại phần nào.

Các lệnh cần chạy trên Windows: [windows-smoke-test.md](windows-smoke-test.md)

Máy dev là Linux. Phần macOS/Windows là code **chưa chạy thử** cho tới khi user test.

## Phase

| # | Phase | Trạng thái | Verify ở đâu |
|---|---|---|---|
| 01 | [docker cp thay bind-mount](phase-01-docker-cp.md) | ✅ Xong | Linux (60 test pass) |
| 02 | [Import file .ovpn](phase-02-ovpn-import.md) | ⬜ Chưa làm | Linux (tự động) |
| 03 | [Trừu tượng hoá OS](phase-03-os-abstraction.md) | ⬜ Chưa làm | Linux + smoke test 3 OS |
| 04 | [Installer macOS](phase-04-installer-macos.md) | ⬜ Chưa làm | macOS (user) |
| 05 | [Installer Windows](phase-05-installer-windows.md) | ⬜ Chưa làm | Windows (user) |
| 06 | [Tài liệu + checklist](phase-06-docs.md) | ⬜ Chưa làm | Đọc lại |

## Phụ thuộc

- 01 phải xong trước 02 (import .ovpn dùng cơ chế `docker cp` của 01)
- 01, 02 verify xong trên Linux mới sang 03
- 03 phải xong trước 04, 05 (installer dựa vào module `platform.js`)
- 04 và 05 độc lập, làm song song được

## Điều kiện hoàn thành

- Một lệnh cài cho mỗi OS, tự kiểm tra Docker và báo lỗi kèm hướng dẫn khắc phục
- Import `.ovpn` xong là dùng được ngay, không cần điền gì thêm
- Luồng điền tay giữ nguyên, không hồi quy
- 60 test hiện có vẫn pass trên Linux

## Chờ user

File `.ovpn` mẫu (che phần key) để chốt chi tiết parser ở Phase 02.
