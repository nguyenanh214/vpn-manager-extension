# Phase 05 — Installer Windows

**Ưu tiên:** Trung bình · **Trạng thái:** ⬜ Chưa làm · **Verify:** Windows (user chạy)
**Phụ thuộc:** [Phase 03](phase-03-os-abstraction.md)

## Vì sao Windows cần file cài riêng

Ba khác biệt không thể gói vào `install.sh`:

1. **Không chạy được `.sh`** trừ khi cài Git Bash/WSL. Không thể coi là có sẵn.
2. **Native messaging đăng ký bằng registry**, không phải thả file vào thư mục:
   `HKCU\Software\Google\Chrome\NativeMessagingHosts\<tên>` với giá trị mặc định là
   đường dẫn tuyệt đối tới file manifest.
3. **Chrome không thực thi được `.js` trực tiếp.** Phải có `.bat` làm launcher.

Nên: `scripts/install.ps1` + `scripts/uninstall.ps1` bằng PowerShell — có sẵn trên
mọi bản Windows 10/11, không cần cài thêm gì.

## Môi trường đã khảo sát (2026-09-14)

| Mục | Giá trị | Ảnh hưởng |
|---|---|---|
| Docker | 29.8.0, Docker Desktop, backend **WSL2** | `--device` hoạt động ở backend này |
| TUN | `ls` thấy device **và** `ip tuntap add` → `TUN_OK` ✅ | Kiến trúc dùng được |
| Publish `127.0.0.1` | HTTP 200 ✅ | SOCKS5 và port-forward dùng được |
| `docker cp` | `hello` ✅ | **Phase 01 dùng được trên Windows, không cần lớp dịch đường dẫn** |
| Node | v24.21.0 tại `C:\Program Files\nodejs\node.exe` | Không phải nvm-windows — đường dẫn chuẩn |
| Trình duyệt | Chrome + **Edge** (không có Brave/Chromium) | Cần ghi registry cho cả Edge |
| PowerShell | **5.1** (Windows PowerShell, không phải PS7) | Xem mục bên dưới |
| ExecutionPolicy | mọi scope `Undefined` | Mặc định client là `Restricted` → **bắt buộc** `-ExecutionPolicy Bypass` |
| `%APPDATA%` | `C:\Users\<user>\AppData\Roaming` | `stateDir()` trỏ vào đây |

## Ràng buộc: PowerShell 5.1, không phải 7

Máy test dùng **Windows PowerShell 5.1** — bản ship sẵn với Windows, không phải
PowerShell 7 (`pwsh`). `install.ps1` phải viết cho 5.1, nghĩa là **không** dùng:

- Toán tử ternary `? :` và null-coalescing `??` `??=`
- `ForEach-Object -Parallel`
- `Test-Json`, `ConvertFrom-Json -AsHashtable`
- Chuỗi nội suy kiểu `$($x ?? 'default')`

Viết cho 5.1 thì chạy được trên cả 7; viết cho 7 thì 5.1 báo lỗi cú pháp ngay dòng đầu.
Không được giả định user cài PowerShell 7.

## Yêu cầu

- Chạy được bằng PowerShell mặc định, không đòi cài Git Bash hay WSL
- Ghi registry ở `HKCU` (không cần quyền Administrator)
- Sinh `.bat` launcher tự dò `node`
- Thông báo lỗi hướng dẫn từng bước như bản Linux/macOS
- `uninstall.ps1` xoá sạch registry, container, image, thư mục state

## Kiến trúc

```
scripts/install.ps1
  ├─ kiểm tra: docker, node, docker daemon đang chạy, smoke test TUN
  ├─ dựng image
  ├─ hỏi Extension ID
  ├─ ghi manifest ra %LOCALAPPDATA%\vpn-manager\com.andy.vpn_manager.json
  ├─ ghi registry cho từng trình duyệt tìm thấy
  └─ thử spawn native host giống cách Chrome spawn
```

Registry theo trình duyệt:

| Trình duyệt | Khoá |
|---|---|
| Chrome | `HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.andy.vpn_manager` |
| Chromium | `HKCU:\Software\Chromium\NativeMessagingHosts\com.andy.vpn_manager` |
| Brave | `HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.andy.vpn_manager` |
| Edge | `HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.andy.vpn_manager` |

Giá trị `(Default)` = đường dẫn tuyệt đối tới file manifest. Trong manifest, `path`
trỏ tới `vpn-manager-host.bat`.

## `vpn-manager-host.bat`

Cùng vai trò với `vpn-manager-host.sh`: dò node rồi exec. Hai ràng buộc riêng:

- **Không được in gì ra stdout** ngoài giao thức native messaging. `@echo off` là bắt
  buộc — thiếu nó, Chrome nhận rác ở đầu stream và ngắt kết nối ngay.
