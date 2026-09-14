# Phase 06 — Tài liệu + checklist verify từng OS

**Ưu tiên:** Thấp (làm cuối) · **Trạng thái:** ⬜ Chưa làm
**Phụ thuộc:** Tất cả các phase trước

## Vì sao

README hiện tại viết cho Linux: đường dẫn `~/.config`, lệnh `usermod -aG docker`,
giả định có `nmcli`. Người dùng macOS/Windows đọc vào sẽ lạc ngay từ mục Yêu cầu.

Và vì phần macOS/Windows do user test chứ không phải tôi, cần checklist đủ cụ thể để
khi hỏng còn biết hỏng ở bước nào.

## Yêu cầu

- README có mục cài đặt riêng cho từng OS, không trộn lẫn
- Ghi rõ phần nào **đã kiểm chứng**, phần nào **chưa**
- Mục xử lý sự cố theo triệu chứng, không theo thành phần
- Checklist verify để user chạy trên máy của họ và báo lại

## Nội dung cần viết

### README — cấu trúc lại

```
Yêu cầu
  ├─ Linux    : docker (không sudo), node >= 18, /dev/net/tun
  ├─ macOS    : Docker Desktop, node >= 18
  └─ Windows  : Docker Desktop (ghi rõ backend), node >= 18, PowerShell

Cài đặt
  ├─ Linux/macOS : ./scripts/install.sh <extension-id>
  └─ Windows     : powershell -ExecutionPolicy Bypass -File scripts/install.ps1 <id>

Import VPN
  ├─ Từ file .ovpn  (khuyến nghị — import xong dùng luôn)
  ├─ Từ NetworkManager (chỉ Linux)
  └─ Điền thủ công
```

### Mục xử lý sự cố theo triệu chứng

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| "Native host has exited" | Node cài bằng nvm, Chrome không thấy → chạy lại installer |
| "Specified native messaging host not found" | Sai Extension ID, hoặc Windows chưa ghi registry |
| Import `.ovpn` báo lỗi directive | File cần `auth-user-pass` hoặc trỏ cert ngoài |
| Connect lần đầu OK, lần sau timeout | Máy khác dùng chung certificate |
| Tunnel không lên, log báo TUN | Docker Desktop không mượn được `/dev/net/tun` |

### Trạng thái kiểm chứng — phải trung thực

Bảng ghi rõ mỗi tính năng đã được verify trên OS nào, ví dụ:

| | Linux | macOS | Windows |
|---|---|---|---|
| Cài đặt | ✅ tự động | ⬜ chờ user | ⬜ chờ user |
| Import `.ovpn` | ✅ tự động | ⬜ | ⬜ |
| Port-forward | ✅ tự động | ⬜ | ⬜ |

Không được ghi ✅ cho ô mà tôi chưa có bằng chứng chạy thật.

## Checklist user chạy trên macOS / Windows

Đánh số để khi báo lỗi chỉ cần nói "hỏng ở bước 4":

1. `docker run --rm --cap-add=NET_ADMIN --device /dev/net/tun alpine ls -l /dev/net/tun`
   → phải in ra dòng `crw-rw-rw-`
2. Chạy installer → phải qua hết các bước kiểm tra, không lỗi
3. `chrome://extensions` → Load unpacked → lấy Extension ID
4. Chạy lại installer với ID → bước "thử spawn native host" phải pass
5. Mở popup → tab VPN → không có banner đỏ
6. Import `.ovpn` → profile hiện trong danh sách
7. Nhấn Test → hai IP phải **khác nhau**
8. Tab Domains → thêm domain → chọn VPN → bật → mở domain đó → IP phải là IP VPN
9. Mở một domain **ngoài** danh sách → IP phải là IP thật
10. Thêm forward → kết nối bằng client tương ứng
11. Đóng trình duyệt → sau ~15s `docker ps` không còn container `vpnmgr-*`

## File đụng tới

Sửa:
- `README.md` — cấu trúc lại theo OS
- `docs/system-architecture.md` — thêm mục khác biệt giữa các OS
- `docs/project-changelog.md` — mục cho bản mới
- `docs/development-roadmap.md` — Phase 8-13 tương ứng các phase ở đây

Tạo:
- `docs/troubleshooting.md` nếu mục xử lý sự cố trong README vượt ~40 dòng

## Todo

- [ ] README tách yêu cầu và cách cài theo OS
- [ ] Bảng trạng thái kiểm chứng, trung thực từng ô
- [ ] Mục xử lý sự cố theo triệu chứng
- [ ] Checklist đánh số cho macOS/Windows
- [ ] Cập nhật roadmap + changelog
- [ ] Đọc lại toàn bộ README bằng con mắt người chưa từng dùng repo này

## Tiêu chí hoàn thành

- Người dùng macOS đọc README làm theo được mà không phải đoán
- Không ô ✅ nào thiếu bằng chứng
- Mọi link trong docs trỏ đúng file

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Ghi ✅ cho thứ chưa chạy thử | Chỉ đánh dấu sau khi user báo kết quả cụ thể |
| README phình to khó đọc | Tách `docs/troubleshooting.md` khi vượt ngưỡng |
| Docs lệch code sau vài lần sửa | Cuối mỗi phase cập nhật changelog ngay, không dồn |
