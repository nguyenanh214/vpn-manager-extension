# Runbook: test installer Windows lần đầu

**Dành cho:** phiên Claude Code chạy trên máy Windows của user.
**Mục tiêu:** chạy được extension trên Windows, sửa lỗi phát sinh.
**Trạng thái:** code đã viết xong nhưng **chưa chạy thử lần nào trên Windows**.

Toàn bộ phần Windows viết từ máy Linux dựa trên tài liệu Chrome/Docker, nên nhiều khả
năng có lỗi. Việc của bạn là tìm và sửa.

---

## Môi trường máy này — đã khảo sát, KHÔNG cần hỏi lại user

Đã chạy smoke test đầy đủ ngày 2026-09-14:

| Mục | Giá trị |
|---|---|
| Docker | 29.8.0, Docker Desktop, backend **WSL2** |
| TUN | ✅ `ls` thấy device **và** `ip tuntap add` thành công (`TUN_OK`) |
| Publish `127.0.0.1` | ✅ HTTP 200 |
| `docker cp` với đường dẫn Windows | ✅ hoạt động |
| Node | v24.21.0 tại `C:\Program Files\nodejs\node.exe` (**không** phải nvm) |
| Trình duyệt | Chrome + Edge (không có Brave/Chromium) |
| PowerShell | **5.1** — không phải PS7 |
| ExecutionPolicy | mọi scope `Undefined` → mặc định `Restricted` |
| `%APPDATA%` | `C:\Users\Andy\AppData\Roaming` |

Nghĩa là **nền tảng đã chứng minh chạy được**. Nếu hỏng thì hỏng ở code của chúng ta,
không phải ở Docker hay kernel.

---

## Luồng cần chạy

### 1. Load extension, lấy ID

1. `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `extension` trong repo
3. Copy **Extension ID**

> ID trên Windows **khác** ID trên Linux vì Chrome sinh ID từ đường dẫn thư mục.
> Phải copy ID thật, đừng dùng lại `fkmekgedgclilahepbobamfabndfnjfh` của máy Linux.

### 2. Chạy installer

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 <extension-id>
```

`-ExecutionPolicy Bypass` là **bắt buộc** (policy của máy là `Restricted`).

Installer làm 6 bước:
1. Kiểm docker + node
2. Dựng image + **thử tạo interface tun trong container**
3. Nhận Extension ID
4. Ghi manifest ra `%LOCALAPPDATA%\vpn-manager\` + ghi **registry HKCU**
5. Tạo `%APPDATA%\vpn-manager` + `icacls` + ghi `node-path`
6. **Thử spawn native host đúng như Chrome sẽ spawn**

### 3. Reload extension

`chrome://extensions` → **Reload** trên VPN Manager. Bắt buộc, service worker cần nạp lại.

### 4. Dùng thử

- Tab **VPN** → `Import từ file .ovpn` → chọn file → đặt tên → nhấn **Test**
  → hai IP phải khác nhau
- Tab **Domains** → thêm domain → chọn VPN → gạt công tắc → mở domain đó, kiểm IP
- Tab **Forward** → thêm forward → kiểm bằng client tương ứng

### Gỡ ra làm lại

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-windows.ps1
```

---

## Chỗ nhiều khả năng hỏng nhất

Xếp theo mức độ nghi ngờ:

| # | Triệu chứng | Nghi ngờ | Kiểm thế nào |
|---|---|---|---|
| 1 | Popup báo **"Native host has exited"** | `.bat` in gì đó ra stdout làm hỏng giao thức native messaging | Chạy `native-host\vpn-manager-host.bat < NUL` trong cmd, stdout phải **hoàn toàn trống** |
| 2 | Bước 6 báo host không khởi động | `.bat` dò node sai, hoặc `set /p` đọc `node-path` lỗi | `type %APPDATA%\vpn-manager\node-path` xem có đúng đường dẫn không |
| 3 | Popup báo **"Specified native messaging host not found"** | Registry ghi sai khoá, hoặc sai Extension ID trong manifest | `reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.andy.vpn_manager"` |
| 4 | Lỗi cú pháp PowerShell ngay dòng đầu | Lỡ dùng cú pháp PS7 ở đâu đó | Đọc kỹ thông báo lỗi, tìm `??`, ternary `? :` |
| 5 | Manifest có đường dẫn sai | JSON cần escape backslash thành `\\` | `type %LOCALAPPDATA%\vpn-manager\com.andy.vpn_manager.json` |
| 6 | Tunnel lên nhưng traffic không qua | `docker cp` hoặc đường dẫn `/config` trong container | `docker logs vpnmgr-<id>` |