- Dò node theo thứ tự: `PATH` → `%ProgramFiles%\nodejs\node.exe` →
  `%LOCALAPPDATA%\Programs\nodejs\node.exe` → nvm-windows
  (`%APPDATA%\nvm\<version>\node.exe`).

## Điểm cần chú ý

**Thư mục state.** Linux/macOS dùng `~/.config/vpn-manager`. Windows nên dùng
`%APPDATA%\vpn-manager`. Đã trừu tượng hoá bằng `stateDir()` ở Phase 03 — Phase này
chỉ việc dùng, không được hardcode lại.

**Quyền file thay cho `chmod 0600`.** Windows không có chmod. File `.ovpn` chứa
private key phải được đặt ACL chỉ cho user hiện tại đọc:
`icacls <file> /inheritance:r /grant:r "%USERNAME%:(R,W)"`. Nếu bỏ qua bước này,
file secret sẽ kế thừa quyền của thư mục cha — mọi user trên máy đọc được.

**Backend Docker.** WSL2 và Hyper-V xử lý `--device` khác nhau. Smoke test TUN ở
Phase 03 phải chạy trên đúng backend user đang dùng; installer in ra backend nào đang
hoạt động để khi báo lỗi còn biết đường lần.

**Xuống dòng.** `.bat` nên dùng CRLF. Thêm `.gitattributes` ép `*.bat text eol=crlf`
để tránh git chuẩn hoá sai khi clone trên Linux rồi copy sang.

## File đụng tới

Tạo:
- `scripts/install.ps1`
- `scripts/uninstall.ps1`
- `native-host/vpn-manager-host.bat`
- `.gitattributes`

Sửa:
- `native-host/lib/platform.js` — `stateDir()` trả `%APPDATA%` trên Windows,
  `hostLauncher()` trả `.bat`
- `native-host/lib/ovpn-store.js` — dùng `icacls` thay `chmod` trên Windows

## Các bước

1. `vpn-manager-host.bat` + kiểm tra spawn thủ công bằng `cmd /c`.
2. `platform.js` bổ sung nhánh Windows cho `stateDir()` và `hostLauncher()`.
3. `ovpn-store.js` đặt ACL bằng `icacls` khi ở Windows.
4. `install.ps1`: kiểm tra điều kiện → dựng image → hỏi ID → ghi manifest → ghi
   registry → thử spawn.
5. `uninstall.ps1`: xoá khoá registry, container `vpnmgr-*`, image, thư mục state.
6. `.gitattributes` ép CRLF cho `.bat`.

## Todo

- [x] Smoke test TUN trên Windows — `TUN_OK`, backend WSL2 (2026-09-14)
- [ ] `vpn-manager-host.bat` có `@echo off`, dò được node, không in rác ra stdout
- [ ] `install.ps1` chạy không cần quyền Administrator
- [ ] Registry ghi đúng cho các trình duyệt có mặt trên máy
- [ ] ACL file `.ovpn` — kiểm chứng user khác **không** đọc được
- [ ] `uninstall.ps1` xoá sạch, `Get-ChildItem` xác nhận registry đã mất
- [ ] User chạy trên Windows: install → load extension → import `.ovpn` → bật domain → kiểm IP

## Tiêu chí hoàn thành

- `install.ps1` chạy trọn vẹn bằng PowerShell mặc định, không quyền admin
- Chrome spawn được native host qua `.bat`
- Import `.ovpn` và bật domain hoạt động, traffic ra đúng IP VPN
- File `.ovpn` trên đĩa chỉ user hiện tại đọc được
- `uninstall.ps1` dọn sạch cả registry

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| **Docker Desktop không cho mượn `/dev/net/tun`** | Smoke test Phase 03 phải pass trước, nếu không thì dừng |
| `.bat` in rác ra stdout làm hỏng giao thức | `@echo off`, mọi thông báo chuyển sang stderr |
| ExecutionPolicy chặn `.ps1` | Hướng dẫn `powershell -ExecutionPolicy Bypass -File install.ps1`, không bảo user đổi policy toàn hệ thống |
| Quên đặt ACL, file secret lộ cho user khác | Có mục kiểm chứng riêng trong Todo |
| Node cài bằng nvm-windows không nằm trong PATH của Chrome | `.bat` dò thêm `%APPDATA%\nvm` |

## Bảo mật

Windows là nơi dễ sai nhất về quyền file. Trên Linux/macOS `chmod 0600` là đủ; trên
Windows file kế thừa ACL của thư mục cha, nghĩa là **mặc định có thể user khác đọc
được**. Bước `icacls` không phải tuỳ chọn — thiếu nó là private key trong `.ovpn` bị
lộ cho mọi tài khoản trên máy.