### Về `.bat` — điểm dễ sai nhất

`native-host\vpn-manager-host.bat` phải tuân thủ nghiêm ngặt:

- **`@echo off` ở dòng đầu.** Thiếu là cmd in lại từng lệnh ra stdout, Chrome nhận rác
  ở đầu stream native messaging rồi ngắt kết nối ngay.
- **Không `echo` nào ra stdout.** Mọi thông báo phải `>&2`.
- **ASCII không dấu.** cmd chạy codepage 437/1258; tiếng Việt có dấu thành ký tự rác.
- **CRLF.** `.gitattributes` đã ép, nhưng kiểm lại nếu `goto` hành xử lạ.

---

## Ràng buộc bắt buộc khi sửa

1. **PowerShell 5.1 only.** Không dùng ternary `? :`, `??`, `??=`,
   `ForEach-Object -Parallel`, `ConvertFrom-Json -AsHashtable`, `Test-Json`.
   Viết cho 5.1 thì chạy được cả trên 7; ngược lại 5.1 báo lỗi ngay dòng đầu.

2. **Không được làm hỏng Linux/macOS.** 106 test tự động **chỉ chạy trên Linux**.
   Bạn không chạy được chúng từ Windows. Vì vậy:
   - Ưu tiên sửa ở file **chỉ Windows dùng**: `install-windows.ps1`,
     `uninstall-windows.ps1`, `vpn-manager-host.bat`
   - Nếu buộc phải sửa file dùng chung (`native-host/lib/*.js`,
     `scripts/lib/*.sh`), **ghi rõ vào commit message** để phiên Linux chạy lại
     regression
   - `tests/platform.test.mjs` (24 test) chạy được trên Windows bằng
     `node tests/platform.test.mjs` — dùng nó nếu đụng vào `platform.js`

3. **Không hardcode đường dẫn theo OS.** Mọi khác biệt phải đi qua
   `native-host/lib/platform.js`.

4. **Không lưu nội dung private key vào `chrome.storage`.** File `.ovpn` chỉ được ghi
   ra đĩa bởi native host, kèm `icacls` khoá về đúng user — trên Windows file kế thừa
   ACL thư mục cha nên mặc định user khác đọc được.

---

## Cách debug

**Log của native host** đi vào stderr, Chrome mặc định nuốt mất. Muốn thấy:

```powershell
# Đóng hết Chrome trước
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --enable-logging=stderr
```

**Service worker console**: `chrome://extensions` → VPN Manager → **Service Worker**
→ tab Console.

**Thử host trực tiếp** (ngoài Chrome):

```powershell
cmd /c "native-host\vpn-manager-host.bat < NUL"
```

Phải thấy `[vpn-manager-host] khởi động pid=...` ở **stderr**, và **stdout trống hoàn
toàn**. Host sẽ tự thoát sau ~15 giây grace period — đó là hành vi đúng.

**Xem container**:

```powershell
docker ps --filter "name=^vpnmgr-"
docker logs vpnmgr-<profile-id>
```

---

## Khi xong

1. Cập nhật bảng trạng thái trong
   [phase-05-installer-windows.md](phase-05-installer-windows.md) — ghi rõ cái gì đã
   chạy thật, cái gì chưa. **Không đánh ✅ cho thứ chưa có bằng chứng.**
2. Cập nhật [plan.md](plan.md) phase 05.
3. Ghi lỗi đã sửa vào `docs/project-changelog.md`, kèm **nguyên nhân gốc** chứ không
   chỉ "đã sửa".
4. Commit theo conventional commits, tiếng Việt, không tham chiếu AI.
5. Nếu có sửa file dùng chung, nói rõ để phiên Linux chạy lại 106 test.

Phase cuối còn lại là **06 — tài liệu**: viết lại README theo từng OS và bảng trạng
thái kiểm chứng trung thực.
